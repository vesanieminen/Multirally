import * as THREE from 'three';
import { smoothLoop, TRACK_DEFS, TRACK_KEYS, getTrackBounds, generateObstacles } from '/shared/track.js';
import { buildTrackScene } from './trackRenderer.js';

// ============================================================
// State
// ============================================================
let trackName = 'New Track';
let trackKey = 'newTrack';
let roadWidth = 50;
let pointsPerSegment = 16;
let controlPoints = [
  { x: 0, z: -150 },
  { x: 150, z: 0 },
  { x: 0, z: 150 },
  { x: -150, z: 0 },
];
let oilSlicks = [];

// Computed from controlPoints
let centerline = [];
let segments = [];

// Canvas state
let zoom = 1;
let panX = 0;
let panZ = 0;
let selectedPoints = new Set();
let dragging = false;
let panning = false;
let panStart = { x: 0, y: 0 };
let lastMouse = { x: 0, y: 0 };

// Tool mode state
let toolMode = 'select'; // 'select' | 'scale' | 'rotate'
let boxSelecting = false;
let boxStart = null;
let boxEnd = null;
let toolDragActive = false;
let toolDragStartX = 0;
let toolDragStartY = 0;
let toolDragOriginalPositions = [];
let showCheckpoints = false;

// Custom tracks from server
let customTracksData = {};

// ============================================================
// DOM references
// ============================================================
const canvas = document.getElementById('editor-canvas');
const ctx = canvas.getContext('2d');
const nameInput = document.getElementById('track-name-input');
const keyInput = document.getElementById('track-key-input');
const widthSlider = document.getElementById('width-slider');
const widthVal = document.getElementById('width-val');
const smoothSlider = document.getElementById('smooth-slider');
const smoothVal = document.getElementById('smooth-val');
const pointsList = document.getElementById('points-list');
const slicksList = document.getElementById('slicks-list');
const loadSelect = document.getElementById('load-track-select');
const saveBtn = document.getElementById('save-btn');
const copyBtn = document.getElementById('copy-btn');
const deleteBtn = document.getElementById('delete-btn');
const statusMsg = document.getElementById('status-msg');
const addPointBtn = document.getElementById('add-point-btn');
const addSlickBtn = document.getElementById('add-slick-btn');
const showCheckpointsInput = document.getElementById('show-checkpoints');

// ============================================================
// Three.js setup (3D background layer)
// ============================================================
const canvas3d = document.getElementById('editor-3d-canvas');
const threeRenderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
threeRenderer.shadowMap.enabled = true;
threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

const threeScene = new THREE.Scene();
threeScene.background = new THREE.Color(0x5b9bd5);

const threeCamera = new THREE.OrthographicCamera(-300, 300, 200, -200, 1, 2000);
threeCamera.position.set(0, 500, 0);
threeCamera.up.set(0, 0, -1);
threeCamera.lookAt(0, 0, 0);

// Lighting (matches renderer.js)
threeScene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xfffbe6, 0.7);
dirLight.position.set(100, 300, 150);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.left = -400;
dirLight.shadow.camera.right = 400;
dirLight.shadow.camera.top = 400;
dirLight.shadow.camera.bottom = -400;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 800;
threeScene.add(dirLight);
threeScene.add(new THREE.HemisphereLight(0x87CEEB, 0x556B2F, 0.3));

let threeNeedsRebuild = true;
let dragRebuildPending = false;

function syncThreeCamera() {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  const halfW = w / (2 * zoom);
  const halfH = h / (2 * zoom);

  threeCamera.left = -halfW;
  threeCamera.right = halfW;
  threeCamera.top = halfH;
  threeCamera.bottom = -halfH;
  threeCamera.position.set(-panX, 500, -panZ);
  threeCamera.lookAt(-panX, 0, -panZ);
  threeCamera.updateProjectionMatrix();
}

function buildEditorTrackData(skipObstacles) {
  if (segments.length === 0) return null;
  const kerbExtra = 4;
  const bounds = getTrackBounds(segments, roadWidth);
  const margin = 50;
  const islandBounds = {
    minX: bounds.minX - margin, maxX: bounds.maxX + margin,
    minZ: bounds.minZ - margin, maxZ: bounds.maxZ + margin,
  };

  // Resolve oil slick positions
  const resolvedOilSlicks = oilSlicks.map(os => {
    const idx = Math.floor(os.segFraction * segments.length) % segments.length;
    const s = segments[idx];
    return { x: s.x, z: s.z, radius: os.radius };
  });

  let obstacles = { trees: [], grandstands: [] };
  if (!skipObstacles) {
    // Minimal getSurface for obstacle placement
    const hw = roadWidth / 2;
    function getSurface(px, pz) {
      if (px < islandBounds.minX || px > islandBounds.maxX ||
          pz < islandBounds.minZ || pz > islandBounds.maxZ) return 'water';
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        const dx = px - s.x, dz = pz - s.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < hw + kerbExtra) return dist < hw ? 'road' : 'kerb';
      }
      return 'grass';
    }
    obstacles = generateObstacles(segments, roadWidth, islandBounds, getSurface);
  }

  return { segments, roadWidth, kerbExtra, bounds, islandBounds, oilSlicks: resolvedOilSlicks, obstacles };
}

function rebuildThreeScene(skipScenery = false) {
  const trackData = buildEditorTrackData(skipScenery);
  if (trackData) {
    buildTrackScene(threeScene, trackData, { skipScenery });
    // Update shadow camera to fit track
    const ib = trackData.islandBounds;
    dirLight.shadow.camera.left = ib.minX - 50;
    dirLight.shadow.camera.right = ib.maxX + 50;
    dirLight.shadow.camera.top = ib.maxZ + 50;
    dirLight.shadow.camera.bottom = ib.minZ - 50;
    dirLight.shadow.camera.updateProjectionMatrix();
  }
  threeNeedsRebuild = false;
}

function renderThree() {
  syncThreeCamera();
  threeRenderer.render(threeScene, threeCamera);
}

// ============================================================
// Coordinate transforms
// ============================================================
function worldToCanvas(wx, wz) {
  const cx = canvas.width / 2 + (wx + panX) * zoom;
  const cy = canvas.height / 2 + (wz + panZ) * zoom;
  return { x: cx, y: cy };
}

function canvasToWorld(cx, cy) {
  const wx = (cx - canvas.width / 2) / zoom - panX;
  const wz = (cy - canvas.height / 2) / zoom - panZ;
  return { x: wx, z: wz };
}

// ============================================================
// Track building
// ============================================================
function rebuildTrack() {
  if (controlPoints.length < 3) {
    centerline = [];
    segments = [];
    return;
  }
  centerline = smoothLoop(controlPoints, pointsPerSegment);
  // Build segments with normals (same as track.js)
  segments = [];
  const n = centerline.length;
  for (let i = 0; i < n; i++) {
    const cur = centerline[i];
    const next = centerline[(i + 1) % n];
    const dx = next.x - cur.x;
    const dz = next.z - cur.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    segments.push({
      x: cur.x,
      z: cur.z,
      nx: -dz / len,
      nz: dx / len,
      dirX: dx / len,
      dirZ: dz / len,
    });
  }
  threeNeedsRebuild = true;
}

// ============================================================
// Drawing
// ============================================================
function resizeCanvas() {
  const wrap = canvas.parentElement;
  canvas.width = wrap.clientWidth * devicePixelRatio;
  canvas.height = wrap.clientHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  canvas.style.width = wrap.clientWidth + 'px';
  canvas.style.height = wrap.clientHeight + 'px';
  threeRenderer.setSize(wrap.clientWidth, wrap.clientHeight);
  threeRenderer.setPixelRatio(devicePixelRatio);
}

function drawCanvas() {
  // Rebuild Three.js scene if needed
  if (threeNeedsRebuild && segments.length > 0) {
    rebuildThreeScene(dragging || toolDragActive); // skipScenery during drag for performance
  }
  renderThree();

  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);

  // Grid
  drawGrid(w, h);

  // Editor overlays (2D)
  if (segments.length > 0) {
    drawCenterline();
    drawDirectionArrows();
    drawOilSlickLabels();
    drawStartLabel();
    if (showCheckpoints) drawCheckpoints();
  }

  // Control points
  drawControlPoints();

  // Tool overlays
  if (boxSelecting && boxStart && boxEnd) drawBoxSelection();
  if (selectedPoints.size >= 2 && (toolMode === 'scale' || toolMode === 'rotate')) {
    drawCentroidMarker();
  }
  if (toolDragActive && toolMode === 'rotate') {
    drawRotationLine();
  }
}

function drawGrid(w, h) {
  const gridSize = 50;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;

  // Find visible range
  const topLeft = canvasToWorld(0, 0);
  const botRight = canvasToWorld(w, h);
  const startX = Math.floor(topLeft.x / gridSize) * gridSize;
  const endX = Math.ceil(botRight.x / gridSize) * gridSize;
  const startZ = Math.floor(topLeft.z / gridSize) * gridSize;
  const endZ = Math.ceil(botRight.z / gridSize) * gridSize;

  ctx.beginPath();
  for (let x = startX; x <= endX; x += gridSize) {
    const p = worldToCanvas(x, 0);
    ctx.moveTo(p.x, 0);
    ctx.lineTo(p.x, h);
  }
  for (let z = startZ; z <= endZ; z += gridSize) {
    const p = worldToCanvas(0, z);
    ctx.moveTo(0, p.y);
    ctx.lineTo(w, p.y);
  }
  ctx.stroke();

  // Origin crosshair
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  const origin = worldToCanvas(0, 0);
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, h);
  ctx.moveTo(0, origin.y);
  ctx.lineTo(w, origin.y);
  ctx.stroke();
}

// Road surface is now rendered by Three.js — removed drawRoadSurface()

function drawCenterline() {
  ctx.strokeStyle = 'rgba(255,200,50,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (let i = 0; i <= centerline.length; i++) {
    const pt = centerline[i % centerline.length];
    const p = worldToCanvas(pt.x, pt.z);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawDirectionArrows() {
  if (segments.length < 20) return;
  const numArrows = 6;
  const step = Math.floor(segments.length / numArrows);
  ctx.fillStyle = 'rgba(255,200,50,0.35)';
  for (let a = 0; a < numArrows; a++) {
    const idx = (step * a + Math.floor(step / 2)) % segments.length;
    const s = segments[idx];
    const p = worldToCanvas(s.x, s.z);
    const arrowSize = 6;
    const angle = Math.atan2(s.dirZ, s.dirX);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(arrowSize, 0);
    ctx.lineTo(-arrowSize, -arrowSize * 0.6);
    ctx.lineTo(-arrowSize, arrowSize * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawStartLabel() {
  if (segments.length === 0) return;
  const s = segments[0];
  const label = worldToCanvas(s.x, s.z);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('START', label.x, label.y - 8);
}

function drawOilSlickLabels() {
  for (let i = 0; i < oilSlicks.length; i++) {
    const os = oilSlicks[i];
    const idx = Math.floor(os.segFraction * segments.length) % segments.length;
    const s = segments[idx];
    const p = worldToCanvas(s.x, s.z);
    // Label only — oil slick visuals rendered by Three.js
    ctx.fillStyle = '#3498db';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`oil ${i + 1}`, p.x, p.y + 3);
  }
}

function drawControlPoints() {
  for (let i = 0; i < controlPoints.length; i++) {
    const pt = controlPoints[i];
    const p = worldToCanvas(pt.x, pt.z);
    const isSelected = selectedPoints.has(i);
    const r = isSelected ? 8 : 6;

    ctx.fillStyle = isSelected ? '#f1c40f' : '#e67e22';
    ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Index label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), p.x, p.y - r - 4);
  }
}

// ============================================================
// Tool mode helpers
// ============================================================
function getSelectionCentroid() {
  let cx = 0, cz = 0, n = 0;
  for (const i of selectedPoints) {
    cx += controlPoints[i].x;
    cz += controlPoints[i].z;
    n++;
  }
  return n > 0 ? { x: cx / n, z: cz / n } : { x: 0, z: 0 };
}

function snapshotSelectedPositions() {
  toolDragOriginalPositions = [];
  for (const i of selectedPoints) {
    toolDragOriginalPositions.push({ idx: i, x: controlPoints[i].x, z: controlPoints[i].z });
  }
}

function setToolMode(mode) {
  toolMode = mode;
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  canvas.style.cursor = mode === 'select' ? 'crosshair' : mode === 'scale' ? 'ew-resize' : 'grab';
}

function drawCheckpoints() {
  // Draw 6 evenly-spaced checkpoint gates + finish line
  const numCheckpoints = 6;
  const hw = roadWidth / 2;
  for (let c = 0; c <= numCheckpoints; c++) {
    const frac = c / numCheckpoints;
    const idx = Math.floor(frac * segments.length) % segments.length;
    const s = segments[idx];
    const lx = s.x + s.nx * hw;
    const lz = s.z + s.nz * hw;
    const rx = s.x - s.nx * hw;
    const rz = s.z - s.nz * hw;
    const pl = worldToCanvas(lx, lz);
    const pr = worldToCanvas(rx, rz);
    ctx.strokeStyle = c === 0 ? 'rgba(255,255,255,0.7)' : 'rgba(46,204,113,0.5)';
    ctx.lineWidth = c === 0 ? 2 : 1;
    ctx.setLineDash(c === 0 ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(pl.x, pl.y);
    ctx.lineTo(pr.x, pr.y);
    ctx.stroke();
    // Label
    const mid = worldToCanvas(s.x, s.z);
    ctx.fillStyle = c === 0 ? '#fff' : 'rgba(46,204,113,0.8)';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c === 0 ? 'FINISH' : `CP${c}`, mid.x, mid.y - 12);
  }
  ctx.setLineDash([]);
}

function drawBoxSelection() {
  ctx.strokeStyle = 'rgba(52,152,219,0.8)';
  ctx.fillStyle = 'rgba(52,152,219,0.1)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  const x = Math.min(boxStart.x, boxEnd.x);
  const y = Math.min(boxStart.y, boxEnd.y);
  const w = Math.abs(boxEnd.x - boxStart.x);
  const h = Math.abs(boxEnd.y - boxStart.y);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

function drawCentroidMarker() {
  const c = getSelectionCentroid();
  const p = worldToCanvas(c.x, c.z);
  const size = 10;
  ctx.strokeStyle = 'rgba(241,196,15,0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(p.x - size, p.y);
  ctx.lineTo(p.x + size, p.y);
  ctx.moveTo(p.x, p.y - size);
  ctx.lineTo(p.x, p.y + size);
  ctx.stroke();
  // Circle
  ctx.beginPath();
  ctx.arc(p.x, p.y, size * 0.6, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRotationLine() {
  const c = getSelectionCentroid();
  const p = worldToCanvas(c.x, c.z);
  ctx.strokeStyle = 'rgba(231,76,60,0.6)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(lastMouse.x, lastMouse.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ============================================================
// Auto-fit zoom to track
// ============================================================
function fitToTrack() {
  if (controlPoints.length === 0) return;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const pt of controlPoints) {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minZ = Math.min(minZ, pt.z);
    maxZ = Math.max(maxZ, pt.z);
  }
  const margin = roadWidth + 40;
  const trackW = (maxX - minX) + margin * 2;
  const trackH = (maxZ - minZ) + margin * 2;
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  zoom = Math.min(w / trackW, h / trackH);
  panX = -(minX + maxX) / 2;
  panZ = -(minZ + maxZ) / 2;
  syncThreeCamera();
}

// ============================================================
// Sidebar sync
// ============================================================
function updatePointsList() {
  pointsList.innerHTML = '';
  controlPoints.forEach((pt, i) => {
    const row = document.createElement('div');
    row.className = 'point-row';
    if (selectedPoints.has(i)) row.style.background = 'rgba(241,196,15,0.12)';
    row.innerHTML = `
      <span class="pt-idx">${i + 1}.</span>
      <input type="number" value="${Math.round(pt.x)}" data-i="${i}" data-axis="x" step="5" />
      <input type="number" value="${Math.round(pt.z)}" data-i="${i}" data-axis="z" step="5" />
      <button class="pt-del" data-i="${i}" title="Delete point">&times;</button>
    `;
    pointsList.appendChild(row);
  });

  // Attach events
  pointsList.querySelectorAll('input[type="number"]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const i = parseInt(e.target.dataset.i);
      const axis = e.target.dataset.axis;
      controlPoints[i][axis] = parseFloat(e.target.value) || 0;
      rebuildTrack();
      drawCanvas();
    });
  });

  pointsList.querySelectorAll('.pt-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = parseInt(e.target.dataset.i);
      if (controlPoints.length <= 3) return; // need at least 3
      controlPoints.splice(i, 1);
      const shifted = new Set();
      for (const si of selectedPoints) {
        if (si === i) continue;
        shifted.add(si > i ? si - 1 : si);
      }
      selectedPoints = shifted;
      rebuildTrack();
      updatePointsList();
      drawCanvas();
    });
  });
}

function updateSlicksList() {
  slicksList.innerHTML = '';
  oilSlicks.forEach((os, i) => {
    const row = document.createElement('div');
    row.className = 'slick-row';
    row.innerHTML = `
      <span style="color:#3498db;">Oil ${i + 1}</span>
      <label style="margin:0;font-size:10px;color:#888">pos</label>
      <input type="number" value="${os.segFraction.toFixed(2)}" data-i="${i}" data-field="segFraction" step="0.05" min="0" max="1" />
      <label style="margin:0;font-size:10px;color:#888">r</label>
      <input type="number" value="${os.radius}" data-i="${i}" data-field="radius" step="1" min="5" max="30" />
      <button class="pt-del" data-i="${i}" title="Delete slick">&times;</button>
    `;
    slicksList.appendChild(row);
  });

  slicksList.querySelectorAll('input[type="number"]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const i = parseInt(e.target.dataset.i);
      const field = e.target.dataset.field;
      let val = parseFloat(e.target.value) || 0;
      if (field === 'segFraction') val = Math.max(0, Math.min(1, val));
      if (field === 'radius') val = Math.max(5, Math.min(30, val));
      oilSlicks[i][field] = val;
      threeNeedsRebuild = true;
      drawCanvas();
    });
  });

  slicksList.querySelectorAll('.pt-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = parseInt(e.target.dataset.i);
      oilSlicks.splice(i, 1);
      updateSlicksList();
      threeNeedsRebuild = true;
      drawCanvas();
    });
  });
}

function populateLoadSelect() {
  loadSelect.innerHTML = '<option value="">— Select —</option>';

  // Built-in tracks first
  const builtInGroup = document.createElement('optgroup');
  builtInGroup.label = 'Built-in Tracks';
  for (const key of TRACK_KEYS) {
    if (customTracksData[key]) continue; // skip custom tracks in this group
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = TRACK_DEFS[key]?.name || key;
    builtInGroup.appendChild(opt);
  }
  loadSelect.appendChild(builtInGroup);

  // Custom tracks
  const customKeys = Object.keys(customTracksData);
  if (customKeys.length > 0) {
    const customGroup = document.createElement('optgroup');
    customGroup.label = 'Custom Tracks';
    for (const key of customKeys) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = customTracksData[key].name || key;
      customGroup.appendChild(opt);
    }
    loadSelect.appendChild(customGroup);
  }
}

// ============================================================
// Load a track into the editor
// ============================================================
function loadTrackIntoEditor(key) {
  // Check custom tracks first (they have raw control points)
  if (customTracksData[key]) {
    const data = customTracksData[key];
    trackName = data.name;
    trackKey = key;
    roadWidth = data.width;
    pointsPerSegment = data.pointsPerSegment || 16;
    controlPoints = data.controlPoints.map(p => ({ x: p.x, z: p.z }));
    oilSlicks = (data.oilSlicks || []).map(o => ({ ...o }));
  } else if (TRACK_DEFS[key]) {
    // Built-in track: we need to reverse-engineer control points from the definition
    // For smoothLoop-based tracks, we can extract the control points from the source
    // For others (oval, figure8, peanut) we approximate with the centerline
    const def = TRACK_DEFS[key];
    trackName = def.name;
    trackKey = key;
    roadWidth = def.width;

    // Try to get control points by building the centerline and sampling it
    const cl = def.buildCenterline();
    // Sample control points evenly from the centerline
    const numSamples = Math.min(cl.length, Math.max(8, Math.round(cl.length / 15)));
    controlPoints = [];
    for (let i = 0; i < numSamples; i++) {
      const idx = Math.floor(i * cl.length / numSamples);
      controlPoints.push({ x: cl[idx].x, z: cl[idx].z });
    }
    pointsPerSegment = 16;
    oilSlicks = (def.oilSlicks || []).map(o => ({ ...o }));
  } else {
    return;
  }

  nameInput.value = trackName;
  keyInput.value = trackKey;
  widthSlider.value = roadWidth;
  widthVal.textContent = roadWidth;
  smoothSlider.value = pointsPerSegment;
  smoothVal.textContent = pointsPerSegment;

  rebuildTrack();
  fitToTrack();
  updatePointsList();
  updateSlicksList();
  threeNeedsRebuild = true;
  drawCanvas();
}

// ============================================================
// API calls
// ============================================================
async function fetchCustomTracks() {
  try {
    const res = await fetch('/api/tracks');
    if (res.ok) customTracksData = await res.json();
  } catch { /* ignore */ }
  populateLoadSelect();
}

async function saveTrack() {
  trackName = nameInput.value.trim() || 'Unnamed';
  trackKey = keyInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'unnamed';

  if (controlPoints.length < 3) {
    showStatus('Need at least 3 control points', true);
    return;
  }

  const data = {
    name: trackName,
    width: roadWidth,
    controlPoints: controlPoints.map(p => ({ x: Math.round(p.x), z: Math.round(p.z) })),
    pointsPerSegment,
    oilSlicks: oilSlicks.length > 0 ? oilSlicks : undefined,
  };

  try {
    const res = await fetch('/api/tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: trackKey, track: data }),
    });
    if (res.ok) {
      customTracksData[trackKey] = data;
      populateLoadSelect();
      showStatus(`Saved "${trackName}" — available in lobby now!`);
    } else {
      showStatus('Save failed: ' + (await res.text()), true);
    }
  } catch (e) {
    showStatus('Save failed: ' + e.message, true);
  }
}

async function deleteTrack() {
  const key = keyInput.value.trim();
  if (!key) return;
  if (!customTracksData[key]) {
    showStatus('Can only delete custom tracks', true);
    return;
  }
  if (!confirm(`Delete custom track "${key}"?`)) return;

  try {
    const res = await fetch(`/api/tracks?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (res.ok) {
      delete customTracksData[key];
      populateLoadSelect();
      showStatus(`Deleted "${key}"`);
    } else {
      showStatus('Delete failed: ' + (await res.text()), true);
    }
  } catch (e) {
    showStatus('Delete failed: ' + e.message, true);
  }
}

function copyJS() {
  trackName = nameInput.value.trim() || 'Unnamed';
  trackKey = keyInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'unnamed';
  const code = generateTrackCode(trackKey, trackName, roadWidth, controlPoints, pointsPerSegment, oilSlicks);
  navigator.clipboard.writeText(code).then(
    () => showStatus('Copied JS to clipboard'),
    () => showStatus('Copy failed — check permissions', true),
  );
}

function generateTrackCode(key, name, width, pts, pps, slicks) {
  const cpStr = pts.map(p => `      { x: ${Math.round(p.x)}, z: ${Math.round(p.z)} },`).join('\n');
  const slicksStr = slicks && slicks.length > 0
    ? `\n    oilSlicks: [\n${slicks.map(o => `      { segFraction: ${o.segFraction.toFixed(2)}, radius: ${o.radius} },`).join('\n')}\n    ],`
    : '';
  return `  ${key}: {
    name: '${name.replace(/'/g, "\\'")}',
    width: ${width},
    buildCenterline() {
      const control = [
${cpStr}
      ];
      return smoothLoop(control, ${pps});
    },${slicksStr}
  },`;
}

function exportAll() {
  const allCode = [];
  for (const key of TRACK_KEYS) {
    const def = TRACK_DEFS[key];
    if (!def) continue;

    let pts, pps, slicks;
    // Custom tracks have raw data
    if (customTracksData[key]) {
      const d = customTracksData[key];
      pts = d.controlPoints;
      pps = d.pointsPerSegment || 16;
      slicks = d.oilSlicks || [];
    } else {
      // Built-in track: sample centerline into control points
      const cl = def.buildCenterline();
      const numSamples = Math.min(cl.length, Math.max(8, Math.round(cl.length / 15)));
      pts = [];
      for (let i = 0; i < numSamples; i++) {
        const idx = Math.floor(i * cl.length / numSamples);
        pts.push({ x: cl[idx].x, z: cl[idx].z });
      }
      pps = 16;
      slicks = def.oilSlicks || [];
    }
    allCode.push(generateTrackCode(key, def.name, def.width, pts, pps, slicks));
  }

  const fileContent = `// MultiRally Track Definitions — exported ${new Date().toISOString().split('T')[0]}
// Paste into shared/track.js TRACK_DEFS, or import via editor

const TRACK_DEFS = {
${allCode.join('\n\n')}
};
`;

  const blob = new Blob([fileContent], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `multirally-tracks-${new Date().toISOString().split('T')[0]}.js`;
  a.click();
  URL.revokeObjectURL(url);
  showStatus(`Exported ${allCode.length} tracks`);
}

function exportSingleTrack() {
  trackName = nameInput.value.trim() || 'Unnamed';
  trackKey = keyInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'unnamed';
  if (controlPoints.length < 3) {
    showStatus('Need at least 3 control points', true);
    return;
  }
  const data = {
    [trackKey]: {
      name: trackName,
      width: roadWidth,
      controlPoints: controlPoints.map(p => ({ x: Math.round(p.x), z: Math.round(p.z) })),
      pointsPerSegment,
      ...(oilSlicks.length > 0 ? { oilSlicks } : {}),
    }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${trackKey}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showStatus(`Exported "${trackName}"`);
}

function importSingleTrack() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const entries = Object.entries(json);
      if (entries.length === 0) { showStatus('No track found in file', true); return; }
      const [key, data] = entries[0];
      if (!data.controlPoints || !data.name) { showStatus('Invalid track file', true); return; }
      // Load into editor
      trackName = data.name;
      trackKey = key;
      roadWidth = data.width || 50;
      pointsPerSegment = data.pointsPerSegment || 16;
      controlPoints = data.controlPoints.map(p => ({ x: p.x, z: p.z }));
      oilSlicks = (data.oilSlicks || []).map(o => ({ ...o }));
      nameInput.value = trackName;
      keyInput.value = trackKey;
      widthSlider.value = roadWidth;
      widthVal.textContent = roadWidth;
      smoothSlider.value = pointsPerSegment;
      smoothVal.textContent = pointsPerSegment;
      rebuildTrack();
      fitToTrack();
      updatePointsList();
      updateSlicksList();
      threeNeedsRebuild = true;
      drawCanvas();
      showStatus(`Loaded "${trackName}" from file`);
    } catch (e) {
      showStatus('Failed to parse file: ' + e.message, true);
    }
  });
  input.click();
}

function importTracks() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.js,.json';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const text = await file.text();
    let imported = 0;

    // Try JSON format first (custom-tracks.json format)
    try {
      const json = JSON.parse(text);
      if (typeof json === 'object' && !Array.isArray(json)) {
        for (const [key, data] of Object.entries(json)) {
          if (data.controlPoints && data.name) {
            await fetch('/api/tracks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key, track: data }),
            });
            imported++;
          }
        }
        if (imported > 0) {
          await fetchCustomTracks();
          showStatus(`Imported ${imported} tracks (JSON)`);
          return;
        }
      }
    } catch { /* not JSON, try JS */ }

    // Parse JS export format
    const trackRegex = /(\w+):\s*\{[^}]*name:\s*'([^']+)'[^}]*width:\s*(\d+)[^}]*control\s*=\s*\[([\s\S]*?)\];[^}]*smoothLoop\(control,\s*(\d+)\)([\s\S]*?)\},?\s*(?=\w+:|};)/g;
    let match;
    while ((match = trackRegex.exec(text)) !== null) {
      const key = match[1];
      const name = match[2];
      const width = parseInt(match[3]);
      const pps = parseInt(match[5]);
      const rest = match[6];

      // Parse control points
      const cpRegex = /\{\s*x:\s*(-?\d+),\s*z:\s*(-?\d+)\s*\}/g;
      const controlPoints = [];
      let cpMatch;
      while ((cpMatch = cpRegex.exec(match[4])) !== null) {
        controlPoints.push({ x: parseInt(cpMatch[1]), z: parseInt(cpMatch[2]) });
      }

      // Parse oil slicks if present
      const oilSlicks = [];
      const slickRegex = /segFraction:\s*([\d.]+),\s*radius:\s*(\d+)/g;
      let slickMatch;
      while ((slickMatch = slickRegex.exec(rest)) !== null) {
        oilSlicks.push({ segFraction: parseFloat(slickMatch[1]), radius: parseInt(slickMatch[2]) });
      }

      if (controlPoints.length >= 3) {
        const trackData = { name, width, controlPoints, pointsPerSegment: pps };
        if (oilSlicks.length > 0) trackData.oilSlicks = oilSlicks;
        await fetch('/api/tracks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, track: trackData }),
        });
        imported++;
      }
    }

    if (imported > 0) {
      await fetchCustomTracks();
      showStatus(`Imported ${imported} tracks`);
    } else {
      showStatus('No valid tracks found in file', true);
    }
  });
  input.click();
}

function showStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? '#e74c3c' : '#2ecc71';
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => { statusMsg.textContent = ''; }, 4000);
}

// ============================================================
// Mouse / input handling
// ============================================================
function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function findPointAt(mx, my) {
  const threshold = 12;
  for (let i = 0; i < controlPoints.length; i++) {
    const p = worldToCanvas(controlPoints[i].x, controlPoints[i].z);
    const dx = p.x - mx;
    const dy = p.y - my;
    if (dx * dx + dy * dy < threshold * threshold) return i;
  }
  return -1;
}

function addPointAtPosition(world) {
  let bestIdx = controlPoints.length;
  let bestDist = Infinity;
  for (let i = 0; i < controlPoints.length; i++) {
    const a = controlPoints[i];
    const b = controlPoints[(i + 1) % controlPoints.length];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const d = (world.x - mx) ** 2 + (world.z - mz) ** 2;
    if (d < bestDist) { bestDist = d; bestIdx = i + 1; }
  }
  controlPoints.splice(bestIdx, 0, { x: Math.round(world.x), z: Math.round(world.z) });
  // Shift selected indices
  const shifted = new Set();
  for (const idx of selectedPoints) {
    shifted.add(idx >= bestIdx ? idx + 1 : idx);
  }
  selectedPoints = shifted;
  selectedPoints.add(bestIdx);
  rebuildTrack();
  updatePointsList();
  drawCanvas();
}

canvas.addEventListener('mousedown', (e) => {
  const pos = getMousePos(e);
  lastMouse = pos;

  if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
    // Ctrl+click = add new control point
    addPointAtPosition(canvasToWorld(pos.x, pos.y));
    return;
  }

  if (e.button === 1) {
    e.preventDefault();
    panning = true;
    panStart = { x: pos.x, y: pos.y };
    return;
  }

  if (e.button === 0) {
    const idx = findPointAt(pos.x, pos.y);

    if (toolMode === 'select') {
      if (idx >= 0) {
        if (e.shiftKey) {
          // Shift+click toggles selection
          if (selectedPoints.has(idx)) selectedPoints.delete(idx);
          else selectedPoints.add(idx);
        } else {
          if (!selectedPoints.has(idx)) {
            selectedPoints.clear();
            selectedPoints.add(idx);
          }
          // Start dragging all selected points
          dragging = true;
          snapshotSelectedPositions();
          toolDragStartX = pos.x;
          toolDragStartY = pos.y;
        }
        updatePointsList();
        drawCanvas();
      } else {
        // Click on empty space — start box selection
        if (!e.shiftKey) selectedPoints.clear();
        boxSelecting = true;
        boxStart = { x: pos.x, y: pos.y };
        boxEnd = { x: pos.x, y: pos.y };
        updatePointsList();
        drawCanvas();
      }
    } else if (toolMode === 'scale' || toolMode === 'rotate') {
      if (idx >= 0 && !selectedPoints.has(idx)) {
        // Click unselected point — select it
        if (!e.shiftKey) selectedPoints.clear();
        selectedPoints.add(idx);
        updatePointsList();
        drawCanvas();
      } else if (selectedPoints.size >= 2) {
        // Start tool drag
        toolDragActive = true;
        toolDragStartX = pos.x;
        toolDragStartY = pos.y;
        snapshotSelectedPositions();
      } else if (idx >= 0) {
        // Only one selected, allow shift-adding
        if (e.shiftKey) {
          selectedPoints.add(idx);
        }
        updatePointsList();
        drawCanvas();
      } else {
        // Click empty in scale/rotate — start box selection
        if (!e.shiftKey) selectedPoints.clear();
        boxSelecting = true;
        boxStart = { x: pos.x, y: pos.y };
        boxEnd = { x: pos.x, y: pos.y };
        updatePointsList();
        drawCanvas();
      }
    }
  }

  if (e.button === 2) {
    const idx = findPointAt(pos.x, pos.y);
    if (idx >= 0 && controlPoints.length > 3) {
      controlPoints.splice(idx, 1);
      // Shift selected indices
      const shifted = new Set();
      for (const si of selectedPoints) {
        if (si === idx) continue;
        shifted.add(si > idx ? si - 1 : si);
      }
      selectedPoints = shifted;
      rebuildTrack();
      updatePointsList();
      drawCanvas();
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  const pos = getMousePos(e);

  if (panning) {
    const dx = (pos.x - panStart.x) / zoom;
    const dy = (pos.y - panStart.y) / zoom;
    panX += dx;
    panZ += dy;
    panStart = { x: pos.x, y: pos.y };
    drawCanvas();
    lastMouse = pos;
    return;
  }

  if (boxSelecting) {
    boxEnd = { x: pos.x, y: pos.y };
    drawCanvas();
    lastMouse = pos;
    return;
  }

  if (dragging && toolMode === 'select' && selectedPoints.size > 0) {
    // Move all selected points by delta
    const dx = (pos.x - toolDragStartX) / zoom;
    const dy = (pos.y - toolDragStartY) / zoom;
    for (const snap of toolDragOriginalPositions) {
      controlPoints[snap.idx].x = snap.x + dx;
      controlPoints[snap.idx].z = snap.z + dy;
    }
    rebuildTrack();
    drawCanvas();
    lastMouse = pos;
    return;
  }

  if (toolDragActive && toolMode === 'scale') {
    // Scale selected points around centroid based on horizontal drag distance
    const dx = pos.x - toolDragStartX;
    const factor = Math.max(0.1, 1 + dx / 200);
    const centroid = { x: 0, z: 0 };
    for (const snap of toolDragOriginalPositions) {
      centroid.x += snap.x;
      centroid.z += snap.z;
    }
    centroid.x /= toolDragOriginalPositions.length;
    centroid.z /= toolDragOriginalPositions.length;
    for (const snap of toolDragOriginalPositions) {
      controlPoints[snap.idx].x = centroid.x + (snap.x - centroid.x) * factor;
      controlPoints[snap.idx].z = centroid.z + (snap.z - centroid.z) * factor;
    }
    rebuildTrack();
    drawCanvas();
    lastMouse = pos;
    return;
  }

  if (toolDragActive && toolMode === 'rotate') {
    // Rotate selected points around centroid based on angle from start to current
    const centroid = { x: 0, z: 0 };
    for (const snap of toolDragOriginalPositions) {
      centroid.x += snap.x;
      centroid.z += snap.z;
    }
    centroid.x /= toolDragOriginalPositions.length;
    centroid.z /= toolDragOriginalPositions.length;
    const cp = worldToCanvas(centroid.x, centroid.z);
    const startAngle = Math.atan2(toolDragStartY - cp.y, toolDragStartX - cp.x);
    const curAngle = Math.atan2(pos.y - cp.y, pos.x - cp.x);
    const dAngle = curAngle - startAngle;
    const cos = Math.cos(dAngle);
    const sin = Math.sin(dAngle);
    for (const snap of toolDragOriginalPositions) {
      const rx = snap.x - centroid.x;
      const rz = snap.z - centroid.z;
      controlPoints[snap.idx].x = centroid.x + rx * cos - rz * sin;
      controlPoints[snap.idx].z = centroid.z + rx * sin + rz * cos;
    }
    rebuildTrack();
    drawCanvas();
    lastMouse = pos;
    return;
  }

  lastMouse = pos;
});

canvas.addEventListener('mouseup', (e) => {
  if (boxSelecting) {
    boxSelecting = false;
    // Find points inside box
    const x1 = Math.min(boxStart.x, boxEnd.x);
    const y1 = Math.min(boxStart.y, boxEnd.y);
    const x2 = Math.max(boxStart.x, boxEnd.x);
    const y2 = Math.max(boxStart.y, boxEnd.y);
    for (let i = 0; i < controlPoints.length; i++) {
      const p = worldToCanvas(controlPoints[i].x, controlPoints[i].z);
      if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) {
        selectedPoints.add(i);
      }
    }
    boxStart = null;
    boxEnd = null;
    updatePointsList();
    drawCanvas();
    return;
  }

  if (dragging) {
    dragging = false;
    updatePointsList();
    threeNeedsRebuild = true;
    drawCanvas();
  }

  if (toolDragActive) {
    toolDragActive = false;
    updatePointsList();
    threeNeedsRebuild = true;
    drawCanvas();
  }

  panning = false;
});

canvas.addEventListener('dblclick', (e) => {
  if (e.button !== 0) return;
  const pos = getMousePos(e);
  addPointAtPosition(canvasToWorld(pos.x, pos.y));
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const pos = getMousePos(e);
  const worldBefore = canvasToWorld(pos.x, pos.y);

  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  zoom *= factor;
  zoom = Math.max(0.1, Math.min(10, zoom));

  // Adjust pan to zoom toward mouse position
  const worldAfter = canvasToWorld(pos.x, pos.y);
  panX += worldAfter.x - worldBefore.x;
  panZ += worldAfter.z - worldBefore.z;

  drawCanvas();
}, { passive: false });

// ============================================================
// Sidebar events
// ============================================================
nameInput.addEventListener('input', () => {
  trackName = nameInput.value;
});

keyInput.addEventListener('input', () => {
  trackKey = keyInput.value;
});

widthSlider.addEventListener('input', () => {
  roadWidth = parseInt(widthSlider.value);
  widthVal.textContent = roadWidth;
  threeNeedsRebuild = true;
  drawCanvas();
});

smoothSlider.addEventListener('input', () => {
  pointsPerSegment = parseInt(smoothSlider.value);
  smoothVal.textContent = pointsPerSegment;
  rebuildTrack();
  drawCanvas();
});

addPointBtn.addEventListener('click', () => {
  // Add a point near the center of existing points
  if (controlPoints.length === 0) {
    controlPoints.push({ x: 0, z: 0 });
  } else {
    const last = controlPoints[controlPoints.length - 1];
    controlPoints.push({ x: last.x + 30, z: last.z + 30 });
  }
  rebuildTrack();
  updatePointsList();
  drawCanvas();
});

addSlickBtn.addEventListener('click', () => {
  oilSlicks.push({ segFraction: 0.5, radius: 15 });
  updateSlicksList();
  threeNeedsRebuild = true;
  drawCanvas();
});

loadSelect.addEventListener('change', () => {
  const key = loadSelect.value;
  if (key) loadTrackIntoEditor(key);
});

saveBtn.addEventListener('click', saveTrack);
copyBtn.addEventListener('click', copyJS);
deleteBtn.addEventListener('click', deleteTrack);
document.getElementById('export-track-btn').addEventListener('click', exportSingleTrack);
document.getElementById('import-track-btn').addEventListener('click', importSingleTrack);
document.getElementById('export-all-btn').addEventListener('click', exportAll);
document.getElementById('import-btn').addEventListener('click', importTracks);
// Tool bar
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => setToolMode(btn.dataset.mode));
});

// Checkpoint toggle
showCheckpointsInput.addEventListener('change', () => {
  showCheckpoints = showCheckpointsInput.checked;
  drawCanvas();
});

// Keyboard shortcuts for tool modes
document.addEventListener('keydown', (e) => {
  // Skip if typing in inputs
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'a' || e.key === 'A') { setToolMode('select'); e.preventDefault(); }
  if (e.key === 's' || e.key === 'S') { setToolMode('scale'); e.preventDefault(); }
  if (e.key === 'd' || e.key === 'D') { setToolMode('rotate'); e.preventDefault(); }
  if (e.key === 'Escape') {
    selectedPoints.clear();
    updatePointsList();
    drawCanvas();
  }
});

document.getElementById('reverse-btn').addEventListener('click', () => {
  controlPoints.reverse();
  // Adjust oil slick positions to match reversed direction
  for (const os of oilSlicks) {
    os.segFraction = +(1.0 - os.segFraction).toFixed(2);
  }
  rebuildTrack();
  updatePointsList();
  updateSlicksList();
  drawCanvas();
  showStatus('Track direction reversed');
});

// ============================================================
// Init
// ============================================================
function init() {
  resizeCanvas();
  rebuildTrack();
  fitToTrack();
  updatePointsList();
  updateSlicksList();
  fetchCustomTracks();
  threeNeedsRebuild = true;
  drawCanvas();
}

window.addEventListener('resize', () => {
  resizeCanvas();
  drawCanvas();
});

init();
