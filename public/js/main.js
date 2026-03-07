import { initRenderer, getScene, getCamera, render, onResize, frameCameraToTrack } from './renderer.js';
import { buildTrackScene } from './trackRenderer.js';
import { createCarMesh, updateCarMesh, removeCarMesh } from './carRenderer.js';
import { initInput, getInput, resetInputForRaceStart, onDebugToggle, onAutopilotToggle, onPauseToggle, onSoundToggle, onHorn } from './input.js';
import { initDebug, toggleDebug, rebuildDebugVisuals, updateDebugInfo, highlightNextCheckpoint, isDebugEnabled } from './debug.js';
import { connect, sendMessage, onMessage } from './network.js';
import { initHud, updateHud, showLobby, showCountdown, showCountdownGo, showRaceHud, showResults, showChampionship, updateLobby, setMyColor, showPauseMenu, hidePauseMenu, autoJoinFromPrefs, setSoundToggleCallback, updateSoundToggleUI, addChatMessage, updatePhysicsSettings, setTotalLaps, buildTrackGrid, setChampionshipInfo } from './hud.js';
import { pushSnapshot, getInterpolatedState, resetInterpolation } from './interpolation.js';
import { buildTrack, registerCustomTrack, removeCustomTrack, TRACK_KEYS, TRACK_DEFS } from '/shared/track.js';
import { initSkidmarks, updateSkidmarks, clearSkidmarks, setTrack } from './skidmarks.js';
import { initAudio, updateAudio, playCountdownBeep, playCollisionSound, playLapBling, playFinalLapAlert, playFireworkSound, playApplause, playWinnerCheering, playHaHa, playDoh, playHornSound, cleanup as cleanupAudio, pauseAudio, resumeAudio, toggleMute } from './audio.js';
import { initParticles, emitSparks, updateParticles, clearParticles } from './particles.js';
import { startFireworks, stopFireworks } from './fireworks.js';

const canvas = document.getElementById('game-canvas');

let myId = null;
let myColor = null;
let gamePhase = 'lobby';
const carMeshes = new Map();
let currentTrackData = null;
let lastKnownLap = -1;
let isSpectating = false;
let currentTrackRecord = null;
let currentTotalLaps = 5;
let raceNumber = 0;
let totalRaces = 0;
let championshipStandings = {};
let pointsTable = [10, 6, 3, 0];
const knownCustomTrackKeys = new Set();
const prevCollisionForces = new Map();

// Init Three.js
initRenderer(canvas);

// Build a default track for the lobby background
loadTrack('oval');

// Init input & HUD
initInput();
initHud();

// Init skidmarks
initSkidmarks(getScene());

// Init debug mode
initDebug(getScene());
onDebugToggle(() => toggleDebug(currentTrackData));

// Autopilot toggle (P key)
let autopilotEnabled = false;
onAutopilotToggle(() => {
  sendMessage({ type: 'toggleAutopilot' });
});

// Pause toggle (Escape key)
onPauseToggle(() => {
  if (gamePhase === 'racing') {
    sendMessage({ type: 'pause' });
  } else if (gamePhase === 'paused') {
    sendMessage({ type: 'resume' });
  }
});

// Sound toggle (0 key)
onSoundToggle(() => {
  const isMuted = toggleMute();
  updateSoundToggleUI(isMuted);
});

// Horn (Space key by default)
onHorn(() => {
  if (gamePhase === 'racing' || gamePhase === 'countdown') {
    playHornSound();
  }
});

// Wire sound toggle button in lobby to toggleMute
setSoundToggleCallback(() => {
  return toggleMute();
});

// Init audio on first user interaction (browser autoplay policy)
let audioStarted = false;
function startAudioOnGesture() {
  if (audioStarted) return;
  audioStarted = true;
  initAudio();
  document.removeEventListener('click', startAudioOnGesture);
  document.removeEventListener('keydown', startAudioOnGesture);
}
document.addEventListener('click', startAudioOnGesture);
document.addEventListener('keydown', startAudioOnGesture);

function loadTrack(trackKey) {
  currentTrackData = buildTrack(trackKey);
  const { bounds, islandBounds } = buildTrackScene(getScene(), currentTrackData);
  frameCameraToTrack(bounds);
  // Re-add skidmarks mesh to the rebuilt scene with track reference for surface detection
  initSkidmarks(getScene(), currentTrackData);
  // Rebuild debug visuals for new track if debug is active
  rebuildDebugVisuals(currentTrackData);
  // Re-init particles for new scene
  clearParticles();
  initParticles(getScene());
}

// Connect to server
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
connect(`${wsProtocol}//${window.location.host}`);

onMessage((msg) => {
  switch (msg.type) {
    case 'welcome':
      myId = msg.id;
      myColor = msg.color;
      autoJoinFromPrefs();
      break;

    case 'colorAssigned':
      myColor = msg.color;
      setMyColor(msg.color);
      break;

    case 'lobby':
      gamePhase = 'lobby';
      lastKnownLap = -1;
      autopilotEnabled = false;
      stopFireworks();
      { const ind = document.getElementById('autopilot-indicator'); if (ind) ind.style.display = 'none'; }
      { const me = msg.players.find(p => p.id === myId); isSpectating = me ? !!me.spectator : false; }
      updateLobby(msg.players, myId, msg.trackPlaylist, msg.lapCount);
      showLobby();
      for (const [id, mesh] of carMeshes) {
        removeCarMesh(getScene(), mesh);
      }
      carMeshes.clear();
      clearSkidmarks();
      break;

    case 'trackInfo':
      // Server tells us which track to build for this race
      // Clean up car meshes from previous race (scene is rebuilt in loadTrack)
      for (const [id, mesh] of carMeshes) {
        removeCarMesh(getScene(), mesh);
      }
      carMeshes.clear();
      clearSkidmarks();
      loadTrack(msg.trackKey);
      currentTrackRecord = msg.trackRecord || null;
      currentTotalLaps = msg.totalLaps || 5;
      setTotalLaps(currentTotalLaps);
      raceNumber = msg.raceNumber || 0;
      totalRaces = msg.totalRaces || 0;
      championshipStandings = msg.championshipStandings || {};
      pointsTable = msg.pointsTable || [10, 6, 3, 0];
      setChampionshipInfo(raceNumber, totalRaces, championshipStandings, pointsTable);
      break;

    case 'countdown':
      gamePhase = 'countdown';
      stopFireworks();
      showCountdown(msg.seconds);
      playCountdownBeep(msg.seconds);
      break;

    case 'raceStart':
      gamePhase = 'racing';
      lastKnownLap = 0;
      resetInterpolation();
      resetInputForRaceStart(); // require fresh key press — no pre-held advantage
      playCountdownBeep(0); // the long "duuu" for GO
      showCountdownGo(); // flash green lights briefly
      showRaceHud(currentTrackData ? currentTrackData.name : 'Track', currentTrackRecord);
      break;

    case 'raceState':
      pushSnapshot(msg.players, msg.raceTime);
      // Collision detection (rising edge) — sounds + particles
      for (const p of msg.players) {
        const prevForce = prevCollisionForces.get(p.id) || 0;
        if (p.collisionForce > 5 && prevForce <= 5) {
          if (p.id === myId) playCollisionSound(p.collisionForce);
          emitSparks(p.x, p.z, p.collisionForce);
        }
        prevCollisionForces.set(p.id, p.collisionForce);
      }
      for (const p of msg.players) {
        if (!carMeshes.has(p.id)) {
          const mesh = createCarMesh(p.color, p.carType);
          carMeshes.set(p.id, mesh);
          getScene().add(mesh);
        }
      }
      for (const [id] of carMeshes) {
        if (!msg.players.find(p => p.id === id)) {
          removeCarMesh(getScene(), carMeshes.get(id));
          carMeshes.delete(id);
        }
      }
      break;

    case 'autopilot':
      autopilotEnabled = msg.enabled;
      // Show/hide autopilot indicator
      let indicator = document.getElementById('autopilot-indicator');
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'autopilot-indicator';
        indicator.style.cssText = 'position:absolute;top:10px;right:10px;background:rgba(243,156,18,0.9);color:#000;padding:8px 16px;border-radius:6px;font-weight:bold;font-size:14px;z-index:20;display:none;';
        indicator.textContent = 'AUTOPILOT [P]';
        document.getElementById('game-container').appendChild(indicator);
      }
      indicator.style.display = autopilotEnabled ? 'block' : 'none';
      break;

    case 'paused':
      gamePhase = 'paused';
      showPauseMenu(msg.pausedBy);
      pauseAudio();
      break;

    case 'resumed':
      gamePhase = 'racing';
      hidePauseMenu();
      showRaceHud(currentTrackData ? currentTrackData.name : 'Track', currentTrackRecord);
      resumeAudio();
      break;

    case 'chat':
      addChatMessage(msg.name, msg.color, msg.text);
      break;

    case 'firstFinish':
      playApplause();
      break;

    case 'raceEnd': {
      gamePhase = 'results';
      hidePauseMenu(); // in case race was ended from pause menu
      if (msg.trackRecord) currentTrackRecord = msg.trackRecord;
      showResults(msg.results, msg.raceNumber, msg.totalRaces, msg.hasMoreRaces, isSpectating, msg.trackRecord, msg.newRecord, msg.championshipStandings, msg.bestLapId, msg.topLaps);
      // Race end sounds
      if (!isSpectating && msg.results.length > 0) {
        const myResult = msg.results.find(r => r.id === myId);
        if (myResult) {
          if (!myResult.finished) {
            playDoh();
          } else {
            const humanResults = msg.results.filter(r => !r.isBot);
            if (humanResults.length > 1 && humanResults[humanResults.length - 1].id === myId) {
              playHaHa();
            }
          }
        }
      }
      break;
    }

    case 'championship':
      gamePhase = 'championship';
      showChampionship(msg.standings, msg.totalRaces);
      startFireworks(playFireworkSound);
      break;

    case 'physicsSettings':
      if (msg.settings) updatePhysicsSettings(msg.settings);
      break;

    case 'customTracks': {
      // Full sync: remove tracks no longer on server, add/update the rest
      const serverKeys = new Set(Object.keys(msg.tracks));
      for (const key of knownCustomTrackKeys) {
        if (!serverKeys.has(key)) {
          removeCustomTrack(key);
          knownCustomTrackKeys.delete(key);
        }
      }
      for (const [key, data] of Object.entries(msg.tracks)) {
        registerCustomTrack(key, data);
        knownCustomTrackKeys.add(key);
      }
      // Rebuild lobby track grid to reflect changes
      buildTrackGrid();
      break;
    }
  }
});

let lastInputSend = 0;
const INPUT_SEND_INTERVAL = 1000 / 30;

function animate(time) {
  requestAnimationFrame(animate);

  if (gamePhase === 'racing' && !isSpectating && time - lastInputSend > INPUT_SEND_INTERVAL) {
    sendMessage({ type: 'input', input: getInput() });
    lastInputSend = time;
  }

  if (gamePhase === 'racing' || gamePhase === 'countdown' || gamePhase === 'paused') {
    const state = getInterpolatedState();
    if (state) {
      for (const p of state.players) {
        const mesh = carMeshes.get(p.id);
        if (mesh) updateCarMesh(mesh, p.x, p.z, p.angle, p.steerAngle);
      }
      if (gamePhase === 'racing') {
        updateHud(state.players, myId, state.raceTime, isSpectating);
        updateSkidmarks(state.players);

        const myPlayer = state.players.find(p => p.id === myId);

        // Lap completion sound (suppress on final crossing — raceEnd handles that)
        if (myPlayer && myPlayer.lap > lastKnownLap && lastKnownLap >= 0 && myPlayer.lap <= currentTotalLaps) {
          playLapBling();
          // Final lap alert when entering the last lap
          if (myPlayer.lap === currentTotalLaps - 1 && currentTotalLaps > 1) {
            playFinalLapAlert();
          }
        }
        if (myPlayer) lastKnownLap = myPlayer.lap;

        // Debug mode updates
        if (isDebugEnabled()) {
          updateDebugInfo(myPlayer, currentTrackData);
          if (myPlayer) highlightNextCheckpoint(myPlayer.nextCheckpoint);
        }

        // Update audio with local player state (spectators hear no engine)
        updateAudio(isSpectating ? null : myPlayer, gamePhase, isSpectating ? false : getInput().brake);
      }
    }
  } else {
    updateAudio(null, gamePhase);
  }

  updateParticles(1 / 60);
  render();
}

requestAnimationFrame(animate);
window.addEventListener('resize', () => onResize());
