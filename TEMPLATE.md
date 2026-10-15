# Blue Hour as a template

This project is structured so a new map or a new gameplay variant is a
**data + asset change**, not a code change. `src/core/config.js` is the
single seam.

## Layout

```
index.html              markup + CSS + importmap only
src/
  main.js               engine: scene, streaming, physics, HUD, loop
  core/math.js          pure helpers (clamp, damp, seeded rand, TAU)
  core/config.js        CFG + all data tables: ROUTE, LIGHT_PRESETS,
                        WEATHER, ASSETS, CAR_SPECS, WATER, MOUNTAIN,
                        REGION, LIDAR, RL_BOUNDS, PARTICLES, MODES
  core/stream.js        asset queue, job dedupe, texture caps/decode
  render/proctex.js     procedural fallback textures + material table
  world/route.js        path ring + terrain offset, driven by ROUTE
  entities/cockpit.js   DB4 interior factory (gauges, steering wheel)
assets/                 scanned textures, nature GLBs, terrain maps
cars/                   vehicle GLBs (only aston_db4.glb tracked)
regions/                streamed 256 m world descriptors
install_*.py            asset/region/DEM pipeline installers
import_dem.py           real elevation import (ESRI ASCII)
```

## Generate a new map

1. **Route shape** — edit `ROUTE.heading` / `ROUTE.elevation` in
   `src/core/config.js`. Each row is `[amplitude, frequency, phase]`:
   heading integrates into the road's XZ position, so large
   low-frequency amplitudes make the road double back (hairpins), high
   frequencies add chatter. Keep `headingBias` so `heading(0) = 0`,
   or recompute it: `bias = -sum(amp * sin(phase))`.
   Curvature and grade derive analytically — no other code changes.
   Watch `turnLimit`: corner radius ~1/max curvature; scatter and
   terrain auto-clamp inside bends.

2. **World data** — `python3 install_regions.py --start 16 --count N`
   for synthetic descriptors, or `import_dem.py` for real elevation.
   Region files land in `regions/` and are picked up via `index.json`.

3. **Biome look** — `LIGHT_PRESETS` (per-preset Sky scattering terms,
   fog, exposure), `WEATHER`, and the texture sets under `assets/`.

4. **Vehicles** — drop a GLB at `ASSETS.playerAndTrafficCar` with the
   `FL_WHEEL/FR_WHEEL/RL_WHEEL/RR_WHEEL` node contract; wheels get
   re-pivoted onto the shared steer/spin rig automatically.

## Optional assets — all fail gracefully

| Slot | Path |
|---|---|
| Forest species | `trees/{spruce,pine,fir,birch}.glb` |
| Scenery props | `scenery/{rock,fern,stump,shrub}.glb` |
| Nature pack | `assets/nature/*.glb` + `tex/*.webp` |
| Impostor atlas | `assets/textures/impostor_atlas.png` |
| KTX2 set | `assets/textures/*.ktx2` + manifest |
| HDRI env | `assets/hdri/*.hdr` |

## Keys

WASD/drive · **B** autopilot · **C** chase → cockpit → orbit · **T** day/blue/night ·
**V** weather · **G** headlight beams · **N** near-detail quality ·
**J** world quality · **M** stream profiler · **P** pause · **R** recover

## Verify after changes

```sh
node --check src/main.js && node --check src/world/route.js
python3 -m http.server 8765   # then open http://127.0.0.1:8765/?debug
```

`?debug` exposes `window.blueHour` (state, chunks, regionPool, traffic,
variantAssets, renderer, scene, camera) for automated harnesses.
