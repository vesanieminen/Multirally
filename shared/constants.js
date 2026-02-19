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
    gripRoad: 0.92,
    gripGrass: 0.55,
    gripKerb: 0.80,
    weight: 1.0,
    brakeForce: 500,
    steerSpeed: 3.0,
    description: 'Balanced all-rounder. Good on any surface.',
  },
  formula: {
    name: 'Formula',
    topSpeed: 260,
    acceleration: 440,
    gripRoad: 0.98,
    gripGrass: 0.25,
    gripKerb: 0.85,
    weight: 1.3,
    brakeForce: 600,
    steerSpeed: 3.2,
    description: 'Fast on asphalt, struggles off-road.',
  },
  onewheeler: {
    name: 'Onewheeler',
    topSpeed: 180,
    acceleration: 300,
    gripRoad: 0.70,
    gripGrass: 0.90,
    gripKerb: 0.75,
    weight: 0.6,
    brakeForce: 350,
    steerSpeed: 3.8,
    description: 'Slow on road but excels off-road. Very light.',
  },
  mcturbo: {
    name: 'McTurbo',
    topSpeed: 300,
    acceleration: 500,
    gripRoad: 0.85,
    gripGrass: 0.20,
    gripKerb: 0.70,
    weight: 1.1,
    brakeForce: 350,
    steerSpeed: 2.2,
    description: 'Fastest car. Hard to turn, long braking distance.',
  },
};

// Physics constants
export const PHYSICS = {
  ROLLING_RESISTANCE: 0.06,     // very low - cars coast a long time
  DRAG_COEFFICIENT: 0.0006,     // low drag - momentum carries
  GRASS_SPEED_PENALTY: 0.6,     // max speed multiplier on grass
  WATER_DECELERATION: 2000,
  CAR_RADIUS: 4,                // collision radius
  COLLISION_RESTITUTION: 0.5,
  MIN_SPEED_TO_STEER: 3,        // can steer at lower speeds
  LATERAL_GRIP_FACTOR: 5,       // low = more sliding (was 15)
};
