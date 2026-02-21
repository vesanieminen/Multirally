import { TOTAL_LAPS } from './constants.js';

// ============================================================
// Track system using distance-from-centerline for surface detection
// (robust, no polygon winding issues)
// ============================================================

// Seeded RNG (deterministic) - shared by server and client
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function bezier(p0, p1, p2, p3, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    pts.push({
      x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
      z: mt*mt*mt*p0.z + 3*mt*mt*t*p1.z + 3*mt*t*t*p2.z + t*t*t*p3.z,
    });
  }
  return pts;
}

// Generate an elliptical loop
function ovalTrack(cx, cz, rx, rz, numPoints) {
  const pts = [];
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(angle) * rx, z: cz + Math.sin(angle) * rz });
  }
  return pts;
}

// Smooth a set of control points into a closed loop using Catmull-Rom style
function smoothLoop(controlPts, pointsPerSegment) {
  const n = controlPts.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    const p0 = controlPts[(i - 1 + n) % n];
    const p1 = controlPts[i];
    const p2 = controlPts[(i + 1) % n];
    const p3 = controlPts[(i + 2) % n];
    // Convert Catmull-Rom to cubic bezier
    const b1 = { x: p1.x + (p2.x - p0.x) / 6, z: p1.z + (p2.z - p0.z) / 6 };
    const b2 = { x: p2.x - (p3.x - p1.x) / 6, z: p2.z - (p3.z - p1.z) / 6 };
    const seg = bezier(p1, b1, b2, p2, pointsPerSegment);
    // Skip last point to avoid duplicates
    for (let j = 0; j < seg.length - 1; j++) {
      result.push(seg[j]);
    }
  }
  return result;
}

// ============================================================
// Track Definitions
// ============================================================

const TRACK_DEFS = {
  oval: {
    name: 'Simple Oval',
    width: 45,
    buildCenterline() {
      return ovalTrack(0, 0, 180, 120, 80);
    },
  },

  wideOval: {
    name: 'Wide Oval',
    width: 55,
    buildCenterline() {
      return ovalTrack(0, 0, 200, 100, 80);
    },
  },

  figure8: {
    name: 'Figure Eight',
    width: 45,
    buildCenterline() {
      // Lemniscate-like shape
      const pts = [];
      const numPoints = 120;
      const scale = 170;
      for (let i = 0; i < numPoints; i++) {
        const t = (i / numPoints) * Math.PI * 2;
        // Lemniscate of Bernoulli parametric form
        const denom = 1 + Math.sin(t) * Math.sin(t);
        pts.push({
          x: scale * Math.cos(t) / denom * 1.3,
          z: scale * Math.sin(t) * Math.cos(t) / denom * 1.3,
        });
      }
      return pts;
    },
  },

  triOval: {
    name: 'Tri-Turn',
    width: 48,
    buildCenterline() {
      // Triangle with rounded corners
      const control = [
        { x: 0, z: -140 },      // top
        { x: 170, z: 110 },     // bottom right
        { x: -170, z: 110 },    // bottom left
      ];
      return smoothLoop(control, 30);
    },
  },

  quadOval: {
    name: 'Quad Circuit',
    width: 45,
    buildCenterline() {
      // Rectangle with rounded corners
      const control = [
        { x: -160, z: -100 },   // top-left
        { x: 160, z: -100 },    // top-right
        { x: 160, z: 100 },     // bottom-right
        { x: -160, z: 100 },    // bottom-left
      ];
      return smoothLoop(control, 25);
    },
  },

  kidney: {
    name: 'Kidney Bean',
    width: 48,
    buildCenterline() {
      // Bean / kidney shape
      const control = [
        { x: -150, z: 0 },
        { x: -80, z: -130 },
        { x: 80, z: -100 },
        { x: 160, z: 0 },
        { x: 80, z: 130 },
        { x: -20, z: 60 },
      ];
      return smoothLoop(control, 20);
    },
  },

  peanut: {
    name: 'Peanut Loop',
    width: 50,
    buildCenterline() {
      // Double-bulge shape
      const pts = [];
      const numPoints = 100;
      for (let i = 0; i < numPoints; i++) {
        const t = (i / numPoints) * Math.PI * 2;
        const r = 120 + 50 * Math.cos(2 * t);
        pts.push({
          x: r * Math.cos(t),
          z: r * Math.sin(t) * 0.8,
        });
      }
      return pts;
    },
  },
};

const TRACK_KEYS = Object.keys(TRACK_DEFS);

// ============================================================
// Build a track from a definition
// ============================================================

function buildTrack(defKey) {
  const def = TRACK_DEFS[defKey];
  const centerline = def.buildCenterline();
  const roadWidth = def.width;
  const kerbExtra = 4;

  // Compute segments with normals and directions
  const segments = [];
  const n = centerline.length;
  for (let i = 0; i < n; i++) {
    const curr = centerline[i];
    const next = centerline[(i + 1) % n];
    const dx = next.x - curr.x;
    const dz = next.z - curr.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) continue;
    const nx = -dz / len;
    const nz = dx / len;
    segments.push({
      x: curr.x, z: curr.z,
      nx, nz,
      dirX: dx / len, dirZ: dz / len,
      width: roadWidth,
    });
  }

  // Checkpoints: evenly spaced around the track
  const numCheckpoints = 6;
  const checkpoints = [];
  const step = Math.floor(segments.length / numCheckpoints);
  for (let i = 0; i < numCheckpoints; i++) {
    const s = segments[i * step];
    checkpoints.push({
      x: s.x, z: s.z,
      nx: s.nx, nz: s.nz,
      width: roadWidth + 20,
    });
  }

  // Starting grid: near the first segment
  const startGrid = [];
  for (let i = 0; i < 6; i++) {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const segIdx = Math.min(2 + row * 4, segments.length - 1);
    const s = segments[segIdx];
    const offset = (col === 0 ? -1 : 1) * (roadWidth * 0.15);
    startGrid.push({
      x: s.x + s.nx * offset,
      z: s.z + s.nz * offset,
      angle: Math.atan2(s.dirX, s.dirZ),
    });
  }

  // ---- Surface detection: distance from nearest centerline segment ----
  function getSurface(px, pz) {
    let minDist = Infinity;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const next = segments[(i + 1) % segments.length];
      // Vector from segment start to point
      const apx = px - s.x;
      const apz = pz - s.z;
      // Segment vector
      const abx = next.x - s.x;
      const abz = next.z - s.z;
      const abLen2 = abx * abx + abz * abz;
      if (abLen2 < 0.0001) continue;
      // Project point onto segment line, clamp to [0, 1]
      let t = (apx * abx + apz * abz) / abLen2;
      t = Math.max(0, Math.min(1, t));
      // Closest point on segment
      const cx = s.x + abx * t;
      const cz = s.z + abz * t;
      const dx = px - cx;
      const dz = pz - cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < minDist) minDist = dist;
    }
    const halfRoad = roadWidth / 2;
    if (minDist <= halfRoad) return 'road';
    if (minDist <= halfRoad + kerbExtra) return 'kerb';
    // Check island bounds
    const bounds = getTrackBounds(segments, roadWidth);
    const margin = 40;
    if (px >= bounds.minX - margin && px <= bounds.maxX + margin &&
        pz >= bounds.minZ - margin && pz <= bounds.maxZ + margin) {
      return 'grass';
    }
    return 'water';
  }

  function checkCheckpoint(car, checkpoint) {
    const dx = car.x - checkpoint.x;
    const dz = car.z - checkpoint.z;
    const dot = dx * checkpoint.nx + dz * checkpoint.nz;
    const perpDist = Math.abs(-dx * checkpoint.nz + dz * checkpoint.nx);
    return Math.abs(dot) < checkpoint.width / 2 && perpDist < 12;
  }

  const bounds = getTrackBounds(segments, roadWidth);
  const margin = 50;
  const islandBounds = {
    minX: bounds.minX - margin,
    maxX: bounds.maxX + margin,
    minZ: bounds.minZ - margin,
    maxZ: bounds.maxZ + margin,
  };

  // Generate obstacles (deterministic, shared by server and client)
  const obstacles = generateObstacles(segments, roadWidth, islandBounds, getSurface);

  return {
    name: def.name,
    centerline,
    segments,
    checkpoints,
    startGrid,
    totalLaps: TOTAL_LAPS,
    roadWidth,
    kerbExtra,
    getSurface,
    checkCheckpoint,
    bounds,
    islandBounds,
    obstacles,
  };
}

function generateObstacles(segments, roadWidth, islandBounds, getSurface) {
  const ib = islandBounds;
  const rng = mulberry32(42);

  // --- Trees ---
  const trees = [];
  const numTrees = 20;
  for (let i = 0; i < numTrees * 3; i++) {
    const x = ib.minX + rng() * (ib.maxX - ib.minX);
    const z = ib.minZ + rng() * (ib.maxZ - ib.minZ);
    if (getSurface(x, z) === 'grass') {
      const scale = 0.5 + rng() * 0.5;
      trees.push({ x, z, radius: 3 * scale, scale });
      if (trees.length >= numTrees) break;
    }
  }

  // --- Grandstands ---
  const grandstands = [];
  const numGrandstands = 4;
  const gsWidth = 30, gsDepth = 15;
  for (let i = 0; i < numGrandstands; i++) {
    const segIdx = Math.floor(segments.length / numGrandstands * i);
    const s = segments[segIdx];
    const dist = roadWidth / 2 + 40;
    const side = (i % 2 === 0) ? 1 : -1;
    const gx = s.x + s.nx * dist * side;
    const gz = s.z + s.nz * dist * side;
    if (getSurface(gx, gz) === 'grass') {
      grandstands.push({
        x: gx, z: gz,
        angle: Math.atan2(s.dirX, s.dirZ),
        halfW: gsWidth / 2,
        halfD: gsDepth / 2,
      });
    }
  }

  return { trees, grandstands };
}

function getTrackBounds(segs, roadWidth) {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  const hw = roadWidth / 2 + 10;
  for (const s of segs) {
    minX = Math.min(minX, s.x - hw);
    maxX = Math.max(maxX, s.x + hw);
    minZ = Math.min(minZ, s.z - hw);
    maxZ = Math.max(maxZ, s.z + hw);
  }
  return { minX, maxX, minZ, maxZ };
}

// ============================================================
// Select a random track
// ============================================================

function getRandomTrackKey() {
  return TRACK_KEYS[Math.floor(Math.random() * TRACK_KEYS.length)];
}

// Build default track (will be replaced each race)
let currentTrackKey = getRandomTrackKey();
let track = buildTrack(currentTrackKey);

export { track, buildTrack, getRandomTrackKey, TRACK_KEYS, TRACK_DEFS };
