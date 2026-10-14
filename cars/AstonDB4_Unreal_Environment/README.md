# Aston Martin DB4 GT Zagato — Unreal Engine Coastal Pass

**A native Unreal Engine 5 driving-environment starter project with imported full-resolution DB4 geometry, animated driver-seat steering, procedurally generated winding roadway, terrain and foliage, and PBR material generation.** Tested offline for file/GLB/package structure; **not yet compiled or played in Unreal** (the editor is installed on the user's Mac, not in this runtime).

## What is implemented

| Module | Implementation | Important boundary |
|---|---|---|
| First-person | Driver-seat camera at left steering position, head movement | Fully modeled historic interior not included in source GLB; reconstructed dashboard/wood-rim steering wheel |
| Steering/vehicle | W/A/S/D, front-wheel steer ±32°, rim animation, rolling tires, engine-speed calculation, braking/reverse | Controlled bicycle model, **not Chaos physics** |
| Camera | Cockpit / chase / orbit, mouse freelook | Orbit is a secondary vehicle-mounted viewpoint |
| Road | ~1.4 km curved asphalt mesh, two gravel shoulders, painted lanes and roadside safety barriers | Generated runtime mesh; not a hand-authored Nanite road |
| Terrain | Heightfield, hills, valley, boulders, pine woods, ground cover | Procedural fallback shapes until photogrammetry trees, shrubs and rock meshes installed |
| Light | Directional sun, Sky Atmosphere, SkyLight, volumetric clouds and height fog | Weather and day/night simulation not included yet |
| Materials | 11 synthetic PBR sets (color, normal, ORM) generated from deterministic multiscale patterns | For cinematic photorealism, replace synthetic sets with Fab/Megascans scans |
| Body/tire model | Original full-resolution body and four independent wheel meshes, with maps/UVs/normals | Large high-poly imports; Nanite may help on supported hardware |
| HUD | Speed, RPM, gear, steering angle | Unreal Canvas, not a fully modeled mechanical cockpit dashboard |

## Requirements

- Unreal Engine **5.5–5.8 target** (written for contemporary UE5 API; version-specific fixes may be necessary).
- macOS with Apple Silicon; **Xcode installed** (Xcode Command Line Tools alone may not suffice for native UE C++).
- Python Editor Script Plugin and Editor Scripting Utilities (already enabled in `.uproject`).
- **Free storage:** at least ~5 GB for compiled engine project, DDC and imported textures, beyond the unzipped source. UE may need more.
- For Lumen: **software ray tracing only on macOS**. On M2+ Nanite and Virtual Shadow Maps may be available in beta, so start with compatibility settings and benchmark.

## 1. Open in Unreal on your Mac

1. Unzip the package to your own workspace, e.g. `~/Documents/Unreal Projects/AstonDB4_Unreal_Environment`.
2. Verify Xcode has been opened at least once and its license accepted. Unreal's native C++ toolchain must be configured.
3. Double-click `AstonDB4.uproject`. Choose the installed Unreal Engine in the project switcher if prompted. Choose **Build** if asked to compile native code. First compile can take a while.
4. If the `.uproject` doesn't open from Finder, open Unreal Editor and **Browse** to `AstonDB4.uproject` from the Project Browser. For newer engine versions, allow project conversion using **Open a Copy**.
5. After the project loads and compiles, use **Play** in the empty/Entry map to test the procedural road and placeholder DB4 before importing assets. The game mode creates a landscape and player automatically.

> **Important:** This is a native C++ Unreal project, not the old HTML file being embedded in Unreal.

## 2. Import complete car and PBR textures

The input file was separated into five independent **uncompressed** GLBs because the earlier compact web GLB depended on `EXT_meshopt_compression`, which may not be supported by Unreal's default interchange importer.

1. In Unreal, open **Tools → Execute Python Script** (or the Output Log command bar switched to Python).
2. Browse to this project's `Content/Python/setup_db4.py` and execute.
3. Allow the import tasks to finish; the five car parts total over 200 MB uncompressed and take time to build.
4. Check Content Browser for these exact paths:

   - `/Game/DB4/Car/CAR_BODY`
   - `/Game/DB4/Car/FL_WHEEL`
   - `/Game/DB4/Car/FR_WHEEL`
   - `/Game/DB4/Car/RL_WHEEL`
   - `/Game/DB4/Car/RR_WHEEL`

5. Materials should be in `/Game/DB4/Materials/` and textures in `/Game/DB4/Textures/`. Press **Save All**.
6. Restart Play so the car pawn can load the new Static Mesh assets. If any Interchange import differs by engine version, inspect Output Log for `[DB4 SETUP]` messages; rename individual Static Mesh assets to the expected names. In newer Unreal, use the Interchange glTF pipeline and turn **Combine Meshes** off if shown.

**Manual fallback:** import `Import/CAR_BODY.glb`, `FL_WHEEL.glb`, etc. via Content Browser → Import to `/Game/DB4/Car/`, with glTF/Interchange enabled, preserving each separate Static Mesh. Import `Content/GeneratedTextures/*.png`, then create/reassign material assets if editor scripting fails.

## 3. Create a persistent map (optional but recommended)

Run `Content/Python/create_preview_map.py` from Unreal **Tools → Execute Python Script** after compiling C++. It creates `/Game/DB4/Maps/CoastalPass` with an editable `DB4Environment` actor visible directly in the editor. Open that map and press Play. The game mode detects the existing environment and doesn't spawn a second copy.

The environment defaults to X-forward, Y-right, Z-up (Unreal cm). The imported glTF car is fitted by its actual mesh bounds; if your Unreal version applies a different glTF axis conversion, inspect the imported meshes in Static Mesh Editor and adjust mesh rotations and axle attachments in `DB4VehiclePawn.cpp` before declaring wheel alignment correct.

## 4. Driving controls

| Control | Key |
|---|---|
| Accelerate | `W` or `↑` |
| Brake / reverse | `S` or `↓` |
| Steering left/right | `A` / `D` or `←` / `→` |
| First-person, chase, orbit | `C` |
| Look around from cockpit | Hold right mouse + move mouse |
| Reset | `R` |
| Toggle headlights | `L` |

PIE keyboard: click inside the game viewport first. In Unreal Editor press `Shift+F1` to release the mouse.

## 5. Achieve cinematic, top-tier photorealism

Synthetic textures and fallback pine primitives are for a fully offline runnable starting point. A AAA / photorealistic scene requires more than high-quality lighting: **licensed scanned vegetation and rocks, physically accurate terrain layers, road decal wear, weathering, vegetation wind animation, and tuned post-processing**.

1. Open **Fab** from inside Unreal and add a suitable environment/biome, e.g. temperate alpine vegetation, roadside ground cover, 3D rock scans and road asphalt Megascans. Availability/licensing varies; these assets are **not bundled** in this project.
2. Place `DB4Environment` in the saved map. Select it, and set **Premium Tree**, **Premium Rock**, **Premium Shrub** under `Photorealism | Fab Overrides` to your imported meshes. Click **Rebuild** under Landscape; HISM instancing populates the environment with your real-world source meshes.
3. Replace `M_Asphalt`, `M_Ground`, `M_Gravel`, `M_Stone` with scanned PBR materials (or replace the input textures of those material assets). Use sensible UV scaling and surface roughness to avoid an artificial wet appearance.
4. In UE's Rendering project settings, leave **Lumen software ray tracing** enabled if performance permits, use TSR, tune Shadow/Effects scalability, screen percentage, FOV and exposure. Hardware ray tracing and MegaLights are not supported on macOS.
5. If your Mac is M2 or newer, test **Nanite** for the **static** high-poly vehicle meshes and scanned environment meshes on your engine version, with GPU profiling; Nanite on macOS is beta in Epic's published requirements. If you see glitches or severe slowdown, turn Nanite off and use reduced-triangle mesh LODs instead.
6. For a real driving simulator, migrate from the implemented simple steering integration to **Chaos Vehicles**, adding wheel friction, suspension, engine transmission, and tire dynamics after vehicle collision geometry, correct tire pivot axes and mass properties are validated.

## Environment source architecture

```
AstonDB4.uproject
├── Config/DefaultEngine.ini             # Mac-targeted Unreal rendering defaults
├── Source/AstonDB4/
│   ├── DB4GameMode.cpp                  # Spawns scenery and sky in Play
│   ├── DB4Environment.cpp               # Heightfield, road, paint, instanced props
│   ├── DB4VehiclePawn.cpp               # Cameras, visual wheel steering, input
│   └── DB4HUD.cpp                       # Canvas telemetry
├── Import/
│   ├── CAR_BODY.glb                      # High-detail DB4 geometry and PBR images
│   ├── FL_WHEEL.glb / FR_WHEEL.glb
│   └── RL_WHEEL.glb / RR_WHEEL.glb
├── Content/GeneratedTextures/           # 33 synthetic PBR images
├── Content/Python/setup_db4.py          # Unreal Editor import + material generation
├── Content/Python/create_preview_map.py # Makes a saved editable map
└── Tools/                                # GLB splitter and offline tests
```

## Performance and known limitations

- Runtime procedural meshes are not Nanite, and the original car's full-resolution geometry is heavy. First test at 1080p with reasonable scalability. Trees use HISM rather than one actor per tree.
- No collision-based tire physics; the car sticks to a sampled ground surface and uses a simplified steering model.
- No finished historical cockpit mesh/hand animation or wheel suspension geometry was supplied. Steering/dashboard are reconstructed, with wheel import pivots fitted against actual mesh bounds. Check steering side, windshield clipping, UV normals and axis orientation in Unreal after import.
- Lumen reflections on glass/chrome and volumetric clouds can be expensive on Apple Silicon.
- Full engine compilation/runtime FPS, native rendering, and actual Interchange editor import results **cannot be verified in this environment**.
- No third-party scanned content or licensed Fab assets have been redistributed.

## References (official Unreal documentation)

- [Unreal Engine macOS rendering feature requirements](https://dev.epicgames.com/documentation/unreal-engine/macos-development-requirements-for-unreal-engine)
- [Import with Interchange](https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-assets-using-interchange-in-unreal-engine)
- [Unreal Editor Python](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python)
- [ProceduralMeshComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/ProceduralMeshComponent/UProceduralMeshComponent)
