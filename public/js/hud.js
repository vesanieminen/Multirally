import { CAR_SPECS, TOTAL_LAPS, PLAYER_COLORS } from '/shared/constants.js';
import { TRACK_DEFS, TRACK_KEYS, buildTrack } from '/shared/track.js';
import { sendMessage } from './network.js';

let lobbyEl, countdownEl, hudEl, resultsEl;
let lobbyJoinEl, lobbyRoomEl;
let myReady = false;
let selectedColor = null;
let currentPlayers = []; // track players for color availability

export function initHud() {
  lobbyEl = document.getElementById('lobby');
  countdownEl = document.getElementById('countdown');
  hudEl = document.getElementById('hud');
  resultsEl = document.getElementById('results');
  lobbyJoinEl = document.getElementById('lobby-join');
  lobbyRoomEl = document.getElementById('lobby-room');

  // Load saved preferences from localStorage
  const savedPrefs = loadPrefs();

  // Setup join button
  const joinBtn = document.getElementById('join-btn');
  const nameInput = document.getElementById('player-name');

  // Pre-fill name from localStorage
  if (savedPrefs.name) {
    nameInput.value = savedPrefs.name;
  }

  // Build color picker for join screen
  buildColorSwatches('color-picker', (color) => {
    selectedColor = color;
  });

  // Pre-select saved color
  if (savedPrefs.color && PLAYER_COLORS.includes(savedPrefs.color)) {
    selectedColor = savedPrefs.color;
    selectColorSwatch('color-picker', savedPrefs.color);
  } else {
    // Select first color by default
    selectedColor = PLAYER_COLORS[0];
    selectColorSwatch('color-picker', PLAYER_COLORS[0]);
  }

  joinBtn.addEventListener('click', () => doJoin());
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  function doJoin() {
    const name = nameInput.value.trim() || `Player`;
    savePrefs(name, selectedColor);
    sendMessage({ type: 'join', name, preferredColor: selectedColor });
    lobbyJoinEl.style.display = 'none';
    lobbyRoomEl.style.display = 'block';
    // Set the name in the change-name input
    document.getElementById('change-name').value = name;
  }

  // Setup name change in lobby
  const changeNameBtn = document.getElementById('change-name-btn');
  const changeNameInput = document.getElementById('change-name');
  changeNameBtn.addEventListener('click', () => {
    const newName = changeNameInput.value.trim();
    if (newName) {
      sendMessage({ type: 'changeName', name: newName });
      savePrefs(newName, selectedColor);
    }
  });
  changeNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const newName = changeNameInput.value.trim();
      if (newName) {
        sendMessage({ type: 'changeName', name: newName });
        savePrefs(newName, selectedColor);
      }
    }
  });

  // Build color picker for lobby room
  buildColorSwatches('color-options', (color) => {
    selectedColor = color;
    sendMessage({ type: 'changeColor', color });
    savePrefs(changeNameInput.value.trim() || null, color);
  });
  if (selectedColor) {
    selectColorSwatch('color-options', selectedColor);
  }

  // Setup car selection
  const carOptions = document.getElementById('car-options');
  for (const [key, spec] of Object.entries(CAR_SPECS)) {
    const div = document.createElement('div');
    div.className = 'car-option' + (key === 'general' ? ' selected' : '');
    div.dataset.carType = key;
    div.innerHTML = `
      <div class="car-name">${spec.name}</div>
      <div class="car-desc">${spec.description}</div>
    `;
    div.addEventListener('click', () => {
      document.querySelectorAll('.car-option').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      sendMessage({ type: 'selectCar', carType: key });
    });
    carOptions.appendChild(div);
  }

  // Setup track selection with thumbnail previews
  const trackOptions = document.getElementById('track-options');
  for (const key of TRACK_KEYS) {
    const card = document.createElement('div');
    card.className = 'track-card';
    card.dataset.trackKey = key;

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    canvas.className = 'track-thumbnail';
    renderTrackThumbnail(canvas, key);

    const label = document.createElement('div');
    label.className = 'track-card-name';
    label.textContent = TRACK_DEFS[key].name;

    card.appendChild(canvas);
    card.appendChild(label);
    card.addEventListener('click', () => {
      sendMessage({ type: 'trackAdd', trackKey: key });
    });
    trackOptions.appendChild(card);
  }

  document.getElementById('clear-playlist-btn').addEventListener('click', () => {
    sendMessage({ type: 'trackClear' });
  });

  // Setup bot controls
  document.getElementById('add-bot-btn').addEventListener('click', () => {
    sendMessage({ type: 'addBot' });
  });
  document.getElementById('remove-bot-btn').addEventListener('click', () => {
    sendMessage({ type: 'removeBot' });
  });

  // Setup bot speed slider
  const botSpeedSlider = document.getElementById('bot-speed-slider');
  const botSpeedValue = document.getElementById('bot-speed-value');
  botSpeedSlider.addEventListener('input', () => {
    botSpeedValue.textContent = `${botSpeedSlider.value}%`;
    sendMessage({ type: 'botSpeed', speed: parseInt(botSpeedSlider.value) });
  });

  // Setup ready buttons (lobby + results)
  const readyBtn = document.getElementById('ready-btn');
  const resultsReadyBtn = document.getElementById('results-ready-btn');

  function toggleReady() {
    myReady = !myReady;
    readyBtn.textContent = myReady ? 'Cancel' : 'Ready';
    readyBtn.classList.toggle('is-ready', myReady);
    resultsReadyBtn.textContent = myReady ? 'Cancel' : 'Ready';
    resultsReadyBtn.classList.toggle('is-ready', myReady);
    sendMessage({ type: 'ready' });
  }

  readyBtn.addEventListener('click', toggleReady);
  resultsReadyBtn.addEventListener('click', toggleReady);

  // Setup pause menu buttons
  document.getElementById('pause-resume-btn').addEventListener('click', () => {
    sendMessage({ type: 'resume' });
  });
  document.getElementById('pause-end-race-btn').addEventListener('click', () => {
    sendMessage({ type: 'endRace' });
  });
  document.getElementById('pause-back-lobby-btn').addEventListener('click', () => {
    sendMessage({ type: 'backToLobby' });
  });
}

export function showLobby() {
  lobbyEl.style.display = 'flex';
  countdownEl.style.display = 'none';
  hudEl.style.display = 'none';
  resultsEl.style.display = 'none';
  document.getElementById('pause-menu').style.display = 'none';

  // Reset ready state
  myReady = false;
  const readyBtn = document.getElementById('ready-btn');
  readyBtn.textContent = 'Ready';
  readyBtn.classList.remove('is-ready');
}

export function updateLobby(players, myId, trackPlaylistData) {
  currentPlayers = players;
  const playersEl = document.getElementById('players');
  playersEl.innerHTML = '';

  // Update color availability in lobby color picker
  const takenColors = new Set(players.map(p => p.color));
  const me = players.find(p => p.id === myId);
  const myColor = me ? me.color : selectedColor;
  updateColorAvailability('color-options', takenColors, myColor);

  for (const p of players) {
    const div = document.createElement('div');
    div.className = 'player-entry' + (p.ready ? ' is-ready' : '');
    const botLabel = p.isBot ? ' <span class="bot-label">[BOT]</span>' : '';
    div.innerHTML = `
      <div class="player-color" style="background:${p.color}"></div>
      <span class="player-name-label">${escapeHtml(p.name)}${botLabel}</span>
      <span class="player-car-label">${CAR_SPECS[p.carType]?.name || p.carType}</span>
    `;
    playersEl.appendChild(div);
  }

  // Update track playlist UI
  const playlistChips = document.getElementById('playlist-chips');
  const playlistMode = document.getElementById('playlist-mode');
  const clearBtn = document.getElementById('clear-playlist-btn');
  const playlist = trackPlaylistData || [];

  if (playlist.length === 0) {
    playlistMode.textContent = 'Random';
    playlistChips.innerHTML = '';
    clearBtn.style.display = 'none';
    document.querySelectorAll('.track-card').forEach(el => el.classList.remove('in-playlist'));
  } else {
    playlistMode.textContent = `${playlist.length} race${playlist.length > 1 ? 's' : ''}`;
    clearBtn.style.display = 'inline-block';
    playlistChips.innerHTML = '';
    const inPlaylist = new Set(playlist);

    playlist.forEach((key, index) => {
      const chip = document.createElement('span');
      chip.className = 'playlist-chip';
      chip.innerHTML = `<span class="chip-number">${index + 1}.</span> ${TRACK_DEFS[key]?.name || key} <span class="chip-remove">\u00d7</span>`;
      chip.addEventListener('click', () => {
        sendMessage({ type: 'trackRemove', index });
      });
      playlistChips.appendChild(chip);
    });

    document.querySelectorAll('.track-card').forEach(el => {
      el.classList.toggle('in-playlist', inPlaylist.has(el.dataset.trackKey));
    });
  }
}

export function showCountdown(seconds) {
  lobbyEl.style.display = 'none';
  countdownEl.style.display = 'flex';
  hudEl.style.display = 'flex';
  resultsEl.style.display = 'none';

  // Light up lights progressively: 3 -> first, 2 -> second, 1 -> third
  const lights = [
    document.getElementById('light-3'),
    document.getElementById('light-2'),
    document.getElementById('light-1'),
  ];

  // Reset all
  for (const l of lights) { l.className = 'light'; }

  // Light up from left to right as countdown decreases
  if (seconds <= 3) lights[0].classList.add('on');
  if (seconds <= 2) lights[1].classList.add('on');
  if (seconds <= 1) lights[2].classList.add('on');

  if (seconds <= 0) {
    countdownEl.style.display = 'none';
  }
}

export function showCountdownGo() {
  countdownEl.style.display = 'flex';
  const lights = document.querySelectorAll('.light');
  for (const l of lights) { l.className = 'light go'; }
  setTimeout(() => { countdownEl.style.display = 'none'; }, 500);
}

export function showRaceHud(trackName) {
  lobbyEl.style.display = 'none';
  countdownEl.style.display = 'none';
  hudEl.style.display = 'flex';
  resultsEl.style.display = 'none';

  document.getElementById('track-name').textContent = trackName || 'Track';
}

export function updateHud(players, myId, raceTime) {
  // Race time
  document.getElementById('race-time').textContent = formatTime(raceTime);

  // My car info
  const me = players.find(p => p.id === myId);
  if (me) {
    document.getElementById('lap-info').textContent = `Lap ${Math.min(me.lap + 1, TOTAL_LAPS)}/${TOTAL_LAPS}`;
    document.getElementById('speed-info').textContent = `${Math.round(me.speed)} km/h`;
  }

  // Positions
  const sorted = [...players].sort((a, b) => {
    if (a.finished && !b.finished) return -1;
    if (!a.finished && b.finished) return 1;
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.lap !== b.lap) return b.lap - a.lap;
    return b.nextCheckpoint - a.nextCheckpoint;
  });

  const posEl = document.getElementById('positions');
  posEl.innerHTML = '';
  sorted.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'pos-entry';
    const isMe = p.id === myId;
    div.innerHTML = `
      <span style="font-weight:${isMe ? 'bold' : 'normal'}">${i + 1}.</span>
      <span class="pos-color" style="background:${p.color}"></span>
      <span class="pos-name" style="color:${isMe ? '#fff' : '#aaa'}">${escapeHtml(p.name)}</span>
      <span class="pos-time">${p.bestLap < Infinity ? formatTime(p.bestLap) : '--'}</span>
    `;
    posEl.appendChild(div);
  });
}

export function showPauseMenu(pausedByName) {
  const pauseEl = document.getElementById('pause-menu');
  pauseEl.style.display = 'flex';
  document.getElementById('paused-by').textContent = `${pausedByName} paused the game`;
}

export function hidePauseMenu() {
  const pauseEl = document.getElementById('pause-menu');
  pauseEl.style.display = 'none';
}

export function showResults(results, raceNumber, totalRaces, hasMoreRaces) {
  lobbyEl.style.display = 'none';
  countdownEl.style.display = 'none';
  hudEl.style.display = 'none';
  resultsEl.style.display = 'flex';

  // Reset ready state
  myReady = false;
  const resultsReadyBtn = document.getElementById('results-ready-btn');
  resultsReadyBtn.textContent = 'Ready';
  resultsReadyBtn.classList.remove('is-ready');
  const readyBtn = document.getElementById('ready-btn');
  readyBtn.textContent = 'Ready';
  readyBtn.classList.remove('is-ready');

  const listEl = document.getElementById('results-list');
  listEl.innerHTML = '';

  for (const r of results) {
    const div = document.createElement('div');
    div.className = 'result-entry';
    div.innerHTML = `
      <span class="result-pos">${r.position}</span>
      <span class="result-color" style="background:${r.color}"></span>
      <span class="result-name">${escapeHtml(r.name)}</span>
      <span class="result-time">${r.finished ? formatTime(r.finishTime) : 'DNF'}</span>
    `;
    listEl.appendChild(div);
  }

  // Update subtitle for multi-race progress
  const subtitleEl = resultsEl.querySelector('.subtitle');
  if (hasMoreRaces) {
    subtitleEl.textContent = `Race ${raceNumber} of ${totalRaces} complete. Next race starting soon...`;
  } else if (totalRaces > 1) {
    subtitleEl.textContent = `All ${totalRaces} races complete! Returning to lobby...`;
  } else {
    subtitleEl.textContent = 'Returning to lobby...';
  }
}

function renderTrackThumbnail(canvas, trackKey) {
  const trackData = buildTrack(trackKey);
  const ctx = canvas.getContext('2d');
  const segments = trackData.segments;
  const roadWidthVal = trackData.roadWidth;

  // Compute bounding box including road width
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const extra = roadWidthVal / 2 + 10;
  for (const s of segments) {
    minX = Math.min(minX, s.x - extra);
    maxX = Math.max(maxX, s.x + extra);
    minZ = Math.min(minZ, s.z - extra);
    maxZ = Math.max(maxZ, s.z + extra);
  }

  const trackW = maxX - minX;
  const trackH = maxZ - minZ;
  const padding = 12;
  const scaleX = (canvas.width - padding * 2) / trackW;
  const scaleZ = (canvas.height - padding * 2) / trackH;
  const scale = Math.min(scaleX, scaleZ);

  const offsetX = (canvas.width - trackW * scale) / 2;
  const offsetZ = (canvas.height - trackH * scale) / 2;

  function tx(x) { return (x - minX) * scale + offsetX; }
  function tz(z) { return (z - minZ) * scale + offsetZ; }

  // Background (grass)
  ctx.fillStyle = '#3a7d3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Road surface
  const halfW = roadWidthVal / 2;
  ctx.beginPath();
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const lx = tx(s.x + s.nx * halfW);
    const lz = tz(s.z + s.nz * halfW);
    if (i === 0) ctx.moveTo(lx, lz);
    else ctx.lineTo(lx, lz);
  }
  ctx.closePath();
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    const rx = tx(s.x - s.nx * halfW);
    const rz = tz(s.z - s.nz * halfW);
    ctx.lineTo(rx, rz);
  }
  ctx.closePath();
  ctx.fillStyle = '#606060';
  ctx.fill();

  // White edge lines
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const ex = tx(s.x + s.nx * halfW * side);
      const ez = tz(s.z + s.nz * halfW * side);
      if (i === 0) ctx.moveTo(ex, ez);
      else ctx.lineTo(ex, ez);
    }
    ctx.closePath();
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Start/finish line
  const s0 = segments[0];
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx(s0.x + s0.nx * halfW), tz(s0.z + s0.nz * halfW));
  ctx.lineTo(tx(s0.x - s0.nx * halfW), tz(s0.z - s0.nz * halfW));
  ctx.stroke();
}

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00.00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Color picker helpers ---

function buildColorSwatches(containerId, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  for (const color of PLAYER_COLORS) {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.addEventListener('click', () => {
      if (swatch.classList.contains('taken')) return;
      // Deselect all in this container
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      onSelect(color);
    });
    container.appendChild(swatch);
  }
}

function selectColorSwatch(containerId, color) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === color);
  });
}

function updateColorAvailability(containerId, takenColors, myColor) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.color-swatch').forEach(s => {
    const isTaken = takenColors.has(s.dataset.color) && s.dataset.color !== myColor;
    s.classList.toggle('taken', isTaken);
  });
}

export function setMyColor(color) {
  selectedColor = color;
  selectColorSwatch('color-picker', color);
  selectColorSwatch('color-options', color);
}

// --- localStorage helpers ---

function loadPrefs() {
  try {
    const stored = localStorage.getItem('multirally-prefs');
    if (stored) return JSON.parse(stored);
  } catch (e) { /* ignore */ }
  return {};
}

function savePrefs(name, color) {
  try {
    const prefs = loadPrefs();
    if (name) prefs.name = name;
    if (color) prefs.color = color;
    localStorage.setItem('multirally-prefs', JSON.stringify(prefs));
  } catch (e) { /* ignore */ }
}
