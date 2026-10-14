# Aston Martin DB4 GT Zagato — Interactive Driver's Seat

An interactive Three.js driving scene built around **your** optimized `aston_db4.glb`.

## Launch

From inside this folder:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Do not open `index.html` directly with `file://`: browser security blocks the GLB/module fetch. The web page needs an internet connection to load Three.js libraries from jsDelivr. Once loaded, the car model and all environment meshes are local assets/procedural.

## Keyboard

| Command | Control |
|---|---|
| Accelerate | `W` / `↑` |
| Brake / reverse | `S` / `↓` |
| Left steering | `A` / `←` |
| Right steering | `D` / `→` |
| Change cockpit / chase / orbit camera | `C` |
| Left / right indicator display | `Q` / `E` |
| Reset | `R` |
| Engine-synthesis audio toggle | `M` |

Touch-screen directional and pedal controls appear on small displays. In orbit view, drag the rendered scene to rotate the camera.

## Scope

- GLB exterior car, five named mesh components (`CAR_BODY`, `FL_WHEEL`, `FR_WHEEL`, `RL_WHEEL`, `RR_WHEEL`).
- Meshopt compression is enabled and decoded with Three.js `MeshoptDecoder`.
- Procedural interior: steering wheel (animates ±149°), leather dashboard, analogue instruments, wood veneer, windscreen frame, A-pillars, gear lever, hood and door trim.
- Bicycle-model steering physics with front-wheel yaw and rolling spin; movement in the XZ ground plane.
- Camera modes: driver, chase and cinematic orbit.
- A synthetic, scenery-rich 3D roadway and independent HUD.
- Local model: `assets/aston_db4.glb` (provided original file kept separate).

### Fidelity notes

The supplied GLB has an exterior body and four wheels, *not* individually articulated interior cockpit parts. The first-person cabin and steering wheel are therefore purpose-built replacements to match its size and position, rather than claimed edits to a nonexistent steering wheel in the original geometry.

This is an interactive driving visualization, **not** a mechanically validated automotive simulator (there is no tire-friction solver, collision simulation, road traction, engine torque curve, or modeled driver skeleton).

### Implementation details

- +X = forward, +Y = up, +Z = passenger/right.
- The model's wheelbase is approximately 2.46 m, wheel radius 0.353 m.
- `MeshoptDecoder` is necessary for `assets/aston_db4.glb`; swapping with `aston_db4_raw.glb` would require changes and greatly increase the file size.
- For offline deployment, install/vendor matching Three.js `0.176.0` and change the import map URLs to point to local dependencies.

