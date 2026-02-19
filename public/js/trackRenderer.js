import * as THREE from 'three';

let trackGroup = null;

export function buildTrackScene(scene, trackData) {
  // Remove old track if exists
  if (trackGroup) {
    scene.remove(trackGroup);
  }
  trackGroup = new THREE.Group();

  const { segments, roadWidth, kerbExtra, islandBounds, bounds } = trackData;

  // === WATER PLANE ===
  const waterGeo = new THREE.PlaneGeometry(1200, 1200);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x4a90d9, roughness: 0.3, metalness: 0.1 });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -6;
  trackGroup.add(water);

  // === ISLAND PLATFORM ===
  const ib = islandBounds;
  const islandWidth = ib.maxX - ib.minX;
  const islandDepth = ib.maxZ - ib.minZ;

  const grassGeo = new THREE.PlaneGeometry(islandWidth, islandDepth);
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x4CAF50 });
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.rotation.x = -Math.PI / 2;
  grass.position.set((ib.minX + ib.maxX) / 2, -0.1, (ib.minZ + ib.maxZ) / 2);
  grass.receiveShadow = true;
  trackGroup.add(grass);

  // Island sides
  const sideHeight = 6;
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xc4a36e, roughness: 0.9 });

  const frontGeo = new THREE.PlaneGeometry(islandWidth, sideHeight);
  const front = new THREE.Mesh(frontGeo, sideMat);
  front.position.set((ib.minX + ib.maxX) / 2, -sideHeight / 2, ib.maxZ);
  trackGroup.add(front);

  const back = new THREE.Mesh(frontGeo, sideMat);
  back.position.set((ib.minX + ib.maxX) / 2, -sideHeight / 2, ib.minZ);
  back.rotation.y = Math.PI;
  trackGroup.add(back);

  const sideGeo = new THREE.PlaneGeometry(islandDepth, sideHeight);
  const leftSide = new THREE.Mesh(sideGeo, sideMat);
  leftSide.position.set(ib.minX, -sideHeight / 2, (ib.minZ + ib.maxZ) / 2);
  leftSide.rotation.y = Math.PI / 2;
  trackGroup.add(leftSide);

  const rightSide = new THREE.Mesh(sideGeo, sideMat);
  rightSide.position.set(ib.maxX, -sideHeight / 2, (ib.minZ + ib.maxZ) / 2);
  rightSide.rotation.y = -Math.PI / 2;
  trackGroup.add(rightSide);

  // === ROAD SURFACE ===
  buildRoadMesh(segments, roadWidth);

  // === KERBS ===
  buildKerbs(segments, roadWidth, kerbExtra);

  // === START/FINISH LINE ===
  buildStartLine(segments, roadWidth);

  // === SCENERY ===
  addScenery(segments, roadWidth, islandBounds, trackData);

  scene.add(trackGroup);

  return { bounds, islandBounds };
}

function buildRoadMesh(segs, roadWidth) {
  const vertices = [];
  const indices = [];

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const hw = roadWidth / 2;
    const lx = s.x + s.nx * hw;
    const lz = s.z + s.nz * hw;
    const rx = s.x - s.nx * hw;
    const rz = s.z - s.nz * hw;
    vertices.push(lx, 0.15, lz);
    vertices.push(rx, 0.15, rz);
    if (i < segs.length - 1) {
      const vi = i * 2;
      indices.push(vi, vi + 1, vi + 2);
      indices.push(vi + 1, vi + 3, vi + 2);
    }
  }
  // Close loop
  const lastVi = (segs.length - 1) * 2;
  indices.push(lastVi, lastVi + 1, 0);
  indices.push(lastVi + 1, 1, 0);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const roadMat = new THREE.MeshBasicMaterial({ color: 0x606060, side: THREE.DoubleSide });
  const road = new THREE.Mesh(geometry, roadMat);
  road.receiveShadow = true;
  trackGroup.add(road);
}

function buildKerbs(segs, roadWidth, kerbExtra) {
  const kerbWidth = kerbExtra;

  for (const side of [-1, 1]) {
    const vertices = [];
    const colors = [];
    const indices = [];

    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const hw = roadWidth / 2;
      const innerX = s.x + s.nx * hw * side;
      const innerZ = s.z + s.nz * hw * side;
      const outerX = s.x + s.nx * (hw + kerbWidth) * side;
      const outerZ = s.z + s.nz * (hw + kerbWidth) * side;

      vertices.push(innerX, 0.18, innerZ);
      vertices.push(outerX, 0.18, outerZ);

      const isRed = Math.floor(i / 3) % 2 === 0;
      const r = isRed ? 0.82 : 0.78;
      const g = isRed ? 0.1 : 0.78;
      const b = isRed ? 0.1 : 0.78;
      colors.push(r, g, b, r, g, b);

      if (i < segs.length - 1) {
        const vi = i * 2;
        indices.push(vi, vi + 1, vi + 2);
        indices.push(vi + 1, vi + 3, vi + 2);
      }
    }
    const lastVi = (segs.length - 1) * 2;
    indices.push(lastVi, lastVi + 1, 0);
    indices.push(lastVi + 1, 1, 0);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const kerbMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const kerb = new THREE.Mesh(geometry, kerbMat);
    kerb.receiveShadow = true;
    trackGroup.add(kerb);
  }
}

function buildStartLine(segs, roadWidth) {
  if (segs.length < 1) return;
  const s = segs[0];
  const angle = Math.atan2(s.dirX, s.dirZ);

  const lineGeo = new THREE.PlaneGeometry(roadWidth, 2);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const line = new THREE.Mesh(lineGeo, lineMat);
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -angle;
  line.position.set(s.x, 0.2, s.z);
  trackGroup.add(line);

  const checkerSize = 3;
  const numCheckers = Math.floor(roadWidth / checkerSize);
  for (let i = 0; i < numCheckers; i++) {
    if (i % 2 === 0) {
      const cGeo = new THREE.PlaneGeometry(checkerSize, 2);
      const cMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
      const checker = new THREE.Mesh(cGeo, cMat);
      checker.rotation.x = -Math.PI / 2;
      checker.rotation.z = -angle;
      const offset = (i - numCheckers / 2 + 0.5) * checkerSize;
      checker.position.set(s.x + s.nx * offset, 0.21, s.z + s.nz * offset);
      trackGroup.add(checker);
    }
  }
}

function addScenery(segs, roadWidth, islandBounds, trackData) {
  const { trees, grandstands } = trackData.obstacles;

  // --- Trees (positions from shared track data) ---
  const trunkGeo = new THREE.CylinderGeometry(1, 1.5, 8, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B5A2B });
  const foliageColors = [0x2E8B57, 0x3CB371, 0x228B22, 0x32CD32];

  // Seeded RNG for visual variety (colors, spectator placement)
  const visualRng = mulberry32(123);

  for (const tree of trees) {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 4;
    trunk.castShadow = true;
    group.add(trunk);

    const color = foliageColors[Math.floor(visualRng() * foliageColors.length)];
    const foliageMat = new THREE.MeshStandardMaterial({ color });
    const sizes = [
      { radius: 6, height: 8, y: 10 },
      { radius: 4.5, height: 7, y: 14 },
      { radius: 3, height: 6, y: 17 },
    ];
    for (const s of sizes) {
      const coneGeo = new THREE.ConeGeometry(s.radius, s.height, 7);
      const cone = new THREE.Mesh(coneGeo, foliageMat);
      cone.position.y = s.y;
      cone.castShadow = true;
      group.add(cone);
    }

    group.scale.set(tree.scale, tree.scale, tree.scale);
    group.position.set(tree.x, 0, tree.z);
    trackGroup.add(group);
  }

  // --- Grandstands (positions from shared track data, larger size) ---
  const width = 30, depth = 15, height = 6;
  const spectatorColors = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0xe67e22, 0x9b59b6, 0xffffff];
  const dotGeo = new THREE.SphereGeometry(0.5, 4, 4);

  for (const gs of grandstands) {
    const group = new THREE.Group();
    const baseGeo = new THREE.BoxGeometry(width, height, depth);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2471A3 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = height / 2;
    base.castShadow = true;
    group.add(base);

    // Spectators (scaled for larger grandstand)
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 12; c++) {
        if (visualRng() > 0.6) continue;
        const col = spectatorColors[Math.floor(visualRng() * spectatorColors.length)];
        const dotMat = new THREE.MeshStandardMaterial({ color: col });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(-width / 2 + c * 2.5 + 1, height + 1 + r * 0.8, -depth / 2 + r * 4 + 2);
        group.add(dot);
      }
    }

    group.position.set(gs.x, 0, gs.z);
    group.rotation.y = gs.angle;
    trackGroup.add(group);
  }
}

// Simple seeded random number generator
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

