# Blue Hour Engine

Modular rebuild of the Blue Hour driving world. The legacy app at the
repo root (`index.html` + `src/main.js`) remains the playable build
until this tree reaches feature parity.

## Run

```sh
python3 -m http.server 8765   # from the repo root
# open http://127.0.0.1:8765/engine/
```

`?debug` exposes `window.__engine` (scene, renderer, queue, env).

## Layout

```text
engine/
  index.html             importmap + canvas + status overlay only
  src/
    core/
      config.js          every tunable table (CFG, ROUTE, presets,
                         ASSETS, CAR_SPECS, WATER, REGION, LIDAR,
                         RL_BOUNDS, PARTICLES, MODES)
      math.js            pure helpers (clamp, damp, seeded rand, TAU)
      events.js          event bus — layer decoupling
      loop.js            fixed-step sim + rAF render
      stream.js          priority queue, job dedupe, texture caps,
                         raster-decode semaphore
      assets.js          GLTF/Draco/Meshopt/KTX2 loaders, pbrTexture
    render/
      renderer.js        WebGL2 renderer + composer (bloom, film grade)
      environment.js     Sky shader, stars, light rig, PMREM/HDRI,
                         preset blending
      proctex.js         procedural fallback textures + material table
      reflections.js     (port pending) planar Reflector + lazy SSR
    world/
      route.js           path ring + terrain offset from ROUTE tables
      chunks.js          (port pending) TrackChunk stream window
      regions.js         (port pending) 256 m far-terrain pool
      water.js           (port pending) standing-water grid
      backdrop.js        (port pending) massif + ridgelines
    entities/
      cockpit.js         DB4 interior (gauges, steering)
      vehicles.js        (port pending) CAR_SPECS + LOD swap
      forest.js          (port pending) species + tree LOD tiers
      particles.js       (port pending) rain, spray, lens drops
    ai/
      tracking.js        Kalman filters + obstacle tracker
      lidar.js           (port pending) 6-ray sweep
      autopilot.js       (port pending) controller + online learner
    ui/
      (port pending)     HUD, minimap, diagnostics, profiler, autotest
    app/
      main.js            bootstrap — wires the layers above
```

## Staged roadmap (legacy lineage → modules)

| stage | source pack         | lands in
| ----- | ------------------- | --------
| PBR   | PBR_Environment     | render/* + core/assets.js (done)
| V2    | Next_Level          | entities/forest.js, proctex
| V3    | Photoreal           | render/postfx, reflections
| V4    | Hydrodynamics       | world/water.js
| V5    | Atmosphere          | render/environment.js (done)
| V6    | Environment         | entities/forest+scenery variants
| V7    | Streaming           | world/regions.js, core/stream.js (done)
| V8    | Region_World        | world/regions.js descriptors
| V9    | Terrain_Data        | DEM import + impostor atlas
| V10+  | current app         | vehicles, cockpit, autopilot, UI

Legacy single-file snapshots are archived under `legacy/`; their
data (regions, manifests, tests, examples) is merged into
`regions/`, `tests/`, `examples/`.
