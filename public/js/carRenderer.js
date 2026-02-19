import * as THREE from 'three';

export function createCarMesh(color, carType) {
  const group = new THREE.Group();

  // Car body dimensions - scaled up for visibility
  let bodyLength = 12;
  let bodyWidth = 6;
  let bodyHeight = 2.2;
  let noseLength = 3.5;

  switch (carType) {
    case 'formula':
      bodyLength = 13;
      bodyWidth = 5.5;
      noseLength = 4;
      break;
    case 'onewheeler':
      bodyLength = 9;
      bodyWidth = 5;
      bodyHeight = 2.5;
      break;
    case 'mcturbo':
      bodyLength = 14;
      bodyWidth = 6;
      noseLength = 4;
      break;
  }

  const carColor = new THREE.Color(color);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: carColor,
    roughness: 0.3,
    metalness: 0.4,
    emissive: carColor,
    emissiveIntensity: 0.15,
  });

  // Main body
  const bodyGeo = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyLength);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = bodyHeight / 2 + 0.8;
  body.castShadow = true;
  group.add(body);

  // Nose (front of car = +Z in local space, which maps to physics forward)
  const noseGeo = new THREE.BoxGeometry(bodyWidth * 0.55, bodyHeight * 0.65, noseLength);
  const nose = new THREE.Mesh(noseGeo, bodyMat);
  nose.position.y = bodyHeight / 2 + 0.6;
  nose.position.z = bodyLength / 2 + noseLength / 2 - 0.4;
  nose.castShadow = true;
  group.add(nose);

  // Cockpit (dark area on top, slightly toward rear)
  const cockpitMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.5,
  });
  const cockpitGeo = new THREE.BoxGeometry(bodyWidth * 0.45, 0.6, bodyLength * 0.3);
  const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
  cockpit.position.y = bodyHeight + 0.9;
  cockpit.position.z = -bodyLength * 0.05;
  group.add(cockpit);

  // Wheels
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const wheelGeo = new THREE.BoxGeometry(1.2, 1.0, 2.2);

  const wheelPositions = [
    { x: -bodyWidth / 2 - 0.4, z: bodyLength / 2 - 2 },   // front-left
    { x: bodyWidth / 2 + 0.4, z: bodyLength / 2 - 2 },    // front-right
    { x: -bodyWidth / 2 - 0.4, z: -(bodyLength / 2 - 2) }, // rear-left
    { x: bodyWidth / 2 + 0.4, z: -(bodyLength / 2 - 2) },  // rear-right
  ];

  if (carType === 'onewheeler') {
    const bigWheelGeo = new THREE.CylinderGeometry(2, 2, 1.5, 8);
    const wheel = new THREE.Mesh(bigWheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.y = 0.8;
    group.add(wheel);
  } else {
    for (const wp of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wp.x, 0.8, wp.z);
      group.add(wheel);
    }
  }

  // Wings for Formula and McTurbo
  if (carType === 'formula' || carType === 'mcturbo') {
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x222222 });

    // Rear wing (at -Z = back of car)
    const rearWingGeo = new THREE.BoxGeometry(bodyWidth * 1.3, 0.4, 1.2);
    const rearWing = new THREE.Mesh(rearWingGeo, wingMat);
    rearWing.position.set(0, bodyHeight + 1.2, -(bodyLength / 2 - 0.3));
    group.add(rearWing);

    const supportGeo = new THREE.BoxGeometry(0.3, 1.5, 0.3);
    const leftSupport = new THREE.Mesh(supportGeo, wingMat);
    leftSupport.position.set(-bodyWidth * 0.4, bodyHeight + 0.3, -(bodyLength / 2 - 0.3));
    group.add(leftSupport);
    const rightSupport = new THREE.Mesh(supportGeo, wingMat);
    rightSupport.position.set(bodyWidth * 0.4, bodyHeight + 0.3, -(bodyLength / 2 - 0.3));
    group.add(rightSupport);

    if (carType === 'formula') {
      // Front wing (at +Z = front of car)
      const frontWingGeo = new THREE.BoxGeometry(bodyWidth * 1.2, 0.3, 1.0);
      const frontWing = new THREE.Mesh(frontWingGeo, wingMat);
      frontWing.position.set(0, 0.6, bodyLength / 2 + noseLength * 0.7);
      group.add(frontWing);
    }
  }

  return group;
}

export function updateCarMesh(mesh, x, z, angle) {
  mesh.position.set(x, 0, z);
  // rotation.y = angle: local +Z maps to world (sin(angle), 0, cos(angle)) = physics forward
  mesh.rotation.y = angle;
}

export function removeCarMesh(scene, mesh) {
  scene.remove(mesh);
}
