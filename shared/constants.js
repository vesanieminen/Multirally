// Server tick rate (physics updates per second)
export const TICK_RATE = 60;

// How often state is broadcast to clients (per second)
export const BROADCAST_RATE = 20;

// Countdown before race starts
export const COUNTDOWN_SECONDS = 3;

// Number of laps to complete
export const TOTAL_LAPS = 5;

// Track surface types
export const SURFACE = {
  ROAD: 'road',
  GRASS: 'grass',
  KERB: 'kerb',
  WATER: 'water',
};

// Car type specifications
// Values are relative (0-100 scale)
export const CAR_SPECS = {
  general: {
    name: 'General',
    topSpeed: 220,
    acceleration: 380,
    gripRoad: 0.70,
    gripGrass: 0.35,
    gripKerb: 0.55,
    weight: 1.0,
    brakeForce: 500,
    steerSpeed: 3.0,
    description: 'Balanced all-rounder. Good on any surface.',
  },
  formula: {
    name: 'Formula',
    topSpeed: 260,
    acceleration: 440,
    gripRoad: 0.80,
    gripGrass: 0.15,
    gripKerb: 0.60,
    weight: 1.3,
    brakeForce: 600,
    steerSpeed: 3.2,
    description: 'Fast on asphalt, struggles off-road.',
  },
  onewheeler: {
    name: 'Onewheeler',
    topSpeed: 180,
    acceleration: 300,
    gripRoad: 0.50,
    gripGrass: 0.65,
    gripKerb: 0.50,
    weight: 0.6,
    brakeForce: 350,
    steerSpeed: 3.8,
    description: 'Slow on road but excels off-road. Very light.',
  },
  mcturbo: {
    name: 'McTurbo',
    topSpeed: 300,
    acceleration: 500,
    gripRoad: 0.60,
    gripGrass: 0.10,
    gripKerb: 0.45,
    weight: 1.1,
    brakeForce: 350,
    steerSpeed: 2.2,
    description: 'Fastest car. Hard to turn, long braking distance.',
  },
};

// Physics constants
export const PHYSICS = {
  ROLLING_RESISTANCE: 0.6,      // high - cars stop quickly when coasting
  DRAG_COEFFICIENT: 0.003,      // noticeable drag at high speed
  GRASS_SPEED_PENALTY: 0.3,     // grass kills speed hard
  WATER_DECELERATION: 2000,
  CAR_RADIUS: 4,                // collision radius
  COLLISION_RESTITUTION: 0.5,
  MIN_SPEED_TO_STEER: 2,        // can steer at low speeds
  LATERAL_GRIP_FACTOR: 2.5,     // low = lots of lateral sliding in corners
};
