import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { TICK_RATE, BROADCAST_RATE, COUNTDOWN_SECONDS, TOTAL_LAPS } from './shared/constants.js';
import { updateCar, createCarState } from './shared/physics.js';
import { track, buildTrack, getRandomTrackKey } from './shared/track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let filePath;
  if (req.url.startsWith('/shared/')) {
    filePath = path.join(__dirname, req.url);
  } else {
    filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  }
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// Game state
const players = new Map();
let gamePhase = 'lobby';
let countdownTimer = 0;
let raceTime = 0;
let gameLoopInterval = null;
let broadcastInterval = null;
let nextPlayerId = 1;
let currentTrack = track; // starts with random default
let currentTrackKey = null;

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#e67e22', '#9b59b6'];

function getPlayerList() {
  const list = [];
  for (const [, p] of players) {
    list.push({ id: p.id, name: p.name, carType: p.carType, ready: p.ready, color: p.color });
  }
  return list;
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const [ws] of players) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function broadcastLobby() {
  broadcast({ type: 'lobby', players: getPlayerList(), phase: gamePhase });
}

function getRaceState() {
  const playerStates = [];
  for (const [, p] of players) {
    if (!p.car) continue;
    playerStates.push({
      id: p.id, x: p.car.x, z: p.car.z, angle: p.car.angle,
      speed: p.car.speed, lap: p.car.lap, lapTime: p.car.lapTime,
      bestLap: p.car.bestLap, finished: p.car.finished, finishTime: p.car.finishTime,
      color: p.color, name: p.name, carType: p.carType, nextCheckpoint: p.car.nextCheckpoint,
      skidIntensity: p.car.skidIntensity || 0,
      collisionForce: p.car.collisionForce || 0,
    });
    // Reset after reading so next broadcast only captures new collisions
    p.car.collisionForce = 0;
  }
  return playerStates;
}

function selectNewTrack() {
  currentTrackKey = getRandomTrackKey();
  currentTrack = buildTrack(currentTrackKey);
  console.log(`Selected track: ${currentTrack.name}`);
  return currentTrack;
}

function startCountdown() {
  gamePhase = 'countdown';
  countdownTimer = COUNTDOWN_SECONDS;

  // Select a random track for this race
  selectNewTrack();

  // Tell clients which track to render
  broadcast({
    type: 'trackInfo',
    trackKey: currentTrackKey,
    trackName: currentTrack.name,
  });

  // Place cars on starting grid
  let gridIndex = 0;
  for (const [, p] of players) {
    const gridPos = currentTrack.startGrid[gridIndex] || { x: 0, z: 0, angle: 0 };
    p.car = createCarState(p.carType, gridPos.x, gridPos.z, gridPos.angle);
    gridIndex++;
  }

  broadcast({ type: 'countdown', seconds: countdownTimer });
  broadcast({ type: 'raceState', players: getRaceState(), raceTime: 0 });

  const countdownInterval = setInterval(() => {
    countdownTimer--;
    if (countdownTimer <= 0) {
      clearInterval(countdownInterval);
      startRace();
    } else {
      broadcast({ type: 'countdown', seconds: countdownTimer });
    }
  }, 1000);
}

function startRace() {
  gamePhase = 'racing';
  raceTime = 0;
  broadcast({ type: 'raceStart' });

  const dt = 1 / TICK_RATE;
  gameLoopInterval = setInterval(() => {
    raceTime += dt;

    const allCars = [];
    for (const [, p] of players) if (p.car) allCars.push(p.car);

    for (const [, p] of players) {
      if (!p.car) continue;
      updateCar(p.car, p.input, dt, allCars, currentTrack);
    }

    let allFinished = true;
    for (const [, p] of players) {
      if (!p.car || !p.car.finished) { allFinished = false; break; }
    }
    if (allFinished && players.size > 0) endRace();
  }, 1000 / TICK_RATE);

  broadcastInterval = setInterval(() => {
    broadcast({ type: 'raceState', players: getRaceState(), raceTime });
  }, 1000 / BROADCAST_RATE);
}

function endRace() {
  gamePhase = 'results';
  clearInterval(gameLoopInterval);
  clearInterval(broadcastInterval);

  const results = getRaceState()
    .sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.lap - a.lap;
    })
    .map((p, i) => ({ ...p, position: i + 1 }));

  broadcast({ type: 'raceEnd', results });

  setTimeout(() => {
    gamePhase = 'lobby';
    for (const [, p] of players) { p.ready = false; p.car = null; }
    broadcastLobby();
  }, 10000);
}

function resetGame() {
  clearInterval(gameLoopInterval);
  clearInterval(broadcastInterval);
  gamePhase = 'lobby';
  raceTime = 0;
  for (const [, p] of players) { p.ready = false; p.car = null; }
}

wss.on('connection', (ws) => {
  const playerId = nextPlayerId++;
  const colorIndex = players.size % PLAYER_COLORS.length;

  const player = {
    id: playerId, name: `Player ${playerId}`, carType: 'general',
    ready: false, color: PLAYER_COLORS[colorIndex],
    input: { throttle: false, brake: false, left: false, right: false },
    car: null,
  };

  players.set(ws, player);
  console.log(`Player ${playerId} connected (${players.size} total)`);

  ws.send(JSON.stringify({ type: 'welcome', id: playerId, color: player.color }));
  broadcastLobby();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'join':
        player.name = (msg.name || `Player ${playerId}`).slice(0, 20);
        broadcastLobby();
        break;
      case 'selectCar':
        if (gamePhase === 'lobby' && ['general', 'formula', 'onewheeler', 'mcturbo'].includes(msg.carType)) {
          player.carType = msg.carType;
          broadcastLobby();
        }
        break;
      case 'ready':
        if (gamePhase === 'lobby') {
          player.ready = !player.ready;
          broadcastLobby();
          if (players.size >= 1) {
            let allReady = true;
            for (const [, p] of players) { if (!p.ready) { allReady = false; break; } }
            if (allReady) startCountdown();
          }
        }
        break;
      case 'input':
        if (gamePhase === 'racing' && msg.input) {
          player.input = {
            throttle: !!msg.input.throttle, brake: !!msg.input.brake,
            left: !!msg.input.left, right: !!msg.input.right,
          };
        }
        break;
    }
  });

  ws.on('close', () => {
    console.log(`Player ${player.id} disconnected (${players.size - 1} remaining)`);
    players.delete(ws);
    if (players.size === 0) resetGame();
    else broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(`MultiRally server running on http://localhost:${PORT}`);
});
