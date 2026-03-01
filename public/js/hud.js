import { CAR_SPECS, TOTAL_LAPS } from '/shared/constants.js';
import { TRACK_DEFS, TRACK_KEYS, buildTrack } from '/shared/track.js';
import { sendMessage } from './network.js';

let lobbyEl, countdownEl, hudEl, resultsEl, championshipEl;
let myReady = false;
let selectedColor = null;
let currentName = '';
let joined = false;
let soundToggleCallback = null;
let currentTotalLaps = TOTAL_LAPS;

export function setTotalLaps(laps) {
  currentTotalLaps = laps;
}

export function initHud() {
  lobbyEl = document.getElementById('lobby');
  countdownEl = document.getElementById('countdown');
  hudEl = document.getElementById('hud');
  resultsEl = document.getElementById('results');
  championshipEl = document.getElementById('championship');

  // Load saved preferences from localStorage
  const savedPrefs = loadPrefs();

  const nameInput = document.getElementById('player-name');
  const colorPickerInput = document.getElementById('color-picker-input');

  // Pre-fill from localStorage
  if (savedPrefs.name) {
    nameInput.value = savedPrefs.name;
    currentName = savedPrefs.name;
  }
  if (savedPrefs.color) {
    selectedColor = savedPrefs.color;
    colorPickerInput.value = savedPrefs.color;
  } else {
    selectedColor = colorPickerInput.value;
  }

  // Inline name editing - send changeName on blur or Enter (only after joined)
  nameInput.addEventListener('blur', () => {
    const newName = nameInput.value.trim();
    if (joined && newName && newName !== currentName) {
      currentName = newName;
      savePrefs(currentName, selectedColor);
      sendMessage({ type: 'changeName', name: newName });
    }
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      nameInput.blur();
    }
  });

  // Inline color editing
  colorPickerInput.addEventListener('input', (e) => {
    selectedColor = e.target.value;
    if (joined) {
      savePrefs(currentName, selectedColor);
      sendMessage({ type: 'changeColor', color: selectedColor });
      // Update car thumbnails with new color
      document.querySelectorAll('.car-card').forEach(card => {
        const canvas = card.querySelector('.car-thumbnail');
        if (canvas && card.dataset.carType) {
          renderCarThumbnail(canvas, card.dataset.carType, selectedColor);
        }
      });
    }
  });

  // Setup car selection with thumbnails and stat bars
  const carOptions = document.getElementById('car-options');
  for (const [key, spec] of Object.entries(CAR_SPECS)) {
    const card = document.createElement('div');
    card.className = 'car-card' + (key === 'general' ? ' selected' : '');
    card.dataset.carType = key;

    const canvas = document.createElement('canvas');
    canvas.width = 130;
    canvas.height = 70;
    canvas.className = 'car-thumbnail';
    renderCarThumbnail(canvas, key, selectedColor);

    const nameDiv = document.createElement('div');
    nameDiv.className = 'car-card-name';
    nameDiv.textContent = spec.name;

    const descDiv = document.createElement('div');
    descDiv.className = 'car-card-desc';
    descDiv.textContent = spec.description;

    // Stat bars
    const statsDiv = document.createElement('div');
    statsDiv.className = 'car-stats';
    const stats = getCarStats(spec);
    for (const [label, value, color] of [
      ['SPD', stats.speed, '#3498db'],
      ['HND', stats.handling, '#2ecc71'],
      ['OFF', stats.offroad, '#f39c12'],
    ]) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `
        <span class="stat-label">${label}</span>
        <div class="stat-bar">
          <div class="stat-bar-fill" style="width:${Math.round(Math.min(value, 1) * 100)}%;background:${color}"></div>
        </div>
      `;
      statsDiv.appendChild(row);
    }

    card.appendChild(canvas);
    card.appendChild(nameDiv);
    card.appendChild(descDiv);
    card.appendChild(statsDiv);
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
    canvas.width = 180;
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

  // Setup lap count slider
  const lapCountSlider = document.getElementById('lap-count-slider');
  const lapCountValue = document.getElementById('lap-count-value');
  lapCountSlider.addEventListener('input', () => {
    lapCountValue.textContent = lapCountSlider.value;
    sendMessage({ type: 'lapCount', laps: parseInt(lapCountSlider.value) });
  });

  // Setup spectate button
  const spectateBtn = document.getElementById('spectate-btn');
  spectateBtn.addEventListener('click', () => {
    sendMessage({ type: 'toggleSpectator' });
  });

  // Setup chat dialog
  setupChatDialog();

  // Setup settings dialog
  setupSettingsDialog();

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

  // Championship ready button
  const championshipReadyBtn = document.getElementById('championship-ready-btn');
  championshipReadyBtn.addEventListener('click', () => {
    sendMessage({ type: 'ready' });
    championshipReadyBtn.textContent = 'Waiting...';
    championshipReadyBtn.disabled = true;
  });

  // Enter key acts as confirm (Ready / Back to Lobby)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const lobby = document.getElementById('lobby');
    const results = document.getElementById('results');
    const championship = document.getElementById('championship');

    if (championship && championship.style.display !== 'none' && !championshipReadyBtn.disabled) {
      championshipReadyBtn.click();
    } else if (results && results.style.display !== 'none') {
      resultsReadyBtn.click();
    } else if (lobby && lobby.style.display !== 'none' && readyBtn.style.display !== 'none') {
      readyBtn.click();
    }
  });

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

  // Sound toggle button
  const soundToggle = document.getElementById('sound-toggle');
  soundToggle.addEventListener('click', () => {
    if (soundToggleCallback) {
      const isMuted = soundToggleCallback();
      updateSoundToggleUI(isMuted);
    }
  });
}

// Auto-join with saved preferences (called from main.js on welcome)
export function autoJoinFromPrefs() {
  const prefs = loadPrefs();
  const name = prefs.name || 'Player';
  const color = prefs.color || '#e74c3c';
  currentName = name;
  selectedColor = color;

  // Update UI fields
  const nameInput = document.getElementById('player-name');
  const colorPicker = document.getElementById('color-picker-input');
  if (nameInput) nameInput.value = name;
  if (colorPicker) colorPicker.value = color;

  sendMessage({ type: 'join', name, preferredColor: color });
  joined = true;
}

export function setSoundToggleCallback(fn) {
  soundToggleCallback = fn;
}

export function updateSoundToggleUI(isMuted) {
  const btn = document.getElementById('sound-toggle');
  if (!btn) return;
  btn.classList.toggle('muted', isMuted);
  btn.textContent = isMuted ? '\u{1f507}' : '\u{1f50a}';
}

export function showLobby() {
  lobbyEl.style.display = 'flex';
  countdownEl.style.display = 'none';
  hudEl.style.display = 'none';
  resultsEl.style.display = 'none';
  championshipEl.style.display = 'none';
  document.getElementById('pause-menu').style.display = 'none';

  // Clear chat messages on return to lobby
  const chatMsgs = document.getElementById('chat-messages');
  if (chatMsgs) chatMsgs.innerHTML = '';
}

const MAX_CHAT_MESSAGES = 50;
let chatDialogOpen = false;

function setupChatDialog() {
  const dialog = document.getElementById('chat-dialog');
  const header = document.getElementById('chat-dialog-header');
  const toggleBtn = document.getElementById('chat-toggle-btn');
  const closeBtn = document.getElementById('chat-close-btn');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');

  // Toggle open/close
  toggleBtn.addEventListener('click', () => {
    chatDialogOpen = !chatDialogOpen;
    dialog.style.display = chatDialogOpen ? 'flex' : 'none';
    toggleBtn.classList.remove('has-unread');
    if (chatDialogOpen) chatInput.focus();
  });

  closeBtn.addEventListener('click', () => {
    chatDialogOpen = false;
    dialog.style.display = 'none';
  });

  // Send chat
  function sendChat() {
    const text = chatInput.value.trim();
    if (text) {
      sendMessage({ type: 'chat', text });
      chatInput.value = '';
    }
  }

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChat();
    }
    // Prevent game input handlers from capturing chat keystrokes
    e.stopPropagation();
  });
  chatSendBtn.addEventListener('click', sendChat);

  // Dragging
  let dragging = false;
  let dragOffX = 0, dragOffY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target === closeBtn) return;
    dragging = true;
    const rect = dialog.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const container = document.getElementById('game-container');
    const cRect = container.getBoundingClientRect();
    let x = e.clientX - cRect.left - dragOffX;
    let y = e.clientY - cRect.top - dragOffY;
    // Clamp to container
    x = Math.max(0, Math.min(x, cRect.width - dialog.offsetWidth));
    y = Math.max(0, Math.min(y, cRect.height - dialog.offsetHeight));
    dialog.style.left = x + 'px';
    dialog.style.top = y + 'px';
    dialog.style.right = 'auto';
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
  });
}

export function addChatMessage(name, color, text) {
  const chatMsgs = document.getElementById('chat-messages');
  if (!chatMsgs) return;

  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-msg-dot" style="background:${color}"></span><span class="chat-msg-name">${escapeHtml(name)}:</span><span class="chat-msg-text">${escapeHtml(text)}</span>`;
  chatMsgs.appendChild(div);

  // Limit to last N messages
  while (chatMsgs.children.length > MAX_CHAT_MESSAGES) {
    chatMsgs.removeChild(chatMsgs.firstChild);
  }

  // Auto-scroll to bottom
  chatMsgs.scrollTop = chatMsgs.scrollHeight;

  // Show unread indicator if dialog is closed
  if (!chatDialogOpen) {
    const toggleBtn = document.getElementById('chat-toggle-btn');
    if (toggleBtn) toggleBtn.classList.add('has-unread');
  }
}

export function updateLobby(players, myId, trackPlaylistData, serverLapCount) {
  // Sync lap count slider from server
  if (serverLapCount && serverLapCount >= 1 && serverLapCount <= 20) {
    currentTotalLaps = serverLapCount;
    const slider = document.getElementById('lap-count-slider');
    const label = document.getElementById('lap-count-value');
    if (slider) slider.value = serverLapCount;
    if (label) label.textContent = serverLapCount;
  }
  const playersEl = document.getElementById('players');
  playersEl.innerHTML = '';

  // Update spectate/ready button state for local player
  const me = players.find(p => p.id === myId);
  const spectateBtn = document.getElementById('spectate-btn');
  const readyBtn = document.getElementById('ready-btn');
  if (me) {
    const isSpectating = me.spectator;
    spectateBtn.textContent = isSpectating ? 'Race' : 'Spectate';
    spectateBtn.classList.toggle('is-spectating', isSpectating);
    readyBtn.style.display = isSpectating ? 'none' : '';

    // Sync ready button from server state (prevents desync from lobby broadcasts)
    myReady = !!me.ready;
    readyBtn.textContent = myReady ? 'Cancel' : 'Ready';
    readyBtn.classList.toggle('is-ready', myReady);
  }

  for (const p of players) {
    const div = document.createElement('div');
    div.className = 'player-entry' + (p.ready ? ' is-ready' : '');
    const botLabel = p.isBot ? ' <span class="bot-label">[BOT]</span>' : '';
    const specLabel = p.spectator ? ' <span class="spectator-label">[SPECTATING]</span>' : '';
    div.innerHTML = `
      <div class="player-color" style="background:${p.color}"></div>
      <span class="player-name-label">${escapeHtml(p.name)}${botLabel}${specLabel}</span>
      <span class="player-car-label">${p.spectator ? '' : (CAR_SPECS[p.carType]?.name || p.carType)}</span>
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
      chip.querySelector('.chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        sendMessage({ type: 'trackRemove', index });
      });
      chip.addEventListener('click', () => {
        sendMessage({ type: 'trackAdd', trackKey: key });
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
  championshipEl.style.display = 'none';

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

export function showRaceHud(trackName, trackRecord) {
  lobbyEl.style.display = 'none';
  countdownEl.style.display = 'none';
  hudEl.style.display = 'flex';
  resultsEl.style.display = 'none';
  championshipEl.style.display = 'none';

  document.getElementById('track-name').textContent = trackName || 'Track';

  const recordEl = document.getElementById('track-record');
  if (recordEl) {
    if (trackRecord) {
      recordEl.textContent = `Record: ${formatTime(trackRecord.time)} (${escapeHtml(trackRecord.name)})`;
      recordEl.style.display = '';
    } else {
      recordEl.textContent = '';
      recordEl.style.display = 'none';
    }
  }
}

export function updateHud(players, myId, raceTime, isSpectating) {
  // Race time
  document.getElementById('race-time').textContent = formatTime(raceTime);

  // My car info
  const me = players.find(p => p.id === myId);
  if (isSpectating) {
    document.getElementById('lap-info').textContent = 'Spectating';
    document.getElementById('speed-info').textContent = '';
  } else if (me) {
    document.getElementById('lap-info').textContent = `Lap ${Math.min(me.lap + 1, currentTotalLaps)}/${currentTotalLaps}`;
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

export function showResults(results, raceNumber, totalRaces, hasMoreRaces, isSpectating, trackRecord, newRecord, championshipStandings) {
  lobbyEl.style.display = 'none';
  countdownEl.style.display = 'none';
  hudEl.style.display = 'none';
  resultsEl.style.display = 'flex';
  championshipEl.style.display = 'none';

  // Reset ready state
  myReady = false;
  const resultsReadyBtn = document.getElementById('results-ready-btn');
  resultsReadyBtn.textContent = isSpectating ? 'Join Next Race' : 'Ready';
  resultsReadyBtn.classList.remove('is-ready');
  const readyBtn = document.getElementById('ready-btn');
  readyBtn.textContent = 'Ready';
  readyBtn.classList.remove('is-ready');

  const listEl = document.getElementById('results-list');
  listEl.innerHTML = '';

  const showPoints = totalRaces > 1;

  // Header row
  const header = document.createElement('div');
  header.className = 'result-header';
  header.innerHTML = `
    <span class="result-pos"></span>
    <span class="result-color"></span>
    <span class="result-name">Name</span>
    <span class="result-best-lap">Best Lap</span>
    <span class="result-time">Total</span>
    ${showPoints ? '<span class="result-points">Pts</span>' : ''}
    ${showPoints ? '<span class="result-total">Championship</span>' : ''}
  `;
  listEl.appendChild(header);

  for (const r of results) {
    const div = document.createElement('div');
    div.className = 'result-entry';
    const bestLapStr = r.bestLap && r.bestLap < Infinity ? formatTime(r.bestLap) : '--';
    const totalPts = championshipStandings && championshipStandings[r.id] ? championshipStandings[r.id].points : 0;
    div.innerHTML = `
      <span class="result-pos">${r.position}</span>
      <span class="result-color" style="background:${r.color}"></span>
      <span class="result-name">${escapeHtml(r.name)}</span>
      <span class="result-best-lap">${bestLapStr}</span>
      <span class="result-time">${r.finished ? (r.lapsDown ? `+${r.lapsDown} lap${r.lapsDown > 1 ? 's' : ''}` : formatTime(r.finishTime)) : 'DNF'}</span>
      ${showPoints ? `<span class="result-points">+${r.points}</span>` : ''}
      ${showPoints ? `<span class="result-total">${totalPts}</span>` : ''}
    `;
    listEl.appendChild(div);
  }

  // Track record line
  const recordLine = document.getElementById('results-record');
  if (recordLine) {
    if (trackRecord) {
      const prefix = newRecord ? 'NEW RECORD!' : 'Track Record:';
      recordLine.textContent = `${prefix} ${formatTime(trackRecord.time)} — ${trackRecord.name} (${CAR_SPECS[trackRecord.carType]?.name || trackRecord.carType})`;
      recordLine.className = newRecord ? 'results-record new-record' : 'results-record';
    } else {
      recordLine.textContent = '';
      recordLine.className = 'results-record';
    }
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

export function showChampionship(standings, totalRaces) {
  lobbyEl.style.display = 'none';
  countdownEl.style.display = 'none';
  hudEl.style.display = 'none';
  resultsEl.style.display = 'none';
  championshipEl.style.display = 'flex';

  document.getElementById('championship-title').textContent =
    `Championship Standings — ${totalRaces} Races`;

  const btn = document.getElementById('championship-ready-btn');
  btn.textContent = 'Back to Lobby';
  btn.disabled = false;

  const listEl = document.getElementById('championship-list');
  listEl.innerHTML = '';

  for (const s of standings) {
    const div = document.createElement('div');
    div.className = 'championship-entry';
    const trophy = s.position === 1 ? ' \u{1f3c6}' : '';
    div.innerHTML = `
      <span class="result-pos">${s.position}</span>
      <span class="result-color" style="background:${s.color}"></span>
      <span class="result-name">${escapeHtml(s.name)}${trophy}</span>
      <span class="championship-wins">${s.wins} win${s.wins !== 1 ? 's' : ''}</span>
      <span class="championship-points">${s.points} pts</span>
    `;
    listEl.appendChild(div);
  }
}

// Compute normalized car stats for stat bars
function getCarStats(spec) {
  return {
    speed: spec.topSpeed / 200,
    handling: (spec.steerSpeed * spec.cornerGrip) / (3.5 * 0.95),
    offroad: spec.gripGrass / 0.50,
  };
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

  // Oil slicks
  if (trackData.oilSlicks) {
    for (const oil of trackData.oilSlicks) {
      ctx.beginPath();
      ctx.arc(tx(oil.x), tz(oil.z), oil.radius * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20, 20, 40, 0.55)';
      ctx.fill();
    }
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

  ctx.fillStyle = '#111';
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
  ctx.fillStyle = wheelColor;
  ctx.fillRect(-14, -12, 5, 8);
  ctx.fillRect(9, -12, 5, 8);
  ctx.fillRect(-14, 8, 5, 8);
  ctx.fillRect(9, 8, 5, 8);

  ctx.fillStyle = carColor;
  drawRoundedRect(ctx, -10, -16, 20, 32, 5);
  ctx.fill();

  ctx.fillStyle = glassColor;
  drawRoundedRect(ctx, -7, -10, 14, 7, 2);
  ctx.fill();

  ctx.fillStyle = glassColor;
  drawRoundedRect(ctx, -6, 7, 12, 5, 2);
  ctx.fill();

  ctx.fillStyle = '#ffffaa';
  ctx.beginPath();
  ctx.arc(-6, -15, 2.5, 0, Math.PI * 2);
  ctx.arc(6, -15, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = chromeColor;
  ctx.fillRect(-10, -17, 20, 2);
  ctx.fillRect(-10, 15, 20, 2);
}

function drawFormulaTopDown(ctx, carColor, wheelColor, glassColor, darkColor) {
  ctx.fillStyle = wheelColor;
  ctx.fillRect(-20, -14, 6, 10);
  ctx.fillRect(14, -14, 6, 10);
  ctx.fillRect(-20, 10, 6, 10);
  ctx.fillRect(14, 10, 6, 10);

  ctx.fillStyle = darkColor;
  ctx.fillRect(-18, -18, 36, 4);
  ctx.fillRect(-17, 18, 34, 4);
  ctx.fillRect(-8, 14, 2, 6);
  ctx.fillRect(6, 14, 2, 6);

  ctx.fillStyle = carColor;
  drawRoundedRect(ctx, -6, -16, 12, 34, 3);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(-4, -16);
  ctx.lineTo(4, -16);
  ctx.closePath();
  ctx.fill();

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
  ctx.fillStyle = wheelColor;
  drawRoundedRect(ctx, -3, -22, 6, 9, 2);
  ctx.fill();
  drawRoundedRect(ctx, -3, 13, 6, 9, 2);
  ctx.fill();

  ctx.fillStyle = chromeColor;
  ctx.beginPath();
  ctx.arc(0, -17.5, 2, 0, Math.PI * 2);
  ctx.arc(0, 17.5, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = carColor;
  drawRoundedRect(ctx, -4, -14, 8, 28, 3);
  ctx.fill();

  ctx.fillStyle = carColor;
  drawRoundedRect(ctx, -5, -10, 10, 8, 3);
  ctx.fill();

  ctx.fillStyle = '#444';
  drawRoundedRect(ctx, -3.5, 2, 7, 10, 2);
  ctx.fill();

  ctx.strokeStyle = chromeColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, -12);
  ctx.lineTo(8, -12);
  ctx.stroke();

  ctx.fillStyle = '#ffffaa';
  ctx.beginPath();
  ctx.arc(0, -15, 2, 0, Math.PI * 2);
  ctx.fill();

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
  ctx.fillStyle = wheelColor;
  ctx.fillRect(-16, -16, 6, 11);
  ctx.fillRect(10, -16, 6, 11);
  ctx.fillRect(-16, 10, 6, 11);
  ctx.fillRect(10, 10, 6, 11);

  ctx.fillStyle = carColor;
  drawRoundedRect(ctx, -12, -20, 24, 40, 4);
  ctx.fill();

  ctx.fillStyle = darkColor;
  drawRoundedRect(ctx, -4, -16, 8, 10, 2);
  ctx.fill();

  ctx.fillStyle = glassColor;
  drawRoundedRect(ctx, -8, -5, 16, 7, 2);
  ctx.fill();

  ctx.fillStyle = darkColor;
  ctx.fillRect(-14, 17, 28, 4);
  ctx.fillRect(-9, 14, 2, 5);
  ctx.fillRect(7, 14, 2, 5);

  ctx.fillStyle = '#ffffaa';
  ctx.fillRect(-10, -20, 4, 2);
  ctx.fillRect(6, -20, 4, 2);

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

// ---- Settings dialog ----

const SETTINGS_DEFS = [
  { section: 'Collision', key: 'restitution', label: 'Restitution (bounce)', min: 0, max: 1, step: 0.05, default: 0.85 },
  { section: 'Collision', key: 'spinScale', label: 'Spin Scale', min: 0, max: 1, step: 0.05, default: 0.3 },
  { section: 'Collision', key: 'maxSpinDelta', label: 'Max Spin Delta', min: 0, max: 10, step: 0.5, default: 3.0 },
  { section: 'Collision', key: 'maxAngularVel', label: 'Max Angular Vel', min: 0, max: 20, step: 0.5, default: 6.0 },
  { section: 'Collision', key: 'frictionMU', label: 'Friction (MU)', min: 0, max: 1, step: 0.05, default: 0.3 },
  { section: 'Collision', key: 'inertiaMult', label: 'Inertia Multiplier', min: 0.1, max: 10, step: 0.1, default: 4.5 },
  { section: 'Driving', key: 'rollingResistance', label: 'Rolling Resistance', min: 0, max: 0.5, step: 0.01, default: 0.2 },
  { section: 'Driving', key: 'dragCoefficient', label: 'Drag Coefficient', min: 0, max: 0.01, step: 0.0001, default: 0.0015 },
  { section: 'Driving', key: 'lateralGripFactor', label: 'Lateral Grip', min: 0, max: 20, step: 0.5, default: 5.0 },
  { section: 'Driving', key: 'angularDamping', label: 'Angular Damping', min: 0, max: 20, step: 0.5, default: 5.0 },
  { section: 'Driving', key: 'grassSpeedMult', label: 'Grass Speed Mult', min: 0, max: 1, step: 0.05, default: 0.6 },
  { section: 'Surface Drag', key: 'surfaceDragRoad', label: 'Road', min: 0, max: 5, step: 0.1, default: 0 },
  { section: 'Surface Drag', key: 'surfaceDragKerb', label: 'Kerb', min: 0, max: 5, step: 0.1, default: 0.5 },
  { section: 'Surface Drag', key: 'surfaceDragGrass', label: 'Grass', min: 0, max: 5, step: 0.1, default: 0.8 },
  { section: 'Surface Drag', key: 'surfaceDragWater', label: 'Water', min: 0, max: 10, step: 0.5, default: 5.0 },
  { section: 'Surface Drag', key: 'surfaceDragOil', label: 'Oil', min: 0, max: 1, step: 0.01, default: 0.05 },
];

let currentSettings = {};
let settingsSliders = {};
let settingsDialogOpen = false;

function setupSettingsDialog() {
  const dialog = document.getElementById('settings-dialog');
  const toggleBtn = document.getElementById('settings-toggle-btn');
  const closeBtn = document.getElementById('settings-close-btn');
  const content = document.getElementById('settings-content');

  // Initialize current settings from defaults
  for (const def of SETTINGS_DEFS) {
    currentSettings[def.key] = def.default;
  }

  // Build sections
  const sections = {};
  for (const def of SETTINGS_DEFS) {
    if (!sections[def.section]) sections[def.section] = [];
    sections[def.section].push(def);
  }

  for (const [sectionName, defs] of Object.entries(sections)) {
    const sec = document.createElement('div');
    sec.className = 'settings-section';
    const title = document.createElement('div');
    title.className = 'settings-section-title';
    title.textContent = sectionName;
    sec.appendChild(title);

    for (const def of defs) {
      const row = document.createElement('div');
      row.className = 'settings-row';

      const label = document.createElement('label');
      label.textContent = def.label;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = def.min;
      slider.max = def.max;
      slider.step = def.step;
      slider.value = def.default;

      const valueSpan = document.createElement('span');
      valueSpan.className = 'settings-value';
      valueSpan.textContent = formatSettingValue(def.default, def);

      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        currentSettings[def.key] = val;
        valueSpan.textContent = formatSettingValue(val, def);
        sendMessage({ type: 'updateSettings', settings: { [def.key]: val } });
      });

      settingsSliders[def.key] = { slider, valueSpan, def };

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valueSpan);
      sec.appendChild(row);
    }
    content.appendChild(sec);
  }

  // Toggle
  toggleBtn.addEventListener('click', () => {
    settingsDialogOpen = !settingsDialogOpen;
    dialog.style.display = settingsDialogOpen ? 'flex' : 'none';
  });

  closeBtn.addEventListener('click', () => {
    settingsDialogOpen = false;
    dialog.style.display = 'none';
  });

  // Copy
  document.getElementById('settings-copy-btn').addEventListener('click', () => {
    const json = JSON.stringify(currentSettings);
    navigator.clipboard.writeText(json).then(() => {
      const btn = document.getElementById('settings-copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  });

  // Paste
  document.getElementById('settings-paste-btn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      applySettingsToUI(parsed);
      sendMessage({ type: 'updateSettings', settings: parsed });
      const btn = document.getElementById('settings-paste-btn');
      btn.textContent = 'Applied!';
      setTimeout(() => { btn.textContent = 'Paste'; }, 1500);
    } catch (e) {
      const btn = document.getElementById('settings-paste-btn');
      btn.textContent = 'Error!';
      setTimeout(() => { btn.textContent = 'Paste'; }, 1500);
    }
  });

  // Reset
  document.getElementById('settings-reset-btn').addEventListener('click', () => {
    const defaults = {};
    for (const def of SETTINGS_DEFS) {
      defaults[def.key] = def.default;
    }
    applySettingsToUI(defaults);
    sendMessage({ type: 'updateSettings', settings: defaults });
    const btn = document.getElementById('settings-reset-btn');
    btn.textContent = 'Reset!';
    setTimeout(() => { btn.textContent = 'Reset'; }, 1500);
  });
}

function formatSettingValue(val, def) {
  if (def.step < 0.001) return val.toFixed(4);
  if (def.step < 0.01) return val.toFixed(3);
  if (def.step < 0.1) return val.toFixed(2);
  return val.toFixed(1);
}

function applySettingsToUI(settings) {
  for (const [key, val] of Object.entries(settings)) {
    if (settingsSliders[key]) {
      const { slider, valueSpan, def } = settingsSliders[key];
      slider.value = val;
      valueSpan.textContent = formatSettingValue(val, def);
      currentSettings[key] = val;
    }
  }
}

/** Called when server broadcasts updated settings */
export function updatePhysicsSettings(settings) {
  applySettingsToUI(settings);
}
