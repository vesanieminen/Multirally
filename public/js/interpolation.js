// Interpolation buffer for smooth rendering between server state updates
const BUFFER_SIZE = 5;
const INTERPOLATION_DELAY = 80; // ms - how far behind real-time we render

const snapshots = [];
let renderTimestamp = 0;
let serverTimeOffset = 0;

export function pushSnapshot(players, raceTime) {
  const now = performance.now();

  snapshots.push({
    timestamp: now,
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

function lerpAngle(a, b, t) {
  // Handle angle wrapping
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function getInterpolatedState() {
  if (snapshots.length < 1) return null;

  // If only one snapshot, return it directly
  if (snapshots.length < 2) {
    return snapshots[0];
  }

  const now = performance.now();
  const renderTime = now - INTERPOLATION_DELAY;

  // Find the two snapshots to interpolate between
  let from = null;
  let to = null;

  for (let i = 0; i < snapshots.length - 1; i++) {
    if (snapshots[i].timestamp <= renderTime && snapshots[i + 1].timestamp >= renderTime) {
      from = snapshots[i];
      to = snapshots[i + 1];
      break;
    }
  }

  // If render time is ahead of all snapshots, extrapolate from last
  if (!from && !to) {
    // Use the latest snapshot
    return snapshots[snapshots.length - 1];
  }

  // Interpolation factor
  const range = to.timestamp - from.timestamp;
  const t = range > 0 ? (renderTime - from.timestamp) / range : 0;
  const clampedT = Math.max(0, Math.min(1, t));

  // Interpolate each player
  const interpolatedPlayers = [];
  for (const toP of to.players) {
    const fromP = from.players.find(p => p.id === toP.id);
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

  // Interpolate race time
  const raceTime = from.raceTime + (to.raceTime - from.raceTime) * clampedT;

  return {
    players: interpolatedPlayers,
    raceTime,
  };
}
