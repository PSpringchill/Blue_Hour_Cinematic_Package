# BLUE HOUR v5 — Atmospheric Lighting & Weather Integration

Direct upgrade of **Blue Hour Hydrodynamics v4** (Three.js r170). The racing game remains intact: procedurally streamed mountainous road, three AI rivals, vehicle dynamics and camera, scanned PBR texture integration, optional GLB forests, LOD, wet asphalt and retained-water model, SSR/planar/off reflections, and the original HUD. No licensed photogrammetry files are bundled.

## New in v5

1. **Three smoothly transitioning lighting presets** — DAY / BLUE / NIGHT, with coordinated procedural sky colors, scene-fog color, hemisphere illumination, directional lighting, tone mapping, and vehicle-headlight strength. Night introduces a small GPU star field that is occluded by nearer terrain through normal depth testing.
2. **Headlight mist beams** — two shared low-poly tapered volumes attached to the player vehicle, with animated turbulence and weather-dependent scattering. This is an artistic *single-scatter approximation*, **not** physically traced volumetric light or ray tracing. The beam toggles with **G** / **BEAMS**; fast graphics disables them, while adaptive graphics may suppress them during slow frames.
3. **Headlight-aware rain shader** — existing fixed-size raindrop segments are highlighted when they pass through the forward headlamp cone. World-space projection uses the player's real transform as the road curves and slopes; no new particle systems are allocated.
4. **Forest canopy wind** — the fallback instanced conifer canopy has cheap shader bending with staggered per-instance phases, tied to rain/wind intensity. Imported GLB trees preserve their native shaders, materials and LOD rather than receiving an unsafe generic deformation.
5. **Atmospheric sky motion** — slowly drifting procedural cloud variation and twinkling night stars.
6. **Frame-pacing HUD** — rolling approximate FPS and 1%-low FPS (measured CPU/frame intervals, **not actual GPU timing**). Displays lighting phase, beam activity, wind magnitude, draw calls and triangles via existing HUD.

### Run

Extract the archive and open Terminal in the project folder:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000> with Chrome or Edge, hardware acceleration enabled. The HTML loads pinned **Three.js 0.170.0** JavaScript modules from jsDelivr. An internet connection is required for these modules. The optional Poly Haven HDR environment has a procedural fallback.

The included `run_local.command` also runs the local server on macOS.

### Controls

| Control | Action |
| --- | --- |
| WASD / arrow keys | Drive |
| Space | Handbrake / drift |
| R | Recover |
| P | Pause |
| C | Orbit camera and pause |
| V | STORM → DRIZZLE → CLEAR |
| F | SSR → planar reflection → off, availability depends on device |
| H | Standing water depth diagnostic |
| **T** / **TIME** | **DAY → BLUE → NIGHT lighting** |
| **G** / **BEAMS** | **Toggle fog-scattering headlamp volumes** |
| FX AUTO / CINEMA / FAST | Adaptive graphics, cinematic quality, low-cost fallback |

Mobile users have steering and pedal touch controls. The new atmosphere controls are HUD buttons as well as keyboard shortcuts; small displays may require landscape orientation.

### Optional PBR materials and photogrammetry

Install your own appropriately licensed scanned PBR assets. Neither scripts nor HTML download model packs automatically:

```bash
python3 install_pbr.py ~/Downloads/asphalt.zip ~/Downloads/forest.zip \
    --gravel ~/Downloads/gravel.zip --mud ~/Downloads/mud.zip

python3 install_forest.py ~/Downloads/spruce.glb ~/Downloads/pine.glb \
    --license CC0 --source 'https://example.com/source'
```

Use **OpenGL** tangent-space normal maps, albedo and roughness textures. The vehicle's existing **LOAD GLB** option remains available. The example `--source` is a placeholder; add the real asset source URL and ensure your actual model license permits use.

### Performance budget and limitations

- The 2 light shafts share a single 22-sided tube geometry/material and are only visible in rainy non-orbit camera conditions on the AUTO/CINEMA presets. They do not cast shadows.
- Stars render in a single small point cloud (340 on touch/mobile and 960 on desktop). Their positions are deterministic and follow camera translation; near terrain occludes them using depth testing.
- Lit rain uses 2 vector uniforms and a cheap cone test per existing rain vertex. It doesn't alter the fixed particle count.
- Canopy bending applies to lightweight fallback conifers only. Scanned GLBs should be optimized for real-time use; material/geometry complexity dominates memory and draw cost.
- **FX AUTO** first sacrifices fog-beam scattering at frame times above ~21 ms, in addition to inherited SSR quality changes and dynamic resolution scaling.
- Sunlight, fog, water, and grip continue to use the v4 approximations. The dynamic lighting is art-directable, **not** astronomically correct or physically calibrated.
- WebGL performance is GPU/browser/device-dependent. The measured FPS/1%-low indicators are approximate rolling frame intervals, not GPU timer queries.

### Static and component checks

```bash
python3 tests/smoke_test.py
python3 tests/smoke_v4.py
python3 tests/smoke_v5.py
node tests/hydrology.test.cjs
```

These check HTML IDs, JS syntax via Node, reference/preserved modules, atmosphere data flow, smoke and optional-GLB installer, hydrology evolution and bounds. They are **not** a visual or end-to-end browser acceptance test. Full rendering remains unverified here because the Three.js CDN is unavailable to the isolated build runtime. Before production, test all dayparts and weather settings in a GPU-enabled Chrome/Edge browser, verify the browser console is clean, and profile AUTO vs CINEMA on target hardware.
