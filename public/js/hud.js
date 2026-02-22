import { CAR_SPECS, TOTAL_LAPS } from '/shared/constants.js';
import { TRACK_DEFS, TRACK_KEYS, buildTrack } from '/shared/track.js';
import { sendMessage } from './network.js';

let lobbyEl, countdownEl, hudEl, resultsEl;
let lobbyJoinEl, lobbyRoomEl;
let myReady = false;
let selectedColor = null;
let currentName = '';

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
  const colorPickerInput = document.getElementById('color-picker-input');

  // Pre-fill from localStorage
  if (savedPrefs.name) {
    nameInput.value = savedPrefs.name;
  }
  if (savedPrefs.color) {
    selectedColor = savedPrefs.color;
    colorPickerInput.value = savedPrefs.color;
  } else {
    selectedColor = colorPickerInput.value;
  }

  colorPickerInput.addEventListener('input', (e) => {
    selectedColor = e.target.value;
  });

  joinBtn.addEventListener('click', () => doJoin());
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  function doJoin() {
    const name = nameInput.value.trim() || `Player`;
    currentName = name;
    savePrefs(name, selectedColor);
    sendMessage({ type: 'join', name, preferredColor: selectedColor });
    lobbyJoinEl.style.display = 'none';
    lobbyRoomEl.style.display = 'block';
  }

  // Setup edit player dialog
  const editPlayerBtn = document.getElementById('edit-player-btn');
  const editDialog = document.getElementById('player-edit-dialog');
  const changeNameInput = document.getElementById('change-name');
  const colorChangeInput = document.getElementById('color-change-input');

  editPlayerBtn.addEventListener('click', () => {
    // Populate dialog with current values
    changeNameInput.value = currentName;
    colorChangeInput.value = selectedColor;
    editDialog.style.display = 'flex';
  });

  document.getElementById('edit-ok-btn').addEventListener('click', () => {
    const newName = changeNameInput.value.trim();
    const newColor = colorChangeInput.value;

    // Apply name change if different
    if (newName && newName !== currentName) {
      currentName = newName;
      sendMessage({ type: 'changeName', name: newName });
    }

    // Apply color change if different
    if (newColor !== selectedColor) {
      selectedColor = newColor;
      sendMessage({ type: 'changeColor', color: newColor });
      // Update car thumbnails with new color
      document.querySelectorAll('.car-card').forEach(card => {
        const canvas = card.querySelector('.car-thumbnail');
        if (canvas && card.dataset.carType) {
          renderCarThumbnail(canvas, card.dataset.carType, selectedColor);
        }
      });
    }

    savePrefs(currentName, selectedColor);
    editDialog.style.display = 'none';
  });

  document.getElementById('edit-cancel-btn').addEventListener('click', () => {
    editDialog.style.display = 'none';
  });

  // Setup car selection with thumbnails
  const carOptions = document.getElementById('car-options');
  for (const [key, spec] of Object.entries(CAR_SPECS)) {
    const card = document.createElement('div');
    card.className = 'car-card' + (key === 'general' ? ' selected' : '');
    card.dataset.carType = key;

    const canvas = document.createElement('canvas');
    canvas.width = 130;
    canvas.height = 80;
    canvas.className = 'car-thumbnail';
    renderCarThumbnail(canvas, key, selectedColor);

    const nameDiv = document.createElement('div');
    nameDiv.className = 'car-card-name';
    nameDiv.textContent = spec.name;

    const descDiv = document.createElement('div');
    descDiv.className = 'car-card-desc';
    descDiv.textContent = spec.description;

    card.appendChild(canvas);
    card.appendChild(nameDiv);
    card.appendChild(descDiv);
    card.addEventListener('click', () => {
      document.querySelectorAll('.car-card').forEach(el => el.classList.remove('selected'));
      card.classList.add('selected');
      sendMessage({ type: 'selectCar', carType: key });
    });
    carOptions.appendChild(card);
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
  const playersEl = document.getElementById('players');
  playersEl.innerHTML = '';

  for (const p of players) {
    const div = document.createElement('div');
    div.className = 'player-entry' + (p.ready ? ' is-ready' : '');
    const botLabel = p.isBot ? ' <span class="bot-label">[BOT]</span>' : '';
    div.innerHTML = `
      <div class="player-color" style="background:${p.color}"></div>
      <span class="player-name-label">${escapeHtml(p.name)}${botLabel}</span>
      <span class="player-car-label">${CAR_SPECS[p.carType]?.name || p.carType}</span>
    `;
    // Add X button for bots
    if (p.isBot) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-bot-x';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = `Remove ${p.name}`;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendMessage({ type: 'removeBotById', botId: p.id });
      });
      div.appendChild(removeBtn);
    }
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

export function setMyColor(color) {
  selectedColor = color;
  const joinPicker = document.getElementById('color-picker-input');
  if (joinPicker) joinPicker.value = color;
  // Update car thumbnails with new color
  document.querySelectorAll('.car-card').forEach(card => {
    const canvas = card.querySelector('.car-thumbnail');
    if (canvas && card.dataset.carType) {
      renderCarThumbnail(canvas, card.dataset.carType, color);
    }
  });
}

// --- Car thumbnail rendering (2D top-down view) ---

function renderCarThumbnail(canvas, carType, color) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);

  const carColor = color || '#3498db';
  const wheelColor = '#333';
  const darkColor = '#222';
  const glassColor = '#88ccff';
  const chromeColor = '#999';

  switch (carType) {
    case 'general': drawGeneralTopDown(ctx, carColor, wheelColor, glassColor, chromeColor); break;
    case 'formula': drawFormulaTopDown(ctx, carColor, wheelColor, glassColor, darkColor); break;
    case 'onewheeler': drawMotorcycleTopDown(ctx, carColor, wheelColor, glassColor, chromeColor); break;
    case 'mcturbo': drawMcTurboTopDown(ctx, carColor, wheelColor, glassColor, darkColor); break;
  }

  ctx.restore();
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawGeneralTopDown(ctx, carColor, wheelColor, glassColor, chromeColor) {
  // Hatchback: 21x33, car pointing up (negative Y = front)
  // Wheels
  ctx.fillStyle = wheelColor;
  ctx.fillRect(-14, -12, 5, 8); // front-left
  ctx.fillRect(9, -12, 5, 8);   // front-right
  ctx.fillRect(-14, 8, 5, 8);   // rear-left
  ctx.fillRect(9, 8, 5, 8);     // rear-right

  // Body
  ctx.fillStyle = carColor;
  drawRoundedRect(ctx, -10, -16, 20, 32, 5);
  ctx.fill();

  // Windshield
  ctx.fillStyle = glassColor;
  drawRoundedRect(ctx, -7, -10, 14, 7, 2);
  ctx.fill();

  // Rear window
  ctx.fillStyle = glassColor;
  drawRoundedRect(ctx, -6, 7, 12, 5, 2);
  ctx.fill();

  // Headlights
  ctx.fillStyle = '#ffffaa';
  ctx.beginPath();
  ctx.arc(-6, -15, 2.5, 0, Math.PI * 2);
  ctx.arc(6, -15, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Bumpers
  ctx.fillStyle = chromeColor;
  ctx.fillRect(-10, -17, 20, 2);
  ctx.fillRect(-10, 15, 20, 2);
}

function drawFormulaTopDown(ctx, carColor, wheelColor, glassColor, darkColor) {
  // Formula: narrow body, wide wings, exposed wheels
  // Exposed wheels (outside body)
  ctx.fillStyle = wheelColor;
  ctx.fillRect(-20, -14, 6, 10);  // front-left
  ctx.fillRect(14, -14, 6, 10);   // front-right
  ctx.fillRect(-20, 10, 6, 10);   // rear-left
  ctx.fillRect(14, 10, 6, 10);    // rear-right

  // Front wing
  ctx.fillStyle = darkColor;
  ctx.fillRect(-18, -18, 36, 4);

  // Rear wing
  ctx.fillRect(-17, 18, 34, 4);

  // Wing supports
  ctx.fillRect(-8, 14, 2, 6);
  ctx.fillRect(6, 14, 2, 6);

  // Narrow body
  ctx.fillStyle = carColor;
  drawRoundedRect(ctx, -6, -16, 12, 34, 3);
  ctx.fill();

  // Nose cone
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(-4, -16);
  ctx.lineTo(4, -16);
  ctx.closePath();
  ctx.fill();

  // Driver helmet
  ctx.fillStyle = carColor;
  ctx.beginPath();
  ctx.arc(0, 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = darkColor;
  ctx.beginPath();
  ctx.arc(0, 0.5, 4, -0.8, 0.8);
  ctx.fill();
}

function drawMotorcycleTopDown(ctx, carColor, wheelColor, glassColor, chromeColor) {
  // Motorcycle: very narrow, 2 inline wheels
  // Wheels
  ctx.fillStyle = wheelColor;
  drawRoundedRect(ctx, -3, -22, 6, 9, 2);
  ctx.fill();
  drawRoundedRect(ctx, -3, 13, 6, 9, 2);
  ctx.fill();

  // Wheel hubs
  ctx.fillStyle = chromeColor;
  ctx.beginPath();
  ctx.arc(0, -17.5, 2, 0, Math.PI * 2);
  ctx.arc(0, 17.5, 2, 0, Math.PI * 2);
  ctx.fill();

  // Body / frame
  ctx.fillStyle = carColor;
  drawRoundedRect(ctx, -4, -14, 8, 28, 3);
  ctx.fill();

  // Tank (front)
  ctx.fillStyle = carColor;
  drawRoundedRect(ctx, -5, -10, 10, 8, 3);
  ctx.fill();

  // Seat (dark, rear)
  ctx.fillStyle = '#444';
  drawRoundedRect(ctx, -3.5, 2, 7, 10, 2);
  ctx.fill();

  // Handlebars
  ctx.strokeStyle = chromeColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, -12);
  ctx.lineTo(8, -12);
  ctx.stroke();

  // Headlight
  ctx.fillStyle = '#ffffaa';
  ctx.beginPath();
  ctx.arc(0, -15, 2, 0, Math.PI * 2);
  ctx.fill();

  // Helmet
  ctx.fillStyle = carColor;
  ctx.beginPath();
  ctx.arc(0, -3, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(0, -4.5, 4, -0.7, 0.7);
  ctx.fill();
}

function drawMcTurboTopDown(ctx, carColor, wheelColor, glassColor, darkColor) {
  // McTurbo: long, wide muscle car
  // Wide wheels
  ctx.fillStyle = wheelColor;
  ctx.fillRect(-16, -16, 6, 11);  // front-left
  ctx.fillRect(10, -16, 6, 11);   // front-right
  ctx.fillRect(-16, 10, 6, 11);   // rear-left
  ctx.fillRect(10, 10, 6, 11);    // rear-right

  // Body
  ctx.fillStyle = carColor;
  drawRoundedRect(ctx, -12, -20, 24, 40, 4);
  ctx.fill();

  // Hood scoop
  ctx.fillStyle = darkColor;
  drawRoundedRect(ctx, -4, -16, 8, 10, 2);
  ctx.fill();

  // Windshield
  ctx.fillStyle = glassColor;
  drawRoundedRect(ctx, -8, -5, 16, 7, 2);
  ctx.fill();

  // Rear spoiler
  ctx.fillStyle = darkColor;
  ctx.fillRect(-14, 17, 28, 4);

  // Spoiler supports
  ctx.fillRect(-9, 14, 2, 5);
  ctx.fillRect(7, 14, 2, 5);

  // Headlights
  ctx.fillStyle = '#ffffaa';
  ctx.fillRect(-10, -20, 4, 2);
  ctx.fillRect(6, -20, 4, 2);

  // Exhaust pipes
  ctx.fillStyle = '#888';
  ctx.beginPath();
  ctx.arc(-4, 21, 2, 0, Math.PI * 2);
  ctx.arc(4, 21, 2, 0, Math.PI * 2);
  ctx.fill();
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
