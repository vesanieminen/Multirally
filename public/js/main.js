import { initRenderer, getScene, getCamera, render, onResize, frameCameraToTrack } from './renderer.js';
import { buildTrackScene } from './trackRenderer.js';
import { createCarMesh, updateCarMesh, removeCarMesh } from './carRenderer.js';
import { initInput, getInput, onDebugToggle, onAutopilotToggle } from './input.js';
import { initDebug, toggleDebug, rebuildDebugVisuals, updateDebugInfo, highlightNextCheckpoint, isDebugEnabled } from './debug.js';
import { connect, sendMessage, onMessage } from './network.js';
import { initHud, updateHud, showLobby, showCountdown, showCountdownGo, showRaceHud, showResults, updateLobby } from './hud.js';
import { pushSnapshot, getInterpolatedState } from './interpolation.js';
import { buildTrack } from '/shared/track.js';
import { initSkidmarks, updateSkidmarks, clearSkidmarks, setTrack } from './skidmarks.js';
import { initAudio, updateAudio, playCountdownBeep, playCollisionSound, playLapBling, playApplause, cleanup as cleanupAudio } from './audio.js';

const canvas = document.getElementById('game-canvas');

let myId = null;
let myColor = null;
let gamePhase = 'lobby';
const carMeshes = new Map();
let currentTrackData = null;
let lastKnownLap = -1;

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
}

// Connect to server
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
connect(`${wsProtocol}//${window.location.host}`);

onMessage((msg) => {
  switch (msg.type) {
    case 'welcome':
      myId = msg.id;
      myColor = msg.color;
      break;

    case 'lobby':
      gamePhase = 'lobby';
      lastKnownLap = -1;
      autopilotEnabled = false;
      { const ind = document.getElementById('autopilot-indicator'); if (ind) ind.style.display = 'none'; }
      updateLobby(msg.players, myId, msg.trackPlaylist);
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
      break;

    case 'countdown':
      gamePhase = 'countdown';
      showCountdown(msg.seconds);
      playCountdownBeep(msg.seconds);
      break;

    case 'raceStart':
      gamePhase = 'racing';
      lastKnownLap = 0;
      playCountdownBeep(0); // the long "duuu" for GO
      showCountdownGo(); // flash green lights briefly
      showRaceHud(currentTrackData ? currentTrackData.name : 'Track');
      break;

    case 'raceState':
      pushSnapshot(msg.players, msg.raceTime);
      // Play collision sounds for local player
      for (const p of msg.players) {
        if (p.id === myId && p.collisionForce > 5) {
          playCollisionSound(p.collisionForce);
        }
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

    case 'firstFinish':
      playApplause();
      break;

    case 'raceEnd':
      gamePhase = 'results';
      showResults(msg.results, msg.raceNumber, msg.totalRaces, msg.hasMoreRaces);
      break;
  }
});

let lastInputSend = 0;
const INPUT_SEND_INTERVAL = 1000 / 30;

function animate(time) {
  requestAnimationFrame(animate);

  if (gamePhase === 'racing' && time - lastInputSend > INPUT_SEND_INTERVAL) {
    sendMessage({ type: 'input', input: getInput() });
    lastInputSend = time;
  }

  if (gamePhase === 'racing' || gamePhase === 'countdown') {
    const state = getInterpolatedState();
    if (state) {
      for (const p of state.players) {
        const mesh = carMeshes.get(p.id);
        if (mesh) updateCarMesh(mesh, p.x, p.z, p.angle, p.steerAngle);
      }
      if (gamePhase === 'racing') {
        updateHud(state.players, myId, state.raceTime);
        updateSkidmarks(state.players);

        const myPlayer = state.players.find(p => p.id === myId);

        // Lap completion sound
        if (myPlayer && myPlayer.lap > lastKnownLap && lastKnownLap >= 0) {
          playLapBling();
        }
        if (myPlayer) lastKnownLap = myPlayer.lap;

        // Debug mode updates
        if (isDebugEnabled()) {
          updateDebugInfo(myPlayer, currentTrackData);
          if (myPlayer) highlightNextCheckpoint(myPlayer.nextCheckpoint);
        }

        // Update audio with local player state
        updateAudio(myPlayer, gamePhase);
      }
    }
  } else {
    updateAudio(null, gamePhase);
  }

  render();
}

requestAnimationFrame(animate);
window.addEventListener('resize', () => onResize());
