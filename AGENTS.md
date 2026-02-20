# AGENTS.md - AI Agent Instructions for MultiRally

## Project Overview

MultiRally is an online multiplayer top-down racing game inspired by GeneRally (2002, Finnish). Built with Three.js + Node.js + WebSockets. No build step, no bundler - vanilla ES modules throughout.

## Running & Testing

```bash
npm install
node server.js
# Open http://localhost:3000
```

There is no test suite. Verify changes by starting the server, joining a race in the browser, and playing. Use Playwright MCP or manual testing.

## Architecture

### Server-Client Split

The game uses **authoritative server physics**. The server runs the physics simulation at 60 Hz and broadcasts state to clients at 20 Hz. Clients interpolate between snapshots for smooth visuals.

**Critical rule**: Any game logic that affects gameplay (physics, collisions, surface detection, obstacle positions) MUST run on the server via `shared/`. Client-only code is purely visual/audio.

### Directory Structure

```
server.js              Game server (HTTP + WebSocket)
shared/                Shared between server and client
  constants.js         All tuning values, car specs, physics constants
  track.js             Track generation, surface detection, obstacle generation
  physics.js           Car physics, steering, collisions (all types)
public/
  index.html           Entry point with Three.js import map
  css/style.css        Styles
  js/
    main.js            Client game loop, network message handling
    renderer.js        Three.js scene, camera, lighting
    trackRenderer.js   Track mesh, kerbs, scenery (trees, grandstands)
    carRenderer.js     Car mesh creation and updates
    audio.js           Procedural Web Audio (engine, skid, collision sounds)
    input.js           Keyboard input capture
    network.js         WebSocket client wrapper
    interpolation.js   Client-side state interpolation (80ms delay)
    skidmarks.js       Tire mark trail rendering
    hud.js             UI overlays (lobby, HUD, results)
```

### Key Data Flow

1. Client captures keyboard input -> sends to server at 30 Hz
2. Server runs `updateCar()` from `shared/physics.js` at 60 Hz
3. Server broadcasts `raceState` (positions, speeds, flags) at 20 Hz
4. Client interpolates between snapshots and renders at display refresh rate

### Shared Code

Files in `shared/` are imported by both `server.js` (Node.js) and `public/js/main.js` (browser). They must:
- Use only ES module syntax (`import`/`export`)
- Contain no DOM, browser, or Node.js-specific APIs
- Be pure computation (math, data structures)

The server serves `shared/` directly via HTTP so the browser can import them at `/shared/track.js`.

## Important Patterns

### Materials & Rendering
- **Road/kerbs**: `MeshBasicMaterial` (exact color control, no lighting wash-out at isometric zoom)
- **Grass/scenery**: `MeshLambertMaterial` or `MeshStandardMaterial` (respond to lighting)
- Road color: `0x606060`, kerb colors: red `(0.82, 0.1, 0.1)` / off-white `(0.78, 0.78, 0.78)`
- Cars use bright emissive colors for visibility from above

### Deterministic Obstacle Placement
Obstacles (trees, grandstands) are generated in `shared/track.js` using a seeded RNG (`mulberry32`, seed 42). This ensures server and client produce identical obstacle positions without network transfer. The renderer reads positions from `trackData.obstacles`, using a separate RNG (seed 123) for visual-only randomness (colors, spectator placement).

### Physics Model
- 2D bicycle model with surface-dependent grip (road/grass/kerb/water)
- Collisions: car-car (elastic with weight), car-tree (circle-circle), car-grandstand (circle vs rotated rectangle)
- All obstacles are immovable; cars bounce off with restitution
- `collisionForce` tracks impact magnitude per tick for audio feedback

### Audio
All sounds are procedurally generated via Web Audio API - no audio files. Engine sound is two detuned sawtooth oscillators through a lowpass filter. Collision sounds are a low sine sweep + noise burst.

### Network Protocol
All messages are JSON over WebSocket. Key message types:
- `welcome`, `lobby`, `join`, `selectCar`, `ready` (lobby phase)
- `trackInfo`, `countdown`, `raceStart` (pre-race)
- `input` (client -> server), `raceState` (server -> client, 20 Hz)
- `raceEnd` (results)

## Common Tasks

### Adding a New Track
Add a new entry to `TRACK_DEFS` in `shared/track.js` with `name`, `width`, and `buildCenterline()` returning an array of `{x, z}` points. The track system handles everything else automatically (segments, normals, kerbs, surface detection, obstacles).

### Adding a New Car Type
Add a new entry to `CAR_SPECS` in `shared/constants.js`. Add the key to the valid car types check in `server.js` (the `selectCar` case). The lobby UI auto-generates from the spec list.

### Adding a New Obstacle Type
1. Generate positions in `generateObstacles()` in `shared/track.js`, include in returned object
2. Add collision logic in `shared/physics.js` after existing obstacle collisions
3. Add rendering in `addScenery()` in `public/js/trackRenderer.js`

### Adding Sounds
Add a new exported function in `public/js/audio.js` using Web Audio API oscillators/noise. Import and call it from `public/js/main.js`. For gameplay-triggered sounds, add a flag to car state in physics, broadcast it via `server.js`, and detect it client-side.

### Tuning Physics
All physics constants are in `shared/constants.js` under `PHYSICS`. Car-specific values are in `CAR_SPECS`. Change values there - they're shared automatically between server and client.

## Pitfalls

- **Never put gameplay logic in client-only code** - it will desync in multiplayer
- **Three.js is loaded via CDN import map** in `index.html`, not npm. Don't try to `npm install three`
- **Seeded RNG must stay in sync** - if you change obstacle generation in `shared/track.js`, the client renderer in `trackRenderer.js` must consume the same data
- **No hot reload** - restart `node server.js` after changing server or shared code. Browser code changes only need a page refresh
- **Collision force is "sticky"** - it accumulates between physics ticks and resets only when the server broadcasts. Don't reset it per-tick in physics
