import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { TICK_RATE, BROADCAST_RATE, COUNTDOWN_SECONDS, TOTAL_LAPS, CAR_SPECS, PLAYER_COLORS } from './shared/constants.js';
import { updateCar, createCarState } from './shared/physics.js';
import { track, buildTrack, getRandomTrackKey, TRACK_KEYS } from './shared/track.js';
const TRACK_KEYS_SET = new Set(TRACK_KEYS);

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
let resultsTimeout = null;
let nextPlayerId = 1;
let currentTrack = track; // starts with random default
let currentTrackKey = null;
let trackPlaylist = [];       // ordered list of track keys for multi-race
let playlistIndex = 0;        // current race index in the playlist
let botSpeedPercent = 100;    // AI speed scaling (10-100%)

const MAX_PLAYERS = 12;

function isValidHexColor(color) {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color);
}

function getUnusedColor() {
  const usedColors = new Set();
  for (const [, p] of players) usedColors.add(p.color);
  for (const color of PLAYER_COLORS) {
    if (!usedColors.has(color)) return color;
  }
  // Fallback if all colors taken
  return PLAYER_COLORS[players.size % PLAYER_COLORS.length];
}
const AI_NAMES = ['Stig', 'Kimi', 'Luigi', 'Toad', 'Mika', 'Ari'];
const CAR_TYPES = ['general', 'formula', 'onewheeler', 'mcturbo'];
const botKeys = new Set();

function getPlayerList() {
  const list = [];
  for (const [, p] of players) {
    list.push({ id: p.id, name: p.name, carType: p.carType, ready: p.ready, color: p.color, isBot: !!p.isBot });
  }
  return list;
}

// --- AI Bot Management ---

function addBot() {
  if (players.size >= MAX_PLAYERS) return false;
  if (gamePhase !== 'lobby') return false;

  const botKey = { isBot: true, readyState: 0 };
  const playerId = nextPlayerId++;
  const botIndex = botKeys.size;

  const player = {
    id: playerId,
    name: AI_NAMES[botIndex % AI_NAMES.length],
    carType: CAR_TYPES[botIndex % CAR_TYPES.length],
    ready: true,
    color: getUnusedColor(),
    input: { throttle: false, brake: false, left: false, right: false },
    car: null,
    isBot: true,
    aiConfig: {
      lookAhead: 8 + Math.floor(Math.random() * 7),
      steerThreshold: 0.03 + Math.random() * 0.04,
    },
  };

  players.set(botKey, player);
  botKeys.add(botKey);
  console.log(`AI Bot "${player.name}" added (${players.size} total)`);
  return true;
}

function removeBot() {
  if (gamePhase !== 'lobby') return false;
  const lastBotKey = [...botKeys].pop();
  if (!lastBotKey) return false;
  const bot = players.get(lastBotKey);
  console.log(`AI Bot "${bot.name}" removed (${players.size - 1} total)`);
  players.delete(lastBotKey);
  botKeys.delete(lastBotKey);
  return true;
}

function removeAllBots() {
  for (const key of botKeys) {
    players.delete(key);
  }
  botKeys.clear();
}

function computeAIInput(player) {
  const car = player.car;
  if (!car || car.finished) {
    player.input = { throttle: false, brake: false, left: false, right: false };
    return;
  }

  const segments = currentTrack.segments;
  if (!segments || segments.length === 0) return;

  const speedScale = botSpeedPercent / 100;

  // Find nearest segment
  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const dx = car.x - segments[i].x;
    const dz = car.z - segments[i].z;
    const dist = dx * dx + dz * dz;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }

  const lookAhead = player.aiConfig.lookAhead;
  const targetIdx = (nearestIdx + lookAhead) % segments.length;
  const target = segments[targetIdx];

  // Desired angle to target
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const desiredAngle = Math.atan2(dx, dz);

  // Angle difference normalized to [-PI, PI]
  let angleDiff = desiredAngle - car.angle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  const threshold = player.aiConfig.steerThreshold;

  // Cap target speed based on slider (10-100%)
  const topSpeedTarget = CAR_SPECS[car.carType].topSpeed * speedScale;

  const absAngleDiff = Math.abs(angleDiff);
  const bigTurn = absAngleDiff > 0.6;

  // Corner-speed awareness: only slow significantly for sharp turns
  // Small angles (< 0.3 rad) -> full speed. Large angles (> 0.8) -> 50% speed.
  const cornerSpeedFactor = Math.max(0.5, 1 - Math.max(0, absAngleDiff - 0.3) * 0.8);
  const cornerSpeedTarget = topSpeedTarget * cornerSpeedFactor;

  player.input.throttle = car.speed < cornerSpeedTarget;
  player.input.brake = (bigTurn && car.speed > 20) || (car.speed > cornerSpeedTarget * 1.3);
  player.input.left = angleDiff > threshold;
  player.input.right = angleDiff < -threshold;
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const [ws] of players) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function broadcastLobby() {
  broadcast({ type: 'lobby', players: getPlayerList(), phase: gamePhase, trackPlaylist });
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
      steerAngle: p.car.steerAngle || 0,
      collisionForce: p.car.collisionForce || 0,
    });
    // Reset after reading so next broadcast only captures new collisions
    p.car.collisionForce = 0;
  }
  return playerStates;
}

function selectNewTrack() {
  if (trackPlaylist.length > 0 && playlistIndex < trackPlaylist.length) {
    currentTrackKey = trackPlaylist[playlistIndex];
  } else {
    currentTrackKey = getRandomTrackKey();
  }
  currentTrack = buildTrack(currentTrackKey);
  console.log(`Selected track: ${currentTrack.name} (${playlistIndex + 1}/${trackPlaylist.length || 'random'})`);
  return currentTrack;
}

function startCountdown() {
  // Only reset playlist index when starting from lobby
  if (gamePhase === 'lobby') {
    playlistIndex = 0;
  }
  gamePhase = 'countdown';
  countdownTimer = COUNTDOWN_SECONDS;

  // Select track for this race (from playlist or random)
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
  let firstFinishSent = false;
  broadcast({ type: 'raceStart' });

  const dt = 1 / TICK_RATE;
  gameLoopInterval = setInterval(() => {
    if (gamePhase === 'paused') return;
    raceTime += dt;

    // Compute AI inputs before physics (bots + autopilot players)
    for (const [, p] of players) {
      if (p.isBot || p.autopilot) computeAIInput(p);
    }

    const allCars = [];
    for (const [, p] of players) if (p.car) allCars.push(p.car);

    for (const [, p] of players) {
      if (!p.car) continue;
      updateCar(p.car, p.input, dt, allCars, currentTrack);
    }

    // Detect first player to finish
    if (!firstFinishSent) {
      for (const [, p] of players) {
        if (p.car && p.car.finished) {
          firstFinishSent = true;
          broadcast({ type: 'firstFinish', playerId: p.id, name: p.name });
          break;
        }
      }
    }

    let allFinished = true;
    for (const [, p] of players) {
      if (!p.car || !p.car.finished) { allFinished = false; break; }
    }
    if (allFinished && players.size > 0) endRace();
  }, 1000 / TICK_RATE);

  broadcastInterval = setInterval(() => {
    if (gamePhase === 'paused') return;
    broadcast({ type: 'raceState', players: getRaceState(), raceTime });
  }, 1000 / BROADCAST_RATE);
}

function endRace() {
  gamePhase = 'results';
  clearInterval(gameLoopInterval);
  clearInterval(broadcastInterval);

  // Reset ready state for all players (bots stay ready)
  for (const [, p] of players) {
    p.ready = !!p.isBot;
  }

  const results = getRaceState()
    .sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.lap - a.lap;
    })
    .map((p, i) => ({ ...p, position: i + 1 }));

  playlistIndex++;
  const hasMoreRaces = trackPlaylist.length > 0 && playlistIndex < trackPlaylist.length;

  broadcast({
    type: 'raceEnd',
    results,
    raceNumber: playlistIndex,
    totalRaces: trackPlaylist.length,
    hasMoreRaces,
  });

  // No auto-timeout — wait for all players to press Ready
}

function proceedFromResults() {
  if (gamePhase !== 'results') return;
  clearTimeout(resultsTimeout);
  resultsTimeout = null;

  const hasMoreRaces = trackPlaylist.length > 0 && playlistIndex < trackPlaylist.length;

  if (hasMoreRaces) {
    // Auto-start next race in playlist
    for (const [, p] of players) {
      p.car = null;
    }
    startCountdown();
  } else {
    // Return to lobby
    gamePhase = 'lobby';
    playlistIndex = 0;
    for (const [, p] of players) {
      p.ready = p.isBot ? true : false;
      p.car = null;
    }
    broadcastLobby();
  }
}

function resetGame() {
  clearInterval(gameLoopInterval);
  clearInterval(broadcastInterval);
  clearTimeout(resultsTimeout);
  resultsTimeout = null;
  gamePhase = 'lobby';
  raceTime = 0;
  playlistIndex = 0;
  trackPlaylist = [];
  botSpeedPercent = 100;
  for (const [, p] of players) { p.ready = !!p.isBot; p.car = null; p.autopilot = false; }
}

wss.on('connection', (ws) => {
  const playerId = nextPlayerId++;

  const player = {
    id: playerId, name: `Player ${playerId}`, carType: 'general',
    ready: false, color: getUnusedColor(),
    input: { throttle: false, brake: false, left: false, right: false },
    car: null,
    autopilot: false,
    aiConfig: {
      lookAhead: 8 + Math.floor(Math.random() * 7),
      steerThreshold: 0.03 + Math.random() * 0.04,
    },
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
        // Try to assign preferred color if available (any valid hex color)
        if (msg.preferredColor && isValidHexColor(msg.preferredColor)) {
          const usedColors = new Set();
          for (const [, p] of players) if (p !== player) usedColors.add(p.color);
          if (!usedColors.has(msg.preferredColor)) {
            player.color = msg.preferredColor;
          }
        }
        ws.send(JSON.stringify({ type: 'colorAssigned', color: player.color }));
        broadcastLobby();
        break;
      case 'changeName':
        if (gamePhase === 'lobby' && msg.name) {
          player.name = String(msg.name).slice(0, 20);
          broadcastLobby();
        }
        break;
      case 'changeColor':
        if (gamePhase === 'lobby' && isValidHexColor(msg.color)) {
          const usedColors = new Set();
          for (const [, p] of players) if (p !== player) usedColors.add(p.color);
          if (!usedColors.has(msg.color)) {
            player.color = msg.color;
            ws.send(JSON.stringify({ type: 'colorAssigned', color: player.color }));
            broadcastLobby();
          }
        }
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
        } else if (gamePhase === 'results') {
          player.ready = !player.ready;
          // Check if all players are ready to skip the wait
          let allReady = true;
          for (const [, p] of players) { if (!p.ready) { allReady = false; break; } }
          if (allReady) proceedFromResults();
        }
        break;
      case 'trackAdd':
        if (gamePhase === 'lobby' && TRACK_KEYS_SET.has(msg.trackKey)) {
          trackPlaylist.push(msg.trackKey);
          broadcastLobby();
        }
        break;
      case 'trackRemove':
        if (gamePhase === 'lobby' && typeof msg.index === 'number' &&
            msg.index >= 0 && msg.index < trackPlaylist.length) {
          trackPlaylist.splice(msg.index, 1);
          broadcastLobby();
        }
        break;
      case 'trackClear':
        if (gamePhase === 'lobby') {
          trackPlaylist = [];
          broadcastLobby();
        }
        break;
      case 'botSpeed':
        if (typeof msg.speed === 'number' && msg.speed >= 10 && msg.speed <= 100) {
          botSpeedPercent = msg.speed;
        }
        break;
      case 'addBot':
        if (addBot()) broadcastLobby();
        break;
      case 'removeBot':
        if (removeBot()) broadcastLobby();
        break;
      case 'removeBotById':
        if (gamePhase === 'lobby' && typeof msg.botId === 'number') {
          for (const key of botKeys) {
            const bot = players.get(key);
            if (bot && bot.id === msg.botId) {
              console.log(`AI Bot "${bot.name}" removed by request (${players.size - 1} total)`);
              players.delete(key);
              botKeys.delete(key);
              broadcastLobby();
              break;
            }
          }
        }
        break;
      case 'toggleAutopilot':
        player.autopilot = !player.autopilot;
        ws.send(JSON.stringify({ type: 'autopilot', enabled: player.autopilot }));
        console.log(`Player ${player.id} autopilot: ${player.autopilot}`);
        break;
      case 'pause':
        if (gamePhase === 'racing') {
          gamePhase = 'paused';
          broadcast({ type: 'paused', pausedBy: player.name });
          console.log(`Game paused by ${player.name}`);
        }
        break;
      case 'resume':
        if (gamePhase === 'paused') {
          gamePhase = 'racing';
          broadcast({ type: 'resumed' });
          console.log('Game resumed');
        }
        break;
      case 'endRace':
        if (gamePhase === 'paused' || gamePhase === 'racing') {
          endRace();
        }
        break;
      case 'backToLobby':
        if (gamePhase === 'paused' || gamePhase === 'racing') {
          resetGame();
          broadcastLobby();
        }
        break;
      case 'input':
        if (gamePhase === 'racing' && msg.input && !player.autopilot) {
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
    const humanCount = players.size - botKeys.size;
    if (humanCount === 0) {
      // No humans left — clean up everything
      removeAllBots();
      resetGame();
    } else if (gamePhase === 'lobby') {
      // Only broadcast lobby updates when in lobby
      broadcastLobby();
    }
    // During racing/countdown/results: race continues for remaining players
  });
});

server.listen(PORT, () => {
  console.log(`MultiRally server running on http://localhost:${PORT}`);
});
