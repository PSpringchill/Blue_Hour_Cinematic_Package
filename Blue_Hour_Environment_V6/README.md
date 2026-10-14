# Blue Hour v6 — Living Mountain Environment

**Build:** a runnable, single-page Three.js 0.170.0 racing game with a production-style, *optional* photogrammetry scenery pipeline. The v5 racing, three rivals, wet-road hydrology, weather, SSR/planar reflections, lighting presets, car GLB import, HUD and forest LOD are preserved.

> **Asset disclosure:** No commercial or third-party scanned textures, trees or rocks are included. The ZIP runs using improved procedural scenery. Install your own scans to replace near-camera geometry. The built-in PBR and GLB loaders support them, but do not download any external scenery assets on their own.

## What's new

1. **Terrain geometry and topography:** world-continuous seeded four-octave noise based on path coordinates, varied shoulders and hills beyond the paved surface, ~4m longitudinal / ~5.6m lateral tessellation for dirt/forest terrain; the existing 8m water grid and asphalt remain untouched. Heights are continuous across chunk boundaries and floating-origin shifts.
2. **Bounded nearby asset detail:** an instanced scenery subsystem for scanned **rock, fern, stump and shrub** meshes. Detailed GPU instances are created lazily for near chunks and reused as 64m chunks recycle. Distant detail falls back to cheap procedural geometry. Model file bytes themselves are loaded up front, after the manifest is found — *this is not network-demand streaming or automatic disk caching*.
3. **Natural procedural fallback:** shared distorted rock geometry; layered geometric fern fronds; denser ground foliage; unchanged PBR forest, grass, tree and mist systems.
4. **Optional fifth PBR scan:** scanned rock albedo, OpenGL normal and roughness maps can now be installed, in addition to road/forest/gravel/mud.
5. **Detail controls:** new **N** key / **ENV AUTO** HUD button toggles AUTO → HIGH → ECO. The quality preset **FX FAST** also reduces scenery detail. HUD shows number of scanned species and detailed chunks.
6. **Provenance checks:** new `install_scenery.py` validates basic glTF2 GLB structure, refuses external image/buffer URIs, enforces limits (85 MiB per file, 20k absolute / 4.5k–12k category-specific triangles and 8 primitives per model), and writes category, sha256, license label and source URL to a manifest. This metadata is a recorded user declaration, not third-party license verification.

## Quick start on macOS

Extract the package. From inside its `Blue_Hour_Environment_V6` folder:

```bash
python3 -m http.server 8000
```

Open **http://localhost:8000** in Chrome/Edge with hardware acceleration. The page imports pinned Three.js 0.170.0 from jsDelivr, so an **internet connection is required for JS modules**. The optional CC0 HDR from Poly Haven has a local procedural fallback. Double-click `run_local.command` if macOS permits it.

## Install real scanned materials

Download texture packs that you are allowed to use. They must contain separate **albedo/diffuse/color**, **OpenGL normal**, and **roughness** maps. 1K/2K is recommended to start.

```bash
python3 install_pbr.py \
  ~/Downloads/asphalt.zip \
  ~/Downloads/forest_ground.zip \
  --gravel ~/Downloads/gravel.zip \
  --mud ~/Downloads/wet_soil.zip \
  --rock ~/Downloads/rock.zip
```

The mandatory arguments are asphalt and forest ground; optional ZIPs can be omitted. Inputs may also be extracted folders. The tool writes `assets/textures/manifest.json` and local copies of the selected maps. Existing manifests are preserved for omitted optional slots. Do not install a DirectX normal map where an OpenGL normal map is expected.

## Install photographic GLB scenery

Use *optimized, static, self-contained* glTF2 GLB files. Each model must embed its textures and represent the intended object; leave out enormous rocks/buildings or baked worlds. Install any subset:

```bash
python3 install_scenery.py \
  --rock ~/Downloads/forest_rock.glb \
  --fern ~/Downloads/fern.glb \
  --stump ~/Downloads/tree_stump.glb \
  --shrub ~/Downloads/forest_shrub.glb \
  --license CC0 \
  --source 'https://example.com/actual-asset-landing-page'
```

Replace the example URL with the real asset's license/source page, and **set the actual license**. The installer copies models into `assets/scenery/` and writes a manifest. Missing types automatically use procedural fallbacks where provided; for `stump`, missing GLB simply means no stump model.

You can also install up to four tree species independently:

```bash
python3 install_forest.py ~/Downloads/spruce.glb ~/Downloads/pine.glb \
  --license CC0 --source 'https://example.com/actual-source'
```

Tree models should be upright with Y up; the engine normalizes scanned model extents. Keep texture atlases compact. Avoid transparent glass, skinned animation, high-poly subdivision, and large file sizes. `install_scenery.py` checks file/container metadata but **cannot prove a model will render correctly**.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Drive / steer / brake |
| Space | Handbrake |
| C, P, R | Camera, pause, recover |
| V | Storm / drizzle / clear |
| F | SSR / planar / off |
| H | Water depth debug |
| T | Day / blue hour / night |
| G | Headlight mist |
| **N** | **Environment AUTO / HIGH / ECO** |
| FX button | Graphics AUTO / CINEMA / FAST |

## Performance and design boundaries

- 32 pooled chunks × 64m; deterministic scenery placement per chunk ID; near scanned meshes create at most four categories of bounded instanced meshes per active chunk. Many material groups per GLB still cost additional draw calls; merge meshes and materials during export.
- On mobile, fewer fern, tree and shrub instances spawn. AUTO varies nearby detail radius based on a frame-time estimate, and ECO uses lightweight procedural foliage. GPU timing and memory profiling require an actual browser and device.
- Forest ground is a heightfield centered on the road: it is **not** measured terrain, hydrological erosion, collision terrain or a physically accurate geology simulator. It modifies visible land while preserving the existing drivable road and tire-water gameplay.
- GLB models load once from local files, with near/far *visibility + lazy GPU-instance* management. There is no KTX2 transcoding or true network model streaming, and assets have no cross-session cache management beyond normal browser HTTP cache.
- SSR remains limited by screen-space depth and occlusion, with the existing planar fallback. Photorealism depends on actual scanned assets, correct exposure/lighting, target hardware and GPU profiling.

## Verification

From the project root:

```bash
python3 tests/smoke_test.py
python3 tests/smoke_v4.py
python3 tests/smoke_v5.py
python3 tests/smoke_v6.py
node tests/hydrology.test.cjs
```

These checks validate HTML hooks, JavaScript parsing, hydrology behavior, terrain continuity/determinism, scenery-install manifest provenance and invalid external GLB URI rejection. They **do not validate browser WebGL compilation, actual textures, vehicle appearance or playtesting**. External jsDelivr module loading is unavailable in the isolated build/test environment, so visual acceptance remains pending on the target Mac.
