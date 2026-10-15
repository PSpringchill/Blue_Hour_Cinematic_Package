// Engine bootstrap — stage PBR foundation.
// Wires the Vue HUD first (so the UI renders even without WebGL),
// then the renderer stack, physical sky + preset lighting, and the
// asset streaming/decode pipeline with a small PBR demo ground.
// Later stages mount world streaming, vehicles, AI and fuller UI on
// this shell; the legacy app (src/main.js at repo root) stays live
// until the port reaches feature parity.
import * as THREE from 'three';
import { OrbitControls }
  from 'three/addons/controls/OrbitControls.js';
import { $ } from '../core/math.js';
import { ASSETS } from '../core/config.js';
import { EventBus } from '../core/events.js';
import { createLoop } from '../core/loop.js';
import { createAssetLoaders, makeGLTFLoader }
  from '../core/assets.js';
import { streamQueue, capMaterialTextures } from '../core/stream.js';
import { createRendererStack } from '../render/renderer.js';
import { createEnvironment } from '../render/environment.js';
import { createProctex } from '../render/proctex.js';
import { createHud } from '../ui/hud.js';
import { store } from '../ui/store.js';

const bus = new EventBus();

// ---- UI first: works even where WebGL is unavailable -------------
let env;                                  // used by cyclePreset below
const hud = createHud({
  cyclePreset() {
    if (env) store.preset = env.cycle();
  }
});
store.status = 'booting…';

// ---- render stack ------------------------------------------------
let stack;
try {
  stack = createRendererStack($('canvas'));
} catch (error) {
  store.webgl = false;
  store.status = 'WebGL 2 unavailable — open this page in a browser ' +
                 'with hardware acceleration (not an embedded preview).';
  window.__engineReady = true;   // HUD mounted — watchdog stays quiet
  throw error;
}
const { renderer, scene, camera, composer, filmGrade } = stack;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.maxPolarAngle = Math.PI * 0.49;
camera.position.set(3.2, 2.1, 5.5);
controls.target.set(0, 0.4, 0);

// ---- environment -------------------------------------------------
env = createEnvironment(stack);
env.onEnv.loaded = s => { store.env = s; store.status = 'ready'; };
env.onEnv.failed = s => { store.env = s; store.status = 'ready'; };
store.preset = env.preset.name;

// ---- materials: procedural fallbacks + scanned PBR ---------------
const PROC = createProctex(renderer);
const { materials } = PROC;
const loaders = createAssetLoaders(renderer);

// Demo slab: a road strip wearing the scanned asphalt PBR set
// (albedo/normal/ORM) through the same capped loader the engine uses.
const demo = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 24, 1, 1).rotateX(-Math.PI / 2),
  materials.road
);
demo.receiveShadow = true;
scene.add(demo);

const strip = new THREE.Mesh(
  new THREE.PlaneGeometry(4, 14).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({
    color: 0x9aa7b4, roughness: 0.8, metalness: 0.05
  })
);
strip.receiveShadow = true;
strip.position.set(0, 0.002, 0);
scene.add(strip);

Promise.all([
  loaders.pbrTexture('assets/textures/american_road_4_albedo.jpg', true),
  loaders.pbrTexture('assets/textures/american_road_4_normal.jpg', false),
  loaders.pbrTexture('assets/textures/american_road_4_orm.jpg', false)
]).then(([albedo, normal, orm]) => {
  if (!albedo) return;
  strip.material.map = albedo;
  strip.material.normalMap = normal;
  if (orm) {
    strip.material.roughnessMap = orm;
    strip.material.metalnessMap = orm;
    strip.material.aoMap = orm;
  }
  strip.material.roughness = 1;
  strip.material.metalness = 1;
  strip.material.color.set(0xffffff);
  strip.material.needsUpdate = true;
});

// A streamed GLB proves the queue + texture caps on real content.
loaders.queuedJob('demo:car', 10, () =>
  makeGLTFLoader().loadAsync(ASSETS.playerAndTrafficCar)
).then(gltf => {
  const car = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(car);
  const size = bounds.getSize(new THREE.Vector3());
  car.scale.setScalar(4.4 / Math.max(size.x, size.z));
  car.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(capMaterialTextures);
  });
  car.position.set(-2.6, 0, 0);
  scene.add(car);
}).catch(() => {});

// ---- loop ----------------------------------------------------------
let statClock = 0, statFrames = 0;
const loop = createLoop({
  step() {},                       // simulation lands in later stages
  render(dt, t) {
    if (stack.contextLost) {
      store.status = 'graphics context lost — waiting for restore…';
      return;
    }
    env.update(dt);
    filmGrade.uniforms.uTime.value = t;
    controls.update();
    // info.autoReset is off (multi-pass stats sum) — reset per frame.
    renderer.info.reset();
    composer.render();
    // HUD stats ~4 Hz — Vue reads the reactive store, not the DOM.
    statFrames++; statClock += dt;
    if (statClock >= 0.25) {
      store.fps = Math.round(statFrames / statClock);
      store.draws = renderer.info.render.calls;
      store.tris = renderer.info.render.triangles;
      store.queueDone = streamQueue.done;
      store.queueFailed = streamQueue.failed;
      statClock = 0; statFrames = 0;
    }
  }
});

window.__engineReady = true;
store.status = 'streaming assets…';
loop.start();

// Debug surface for verification tooling.
if (new URLSearchParams(location.search).has('debug')) {
  window.__engine = {
    THREE, scene, camera, renderer, stack, env, materials,
    queue: streamQueue, store
  };
}
