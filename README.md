# BLUE HOUR — Cinematic Wet-Road Driving

A visual upgrade of the original `Html.html` Three.js driving demo. The playable road, rival AI, ambient two-way traffic, vehicle physics, controls, HUD, floating-origin renderer, and optional GLB car import were retained.

## Run

1. Keep the included `index.html` in this folder.
2. From a terminal in this folder, run `python3 -m http.server 8000` (or another local HTTP server).
3. Open <http://localhost:8000> in a hardware-accelerated modern browser. An internet connection is needed for the pinned Three.js modules served via jsDelivr and for the optional Poly Haven HDR. The HDR has a procedural fallback; the Three.js modules do not.
4. Click **START ENGINE**.

## Controls

- W / up arrow: accelerate
- S / down arrow: brake
- A, D / left, right arrow: steer
- Space: handbrake drift
- R: recover
- P: pause
- C: orbit inspection camera
- F: cycle reflections — screen-space (SSR) → planar mirror → off
- H: water-depth telemetry overlay (grid, frame ms, draw calls, triangles)
- T: lighting presets — day / blue hour / night with smooth transitions
- G: toggle headlight fog-scattering beams
- B: toggle lidar autopilot — 6-ray sensing, lane keeping, traffic avoidance
- N: environment density — AUTO / HIGH / ECO (AUTO follows frame time)
- M: stream profiler — asset queue, GPU/CPU render timing, memory stats
- J: distant world — AUTO / HIGH / ECO (LOD radii and impostor density)
- V: cycle storm / drizzle / clear weather
- RAIN button: cycle weather
- FX button: adaptive / cinematic / performance rendering
- LOAD GLB: optional embedded `.glb` car model, Y-up and +Z forward; named wheel pivots `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr` for animation support

## Visual improvements

- Layered terrain and continuous far-field mountain silhouettes
- Multi-whorl instanced evergreen trees, shrubs, and rocky verges
- Scanned PBR asphalt, muddy verge, and forest ground (diffuse + OpenGL normal + roughness) with procedural fallback
- Simulated surface water: 512 m depth grid in road space — rain accumulation, drainage/drying, shoulder runoff, wheel-rut pooling, and tire displacement
- Water depth drives road darkening and roughness in the asphalt shader, puddle opacity, wheel spray, grip loss (aquaplaning warning), and reflection strength
- Screen-space reflections (SSRPass) ray-marching scene depth over the road, with planar-mirror and off modes on F; auto-fallback to planar when frame times degrade
- Mirrored-camera planar road reflections masked into irregular wet patches
- Distinct material zones — asphalt, muddy shoulder, forest floor — with feathered tint transitions
- Low-lying drifting mist sheets, instanced grass tufts on the verges
- Optional GLB tree species (up to four in `trees/`) as near-road LOD; procedural crowns fill the distant forest
- Irregular water accumulation composited into the road roughness map, plus puddle meshes and wet road glints
- Emissive taillights, forward spot lighting, wet-ground light spill
- Cinematic blue-hour atmosphere, fog, selective bloom and subtle velocity smear
- Dynamic rain streaks brighten inside the headlight cones, wheel spray and screen-space lens droplets
- Rim-faded volumetric headlight beams scaling with rain and mist (G)
- Physical sky: the three.js `Sky` addon (Preetham atmospheric scattering, the `webgl_shaders_sky` shader) — sun elevation/azimuth, turbidity, Rayleigh and Mie terms blend per preset so sunset glow and horizon haze come from the model
- Lighting presets (day / blue hour / night) blending fog, sky scattering, sun, bloom, exposure and headlight intensity (T)
- GPU star field at night (the Sky shader has no stars — a light additive dome fades in)
- Wind sway in scanned-tree canopies and verge grass
- Runtime weather presets, graphics-quality modes, FPS + 1%-low telemetry
- Self-driving mode (B): six lidar rays swept in road space detect barriers and rival cars; a lane controller steers toward clear road, follows traffic, and brakes for corner curvature — ray fan is drawn from the car and range readings appear on the H overlay
- Rolling terrain: broad elevation swells and surface lumps grow away from the road corridor (deterministic per route position)
- Undergrowth: instanced fern cards in the shaded band beside the verge, density-scaled shrubs, grass and rock outcrops
- Optional scanned scenery GLBs (`scenery/rock|fern|stump|shrub.glb`) instanced near the road; InstancedMesh groups are allocated lazily only for installed types
- Environment quality modes (N): ECO halves undergrowth instance counts, AUTO sheds density before cutting resolution
- Asset streaming: priority queue with concurrent-request caps; tree GLBs load first, scenery props progressively after
- Draco and Meshopt compressed GLB support (decoders from the pinned CDN); plain .glb loads unchanged
- KTX2/Basis textures: the loader probes a `.ktx2` sibling of every raster map and prefers it when installed — `install_ktx2.py` validates and installs them
- Stream profiler (M): asset queue depth, GPU elapsed-time (EXT_disjoint_timer_query_webgl2 when available), CPU render ms, draw calls, triangles, geometry/texture counts
- Nature pack (`assets/nature/`): scanned trees, rocks and foliage with external `tex/` WebP maps — birch joins the instanced forest, high-poly trees scatter as sparse frustum-culled heroes near the road, stone variants replace procedural outcrops, and grass/flower clumps fill the verge band
- Scanned traffic car (`cars/aston_db4.glb`): each ambient traffic car wears a cloned DB4 wrapper with a random paint tint on the body material; wheel nodes are re-pivoted onto the shared steer/spin rig, and a missing file keeps the procedural bodies
- Cockpit view (C cycles chase → cockpit → orbit): purpose-built DB4 interior — wood dashboard, analogue gauges with live speed/RPM needles, steering wheel that turns with input, rear-view mirror, A-pillars, windscreen and hood; the exterior shell hides while inside
- World-region streaming: eight recycled 256 m tiles flank the route out to ±320 m with mountain relief, biome tints, and sprite-forest impostors; disk-backed `regions/region_XXXX.json` descriptors (seed, biome, 17×17 elevation grid) with fetch cancellation, cache, validation, and procedural fallback; three terrain LODs by distance

## Project layout

`index.html` is markup + CSS + importmap only. Engine code lives in
`src/` — see [TEMPLATE.md](TEMPLATE.md) for the map/game-generation
workflow (config-driven route, swappable assets, installers).

## PBR textures

Real-world scanned materials live in `assets/` (CC0, [Poly Haven](https://polyhaven.com) plus user-supplied scans):

- `assets/textures/asphalt_02_{diff,nor_gl,rough}_2k.jpg` — roadway surface (<https://polyhaven.com/a/asphalt_02>)
- `assets/terrain/ground_{albedo,normal,ao}.webp` — user-supplied forest-floor terrain scan (preferred)
- `assets/terrain/ground2_albedo.webp` — alternate soil albedo, used for the verge when the mud set is absent
- `assets/textures/forrest_ground_01_{diff,nor_gl,rough}_2k.jpg` — forest floor fallback (<https://polyhaven.com/a/forrest_ground_01>)
- `assets/textures/brown_mud_leaves_01_{diff,nor_gl,rough}_2k.jpg` — muddy shoulder (<https://polyhaven.com/a/brown_mud_leaves_01>)
- `assets/textures/rock_face_03_{diff,nor_gl,rough}_2k.jpg` — optional scanned rock for outcrops (<https://polyhaven.com/a/rock_face_03>)

They load asynchronously at boot; diffuse uses `SRGBColorSpace`, normal and roughness maps use linear color space. If the files are absent or fail to load, the procedural canvas materials are used instead. The HUD status line shows `PBR n/4` as each set binds.

`install_pbr.py` extracts fresh Poly Haven texture ZIPs into `assets/textures/`:

```sh
python3 install_pbr.py ~/Downloads/asphalt_02.zip ~/Downloads/forrest_ground_01.zip ~/Downloads/brown_mud_leaves_01.zip
```

## GLB forest

`install_forest.py` validates and installs up to four tree species (`spruce`, `pine`, `fir`, `birch` slots), records SHA-256 hashes and license metadata in `trees/manifest.json` (installed species are the only near-road trees — there is no procedural tree fallback):

```sh
python3 install_forest.py ~/Downloads/spruce.glb ~/Downloads/pine.glb --license CC0
```

Models should be Y-up with the trunk base near the origin; they are normalized to unit height at load time, then instanced per track chunk. Installed GLB trees fill every forest slot near and far; the horizon forest is covered by the region impostor sprites.

## GLB scenery props

`install_scenery.py` installs up to four scanned prop types into `scenery/` (`rock`, `fern`, `stump`, `shrub` slots). It verifies the GLB header, parses the JSON chunk to estimate triangle count (rejects models over `--max-tris`, default 80 000), and records SHA-256 + license metadata in `scenery/manifest.json`:

```sh
python3 install_scenery.py \
    --rock ~/Downloads/forest_rock.glb \
    --fern ~/Downloads/fern.glb \
    --stump ~/Downloads/stump.glb \
    --shrub ~/Downloads/shrub.glb \
    --license CC0
```

Installed rocks replace procedural outcrops, scanned ferns and shrubs take over their slots near the road, and stumps only appear when installed. Use the actual verified license for your files.

## Nature pack

`assets/nature/` holds user-supplied scanned models; the GLBs carry no materials, so `tex/` WebP maps are bound by node-name convention at load time:

- `birch.glb` — instanced alongside other forest species (leaf canopy is detected as the widest primitive)
- `tree_a.glb`, `tree_b.glb` — ~100k-triangle heroes placed sparsely near the road with per-chunk frustum culling
- `rocks.glb` — six stone variants replacing procedural outcrops (`stones_color/n/rough/ao.webp`)
- `foliage.glb` — grass/plant/flower clump variants in the verge band (`pn_grass`, `pn_plant`, `pn_flower` albedo + opacity maps)
- `kit_props.glb`, `kit_buildings*.glb` — intentionally unused (fantasy village kit doesn't fit the mountain forest)

All loads stream through the priority queue; missing files or textures fall back silently to procedural scenery and plain colors.

## World regions

The distant world streams from `regions/region_XXXX.json` — per-tile descriptors with seed, biome, forest density and a 17×17 elevation grid. `install_regions.py` writes synthetic sample fields:

```sh
python3 install_regions.py --start 16 --count 32
```

Missing or invalid files fall back to a deterministic procedural descriptor, so the folder is optional. Press J to cycle distant-world quality (AUTO / HIGH / ECO); the M profiler shows active tiles, in-flight loads, cache size, LOD distribution and the count of tiles eliminated by camera-frustum culling.

### Real elevation data (v9)

`import_dem.py` samples a projected ESRI ASCII DEM along a route-control CSV and writes descriptors with an `elevations` grid — metres relative to the corridor — instead of normalized `heights`:

```sh
python3 import_dem.py \
    --dem ~/Data/mountain_dem.asc \
    --route ~/Data/route_control.csv \
    --start 0 --count 12 --crs EPSG:32647 --overwrite
```

The CSV needs `s,distance`/`dist` plus `easting`/`x` and `northing`/`y` columns in the same metre-based projected CRS as the DEM (no reprojection is performed; `--crs` is recorded as provenance). Descriptors carry the DEM's SHA-256, cell size and sampled relief range. The driving road stays procedural — only the surrounding terrain uses real elevations.

### Photographic impostor atlas (v9)

`install_impostors.py` validates and installs a 4-species RGBA PNG atlas (four horizontal sprites) for the distant forest cards — no external dependencies:

```sh
python3 install_impostors.py ~/Downloads/forest_trees_atlas.png --license CC0
```

Each distant-tree instance picks its sprite cell by instance index, so species mix per region at no extra draw cost. Without `assets/textures/impostor_atlas.png` the generated conifer silhouette is used.

## KTX2 compressed textures

`install_ktx2.py` validates KTX2 magic, dimensions and mip levels, then installs files under the canonical names the loader probes (`<basename>.ktx2` beside each raster map):

```sh
python3 install_ktx2.py \
    --road road_color.ktx2 road_normal.ktx2 road_roughness.ktx2 \
    --terrain ground_albedo.ktx2 ground_normal.ktx2 ground_ao.ktx2 \
    --license CC0
```

Slots: `--road`, `--ground`, `--verge`, `--rock` (diffuse, normal, roughness order) and `--terrain` (albedo, normal, AO order). Files must already be Basis/ETC1S/UASTC encoded — the installer does not compress textures. Installed entries are SHA-256 hashed into `assets/textures/ktx2_manifest.json`.

## Rendering limitations

The wet-road reflections are **stylized real-time approximations** (PBR environment reflections and projected light spill), not true screen-space/path-traced reflections. The procedural car and scenery will not equal high-quality photographed/scanned game assets. Replace the built-in car with a production-grade PBR GLB for the largest improvement in hero-vehicle realism. Performance varies by GPU.

## Validation

The HTML structure, required UI controls, and JavaScript module syntax were validated. A full live WebGL/browser render was not verified in the authoring environment because browser navigation and external CDN loading were blocked.

## External dependencies

- Three.js `0.170.0` ES modules from jsDelivr
- Optional Poly Haven `dikhololo_night` 2K HDRI (CC0): <https://polyhaven.com/a/dikhololo_night>
# Blue_Hour_Cinematic_Package
