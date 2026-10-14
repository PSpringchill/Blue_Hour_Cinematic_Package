# Blue Hour → Unreal Engine

UE 5.8 port of the Three.js blue-hour mountain-road world: Nanite terrain
tiles baked from the exact same route math, drivable C++ DB4 pawn
(bicycle model, cockpit/chase/orbit, gauges HUD), blue-hour atmosphere
rig, corridor-scattered foliage, and the scanned nature-pack assets.

The C++ module comes from `cars/AstonDB4_Unreal_Environment`, rewired so
`DB4Environment`/`DB4VehiclePawn` evaluate **our** route (`BHRoute.h` =
`src/core/config.js` constants). `config.js` stays the single source of
truth — `export_route.py` and `BHRoute.h` both derive from it.

## Layout

```
ue/
  project/                    the BlueHour UE project
    BlueHour.uproject         UE 5.8, AstonDB4 module + plugins
    Config/                   renderer (Lumen SW RT, TSR), input, game mode
    Source/
      BlueHour*.Target.cs     build targets
      AstonDB4/               C++: pawn, HUD, game mode, environment
        BHRoute.h             route math port (path, corridor, ground Z)
    Content/Python/           setup_db4.py (car+PBR import), create_preview_map.py
    Content/GeneratedTextures/  33 synthetic PBR sets (swap for Megascans later)
  tools/
    export_route.py           config.js math -> glb tiles + road + csv + albedo
    convert_assets.sh         webp->png (sips), glb->fbx (Blender headless)
    ue_setup.py               in-editor builder (imports, level, lighting)
    install_ue.sh             rsync project -> engine drive
  staging/                    generated files (gitignored)
```

Engine: `/Volumes/One Touch/Unreal-Engine/UE_5.8` · project lives on the
same external drive (internal disk ~full).

## Setup

```sh
# 1. stage assets
bash ue/tools/convert_assets.sh
python3 ue/tools/export_route.py            # 6 km default, --length N

# 2. install project to the engine drive
bash ue/tools/install_ue.sh
#    -> /Volumes/One Touch/Unreal-Engine/BlueHour/

# 3. build C++ (or just open the .uproject — it offers to build)
"/Volumes/One Touch/Unreal-Engine/UE_5.8/Engine/Build/BatchFiles/Mac/Build.sh" \
  BlueHourEditor Mac Development \
  -Project="/Volumes/One Touch/Unreal-Engine/BlueHour/BlueHour.uproject"

# 4. headless full build, OR open the project and run the scripts via
#    Tools -> Execute Python Script:
"/Volumes/One Touch/Unreal-Engine/UE_5.8/Engine/Binaries/Mac/UnrealEditor-Cmd" \
  "/Volumes/One Touch/Unreal-Engine/BlueHour/BlueHour.uproject" \
  -ExecutePythonScript="$PWD/ue/tools/ue_setup.py" \
  -unattended -nosplash -stdout -FullStdOutLogOutput
```

Tip: if the internal disk is nearly full, point the derived-data cache at
the external drive first — shader compilation fills it fast:

```sh
export UE-LocalDataCachePath="/Volumes/One Touch/Unreal-Engine/DDC"
```

`ue_setup.py` reuses already-imported assets, so re-runs are fast
(verified: full headless run completes `DONE` — 41 textures, 9 models,
124 tiles, ~3,500 HISM instances, spline + lighting rig + saved map).
It also execs `Content/Python/setup_db4.py` (car parts + full PBR
materials into `/Game/DB4/*`).

Import notes: source `.glb` files that use `EXT_meshopt_compression` or
`EXT_texture_webp` fail UE Interchange — `convert_assets.sh` routes them
through Blender to `.fbx` instead, and the importer prefers `.fbx` when
both exist. `volumetric_fog` was renamed in UE 5.8; the setup script
tolerates missing/renamed fog and post-process properties.

## What you get

| Layer | Source | Notes |
|---|---|---|
| Terrain | 124 baked glTF tiles, 2 m grid, Nanite | vcolor R = \|lateral\| drives material blend |
| Road | `road.glb` ribbon + `road_albedo.png` | superelevated, painted edges, wet material |
| Drive | `ADB4VehiclePawn` | bicycle model, surface = `BHRoute::SurfaceZcm` |
| Ground math | `BHRoute.h` (C++) | same functions that baked the tiles — pawn stays glued |
| Foliage/rails | `DB4Environment` HISM | corridor scatter matches `export_route.py` bands |
| Sky | SkyAtmosphere + sun −0.8°/205° + fog + clouds | authored in `L_BlueHour` |
| Route data | `RouteSpline` actor + `route_spline.csv` | gameplay/AI/cinematics |

`DB4Environment.bUseBakedWorld` (default on): skips its own terrain/road
meshes since the Nanite imports render; flip off for a fully procedural
fallback world (lower-res but zero imports).

## Known gaps / next steps

- **Chaos Vehicles** for real tire/suspension physics — plugin enabled,
  pawn swap documented in `DB4VehiclePawn.h`.
- **Electric Dreams** (`ElectricDreamsEnv`, same 5.8): Migrate its
  `Megascans`/`PCG` content into `BlueHour/Content`, then assign to the
  environment's *Photorealism → Premium Tree/Rock/Shrub* slots.
- **Rain/wetness**: `M_Road` roughness 0.32 fakes wet; Niagara rain system
  + decal puddles are the upgrade path.
- Axes: tiles/road/spline share the glTF → UE mapping; if the spline looks
  mirrored vs terrain flip `ue_y` in `route_spline.csv`.
- `--length 12000` doubles the route; update `BHRoute::LengthM` to match.
