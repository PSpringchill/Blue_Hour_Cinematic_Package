# BLUE HOUR v8 — Endless Region-Based World Streaming

This is an **incremental upgrade of Blue Hour v7**, not a rewrite. All previous game systems are retained: keyboard/touch driving, rivals, hydrology, PBR surface installer, optional tree and scenery GLBs, Draco/Meshopt/KTX2, SSR, rain, fog beams, day/night controls and performance instrumentation.

## What changed in v8

- **Two independent world layers:** the original **32 × 64 m pooled driving-road chunks** continue to handle road/water/collisions, while the new **8-slot pool of 256 m world regions** builds the far landscape along the route. Regions occupy the outer terrain, roughly **90–370 m on both sides of the centerline**. A fixed-size ring and floating-origin rebasing permit continuous driving without accumulating terrain meshes.
- **Disk-backed region data:** `assets/regions/manifest.json` indexes safe, local per-region `.json` files. Each file contains biome, density, relief, tint, seed and optionally two **9×9 measured/synthetic elevation grids** (`west` / `east`) with heights in meters. These samples are bilinearly interpolated and applied to the generated terrain. The game includes **16 synthetic demo regions** (4.096 km); past these it uses deterministic procedural fallback indefinitely. There are no authentic elevation scans in this package.
- **Bounded requests/cache:** the independent region loader permits **2 concurrent JSON requests** (1 mobile), limits individual descriptors to 16 KiB and the index to 128 KiB, validates index and descriptor ranges, caps the descriptor cache at **96 KiB** (evicting inactive entries), aborts off-route work, and ignores stale asynchronous results.
- **Multi-resolution terrain:** three indexed mesh resolutions: roughly **8×14 m high**, **16×24 m medium**, and **32×46 m low**, plus downward seam skirts. Region-height contributions fade to zero at longitudinal edges to avoid mismatched neighboring heightfields. A fixed maximum pool bounds new mesh allocation; the HUD measures **CPU typed-array bytes**, not actual VRAM.
- **Horizon-level vegetation impostors:** lightweight crossed, alpha-tested conifer cards built into **GPU-instanced meshes**, with placement and count controlled by biome, together with sparse low-cost rocks. No photogrammetry impostor atlases are included; these are generated in Canvas.
- **Controls:** `J` / **WORLD** cycles AUTO → HIGH → ECO. `B` opens the stream profiler with region counters, request state, buffer estimate and cache usage. Existing `N` controls near-scene detail.

## Running (macOS or other desktop OS)

Extract the ZIP. In a terminal, **from the extracted `Blue_Hour_Region_World_V8` folder**, run:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Mac users may also use `run_local.command`. A current browser with **WebGL2** and internet for pinned Three.js modules is required. `index.html` now imports `./region_world.mjs`; **do not separate these files** or open the HTML with `file://`.

## Region file contract

The included manifest uses `schema = "bluehour-region-v1"`, and each entry is an `{ "id": 0, "path": "./assets/regions/region_000000.json" }` object. Region paths must match their IDs, with no remote URLs. A descriptor looks like:

```json
{
  "id": 0,
  "biome": "pine",
  "seed": 123456789,
  "density": 0.8,
  "relief": 1.1,
  "tint": 0.02,
  "heightfield": {
    "rows": 9,
    "columns": 9,
    "west": ["81 finite numeric height offsets in metres"],
    "east": ["81 finite numeric height offsets in metres"]
  }
}
```

The quoted placeholder strings in this example must be replaced with exactly 81 numbers per side. Each value must be within −40 to +40 m. Biomes are `pine`, `rocky`, `alpine` and `mist`; density is 0.1–1.5; relief is 0.25–2; tint is −0.3–0.3. Heights are **deviations from the procedural base height**, not absolute altitudes. Their contribution is faded at the road edge and longitudinal tile boundaries for continuity. The biome data controls only distant terrain / decoration, not race physics.

### Generate additional region assets

```sh
python3 install_regions.py --start 16 --count 32
```

This generates an additional 32 synthetic region descriptors and updates the index, continuing from 4.096 km to 12.288 km. Use `--seed 3001` to change the synthetic shape; use `--overwrite` only to regenerate existing files intentionally. To use genuine survey data, replace `heightfield.west` and `.east` with resampled, height-aligned real measurements after handling the coordinate transform and edges. Always retain correct rights and provenance for imported datasets.

The region files are requested from the local Python HTTP server. This is **HTTP file-backed streaming**, not indexed database pagination, GIS reprojection, fully-fledged offline caching, or an internet terrain streaming service. The browser may cache HTTP results subject to its normal cache policy.

### Scanned PBR, trees, rocks, KTX2 (existing v7 tools)

```sh
python3 install_pbr.py ~/Downloads/asphalt.zip ~/Downloads/forest_ground.zip
python3 install_forest.py ~/Downloads/spruce.glb ~/Downloads/pine.glb --license CC0
python3 install_scenery.py --rock ~/Downloads/rock.glb --fern ~/Downloads/fern.glb --license CC0
python3 install_ktx2.py --road road_color.ktx2 road_normal.ktx2 road_roughness.ktx2
```

These real materials/models are not bundled; the included procedurally generated surfaces and impostors provide fallbacks. Check licensing and asset conventions before installation.

## Quality and performance considerations

- In AUTO, region LOD responds to distance and measured average frame time. HIGH retains more detailed distant terrain; ECO uses simpler meshes. This supplements v7 **FX AUTO/CINEMA/FAST** and near-scene **ENV AUTO/HIGH/ECO**.
- Region tiles are recycled and unused tile geometries are disposed. Total far-landscape mesh geometry is expected to stay **below 4 MiB of CPU typed-array data**, based on fixed tessellation and an eight-region pool. The warning is diagnostic; this is not a GPU VRAM allocation limit. Sprite/rock instance buffers and shared textures are outside that estimate.
- Real background terrain meshes begin at 90 m on either side of the road; the close roadway + shoulders remain governed by the original v7 geometry and water simulation.
- SRGB albedo and linear normal/roughness handling from v7 remain active. HDR is optional with procedural fallback. SSR is not ray tracing, and tree impostors are stylized sprites until real atlases are installed.
- The project retains the older fixed 32-road-chunk pool; v8 improves scenery range and streamed region descriptions, **not** a full infinitely long GIS world with independent physics/collision terrain.

## Tests

From the project root:

```sh
python3 tests/smoke_test.py
python3 tests/smoke_v4.py
python3 tests/smoke_v5.py
python3 tests/smoke_v6.py
python3 tests/smoke_v7.py
python3 tests/smoke_v8.py
python3 tests/test_ktx2.py
node tests/hydrology.test.cjs
node tests/streaming.test.cjs
node tests/region_world.test.mjs
```

Tests cover syntax, original feature contracts, local-file generation, bounded fetch concurrency, cancellation, stale callbacks, heightfield seams, validation and fallback. **Live visual/WebGL, GPU timer measurements, and browser codec decoding are still unverified here**, because Chromium is blocked from visiting even localhost by the execution environment (`ERR_BLOCKED_BY_ADMINISTRATOR`). Please run on the target Mac browser to inspect visuals and performance.
