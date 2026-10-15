// Engine bootstrap — stage 1 "PBR foundation".
// Wires the renderer stack, physical sky + preset lighting, the
// asset streaming/decode pipeline and a small PBR demo ground.
// Subsequent stages mount world streaming, vehicles, AI and UI on
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

const status = $('boot-status');
const setStatus = t => { if (status) status.textContent = t; };

const bus = new EventBus();

// ---- render stack ------------------------------------------------
let stack;
try {
  stack = createRendererStack($('canvas'));
} catch (error) {
  setStatus('WebGL 2 is unavailable. Try a current browser ' +
            'with hardware acceleration.');
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
const env = createEnvironment(stack);
env.onEnv.loaded = s =>
  setStatus(`Engine stage PBR · ${s} · orbit to inspect`);
env.onEnv.failed = s =>
  setStatus(`Engine stage PBR · ${s} · orbit to inspect`);

// ---- materials: procedural fallbacks + scanned PBR ---------------
const PROC = createProctex(renderer);
const { materials } = PROC;
const loaders = createAssetLoaders(renderer);

// Demo slab: a 24 m road strip wearing the scanned asphalt PBR set
// (albedo/normal/ORM) through the same capped loader the engine uses.
const demo = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 24, 1, 1).rotateX(-Math.PI / 2),
  materials.road
);
demo.receiveShadow = true;
demo.position.y = 0.001;
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
const loop = createLoop({
  step() {},                       // simulation lands in later stages
  render(dt, t) {
    env.update(dt);
    filmGrade.uniforms.uTime.value = t;
    controls.update();
    composer.render();
  }
});

setStatus('Engine stage PBR · streaming assets…');
loop.start();

// Debug surface for verification tooling.
if (new URLSearchParams(location.search).has('debug')) {
  window.__engine = {
    THREE, scene, camera, renderer, stack, env, materials,
    queue: streamQueue
  };
}
