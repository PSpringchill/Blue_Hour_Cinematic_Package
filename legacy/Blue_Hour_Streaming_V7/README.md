# Blue Hour v7 — Progressive Assets & Rendering Diagnostics

A directly upgraded build of the existing **Blue Hour v6** Three.js driving game (pinned to Three.js `0.170.0`). The existing AI opponents, car controls, endless pooled road, hydrology, weather and illumination, SSR/planar reflection, forest, scenery, and PBR systems are retained.

## What's new

1. **Progressive GLB loading:** tree/scenery manifests are discovered when the user starts the engine, not on the menu. Optional assets are loaded by a **bounded priority queue** with at most **two simultaneous GLB/PBR map requests** on desktop, one on mobile. Rocks load ahead of less visible props, and the actual scene uses procedural stand-ins until each resource is ready. Every GLB species is reused across all the road chunks; they are **not re-downloaded every time the road recycles**. The loader maintains a stable network/in-flight counter, prioritization and shared-promise deduplication.
2. **Compressed model support:** one Three.js GLTFLoader factory configures **Draco**, **Meshopt**, and **KTX2** decoders for local optional scanned GLB models and the user-imported car. Models must still be supplied separately, and the included install scripts perform only partial static GLB validation.
3. **Basis Universal KTX2 PBR:** optional direct KTX2 textures can replace regular raster maps for road, forest, gravel, mud, and rocks. The existing `install_pbr.py` for PNG/JPG scans still works. Color maps are tagged sRGB; normal/roughness are linear. Existing procedural materials remain in place until **all three maps** for a given surface load successfully. Three.js selects a GPU-supported compressed format if the texture was encoded with Basis Universal.
4. **Real-time diagnostics:** **B** toggles an in-game panel with request queue, load/failure counts, declared loaded GLB bytes, scene draw calls, triangles, WebGL geometry and texture object counts, average frame time and CPU submission timing. **GPU elapsed time** is shown only when `EXT_disjoint_timer_query_webgl2` is available and returns a valid asynchronous query. These are diagnostic measurements, not exact VRAM footprints.
5. **Progressive scenery release:** rock/fern/stump/shrub types appear as each file completes, and existing nearby instancing buffers are updated to include newly available categories. Distant chunks still display simple procedural models. Model geometry cannot be automatically evicted while it is referenced by pooled chunks.

## Run

Extract the ZIP, enter `Blue_Hour_Streaming_V7` in Terminal, and run:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 in Chrome/Edge/Safari with WebGL2 hardware acceleration. `run_local.command` is included on macOS. **An internet connection is required** for the pinned Three.js modules and, when used, the decoding WASM libraries served from jsDelivr. HDR lighting falls back to the local procedural environment if the optional HDR fails.

Controls: **WASD/arrow keys** to drive; **Space** drift; **C** camera; **P** pause; **R** recover; **V** rain; **F** reflections; **H** water map; **T** time of day; **G** fog beams; **N** environment detail; **B** stream/GPU diagnostics.

## Install scanned texture packs (existing workflow)

```sh
python3 install_pbr.py ~/Downloads/asphalt.zip ~/Downloads/forest_ground.zip \
  --gravel ~/Downloads/gravel.zip --mud ~/Downloads/mud.zip --rock ~/Downloads/rock.zip
```

Requires color, **OpenGL (+Y) normal**, and roughness maps. The script installs their source files and creates `assets/textures/manifest.json`. All files remain on your computer; no scans are bundled.

## Install compressed Basis Universal KTX2 PBR maps (new)

First use **Khronos KTX-Software `toktx`** or a comparable converter to create three *actual, complete, Basis Universal encoded* KTX2 files for each material. The included script does **not** convert PNG/JPG to KTX2. Texture input roles:

- Albedo/color: use sRGB encoding.
- OpenGL normal: use linear encoding (do not invert the green channel).
- Roughness: use linear encoding.

```sh
python3 install_ktx2.py \
  --road ~/Downloads/road_color.ktx2 ~/Downloads/road_normal.ktx2 ~/Downloads/road_roughness.ktx2 \
  --forest ~/Downloads/forest_color.ktx2 ~/Downloads/forest_normal.ktx2 ~/Downloads/forest_roughness.ktx2 \
  --license CC0 --source 'https://example.com/YOUR-ACTUAL-ASSET-PAGE'
```

The installer validates file signatures and header fields, dimensions (max 4096×4096), 2D single-layer limits, and size (max 48 MiB each) and records hashes. **Header validation is not equivalent to full KTX2/Basis transcoding validation**; a browser/GPU check is still needed. Run the script for any subset of `--road`, `--forest`, `--gravel`, `--mud`, `--rock`; unmentioned materials are preserved in the texture manifest. It does not verify asset licensing; the label is user-declared. If a compressed map is corrupt or unsupported, the corresponding material retains the procedural fallback.

## Install detailed forest and scenery GLBs (existing workflow)

```sh
python3 install_forest.py ~/Downloads/spruce.glb ~/Downloads/pine.glb --license CC0
python3 install_scenery.py \
  --rock ~/Downloads/forest_rock.glb \
  --fern ~/Downloads/fern.glb \
  --stump ~/Downloads/stump.glb \
  --shrub ~/Downloads/shrub.glb --license CC0
```

Use valid rights/licensing for all files. GLBs should be static, self-contained, Y-up, and optimized for instancing. The decoder configuration can open GLBs compressed with Draco or Meshopt if produced by a compatible glTF compression tool. Compressed geometry may require additional validation in your toolchain, since the included installer only checks basic container metadata and its inferred triangle counts.

## Important performance boundaries

- This is **bounded, progressive asset loading**, not a global-world tile CDN or 3D streaming engine. Every installed scanned tree or scenery type is shared across all chunks. The v6 procedural world still has 32 pooled 64-m road chunks.
- KTX2/Basis typically reduces transmitted asset size and GPU texture memory versus uncompressed textures, depending on encoding, device, transcoder, and selected format. This project cannot measure actual GPU VRAM usage across browsers.
- GLTF geometry and materials are retained while in use by instanced chunks. There is **no geometry cache eviction, automatic HTTP offline cache, or full 3D LOD hierarchy**.
- Reflections remain screen-space or planar approximations, not ray tracing. Authentic photogrammetry assets are **not bundled**.
- GPU timer extensions can be unsupported or disjoint. If unavailable, the profiler shows **UNAVAILABLE**, not an invented GPU time.

## Tests (without GPU)

```sh
python3 tests/smoke_test.py
python3 tests/smoke_v4.py
python3 tests/smoke_v5.py
python3 tests/smoke_v6.py
python3 tests/smoke_v7.py
python3 tests/test_ktx2.py
node tests/hydrology.test.cjs
node tests/streaming.test.cjs
```

These test syntactic correctness and static integration; the isolated queue test verifies priority, concurrent request cap, duplicate suppression and failures. The KTX2 test uses a **synthetic header only**, not a real compressed texture. Real browser, GPU, network, and compression-decoder functionality must be validated on your target computer. Browser test was attempted in the build environment but local navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR` before WebGL startup.
