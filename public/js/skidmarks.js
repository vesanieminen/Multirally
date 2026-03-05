// Skidmark rendering - persistent tire marks when cars drift
import * as THREE from 'three';

const MAX_SEGMENTS = 50000;
const SKID_THRESHOLD = 0.25;
const TIRE_OFFSET = 1.8; // distance from car center to each tire track
const MARK_LENGTH = 2.5;
const MARK_WIDTH = 0.5;
const Y_OFFSET = 0.2; // above road (0.15) and kerbs (0.18)

// Colors: black tire marks on road/kerb, brown mud marks on grass
const COLOR_ROAD = { r: 0.08, g: 0.08, b: 0.08 };
const COLOR_GRASS = { r: 0.35, g: 0.22, b: 0.08 };

let nextSlot = 0;    // circular write index into geometry buffer
let slotCount = 0;   // number of filled slots (max MAX_SEGMENTS)
let mesh = null;
let geometry = null;
const lastPos = new Map(); // per-car last skid position
let trackRef = null; // reference to track data for getSurface

// Pre-allocate buffer geometry
function createMesh() {
  geometry = new THREE.BufferGeometry();

  // Each segment = 2 tire tracks = 2 quads = 4 triangles = 12 vertices
  const maxVerts = MAX_SEGMENTS * 12;
  const positions = new Float32Array(maxVerts * 3);
  const colors = new Float32Array(maxVerts * 3);
  const alphas = new Float32Array(maxVerts);

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float alpha;
      attribute vec3 color;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = alpha;
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, vAlpha * 0.7);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

function addQuad(positions, colors, alphas, offset, cx, cz, angle, opacity, color) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = MARK_WIDTH * 0.5;
  const hl = MARK_LENGTH * 0.5;

  // 4 corners of the quad (local space then rotated)
  const corners = [
    { lx: -hw, lz: -hl },
    { lx:  hw, lz: -hl },
    { lx:  hw, lz:  hl },
    { lx: -hw, lz:  hl },
  ];

  const worldCorners = corners.map(c => ({
    x: cx + c.lx * cos - c.lz * sin,
    z: cz + c.lx * sin + c.lz * cos,
  }));

  // Two triangles: 0-1-2, 0-2-3
  const indices = [0, 1, 2, 0, 2, 3];
  for (let i = 0; i < 6; i++) {
    const vi = offset + i;
    const c = worldCorners[indices[i]];
    positions[vi * 3] = c.x;
    positions[vi * 3 + 1] = Y_OFFSET;
    positions[vi * 3 + 2] = c.z;
    colors[vi * 3] = color.r;
    colors[vi * 3 + 1] = color.g;
    colors[vi * 3 + 2] = color.b;
    alphas[vi] = opacity;
  }
}

// Write a single segment into a specific geometry slot (O(1) per segment)
function writeSegmentSlot(slot, x, z, angle, opacity, color) {
  const posAttr = geometry.getAttribute('position');
  const colorAttr = geometry.getAttribute('color');
  const alphaAttr = geometry.getAttribute('alpha');

  const vertOffset = slot * 12; // 12 vertices per segment (2 quads × 6)
  const cos90 = Math.cos(angle + Math.PI * 0.5);
  const sin90 = Math.sin(angle + Math.PI * 0.5);

  // Left tire
  const lx = x + cos90 * TIRE_OFFSET;
  const lz = z + sin90 * TIRE_OFFSET;
  addQuad(posAttr.array, colorAttr.array, alphaAttr.array, vertOffset, lx, lz, angle, opacity, color);

  // Right tire
  const rx = x - cos90 * TIRE_OFFSET;
  const rz = z - sin90 * TIRE_OFFSET;
  addQuad(posAttr.array, colorAttr.array, alphaAttr.array, vertOffset + 6, rx, rz, angle, opacity, color);
}

export function initSkidmarks(scene, track) {
  if (mesh) {
    scene.remove(mesh);
  }
  nextSlot = 0;
  slotCount = 0;
  lastPos.clear();
  if (track) trackRef = track;
  const m = createMesh();
  scene.add(m);
  return m;
}

export function setTrack(track) {
  trackRef = track;
}

export function updateSkidmarks(players) {
  if (!geometry) return;

  let added = false;

  for (const p of players) {
    if ((p.skidIntensity || 0) > SKID_THRESHOLD) {
      // Avoid duplicate marks at same position (per car)
      const last = lastPos.get(p.id);
      if (last) {
        const dx = p.x - last.x;
        const dz = p.z - last.z;
        if (dx * dx + dz * dz < 0.5) continue; // ~4 unit min gap
      }

      // Determine color based on surface
      let color = COLOR_ROAD;
      if (trackRef) {
        const surface = trackRef.getSurface(p.x, p.z);
        if (surface === 'grass') color = COLOR_GRASS;
      }

      // Write directly to geometry slot — O(1), no array rebuilds
      writeSegmentSlot(nextSlot, p.x, p.z, p.angle, Math.min(p.skidIntensity, 1), color);

      nextSlot = (nextSlot + 1) % MAX_SEGMENTS;
      if (slotCount < MAX_SEGMENTS) slotCount++;

      lastPos.set(p.id, { x: p.x, z: p.z });
      added = true;
    }
  }

  if (added) {
    const posAttr = geometry.getAttribute('position');
    const colorAttr = geometry.getAttribute('color');
    const alphaAttr = geometry.getAttribute('alpha');
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    geometry.setDrawRange(0, slotCount * 12);
  }
}

export function clearSkidmarks() {
  nextSlot = 0;
  slotCount = 0;
  lastPos.clear();
  if (geometry) {
    geometry.setDrawRange(0, 0);
    const posAttr = geometry.getAttribute('position');
    const colorAttr = geometry.getAttribute('color');
    const alphaAttr = geometry.getAttribute('alpha');
    if (posAttr) posAttr.needsUpdate = true;
    if (colorAttr) colorAttr.needsUpdate = true;
    if (alphaAttr) alphaAttr.needsUpdate = true;
  }
}
