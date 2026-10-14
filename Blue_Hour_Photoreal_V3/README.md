# Blue Hour / Photoreal Environment v3

A direct upgrade to the v2 Three.js r170 endless-road racing game. **Driving, rivals, fixed-step physics, speed and lap HUD, weather, GLB player-car import, camera, adaptive pixel ratio and floating-origin track recycling remain.**

## What's new in v3

- **Real screen-space reflections (SSR) along curved road segments.** `SSRPass` uses scene beauty, depth and normals for all selected pooled road and puddle meshes (64 render targets remain recycled with the world). It replaces the earlier fixed, flat tangent mirror while running. Only the road and puddles are marked reflective. SSR is view-dependent and cannot reflect off-screen/occluded objects: it is not ray tracing.
- **Selective SSR / planar fallback / no reflections:** Press `F` to cycle `SSR → PLANAR → OFF` on desktop. FX AUTO starts with SSR but downgrades to the planar fallback if average frame time exceeds 23 ms; FX CINEMA favors SSR, FX FAST disables expensive passes. On touch devices SSR defaults off, with the original ambient-IBL road material as the inexpensive fallback.
- **Curvature-aware wetness:** Unlike the planar mirror, the SSR samples the actual winding road meshes, grade, banking and depth. Roughness and rain still influence base PBR materials. Physically exact ray-traced reflections and full reflection continuity are not provided.
- **Terrain PBR transition strips:** Gravel progressively fades into wet soil, and soil into forest ground using dynamically generated 4-channel vertex colors (RGBA) and local PBR maps. Transition strips conform to the same path sampling as the terrain.
- **GLB forest LOD streaming:** The near-field forest renders instanced GLB species; distant chunks use efficient procedural conifers. A 35 m hysteresis prevents rapid popping at the LOD threshold. Pooling and floating-origin handling remain. Up to four species with up to six parts each are supported.
- **Improved asset installer:** Validates glTF 2.0 binary headers, static mesh presence, estimated triangle count, records optional source/license notes and SHA-256 for downloaded GLBs. Assets must be installed locally.
- **SSR cost controls:** Render resolution is scaled independently of the main WebGL resolution and capped near 1080×640. The renderer updates SSR projection matrices when the speed-dependent chase camera changes FOV.

**No third-party tree models or scanned textures are bundled.** The game remains playable without them, but its default fallback scene is synthetic. Photorealism requires suitably optimized licensed trees, scanned PBR textures, high quality vehicle meshes and visual tuning for your hardware.

## Run

```sh
cd Blue_Hour_Photoreal_V3
python3 -m http.server 8000
```

Visit `http://localhost:8000` in Chrome or another current hardware-accelerated browser. Internet is required to fetch the pinned Three.js r170 JavaScript modules. The Poly Haven 2K HDR is optional: an internal IBL fallback is available if it cannot load. Do **not** launch via `file://`, because browser fetch permissions prevent local manifests from loading properly.

**Controls:** WASD or arrows drive · Space handbrake · P pause · C orbit · V weather · **F cycle SSR/planar/off** · FX AUTO/CINEMA/FAST buttons at top right · R recover. Touch pedal controls remain on mobile.

## Install real PBR textures

Example CC0 surfaces: [Poly Haven asphalt](https://polyhaven.com/a/asphalt_02), [forest ground](https://polyhaven.com/a/forrest_ground_01). Download packages with **albedo/diffuse, OpenGL normal, and roughness** (prefer 2K). Optionally add gravel and wet soil sets.

```sh
python3 install_pbr.py ~/Downloads/asphalt.zip ~/Downloads/forest.zip \
  --gravel ~/Downloads/gravel.zip --mud ~/Downloads/wet_earth.zip
```

The program writes `assets/textures/manifest.json`. The scene uses sRGB for base-color and linear color-space normal/roughness. The overlay transition materials inherit installed parent maps. Scans do not ship with this package.

## Install real GLB forest assets

Choose **game-optimized, static, Y-up GLBs**, ideally with embedded PBR base-color / normal / alpha textures and ideally below 20k triangles per species. A photogrammetry source model with millions of polygons should be decimated or retopologized and its material textures baked before real-time use.

Potential sources (check actual model formats and licenses yourself):
- [Poly Haven tree models](https://polyhaven.com/models/nature/trees) — CC0, often very high poly, choose lower LOD and export optimized GLB.
- [Innerscene Norway spruce GLB](https://www.innerscene.com/tools/library/3d-parts/mature-norway-spruce-tree-48c2566f) — page describes a downloadable CC0 GLB.
- [Innerscene Scots pine GLB](https://www.innerscene.com/tools/library/3d-parts/mature-scots-pine-tree-280307e1) — page describes a downloadable CC0 GLB.

Install one to four files, recording provenance:

```sh
python3 install_forest.py ~/Downloads/spruce.glb ~/Downloads/pine.glb \
  --license CC0 --source 'https://your-model-source.example/asset'
```

This creates `assets/models/manifest.json`. **Models are not fetched automatically or included in this ZIP.** If source/license differs between models, edit the `source` and `license` metadata per entry after installation. The installer only records what you tell it; it cannot verify usage rights for you.

If a model is unexpectedly slow, decrease its vertex count and materials in Blender. The renderer reuses mesh geometry and GPU instancing across the endless road; only chunks near the player render the expensive meshes. Skeletons, animated trees, and arbitrary remote GLBs are intentionally unsupported for the instance renderer.

## Tune graphics / troubleshooting

- SSR has significantly higher GPU cost than planar reflections because it performs beauty, depth, normal and selective mask passes. Prefer FX FAST or RFL PLANAR for slower integrated GPUs.
- SSR can show clipped/smeared artifacts at occlusion boundaries, long distances or very low grazing angles; this is intrinsic to view-space ray marching. The material's HDR reflections remain the fallback.
- If the HUD reads `FOREST PROCEDURAL`, inspect the network tab for `assets/models/manifest.json` and your `*.glb` files. Files must have exactly the names in the generated manifest.
- If `PBR` shows fewer sets than installed, check the texture installer console and browser network responses. Photo scans are local assets and are not streamed from Poly Haven at runtime.
- Materials are currently tiled on road-local UVs. Extremely close inspection will reveal repetition and some visible transitions; next production step would be world-space triplanar terrain and physically based water accumulation tied to runoff.

## Verification and limitations

The included `tests/smoke_test.py` checks HTML structure, JS extraction/parser status, required integration contracts, 4-channel transition geometry, the glTF2 installer with a synthetic static GLB, and ZIP integrity. It does not substitute for a full GPU-driven visual verification. To evaluate visuals, open the page in Chrome, use FX CINEMA and RFL SSR, and inspect console errors and frame time while driving through sharp bends. The internet-isolated build environment could not load external Three.js modules for a full browser rendering test.

Reference: [Three.js SSRPass API](https://threejs.org/docs/#examples/en/postprocessing/SSRPass), [three.js r170 SSRPass code](https://github.com/mrdoob/three.js/blob/r170/examples/jsm/postprocessing/SSRPass.js).
