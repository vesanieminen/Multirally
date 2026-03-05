import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { TICK_RATE, BROADCAST_RATE, COUNTDOWN_SECONDS, TOTAL_LAPS, CAR_SPECS, PLAYER_COLORS } from './shared/constants.js';
import { updateCar, createCarState, resolveCarCollisions, setPhysicsSettings, getPhysicsSettings } from './shared/physics.js';
import { track, buildTrack, getRandomTrackKey, TRACK_KEYS, registerCustomTrack, removeCustomTrack } from './shared/track.js';
let TRACK_KEYS_SET = new Set(TRACK_KEYS);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// --- Lap records persistence ---
const RECORDS_FILE = path.join(process.env.DATA_DIR || __dirname, 'data', 'records.json');

function loadRecords() {
  try {
    const data = fs.readFileSync(RECORDS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {}; // no records yet
  }
}

function saveRecords() {
  try {
    const dir = path.dirname(RECORDS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(lapRecords, null, 2));
  } catch (e) {
    console.error('Failed to save records:', e.message);
  }
}

// { trackKey: { time, name, carType, date } }
const lapRecords = loadRecords();

// --- Custom tracks persistence ---
const CUSTOM_TRACKS_FILE = path.join(process.env.DATA_DIR || __dirname, 'data', 'custom-tracks.json');
let customTracksData = {};

function loadCustomTracksFromDisk() {
  try {
    customTracksData = JSON.parse(fs.readFileSync(CUSTOM_TRACKS_FILE, 'utf8'));
    for (const [key, data] of Object.entries(customTracksData)) {
      registerCustomTrack(key, data);
    }
    TRACK_KEYS_SET = new Set(TRACK_KEYS);
  } catch { /* no custom tracks yet */ }
}

function saveCustomTracks() {
  try {
    const dir = path.dirname(CUSTOM_TRACKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CUSTOM_TRACKS_FILE, JSON.stringify(customTracksData, null, 2));
  } catch (e) {
    console.error('Failed to save custom tracks:', e.message);
  }
}

loadCustomTracksFromDisk();

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
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);

  // --- API: Custom tracks ---
  if (parsedUrl.pathname === '/api/tracks') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(customTracksData));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { key, track: trackData } = JSON.parse(body);
          if (!key || !trackData || !trackData.controlPoints?.length) {
            res.writeHead(400); res.end('Invalid track data'); return;
          }
          customTracksData[key] = trackData;
          registerCustomTrack(key, trackData);
          TRACK_KEYS_SET = new Set(TRACK_KEYS);
          saveCustomTracks();
          broadcast({ type: 'customTracks', tracks: customTracksData });
          if (gamePhase === 'lobby') broadcastLobby();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400); res.end('Bad JSON');
        }
      });
      return;
    }
    if (req.method === 'DELETE') {
      const key = parsedUrl.searchParams.get('key');
      if (key && customTracksData[key]) {
        delete customTracksData[key];
        removeCustomTrack(key);
        TRACK_KEYS_SET = new Set(TRACK_KEYS);
        saveCustomTracks();
        broadcast({ type: 'customTracks', tracks: customTracksData });
        if (gamePhase === 'lobby') broadcastLobby();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404); res.end('Track not found');
      }
      return;
    }
  }

  // --- Static files ---
  let filePath;
  if (parsedUrl.pathname.startsWith('/shared/')) {
    filePath = path.join(__dirname, parsedUrl.pathname);
  } else {
    filePath = path.join(__dirname, 'public', parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);
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
let countdownInterval = null;
let resultsTimeout = null;
let nextPlayerId = 1;
let currentTrack = track; // starts with random default
let currentTrackKey = null;
let trackPlaylist = [];       // ordered list of track keys for multi-race
let playlistIndex = 0;        // current race index in the playlist
let botSpeedPercent = 100;    // AI speed scaling (10-100%)
let lapCount = TOTAL_LAPS;    // configurable lap count (1-20)
let championshipPoints = new Map(); // playerId -> { name, color, points, wins }

// Points awarded by finishing position (F1-style)
const POINTS_TABLE = [10, 6, 3, 0];

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
    list.push({ id: p.id, name: p.name, carType: p.carType, ready: p.ready, color: p.color, isBot: !!p.isBot, spectator: !!p.spectator });
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

function findNearestSegment(segments, x, z) {
  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const dx = x - segments[i].x;
    const dz = z - segments[i].z;
    const dist = dx * dx + dz * dz;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }
  return nearestIdx;
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
  const n = segments.length;

  // Initialize AI segment index if not set (full scan on first call)
  if (car.aiSegmentIdx == null) {
    car.aiSegmentIdx = findNearestSegment(segments, car.x, car.z);
  }

  // Search only within ±searchRange of current segment (prevents jumping
  // to the wrong loop on self-crossing tracks like figure-8)
  const searchRange = 30;
  let nearestIdx = car.aiSegmentIdx;
  let nearestDist = Infinity;
  for (let offset = -searchRange; offset <= searchRange; offset++) {
    const i = ((car.aiSegmentIdx + offset) % n + n) % n;
    const dx = car.x - segments[i].x;
    const dz = car.z - segments[i].z;
    const dist = dx * dx + dz * dz;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }

  // Update tracked position
  car.aiSegmentIdx = nearestIdx;

  const lookAhead = player.aiConfig.lookAhead;
  const targetIdx = (nearestIdx + lookAhead) % n;
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

const MAX_BUFFERED = 64 * 1024; // 64KB — skip slow clients to prevent memory buildup

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const [ws] of players) {
    if (ws.readyState === 1 && ws.bufferedAmount < MAX_BUFFERED) {
      ws.send(data);
    }
  }
}

function broadcastLobby() {
  broadcast({ type: 'lobby', players: getPlayerList(), phase: gamePhase, trackPlaylist, lapCount });
}

function getRaceState() {
  const playerStates = [];
  for (const [, p] of players) {
    if (!p.car) continue;
    playerStates.push({
      id: p.id, x: p.car.x, z: p.car.z, angle: p.car.angle,
      speed: p.car.speed, lap: p.car.lap, lapTime: p.car.lapTime,
      bestLap: p.car.bestLap, lapTimes: p.car.lapTimes, finished: p.car.finished, finishTime: p.car.finishTime,
      color: p.color, name: p.name, carType: p.carType, isBot: !!p.isBot, nextCheckpoint: p.car.nextCheckpoint,
      lapsDown: p.car.lapsDown || 0,
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
  currentTrack.totalLaps = lapCount;
  console.log(`Selected track: ${currentTrack.name} (${playlistIndex + 1}/${trackPlaylist.length || 'random'}, ${lapCount} laps)`);
  return currentTrack;
}

function startCountdown() {
  // Only reset playlist index and championship when starting from lobby
  if (gamePhase === 'lobby') {
    playlistIndex = 0;
    championshipPoints.clear();
  }
  gamePhase = 'countdown';
  countdownTimer = COUNTDOWN_SECONDS;

  // Select track for this race (from playlist or random)
  selectNewTrack();

  // Tell clients which track to render (include lap record if any)
  broadcast({
    type: 'trackInfo',
    trackKey: currentTrackKey,
    trackName: currentTrack.name,
    totalLaps: lapCount,
    trackRecord: lapRecords[currentTrackKey] || null,
  });

  // Place cars on starting grid (skip spectators)
  // Sort racers by championship points (leader gets pole position)
  const racers = [];
  for (const [, p] of players) {
    if (p.spectator) { p.car = null; continue; }
    racers.push(p);
  }
  if (championshipPoints.size > 0) {
    racers.sort((a, b) => {
      const ptsA = championshipPoints.get(a.id)?.points || 0;
      const ptsB = championshipPoints.get(b.id)?.points || 0;
      return ptsB - ptsA; // highest points first (pole position)
    });
  }
  for (let gridIndex = 0; gridIndex < racers.length; gridIndex++) {
    const p = racers[gridIndex];
    const gridPos = currentTrack.startGrid[gridIndex] || { x: 0, z: 0, angle: 0 };
    p.car = createCarState(p.carType, gridPos.x, gridPos.z, gridPos.angle);
  }

  broadcast({ type: 'countdown', seconds: countdownTimer });
  broadcast({ type: 'raceState', players: getRaceState(), raceTime: 0 });

  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
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
  clearInterval(countdownInterval);
  countdownInterval = null;
  gamePhase = 'racing';
  raceTime = 0;
  let firstFinishSent = false;
  broadcast({ type: 'raceStart' });

  const fixedDt = 1 / TICK_RATE;
  const broadcastEveryNTicks = Math.round(TICK_RATE / BROADCAST_RATE);
  let ticksSinceBroadcast = 0;
  let lastTickTime = performance.now();
  let accumulator = 0;
  gameLoopInterval = setInterval(() => {
    if (gamePhase === 'paused') { lastTickTime = performance.now(); return; }
    const now = performance.now();
    accumulator += (now - lastTickTime) / 1000;
    lastTickTime = now;
    // Cap accumulator to avoid spiral of death (e.g. after breakpoint/sleep)
    if (accumulator > 0.1) accumulator = 0.1;
    while (accumulator >= fixedDt) {
    raceTime += fixedDt;

    // Compute AI inputs before physics (bots + autopilot players)
    for (const [, p] of players) {
      if (p.isBot || p.autopilot) computeAIInput(p);
    }

    const allCars = [];
    for (const [, p] of players) if (p.car) allCars.push(p.car);

    // Save lap counts before physics (for lapped car detection)
    const prevLaps = firstFinishSent ? allCars.map(c => c.lap) : null;

    for (const [, p] of players) {
      if (!p.car) continue;
      updateCar(p.car, p.input, fixedDt, currentTrack);
    }

    // Resolve car-to-car collisions after all cars have updated
    resolveCarCollisions(allCars);

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

    // Lapped cars: after leader finishes, they only need to complete their current lap
    if (prevLaps) {
      for (let i = 0; i < allCars.length; i++) {
        const car = allCars[i];
        if (!car.finished && car.lap > prevLaps[i] && car.lap < currentTrack.totalLaps) {
          // This lapped car just crossed the finish line — finish them
          car.finished = true;
          car.finishTime = car.totalTime;
          car.lapsDown = currentTrack.totalLaps - car.lap;
        }
      }
    }

    let allFinished = true;
    let racerCount = 0;
    for (const [, p] of players) {
      if (p.spectator || !p.car) continue;
      racerCount++;
      if (!p.car.finished) { allFinished = false; break; }
    }
    if (racerCount > 0 && allFinished) endRace();

    // Broadcast state at controlled rate, always after a complete physics step
    ticksSinceBroadcast++;
    if (ticksSinceBroadcast >= broadcastEveryNTicks) {
      ticksSinceBroadcast = 0;
      broadcast({ type: 'raceState', players: getRaceState(), raceTime });
    }

    accumulator -= fixedDt;
    } // end while
  }, 1000 / TICK_RATE);
}

function endRace() {
  gamePhase = 'results';
  clearInterval(gameLoopInterval);
  clearInterval(broadcastInterval);
  clearInterval(countdownInterval);
  countdownInterval = null;

  // Reset ready state for all players (bots stay ready)
  for (const [, p] of players) {
    p.ready = !!p.isBot;
  }

  const results = getRaceState()
    .sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) {
        // Fewer laps down = better position
        if (a.lapsDown !== b.lapsDown) return a.lapsDown - b.lapsDown;
        return a.finishTime - b.finishTime;
      }
      return b.lap - a.lap;
    })
    .map((p, i) => {
      const pts = p.finished ? (POINTS_TABLE[i] || 0) : 0;
      return { ...p, position: i + 1, points: pts };
    });

  // Find best lap across all players and award +1 bonus point
  let bestLapId = null;
  let bestLapTime = Infinity;
  for (const r of results) {
    if (r.bestLap && r.bestLap < Infinity && r.bestLap < bestLapTime) {
      bestLapTime = r.bestLap;
      bestLapId = r.id;
    }
  }
  if (bestLapId) {
    const winner = results.find(r => r.id === bestLapId);
    if (winner) winner.points = (winner.points || 0) + 1;
  }

  // Update championship points
  const isMultiRace = trackPlaylist.length > 1;
  if (isMultiRace) {
    for (const r of results) {
      if (!championshipPoints.has(r.id)) {
        championshipPoints.set(r.id, { name: r.name, color: r.color, points: 0, wins: 0 });
      }
      const entry = championshipPoints.get(r.id);
      entry.points += r.points;
      entry.name = r.name;   // keep name/color current
      entry.color = r.color;
      if (r.position === 1 && r.finished) entry.wins++;
    }
  }

  // Check for new lap records (best overall lap time across all players)
  let newRecord = null;
  const trackKey = currentTrackKey;
  for (const r of results) {
    if (r.bestLap && r.bestLap < Infinity) {
      const current = lapRecords[trackKey];
      if (!current || !current.time || r.bestLap < current.time) {
        if (!lapRecords[trackKey]) lapRecords[trackKey] = {};
        lapRecords[trackKey].time = r.bestLap;
        lapRecords[trackKey].name = r.name;
        lapRecords[trackKey].carType = r.carType;
        lapRecords[trackKey].date = new Date().toISOString().slice(0, 10);
        newRecord = { name: r.name, time: r.bestLap, carType: r.carType };
      }
    }
  }
  if (newRecord) saveRecords();

  playlistIndex++;
  const hasMoreRaces = trackPlaylist.length > 0 && playlistIndex < trackPlaylist.length;

  // Merge current race laps into all-time top 10 for this track
  const currentRaceLaps = [];
  for (const r of results) {
    if (r.lapTimes) {
      for (let i = 0; i < r.lapTimes.length; i++) {
        currentRaceLaps.push({ name: r.name, color: r.color, carType: r.carType, time: r.lapTimes[i], date: new Date().toISOString().slice(0, 10) });
      }
    }
  }
  const storedTopLaps = (lapRecords[trackKey] && lapRecords[trackKey].topLaps) || [];
  const merged = [...storedTopLaps, ...currentRaceLaps];
  merged.sort((a, b) => a.time - b.time);
  const topLaps = merged.slice(0, 10);
  // Persist all-time top laps
  if (!lapRecords[trackKey]) lapRecords[trackKey] = {};
  const oldTop = JSON.stringify(lapRecords[trackKey].topLaps || []);
  lapRecords[trackKey].topLaps = topLaps;
  if (JSON.stringify(topLaps) !== oldTop) saveRecords();

  broadcast({
    type: 'raceEnd',
    results,
    bestLapId,
    topLaps,
    raceNumber: playlistIndex,
    totalRaces: trackPlaylist.length,
    hasMoreRaces,
    trackRecord: lapRecords[trackKey] || null,
    newRecord: newRecord ? true : false,
    championshipStandings: isMultiRace ? Object.fromEntries(championshipPoints) : null,
  });

  // Check if all non-spectator players are already ready (e.g. only bots racing)
  checkResultsReady();
}

function checkResultsReady() {
  if (gamePhase !== 'results') return;
  let racers = 0, allReady = true;
  for (const [, p] of players) {
    if (p.spectator) continue;
    racers++;
    if (!p.ready) { allReady = false; break; }
  }
  if (racers > 0 && allReady) proceedFromResults();
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
    // Series finished — send championship standings if multi-race
    const isMultiRace = trackPlaylist.length > 1;
    if (isMultiRace && championshipPoints.size > 0) {
      const standings = [...championshipPoints.values()]
        .sort((a, b) => b.points - a.points || b.wins - a.wins)
        .map((s, i) => ({ ...s, position: i + 1 }));

      gamePhase = 'championship';
      // Reset ready state for championship screen
      for (const [, p] of players) {
        p.ready = !!p.isBot;
      }
      broadcast({ type: 'championship', standings, totalRaces: trackPlaylist.length });
      championshipPoints.clear();
      // Check if all non-spectator players are already ready (bots-only)
      checkChampionshipReady();
    } else {
      returnToLobby();
    }
  }
}

function checkChampionshipReady() {
  if (gamePhase !== 'championship') return;
  let racers = 0, allReady = true;
  for (const [, p] of players) {
    if (p.spectator) continue;
    racers++;
    if (!p.ready) { allReady = false; break; }
  }
  if (racers > 0 && allReady) returnToLobby();
}

function returnToLobby() {
  gamePhase = 'lobby';
  playlistIndex = 0;
  championshipPoints.clear();
  for (const [, p] of players) {
    p.ready = p.isBot ? true : false;
    p.car = null;
    if (p.midGameSpectator) { p.spectator = false; p.midGameSpectator = false; }
  }
  broadcastLobby();
}

function resetGame() {
  clearInterval(gameLoopInterval);
  clearInterval(broadcastInterval);
  clearInterval(countdownInterval);
  clearTimeout(resultsTimeout);
  resultsTimeout = null;
  gamePhase = 'lobby';
  raceTime = 0;
  playlistIndex = 0;
  trackPlaylist = [];
  botSpeedPercent = 100;
  lapCount = TOTAL_LAPS;
  championshipPoints.clear();
  for (const [, p] of players) { p.ready = !!p.isBot; p.car = null; p.autopilot = false; if (p.midGameSpectator) { p.spectator = false; p.midGameSpectator = false; } }
}

wss.on('connection', (ws) => {
  const playerId = nextPlayerId++;

  const player = {
    id: playerId, name: `Player ${playerId}`, carType: 'general',
    ready: false, color: getUnusedColor(),
    input: { throttle: false, brake: false, left: false, right: false },
    car: null,
    spectator: false,
    autopilot: false,
    aiConfig: {
      lookAhead: 8 + Math.floor(Math.random() * 7),
      steerThreshold: 0.03 + Math.random() * 0.04,
    },
  };

  // Auto-spectate players who join mid-game
  if (gamePhase === 'racing' || gamePhase === 'countdown' || gamePhase === 'paused') {
    player.spectator = true;
    player.midGameSpectator = true;
  }

  players.set(ws, player);
  console.log(`Player ${playerId} connected (${players.size} total)${player.spectator ? ' [spectator]' : ''}`);

  ws.send(JSON.stringify({ type: 'welcome', id: playerId, color: player.color }));

  // Send current physics settings
  ws.send(JSON.stringify({ type: 'physicsSettings', settings: getPhysicsSettings() }));

  // Send custom tracks so client can build them
  if (Object.keys(customTracksData).length > 0) {
    ws.send(JSON.stringify({ type: 'customTracks', tracks: customTracksData }));
  }

  // If joining mid-game, send track info and current state so they can watch
  if (player.spectator && currentTrackKey) {
    ws.send(JSON.stringify({ type: 'trackInfo', trackKey: currentTrackKey, trackName: currentTrack.name, totalLaps: lapCount, trackRecord: lapRecords[currentTrackKey] || null }));
    ws.send(JSON.stringify({ type: 'raceState', players: getRaceState(), raceTime }));
    if (gamePhase === 'racing') {
      ws.send(JSON.stringify({ type: 'raceStart' }));
    } else if (gamePhase === 'countdown') {
      ws.send(JSON.stringify({ type: 'countdown', seconds: countdownTimer }));
    } else if (gamePhase === 'paused') {
      ws.send(JSON.stringify({ type: 'raceStart' }));
      ws.send(JSON.stringify({ type: 'paused', pausedBy: 'Someone' }));
    }
  }
  // Only broadcast lobby update when in lobby — during races the new player
  // already received race state above; broadcasting lobby would kick all
  // clients back to the menu screen.
  if (gamePhase === 'lobby') {
    broadcastLobby();
  }

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
        if (gamePhase === 'lobby') broadcastLobby();
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
          if (player.spectator) break; // In lobby, spectators use the spectate button
          player.ready = !player.ready;
          broadcastLobby();
          // Check if all non-spectator players are ready
          let racers = 0, allReady = true;
          for (const [, p] of players) {
            if (p.spectator) continue;
            racers++;
            if (!p.ready) { allReady = false; break; }
          }
          if (racers > 0 && allReady) startCountdown();
        } else if (gamePhase === 'results') {
          // Spectators readying in results means they want to join the next race
          if (player.spectator) {
            player.spectator = false;
            player.midGameSpectator = false;
          }
          player.ready = !player.ready;
          checkResultsReady();
        } else if (gamePhase === 'championship') {
          if (player.spectator) {
            player.spectator = false;
            player.midGameSpectator = false;
          }
          player.ready = !player.ready;
          checkChampionshipReady();
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
      case 'trackShuffleAll':
        if (gamePhase === 'lobby') {
          // Fisher-Yates shuffle of all track keys
          const shuffled = [...TRACK_KEYS];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          trackPlaylist = shuffled;
          broadcastLobby();
        }
        break;
      case 'botSpeed':
        if (typeof msg.speed === 'number' && msg.speed >= 10 && msg.speed <= 100) {
          botSpeedPercent = msg.speed;
        }
        break;
      case 'lapCount':
        if (gamePhase === 'lobby' && typeof msg.laps === 'number' && msg.laps >= 1 && msg.laps <= 20) {
          lapCount = Math.floor(msg.laps);
          broadcastLobby();
        }
        break;
      case 'chat':
        if (typeof msg.text === 'string' && msg.text.trim().length > 0) {
          const text = msg.text.trim().slice(0, 200);
          broadcast({ type: 'chat', name: player.name, color: player.color, text, playerId: player.id });
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
      case 'toggleSpectator':
        if (gamePhase === 'lobby') {
          player.spectator = !player.spectator;
          if (player.spectator) player.ready = false;
          broadcastLobby();
          // Re-check if all remaining non-spectator players are ready
          if (player.spectator) {
            let racersS = 0, allReadyS = true;
            for (const [, p] of players) {
              if (p.spectator) continue;
              racersS++;
              if (!p.ready) { allReadyS = false; break; }
            }
            if (racersS > 0 && allReadyS) {
              if (gamePhase === 'lobby') startCountdown();
              else if (gamePhase === 'results') proceedFromResults();
            }
          }
        }
        break;
      case 'input':
        if (gamePhase === 'racing' && msg.input && !player.autopilot && !player.spectator) {
          player.input = {
            throttle: !!msg.input.throttle, brake: !!msg.input.brake,
            left: !!msg.input.left, right: !!msg.input.right,
          };
        }
        break;
      case 'updateSettings':
        if (msg.settings && typeof msg.settings === 'object') {
          // Validate and apply each setting
          const current = getPhysicsSettings();
          for (const [key, val] of Object.entries(msg.settings)) {
            if (key in current && typeof val === 'number' && isFinite(val)) {
              current[key] = val;
            }
          }
          setPhysicsSettings(current);
          // Broadcast to all clients
          broadcast({ type: 'physicsSettings', settings: getPhysicsSettings() });
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

// Memory diagnostics — log every 30 seconds
setInterval(() => {
  const mem = process.memoryUsage();
  console.log(`[mem] RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}/${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB | Players: ${players.size} | Phase: ${gamePhase}`);
}, 30000);
