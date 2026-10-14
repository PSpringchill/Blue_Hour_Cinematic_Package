# BLUE HOUR — Hydrodynamics & Realistic Wet Road v4

Direct source upgrade of v3 (Three.js r170). Preserves endless-road generation, rivals and physics, weather and rain, camera and cinematic effects, optional local scanned PBR maps, forest GLB assets with LOD, selective SSR + planar reflection fallback, and the HUD.

## What is actually implemented

- **Bounded, quasi-2D road water simulation:** each 64 m road chunk has 8 longitudinal × 9 transverse water samples. The water budget integrates storm (54 mm/hr), drizzle (13 mm/hr), and clear (0 mm/hr), plus simplified runoff, retention in shallow ruts, side drainage, and drying. New chunks initialize from the current weather regime; discarded chunks are recycled, not stored indefinitely. Fixed 0.2-second hydrology update, independent of rendering frame rate.
- **Dynamically shaded wet asphalt:** geometry splits across lanes and passes a water-depth attribute to the existing `MeshPhysicalMaterial`. Its shader darkens wet diffuse color, reduces the road's dielectric roughness and introduces subtle ripples only in wet patches. Scanned maps remain compatible with these additions. Roads have subtle crossfall for drainage.
- **Water-size-dependent puddles:** the existing instanced puddle patches expand and contract according to simulated water depth rather than weather-switch opacity alone.
- **Wheel-water interaction:** shallow tire wakes are recycled from one GPU instancing pool, and the rear wheels displace a small volume from the local road cell. Spray strength depends partly on actual water beneath the wheels, even when rain has stopped.
- **Weather persistence:** standing water does not vanish immediately when switching to CLEAR. SSR/planar strength also responds to retained wetness.
- **Gameplay-facing wet grip:** a conservative lateral-grip reduction at speed through accumulated water, plus a warning at very wet/high-speed conditions. This is *gameplay modeling*, not validated vehicle dynamics.
- **Debug and profiling:** `H` toggles a colored road water-depth view; HUD reports instantaneous simulated rain rate, retained film depth, percentage of pooled cells, draw calls, triangles and frame time.

**Scope and honesty:** This is a real-time **physically motivated approximation**, not Navier–Stokes CFD, validated water drainage engineering, ray tracing, nor real measured automotive tire data. The water sample resolution is intentionally coarse. Crossfall/runoff and rut parameters are heuristic, and the water-depth numbers are useful for interaction/prototyping rather than predictive engineering.

## Run on macOS, Windows, or Linux

Open Terminal in the extracted folder, then:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` in Chrome/Edge with hardware acceleration. Internet is required for pinned CDN Three.js modules; the optional Poly Haven HDR will fall back to local generated lighting if unavailable.

**Controls:** WASD / arrows drive · Space drift · R recover · P pause · C camera orbit · V weather · F SSR / planar / off · **H road-water debug** · FX AUTO/CINEMA/FAST buttons. Touch buttons remain available.

### Installing scanned environment assets (optional)

The project intentionally **does not bundle third-party photogrammetry**, nor claim to have downloaded real PBR materials. Synthetic fallback assets run as-is.

```bash
python3 install_pbr.py ~/Downloads/asphalt.zip ~/Downloads/forest.zip \
  --gravel ~/Downloads/gravel.zip --mud ~/Downloads/mud.zip
python3 install_forest.py ~/Downloads/spruce.glb ~/Downloads/pine.glb \
  --license CC0 --source 'https://example.com/original-asset-page'
```

Use PBR textures with albedo/diffuse, **OpenGL normal**, and roughness maps; ensure you have rights to each downloaded model and that GLB tree models are decimated and textured appropriately. The installers create `assets/textures/manifest.json` and `assets/models/manifest.json`, which are loaded locally. Models are *not* downloaded automatically and the supplied `--license` flag merely records user-provided metadata, without independently verifying license rights.

Suggested source: https://polyhaven.com/ (CC0, check each page and suitable asset type). `install_forest.py --help` and `install_pbr.py --help` give further options.

## Performance guidance

- Start with **FX AUTO**; enable **FX CINEMA** and SSR only if the browser remains smooth.
- SSR on curves is expensive and inherently misses off-camera objects. `F` changes to a less accurate, cheaper planar patch or disables expensive reflections.
- If a GLB tree model is millions of triangles, optimize it outside the browser before installation; instancing does not make heavy geometry free.
- The CPU hydrology footprint is bounded by **32 × 72 = 2,304 depth samples**; road shader data is refreshed about five times per second. `H` is intended to inspect the variation of water over the road, not a photoreal presentation setting.
- The screen overlays and fake tire wakes are aesthetic effects; results vary with browser/GPU.

## Verification performed

```bash
python3 tests/smoke_test.py
python3 tests/smoke_v4.py
node tests/hydrology.test.cjs
```

Checks cover source structure, JavaScript parser syntax, previous v3 contracts, a synthetic GLB installer, and independent tests for rain accumulation, runoff/dry-out, wheel-water displacement, bounded depths and sampling. **End-to-end visual WebGL rendering has not been confirmed** in this isolated build runtime because externally hosted Three.js modules could not be fetched. Do a visual/device pass locally and inspect console output before describing the scene as fully tested.
