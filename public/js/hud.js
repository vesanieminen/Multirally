import { CAR_SPECS, TOTAL_LAPS } from '/shared/constants.js';
import { sendMessage } from './network.js';

let lobbyEl, countdownEl, hudEl, resultsEl;
let lobbyJoinEl, lobbyRoomEl;
let myReady = false;

export function initHud() {
  lobbyEl = document.getElementById('lobby');
  countdownEl = document.getElementById('countdown');
  hudEl = document.getElementById('hud');
  resultsEl = document.getElementById('results');
  lobbyJoinEl = document.getElementById('lobby-join');
  lobbyRoomEl = document.getElementById('lobby-room');

  // Setup join button
  const joinBtn = document.getElementById('join-btn');
  const nameInput = document.getElementById('player-name');

  joinBtn.addEventListener('click', () => doJoin());
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  function doJoin() {
    const name = nameInput.value.trim() || `Player`;
    sendMessage({ type: 'join', name });
    lobbyJoinEl.style.display = 'none';
    lobbyRoomEl.style.display = 'block';
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

  // Setup ready button
  const readyBtn = document.getElementById('ready-btn');
  readyBtn.addEventListener('click', () => {
    myReady = !myReady;
    readyBtn.textContent = myReady ? 'Cancel' : 'Ready';
    readyBtn.classList.toggle('is-ready', myReady);
    sendMessage({ type: 'ready' });
  });
}

export function showLobby() {
  lobbyEl.style.display = 'flex';
  countdownEl.style.display = 'none';
  hudEl.style.display = 'none';
  resultsEl.style.display = 'none';

  // Reset ready state
  myReady = false;
  const readyBtn = document.getElementById('ready-btn');
  readyBtn.textContent = 'Ready';
  readyBtn.classList.remove('is-ready');
}

export function updateLobby(players, myId) {
  const playersEl = document.getElementById('players');
  playersEl.innerHTML = '';

  for (const p of players) {
    const div = document.createElement('div');
    div.className = 'player-entry' + (p.ready ? ' is-ready' : '');
    div.innerHTML = `
      <div class="player-color" style="background:${p.color}"></div>
      <span class="player-name-label">${escapeHtml(p.name)}</span>
      <span class="player-car-label">${CAR_SPECS[p.carType]?.name || p.carType}</span>
    `;
    playersEl.appendChild(div);
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

export function showResults(results) {
  lobbyEl.style.display = 'none';
  countdownEl.style.display = 'none';
  hudEl.style.display = 'none';
  resultsEl.style.display = 'flex';

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
