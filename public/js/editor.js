import { smoothLoop, TRACK_DEFS, TRACK_KEYS } from '/shared/track.js';

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
let selectedPoint = -1;
let dragging = false;
let panning = false;
let panStart = { x: 0, y: 0 };
let lastMouse = { x: 0, y: 0 };

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
}

function drawCanvas() {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);

  // Grid
  drawGrid(w, h);

  // Track surface
  if (segments.length > 0) {
    drawRoadSurface();
    drawCenterline();
    drawOilSlicks();
    drawStartFinish();
  }

  // Control points
  drawControlPoints();
}

function drawGrid(w, h) {
  const gridSize = 50;
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
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
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  const origin = worldToCanvas(0, 0);
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, h);
  ctx.moveTo(0, origin.y);
  ctx.lineTo(w, origin.y);
  ctx.stroke();
}

function drawRoadSurface() {
  const hw = roadWidth / 2;
  const n = segments.length;

  // Road fill
  ctx.fillStyle = 'rgba(100,100,100,0.5)';
  ctx.beginPath();
  // Left edge forward
  for (let i = 0; i <= n; i++) {
    const s = segments[i % n];
    const p = worldToCanvas(s.x + s.nx * hw, s.z + s.nz * hw);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  // Right edge backward
  for (let i = n; i >= 0; i--) {
    const s = segments[i % n];
    const p = worldToCanvas(s.x - s.nx * hw, s.z - s.nz * hw);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();

  // Edge lines
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const s = segments[i % n];
    const p = worldToCanvas(s.x + s.nx * hw, s.z + s.nz * hw);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const s = segments[i % n];
    const p = worldToCanvas(s.x - s.nx * hw, s.z - s.nz * hw);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

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

function drawStartFinish() {
  if (segments.length === 0) return;
  const s = segments[0];
  const hw = roadWidth / 2;
  const p1 = worldToCanvas(s.x + s.nx * hw, s.z + s.nz * hw);
  const p2 = worldToCanvas(s.x - s.nx * hw, s.z - s.nz * hw);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  // Start label
  const label = worldToCanvas(s.x, s.z);
  ctx.fillStyle = '#fff';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('START', label.x, label.y - 8 * zoom);
}

function drawOilSlicks() {
  for (let i = 0; i < oilSlicks.length; i++) {
    const os = oilSlicks[i];
    const idx = Math.floor(os.segFraction * segments.length) % segments.length;
    const s = segments[idx];
    const p = worldToCanvas(s.x, s.z);
    const r = os.radius * zoom;
    ctx.fillStyle = 'rgba(30,100,200,0.3)';
    ctx.strokeStyle = 'rgba(30,100,200,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle = '#3498db';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`oil ${i + 1}`, p.x, p.y + 3);
  }
}

function drawControlPoints() {
  for (let i = 0; i < controlPoints.length; i++) {
    const pt = controlPoints[i];
    const p = worldToCanvas(pt.x, pt.z);
    const isSelected = i === selectedPoint;
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
}

// ============================================================
// Sidebar sync
// ============================================================
function updatePointsList() {
  pointsList.innerHTML = '';
  controlPoints.forEach((pt, i) => {
    const row = document.createElement('div');
    row.className = 'point-row';
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
      if (selectedPoint >= controlPoints.length) selectedPoint = -1;
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
      drawCanvas();
    });
  });

  slicksList.querySelectorAll('.pt-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = parseInt(e.target.dataset.i);
      oilSlicks.splice(i, 1);
      updateSlicksList();
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

  const cpStr = controlPoints
    .map(p => `      { x: ${Math.round(p.x)}, z: ${Math.round(p.z)} },`)
    .join('\n');

  const slicksStr = oilSlicks.length > 0
    ? `\n    oilSlicks: [\n${oilSlicks.map(o => `      { segFraction: ${o.segFraction.toFixed(2)}, radius: ${o.radius} },`).join('\n')}\n    ],`
    : '';

  const code = `  ${trackKey}: {
    name: '${trackName.replace(/'/g, "\\'")}',
    width: ${roadWidth},
    buildCenterline() {
      const control = [
${cpStr}
      ];
      return smoothLoop(control, ${pointsPerSegment});
    },${slicksStr}
  },`;

  navigator.clipboard.writeText(code).then(
    () => showStatus('Copied JS to clipboard'),
    () => showStatus('Copy failed — check permissions', true),
  );
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

canvas.addEventListener('mousedown', (e) => {
  const pos = getMousePos(e);
  lastMouse = pos;

  if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
    // Ctrl+click = pan
    panning = true;
    panStart = { x: pos.x, y: pos.y };
    return;
  }

  if (e.button === 1) {
    // Middle click = pan
    e.preventDefault();
    panning = true;
    panStart = { x: pos.x, y: pos.y };
    return;
  }

  if (e.button === 0) {
    // Left click: select/drag point
    const idx = findPointAt(pos.x, pos.y);
    if (idx >= 0) {
      selectedPoint = idx;
      dragging = true;
      updatePointsList();
      drawCanvas();
    } else {
      selectedPoint = -1;
      updatePointsList();
      drawCanvas();
    }
  }

  if (e.button === 2) {
    // Right click: delete point
    const idx = findPointAt(pos.x, pos.y);
    if (idx >= 0 && controlPoints.length > 3) {
      controlPoints.splice(idx, 1);
      if (selectedPoint >= controlPoints.length) selectedPoint = -1;
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
    return;
  }

  if (dragging && selectedPoint >= 0) {
    const world = canvasToWorld(pos.x, pos.y);
    controlPoints[selectedPoint].x = world.x;
    controlPoints[selectedPoint].z = world.z;
    rebuildTrack();
    drawCanvas();
    // Update input values live
    const inputs = pointsList.querySelectorAll(`.point-row:nth-child(${selectedPoint + 1}) input`);
    if (inputs.length >= 2) {
      inputs[0].value = Math.round(world.x);
      inputs[1].value = Math.round(world.z);
    }
  }

  lastMouse = pos;
});

canvas.addEventListener('mouseup', (e) => {
  if (dragging) {
    dragging = false;
    updatePointsList(); // refresh with final values
  }
  panning = false;
});

canvas.addEventListener('dblclick', (e) => {
  if (e.button !== 0) return;
  const pos = getMousePos(e);
  const world = canvasToWorld(pos.x, pos.y);

  // Find the best insertion index (closest segment between two adjacent points)
  let bestIdx = controlPoints.length;
  let bestDist = Infinity;
  for (let i = 0; i < controlPoints.length; i++) {
    const a = controlPoints[i];
    const b = controlPoints[(i + 1) % controlPoints.length];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const d = (world.x - mx) ** 2 + (world.z - mz) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i + 1;
    }
  }

  controlPoints.splice(bestIdx, 0, { x: Math.round(world.x), z: Math.round(world.z) });
  selectedPoint = bestIdx;
  rebuildTrack();
  updatePointsList();
  drawCanvas();
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
  drawCanvas();
});

loadSelect.addEventListener('change', () => {
  const key = loadSelect.value;
  if (key) loadTrackIntoEditor(key);
});

saveBtn.addEventListener('click', saveTrack);
copyBtn.addEventListener('click', copyJS);
deleteBtn.addEventListener('click', deleteTrack);

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
  drawCanvas();
}

window.addEventListener('resize', () => {
  resizeCanvas();
  drawCanvas();
});

init();
