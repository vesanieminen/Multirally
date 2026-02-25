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
  OIL: 'oil',
};

// Car type specifications
// topSpeed in km/h (displayed directly on HUD), mass in kg for F=ma
export const CAR_SPECS = {
  general: {
    name: 'General',
    topSpeed: 160,
    acceleration: 300,
    gripRoad: 0.85,
    gripGrass: 0.35,
    gripKerb: 0.70,
    weight: 1.0,        // relative weight for collision impulse ratios
    mass: 1200,         // kg — used for F=ma physics
    brakeForce: 220,
    steerSpeed: 2.8,
    cornerGrip: 0.85,   // lateral grip factor (lower = more drifty)
    halfW: 3.5,   // collision box half-width (matches renderer bW=7)
    halfL: 5.5,   // collision box half-length (matches renderer bL=11)
    description: 'Balanced all-rounder. Good on any surface.',
  },
  formula: {
    name: 'Formula',
    topSpeed: 190,
    acceleration: 350,
    gripRoad: 0.95,
    gripGrass: 0.15,
    gripKerb: 0.80,
    weight: 1.3,
    mass: 900,
    brakeForce: 250,
    steerSpeed: 2.5,
    cornerGrip: 0.95,
    halfW: 2.5,   // narrow (bW=5)
    halfL: 7.0,   // long (bL=14)
    description: 'Fast on asphalt, struggles off-road.',
  },
  onewheeler: {
    name: 'Motorcycle',
    topSpeed: 140,
    acceleration: 280,
    gripRoad: 0.70,
    gripGrass: 0.50,
    gripKerb: 0.60,
    weight: 0.6,
    mass: 350,
    brakeForce: 150,
    steerSpeed: 3.5,
    cornerGrip: 0.75,
    halfW: 1.25,  // very narrow (bW=2.5)
    halfL: 6.0,   // long (bL=12)
    description: 'Nimble two-wheeler. Light and quick to turn.',
  },
  mcturbo: {
    name: 'McTurbo',
    topSpeed: 210,
    acceleration: 380,
    gripRoad: 0.75,
    gripGrass: 0.12,
    gripKerb: 0.55,
    weight: 1.1,
    mass: 1500,
    brakeForce: 180,
    steerSpeed: 2.0,
    cornerGrip: 0.65,
    halfW: 3.75,  // wide (bW=7.5)
    halfL: 7.5,   // longest (bL=15)
    description: 'Fastest car. Hard to turn, long braking distance.',
  },
};

// Player colors
export const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#e67e22', '#9b59b6',
                                '#1abc9c', '#e84393', '#00cec9', '#fd79a8', '#6c5ce7', '#fdcb6e'];

// Physics constants
export const PHYSICS = {
  ROLLING_RESISTANCE: 0.3,         // linear drag — gentle coast-down
  DRAG_COEFFICIENT: 0.0015,        // quadratic drag — limits top speed naturally
  GRASS_SPEED_PENALTY: 0.35,       // grass top-speed multiplier
  LATERAL_GRIP_FACTOR: 5.0,        // base lateral friction strength
  CAR_RADIUS: 6,                   // collision radius for obstacle checks
  COLLISION_RESTITUTION: 0.4,      // bounciness of collisions (0=inelastic, 1=elastic)
  COLLISION_ENERGY_LOSS: 0.15,     // fraction of speed lost on obstacle impacts
  ANGULAR_DAMPING: 3.0,            // base rate for spin recovery
  SURFACE_DRAG: {                  // additional velocity drag per surface
    road: 0,
    kerb: 0.5,
    grass: 2.0,
    water: 5.0,
    oil: 0.05,                       // very low drag — you keep speed but can't grip
  },
};
