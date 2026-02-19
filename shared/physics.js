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

  // Steering is proportional to speed (can't steer when stopped)
  const speedFactor = Math.min(Math.abs(forwardSpeed) / PHYSICS.MIN_SPEED_TO_STEER, 1);
  const steerRate = specs.steerSpeed * speedFactor;

  // At very high speed, reduce steering slightly for stability
  const highSpeedFactor = 1.0 - Math.max(0, (Math.abs(forwardSpeed) - specs.topSpeed * 0.7)) / (specs.topSpeed * 0.5) * 0.3;

  // Reverse steering direction when going backwards
  const steerDir = forwardSpeed >= 0 ? 1 : -1;
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
