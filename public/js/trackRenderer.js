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

  // === OIL SLICKS ===
  buildOilSlicks(trackData.oilSlicks);

  // === SCENERY ===
  addScenery(segments, roadWidth, islandBounds, trackData);

  scene.add(trackGroup);

  return { bounds, islandBounds };
}

// Compute smoothed normals to prevent self-intersecting road quads in tight corners
function computeSmoothedNormals(segs) {
  const n = segs.length;
  const smoothed = new Array(n);
  const window = 4; // blend with neighbors on each side
  for (let i = 0; i < n; i++) {
    let nx = 0, nz = 0;
    for (let j = -window; j <= window; j++) {
      const s = segs[(i + j + n) % n];
      nx += s.nx;
      nz += s.nz;
    }
    const len = Math.sqrt(nx * nx + nz * nz) || 1;
    smoothed[i] = { nx: nx / len, nz: nz / len };
  }
  return smoothed;
}

function buildRoadMesh(segs, roadWidth) {
  const vertices = [];
  const indices = [];
  const hw = roadWidth / 2;
  const smoothNormals = computeSmoothedNormals(segs);

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const sn = smoothNormals[i];
    const lx = s.x + sn.nx * hw;
    const lz = s.z + sn.nz * hw;
    const rx = s.x - sn.nx * hw;
    const rz = s.z - sn.nz * hw;
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
  const n = segs.length;
  const hw = roadWidth / 2;
  const smoothNormals = computeSmoothedNormals(segs);

  // --- Compute curvature at each segment ---
  const curvature = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const prev = segs[(i - 1 + n) % n];
    const curr = segs[i];
    // Angle difference between consecutive direction vectors
    let angleDiff = Math.atan2(curr.dirX, curr.dirZ) - Math.atan2(prev.dirX, prev.dirZ);
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    curvature[i] = Math.abs(angleDiff);
  }

  // Smooth curvature over a window for stable corner detection
  const smoothed = new Float32Array(n);
  const smoothWindow = 3;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -smoothWindow; j <= smoothWindow; j++) {
      sum += curvature[(i + j + n) % n];
    }
    smoothed[i] = sum / (smoothWindow * 2 + 1);
  }

  // --- Detect self-intersections (for figure-8 tracks) ---
  const isIntersection = new Uint8Array(n);
  const intersectDist = roadWidth * 1.1; // segments closer than road width
  const minSegGap = Math.floor(n * 0.1); // must be far apart in index to count as intersection

  for (let i = 0; i < n; i++) {
    for (let j = i + minSegGap; j < n - minSegGap + i; j++) {
      const jj = j % n;
      const dx = segs[i].x - segs[jj].x;
      const dz = segs[i].z - segs[jj].z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < intersectDist) {
        // Mark a small neighbourhood around intersection point
        for (let k = -3; k <= 3; k++) {
          isIntersection[(i + k + n) % n] = 1;
          isIntersection[(jj + k + n) % n] = 1;
        }
      }
    }
  }

  // --- Curvature threshold for corners ---
  // Higher value = curbs only on tighter corners
  const curvatureThreshold = 0.035;

  // --- Build white border on both sides ---
  const borderWidth = 1.5;
  for (const side of [-1, 1]) {
    const vertices = [];
    const indices = [];

    let vertCount = 0;
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;

      const s0 = segs[i];
      const s1 = segs[next];
      const sn0 = smoothNormals[i];
      const sn1 = smoothNormals[next];

      // Inner edge (road edge) - use smoothed normals
      const i0x = s0.x + sn0.nx * hw * side;
      const i0z = s0.z + sn0.nz * hw * side;
      const i1x = s1.x + sn1.nx * hw * side;
      const i1z = s1.z + sn1.nz * hw * side;
      // Outer edge (road edge + border)
      const o0x = s0.x + sn0.nx * (hw + borderWidth) * side;
      const o0z = s0.z + sn0.nz * (hw + borderWidth) * side;
      const o1x = s1.x + sn1.nx * (hw + borderWidth) * side;
      const o1z = s1.z + sn1.nz * (hw + borderWidth) * side;

      const vi = vertCount;
      vertices.push(i0x, 0.12, i0z);
      vertices.push(o0x, 0.12, o0z);
      vertices.push(i1x, 0.12, i1z);
      vertices.push(o1x, 0.12, o1z);
      indices.push(vi, vi + 1, vi + 2);
      indices.push(vi + 1, vi + 3, vi + 2);
      vertCount += 4;
    }

    if (vertCount > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const borderMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, side: THREE.DoubleSide });
      const border = new THREE.Mesh(geometry, borderMat);
      border.receiveShadow = true;
      trackGroup.add(border);
    }
  }

  // --- Build red/white curbs only in corners, both sides ---
  for (const side of [-1, 1]) {
    const vertices = [];
    const colors = [];
    const indices = [];

    let vertCount = 0;
    for (let i = 0; i < n; i++) {
      if (isIntersection[i]) continue;
      if (smoothed[i] < curvatureThreshold) continue;

      const next = (i + 1) % n;
      if (isIntersection[next]) continue;
      if (smoothed[next] < curvatureThreshold) continue;

      const s0 = segs[i];
      const s1 = segs[next];
      const sn0 = smoothNormals[i];
      const sn1 = smoothNormals[next];

      // Curbs sit outside the white border - use smoothed normals
      const innerOff = hw + borderWidth;
      const outerOff = hw + borderWidth + kerbWidth;

      const i0x = s0.x + sn0.nx * innerOff * side;
      const i0z = s0.z + sn0.nz * innerOff * side;
      const i1x = s1.x + sn1.nx * innerOff * side;
      const i1z = s1.z + sn1.nz * innerOff * side;
      const o0x = s0.x + sn0.nx * outerOff * side;
      const o0z = s0.z + sn0.nz * outerOff * side;
      const o1x = s1.x + sn1.nx * outerOff * side;
      const o1z = s1.z + sn1.nz * outerOff * side;

      const isRed = Math.floor(i / 3) % 2 === 0;
      const r = isRed ? 0.82 : 0.95;
      const g = isRed ? 0.1 : 0.95;
      const b = isRed ? 0.1 : 0.95;

      const vi = vertCount;
      vertices.push(i0x, 0.13, i0z);
      vertices.push(o0x, 0.13, o0z);
      vertices.push(i1x, 0.13, i1z);
      vertices.push(o1x, 0.13, o1z);
      colors.push(r, g, b, r, g, b, r, g, b, r, g, b);
      indices.push(vi, vi + 1, vi + 2);
      indices.push(vi + 1, vi + 3, vi + 2);
      vertCount += 4;
    }

    if (vertCount > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const kerbMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      const kerb = new THREE.Mesh(geometry, kerbMat);
      kerb.receiveShadow = true;
      trackGroup.add(kerb);
    }
  }
}

function buildStartLine(segs, roadWidth) {
  if (segs.length < 1) return;
  const s = segs[0];
  const lineThickness = 2;
  const ht = lineThickness / 2;

  // Build a checkered start/finish pattern using explicit geometry
  // This avoids rotation alignment issues by placing vertices directly
  const checkerSize = 3;
  const numCheckers = Math.floor(roadWidth / checkerSize);
  const totalWidth = numCheckers * checkerSize;
  const startOff = -totalWidth / 2;

  const blackVerts = [], blackIdx = [];
  const whiteVerts = [], whiteIdx = [];
  let bv = 0, wv = 0;

  for (let i = 0; i < numCheckers; i++) {
    const offset = startOff + (i + 0.5) * checkerSize;
    const cx = s.x + s.nx * offset;
    const cz = s.z + s.nz * offset;
    const hc = checkerSize / 2;

    // 4 corners using normal (across road) and direction (along road) vectors
    const x0 = cx - s.nx * hc - s.dirX * ht;
    const z0 = cz - s.nz * hc - s.dirZ * ht;
    const x1 = cx + s.nx * hc - s.dirX * ht;
    const z1 = cz + s.nz * hc - s.dirZ * ht;
    const x2 = cx + s.nx * hc + s.dirX * ht;
    const z2 = cz + s.nz * hc + s.dirZ * ht;
    const x3 = cx - s.nx * hc + s.dirX * ht;
    const z3 = cz - s.nz * hc + s.dirZ * ht;

    const isBlack = i % 2 === 0;
    const verts = isBlack ? blackVerts : whiteVerts;
    const idx = isBlack ? blackIdx : whiteIdx;
    const vi = isBlack ? bv : wv;

    verts.push(x0, 0.2, z0, x1, 0.2, z1, x2, 0.2, z2, x3, 0.2, z3);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);

    if (isBlack) bv += 4; else wv += 4;
  }

  if (blackVerts.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(blackVerts, 3));
    geo.setIndex(blackIdx);
    geo.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x111111 })));
  }

  if (whiteVerts.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(whiteVerts, 3));
    geo.setIndex(whiteIdx);
    geo.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff })));
  }
}

function buildOilSlicks(oilSlicks) {
  if (!oilSlicks || oilSlicks.length === 0) return;

  const oilMat = new THREE.MeshBasicMaterial({
    color: 0x1a1a2e,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });

  for (const oil of oilSlicks) {
    const geo = new THREE.CircleGeometry(oil.radius, 24);
    const mesh = new THREE.Mesh(geo, oilMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(oil.x, 0.18, oil.z);
    trackGroup.add(mesh);
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

  // --- Grandstands (positions from shared track data) ---
  const width = 50, depth = 25, height = 10;
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

    // Spectators
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 20; c++) {
        if (visualRng() > 0.6) continue;
        const col = spectatorColors[Math.floor(visualRng() * spectatorColors.length)];
        const dotMat = new THREE.MeshStandardMaterial({ color: col });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(-width / 2 + c * 2.5 + 1, height + 1 + r * 0.8, -depth / 2 + r * 5 + 2);
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

