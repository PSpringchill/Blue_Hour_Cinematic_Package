# Blue Hour v9 — Terrain DEM Import + Photographic Tree Atlas + View-Volume Budget

**An incremental upgrade of the v8 playable racing project.** It preserves driving, AI rivals, time/weather presets, wet-road hydrology, scanned PBR assets, SSR, KTX2/Draco/Meshopt loaders, and 256 m world-region streaming. All previous tests are retained.

## New features

1. **ESRI ASCII-grid DEM importer (`import_dem.py`).** Imports *your own* projected-elevation raster together with a route-station-to-coordinate control file. Samples far-landscape offsets into the existing v8 9×9-per-side descriptor format. Each imported value is `(DEM ground elevation at lateral sample − DEM elevation at route center at same station) × height_scale` in metres, and must be in ±40 m. The browser retains the existing region seam fades. Rasters are parsed offline; the browser sees only lightweight JSON tiles. A persistent `dem_import_report.json` records input SHA-256, coordinate label and warnings. All missing coverage, NoData and out-of-range values cause explicit errors.
2. **Real 4-cell tree atlas pipeline (`install_impostors.py`).** Installs a locally supplied transparent **RGBA 4×1 horizontal PNG** (four square cells, e.g. 2048×512). Each tree orientation selects a cell from **one shared texture** using a shader instancing attribute. This reduces separate sprite textures/draw calls and makes forest cards less obviously procedural. The game keeps its built-in tree texture until a valid local atlas is installed and loaded. Source and license metadata stored in a local manifest.
3. **Conservative frustum elimination** of entire region roots outside the camera's view volume, using a generously padded region bounding sphere (terrain + trees). This is **not GPU occlusion culling** and does not assume hills hide other hills. Every frame re-evaluates visibility after camera movement.
4. **GPU timing percentiles:** The existing optional WebGL2 `EXT_disjoint_timer_query_webgl2` diagnostic now reports GPU render time p50/p95 from delayed valid queries. Unsupported browsers show N/A rather than invented measurements. Press **B** to see atlas state and view-culling counts.

## Quick start

```sh
cd Blue_Hour_Terrain_Data_V9
python3 -m http.server 8000
```

Open **http://localhost:8000** in a current browser with WebGL2. Three.js modules from the pinned CDN need internet unless you bundle them separately. Use `B` to open diagnostics, `J` to cycle world detail, `N` for near-scene detail, `V` for rain, `T` for lighting, and `F` for SSR/planar/off.

## Install real elevation data

Required input files:

- A **projected** ESRI ASCII grid (`.asc`) using **metre** x/y coordinates and metre elevation data, containing `ncols`, `nrows`, `xllcorner`/`xllcenter`, `yllcorner`/`yllcenter`, `cellsize`, and optionally `NODATA_value`. One uniform square cell size.
- A CSV with columns `station_m,x_m,y_m`: each station is the measured centreline position at along-track distance `station_m` starting at **0**. `x_m,y_m` must be in the exact same projected coordinate system as the DEM. This file expresses where to sample. No CRS reprojection is performed.
- Raster coverage at each sampled station for the full lateral corridor **−370 m to +370 m** and 0–256 m per region. All sample centres must lie within raster bounds. A route-control point is required at or beyond the final station.

For example, once you have genuine surveyed data:

```sh
python3 import_dem.py \
  --dem ~/Data/your_projected_dem.asc \
  --route ~/Data/your_route_control.csv \
  --start 0 --count 12 --crs EPSG:32647 --overwrite
```

`--overwrite` is required to replace the included 16 **synthetic** demo region JSON files. Omit it if writing to unused region IDs. Existing region metadata for replaced regions (biome/density/seed) is preserved. The original DEM and route CSV stay on your disk and are not copied into the project; only imported residual grids and provenance hashes are saved.

**Important real-world limitation:** v9 uses real altitude *differences* to deform **distant landscape only**. It does **not** align the procedural driving road with real roads, adjust road absolute elevation, map WGS84 to local render coordinates, solve bridges/cuttings, or generate a geographically navigable GIS racing world. If your DEM shows hillside changes over 40 m in the 370 m strip, use a defensible `--height-scale` (0–4) and document that vertical exaggeration/compression; the importer otherwise rejects such data. Two neighboring regions fade their imported deviation to the shared procedural seam, ensuring continuity but intentionally not preserving absolute altitude.

The importer can only guarantee **internally consistent input transformations**, not that a user-provided DEM was surveyed, accurately georeferenced or licensed.

### Synthetic input walkthrough (test only)

```sh
python3 examples/create_synthetic_dem.py
python3 import_dem.py \
  --dem examples/demo_dem.asc \
  --route examples/demo_route.csv \
  --start 0 --count 4 --overwrite --crs SYNTHETIC
```

This changes four example region descriptors. These demo elevations are **not real terrain**.

## Install a photographed tree atlas

Provide four separately alpha-masked tree sprites side by side in one RGBA PNG. The ideal capture has clean foliage edges, no painted sky/background, and the tree base at the bottom of each square cell. Example dimensions: 2048×512 (4 × 512 px). License rights and original source are your responsibility.

```sh
python3 install_impostors.py ~/Downloads/forest_trees_atlas.png \
  --license 'CC0' --source 'Your verified asset provenance'
```

The installer requires Pillow (`python3 -m pip install Pillow`) to inspect PNG pixels. It verifies PNG format, RGBA, alpha presence, exact 4:1 dimensions, 128–2048 px cell height, and <=16 MiB size; it saves `assets/impostors/forest_atlas.png` and writes its provenance/metadata manifest. No scanned photographic tree atlases are included. Built-in procedural silhouettes remain the fallback. This atlas is meant for **distant** region impostors; for near forest use the existing `install_forest.py` textured GLBs. PBR color management: atlas color is sRGB; alpha is a cutout mask, not transmissive foliage.

## Quality and performance tradeoffs

- Geometry is fixed-bounded: 8 concurrent region tile slots; 3 terrain mesh detail levels; existing region JSON cache capped at 96 KiB.
- Region-frustum tests are done on the CPU; they can avoid draw calls only when a region is completely outside the camera frustum. They **do not** perform GPU depth/occlusion queries or determine which regions are hidden by mountain ridges.
- GPU percentiles use measured nonblocking timer-query results only, if the extension exists and results are not disjoint. Rendering cost and peak GPU memory must still be profiled on target hardware; CPU buffer estimates are not VRAM measurements.
- Real textures/models and geographic DEM/route datasets are **not** bundled due to unknown licensing, terrain alignment and file size.
- The 256 m region system is still independent of road physics, so no gameplay collision changes are implied by DEM imports.

## Validation

```sh
python3 tests/smoke_test.py
python3 tests/smoke_v4.py
python3 tests/smoke_v5.py
python3 tests/smoke_v6.py
python3 tests/smoke_v7.py
python3 tests/smoke_v8.py
python3 tests/test_v9.py
python3 tests/test_ktx2.py
node tests/hydrology.test.cjs
node tests/streaming.test.cjs
node tests/region_world.test.mjs
```

These are source-level, geometry, importer and stream-manager tests. **Browser GPU/WebGL execution, real-world DEM alignment and actual texture appearance are not yet verified**. Test on your target Mac and examine browser console and **B** diagnostics; compare loaded datasets and performance to the procedural fallback.

## What would make v10 meaningfully closer to a real mountain road?

Replace the procedural centreline with a georeferenced driving route, give road and terrain a common vertical datum, map GIS terrain into the same coordinate frame, add terrain-road cutting and collision, and profile culling/vegetation on target devices. That is necessary before claiming a geographically accurate real-world track.
