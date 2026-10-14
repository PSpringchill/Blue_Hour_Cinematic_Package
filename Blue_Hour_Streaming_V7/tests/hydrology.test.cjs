// Portable tests for the CPU model. No Three.js dependency.
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const begin = html.indexOf('// V4_HYDROLOGY_CORE_START');
const end = html.indexOf('// V4_HYDROLOGY_CORE_END');
assert(begin > 0 && end > begin, 'hydrology core markers required');
const core = html.slice(begin, end);
const get = new Function(core + '\nreturn {HydroGrid, WATER_LANES, WATER_CELLS, WATER_ROWS, rainfallMMH, waterAppearance, waterBasin};');
const {HydroGrid, WATER_LANES, WATER_CELLS, WATER_ROWS, rainfallMMH, waterAppearance, waterBasin} = get();
assert.strictEqual(WATER_CELLS, WATER_ROWS * WATER_LANES.length);
assert.strictEqual(rainfallMMH(1), 54);
assert.strictEqual(rainfallMMH(0.43), 13);
assert.strictEqual(rainfallMMH(0), 0);
assert.strictEqual(waterAppearance(0),0);
assert.strictEqual(waterAppearance(200),1);
assert(waterBasin(20,-3.15) > waterBasin(20,0), 'ruts should retain deeper water');
for (const w of [0, .43, 1]) {
  const grid = new HydroGrid(); grid.reset(17,w);
  assert.strictEqual(grid.depth.length,WATER_CELLS);
  for(let i=0;i<800;i++) grid.step(.20,rainfallMMH(w));
  const m = grid.metrics();
  assert(Number.isFinite(m.averageMM)&&m.averageMM>=0&&m.averageMM<6);
  assert(m.wetFraction>=0&&m.wetFraction<=1);
  for(const d of grid.depth) assert(Number.isFinite(d)&&d>=0&&d<=6);
  for(let s=0;s<=64;s+=4) for(const x of [-7,-3.5,0,2,7]) {
    const sample=grid.sample(s,x);
    assert(Number.isFinite(sample)&&sample>=0&&sample<=6);
  }
  // Guarantee the test cell contains liquid even after prolonged clear weather.
  grid.depth[1 * WATER_LANES.length + 2] += 0.4;
  const original = grid.sample(12,-3.15);
  grid.displace(12,-3.15,.10);
  assert(grid.sample(12,-3.15)<original);
}
const grid=new HydroGrid();grid.reset(15,0);
const initial=grid.metrics().averageMM;
for(let i=0;i<1400;i++) grid.step(.20,54);
const full=grid.metrics().averageMM;
assert(full > initial+.20, 'storm input must accumulate water');
for(let i=0;i<1800;i++)grid.step(.20,0);
const dry=grid.metrics().averageMM;
assert(dry < full-.08, 'dry-out and drainage must remove water');
// Boundary conditions remain finite and bounded after 30 minutes.
for(let i=0;i<9000;i++)grid.step(.20,54);
assert(grid.metrics().averageMM<6);
console.log('PASS: v4 hydrology, rain accumulation, wheel displacement, dry-out, sampling, bounds');
