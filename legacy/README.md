# Legacy lineage archive

Self-contained single-file engine snapshots, oldest to newest:

| folder | milestone |
| ------ | --------- |
| `Blue_Hour_PBR_Environment_PBR_Ready` | scanned PBR materials |
| `Blue_Hour_Next_Level_V2` | GLB forest + installers |
| `Blue_Hour_Photoreal_V3` | wet road, postfx |
| `Blue_Hour_Hydrodynamics_V4` | standing water, runoff |
| `Blue_Hour_Atmosphere_V5` | day/blue/night, rain, stars |
| `Blue_Hour_Environment_V6` | scenery variants |
| `Blue_Hour_Streaming_V7` | progressive loading, KTX2 |
| `Blue_Hour_Region_World_V8` | 256 m region streaming |
| `Blue_Hour_Terrain_Data_V9` | DEM import, impostor atlas |

`tests/` holds each version's smoke suite — they parse the
monolithic `index.html` of their era and do **not** run against the
modular `src/` or `engine/` trees. `region_world.mjs` is the v8/v9
region tooling helper.

Data was merged forward, not copied: region descriptors live in
`../regions/`, demo DEM/route inputs in `../examples/`.
