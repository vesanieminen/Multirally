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
    topSpeed: 320,
    acceleration: 500,
    gripRoad: 0.55,
    gripGrass: 0.30,
    gripKerb: 0.45,
    weight: 1.0,
    brakeForce: 500,
    steerSpeed: 3.0,
    description: 'Balanced all-rounder. Good on any surface.',
  },
  formula: {
    name: 'Formula',
    topSpeed: 380,
    acceleration: 580,
    gripRoad: 0.65,
    gripGrass: 0.12,
    gripKerb: 0.50,
    weight: 1.3,
    brakeForce: 600,
    steerSpeed: 3.2,
    description: 'Fast on asphalt, struggles off-road.',
  },
  onewheeler: {
    name: 'Onewheeler',
    topSpeed: 260,
    acceleration: 400,
    gripRoad: 0.40,
    gripGrass: 0.55,
    gripKerb: 0.40,
    weight: 0.6,
    brakeForce: 350,
    steerSpeed: 3.8,
    description: 'Slow on road but excels off-road. Very light.',
  },
  mcturbo: {
    name: 'McTurbo',
    topSpeed: 450,
    acceleration: 650,
    gripRoad: 0.45,
    gripGrass: 0.08,
    gripKerb: 0.35,
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
  CAR_RADIUS: 6,                // collision radius
  COLLISION_RESTITUTION: 0.8,
  MIN_SPEED_TO_STEER: 2,        // can steer at low speeds
  STATIONARY_STEER_FACTOR: 0.15, // allows slow turning in place
  LATERAL_GRIP_FACTOR: 2.5,     // low = lots of lateral sliding in corners
};
