# MultiRally

Online multiplayer top-down racing game inspired by [GeneRally](https://en.wikipedia.org/wiki/GeneRally) (2002, Finland).

Built with Three.js, Node.js, and WebSockets. No build step required.

![Screenshot](https://img.shields.io/badge/status-playable-brightgreen)

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:3000 in your browser. Share the URL on your local network for multiplayer.

## How to Play

1. Enter your name and click **Join**
2. Choose a car type
3. Click **Ready** (race starts when all players are ready)
4. Race!

### Controls

| Key | Action |
|-----|--------|
| Arrow Up | Accelerate |
| Arrow Down | Brake / Reverse |
| Arrow Left | Steer left |
| Arrow Right | Steer right |

Cars can steer slowly even when stationary.

## Car Types

| Car | Top Speed | Grip | Best For |
|-----|-----------|------|----------|
| **General** | Medium | Balanced | All-round driving |
| **Formula** | Fast | High on road, poor off-road | Staying on track |
| **Onewheeler** | Slow | Best off-road | Cutting corners on grass |
| **McTurbo** | Fastest | Low | Straights, experienced drivers |

## Features

- 7 procedurally generated track layouts (oval, figure-8, kidney, peanut, etc.)
- Random track selection each race
- Authoritative server physics (60 Hz tick, 20 Hz broadcast)
- Client-side interpolation for smooth visuals
- Surface physics: road, kerbs, grass, water
- Drifting and skidmarks
- Collisions with other cars, trees, and grandstands
- Procedural audio: engine, skid, countdown, and collision sounds
- 5-lap races with lap timing and leaderboard

## Architecture

```
server.js          HTTP + WebSocket game server
shared/
  constants.js     Physics tuning, car specs
  track.js         Track generation, surface detection, obstacles
  physics.js       Car physics, collisions (runs on server)
public/
  index.html       Entry point
  js/
    main.js        Game loop, network message handling
    renderer.js    Three.js scene setup, camera
    trackRenderer.js  Track, scenery, grandstand meshes
    carRenderer.js    Car mesh creation
    audio.js       Procedural Web Audio (engine, skid, collisions)
    input.js       Keyboard input
    network.js     WebSocket client
    interpolation.js  Client-side state interpolation
    skidmarks.js   Skidmark trail rendering
    hud.js         UI overlays (lobby, HUD, results)
```

Physics and track data are shared between server and client via the `shared/` directory to ensure deterministic obstacle placement and consistent surface detection.

## Tech Stack

- **Rendering**: Three.js v0.183.0 (via CDN import map)
- **Server**: Node.js with `ws` for WebSockets
- **Audio**: Web Audio API (procedural, no audio files)
- **Modules**: ES modules throughout, no bundler needed

## License

MIT
