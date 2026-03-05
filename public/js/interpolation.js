// Interpolation buffer for smooth rendering between server state updates
const BUFFER_SIZE = 8;

const snapshots = [];
// Maps server raceTime to client performance.now() using a smoothed offset
let timeOffset = 0; // client_now = server_raceTime_s * 1000 + timeOffset
let offsetInitialized = false;
const OFFSET_SMOOTH = 0.05; // how fast to adjust offset (low = smoother)
const RENDER_DELAY = 80; // ms behind latest server time we render

export function pushSnapshot(players, raceTime) {
  const now = performance.now();
  const serverTimeMs = raceTime * 1000;

  // Compute/update the mapping from server time to client time
  const measuredOffset = now - serverTimeMs;
  if (!offsetInitialized) {
    timeOffset = measuredOffset;
    offsetInitialized = true;
  } else {
    // Smoothly adjust to avoid jumps
    timeOffset += (measuredOffset - timeOffset) * OFFSET_SMOOTH;
  }

  snapshots.push({
    serverTime: serverTimeMs,
    raceTime,
    players: players.map(p => ({
      id: p.id,
      x: p.x,
      z: p.z,
      angle: p.angle,
      speed: p.speed,
      lap: p.lap,
      lapTime: p.lapTime,
      bestLap: p.bestLap,
      finished: p.finished,
      finishTime: p.finishTime,
      color: p.color,
      name: p.name,
      carType: p.carType,
      nextCheckpoint: p.nextCheckpoint,
      skidIntensity: p.skidIntensity || 0,
      steerAngle: p.steerAngle || 0,
    })),
  });

  // Keep buffer trimmed
  while (snapshots.length > BUFFER_SIZE) {
    snapshots.shift();
  }
}

export function resetInterpolation() {
  snapshots.length = 0;
  offsetInitialized = false;
  timeOffset = 0;
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function getInterpolatedState() {
  if (snapshots.length < 1) return null;

  if (snapshots.length < 2) {
    return snapshots[0];
  }

  // Convert current client time to server time, then subtract render delay
  const now = performance.now();
  const renderServerTime = (now - timeOffset) - RENDER_DELAY;

  // Find the two snapshots to interpolate between (using server time)
  let from = null;
  let to = null;

  for (let i = 0; i < snapshots.length - 1; i++) {
    if (snapshots[i].serverTime <= renderServerTime && snapshots[i + 1].serverTime >= renderServerTime) {
      from = snapshots[i];
      to = snapshots[i + 1];
      break;
    }
  }

  // If render time is ahead of all snapshots, use the latest
  if (!from && !to) {
    return snapshots[snapshots.length - 1];
  }

  // Interpolation factor based on server time (evenly spaced)
  const range = to.serverTime - from.serverTime;
  const t = range > 0 ? (renderServerTime - from.serverTime) / range : 0;
  const clampedT = Math.max(0, Math.min(1, t));

  // Build lookup map for O(1) access instead of O(n) find() per player
  const fromMap = new Map();
  for (const p of from.players) fromMap.set(p.id, p);

  // Interpolate each player
  const interpolatedPlayers = [];
  for (const toP of to.players) {
    const fromP = fromMap.get(toP.id);
    if (!fromP) {
      interpolatedPlayers.push(toP);
      continue;
    }

    interpolatedPlayers.push({
      ...toP,
      x: fromP.x + (toP.x - fromP.x) * clampedT,
      z: fromP.z + (toP.z - fromP.z) * clampedT,
      angle: lerpAngle(fromP.angle, toP.angle, clampedT),
      speed: fromP.speed + (toP.speed - fromP.speed) * clampedT,
      skidIntensity: (fromP.skidIntensity || 0) + ((toP.skidIntensity || 0) - (fromP.skidIntensity || 0)) * clampedT,
      steerAngle: (fromP.steerAngle || 0) + ((toP.steerAngle || 0) - (fromP.steerAngle || 0)) * clampedT,
    });
  }

  const raceTime = from.raceTime + (to.raceTime - from.raceTime) * clampedT;

  return {
    players: interpolatedPlayers,
    raceTime,
  };
}
