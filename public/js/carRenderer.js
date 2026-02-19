import * as THREE from 'three';

export function createCarMesh(color, carType) {
  const group = new THREE.Group();
  const carColor = new THREE.Color(color);

  // Brighter, more saturated material for cartoon look
  const bodyMat = new THREE.MeshStandardMaterial({
    color: carColor,
    roughness: 0.2,
    metalness: 0.1,
    emissive: carColor,
    emissiveIntensity: 0.25,
  });

  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    roughness: 0.1,
    metalness: 0.3,
    emissive: 0x88ccff,
    emissiveIntensity: 0.1,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.1,
    metalness: 0.8,
  });

  switch (carType) {
    case 'general':
    default:
      buildGeneral(group, bodyMat, darkMat, glassMat, chromeMat, carColor);
      break;
    case 'formula':
      buildFormula(group, bodyMat, darkMat, glassMat, chromeMat, carColor);
      break;
    case 'onewheeler':
      buildOnewheeler(group, bodyMat, darkMat, glassMat, chromeMat, carColor);
      break;
    case 'mcturbo':
      buildMcTurbo(group, bodyMat, darkMat, glassMat, chromeMat, carColor);
      break;
  }

  return group;
}

function buildGeneral(group, bodyMat, darkMat, glassMat, chromeMat, carColor) {
  // Chunky rounded hatchback - friendly cartoon car
  const bW = 7, bH = 3, bL = 11;

  // Body - rounded box
  const bodyGeo = new THREE.BoxGeometry(bW, bH, bL, 2, 2, 2);
  roundifyGeometry(bodyGeo, 0.8);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = bH / 2 + 1.5;
  body.castShadow = true;
  group.add(body);

  // Roof / cabin bump
  const roofGeo = new THREE.BoxGeometry(bW * 0.7, 2, bL * 0.4, 2, 2, 2);
  roundifyGeometry(roofGeo, 0.5);
  const roof = new THREE.Mesh(roofGeo, bodyMat);
  roof.position.y = bH + 1.8;
  roof.position.z = -bL * 0.05;
  group.add(roof);

  // Windshield (front glass)
  const windshieldGeo = new THREE.BoxGeometry(bW * 0.6, 1.5, 0.3);
  const windshield = new THREE.Mesh(windshieldGeo, glassMat);
  windshield.position.set(0, bH + 1.2, bL * 0.15);
  group.add(windshield);

  // Headlights - big round cartoon eyes
  const headlightGeo = new THREE.SphereGeometry(0.8, 8, 8);
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffaa,
    emissive: 0xffffaa,
    emissiveIntensity: 0.5,
  });
  const hlL = new THREE.Mesh(headlightGeo, headlightMat);
  hlL.position.set(-bW * 0.35, bH / 2 + 1.8, bL / 2 + 0.3);
  group.add(hlL);
  const hlR = new THREE.Mesh(headlightGeo, headlightMat);
  hlR.position.set(bW * 0.35, bH / 2 + 1.8, bL / 2 + 0.3);
  group.add(hlR);

  // Bumpers
  const bumperGeo = new THREE.BoxGeometry(bW * 1.05, 1.2, 1);
  const frontBumper = new THREE.Mesh(bumperGeo, chromeMat);
  frontBumper.position.set(0, 1.5, bL / 2 + 0.3);
  group.add(frontBumper);
  const rearBumper = new THREE.Mesh(bumperGeo, chromeMat);
  rearBumper.position.set(0, 1.5, -bL / 2 - 0.3);
  group.add(rearBumper);

  // Big chunky wheels
  addCartoonWheels(group, darkMat, bW, bL, 1.6, 1.8);
}

function buildFormula(group, bodyMat, darkMat, glassMat, chromeMat, carColor) {
  // Sleek open-wheel racer with big nose and rear wing
  const bW = 5, bH = 1.8, bL = 14;

  // Low flat body
  const bodyGeo = new THREE.BoxGeometry(bW, bH, bL, 2, 1, 2);
  roundifyGeometry(bodyGeo, 0.4);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = bH / 2 + 1.2;
  body.castShadow = true;
  group.add(body);

  // Pointed nose cone
  const noseGeo = new THREE.ConeGeometry(bW * 0.3, 5, 6);
  noseGeo.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, bodyMat);
  nose.position.set(0, bH / 2 + 1.2, bL / 2 + 2.5);
  group.add(nose);

  // Driver helmet (sphere on top)
  const helmetMat = new THREE.MeshStandardMaterial({
    color: carColor,
    emissive: carColor,
    emissiveIntensity: 0.3,
  });
  const helmetGeo = new THREE.SphereGeometry(1.2, 8, 8);
  const helmet = new THREE.Mesh(helmetGeo, helmetMat);
  helmet.position.set(0, bH + 1.8, -bL * 0.1);
  group.add(helmet);

  // Visor
  const visorGeo = new THREE.BoxGeometry(2, 0.5, 0.8);
  const visor = new THREE.Mesh(visorGeo, darkMat);
  visor.position.set(0, bH + 2, -bL * 0.1 + 0.8);
  group.add(visor);

  // Big rear wing
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const rearWingGeo = new THREE.BoxGeometry(bW * 1.8, 0.5, 1.5);
  const rearWing = new THREE.Mesh(rearWingGeo, wingMat);
  rearWing.position.set(0, bH + 2.5, -(bL / 2 - 0.5));
  group.add(rearWing);

  // Wing supports
  const supportGeo = new THREE.BoxGeometry(0.4, 2.5, 0.4);
  const sL = new THREE.Mesh(supportGeo, wingMat);
  sL.position.set(-bW * 0.5, bH + 1, -(bL / 2 - 0.5));
  group.add(sL);
  const sR = new THREE.Mesh(supportGeo, wingMat);
  sR.position.set(bW * 0.5, bH + 1, -(bL / 2 - 0.5));
  group.add(sR);

  // Front wing
  const frontWingGeo = new THREE.BoxGeometry(bW * 1.6, 0.3, 1.2);
  const frontWing = new THREE.Mesh(frontWingGeo, wingMat);
  frontWing.position.set(0, 0.8, bL / 2 + 3);
  group.add(frontWing);

  // Exposed wheels - big and chunky
  addCartoonWheels(group, darkMat, bW + 3, bL, 1.8, 2.2);
}

function buildOnewheeler(group, bodyMat, darkMat, glassMat, chromeMat, carColor) {
  // Wacky bubble car on one giant wheel
  const bW = 6, bH = 4, bL = 8;

  // Round bubble body
  const bodyGeo = new THREE.SphereGeometry(4, 12, 10);
  bodyGeo.scale(bW / 8, bH / 8, bL / 8);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 3.5;
  body.castShadow = true;
  group.add(body);

  // Big dome windshield
  const domeGeo = new THREE.SphereGeometry(2.5, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, glassMat);
  dome.position.y = 4.5;
  group.add(dome);

  // Little antenna on top
  const antennaGeo = new THREE.CylinderGeometry(0.15, 0.15, 3, 4);
  const antenna = new THREE.Mesh(antennaGeo, chromeMat);
  antenna.position.set(0, 7, 0);
  group.add(antenna);
  const antennaBallGeo = new THREE.SphereGeometry(0.5, 6, 6);
  const antennaBall = new THREE.Mesh(antennaBallGeo, bodyMat);
  antennaBall.position.set(0, 8.5, 0);
  group.add(antennaBall);

  // One giant wheel underneath
  const wheelGeo = new THREE.CylinderGeometry(2.8, 2.8, 2.5, 12);
  const wheel = new THREE.Mesh(wheelGeo, darkMat);
  wheel.rotation.z = Math.PI / 2;
  wheel.position.y = 1;
  group.add(wheel);

  // Hubcap
  const hubGeo = new THREE.CylinderGeometry(1.2, 1.2, 2.7, 8);
  const hub = new THREE.Mesh(hubGeo, chromeMat);
  hub.rotation.z = Math.PI / 2;
  hub.position.y = 1;
  group.add(hub);

  // Exhaust pipe sticking out the back
  const exhaustGeo = new THREE.CylinderGeometry(0.5, 0.6, 2, 6);
  exhaustGeo.rotateX(Math.PI / 2);
  const exhaust = new THREE.Mesh(exhaustGeo, chromeMat);
  exhaust.position.set(1.5, 2.5, -bL / 2 - 0.5);
  group.add(exhaust);
}

function buildMcTurbo(group, bodyMat, darkMat, glassMat, chromeMat, carColor) {
  // Aggressive muscle car / supercar - long, low, wide
  const bW = 7.5, bH = 2, bL = 15;

  // Long low body
  const bodyGeo = new THREE.BoxGeometry(bW, bH, bL, 2, 1, 2);
  roundifyGeometry(bodyGeo, 0.5);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = bH / 2 + 1.2;
  body.castShadow = true;
  group.add(body);

  // Hood scoop (big air intake on front)
  const scoopGeo = new THREE.BoxGeometry(2.5, 1.5, 3);
  const scoopMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const scoop = new THREE.Mesh(scoopGeo, scoopMat);
  scoop.position.set(0, bH + 1, bL * 0.2);
  group.add(scoop);

  // Low windshield
  const windshieldGeo = new THREE.BoxGeometry(bW * 0.6, 1.2, 0.3);
  const windshield = new THREE.Mesh(windshieldGeo, glassMat);
  windshield.position.set(0, bH + 1.2, -bL * 0.05);
  group.add(windshield);

  // Rear spoiler - massive
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const spoilerGeo = new THREE.BoxGeometry(bW * 1.4, 0.6, 2);
  const spoiler = new THREE.Mesh(spoilerGeo, wingMat);
  spoiler.position.set(0, bH + 2.5, -(bL / 2 - 1));
  group.add(spoiler);

  const supportGeo = new THREE.BoxGeometry(0.5, 2, 0.5);
  const sL = new THREE.Mesh(supportGeo, wingMat);
  sL.position.set(-bW * 0.4, bH + 1.2, -(bL / 2 - 1));
  group.add(sL);
  const sR = new THREE.Mesh(supportGeo, wingMat);
  sR.position.set(bW * 0.4, bH + 1.2, -(bL / 2 - 1));
  group.add(sR);

  // Twin exhaust pipes
  const exhaustGeo = new THREE.CylinderGeometry(0.5, 0.6, 2, 6);
  exhaustGeo.rotateX(Math.PI / 2);
  const exL = new THREE.Mesh(exhaustGeo, chromeMat);
  exL.position.set(-1.5, 1.2, -bL / 2 - 0.8);
  group.add(exL);
  const exR = new THREE.Mesh(exhaustGeo, chromeMat);
  exR.position.set(1.5, 1.2, -bL / 2 - 0.8);
  group.add(exR);

  // Aggressive headlights - angular
  const headlightGeo = new THREE.BoxGeometry(1.5, 0.6, 0.4);
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffaa,
    emissive: 0xffffaa,
    emissiveIntensity: 0.5,
  });
  const hlL = new THREE.Mesh(headlightGeo, headlightMat);
  hlL.position.set(-bW * 0.35, bH / 2 + 1.5, bL / 2 + 0.2);
  group.add(hlL);
  const hlR = new THREE.Mesh(headlightGeo, headlightMat);
  hlR.position.set(bW * 0.35, bH / 2 + 1.5, bL / 2 + 0.2);
  group.add(hlR);

  // Wide chunky wheels
  addCartoonWheels(group, darkMat, bW, bL, 1.5, 2.5);
}

function addCartoonWheels(group, darkMat, width, length, radius, wheelWidth) {
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    roughness: 0.2,
    metalness: 0.6,
  });

  const positions = [
    { x: -width / 2 - wheelWidth / 2, z: length / 2 - 2.5 },
    { x: width / 2 + wheelWidth / 2, z: length / 2 - 2.5 },
    { x: -width / 2 - wheelWidth / 2, z: -(length / 2 - 2.5) },
    { x: width / 2 + wheelWidth / 2, z: -(length / 2 - 2.5) },
  ];

  for (const wp of positions) {
    // Tire
    const tireGeo = new THREE.CylinderGeometry(radius, radius, wheelWidth, 10);
    const tire = new THREE.Mesh(tireGeo, darkMat);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(wp.x, radius, wp.z);
    group.add(tire);

    // Hubcap
    const hubGeo = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, wheelWidth + 0.1, 6);
    const hub = new THREE.Mesh(hubGeo, chromeMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wp.x, radius, wp.z);
    group.add(hub);
  }
}

// Utility: nudge box geometry vertices to be slightly rounded
function roundifyGeometry(geometry, amount) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length();
    if (len > 0) {
      v.normalize().multiplyScalar(len + amount * (1 - Math.abs(v.y / len)));
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function updateCarMesh(mesh, x, z, angle) {
  mesh.position.set(x, 0, z);
  mesh.rotation.y = angle;
}

export function removeCarMesh(scene, mesh) {
  scene.remove(mesh);
}
