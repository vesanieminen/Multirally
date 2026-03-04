import { CAR_SPECS, PHYSICS, TOTAL_LAPS } from './constants.js';
import { track as defaultTrack } from './track.js';

// ---- Mutable physics settings (overridable at runtime via settings dialog) ----
const physicsSettings = {
  restitution: PHYSICS.COLLISION_RESTITUTION,
  spinScale: 0.3,
  maxSpinDelta: 3.0,
  maxAngularVel: 6.0,
  frictionMU: 0.3,
  inertiaMult: PHYSICS.INERTIA_MULTIPLIER || 2.5,
  rollingResistance: PHYSICS.ROLLING_RESISTANCE,
  dragCoefficient: PHYSICS.DRAG_COEFFICIENT,
  lateralGripFactor: PHYSICS.LATERAL_GRIP_FACTOR,
  angularDamping: PHYSICS.ANGULAR_DAMPING,
  grassSpeedMult: PHYSICS.GRASS_SPEED_PENALTY,
  surfaceDragRoad: PHYSICS.SURFACE_DRAG.road,
  surfaceDragKerb: PHYSICS.SURFACE_DRAG.kerb,
  surfaceDragGrass: PHYSICS.SURFACE_DRAG.grass,
  surfaceDragWater: PHYSICS.SURFACE_DRAG.water,
  surfaceDragOil: PHYSICS.SURFACE_DRAG.oil,
};

/** Update physics settings at runtime (called by server when settings change) */
export function setPhysicsSettings(s) {
  Object.assign(physicsSettings, s);
}

/** Get current physics settings (for broadcasting to clients) */
export function getPhysicsSettings() {
  return { ...physicsSettings };
}

// ---- OBB (Oriented Bounding Box) collision via SAT ----

// Reusable result object (avoids allocation per collision test)
const _obbResult = { nx: 0, nz: 0, depth: 0, contactX: 0, contactZ: 0 };

/**
 * Test overlap between two oriented bounding boxes using the Separating Axis Theorem.
 * Returns null if no overlap, or { nx, nz, depth, contactX, contactZ }.
 * Normal points from B toward A (pushes A away from B).
 */
function testOBBOverlap(carA, specsA, carB, specsB) {
  // Car A local axes: right (perpendicular to forward) and forward
  const cosA = Math.cos(carA.angle);
  const sinA = Math.sin(carA.angle);
  const aRx = cosA, aRz = -sinA;   // A right axis
  const aFx = sinA, aFz = cosA;    // A forward axis

  // Car B local axes
  const cosB = Math.cos(carB.angle);
  const sinB = Math.sin(carB.angle);
  const bRx = cosB, bRz = -sinB;   // B right axis
  const bFx = sinB, bFz = cosB;    // B forward axis

  // Vector from A center to B center
  const dx = carB.x - carA.x;
  const dz = carB.z - carA.z;

  let minOverlap = Infinity;
  let minNx = 0, minNz = 0;

  // Test axis helper (inlined below for the 4 axes to avoid allocations)
  // For each axis: project both half-extents, check overlap

  // --- Axis 1: A's right axis ---
  let ax = aRx, az = aRz;
  let pA = specsA.halfW; // A's right axis projects to just halfW
  let pB = specsB.halfW * Math.abs(ax * bRx + az * bRz) +
           specsB.halfL * Math.abs(ax * bFx + az * bFz);
  let d = ax * dx + az * dz;
  let ov = pA + pB - Math.abs(d);
  if (ov <= 0) return null;
  if (ov < minOverlap) { minOverlap = ov; minNx = d >= 0 ? -ax : ax; minNz = d >= 0 ? -az : az; }

  // --- Axis 2: A's forward axis ---
  ax = aFx; az = aFz;
  pA = specsA.halfL; // A's forward axis projects to just halfL
  pB = specsB.halfW * Math.abs(ax * bRx + az * bRz) +
       specsB.halfL * Math.abs(ax * bFx + az * bFz);
  d = ax * dx + az * dz;
  ov = pA + pB - Math.abs(d);
  if (ov <= 0) return null;
  if (ov < minOverlap) { minOverlap = ov; minNx = d >= 0 ? -ax : ax; minNz = d >= 0 ? -az : az; }

  // --- Axis 3: B's right axis ---
  ax = bRx; az = bRz;
  pA = specsA.halfW * Math.abs(ax * aRx + az * aRz) +
       specsA.halfL * Math.abs(ax * aFx + az * aFz);
  pB = specsB.halfW; // B's right axis projects to just halfW
  d = ax * dx + az * dz;
  ov = pA + pB - Math.abs(d);
  if (ov <= 0) return null;
  if (ov < minOverlap) { minOverlap = ov; minNx = d >= 0 ? -ax : ax; minNz = d >= 0 ? -az : az; }

  // --- Axis 4: B's forward axis ---
  ax = bFx; az = bFz;
  pA = specsA.halfW * Math.abs(ax * aRx + az * aRz) +
       specsA.halfL * Math.abs(ax * aFx + az * aFz);
  pB = specsB.halfL; // B's forward axis projects to just halfL
  d = ax * dx + az * dz;
  ov = pA + pB - Math.abs(d);
  if (ov <= 0) return null;
  if (ov < minOverlap) { minOverlap = ov; minNx = d >= 0 ? -ax : ax; minNz = d >= 0 ? -az : az; }

  // Contact point: midpoint of the overlapping edges along the penetration normal
  // A's edge toward B: A.pos - N * projA_onto_N
  // B's edge toward A: B.pos + N * projB_onto_N
  const projAonN = specsA.halfW * Math.abs(minNx * aRx + minNz * aRz) +
                   specsA.halfL * Math.abs(minNx * aFx + minNz * aFz);
  const projBonN = specsB.halfW * Math.abs(minNx * bRx + minNz * bRz) +
                   specsB.halfL * Math.abs(minNx * bFx + minNz * bFz);

  // A's face toward B (in -N direction from A's center)
  const aEdgeX = carA.x - minNx * projAonN;
  const aEdgeZ = carA.z - minNz * projAonN;
  // B's face toward A (in +N direction from B's center)
  const bEdgeX = carB.x + minNx * projBonN;
  const bEdgeZ = carB.z + minNz * projBonN;

  _obbResult.nx = minNx;
  _obbResult.nz = minNz;
  _obbResult.depth = minOverlap;
  _obbResult.contactX = (aEdgeX + bEdgeX) / 2;
  _obbResult.contactZ = (aEdgeZ + bEdgeZ) / 2;
  return _obbResult;
}

export function createCarState(carType, x, z, angle) {
  return {
    carType,
    x,
    z,
    angle, // radians, 0 = pointing along +Z
    speed: 0,
    vx: 0,
    vz: 0,
    angularVel: 0,
    lap: 0,
    nextCheckpoint: 0,
    lapTime: 0,
    lapTimes: [],
    bestLap: Infinity,
    totalTime: 0,
    finished: false,
    finishTime: 0,
    collisionForce: 0,
    steerAngle: 0, // visual front wheel deflection (radians)
  };
}

export function updateCar(car, input, dt, raceTrack) {
  if (car.finished) return;

  const track = raceTrack || defaultTrack;
  const specs = CAR_SPECS[car.carType];
  const surface = track.getSurface(car.x, car.z);

  // Get grip based on surface
  let grip;
  switch (surface) {
    case 'road': grip = specs.gripRoad; break;
    case 'kerb': grip = specs.gripKerb; break;
    case 'grass': grip = specs.gripGrass; break;
    case 'water': grip = 0.1; break;
    case 'oil': grip = 0.15; break;
    default: grip = specs.gripRoad;
  }

  // Forward direction (0 = +Z axis)
  const forwardX = Math.sin(car.angle);
  const forwardZ = Math.cos(car.angle);

  // Current forward speed (projection of velocity onto forward direction)
  const forwardSpeed = car.vx * forwardX + car.vz * forwardZ;

  // Lateral direction (perpendicular to forward, positive = right)
  const lateralX = Math.cos(car.angle);
  const lateralZ = -Math.sin(car.angle);
  const lateralSpeed = car.vx * lateralX + car.vz * lateralZ;

  const absSpeed = Math.sqrt(car.vx * car.vx + car.vz * car.vz);

  // --- Steering ---
  let steerInput = 0;
  if (input.left) steerInput += 1;
  if (input.right) steerInput -= 1;

  // Speed gate: need some speed to turn (no spinning in place)
  const speedGate = Math.min(1, Math.max(0.15, absSpeed / 4));
  // High-speed understeer: steering effectiveness reduces at higher speeds
  const speedRatio = Math.min(1, absSpeed / specs.topSpeed);
  const understeerFactor = 1 - 0.35 * speedRatio;
  // Reverse steering direction when going backward
  const steerDir = forwardSpeed >= 0 ? 1 : -1;
  // Effective steering rate
  const effectiveSteerRate = specs.steerSpeed * speedGate * understeerFactor * steerDir;
  car.angle += steerInput * effectiveSteerRate * dt;

  // Integrate collision-induced angular velocity
  car.angle += car.angularVel * dt;
  // Grip-based spin damping: road grip straightens the car, grass/water lets it spin longer
  const spinDamping = grip * physicsSettings.angularDamping;
  car.angularVel *= Math.max(0, 1 - spinDamping * dt);

  // Visual steer angle for front tires (smooth approach to target)
  const MAX_STEER_ANGLE = 0.45;
  const STEER_LERP_SPEED = 10;
  const targetSteerAngle = steerInput * MAX_STEER_ANGLE;
  car.steerAngle += (targetSteerAngle - car.steerAngle) * Math.min(1, STEER_LERP_SPEED * dt);

  // --- Engine force ---
  let engineForce = 0;
  if (input.throttle) {
    const topSpeedMult = surface === 'grass' ? physicsSettings.grassSpeedMult : 1.0;
    const effectiveSpeedRatio = Math.abs(forwardSpeed) / (specs.topSpeed * topSpeedMult);
    // More gradual power falloff curve
    const accelCurve = Math.max(0, 1 - Math.pow(effectiveSpeedRatio, 1.5));
    engineForce = specs.acceleration * accelCurve;
  }

  // --- Braking ---
  let brakeForce = 0;
  if (input.brake) {
    if (forwardSpeed > 3) {
      brakeForce = specs.brakeForce;
    } else {
      // Reverse at low speed
      engineForce = -specs.acceleration * 0.3;
    }
  }

  // --- Forces (divided by weight for car-relative acceleration) ---
  // Engine force in forward direction
  let ax = forwardX * engineForce / specs.weight;
  let az = forwardZ * engineForce / specs.weight;

  // Braking (opposes current velocity direction)
  if (brakeForce > 0 && absSpeed > 0.1) {
    ax -= (car.vx / absSpeed) * brakeForce / specs.weight;
    az -= (car.vz / absSpeed) * brakeForce / specs.weight;
  }

  // Rolling resistance (linear drag)
  ax -= car.vx * physicsSettings.rollingResistance;
  az -= car.vz * physicsSettings.rollingResistance;

  // Aerodynamic drag (quadratic — increases with speed squared)
  if (absSpeed > 0.1) {
    ax -= car.vx * absSpeed * physicsSettings.dragCoefficient;
    az -= car.vz * absSpeed * physicsSettings.dragCoefficient;
  }

  // --- Lateral grip (the key to good arcade handling) ---
  // slipFactor: how much the car is sliding sideways relative to forward motion
  // At low slip: full grip (clean cornering). At high slip: grip saturates (drift/powerslide)
  const slipFactor = Math.min(1, Math.abs(lateralSpeed) / (Math.abs(forwardSpeed) * 0.3 + 3));
  // Grip reduces as slip increases — creates natural grip-to-drift transition
  const baseGrip = grip * specs.cornerGrip * physicsSettings.lateralGripFactor / specs.weight;
  // Speed-dependent grip: very strong at low speed (no sliding), eases at high speed
  const speedFactor = Math.min(1, absSpeed / specs.topSpeed);
  const effectiveGrip = baseGrip * (1 + 2.5 * (1 - speedFactor));
  // Apply slip-dependent falloff
  const gripWithSlip = effectiveGrip * (1 - 0.5 * slipFactor);
  // Correction rate: how fast lateral velocity is killed (clamped for stability)
  const correctionRate = Math.min(gripWithSlip, 0.4 / dt);

  ax -= lateralX * lateralSpeed * correctionRate;
  az -= lateralZ * lateralSpeed * correctionRate;

  // Surface-specific drag (from settings instead of hard-coded values)
  const surfaceDragMap = {
    road: physicsSettings.surfaceDragRoad,
    kerb: physicsSettings.surfaceDragKerb,
    grass: physicsSettings.surfaceDragGrass,
    water: physicsSettings.surfaceDragWater,
    oil: physicsSettings.surfaceDragOil,
  };
  const surfaceDrag = surfaceDragMap[surface] || 0;
  if (surfaceDrag > 0) {
    ax -= car.vx * surfaceDrag;
    az -= car.vz * surfaceDrag;
  }

  // Integrate velocity
  car.vx += ax * dt;
  car.vz += az * dt;

  // Speed cap (safety valve — drag should prevent reaching this normally)
  const currentSpeed = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
  const maxSpeed = specs.topSpeed * 1.3;
  if (currentSpeed > maxSpeed) {
    car.vx *= maxSpeed / currentSpeed;
    car.vz *= maxSpeed / currentSpeed;
  }

  // Very low speed deadzone — stop the car completely
  if (currentSpeed < 0.5 && !input.throttle && !input.brake) {
    car.vx = 0;
    car.vz = 0;
  }

  // Integrate position
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // Update speed for HUD
  car.speed = Math.sqrt(car.vx * car.vx + car.vz * car.vz);

  // --- Skid intensity for skidmarks and sound ---
  if (car.speed > 3 && surface !== 'water') {
    // Drift: lateral sliding relative to forward motion
    const finalLateralX = Math.cos(car.angle);
    const finalLateralZ = -Math.sin(car.angle);
    const finalLateralSpeed = car.vx * finalLateralX + car.vz * finalLateralZ;
    const finalForwardX = Math.sin(car.angle);
    const finalForwardZ = Math.cos(car.angle);
    const finalForwardSpeed = car.vx * finalForwardX + car.vz * finalForwardZ;
    const driftSkid = Math.abs(finalLateralSpeed) / (Math.abs(finalForwardSpeed) * 0.15 + 2);

    // Braking: tire lock-up at speed
    const brakeSkid = input.brake && car.speed > 15 ? Math.min(car.speed / 80, 1) : 0;

    // Acceleration: wheelspin at low-to-mid speed
    const accelSkid = input.throttle && car.speed > 3 && car.speed < 60 ? (60 - car.speed) / 60 * 0.7 : 0;

    car.skidIntensity = Math.min(Math.max(driftSkid, brakeSkid, accelSkid), 1);
  } else {
    car.skidIntensity = 0;
  }

  // --- Collision with obstacles ---
  if (track.obstacles) {
    const restitution = PHYSICS.COLLISION_RESTITUTION;

    // Trees (circle vs circle)
    for (const tree of track.obstacles.trees) {
      const dx = car.x - tree.x;
      const dz = car.z - tree.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = PHYSICS.CAR_RADIUS + tree.radius;

      if (dist < minDist && dist > 0.01) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;

        // Push car out (tree is immovable)
        car.x += nx * overlap;
        car.z += nz * overlap;

        // Reflect velocity
        const vDotN = car.vx * nx + car.vz * nz;
        if (vDotN < 0) {
          car.collisionForce = Math.max(car.collisionForce, Math.abs(vDotN));
          car.vx -= (1 + restitution) * vDotN * nx;
          car.vz -= (1 + restitution) * vDotN * nz;

          // Tree hit causes spin based on hit angle
          const treeFwdX = Math.sin(car.angle);
          const treeFwdZ = Math.cos(car.angle);
          const treeCross = nx * treeFwdZ - nz * treeFwdX;
          car.angularVel += treeCross * Math.abs(vDotN) * 0.025 / specs.weight;

          // Speed penalty on obstacle impact
          const impactLoss = Math.min(0.3, Math.abs(vDotN) * 0.004 + PHYSICS.COLLISION_ENERGY_LOSS);
          car.vx *= (1 - impactLoss);
          car.vz *= (1 - impactLoss);
        }
      }
    }

    // Grandstands (circle vs rotated rectangle)
    for (const gs of track.obstacles.grandstands) {
      // Transform car position into grandstand local space
      const cos = Math.cos(-gs.angle);
      const sin = Math.sin(-gs.angle);
      const relX = car.x - gs.x;
      const relZ = car.z - gs.z;
      const localX = relX * cos - relZ * sin;
      const localZ = relX * sin + relZ * cos;

      // Find nearest point on rectangle to car center
      const clampX = Math.max(-gs.halfW, Math.min(gs.halfW, localX));
      const clampZ = Math.max(-gs.halfD, Math.min(gs.halfD, localZ));

      const dx = localX - clampX;
      const dz = localZ - clampZ;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < PHYSICS.CAR_RADIUS && dist > 0.01) {
        const overlap = PHYSICS.CAR_RADIUS - dist;
        // Normal in local space
        const lnx = dx / dist;
        const lnz = dz / dist;

        // Rotate normal back to world space
        const cosR = Math.cos(gs.angle);
        const sinR = Math.sin(gs.angle);
        const wnx = lnx * cosR - lnz * sinR;
        const wnz = lnx * sinR + lnz * cosR;

        // Push car out
        car.x += wnx * overlap;
        car.z += wnz * overlap;

        // Reflect velocity
        const vDotN = car.vx * wnx + car.vz * wnz;
        if (vDotN < 0) {
          car.collisionForce = Math.max(car.collisionForce, Math.abs(vDotN));
          car.vx -= (1 + restitution) * vDotN * wnx;
          car.vz -= (1 + restitution) * vDotN * wnz;
          // Spin from grandstand hit
          const gsFwdX = Math.sin(car.angle);
          const gsFwdZ = Math.cos(car.angle);
          const gsCross = wnx * gsFwdZ - wnz * gsFwdX;
          car.angularVel += gsCross * Math.abs(vDotN) * 0.025 / specs.weight;

          // Speed penalty on obstacle impact
          const gsLoss = Math.min(0.3, Math.abs(vDotN) * 0.004 + PHYSICS.COLLISION_ENERGY_LOSS);
          car.vx *= (1 - gsLoss);
          car.vz *= (1 - gsLoss);
        }
      } else if (dist === 0) {
        // Car center is inside the rectangle - push out along shortest axis
        const pushX = gs.halfW - Math.abs(localX);
        const pushZ = gs.halfD - Math.abs(localZ);
        let lnx = 0, lnz = 0;
        if (pushX < pushZ) {
          lnx = localX >= 0 ? 1 : -1;
          const cosR = Math.cos(gs.angle);
          const sinR = Math.sin(gs.angle);
          const wnx = lnx * cosR;
          const wnz = lnx * sinR;
          car.x += wnx * pushX;
          car.z += wnz * pushX;
          const vDotN = car.vx * wnx + car.vz * wnz;
          if (vDotN < 0) {
            car.collisionForce = Math.max(car.collisionForce, Math.abs(vDotN));
            car.vx -= (1 + restitution) * vDotN * wnx;
            car.vz -= (1 + restitution) * vDotN * wnz;
            const gsCrossA = wnx * Math.cos(car.angle) - wnz * Math.sin(car.angle);
            car.angularVel += gsCrossA * Math.abs(vDotN) * 0.025 / specs.weight;
            const gsLossA = Math.min(0.3, Math.abs(vDotN) * 0.004 + PHYSICS.COLLISION_ENERGY_LOSS);
            car.vx *= (1 - gsLossA);
            car.vz *= (1 - gsLossA);
          }
        } else {
          lnz = localZ >= 0 ? 1 : -1;
          const cosR = Math.cos(gs.angle);
          const sinR = Math.sin(gs.angle);
          const wnx = -lnz * sinR;
          const wnz = lnz * cosR;
          car.x += wnx * pushZ;
          car.z += wnz * pushZ;
          const vDotN = car.vx * wnx + car.vz * wnz;
          if (vDotN < 0) {
            car.collisionForce = Math.max(car.collisionForce, Math.abs(vDotN));
            car.vx -= (1 + restitution) * vDotN * wnx;
            car.vz -= (1 + restitution) * vDotN * wnz;
            const gsCrossB = wnx * Math.cos(car.angle) - wnz * Math.sin(car.angle);
            car.angularVel += gsCrossB * Math.abs(vDotN) * 0.025 / specs.weight;
            const gsLossB = Math.min(0.3, Math.abs(vDotN) * 0.004 + PHYSICS.COLLISION_ENERGY_LOSS);
            car.vx *= (1 - gsLossB);
            car.vz *= (1 - gsLossB);
          }
        }
      }
    }
  }

  // --- Clamp to island bounds ---
  const bounds = track.islandBounds;
  const margin = 5;
  if (car.x < bounds.minX + margin) { car.x = bounds.minX + margin; car.vx = Math.max(0, car.vx); }
  if (car.x > bounds.maxX - margin) { car.x = bounds.maxX - margin; car.vx = Math.min(0, car.vx); }
  if (car.z < bounds.minZ + margin) { car.z = bounds.minZ + margin; car.vz = Math.max(0, car.vz); }
  if (car.z > bounds.maxZ - margin) { car.z = bounds.maxZ - margin; car.vz = Math.min(0, car.vz); }

  // --- Checkpoint / Lap tracking ---
  car.totalTime += dt;
  car.lapTime += dt;

  const cp = track.checkpoints[car.nextCheckpoint];
  if (cp && track.checkCheckpoint(car, cp)) {
    car.nextCheckpoint++;
    if (car.nextCheckpoint >= track.checkpoints.length) {
      car.nextCheckpoint = 0;
      car.lap++;
      car.lapTimes.push(car.lapTime);
      if (car.lapTime < car.bestLap) {
        car.bestLap = car.lapTime;
      }
      car.lapTime = 0;

      if (car.lap >= track.totalLaps) {
        car.finished = true;
        car.finishTime = car.totalTime;
      }
    }
  }
}

/**
 * Resolve car-to-car collisions for all cars.
 * Must be called ONCE per tick, AFTER all updateCar calls complete.
 * Processes each pair exactly once (i < j) to prevent double-impulse.
 */
export function resolveCarCollisions(allCars) {
  const e = physicsSettings.restitution;
  const MU = physicsSettings.frictionMU;

  for (let i = 0; i < allCars.length; i++) {
    const carA = allCars[i];
    if (carA.finished) continue;
    const specsA = CAR_SPECS[carA.carType];

    for (let j = i + 1; j < allCars.length; j++) {
      const carB = allCars[j];
      if (carB.finished) continue;
      const specsB = CAR_SPECS[carB.carType];

      // Broad phase
      const qdx = carA.x - carB.x;
      const qdz = carA.z - carB.z;
      const quickDist2 = qdx * qdx + qdz * qdz;
      const maxReach = (specsA.halfL + specsB.halfL) * 2;
      if (quickDist2 > maxReach * maxReach) continue;

      // Narrow phase (OBB-SAT)
      const hit = testOBBOverlap(carA, specsA, carB, specsB);
      if (!hit) continue;

      const nx = hit.nx;
      const nz = hit.nz;
      const depth = hit.depth;
      const contactX = hit.contactX;
      const contactZ = hit.contactZ;

      // Position correction (mass-based push ratios)
      // Use 0.8 to nearly fully resolve overlap and prevent multi-frame impulse stacking
      const totalMass = specsA.mass + specsB.mass;
      const pushA = specsB.mass / totalMass;
      const pushB = specsA.mass / totalMass;

      const correction = depth * 0.8;
      carA.x += nx * correction * pushA;
      carA.z += nz * correction * pushA;
      carB.x -= nx * correction * pushB;
      carB.z -= nz * correction * pushB;

      // Lever arms from centers to contact point
      const rAx = contactX - carA.x;
      const rAz = contactZ - carA.z;
      const rBx = contactX - carB.x;
      const rBz = contactZ - carB.z;

      // Moment of inertia: I = mult * (1/12) * m * (w² + l²)
      const iMult = physicsSettings.inertiaMult;
      const wA = specsA.halfW * 2, lA = specsA.halfL * 2;
      const IA = iMult * (1 / 12) * specsA.mass * (wA * wA + lA * lA);
      const wB = specsB.halfW * 2, lB = specsB.halfL * 2;
      const IB = iMult * (1 / 12) * specsB.mass * (wB * wB + lB * lB);

      // Use center-of-mass relative velocity for impulse calculation
      // (not contact-point velocity — avoids angular feedback loop where
      // spin → larger contact velocity → larger impulse → more spin)
      const vrelX = carA.vx - carB.vx;
      const vrelZ = carA.vz - carB.vz;
      // Normal points from B toward A, so vrelN < 0 means approaching
      const vrelN = vrelX * nx + vrelZ * nz;

      if (vrelN >= 0) continue; // separating — no impulse needed

      // Normal impulse magnitude (j > 0)
      const denom = (1 / specsA.mass) + (1 / specsB.mass);
      const jn = -(1 + e) * vrelN / denom;

      // Push A along +n (away from B), push B along -n (away from A)
      carA.vx += (jn / specsA.mass) * nx;
      carA.vz += (jn / specsA.mass) * nz;
      carB.vx -= (jn / specsB.mass) * nx;
      carB.vz -= (jn / specsB.mass) * nz;

      // Angular impulse from lever arms, scaled down because tires on the
      // ground resist spinning (unlike free-floating rigid bodies)
      const SPIN_SCALE = physicsSettings.spinScale;
      const MAX_SPIN_DELTA = physicsSettings.maxSpinDelta;
      const MAX_ANGULAR_VEL = physicsSettings.maxAngularVel;

      // 2D cross products: r × n  (using Y-up torque: τ_y = rz*Fx - rx*Fz)
      const rAxN = rAx * nz - rAz * nx;
      const rBxN = rBx * nz - rBz * nx;

      // Force on A = +jn*n → τ_A = jn*(rAz*nx - rAx*nz) = -jn*rAxN
      // Force on B = -jn*n → τ_B = -jn*(rBz*nx - rBx*nz) = jn*rBxN
      const rawDwA = SPIN_SCALE * -(jn * rAxN) / IA;
      const rawDwB = SPIN_SCALE * (jn * rBxN) / IB;
      carA.angularVel += Math.max(-MAX_SPIN_DELTA, Math.min(MAX_SPIN_DELTA, rawDwA));
      carB.angularVel += Math.max(-MAX_SPIN_DELTA, Math.min(MAX_SPIN_DELTA, rawDwB));

      // Tangential (friction) impulse with Coulomb clamping
      const vrelTx = vrelX - vrelN * nx;
      const vrelTz = vrelZ - vrelN * nz;
      const vrelTmag = Math.sqrt(vrelTx * vrelTx + vrelTz * vrelTz);

      if (vrelTmag > 0.1) {
        const tx = vrelTx / vrelTmag;
        const tz = vrelTz / vrelTmag;

        const denomT = (1 / specsA.mass) + (1 / specsB.mass);

        let jt = vrelTmag / denomT;
        const maxFriction = MU * jn;
        if (jt > maxFriction) jt = maxFriction;

        carA.vx -= (jt / specsA.mass) * tx;
        carA.vz -= (jt / specsA.mass) * tz;
        carB.vx += (jt / specsB.mass) * tx;
        carB.vz += (jt / specsB.mass) * tz;

        // Friction on A = -jt*t → τ_A = jt*(rAx*tz - rAz*tx) = jt*rAxT
        // Friction on B = +jt*t → τ_B = -jt*(rBx*tz - rBz*tx) = -jt*rBxT
        const rAxT = rAx * tz - rAz * tx;
        const rBxT = rBx * tz - rBz * tx;
        const rawFricDwA = SPIN_SCALE * (jt * rAxT) / IA;
        const rawFricDwB = SPIN_SCALE * -(jt * rBxT) / IB;
        carA.angularVel += Math.max(-MAX_SPIN_DELTA, Math.min(MAX_SPIN_DELTA, rawFricDwA));
        carB.angularVel += Math.max(-MAX_SPIN_DELTA, Math.min(MAX_SPIN_DELTA, rawFricDwB));
      }

      // Clamp total angular velocity
      carA.angularVel = Math.max(-MAX_ANGULAR_VEL, Math.min(MAX_ANGULAR_VEL, carA.angularVel));
      carB.angularVel = Math.max(-MAX_ANGULAR_VEL, Math.min(MAX_ANGULAR_VEL, carB.angularVel));

      // Track impact force for collision sound
      carA.collisionForce = Math.max(carA.collisionForce, jn);
      carB.collisionForce = Math.max(carB.collisionForce || 0, jn);
    }
  }
}
