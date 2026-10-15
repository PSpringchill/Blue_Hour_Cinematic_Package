# Blue Hour — Scanned PBR Environment Upgrade

## What is included?

The `index.html` is based on your cinematic Blue Hour driving game. It adds an asynchronous, fail-safe loader for two **real-world PBR material sets**: asphalt road and damp forest floor. The game remains playable even when the texture files have not been installed; in that case it uses the existing procedural graphics. Weather, AI racers, physics, HUD, rain lens FX, and GLB car import are retained.

**Actual photo-scanned image texture maps are NOT included in the ZIP.** Download them directly from the Poly Haven CC0 library using the following instructions.

## Step 1 — Download scanned 2K JPG materials (CC0)

- Asphalt 02: https://polyhaven.com/a/asphalt_02
- Forest Ground 01: https://polyhaven.com/a/forrest_ground_01

On each Poly Haven page choose **2K** / **JPG** and download the **Diffuse**, **Normal (GL)**, and **Rough** maps. Alternatively download the ZIP with these maps (choose 2K for good web performance). Do not use Normal (DX), because its Y channel is reversed relative to OpenGL normal maps.

## Step 2 — Install

Run these commands from this project folder. Filenames depend on how you name the downloaded ZIPs:

```bash
python3 install_pbr.py ~/Downloads/asphalt_02.zip ~/Downloads/forrest_ground_01.zip
```

The installer also accepts extracted folders instead of ZIPs. It finds the Diffuse, Normal (GL), and Rough maps automatically, copies them to `assets/textures/`, and creates `assets/textures/manifest.json`.

## Step 3 — Start

```bash
python3 -m http.server 8000
```

Visit http://localhost:8000/ then select START ENGINE. In the lower-left HUD, **PBR 2/2** means the two scanned texture sets loaded successfully. **PBR 1/2** means one of the two materials loaded. **TEXTURES PROCEDURAL** means none loaded or the asset files were not installed.

If you see no change, inspect the JavaScript developer console (F12) and check your browser can access the relative paths in `assets/textures/manifest.json`.

## Physically based treatment

- Albedo/diffuse receives Three.js `SRGBColorSpace`.
- Normal and roughness maps receive `NoColorSpace`.
- Nonmetal asphalt/soil use `metalness=0`.
- A wet film is approximated with road clearcoat, with separate irregular puddle geometry retained. Clearcoat does not make physically correct dynamic screen-space reflections.
- Texture anisotropy is set to up to 8×. The existing base UVs repeat at integer multiples so procedural road-chunk boundaries align.
- Photo-realistic trees and physically correct rain reflections still require separate model/rendering work (GLB/LOD vegetation, SSR/planar reflection techniques, decals, and atmospheric scattering).

## Performance notes

Use **2K** maps for desktop, **1K** maps for weaker GPUs. Two PBR materials with three 2K maps each can occupy significant GPU texture memory, especially with mipmaps. Use AVIF/WebP where supported or GPU-compressed KTX2/BasisU in a future production build.

## Sources

Poly Haven CC0: https://polyhaven.com and https://polyhaven.com/license.
Three.js color management: https://threejs.org/manual/#en/color-management.
