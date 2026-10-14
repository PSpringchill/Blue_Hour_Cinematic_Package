# BLUE HOUR — Next Level Environment · Three.js r170

This project is a **direct continuation of the PBR-ready Blue Hour racing game**. The endless track, driving physics, rivals, weather, cinematic camera, HUD, and player GLB import remain. The newly implemented environment upgrades are:

1. Four terrain-surface zones: asphalt road, gravel verge, damp soil/mud, and forest floor. Edges at the outer boundaries are irregular, and the road still has underlying supporting soil. Material slots accept photo-scanned PBR map sets.
2. Dense instanced roadside grass, shrubs, rocks and fog sheets, plus textured procedural conifers when tree assets are absent.
3. Optional **instanced GLB tree species**: normalize local Y-up geometry to unit tree height, reuse mesh geometry/materials and instance buffer pools while track chunks recycle. Up to 2 GLBs, each with up to 4 static mesh parts, load from a local manifest.
4. **Actual rendered planar reflection** from a mirrored camera for a small section of wet roadway around the car, masked with irregularity and feathered into the underlying surface. This is an **approximation** following the road tangent, not true screen-space/ray-traced reflections for the entire twisting road. It is off on mobile and in FAST mode.
5. Existing rain, ground puddles, real headlights, tire spray and blue-hour film grade remain; adaptive graphics disables expensive reflections after a low-performance downgrade.

**Important:** Real-world photo-scanned materials and third-party GLB tree assets are **not bundled**. No external texture/model rights are asserted. Without optional asset installation the scene still uses upgraded procedural materials and geometry. A real forest look requires suitably optimized scanned/textured 3D trees; a static high-resolution tree model is not necessarily suitable for a real-time game.

## Run

Open a terminal in this folder and execute:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000> in a recent hardware-accelerated browser. An internet connection is needed for the pinned Three.js modules and the optional Poly Haven HDR IBL file. A built-in fallback reflection environment is used if HDR loading fails.

## Optional: install real scanned PBR textures

Download textures that you have permission to use (e.g., [Poly Haven CC0 textures](https://polyhaven.com/textures)). For each material choose diffuse/albedo, **Normal (OpenGL)**, and roughness, preferably 2K resolution. Examples:

- asphalt: <https://polyhaven.com/a/asphalt_02>
- forest floor: <https://polyhaven.com/a/forrest_ground_01>
- gravel and muddy earth: select any suitable scanned PBR set with the three required maps

```sh
python3 install_pbr.py ~/Downloads/asphalt.zip ~/Downloads/forest.zip \
  --gravel ~/Downloads/gravel.zip \
  --mud ~/Downloads/wet_earth.zip
```

Only the first two arguments are mandatory. The installer copies maps into `assets/textures/`, creating `manifest.json`. If only two materials are installed, the other two use their procedural maps.

Maps use consistent UV tiling per material and the correct Three.js color spaces: sRGB for diffuse and linear for roughness and normal.

## Optional: real-tree models

Obtain one or two licensed **low/medium-polygon evergreen GLB assets** with textures; ideally less than 10–30K triangles per tree and 1–4 materials/mesh parts, with alpha-tested foliage. Static tree meshes perform better than animated/rigged tree models.

```sh
python3 install_forest.py ~/Downloads/spruce.glb ~/Downloads/pine.glb
```

The script creates `assets/models/manifest.json` and copies the GLBs. On page load the game automatically instantiates the models across the forest instead of showing its primitive tree fallback. A GLB's transform hierarchy is applied to the geometry and the full tree height is normalized; it must be **Y-up**. Skinning, morph animation, explicit multi-LOD models, and Draco-compressed assets are not currently handled. If a model has more than four mesh parts, the first four are loaded with a console warning.

The forest loader intentionally **does not** download or embed third-party tree assets. You must source your own compatible licensed assets.

## Controls

| Key | Action |
|---|---|
| W / Up | Accelerate |
| S / Down | Brake |
| A, D / Left, Right | Steering |
| Space | Handbrake / drift |
| C | Orbit camera |
| V | Cycle storm, drizzle and clear weather |
| F | Toggle planar wet-road reflections |
| R | Recover car |
| P | Pause |
| FX button | Auto, CINEMA, FAST graphics |

On **FX FAST** or mobile, the planar reflector and local mist sheets are disabled to help performance. Reflection is also automatically hidden when the weather is clear. The HDR environment for PBR material reflections remains present even when the local planar reflector is disabled.

## Limitations / next production steps

- **Planar limitation:** the reflection plane follows the tangent at the current position, so steep slopes or sharp corners can cause mismatches and overlay artifacts. For production-quality arbitrary curved asphalt use tuned SSR/SSGI plus reflection probes, or screen-space ray marching with motion-vector temporal accumulation (higher GPU cost).
- **Terrain:** this version uses jittered material region boundaries and vertex tinting, not true multi-texture triplanar splatmapping. Next upgrade would use a four-layer terrain shader with normal-map blending driven by height masks.
- **Fog:** blue-hour atmospheric fog and simple ground-fog sheets, not true froxel/volumetric scattering.
- **LOD:** vegetation uses GPU instancing and bounded chunk pools; automated mesh LOD and GPU frustum/occlusion culling per instance are not implemented.
- **Offline:** modules load over a CDN. For fully offline distribution, vendor the pinned Three.js dependencies into an application bundle.
- **Verification:** structural/syntax tests and Python installer test assets are included in this build. Browser-based visual confirmation is still required on the target GPU and with the desired third-party assets.

## References

- Three.js Reflector (built-in mirrored-camera reflection): <https://threejs.org/docs/#examples/en/objects/Reflector>
- Three.js PBR materials: <https://threejs.org/docs/#api/en/materials/MeshPhysicalMaterial>
- Poly Haven license: <https://polyhaven.com/license>
