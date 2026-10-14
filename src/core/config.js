// Central tuning + template seam.
// A new map or game mode starts here: edit ROUTE's sine tables, swap the
// ASSETS entry points, retune LIGHT_PRESETS / WEATHER — no code changes
// needed below this layer.
import { MOBILE } from './math.js';

export const CFG = {
  chunkLength: 64,
  chunkCount: 32,
  chunksBehind: 3,
  pathStep: 8,
  pathCapacity: 1024,
  roadHalfWidth: 7,
  barrierLimit: 7.12,
  treesPerChunk: MOBILE ? 19 : 34,
  grassPerChunk: MOBILE ? 90 : 170,
  fernsPerChunk: MOBILE ? 60 : 130,

  maxSpeed: 86,
  fixedStep: 1 / 120,

  // Traffic regulation: which side of the road vehicles keep to.
  // -1 = left-hand traffic (UK/JP/TH style), +1 = right-hand traffic.
  // Autopilot cruising lane, traffic lanes and overtake side all
  // derive from this — flip it to mirror every lane behaviour.
  driveSide: -1
};

// Route shape: layered sine tables.
// heading(s) = bias + sum(amp * sin(freq * s + phase))
// curvature / grade are the analytic derivatives, so they stay exact.
// Amplitude in rad or m, frequency in rad/m, phase in rad.
export const ROUTE = {
  heading: [
    [0.62, 0.0021, 0],
    [1.05, 0.00085, 1.35],
    [0.34, 0.0061, 0.65],
    [0.30, 0.0145, 4.2],
    [0.22, 0.028, 2.0]
  ],
  // Keeps heading(0) = 0 so the start straight is unchanged.
  headingBias: -1.169,
  elevation: [
    [17, 0.0013, 0.4],
    [8, 0.0036, 1.7],
    [2.2, 0.009, 0]
  ],
  bankScale: 11,
  bankClamp: 0.085
};

// Lighting presets: blue hour is the authored look, day and night
// variants blend every tone parameter smoothly over a few seconds.
// elev/azim/turb/ray/mie/mieG drive the physical Sky shader.
export const LIGHT_PRESETS = [
  { name: 'DAY', bg: 0x87a8c8, fog: 0x9fb2c0, fogD: 0.0013,
    elev: 38, azim: 165, turb: 6, ray: 1.6, mie: 0.004, mieG: 0.8,
    sun: 0xffeedd, sunI: 3.4,
    hemiSky: 0xbdd8f0, hemiGnd: 0x2e4034, hemiI: 1.9,
    exposure: 1.06, envI: 1.25, bloom: 0.22, stars: 0,
    beam: 0.45, headI: 0.55 },
  { name: 'BLUE', bg: 0x215687, fog: 0x304f65, fogD: 0.0020,
    elev: -0.8, azim: 205, turb: 8, ray: 2.6, mie: 0.007, mieG: 0.85,
    sun: 0xb2dcff, sunI: 1.82,
    hemiSky: 0x8cbce5, hemiGnd: 0x091916, hemiI: 1.45,
    exposure: 0.98, envI: 1.05, bloom: 0.36, stars: 0.12,
    beam: 1.0, headI: 1.0 },
  { name: 'NIGHT', bg: 0x0a1524, fog: 0x0d1a28, fogD: 0.0024,
    elev: -14, azim: 235, turb: 4, ray: 3.2, mie: 0.003, mieG: 0.9,
    sun: 0x9fc0e8, sunI: 0.85,
    hemiSky: 0x4a6a8c, hemiGnd: 0x05080e, hemiI: 0.85,
    exposure: 1.12, envI: 0.55, bloom: 0.5, stars: 1,
    beam: 1.6, headI: 1.55 }
];

export const WEATHER = {
  names: ['STORM', 'DRIZZLE', 'CLEAR'],
  levels: [1, 0.43, 0]
};

// Asset entry points — everything optional; missing files fall back.
export const ASSETS = {
  playerAndTrafficCar: 'cars/aston_db4.glb',
  // Extra traffic-car models, loaded in order; missing files skip
  // silently. Player and rivals always use the first entry.
  trafficCarModels: ['cars/mustang.glb', 'cars/beetle.glb'],
  treeSpecies: [
    'trees/spruce.glb', 'trees/pine.glb',
    'trees/fir.glb', 'trees/birch.glb'
  ],
  sceneryKinds: ['rock', 'fern', 'stump', 'shrub'],
  sceneryFile: name => `scenery/${name}.glb`,
  // Single scanned massif (Google-Earth capture, moumtain.dae source)
  // placed as recycled horizon silhouettes beside the route.
  backdropMountain: 'scenery/mountain.glb',
  // Photographic grass clumps replace the crossed-card verges.
  grassClumps: 'scenery/grass.glb',
  regionFile: index =>
    `regions/region_${String(index).padStart(4, '0')}.json`,
  regionIndex: 'regions/index.json',
  ktx2Manifest: 'assets/textures/ktx2_manifest.json',
  impostorManifest: 'assets/textures/impostor_manifest.json',
  impostorAtlas: 'assets/textures/impostor_atlas.png',
  hdri: 'assets/hdri/dikhololo_night_1k.hdr'
};
