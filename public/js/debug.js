import * as THREE from 'three';

let debugGroup = null;
let debugEnabled = false;
let debugPanel = null;
let scene = null;

export function initDebug(sceneRef) {
  scene = sceneRef;
  createDebugPanel();
}

export function isDebugEnabled() {
  return debugEnabled;
}

export function toggleDebug(trackData) {
  debugEnabled = !debugEnabled;

  if (debugEnabled && trackData) {
    buildDebugVisuals(trackData);
    debugPanel.style.display = 'block';
  } else {
    removeDebugVisuals();
    debugPanel.style.display = 'none';
  }
}

export function rebuildDebugVisuals(trackData) {
  if (!debugEnabled || !trackData) return;
  buildDebugVisuals(trackData);
}

export function updateDebugInfo(myPlayer, trackData) {
  if (!debugEnabled || !debugPanel) return;

  const infoEl = document.getElementById('debug-info-text');
  if (!infoEl) return;

  const cp = myPlayer != null ? myPlayer.nextCheckpoint : '-';
  const x = myPlayer ? myPlayer.x.toFixed(1) : '-';
  const z = myPlayer ? myPlayer.z.toFixed(1) : '-';
  const angle = myPlayer ? (myPlayer.angle * 180 / Math.PI % 360).toFixed(1) : '-';
  const totalCPs = trackData ? trackData.checkpoints.length : '-';

  infoEl.innerHTML =
    `Checkpoints: ${totalCPs}<br>` +
    `Next CP: ${cp}<br>` +
    `Pos: (${x}, ${z})<br>` +
    `Angle: ${angle}&deg;`;
}

export function highlightNextCheckpoint(nextCPIndex) {
  if (!debugGroup || !debugEnabled) return;

  for (const child of debugGroup.children) {
    if (!child.userData.isCheckpoint) continue;
    if (child.userData.cpIndex === nextCPIndex) {
      child.material.color.setHex(0x00ff00);
      child.material.opacity = 0.6;
    } else {
      child.material.color.setHex(0xffff00);
      child.material.opacity = 0.25;
    }
  }
}

function buildDebugVisuals(trackData) {
  removeDebugVisuals();
  debugGroup = new THREE.Group();

  const { checkpoints, segments } = trackData;

  // Checkpoint planes
  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];

    // Detection zone: width across track, 24 deep (|dot| < 12)
    const planeGeo = new THREE.PlaneGeometry(cp.width, 24);
    const isFinishLine = (i === checkpoints.length - 1);
    const planeMat = new THREE.MeshBasicMaterial({
      color: isFinishLine ? 0xff4444 : 0xffff00,
      transparent: true,
      opacity: isFinishLine ? 0.4 : 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.position.set(cp.x, 0.25, cp.z);
    plane.rotation.x = -Math.PI / 2;
    // Align with checkpoint normal
    plane.rotation.z = Math.atan2(-cp.nz, cp.nx);
    plane.userData.isCheckpoint = true;
    plane.userData.cpIndex = i;
    debugGroup.add(plane);

    // Number label sprite
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = isFinishLine ? '#ff4444' : '#ffff00';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isFinishLine ? 'F' : String(i), 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(cp.x, 8, cp.z);
    sprite.scale.set(10, 10, 1);
    debugGroup.add(sprite);
  }

  // Direction arrows along centerline
  const arrowInterval = Math.max(1, Math.floor(segments.length / 30));
  for (let i = 0; i < segments.length; i += arrowInterval) {
    const s = segments[i];

    const arrowGeo = new THREE.ConeGeometry(1.5, 4, 4);
    arrowGeo.rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
      transparent: true,
      opacity: 0.5,
    });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.set(s.x, 0.3, s.z);
    arrow.rotation.y = Math.atan2(s.dirX, s.dirZ);
    debugGroup.add(arrow);
  }

  scene.add(debugGroup);
}

function removeDebugVisuals() {
  if (debugGroup && scene) {
    scene.remove(debugGroup);
    debugGroup = null;
  }
}

function createDebugPanel() {
  debugPanel = document.createElement('div');
  debugPanel.id = 'debug-panel';
  debugPanel.style.display = 'none';
  debugPanel.innerHTML = `
    <div id="debug-title">DEBUG (F3)</div>
    <div id="debug-info-text"></div>
  `;
  document.getElementById('game-container').appendChild(debugPanel);
}
