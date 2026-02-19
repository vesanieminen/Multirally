import { initRenderer, getScene, getCamera, render, onResize, frameCameraToTrack } from './renderer.js';
import { buildTrackScene } from './trackRenderer.js';
import { createCarMesh, updateCarMesh, removeCarMesh } from './carRenderer.js';
import { initInput, getInput } from './input.js';
import { connect, sendMessage, onMessage } from './network.js';
import { initHud, updateHud, showLobby, showCountdown, showRaceHud, showResults, updateLobby } from './hud.js';
import { pushSnapshot, getInterpolatedState } from './interpolation.js';
import { buildTrack } from '/shared/track.js';
import { initSkidmarks, updateSkidmarks, clearSkidmarks, setTrack } from './skidmarks.js';
import { initAudio, updateAudio, cleanup as cleanupAudio } from './audio.js';

const canvas = document.getElementById('game-canvas');

let myId = null;
let myColor = null;
let gamePhase = 'lobby';
const carMeshes = new Map();
let currentTrackData = null;

// Init Three.js
initRenderer(canvas);

// Build a default track for the lobby background
loadTrack('oval');

// Init input & HUD
initInput();
initHud();

// Init skidmarks
initSkidmarks(getScene());

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
      updateLobby(msg.players, myId);
      showLobby();
      for (const [id, mesh] of carMeshes) {
        removeCarMesh(getScene(), mesh);
      }
      carMeshes.clear();
      clearSkidmarks();
      break;

    case 'trackInfo':
      // Server tells us which track to build for this race
      loadTrack(msg.trackKey);
      break;

    case 'countdown':
      gamePhase = 'countdown';
      showCountdown(msg.seconds);
      break;

    case 'raceStart':
      gamePhase = 'racing';
      showRaceHud(currentTrackData ? currentTrackData.name : 'Track');
      break;

    case 'raceState':
      pushSnapshot(msg.players, msg.raceTime);
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

    case 'raceEnd':
      gamePhase = 'results';
      showResults(msg.results);
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
        if (mesh) updateCarMesh(mesh, p.x, p.z, p.angle);
      }
      if (gamePhase === 'racing') {
        updateHud(state.players, myId, state.raceTime);
        updateSkidmarks(state.players);

        // Update audio with local player state
        const myPlayer = state.players.find(p => p.id === myId);
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
