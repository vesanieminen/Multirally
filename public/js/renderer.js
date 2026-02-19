import * as THREE from 'three';

let scene, camera, renderer;
let currentBounds = null;

export function initRenderer(canvas) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x5b9bd5);

  // Default camera (will be updated when track is loaded)
  camera = new THREE.OrthographicCamera(-300, 300, 200, -200, 1, 2000);
  camera.position.set(100, 500, 200);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

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
  scene.add(dirLight);

  const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x556B2F, 0.3);
  scene.add(hemiLight);
}

export function frameCameraToTrack(bounds) {
  currentBounds = bounds;
  const trackWidth = bounds.maxX - bounds.minX;
  const trackHeight = bounds.maxZ - bounds.minZ;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const padding = 20;
  const viewWidth = trackWidth + padding * 2;
  const viewHeight = trackHeight + padding * 2;

  const aspect = window.innerWidth / window.innerHeight;
  let frustumWidth, frustumHeight;
  if (aspect > viewWidth / viewHeight) {
    frustumHeight = viewHeight;
    frustumWidth = frustumHeight * aspect;
  } else {
    frustumWidth = viewWidth;
    frustumHeight = frustumWidth / aspect;
  }

  camera.left = -frustumWidth / 2;
  camera.right = frustumWidth / 2;
  camera.top = frustumHeight / 2;
  camera.bottom = -frustumHeight / 2;

  const cameraDistance = 500;
  const elevation = Math.PI * 0.35;
  const azimuth = Math.PI * 0.15;

  camera.position.set(
    centerX + cameraDistance * Math.sin(azimuth) * Math.cos(elevation),
    cameraDistance * Math.sin(elevation),
    centerZ + cameraDistance * Math.cos(azimuth) * Math.cos(elevation)
  );
  camera.lookAt(centerX, 0, centerZ);
  camera.updateProjectionMatrix();
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function render() { renderer.render(scene, camera); }

export function onResize() {
  if (currentBounds) frameCameraToTrack(currentBounds);
  renderer.setSize(window.innerWidth, window.innerHeight);
}
