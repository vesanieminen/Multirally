// Skidmark rendering - persistent tire marks when cars drift
import * as THREE from 'three';

const MAX_SEGMENTS = 2000;
const SKID_THRESHOLD = 0.2;
const TIRE_OFFSET = 1.8; // distance from car center to each tire track
const MARK_LENGTH = 2.0;
const MARK_WIDTH = 0.4;
const Y_OFFSET = 0.16; // just above road surface

const segments = []; // {x, z, angle, opacity}
let mesh = null;
let geometry = null;
const lastPos = new Map(); // per-car last skid position

// Pre-allocate buffer geometry
function createMesh() {
  geometry = new THREE.BufferGeometry();

  // Each segment = 2 tire tracks = 2 quads = 4 triangles = 12 vertices
  const maxVerts = MAX_SEGMENTS * 12;
  const positions = new Float32Array(maxVerts * 3);
  const alphas = new Float32Array(maxVerts);

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(0.1, 0.1, 0.1, vAlpha * 0.6);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

function addQuad(positions, alphas, offset, cx, cz, angle, opacity) {
  // Quad along the car's direction
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
    alphas[vi] = opacity;
  }
}

function rebuildGeometry() {
  if (!geometry) return;

  const posAttr = geometry.getAttribute('position');
  const alphaAttr = geometry.getAttribute('alpha');
  const positions = posAttr.array;
  const alphas = alphaAttr.array;

  let vertOffset = 0;

  for (const seg of segments) {
    const cos = Math.cos(seg.angle + Math.PI * 0.5);
    const sin = Math.sin(seg.angle + Math.PI * 0.5);

    // Left tire
    const lx = seg.x + cos * TIRE_OFFSET;
    const lz = seg.z + sin * TIRE_OFFSET;
    addQuad(positions, alphas, vertOffset, lx, lz, seg.angle, seg.opacity);
    vertOffset += 6;

    // Right tire
    const rx = seg.x - cos * TIRE_OFFSET;
    const rz = seg.z - sin * TIRE_OFFSET;
    addQuad(positions, alphas, vertOffset, rx, rz, seg.angle, seg.opacity);
    vertOffset += 6;
  }

  geometry.setDrawRange(0, vertOffset);
  posAttr.needsUpdate = true;
  alphaAttr.needsUpdate = true;
}

export function initSkidmarks(scene) {
  if (mesh) {
    scene.remove(mesh);
  }
  segments.length = 0;
  const m = createMesh();
  scene.add(m);
  return m;
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
        if (dx * dx + dz * dz < 1.0) continue;
      }

      segments.push({
        x: p.x,
        z: p.z,
        angle: p.angle,
        opacity: Math.min(p.skidIntensity, 1),
      });
      lastPos.set(p.id, { x: p.x, z: p.z });
      added = true;

      // Cap segments
      while (segments.length > MAX_SEGMENTS) {
        segments.shift();
      }
    }
  }

  if (added) {
    rebuildGeometry();
  }
}

export function clearSkidmarks() {
  segments.length = 0;
  lastPos.clear();
  if (geometry) {
    geometry.setDrawRange(0, 0);
    const posAttr = geometry.getAttribute('position');
    const alphaAttr = geometry.getAttribute('alpha');
    if (posAttr) posAttr.needsUpdate = true;
    if (alphaAttr) alphaAttr.needsUpdate = true;
  }
}
