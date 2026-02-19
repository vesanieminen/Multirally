import { CAR_SPECS, PHYSICS, TOTAL_LAPS } from './constants.js';
import { track as defaultTrack } from './track.js';

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
    bestLap: Infinity,
    totalTime: 0,
    finished: false,
    finishTime: 0,
    collisionForce: 0,
  };
}

export function updateCar(car, input, dt, allCars, raceTrack) {
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
    default: grip = specs.gripRoad;
  }

  // Forward direction
  const forwardX = Math.sin(car.angle);
  const forwardZ = Math.cos(car.angle);

  // Current forward speed (projection of velocity onto forward direction)
  const forwardSpeed = car.vx * forwardX + car.vz * forwardZ;

  // Lateral direction (perpendicular to forward)
  const lateralX = Math.cos(car.angle);
  const lateralZ = -Math.sin(car.angle);
  const lateralSpeed = car.vx * lateralX + car.vz * lateralZ;

  // --- Steering ---
  let steerInput = 0;
  if (input.left) steerInput += 1;
  if (input.right) steerInput -= 1;

  // Steering scales with speed but allows slow turning when stationary
  const speedFactor = Math.min(Math.abs(forwardSpeed) / PHYSICS.MIN_SPEED_TO_STEER, 1);
  const steerRate = specs.steerSpeed * Math.max(speedFactor, PHYSICS.STATIONARY_STEER_FACTOR);

  // At very high speed, reduce steering slightly for stability
  const highSpeedFactor = 1.0 - Math.max(0, (Math.abs(forwardSpeed) - specs.topSpeed * 0.7)) / (specs.topSpeed * 0.5) * 0.3;

  // Reverse steering direction when going backwards (no flip when stationary)
  const steerDir = Math.abs(forwardSpeed) < 0.5 ? 1 : (forwardSpeed >= 0 ? 1 : -1);
  car.angle += steerInput * steerRate * steerDir * highSpeedFactor * dt;

  // --- Engine force ---
  let engineForce = 0;
  if (input.throttle) {
    const topSpeedMult = surface === 'grass' ? PHYSICS.GRASS_SPEED_PENALTY : 1.0;
    const effectiveSpeedRatio = Math.abs(forwardSpeed) / (specs.topSpeed * topSpeedMult);
    const accelCurve = Math.max(0, 1 - effectiveSpeedRatio);
    engineForce = specs.acceleration * accelCurve;
  }

  // --- Braking ---
  let brakeForce = 0;
  if (input.brake) {
    if (forwardSpeed > 5) {
      brakeForce = specs.brakeForce;
    } else {
      // Reverse
      engineForce = -specs.acceleration * 0.4;
    }
  }

  // --- Forces ---
  // Apply engine force in forward direction
  let ax = forwardX * engineForce / specs.weight;
  let az = forwardZ * engineForce / specs.weight;

  // Braking (opposes current velocity direction)
  if (brakeForce > 0 && (car.vx !== 0 || car.vz !== 0)) {
    const speed = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
    if (speed > 0.1) {
      ax -= (car.vx / speed) * brakeForce / specs.weight;
      az -= (car.vz / speed) * brakeForce / specs.weight;
    }
  }

  // Rolling resistance
  ax -= car.vx * PHYSICS.ROLLING_RESISTANCE;
  az -= car.vz * PHYSICS.ROLLING_RESISTANCE;

  // Aerodynamic drag (quadratic)
  const speed = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
  if (speed > 0.1) {
    ax -= car.vx * speed * PHYSICS.DRAG_COEFFICIENT;
    az -= car.vz * speed * PHYSICS.DRAG_COEFFICIENT;
  }

  // Lateral friction (grip) - this controls how much the car slides
  // Lower values = more sliding/drifting, higher = more grip
  const lateralGripForce = grip * PHYSICS.LATERAL_GRIP_FACTOR / specs.weight;

  // Allow sliding: only correct a fraction of lateral speed per tick
  // Very low correction = huge drifts, feels like rally on gravel
  const correctionRate = Math.min(lateralGripForce, 0.3 / dt);

  // Apply lateral friction
  ax -= lateralX * lateralSpeed * correctionRate;
  az -= lateralZ * lateralSpeed * correctionRate;

  // Grass: heavy speed penalty - like driving through mud
  if (surface === 'grass') {
    ax -= car.vx * 1.5;
    az -= car.vz * 1.5;
  }

  // Kerb: moderate speed penalty
  if (surface === 'kerb') {
    ax -= car.vx * 0.4;
    az -= car.vz * 0.4;
  }

  // Water: extreme deceleration
  if (surface === 'water') {
    ax -= car.vx * 4;
    az -= car.vz * 4;
  }

  // Integrate velocity
  car.vx += ax * dt;
  car.vz += az * dt;

  // Speed cap
  const currentSpeed = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
  const maxSpeed = specs.topSpeed * 1.5; // slight overshoot allowed
  if (currentSpeed > maxSpeed) {
    car.vx *= maxSpeed / currentSpeed;
    car.vz *= maxSpeed / currentSpeed;
  }

  // Very low speed deadzone
  if (currentSpeed < 1 && !input.throttle && !input.brake) {
    car.vx = 0;
    car.vz = 0;
  }

  // Integrate position
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // Update speed for HUD
  car.speed = Math.sqrt(car.vx * car.vx + car.vz * car.vz);

  // Skid intensity for skidmarks and sound (all surfaces except water)
  if (car.speed > 5 && surface !== 'water') {
    // Drift: lateral sliding during turns
    const finalLateralX = Math.cos(car.angle);
    const finalLateralZ = -Math.sin(car.angle);
    const finalLateralSpeed = car.vx * finalLateralX + car.vz * finalLateralZ;
    const finalForwardX = Math.sin(car.angle);
    const finalForwardZ = Math.cos(car.angle);
    const finalForwardSpeed = car.vx * finalForwardX + car.vz * finalForwardZ;
    const driftSkid = Math.abs(finalLateralSpeed) / (Math.abs(finalForwardSpeed) * 0.2 + 5);

    // Braking: tire lock-up when braking at speed
    const brakeSkid = input.brake && car.speed > 30 ? Math.min(car.speed / 150, 1) : 0;

    // Acceleration: wheelspin when flooring it at low-to-mid speed
    const accelSkid = input.throttle && car.speed > 5 && car.speed < 100 ? (100 - car.speed) / 100 * 0.7 : 0;

    car.skidIntensity = Math.min(Math.max(driftSkid, brakeSkid, accelSkid), 1);
  } else {
    car.skidIntensity = 0;
  }

  // --- Collision with other cars ---
  if (allCars) {
    for (const other of allCars) {
      if (other === car || other.finished) continue;
      const dx = car.x - other.x;
      const dz = car.z - other.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = PHYSICS.CAR_RADIUS * 2;

      if (dist < minDist && dist > 0.01) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;

        const totalWeight = specs.weight + CAR_SPECS[other.carType].weight;
        const pushRatio = CAR_SPECS[other.carType].weight / totalWeight;
        const otherPushRatio = specs.weight / totalWeight;

        car.x += nx * overlap * pushRatio;
        car.z += nz * overlap * pushRatio;
        other.x -= nx * overlap * otherPushRatio;
        other.z -= nz * overlap * otherPushRatio;

        const dvx = car.vx - other.vx;
        const dvz = car.vz - other.vz;
        const dvDotN = dvx * nx + dvz * nz;

        if (dvDotN > 0) {
          const impulse = dvDotN * PHYSICS.COLLISION_RESTITUTION;
          car.vx -= impulse * pushRatio * nx;
          car.vz -= impulse * pushRatio * nz;
          other.vx += impulse * otherPushRatio * nx;
          other.vz += impulse * otherPushRatio * nz;
          // Track impact force for sound
          const force = dvDotN;
          car.collisionForce = Math.max(car.collisionForce, force);
          other.collisionForce = Math.max(other.collisionForce || 0, force);
        }
      }
    }
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
