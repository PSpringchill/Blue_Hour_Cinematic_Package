import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

import { $, clamp, lerp, damp, TAU, MOBILE, randomGenerator } from './core/math.js';
import { CFG, LIGHT_PRESETS, WEATHER, ASSETS } from './core/config.js';
import { headingAt, curvatureAt, elevationAt, gradeAt,
         turnLimit, clampInside, PathRing, groundOffset }
  from './world/route.js';
import { createCockpit } from './entities/cockpit.js';

// ================================================================
// 1. Configuration, renderer, lighting and environment
// ================================================================


let width = innerWidth;
let height = innerHeight;
const maxDPR = Math.min(devicePixelRatio || 1, MOBILE ? 1.25 : 1.65);
let dpr = maxDPR;
let effectsEnabled = !MOBILE;
let adaptiveQuality = true;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: $('canvas'),
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false
  });
} catch (error) {
  $('boot-status').textContent =
    'WebGL 2 is unavailable. Try a current browser with hardware acceleration.';
  throw error;
}

renderer.setPixelRatio(dpr);
renderer.setSize(width, height, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.shadowMap.enabled = true;
// Stats are reset once per frame so multi-pass frames sum correctly.
renderer.info.autoReset = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x215687);
scene.fog = new THREE.FogExp2(0x304f65, 0.0020);
scene.environmentIntensity = 1.05;

const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 2400);
camera.position.set(0, 4.3, 22);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 3;
controls.maxDistance = 24;
controls.maxPolarAngle = Math.PI * 0.49;
controls.enablePan = false;

const hemi = new THREE.HemisphereLight(0x8cbce5, 0x091916, 1.45);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xb2dcff, 1.82);
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
Object.assign(sun.shadow.camera, {
  left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 160
});
sun.shadow.bias = -0.00025;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);

const fill = new THREE.DirectionalLight(0x265785, 0.43);
fill.position.set(30, 15, -40);
scene.add(fill);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(
  new THREE.Vector2(width, height), 0.36, 0.46, 0.94
);
composer.addPass(bloom);

// Filmic grade, subtle peripheral velocity smear and fine-grained
// luminance noise. These effects run before the output color transform.
const filmGrade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uRain: { value: 1 },
    uResolution: { value: new THREE.Vector2(width, height) }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uRain;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash21(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    void main() {
      vec2 uv = vUv;
      vec2 delta = uv - vec2(0.5);
      float edge = smoothstep(0.14, 0.73, length(delta * vec2(1.0, 0.9)));
      float smear = edge * uSpeed * 0.006;
      vec2 direction = normalize(delta + vec2(0.00001));
      vec3 col = texture2D(tDiffuse, uv).rgb * 0.58;
      col += texture2D(tDiffuse, clamp(uv - direction * smear, 0.001, 0.999)).rgb * 0.22;
      col += texture2D(tDiffuse, clamp(uv + direction * smear, 0.001, 0.999)).rgb * 0.20;
      // Warm lights against cool indirect illumination.
      float luminance = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= vec3(0.976, 1.007, 1.047);
      col = mix(vec3(luminance), col, 1.09);
      col *= 1.025 - edge * 0.15;
      float grain = hash21(floor(uv * uResolution * 0.56) + uTime * 34.0) - 0.5;
      col += grain * (0.0048 + uRain * 0.0018);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `
});
composer.addPass(filmGrade);
composer.addPass(new OutputPass());

// Generated environment is immediately available if HDR loading fails.
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

const room = new RoomEnvironment();
let environmentRT = pmrem.fromScene(room, 0.04);
scene.environment = environmentRT.texture;
room.dispose();

let environmentStatus = 'HDR LOADING';

// CC0 HDR environment. Geometry/textures for the scene are otherwise local.
// Source: [polyhaven](https://polyhaven.com/a/dikhololo_night)
const HDR_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/dikhololo_night_2k.hdr';

new RGBELoader().load(
  HDR_URL,
  texture => {
    const next = pmrem.fromEquirectangular(texture);
    scene.environment = next.texture;
    environmentRT.dispose();
    environmentRT = next;
    texture.dispose();
    pmrem.dispose();
    environmentStatus = '2K HDR';
    $('boot-status').textContent = 'Ready · 2K HDR lighting active';
  },
  undefined,
  () => {
    pmrem.dispose();
    environmentStatus = 'LOCAL IBL';
    $('boot-status').textContent =
      'Ready · procedural environment active; HDR download unavailable';
  }
);

// Physical sky: the three.js Sky addon (Preetham atmospheric
// scattering, same shader as webgl_shaders_sky) driven by a real sun
// position per lighting preset — sunset glow, horizon haze and day
// blue all fall out of the model instead of hand-mixed gradients.
const sky = new Sky();
sky.scale.setScalar(2400);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 8;
skyU.rayleigh.value = 2.6;
skyU.mieCoefficient.value = 0.007;
skyU.mieDirectionalG.value = 0.85;
// Sun state is lerped per frame by updateLighting(); start at the
// blue-hour values so the first frame is already the authored look.
let skyElev = -0.8, skyAzim = 205;
const skySunPos = new THREE.Vector3();

// The Sky shader has no night stars — a light additive point dome
// fades in under the night preset instead.
const starMaterial = new THREE.PointsMaterial({
  color: 0xd8e6ff, size: 1.6, sizeAttenuation: false,
  transparent: true, opacity: 0.1, depthWrite: false, fog: false
});
const starPositions = new Float32Array(900 * 3);
for (let i = 0; i < 900; i++) {
  const a = Math.random() * TAU;
  const y = 0.06 + Math.random() * 0.94;
  const r = Math.sqrt(1 - y * y) * 1500;
  starPositions[i * 3] = Math.cos(a) * r;
  starPositions[i * 3 + 1] = y * 1500;
  starPositions[i * 3 + 2] = Math.sin(a) * r;
}
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute(
  'position', new THREE.BufferAttribute(starPositions, 3));
const starDome = new THREE.Points(starGeometry, starMaterial);
starDome.frustumCulled = false;
starDome.renderOrder = -99;
scene.add(starDome);

// ================================================================
// 2. Procedural textures and shared materials
// ================================================================


function canvasTexture(size, draw, srgb = true) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const asphaltTexture = canvasTexture(512, (ctx, size) => {
  const rand = randomGenerator(521);
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = 73 + rand() * 35;
    image.data[i] = n * 0.88;
    image.data[i + 1] = n * 0.95;
    image.data[i + 2] = n;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  // Longitudinal aggregate and hairline seams soften repeating tiles.
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 2100; i++) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.fillStyle = rand() > 0.5 ? '#b7c5cd' : '#050f18';
    ctx.fillRect(x, y, 0.5 + rand() * 1.7, rand() * 5 + 0.6);
  }
  ctx.globalAlpha = 1;
});

const wetRoughness = canvasTexture(512, (ctx, size) => {
  const rand = randomGenerator(991);
  ctx.fillStyle = '#c2c2c2';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 65; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 25 + rand() * 100;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(8,8,8,.97)');
    g.addColorStop(1, 'rgba(80,80,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}, false);

const soilTexture = canvasTexture(256, (ctx, size) => {
  const rand = randomGenerator(6081);
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = 45 + rand() * 65;
    image.data[i] = n * 0.64;
    image.data[i + 1] = n * 0.78;
    image.data[i + 2] = n * 0.61;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
});

const puddleMask = canvasTexture(256, (ctx, size) => {
  const rand = randomGenerator(801);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(0.95, 0.58);
  const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, 125);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.48, '#f8f8f8');
  grad.addColorStop(0.73, '#aaaaaa');
  grad.addColorStop(0.90, '#171717');
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad;
  ctx.beginPath();
  for (let j = 0; j <= 64; j++) {
    const a = j / 64 * Math.PI * 2;
    const r = 111 + 5 * Math.sin(a * 7) + 7 * Math.sin(a * 11 + 1.3);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (!j) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}, false);
puddleMask.wrapS = puddleMask.wrapT = THREE.ClampToEdgeWrapping;

const carbonTexture = canvasTexture(64, (ctx, size) => {
  ctx.fillStyle = '#151c23';
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 8) {
    for (let x = 0; x < size; x += 8) {
      ctx.fillStyle = ((x + y) / 8) % 2 ? '#303a42' : '#1b242c';
      ctx.fillRect(x, y, 7, 7);
      ctx.fillStyle = 'rgba(130,150,165,.12)';
      ctx.fillRect(x, y, 2, 7);
    }
  }
});
carbonTexture.repeat.set(5, 5);

const contactTexture = canvasTexture(128, (ctx, size) => {
  const g = ctx.createRadialGradient(
    size / 2, size / 2, 4, size / 2, size / 2, size / 2
  );
  g.addColorStop(0, 'rgba(0,0,0,.86)');
  g.addColorStop(0.4, 'rgba(0,0,0,.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
});
contactTexture.wrapS = contactTexture.wrapT = THREE.ClampToEdgeWrapping;

// Irregular wet-patch mask for the planar road reflection: bright
// streaks and blobs mirror the scene, the rest stays diffuse asphalt.
const mirrorMask = canvasTexture(256, (ctx, size) => {
  const rand = randomGenerator(4177);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(9 + rand() * 30, 24 + rand() * 105);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,.95)');
    g.addColorStop(0.55, 'rgba(210,210,210,.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Wheel-track wet lines running along the tile.
  ctx.globalAlpha = 0.28;
  for (const lx of [0.30, 0.68]) {
    const g = ctx.createLinearGradient(
      lx * size - 15, 0, lx * size + 15, 0
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(235,235,235,.9)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(lx * size - 15, 0, 30, size);
  }
  ctx.globalAlpha = 1;
}, false);

// Soft alpha blotches for the low-lying mist sheets.
const mistTexture = canvasTexture(256, (ctx, size) => {
  const rand = randomGenerator(9053);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 64; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 16 + rand() * 72;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.17)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
});

// Crossed-card grass tufts for the road verges.
const grassTexture = canvasTexture(64, (ctx, size) => {
  const rand = randomGenerator(2213);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const x = 4 + rand() * (size - 8);
    const top = size * (0.02 + rand() * 0.24);
    const grad = ctx.createLinearGradient(0, size, 0, top);
    grad.addColorStop(0, '#25311f');
    grad.addColorStop(1, '#63755a');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.1 + rand() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(
      x + (rand() - 0.5) * 10, size * 0.55,
      x + (rand() - 0.5) * 16, top
    );
    ctx.stroke();
  }
});
const grassCardA = new THREE.PlaneGeometry(1, 1);
grassCardA.translate(0, 0.5, 0);
const grassGeometry = BufferGeometryUtils.mergeGeometries([
  grassCardA, grassCardA.clone().rotateY(Math.PI / 2)
]);

// Fern fronds radiating from a base; wider arched strokes than grass.
const fernTexture = canvasTexture(96, (ctx, size) => {
  const rand = randomGenerator(4417);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9 - 0.5) * 2.1 + (rand() - 0.5) * 0.2;
    const length = size * (0.55 + rand() * 0.4);
    const tipX = size / 2 + Math.sin(angle) * length;
    const tipY = size - Math.cos(angle) * length;
    const midX = size / 2 + Math.sin(angle) * length * 0.45;
    const midY = size - Math.cos(angle) * length * 0.62;
    for (let t = 0.2; t < 1; t += 0.09) {
      const bx = lerp(lerp(size / 2, midX, t), lerp(midX, tipX, t), t);
      const by = lerp(lerp(size, midY, t), lerp(midY, tipY, t), t);
      const leafLen = (1 - t) * size * 0.11;
      ctx.strokeStyle = `rgba(${52 + rand() * 26 | 0},${
        92 + rand() * 34 | 0},${44 + rand() * 20 | 0},.92)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(bx - leafLen, by - leafLen * 0.4);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + leafLen, by - leafLen * 0.4);
      ctx.stroke();
    }
  }
});
const fernCardA = new THREE.PlaneGeometry(1.3, 1);
fernCardA.translate(0, 0.45, 0);
const fernGeometry = BufferGeometryUtils.mergeGeometries([
  fernCardA,
  fernCardA.clone().rotateY(Math.PI / 3),
  fernCardA.clone().rotateY(-Math.PI / 3)
]);

const materials = {
  road: new THREE.MeshPhysicalMaterial({
    color: 0x8297a9,
    map: asphaltTexture,
    bumpMap: asphaltTexture,
    bumpScale: 0.013,
    roughnessMap: wetRoughness,
    roughness: 0.61,
    metalness: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.085,
    envMapIntensity: 2.0
  }),
  ground: new THREE.MeshStandardMaterial({
    color: 0x526352, map: soilTexture, roughness: 0.99,
    vertexColors: true, flatShading: true
  }),
  verge: new THREE.MeshStandardMaterial({
    color: 0x6a5f52, map: soilTexture, roughness: 0.98,
    vertexColors: true, flatShading: true
  }),
  grass: new THREE.MeshStandardMaterial({
    map: grassTexture, alphaTest: 0.42, roughness: 0.95,
    side: THREE.DoubleSide
  }),
  fern: new THREE.MeshStandardMaterial({
    map: fernTexture, alphaTest: 0.4, roughness: 0.96,
    side: THREE.DoubleSide
  }),
  rock: new THREE.MeshStandardMaterial({
    color: 0x374348, roughness: 0.98, flatShading: true
  }),
  puddle: new THREE.MeshPhysicalMaterial({
    color: 0x7392a5, metalness: 0.28, roughness: 0.09,
    clearcoat: 1, clearcoatRoughness: 0.035,
    alphaMap: puddleMask, transparent: true, opacity: 0.32,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    envMapIntensity: 2.4, side: THREE.DoubleSide
  }),
  wetEdge: new THREE.MeshBasicMaterial({
    color: 0x8facb9, map: puddleMask, transparent: true,
    opacity: 0.09, depthWrite: false, side: THREE.DoubleSide
  }),
  marking: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.45, metalness: 0.05
  }),
  rail: new THREE.MeshStandardMaterial({
    color: 0x8b929b, metalness: 0.76, roughness: 0.29
  }),
  foliage: new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, flatShading: true, side: THREE.DoubleSide
  }),
  reflector: new THREE.MeshStandardMaterial({
    color: 0xd3eeff, emissive: 0x6091ae, emissiveIntensity: 0.7
  }),
  carbon: new THREE.MeshStandardMaterial({
    color: 0x5d6972, map: carbonTexture, roughness: 0.42, metalness: 0.55
  }),
  rubber: new THREE.MeshStandardMaterial({
    color: 0x101316, roughness: 0.82, metalness: 0.03
  }),
  rim: new THREE.MeshStandardMaterial({
    color: 0x89949e, metalness: 0.94, roughness: 0.22
  }),
  darkMetal: new THREE.MeshStandardMaterial({
    color: 0x20272d, metalness: 0.84, roughness: 0.33
  }),
  contact: new THREE.MeshBasicMaterial({
    map: contactTexture,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2
  })
};

// ================================================================
// 2a. Asset streaming: a small priority queue with a concurrent
// request cap so heavy assets arrive progressively instead of all
// at once. Failed jobs are counted, never fatal.
// ================================================================

const streamQueue = {
  pending: [], keys: new Set(), active: 0,
  cap: MOBILE ? 2 : 3, done: 0, failed: 0,
  enqueue(key, priority, task) {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.pending.push({ key, priority, task });
    this.pending.sort((a, b) => a.priority - b.priority);
    this.pump();
  },
  pump() {
    while (this.active < this.cap && this.pending.length) {
      const job = this.pending.shift();
      this.active++;
      Promise.resolve()
        .then(job.task)
        .then(() => { this.done++; })
        .catch(() => { this.failed++; })
        .finally(() => { this.active--; this.pump(); });
    }
  }
};
// Same key -> same promise, so duplicate requests share one load
// instead of waiting on a job the queue silently deduplicated.
const streamJobs = new Map();
function queuedJob(key, priority, task) {
  if (streamJobs.has(key)) return streamJobs.get(key);
  const job = new Promise((resolve, reject) => {
    streamQueue.enqueue(key, priority,
      () => task().then(resolve, reject));
  });
  streamJobs.set(key, job);
  return job;
}

// Mesh decoders for compressed GLB payloads; plain .glb files load
// unchanged. Decoder binaries stream from the same pinned CDN.
const dracoLoader = new DRACOLoader()
  .setDecoderPath(
    'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/'
  );
function makeGLTFLoader() {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  try { loader.setMeshoptDecoder(MeshoptDecoder); } catch (error) {}
  return loader;
}

// Basis/KTX2 compressed textures when installed; raster files stay
// the fallback for every material.
let ktx2Loader = null;
try {
  ktx2Loader = new KTX2Loader()
    .setTranscoderPath(
      'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/'
    )
    .detectSupport(renderer);
} catch (error) { ktx2Loader = null; }

// Scanned PBR texture sets (Poly Haven CC0) replace the procedural
// stand-ins when the files under assets/ are present. Missing or
// failed loads silently keep the generated materials.
let pbrStatus = 'PBR 0/4';
const pbrLoader = new THREE.TextureLoader();

// install_ktx2.py records every installed file; only those are
// probed, so a project without KTX2 assets makes one request total.
const ktx2Files = (ktx2Loader
  ? fetch(ASSETS.ktx2Manifest)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
  : Promise.resolve(null)
).then(manifest => new Set(
  Object.values((manifest && manifest.ktx2) || {}).map(e => e.file)
));

function pbrTexture(url, srgb) {
  const ktx2url = url.replace(/\.(jpg|jpeg|png|webp)$/i, '.ktx2');
  const attempt = ktx2Files.then(files =>
    files.has(ktx2url)
      ? ktx2Loader.loadAsync(ktx2url).catch(() => null)
      : null
  );
  return attempt.then(compressed => {
    if (compressed) {
      compressed.wrapS = compressed.wrapT = THREE.RepeatWrapping;
      if (srgb) compressed.colorSpace = THREE.SRGBColorSpace;
      return compressed;
    }
    return new Promise(resolve => {
      pbrLoader.load(url, texture => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy =
          Math.min(16, renderer.capabilities.getMaxAnisotropy());
        if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
        resolve(texture);
      }, undefined, () => resolve(null));
    });
  });
}

// Real scanned roughness composited with irregular wet accumulation:
// dark islands are glossy standing-water patches on the roadway.
function wetComposite(roughTexture, seed) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(roughTexture.image, 0, 0, size, size);
  const rand = randomGenerator(seed);
  for (let i = 0; i < 70; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 20 + rand() * 95;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(10,10,10,.95)');
    g.addColorStop(1, 'rgba(90,90,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

async function loadPBRTextures() {
  let loaded = 0;
  const [asphaltDiff, asphaltNor, asphaltRough] = await Promise.all([
    pbrTexture('assets/textures/asphalt_02_diff_2k.jpg', true),
    pbrTexture('assets/textures/asphalt_02_nor_gl_2k.jpg', false),
    pbrTexture('assets/textures/asphalt_02_rough_2k.jpg', false)
  ]);
  if (asphaltDiff && asphaltNor && asphaltRough) {
    materials.road.map = asphaltDiff;
    materials.road.bumpMap = null;
    materials.road.normalMap = asphaltNor;
    materials.road.normalScale.set(0.55, 0.55);
    materials.road.roughnessMap = wetComposite(asphaltRough, 991);
    materials.road.color.set(0xc9d4dc);
    materials.road.needsUpdate = true;
    pbrStatus = `PBR ${++loaded}/4`;
  }

  // User-supplied terrain scan takes priority for the forest floor;
  // the Poly Haven forest set remains the fallback. The AO map shares
  // the base UV channel (texture.channel = 0).
  let [groundDiff, groundNor, groundAO] = await Promise.all([
    pbrTexture('assets/terrain/ground_albedo.webp', true),
    pbrTexture('assets/terrain/ground_normal.webp', false),
    pbrTexture('assets/terrain/ground_ao.webp', false)
  ]);
  if (groundDiff && groundNor && groundAO) {
    groundAO.channel = 0;
    materials.ground.map = groundDiff;
    materials.ground.normalMap = groundNor;
    materials.ground.normalScale.set(0.9, 0.9);
    materials.ground.aoMap = groundAO;
    materials.ground.color.set(0xd8dcd2);
    materials.ground.needsUpdate = true;
    pbrStatus = `PBR ${++loaded}/4`;
  } else {
    [groundDiff, groundNor] = await Promise.all([
      pbrTexture('assets/textures/forrest_ground_01_diff_2k.jpg', true),
      pbrTexture('assets/textures/forrest_ground_01_nor_gl_2k.jpg', false)
    ]);
    const groundRough = await pbrTexture(
      'assets/textures/forrest_ground_01_rough_2k.jpg', false
    );
    if (groundDiff && groundNor && groundRough) {
      materials.ground.map = groundDiff;
      materials.ground.normalMap = groundNor;
      materials.ground.normalScale.set(0.8, 0.8);
      materials.ground.roughnessMap = groundRough;
      materials.ground.color.set(0xd8dcd2);
      materials.ground.needsUpdate = true;
      pbrStatus = `PBR ${++loaded}/4`;
    }
  }

  const [mudDiff, mudNor, mudRough] = await Promise.all([
    pbrTexture('assets/textures/brown_mud_leaves_01_diff_2k.jpg', true),
    pbrTexture('assets/textures/brown_mud_leaves_01_nor_gl_2k.jpg', false),
    pbrTexture('assets/textures/brown_mud_leaves_01_rough_2k.jpg', false)
  ]);
  if (mudDiff && mudNor && mudRough) {
    materials.verge.map = mudDiff;
    materials.verge.normalMap = mudNor;
    materials.verge.normalScale.set(0.75, 0.75);
    materials.verge.roughnessMap = mudRough;
    materials.verge.color.set(0xd9d2c8);
    materials.verge.needsUpdate = true;
    pbrStatus = `PBR ${++loaded}/4`;
  } else {
    // Second terrain albedo works as a plain verge soil fallback.
    const vergeAlt = await pbrTexture(
      'assets/terrain/ground2_albedo.webp', true
    );
    if (vergeAlt) {
      materials.verge.map = vergeAlt;
      materials.verge.color.set(0xcfc6b8);
      materials.verge.needsUpdate = true;
      pbrStatus = `PBR ${++loaded}/4`;
    }
  }

  // Stone scan from the nature pack; shared by procedural outcrops
  // and the rocks.glb variants (one material, one texture upload).
  const [rockDiff, rockNor, rockRough, rockAO] = await Promise.all([
    pbrTexture('assets/nature/tex/stones_color.webp', true),
    pbrTexture('assets/nature/tex/stones_n.webp', false),
    pbrTexture('assets/nature/tex/stones_rough.webp', false),
    pbrTexture('assets/nature/tex/stones_ao.webp', false)
  ]);
  if (rockDiff && rockNor && rockRough) {
    materials.rock.map = rockDiff;
    materials.rock.normalMap = rockNor;
    materials.rock.normalScale.set(1.0, 1.0);
    materials.rock.roughnessMap = rockRough;
    if (rockAO) { rockAO.channel = 0; materials.rock.aoMap = rockAO; }
    materials.rock.flatShading = false;
    materials.rock.color.set(0xb8bcc0);
    materials.rock.needsUpdate = true;
    pbrStatus = `PBR ${++loaded}/4`;
  }
}
loadPBRTextures();

// ================================================================
// 2b. Surface water: coarse depth grid in road Frenet space.
// Rain fills it, drainage and drying empty it, runoff pushes it
// toward the shoulders and the tires displace it into wakes.
// ================================================================

const WATER_ROWS = 128;              // 4 m cells -> 512 m window
const WATER_COLS = 14;               // 1.2 m cells over |x| <= 8.4
const WATER_CELL_S = 4;
const WATER_HALF_W = 8.4;
const waterDepth = new Float32Array(WATER_ROWS * WATER_COLS);
const waterRowId = new Int32Array(WATER_ROWS).fill(-1);
const waterBytes = new Uint8Array(WATER_ROWS * WATER_COLS);
const waterTexture = new THREE.DataTexture(
  waterBytes, WATER_COLS, WATER_ROWS,
  THREE.RedFormat, THREE.UnsignedByteType
);
waterTexture.magFilter = THREE.LinearFilter;
waterTexture.minFilter = THREE.LinearFilter;
waterTexture.needsUpdate = true;

const waterUniforms = {
  tWater: { value: waterTexture },
  uWaterOrigin: { value: 0 },
  uWaterSpan: { value: WATER_ROWS * WATER_CELL_S }
};
let surfaceWetness = 0;
let waterAtCar = 0;

function waterCellRow(s) { return Math.floor(s / WATER_CELL_S); }
function waterCellCol(x) {
  return clamp(
    Math.floor((x + WATER_HALF_W) / (2 * WATER_HALF_W) * WATER_COLS),
    0, WATER_COLS - 1
  );
}
function waterAt(s, x) {
  const row = waterCellRow(s);
  const slot = row % WATER_ROWS;
  if (waterRowId[slot] !== row) return 0;
  return waterDepth[slot * WATER_COLS + waterCellCol(x)];
}

const waterScratch = new Float32Array(WATER_COLS);
function updateWater(dt) {
  // Overall dampness rises in rain and dries slowly in clear air.
  surfaceWetness = clamp(
    surfaceWetness + (weatherIntensity * 0.03 - 0.005) * dt, 0, 1
  );

  const firstCell = waterCellRow(state.s - 32);
  waterUniforms.uWaterOrigin.value = firstCell * WATER_CELL_S;

  const rainRate = weatherIntensity * 0.028;
  const drying = weatherIntensity < 0.1 ? 0.028 : 0.004;
  const drain = Math.exp(-drying * dt);
  const runoff = Math.min(1, 0.35 * dt);

  for (let r = 0; r < WATER_ROWS; r++) {
    const cellIndex = firstCell + r;
    const slot = cellIndex % WATER_ROWS;
    const base = slot * WATER_COLS;
    if (waterRowId[slot] !== cellIndex) {
      waterRowId[slot] = cellIndex;
      waterDepth.fill(0, base, base + WATER_COLS);
    }

    for (let c = 0; c < WATER_COLS; c++) {
      const lat = -WATER_HALF_W +
        (c + 0.5) * (2 * WATER_HALF_W / WATER_COLS);
      // Wheel-rut pooling: depth gathers faster along the tire lines.
      const rut =
        Math.exp(-((Math.abs(lat) - 1.55) ** 2) / 0.45);
      let d = waterDepth[base + c] + rainRate * (1 + 0.9 * rut) * dt;
      d *= drain;
      if (c < 1 || c >= WATER_COLS - 1) d *= Math.exp(-0.5 * dt);
      waterScratch[c] = Math.min(d, 0.3);
    }
    // Outward runoff shares a share of each cell toward the verge.
    for (let c = 0; c < WATER_COLS; c++) {
      const moved = waterScratch[c] * runoff * 0.5;
      const n = c + (c < WATER_COLS / 2 ? -1 : 1);
      if (n >= 0 && n < WATER_COLS) waterScratch[n] += moved;
      waterScratch[c] -= moved;
    }
    for (let c = 0; c < WATER_COLS; c++)
      waterDepth[base + c] = waterScratch[c];
  }

  waterAtCar = waterAt(state.s, state.x);
  // Tire displacement: wheels squeeze water outward and forward.
  if (state.speed > 2.5) {
    const push = Math.min(0.6, state.speed * 0.008);
    for (const ds of [-1.32, 1.32]) {
      for (const side of [-0.82, 0.82]) {
        const row = waterCellRow(state.s + ds);
        const slot = row % WATER_ROWS;
        if (waterRowId[slot] !== row) continue;
        const c = waterCellCol(state.x + side);
        const i = slot * WATER_COLS + c;
        const removed = Math.min(
          waterDepth[i], (waterDepth[i] * 0.4 + 0.0012) * push
        );
        waterDepth[i] -= removed;
        const n = c + (c < WATER_COLS / 2 ? -1 : 1);
        if (n >= 0 && n < WATER_COLS)
          waterDepth[slot * WATER_COLS + n] += removed * 0.6;
      }
    }
  }

  // Upload rows in absolute-s order; the ring order is internal.
  for (let r = 0; r < WATER_ROWS; r++) {
    const src = ((firstCell + r) % WATER_ROWS) * WATER_COLS;
    const dst = r * WATER_COLS;
    for (let c = 0; c < WATER_COLS; c++)
      waterBytes[dst + c] = Math.min(255, waterDepth[src + c] * 850);
  }
  waterTexture.needsUpdate = true;
}

// The depth grid feeds the road shader: standing water darkens the
// asphalt and drops roughness toward a glossy film.
materials.road.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, waterUniforms);
  shader.fragmentShader =
    'uniform sampler2D tWater;\n' +
    'uniform float uWaterOrigin;\n' +
    'uniform float uWaterSpan;\n' +
    shader.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float water = texture2D(tWater, vec2(
            (vMapUv.x * 5.0 + ${WATER_HALF_W}) / ${2 * WATER_HALF_W},
            (vMapUv.y * 8.0 - uWaterOrigin) / uWaterSpan
          )).r;
          diffuseColor.rgb *= 1.0 - 0.45 * water;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float waterRough = texture2D(tWater, vec2(
            (vMapUv.x * 5.0 + ${WATER_HALF_W}) / ${2 * WATER_HALF_W},
            (vMapUv.y * 8.0 - uWaterOrigin) / uWaterSpan
          )).r;
          roughnessFactor = mix(
            roughnessFactor, 0.06,
            clamp(waterRough * 1.6, 0.0, 1.0)
          );
        }`);
};

// Wind sway for procedural canopies and grass: instanced vertices
// lean with a travelling sine keyed on the instance's world offset.
const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.6 }
};
function addWindSway(material, amount) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader =
      'uniform float uTime;\nuniform float uWind;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 swayPos = vec3(
            instanceMatrix[3][0], instanceMatrix[3][1],
            instanceMatrix[3][2]);
          float swayA = sin(
            uTime * 1.4 + swayPos.x * 0.35 + swayPos.z * 0.27);
          transformed.x += swayA * transformed.y * ${amount} * uWind;
          transformed.z += cos(uTime * 1.15 + swayPos.z * 0.4)
                         * transformed.y * ${amount * 0.8} * uWind;
        #endif
      `);
  };
}
addWindSway(materials.foliage, 0.028);
addWindSway(materials.grass, 0.10);
addWindSway(materials.fern, 0.075);

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const shrubGeometry = new THREE.IcosahedronGeometry(1, 1);
const puddleGeometry = new THREE.PlaneGeometry(1, 1);
puddleGeometry.rotateX(-Math.PI / 2);
const dummy = new THREE.Object3D();
const tempColor = new THREE.Color();

// ================================================================
// 3. Bounded path data and pooled road chunks
//
// Double-precision path coordinates remain in a fixed-size ring.
// GPU geometry is chunk-local. Floating-origin rebasing keeps
// rendered coordinates small even after long drives.
// ================================================================

const origin = { x: 0, z: 0 };


const path = new PathRing();
const sampleA = {};
const sampleB = {};
const playerPath = {};
const workPath = {};


function geometryData() {
  return { position: [], uv: [], color: [] };
}

function updateGeometry(geometry, data) {
  for (const [name, itemSize] of [['position', 3], ['uv', 2], ['color', 3]]) {
    const values = data[name];
    if (!values.length) continue;
    let attribute = geometry.getAttribute(name);
    if (!attribute || attribute.array.length !== values.length) {
      attribute = new THREE.Float32BufferAttribute(values, itemSize);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
    } else {
      attribute.array.set(values);
      attribute.needsUpdate = true;
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function setInstance(mesh, index, x, y, z, yaw, sx, sy, sz) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(0, yaw, 0);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

// Scanned tree GLBs are the only near-road forest source.
let forestParts = null;
// Optional scanned props: rock / fern / stump / shrub parts per name.
const sceneryParts = new Map();
// Environment density scale driven by the N-key quality mode.
let envDensity = 1;

class TrackChunk {
  constructor() {
    this.index = -1;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.road = new THREE.Mesh(new THREE.BufferGeometry(), materials.road);
    this.ground = new THREE.Mesh(new THREE.BufferGeometry(), materials.ground);
    this.verge = new THREE.Mesh(new THREE.BufferGeometry(), materials.verge);
    this.markings = new THREE.Mesh(new THREE.BufferGeometry(), materials.marking);
    this.puddles = new THREE.InstancedMesh(
      puddleGeometry, materials.puddle, 13
    );
    this.puddles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puddles.frustumCulled = false;
    this.road.receiveShadow = true;
    this.ground.receiveShadow = true;
    this.verge.receiveShadow = true;
    this.markings.receiveShadow = true;
    this.root.add(
      this.road, this.ground, this.verge, this.markings, this.puddles
    );

    this.rails = new THREE.InstancedMesh(unitBox, materials.rail, 32);
    this.posts = new THREE.InstancedMesh(unitBox, materials.rail, 18);
    this.reflectors = new THREE.InstancedMesh(unitBox, materials.reflector, 18);
    this.shrubs = new THREE.InstancedMesh(
      shrubGeometry, materials.foliage, CFG.treesPerChunk * 2
    );
    this.rocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0), materials.rock, 9
    );
    this.grass = new THREE.InstancedMesh(
      grassGeometry, materials.grass, CFG.grassPerChunk
    );
    this.ferns = new THREE.InstancedMesh(
      fernGeometry, materials.fern, CFG.fernsPerChunk
    );
    this.glbTrees = null;
    // Scenery GLB instancing is allocated lazily: InstancedMesh groups
    // are only created for asset types that are actually installed.
    this.scenery = {};
    // Nature pack variants: name -> [[InstancedMesh, ...] per variant].
    this.variants = {};
    // Distance LOD groups, toggled per frame by updateChunkLOD():
    // near = hero trees + foliage clumps, mid = undergrowth, rocks
    // and GLB forest. Distant chunks keep only terrain, road, rails
    // and hero foliage.
    this.lodNear = new THREE.Group();
    this.lodMid = new THREE.Group();
    this.root.add(this.lodNear, this.lodMid);

    for (const mesh of [
      this.rails, this.posts, this.reflectors,
      this.shrubs, this.rocks, this.grass, this.ferns
    ]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      (mesh === this.grass || mesh === this.ferns
        ? this.lodMid : this.root).add(mesh);
    }
    this.rails.castShadow = true;
    this.rails.receiveShadow = true;
    this.posts.castShadow = true;
    this.shrubs.castShadow = true;
  }

  initScenery(name) {
    const parts = sceneryParts.get(name);
    if (!parts || this.scenery[name]) return;
    const capacity = {
      rock: 10, fern: CFG.fernsPerChunk,
      stump: 7, shrub: CFG.treesPerChunk
    }[name] || 8;
    this.scenery[name] = parts.map(part => {
      const mesh = new THREE.InstancedMesh(
        part.geometry, part.material, capacity
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = name !== 'fern';
      mesh.userData.capacity = capacity;
      this.lodMid.add(mesh);
      return mesh;
    });
  }

  initVariants(name) {
    const variants = variantAssets.get(name);
    if (!variants || this.variants[name]) return;
    const capacity = { hero: 5, rock: 5, foliage: 8 }[name] || 4;
    this.variants[name] = variants.map(parts => parts.map(part => {
      const mesh = new THREE.InstancedMesh(
        part.geometry, part.material, capacity
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Per-chunk frustum culling (instance bounding spheres are
      // recomputed on rebuild): hero trees are ~100k tris each and
      // 32 chunks x variants would otherwise all submit draw calls.
      mesh.frustumCulled = true;
      mesh.castShadow = name === 'rock';
      mesh.userData.capacity = capacity;
      (name === 'rock' ? this.lodMid : this.lodNear).add(mesh);
      return mesh;
    }));
  }

  initGlbForest() {
    // Rebuild species meshes when the roster grows (nature birch can
    // arrive after the initial species were already instanced).
    if (this.glbTrees) {
      for (const species of this.glbTrees) {
        for (const mesh of species) {
          mesh.removeFromParent();
          mesh.dispose();
        }
      }
    }
    // Any species may receive every tree slot in the chunk.
    const capacity = CFG.treesPerChunk + 1;
    this.glbTrees = forestParts.map(parts => parts.map(part => {
      const mesh = new THREE.InstancedMesh(
        part.geometry, part.material, capacity
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = true;
      mesh.castShadow = true;
      mesh.userData.capacity = capacity;
      this.lodMid.add(mesh);
      return mesh;
    }));
  }

  strip(data, s0, s1, left, right, lift, color, terrain = false) {
    path.sample(s0, sampleA);
    path.sample(s1, sampleB);

    const vertices = [];
    for (const [p, s] of [[sampleA, s0], [sampleB, s1]]) {
      const c = Math.cos(p.heading);
      const n = Math.sin(p.heading);
      for (const lateral of [left, right]) {
        // Inside of a hairpin the corridor folds: pull the terrain
        // edge in so the strip never wraps back over the road.
        const lat = terrain ? clampInside(p, lateral) : lateral;
        vertices.push([
          p.x + c * lat - this.anchorX,
          p.y - this.anchorY +
            (terrain ? groundOffset(p, s, lat) : p.bank * lat + lift),
          p.z - n * lat - this.anchorZ
        ]);
      }
    }

    // +Z is forward; this winding points road normals upward.
    const indices = [0, 2, 1, 1, 2, 3];
    const uv = [
      [left / 5, s0 / 8],
      [right / 5, s0 / 8],
      [left / 5, s1 / 8],
      [right / 5, s1 / 8]
    ];

    for (const index of indices) {
      data.position.push(...vertices[index]);
      data.uv.push(...uv[index]);
      if (color) data.color.push(...color);
    }
  }

  rebuild(index) {
    this.index = index;
    this.start = index * CFG.chunkLength;
    path.sample(this.start, workPath);
    this.anchorX = workPath.x;
    this.anchorY = workPath.y;
    this.anchorZ = workPath.z;

    this.root.position.set(
      this.anchorX - origin.x, this.anchorY, this.anchorZ - origin.z
    );

    const road = geometryData();
    const terrain = geometryData();
    const vergeData = geometryData();
    const marking = geometryData();
    const white = [0.70, 0.77, 0.79];
    const red = [0.46, 0.035, 0.045];
    // Lane spacing matters: terrain is bilinear between lanes while
    // scatter placement uses the analytic groundOffset, so wide
    // bands would leave props floating over the interpolated chord.
    const terrainLanes = [-90, -76, -62, -48, -36, -17, -13, -8,
                          8, 13, 17, 36, 48, 62, 76, 90];

    for (let j = 0; j < 8; j++) {
      const s0 = this.start + j * 8;
      const s1 = s0 + 8;
      this.strip(road, s0, s1, -7, 7, 0, null);

      for (let k = 0; k < terrainLanes.length - 1; k++) {
        const a = terrainLanes[k];
        const b = terrainLanes[k + 1];
        // Muddy shoulder hugs the pavement, feathered into forest floor.
        const inner = Math.min(Math.abs(a), Math.abs(b));
        const outer = Math.max(Math.abs(a), Math.abs(b));
        const isVerge = inner >= 8 && outer <= 17;
        const forestTint = [
          0.52 + 0.06 * Math.sin(s0 * 0.03 + k),
          0.66 + 0.08 * Math.sin(s0 * 0.018 - k),
          0.64 + 0.06 * Math.cos(s0 * 0.015 + k)
        ];
        const mudTint = [
          0.62 + 0.07 * Math.sin(s0 * 0.05 + k),
          0.55 + 0.06 * Math.sin(s0 * 0.033 - k),
          0.48 + 0.05 * Math.cos(s0 * 0.021 + k)
        ];
        const feather = Math.min(1, (inner - 8) / 9);
        const tint = isVerge
          ? mudTint.map((c, i) => lerp(c, forestTint[i], feather))
          : forestTint;
        this.strip(
          isVerge ? vergeData : terrain, s0, s1, a, b, 0, tint, true
        );
      }

      this.strip(marking, s0, s1, -6.76, -6.62, 0.018, white);
      this.strip(marking, s0, s1, 6.62, 6.76, 0.018, white);
      this.strip(marking, s0 + 0.8, s0 + 4.6, -0.065, 0.065, 0.02, white);

      const curbColor = ((index * 8 + j) & 1) ? red : white;
      this.strip(marking, s0, s1, -7.5, -7, 0.045, curbColor);
      this.strip(marking, s0, s1, 7, 7.5, 0.045, curbColor);

      path.sample(s0 + 4, workPath);
      const c = Math.cos(workPath.heading);
      const n = Math.sin(workPath.heading);

      for (let side = 0; side < 2; side++) {
        const lateral = side === 0 ? -8.35 : 8.35;
        for (let rail = 0; rail < 2; rail++) {
          setInstance(
            this.rails, j * 4 + side * 2 + rail,
            workPath.x + c * lateral - this.anchorX,
            workPath.y - this.anchorY + lateral * workPath.bank + 0.62 + rail * 0.36,
            workPath.z - n * lateral - this.anchorZ,
            workPath.heading, 0.13, 0.13, 8.15
          );
        }
      }
    }

    for (let j = 0; j <= 8; j++) {
      path.sample(this.start + j * 8, workPath);
      const c = Math.cos(workPath.heading);
      const n = Math.sin(workPath.heading);
      for (let side = 0; side < 2; side++) {
        const lateral = side === 0 ? -8.35 : 8.35;
        const x = workPath.x + c * lateral - this.anchorX;
        const y = workPath.y - this.anchorY + lateral * workPath.bank;
        const z = workPath.z - n * lateral - this.anchorZ;
        setInstance(this.posts, j * 2 + side, x, y + 0.52, z,
                    workPath.heading, 0.13, 1.08, 0.16);
        setInstance(this.reflectors, j * 2 + side, x, y + 1.08, z,
                    workPath.heading, 0.19, 0.12, 0.08);
      }
    }

    const rand = randomGenerator(Math.imul(index + 1, 747796405));
    if (forestParts &&
        (!this.glbTrees || this.glbTrees.length !== forestParts.length))
      this.initGlbForest();
    for (const name of sceneryParts.keys()) this.initScenery(name);
    for (const name of variantAssets.keys()) this.initVariants(name);
    const scenerySlots = {};
    const putScenery = (name, x, y, z, yaw, sx, sy, sz) => {
      const meshes = this.scenery[name];
      if (!meshes) return false;
      const slot = scenerySlots[name] || 0;
      if (slot >= meshes[0].userData.capacity) return false;
      for (const mesh of meshes) setInstance(mesh, slot, x, y, z, yaw, sx, sy, sz);
      scenerySlots[name] = slot + 1;
      return true;
    };
    // Variant props draw ONE randomly-chosen variant per slot.
    const variantSlots = {};
    const putVariant = (name, x, y, z, yaw, s, variant) => {
      const group = this.variants[name];
      if (!group) return false;
      const vi = variant % group.length;
      const slots = variantSlots[name] ||
        (variantSlots[name] = new Array(group.length).fill(0));
      const slot = slots[vi];
      if (slot >= group[vi][0].userData.capacity) return false;
      for (const mesh of group[vi])
        setInstance(mesh, slot, x, y, z, yaw, s, s, s);
      slots[vi] = slot + 1;
      return true;
    };
    // Forest: scanned GLB trees fill both near and distant slots.
    // Every tree is a scanned GLB species — no procedural cones.
    // Slots are shared per species, so each species mesh is sized
    // for the full quota and overflow slots are simply skipped.
    const glbSlots = this.glbTrees ? this.glbTrees.map(() => 0) : null;
    for (let j = 0; j < CFG.treesPerChunk; j++) {
      const s = this.start + rand() * CFG.chunkLength;
      const nearForest = j < Math.floor(CFG.treesPerChunk * 0.68);
      let lateral = (j & 1 ? -1 : 1) *
        (nearForest ? 12 + rand() * 23 : 36 + rand() * 52);
      path.sample(s, workPath);
      lateral = clampInside(workPath, lateral);
      if (!this.glbTrees) continue;
      const x = workPath.x + Math.cos(workPath.heading) * lateral - this.anchorX;
      const z = workPath.z - Math.sin(workPath.heading) * lateral - this.anchorZ;
      const base = workPath.y - this.anchorY + groundOffset(workPath, s, lateral);
      const h = nearForest ? 10 + rand() * 16 : 14 + rand() * 22;
      const yaw = rand() * TAU;

      const species = Math.floor(rand() * this.glbTrees.length);
      const slot = glbSlots[species];
      if (slot >= this.glbTrees[species][0].userData.capacity) continue;
      glbSlots[species] = slot + 1;
      for (const mesh of this.glbTrees[species]) {
        setInstance(mesh, slot, x, base, z, yaw, h, h, h);
      }
    }
    if (this.glbTrees) {
      this.glbTrees.forEach((meshes, species) => {
        for (const mesh of meshes) {
          mesh.count = glbSlots[species];
          mesh.visible = mesh.count > 0;
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.count) mesh.computeBoundingSphere();
        }
      });
    }
    // Forest understorey, verge shrubs and low stone outcrops; the
    // N-key density scale trims the undergrowth in ECO mode.
    // Scanned foliage clumps replace most procedural blob shrubs.
    const shrubSlots = Math.floor(CFG.treesPerChunk * 2 * envDensity *
      (variantAssets.has('foliage') ? 0.4 : 1));
    let shrubIndex = 0;
    for (let j = 0; j < shrubSlots; j++) {
      const s = this.start + rand() * CFG.chunkLength;
      let lateral = (j & 1 ? -1 : 1) * (9.9 + rand() * 46);
      path.sample(s, workPath);
      lateral = clampInside(workPath, lateral);
      const x = workPath.x + Math.cos(workPath.heading) * lateral - this.anchorX;
      const z = workPath.z - Math.sin(workPath.heading) * lateral - this.anchorZ;
      const base = workPath.y - this.anchorY + groundOffset(workPath, s, lateral);
      const r = 0.36 + rand() * 1.0;
      if ((j & 1) === 0 && putScenery('shrub', x, base, z, rand() * TAU,
                                      r * 1.6, r * 1.6, r * 1.6))
        continue;
      setInstance(this.shrubs, shrubIndex, x, base + r * 0.56, z,
                  rand() * TAU, r * (0.8 + rand() * 0.8), r * 0.8, r);
      tempColor.setHSL(0.26 + rand() * 0.12, 0.23, 0.07 + rand() * 0.065);
      this.shrubs.setColorAt(shrubIndex, tempColor);
      shrubIndex++;
    }
    this.shrubs.count = shrubIndex;
    const grassSlots = Math.floor(CFG.grassPerChunk * envDensity);
    for (let j = 0; j < grassSlots; j++) {
      const s = this.start + rand() * CFG.chunkLength;
      const lateral = (j & 1 ? -1 : 1) * (8.15 + rand() * 8.5);
      path.sample(s, workPath);
      const x = workPath.x + Math.cos(workPath.heading) * lateral - this.anchorX;
      const z = workPath.z - Math.sin(workPath.heading) * lateral - this.anchorZ;
      const base = workPath.y - this.anchorY + groundOffset(workPath, s, lateral);
      setInstance(this.grass, j, x, base - 0.03, z, rand() * TAU,
                  0.55 + rand() * 0.9, 0.3 + rand() * 0.7,
                  0.55 + rand() * 0.9);
    }
    this.grass.count = grassSlots;
    // Ferns fill the shaded undergrowth band between verge and forest.
    const fernSlots = Math.floor(CFG.fernsPerChunk * envDensity);
    let fernIndex = 0;
    for (let j = 0; j < fernSlots; j++) {
      const s = this.start + rand() * CFG.chunkLength;
      let lateral = (j & 1 ? -1 : 1) * (9.4 + rand() * 32);
      path.sample(s, workPath);
      lateral = clampInside(workPath, lateral);
      const x = workPath.x + Math.cos(workPath.heading) * lateral - this.anchorX;
      const z = workPath.z - Math.sin(workPath.heading) * lateral - this.anchorZ;
      const base = workPath.y - this.anchorY + groundOffset(workPath, s, lateral);
      const r = 0.5 + rand() * 1.1;
      if (Math.abs(lateral) < 24 &&
          putScenery('fern', x, base, z, rand() * TAU, r, r, r))
        continue;
      setInstance(this.ferns, fernIndex, x, base - 0.02, z, rand() * TAU,
                  r, r * (0.55 + rand() * 0.5), r);
      fernIndex++;
    }
    this.ferns.count = fernIndex;
    const rockSlots = envDensity > 0.6 ? 9 : 5;
    let rockIndex = 0;
    for (let j = 0; j < rockSlots; j++) {
      const s = this.start + rand() * CFG.chunkLength;
      let lateral = (j & 1 ? -1 : 1) * (9.7 + rand() * 35);
      path.sample(s, workPath);
      lateral = clampInside(workPath, lateral);
      const x = workPath.x + Math.cos(workPath.heading) * lateral - this.anchorX;
      const z = workPath.z - Math.sin(workPath.heading) * lateral - this.anchorZ;
      const base = workPath.y - this.anchorY + groundOffset(workPath, s, lateral);
      const r = 0.45 + rand() * 1.15;
      if (putVariant('rock', x, base - r * 0.5, z, rand() * TAU,
                     r * 1.4, Math.floor(rand() * 6)) ||
          putScenery('rock', x, base, z, rand() * TAU,
                     r * 1.65, r * 0.75, r))
        continue;
      setInstance(this.rocks, rockIndex, x, base + r * 0.19, z,
                  rand() * TAU, r * 1.65, r * 0.65, r);
      rockIndex++;
    }
    this.rocks.count = rockIndex;
    // Hero trees: real ~100k-tri scans, kept sparse near the road and
    // frustum-culled per chunk so only visible stretches render.
    for (let j = 0; j < 2 && variantAssets.has('hero'); j++) {
      const s = this.start + rand() * CFG.chunkLength;
      const lateral = (j & 1 ? -1 : 1) * (11 + rand() * 17);
      path.sample(s, workPath);
      const x = workPath.x + Math.cos(workPath.heading) * lateral - this.anchorX;
      const z = workPath.z - Math.sin(workPath.heading) * lateral - this.anchorZ;
      const base = workPath.y - this.anchorY + groundOffset(workPath, s, lateral);
      putVariant('hero', x, base, z, rand() * TAU,
                 9 + rand() * 7, Math.floor(rand() * 3));
    }
    // Foliage clumps fill the shaded band beside the verge.
    const foliageSlots =
      Math.floor(24 * envDensity) * (variantAssets.has('foliage') ? 1 : 0);
    for (let j = 0; j < foliageSlots; j++) {
      const s = this.start + rand() * CFG.chunkLength;
      const lateral = (j & 1 ? -1 : 1) * (8.5 + rand() * 8.5);
      path.sample(s, workPath);
      const x = workPath.x + Math.cos(workPath.heading) * lateral - this.anchorX;
      const z = workPath.z - Math.sin(workPath.heading) * lateral - this.anchorZ;
      const base = workPath.y - this.anchorY + groundOffset(workPath, s, lateral);
      putVariant('foliage', x, base - 0.02, z, rand() * TAU,
                 0.5 + rand() * 1.2, Math.floor(rand() * 20));
    }
    // Stumps only exist when the scanned asset is installed.
    for (let j = 0; j < 6 && sceneryParts.has('stump'); j++) {
      const s = this.start + rand() * CFG.chunkLength;
      let lateral = (j & 1 ? -1 : 1) * (10.5 + rand() * 30);
      path.sample(s, workPath);
      lateral = clampInside(workPath, lateral);
      const x = workPath.x + Math.cos(workPath.heading) * lateral - this.anchorX;
      const z = workPath.z - Math.sin(workPath.heading) * lateral - this.anchorZ;
      const base = workPath.y - this.anchorY + groundOffset(workPath, s, lateral);
      const r = 0.7 + rand() * 0.9;
      putScenery('stump', x, base, z, rand() * TAU, r, r, r);
    }
    for (const name in this.scenery) {
      const used = scenerySlots[name] || 0;
      for (const mesh of this.scenery[name]) {
        mesh.count = used;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const name in this.variants) {
      const slots = variantSlots[name] || [];
      this.variants[name].forEach((meshes, vi) => {
        for (const mesh of meshes) {
          mesh.count = slots[vi] || 0;
          mesh.visible = mesh.count > 0;
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.count) mesh.computeBoundingSphere();
        }
      });
    }
    for (let j = 0; j < 13; j++) {
      const s = this.start + 3 + rand() * (CFG.chunkLength - 6);
      const lateral = (rand() - 0.5) * 12.7;
      path.sample(s, workPath);
      const x = workPath.x + Math.cos(workPath.heading) * lateral - this.anchorX;
      const z = workPath.z - Math.sin(workPath.heading) * lateral - this.anchorZ;
      setInstance(this.puddles, j,
                  x, workPath.y - this.anchorY + workPath.bank * lateral + 0.034,
                  z, workPath.heading + (rand() - 0.5) * 0.16,
                  0.65 + rand() * 3.2, 1, 2.5 + rand() * 7.0);
    }
    this.puddles.instanceMatrix.needsUpdate = true;

    updateGeometry(this.road.geometry, road);
    updateGeometry(this.ground.geometry, terrain);
    updateGeometry(this.verge.geometry, vergeData);
    updateGeometry(this.markings.geometry, marking);

    for (const mesh of [
      this.rails, this.posts, this.reflectors,
      this.shrubs, this.rocks, this.grass, this.ferns
    ]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
}

const chunks = Array.from({ length: CFG.chunkCount }, () => new TrackChunk());

// Quantized GLBs (KHR_mesh_quantization) store int16/int8 normalized
// attributes; baking a node transform into those would clamp every
// vertex to [-1, 1]. Copy position/normal/uv into plain Float32
// storage first and drop the attributes instancing never reads.
function floatGeometry(source, matrix) {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attr = source.getAttribute(name);
    if (!attr) continue;
    const size = attr.itemSize;
    const out = new Float32Array(attr.count * size);
    for (let i = 0; i < attr.count; i++) {
      out[i * size] = attr.getX(i);
      if (size > 1) out[i * size + 1] = attr.getY(i);
      if (size > 2) out[i * size + 2] = attr.getZ(i);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(
      new Float32Array(geometry.getAttribute('position').count * 2), 2
    ));
  }
  if (source.index) geometry.setIndex(source.index.clone());
  for (const group of source.groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  geometry.applyMatrix4(matrix);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  return geometry;
}

// Shared GLB extraction: meshes are merged per material into
// instancing-ready parts. Used by the forest and scenery loaders.
function gltfParts(gltf) {
  const buckets = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(node => {
        if (!node.isMesh) return;
        const geometry = floatGeometry(node.geometry, node.matrixWorld);
        const mats = Array.isArray(node.material)
          ? node.material : [node.material];
        if (mats.length < 2 || !geometry.index || !geometry.groups.length) {
          if (!buckets.has(mats[0])) buckets.set(mats[0], []);
          buckets.get(mats[0]).push(geometry);
          return;
        }
        for (const group of geometry.groups) {
          const sub = geometry.clone();
          sub.clearGroups();
          sub.setIndex(new THREE.BufferAttribute(
            geometry.index.array.slice(
              group.start, group.start + group.count
            ), 1
          ));
          const mat = mats[group.materialIndex] || mats[0];
          if (!buckets.has(mat)) buckets.set(mat, []);
          buckets.get(mat).push(sub);
        }
      });

  const parts = [];
  for (const [material, geometries] of buckets) {
    for (const g of geometries) {
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv')
          g.deleteAttribute(name);
      }
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(
          new Float32Array(g.attributes.position.count * 2), 2
        ));
      }
    }
    const merged = geometries.length === 1 ? geometries[0]
      : BufferGeometryUtils.mergeGeometries(geometries);
    if (!merged) continue;
    const mat = material.clone();
    mat.vertexColors = false;
    mat.side = THREE.DoubleSide;
    parts.push({ geometry: merged, material: mat });
  }
  return parts;
}

// Normalize a part set to a 1 m-tall prop standing on y=0 (or to a
// 1 m largest extent for flat props); per-instance scale then
// supplies real size.
function normalizeParts(parts, byExtent = false) {
  const bounds = new THREE.Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    bounds.union(part.geometry.boundingBox);
  }
  const size = bounds.getSize(new THREE.Vector3());
  const scale = 1 / Math.max(0.01,
    byExtent ? Math.max(size.x, size.y, size.z) : size.y);
  const normalize = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(
      -(bounds.min.x + bounds.max.x) / 2,
      -bounds.min.y,
      -(bounds.min.z + bounds.max.z) / 2
    ));
  for (const part of parts) part.geometry.applyMatrix4(normalize);
}

function rebuildActiveChunks() {
  for (const chunk of chunks) {
    if (chunk.index >= 0) chunk.rebuild(chunk.index);
  }
}

// Loads trees/spruce.glb and trees/pine.glb if present; each part
// becomes one InstancedMesh per chunk. Missing species reduce the
// roster — distant impostor sprites cover the horizon either way.
async function loadForestGLB() {
  const urls = ASSETS.treeSpecies;
  // Trees stream first (low priority numbers): they sit nearest the
  // road and carry the biggest visual weight.
  const results = await Promise.all(urls.map((url, i) =>
    queuedJob(`forest:${url}`, i,
      () => makeGLTFLoader().loadAsync(url))
      .then(gltf => {
        const parts = gltfParts(gltf);
        if (!parts.length) return null;
        normalizeParts(parts);
        return parts;
      })
      .catch(() => null)
  ));
  const species = results.filter(Boolean);
  if (!species.length) return;
  // Append: the nature-pack birch may already be registered.
  forestParts = species.concat(forestParts || []);
  rebuildActiveChunks();
  toast('GLB FOREST ACTIVE', 2400);
}

// Optional scanned props from scenery/{rock,fern,stump,shrub}.glb.
// Instanced meshes are allocated lazily per installed type only.
async function loadSceneryGLB() {
  const names = ASSETS.sceneryKinds;
  const results = await Promise.all(names.map((name, i) =>
    queuedJob(`scenery:${name}`, 10 + i,
      () => makeGLTFLoader().loadAsync(ASSETS.sceneryFile(name)))
      .then(gltf => {
        const parts = gltfParts(gltf);
        if (!parts.length) return null;
        normalizeParts(parts);
        return parts;
      })
      .catch(() => null)
  ));
  let found = 0;
  results.forEach((parts, i) => {
    if (parts) { sceneryParts.set(names[i], parts); found++; }
  });
  if (!found) return;
  rebuildActiveChunks();
  toast('GLB SCENERY ACTIVE', 2400);
}

// ================================================================
// 3b. Nature pack: user-supplied assets under assets/nature/.
// The GLBs ship without materials, so textures from tex/ are
// assigned by node-name convention. Per-node extraction keeps
// variants separate instead of merging them per material.
// ================================================================

function namedParts(gltf) {
  const parts = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(node => {
    if (!node.isMesh) return;
    parts.push({
      name: node.name || 'part',
      geometry: floatGeometry(node.geometry, node.matrixWorld)
    });
  });
  return parts;
}

function natureMaterial(map, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: map || null,
    color: map ? 0xffffff : (opts.color || 0x5a6b55),
    roughness: opts.roughness ?? 0.95,
    alphaTest: opts.alphaTest || 0,
    side: opts.double === false ? THREE.FrontSide : THREE.DoubleSide
  });
  if (opts.normal) mat.normalMap = opts.normal;
  if (opts.rough) mat.roughnessMap = opts.rough;
  if (opts.ao) { mat.aoMap = opts.ao; opts.ao.channel = 0; }
  if (opts.opacity) { mat.alphaMap = opts.opacity; mat.alphaTest = 0.4; }
  return mat;
}

// Variant-based prop registry: name -> list of variants, where each
// variant is a list of { geometry, material } parts drawn together.
const variantAssets = new Map();

// Cut-out foliage atlases keep white RGB under alpha 0. Mipmapping
// averages that white into every small leaf (canopies look snowy),
// so transparent texels are refilled with the mean leaf colour.
function bleedAlpha(texture) {
  if (!texture || texture.isCompressedTexture || !texture.image) return texture;
  const { width: w, height: h } = texture.image;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(texture.image, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 200) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  }
  if (!n) return texture;
  r /= n; g /= n; b /= n;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) { data[i] = r; data[i + 1] = g; data[i + 2] = b; }
  }
  const out = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  out.colorSpace = texture.colorSpace;
  out.wrapS = out.wrapT = THREE.RepeatWrapping;
  out.generateMipmaps = true;
  out.minFilter = THREE.LinearMipmapLinearFilter;
  out.magFilter = THREE.LinearFilter;
  out.anisotropy = texture.anisotropy;
  out.flipY = false;        // getImageData rows already match glTF UVs
  out.needsUpdate = true;
  texture.dispose();
  return out;
}

async function loadNature() {
  // glTF UVs put v = 0 at the image top, so these maps must not be
  // flipped the way TextureLoader does by default.
  const gltfTex = t => { if (t) t.flipY = false; return t; };
  const tex = n => pbrTexture(`assets/nature/tex/${n}.webp`, false).then(gltfTex);
  const texC = n => pbrTexture(`assets/nature/tex/${n}.webp`, true).then(gltfTex);
  const texCut = n => pbrTexture(`assets/nature/tex/${n}.webp`, true).then(bleedAlpha);
  const load = (key, url, pri) =>
    queuedJob(`nature:${key}`, pri,
      () => makeGLTFLoader().loadAsync(url))
      .then(namedParts).catch(() => null);

  const [treeA, treeB, birch, rocks, foliage] = await Promise.all([
    load('treeA', 'assets/nature/tree_a.glb', 6),
    load('treeB', 'assets/nature/tree_b.glb', 6),
    load('birch', 'assets/nature/birch.glb', 2),
    load('rocks', 'assets/nature/rocks.glb', 7),
    load('foliage', 'assets/nature/foliage.glb', 8)
  ]);
  if (!treeA && !treeB && !birch && !rocks && !foliage) return;

  // Opacity (_o) masks are data, so they stay linear like normals.
  const [bark1, bark1n, leaf1, leaf2, bTrunk, bTrunkN, bBranch, bLeaf,
         grassA, grassO, plantA, plantO, flowerA, flowerO] =
    await Promise.all([
      texC('tree1_bark'), tex('tree1_bark_n'),
      texCut('tree1_leaf'), texCut('tree2_leaf'),
      texC('birch_trunk'), tex('birch_trunk_n'),
      texCut('birch_branch'), texCut('birch_leaf'),
      texC('pn_grass_a'), tex('pn_grass_o'),
      texC('pn_plant_a'), tex('pn_plant_o'),
      texC('pn_flower_a'), tex('pn_flower_o')
    ]);

  const barkMat = natureMaterial(bark1,
    { normal: bark1n, roughness: 0.92, color: 0x4a3f33 });
  const leafMatA = natureMaterial(leaf1,
    { alphaTest: 0.5, color: 0x3d5a35 });
  const leafMatB = natureMaterial(leaf2,
    { alphaTest: 0.5, color: 0x44603a });
  const birchBark = natureMaterial(bTrunk,
    { normal: bTrunkN, roughness: 0.9, color: 0x8a8578 });
  const birchBranch = natureMaterial(bBranch,
    { alphaTest: 0.5, color: 0x6f6a60 });
  const birchLeaf = natureMaterial(bLeaf,
    { alphaTest: 0.5, color: 0x54683f });
  // Shared with the procedural outcrops; its stone scan maps are
  // bound by loadPBRTextures().
  const stoneMat = materials.rock;
  for (const mat of [leafMatA, leafMatB, birchBranch, birchLeaf]) {
    addWindSway(mat, 0.012);
  }

  let any = false;

  // Birch is three primitives: trunk (starts at the ground), branch
  // cards (start just above it) and leaf canopy (starts highest).
  if (birch) {
    const minY = p => {
      p.geometry.computeBoundingBox();
      return p.geometry.boundingBox.min.y;
    };
    const ordered = [...birch].sort((a, b) => minY(a) - minY(b));
    const pick = [birchBark, birchBranch, birchLeaf];
    const parts = ordered.map((p, i) => ({
      geometry: p.geometry,
      material: ordered.length === 3 ? pick[i]
        : i === ordered.length - 1 ? birchLeaf : birchBark
    }));
    normalizeParts(parts);
    forestParts = (forestParts || []).concat([parts]);
    any = true;
  }

  // Node names are "leaves" / "trunk" ("leaf" alone would not match).
  const isLeaf = p => /lea(f|ves)|foliage|canopy/i.test(p.name);
  const hero = [];
  if (treeA) {
    normalizeParts(treeA);
    hero.push(treeA.map(p => ({
      geometry: p.geometry,
      material: isLeaf(p) ? leafMatA : barkMat
    })));
  }
  if (treeB) {
    normalizeParts(treeB);
    hero.push(treeB.map(p => ({
      geometry: p.geometry,
      material: isLeaf(p) ? leafMatB : barkMat
    })));
  }
  if (hero.length) { variantAssets.set('hero', hero); any = true; }

  if (rocks) {
    const variants = rocks.map(p => {
      normalizeParts([p], true);
      return [{ geometry: p.geometry, material: stoneMat }];
    });
    variantAssets.set('rock', variants);
    any = true;
  }

  if (foliage) {
    const flowerMat = natureMaterial(flowerA,
      { opacity: flowerO, color: 0x5a6e3f });
    const plantMat = natureMaterial(plantA,
      { opacity: plantO, color: 0x4a5f38 });
    const grassMat = natureMaterial(grassA,
      { opacity: grassO, color: 0x52683f });
    addWindSway(grassMat, 0.08);
    addWindSway(flowerMat, 0.06);
    // Every other clump: half the draw calls, same visual variety.
    const variants = foliage.filter((_, i) => i % 2 === 0).map(p => {
      // Ground covers are flat, so normalize by the largest extent
      // rather than height (height would blow them up to 20 m).
      normalizeParts([p], true);
      const mat = /flower/i.test(p.name) ? flowerMat
        : /ground/i.test(p.name) ? plantMat : grassMat;
      return [{ geometry: p.geometry, material: mat }];
    });
    variantAssets.set('foliage', variants);
    any = true;
  }

  if (any) {
    rebuildActiveChunks();
    toast('NATURE PACK ACTIVE', 2400);
  }
}

// Scanned car models dress the traffic, rivals and the player.
// Each spec normalizes a GLB into makeCar's convention (+Z nose,
// ground at y=0, real-world length), finds wheel corner groups and
// re-pivots them into the steer/spin contract, and picks which
// material(s) receive the random paint tint.
// Missing files skip silently — procedural bodies remain.
// spec.yaw flips nose-vs-tail (0 or PI) after the loader puts the
// long axis on Z with +X->+Z convention (-PI/2 when model runs on X).
const CAR_SPECS = [
  { url: ASSETS.playerAndTrafficCar, yaw: 0, length: 4.55,
    wheelRe: /^(fl|fr|rl|rr)[_ ]?wheel$/i,
    corner: m => m[1].toUpperCase(), front: k => k[0] === 'F',
    paint: /body/i },
  { url: ASSETS.trafficCarModels[0], yaw: 0, length: 4.61,
    wheelRe: /^M_Wheel(F|B)(L|R)/i,
    corner: m => (m[1] + m[2]).toUpperCase(), front: k => k[0] === 'F',
    paint: /paintjob/i,
    // The Mustang OBJ ships one flat gray for every part — re-dress
    // materials by name so chrome, glass, tires and lamps read apart.
    fixup: [
      [/chrome|rim|grill|exhaust|mirror/i,
       { metalness: 0.95, roughness: 0.18, color: 0xdfe2e6 }],
      [/tire|brakepad|blacktrim|_dark/i,
       { roughness: 0.92, color: 0x141518 }],
      [/windshield|glass/i,
       { metalness: 0.4, roughness: 0.08, color: 0x101c24,
         transparent: true, opacity: 0.55 }],
      [/headlight|turnsignal/i,
       { roughness: 0.25, color: 0xf0ead0, emissive: 0x35301e }],
      [/tailight|taillight/i,
       { roughness: 0.3, color: 0x7d1a12, emissive: 0x2a0805 }]
    ] },
  { url: ASSETS.trafficCarModels[1], yaw: 0, length: 4.06,
    wheelRe: null, paint: 'largest',
    // Beetle VRay mats are all pure black; lambert6SG (the only gray
    // one) is the brightwork/interior set — give it a chrome finish.
    fixup: [
      [/lambert6sg/i,
       { metalness: 0.9, roughness: 0.28, color: 0xc9ccd2 }],
      [/vray|initialshading/i,
       { roughness: 0.5, metalness: 0.35, color: 0x2a2d33 }]
    ] }
];

// Tint the material covering the most triangles — for merged-mesh
// models with opaque names (the Beetle's VRayMtl*SG set), the body
// shell is by far the biggest primitive.
function largestPaintMaterial(root) {
  const tris = new Map();
  root.traverse(object => {
    if (!object.isMesh) return;
    const n = object.geometry.index ? object.geometry.index.count
                                    : object.geometry.attributes.position.count;
    const mats = Array.isArray(object.material)
      ? object.material : [object.material];
    for (const m of mats) tris.set(m, (tris.get(m) || 0) + n);
  });
  let best = null, bestN = 0;
  for (const [m, n] of tris) if (n > bestN) { best = m; bestN = n; }
  return best;
}

async function loadCars() {
  // Load every spec that exists; missing files drop out of the pool.
  const templates = [];
  for (let i = 0; i < CAR_SPECS.length; i++) {
    const spec = CAR_SPECS[i];
    let gltf;
    try {
      gltf = await queuedJob(`cars:${i}`, 5,
        () => makeGLTFLoader().loadAsync(spec.url));
    } catch (error) { continue; }
    const template = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(gltf.scene);
    template.add(inner);
    template.updateMatrixWorld(true);
    let bounds = new THREE.Box3().setFromObject(template);
    let size = bounds.getSize(new THREE.Vector3());
    // Put the long axis on Z (car forward) with +X -> +Z handedness.
    // spec.yaw (0 or PI) then only chooses nose-vs-tail.
    inner.rotation.y = (size.x > size.z ? -Math.PI / 2 : 0) + spec.yaw;
    template.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(template);
    size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.z) || size.z < 0.001) continue;
    const center = bounds.getCenter(new THREE.Vector3());
    const s = spec.length / size.z;
    inner.scale.setScalar(s);
    inner.position.set(-center.x * s, -bounds.min.y * s, -center.z * s);
    // Per-model material fixes — converted OBJ/FBX assets often ship
    // one flat gray (Mustang) or pure black (Beetle) for every part.
    if (spec.fixup) {
      template.traverse(object => {
        if (!object.isMesh) return;
        const mats = Array.isArray(object.material)
          ? object.material : [object.material];
        for (const m of mats) {
          for (const [re, props] of spec.fixup) {
            if (!re.test(m.name)) continue;
            if (props.color !== undefined) m.color.set(props.color);
            if (props.emissive !== undefined && m.emissive)
              m.emissive.set(props.emissive);
            if (props.metalness !== undefined) m.metalness = props.metalness;
            if (props.roughness !== undefined) m.roughness = props.roughness;
            if (props.opacity !== undefined) {
              m.transparent = true;
              m.opacity = props.opacity;
              m.depthWrite = false;
            }
          }
        }
      });
    }
    // Clones share materials, so resolve 'largest' once on the
    // template — the same instance shows up inside every wrapper.
    templates.push({ spec, template,
      paintTarget: spec.paint === 'largest'
        ? largestPaintMaterial(template) : null });
  }
  if (!templates.length) return;

  const paintRand = randomGenerator(614);
  const paintColor = () => {
    const c = new THREE.Color();
    if (paintRand() < 0.4) {
      // Showroom neutrals: black, silver, gray, off-white.
      c.setHSL(0.58, 0.03,
               [0.1, 0.35, 0.55, 0.85][Math.floor(paintRand() * 4)]);
    } else {
      // Painted colors stay fairly bright — the tint multiplies an
      // already-dark basecolor texture on textured models.
      c.setHSL(paintRand(), 0.55 + paintRand() * 0.35,
               0.42 + paintRand() * 0.3);
    }
    return c;
  };

  function mount(car, tint, templateIndex) {
    const { spec, template, paintTarget } = templates[templateIndex];
    const wrapper = template.clone(true);
    wrapper.userData.shared = true;   // geometry shared across clones
    const corners = new Map();  // corner key -> {nodes:[], front}
    wrapper.traverse(object => {
      if (!object.isMesh) return;
      const mats = Array.isArray(object.material)
        ? object.material : [object.material];
      const isPaint = paintTarget
        ? mats.includes(paintTarget)
        : mats.some(m => spec.paint.test(m.name));
      if (isPaint) {
        const tinted = mats.map(m => {
          const c = m.clone();
          c.color = tint.clone ? tint.clone() : new THREE.Color(tint);
          // Automotive clearcoat look — glossy paint picks up the
          // environment instead of reading matte.
          if (c.metalness !== undefined) c.metalness = 0.45;
          if (c.roughness !== undefined) c.roughness = 0.32;
          if (c.envMapIntensity !== undefined) c.envMapIntensity = 1.15;
          return c;
        });
        object.material = Array.isArray(object.material)
          ? tinted : tinted[0];
      } else if (paintTarget) {
        // Untextured models (Beetle OBJ) ship every material at pure
        // black — lift non-body parts to readable dark tones so trim,
        // glass and tires shade instead of rendering as a void.
        const lifted = mats.map(m => {
          if (m.color && m.color.getHex() !== 0) return m;
          const c = m.clone();
          c.color = new THREE.Color(0x16181d);   // rubber/trim dark
          return c;
        });
        if (lifted.some((m, k) => m !== mats[k]))
          object.material = Array.isArray(object.material)
            ? lifted : lifted[0];
      }
      object.castShadow = object.receiveShadow = true;
      if (spec.wheelRe) {
        const match = spec.wheelRe.exec(object.name);
        if (match) {
          const key = spec.corner(match);
          if (!corners.has(key))
            corners.set(key, { nodes: [], front: spec.front(key) });
          corners.get(key).nodes.push(object);
        }
      }
    });
    car.root.add(wrapper);
    wrapper.updateMatrixWorld(true);
    for (const wheel of corners.values()) {
      // Pivot at the corner group's centroid; all its meshes spin.
      const c = new THREE.Vector3();
      for (const node of wheel.nodes)
        c.add(node.getWorldPosition(new THREE.Vector3()));
      c.divideScalar(wheel.nodes.length);
      const pivot = new THREE.Group();
      pivot.position.copy(wrapper.worldToLocal(c));
      const spin = new THREE.Group();
      pivot.add(spin);
      wrapper.add(pivot);
      wrapper.updateMatrixWorld(true);
      for (const node of wheel.nodes) spin.attach(node);
      car.wheels.push({ pivot, spin, front: wheel.front, mounted: true });
    }
    car.visual.visible = false;
    car.imported = wrapper;
    if (car === player && cockpitMode) wrapper.visible = false;
  }

  // The player keeps the DB4 in Aston racing green; traffic and
  // rivals draw a random model + paint each.
  const pick = rand => Math.floor(rand * templates.length);
  let i = 0;
  for (const t of traffic) mount(t.car, paintColor(), pick(paintRand()));
  for (const r of rivals) mount(r.car, paintColor(), pick(paintRand()));
  // Near-white tint keeps the DB4's baked Aston-green livery visible;
  // a colored multiply would darken the texture toward black.
  mount(player, new THREE.Color(0xf0f3ec), 0);
  toast('SCANNED CARS IN TRAFFIC', 2200);
}
let firstChunk = 0;
let lastChunk = CFG.chunkCount - 1;

// Layered continuous mountain ridgelines are significantly less
// artificial than isolated cone peaks. The entire backdrop follows the
// floating origin, while scene fog produces aerial perspective.
const mountains = new THREE.Group();
function mountainRidge(seed, radius, heightScale, shade) {
  const rand = randomGenerator(seed);
  const offsetA = rand() * 12, offsetB = rand() * 9;
  const segments = 192;
  const positions = [], colors = [], indices = [];
  const color = new THREE.Color(shade);
  const top = new THREE.Color(shade).lerp(new THREE.Color(0x50708a), 0.22);
  for (let i = 0; i <= segments; i++) {
    const a = i / segments * TAU;
    const ridgeline = 0.45 +
      Math.sin(a * 3.0 + offsetA) * 0.14 +
      Math.sin(a * 7.0 + offsetB) * 0.13 +
      Math.sin(a * 13.0 + offsetA) * 0.068 +
      Math.sin(a * 37.0 + offsetB) * 0.022;
    const irregularRadius = radius * (1 + 0.05 * Math.sin(a * 13 + offsetA));
    const x = Math.cos(a) * irregularRadius;
    const z = Math.sin(a) * irregularRadius;
    const high = 50 + heightScale * ridgeline;
    positions.push(x, high, z, x, -220, z);
    colors.push(top.r, top.g, top.b, color.r, color.g, color.b);
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, fog: true
  }));
  mesh.frustumCulled = false;
  return mesh;
}
mountains.add(mountainRidge(11, 980, 330, 0x172e43));
mountains.add(mountainRidge(27, 1370, 425, 0x3f617b));
scene.add(mountains);

// ================================================================
// 3c. World-region streaming: eight recycled 256 m tiles flank the
// route out to ±320 m of lateral relief. Optional JSON descriptors
// (regions/region_XXXX.json) supply biome + elevation samples; the
// procedural fallback keeps the world alive without them.
// ================================================================

const REGION_SPAN = 256;
const REGION_INNER = 86;       // overlaps the chunk terrain edge
const REGION_HALF = 320;
const REGION_GRID = 17;
const regionDescCache = new Map();
const regionStats = { active: 0, loading: 0, lod: [0, 0, 0] };
let worldMode = 0;             // 0 AUTO, 1 HIGH, 2 ECO
let worldDensity = 1;

// Conifer silhouette card for distant forest impostors.
const impostorTexture = canvasTexture(96, (ctx, size) => {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(14,30,22,.96)';
  ctx.fillRect(size * 0.46, size * 0.72, size * 0.08, size * 0.28);
  for (let i = 0; i < 5; i++) {
    const w = size * (0.44 - i * 0.058);
    const top = size * (0.06 + i * 0.14);
    const base = top + size * 0.22;
    ctx.beginPath();
    ctx.moveTo(size / 2, top);
    ctx.lineTo(size / 2 - w, base);
    ctx.lineTo(size / 2 + w, base);
    ctx.closePath();
    ctx.fill();
  }
});
const impostorCard = new THREE.PlaneGeometry(1, 1);
impostorCard.translate(0, 0.5, 0);
const impostorGeometry = BufferGeometryUtils.mergeGeometries([
  impostorCard, impostorCard.clone().rotateY(Math.PI / 2)
]);
const regionMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 1, flatShading: true, color: 0x54655a
});
const impostorMaterial = new THREE.MeshBasicMaterial({
  map: impostorTexture, alphaTest: 0.42, side: THREE.DoubleSide,
  fog: true, color: 0x8ca3b4
});
// A scanned 4-species atlas (assets/textures/impostor_atlas.png, see
// install_impostors.py) replaces the procedural silhouette. Each
// instance picks its cell by index, so a region mixes species for
// free — no extra meshes or attributes.
impostorMaterial.onBeforeCompile = shader => {
  if (!impostorMaterial.userData.atlas) return;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <uv_vertex>',
    '#include <uv_vertex>\n#ifdef USE_MAP\n' +
    '  vMapUv.x = vMapUv.x * 0.25 + float(gl_InstanceID & 3) * 0.25;\n' +
    '#endif');
};
impostorMaterial.customProgramCacheKey = () =>
  impostorMaterial.userData.atlas ? 'impostor-atlas' : 'impostor';
fetch(ASSETS.impostorManifest)
  .then(r => r.ok ? r.json() : null)
  .then(manifest => {
    if (!manifest || manifest.species !== 4) return;
    pbrLoader.load(manifest.file ?
      `assets/textures/${manifest.file}` :
      ASSETS.impostorAtlas, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      impostorMaterial.map = tex;
      impostorMaterial.userData.atlas = true;
      impostorMaterial.needsUpdate = true;
    });
  })
  .catch(() => {});

function fallbackDescriptor(i) {
  return {
    index: i, seed: i * 7919 + 137, biome: 'alpine',
    forest: 0.45 + 0.4 * Math.max(0, Math.sin(i * 1.71)),
    heights: null
  };
}

function validDescriptor(data, i) {
  const gridOk = key => Array.isArray(data[key]) &&
    data[key].length === REGION_GRID * REGION_GRID;
  return data && data.index === i &&
    (!data.heights || gridOk('heights')) &&
    (!data.elevations || gridOk('elevations'));
}

// Disk-backed descriptor fetch with cache, cancellation and a
// deterministic procedural fallback.
// regions/index.json (written by install_regions.py) lists how many
// descriptor files exist; the route reuses them cyclically so a
// finite dataset covers an endless road. No index -> procedural.
const regionIndex = fetch(ASSETS.regionIndex)
  .then(r => r.ok ? r.json() : null)
  .then(data => (data && data.count > 0 ? data : null))
  .catch(() => null);

function fetchDescriptor(region, i) {
  const cached = regionDescCache.get(i);
  // The caller builds right after assignment, so no rebuild here.
  if (cached) { region.desc = cached; return; }
  const ctl = new AbortController();
  region.loadCtl = ctl;
  regionStats.loading++;
  regionIndex
    .then(index => {
      if (!index) throw new Error('no region data');
      const file = (index.start || 0) + i % index.count;
      return fetch(ASSETS.regionFile(file),
                   { signal: ctl.signal })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('missing')))
        .then(data => {
          if (!validDescriptor(data, file)) throw new Error('invalid');
          return { ...data, index: i };
        });
    })
    .catch(() => fallbackDescriptor(i))
    .then(desc => {
      regionStats.loading--;
      if (ctl.signal.aborted) return;
      if (regionDescCache.size > 48) {
        regionDescCache.delete(
          regionDescCache.keys().next().value);
      }
      regionDescCache.set(i, desc);
      if (region.index === i) {
        region.desc = desc;
        region.rebuild();
      }
    });
}

function descHeight(desc, s, x, s0) {
  const g = desc && (desc.elevations || desc.heights);
  if (!g) return 0;
  const ts = clamp((s - s0) / REGION_SPAN, 0, 1) * (REGION_GRID - 1);
  const tx = clamp((x + REGION_HALF) / (2 * REGION_HALF), 0, 1) *
    (REGION_GRID - 1);
  const r0 = Math.min(REGION_GRID - 2, Math.floor(ts));
  const c0 = Math.min(REGION_GRID - 2, Math.floor(tx));
  const fr = ts - r0, fc = tx - c0;
  const h = g[r0 * REGION_GRID + c0] * (1 - fr) * (1 - fc)
          + g[(r0 + 1) * REGION_GRID + c0] * fr * (1 - fc)
          + g[r0 * REGION_GRID + c0 + 1] * (1 - fr) * fc
          + g[(r0 + 1) * REGION_GRID + c0 + 1] * fr * fc;
  // Sine fade at tile ends keeps sampled seams continuous; the
  // lateral ramp keeps the inner edge matched to the chunk terrain.
  const lateralFade = clamp((Math.abs(x) - 95) / 70, 0, 1);
  // DEM imports carry `elevations` in metres relative to the route
  // corridor; synthetic descriptors carry normalized `heights`.
  const metres = desc.elevations ? clamp(h, -80, 280) : (h - 0.5) * 56;
  return metres * lateralFade *
    Math.sin(Math.PI * ts / (REGION_GRID - 1));
}

// Beyond ~0.8 R the inside of a bend would pass the curvature centre
// and fold back over the road; clamp the band width per path sample.
function regionReach(p, sign) {
  const k = p.curvature * sign;
  return k > 0 ? Math.max(88, Math.min(REGION_HALF, 0.8 / k))
               : REGION_HALF;
}

// When the chunk terrain pulls its inside edge inward (hairpin), the
// region inner edge follows so no bare gap opens between them.
function regionInner(p, sign) {
  return p.curvature * sign > 0
    ? Math.min(REGION_INNER, 0.8 / Math.abs(p.curvature) - 4)
    : REGION_INNER;
}

// Continuous with the corridor: groundOffset carries the first ~95 m
// and mountain swells take over beyond the terrain edge.
function regionHeight(p, s, x, desc, s0) {
  const base = groundOffset(p, s, x);
  const m = Math.max(0, Math.abs(x) - 95);
  const seed = desc ? desc.seed : 1;
  return base
    - 0.14 * (1 - Math.min(1, m / 26))
    + m * 0.55
    + Math.sin(s * 0.0011 + x * 0.0041 + seed * 0.37)
      * Math.min(m, 230) * 0.24
    + Math.sin(s * 0.0033 - x * 0.0113 + seed * 0.71)
      * Math.min(m, 140) * 0.13
    + descHeight(desc, s, x, s0);
}

const regionSample = {};
class Region {
  constructor() {
    this.index = -1;
    this.lod = '';
    this.desc = null;
    this.loadCtl = null;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.bands = {};
    for (const lod of ['HIGH', 'MID', 'LOW']) {
      const pair = [
        new THREE.Mesh(new THREE.BufferGeometry(), regionMaterial),
        new THREE.Mesh(new THREE.BufferGeometry(), regionMaterial)
      ];
      for (const mesh of pair) mesh.visible = false;
      this.bands[lod] = pair;
      this.root.add(pair[0], pair[1]);
    }
    this.impostors = new THREE.InstancedMesh(
      impostorGeometry, impostorMaterial, 96
    );
    this.impostors.frustumCulled = false;
    this.impostors.count = 0;
    this.impostors.visible = false;
    this.root.add(this.impostors);
  }

  release() {
    if (this.loadCtl) { this.loadCtl.abort(); this.loadCtl = null; }
    this.index = -1;
    this.desc = null;
    for (const lod in this.bands) {
      for (const mesh of this.bands[lod]) mesh.visible = false;
    }
    this.impostors.count = 0;
    this.impostors.visible = false;
  }

  assign(i) {
    if (this.loadCtl) { this.loadCtl.abort(); this.loadCtl = null; }
    this.index = i;
    this.desc = null;
    fetchDescriptor(this, i);
    this.rebuild();
  }

  lodFor() {
    const centerS = this.index * REGION_SPAN + REGION_SPAN / 2;
    const dist = Math.abs(centerS - state.s);
    const hi = worldMode === 2 ? 210 : 340;
    const mid = worldMode === 2 ? 430 : 720;
    return dist < hi ? 'HIGH' : dist < mid ? 'MID' : 'LOW';
  }

  maybeRelod() {
    if (this.lodFor() !== this.lod) this.rebuild();
  }

  rebuild() {
    if (this.index < 0) return;
    const lod = this.lodFor();
    try { this.build(lod); } catch (error) { this.release(); return; }
    this.lod = lod;
  }

  build(lod) {
    const s0 = this.index * REGION_SPAN;
    const rows = { HIGH: 40, MID: 20, LOW: 10 }[lod];
    const cols = { HIGH: 16, MID: 10, LOW: 5 }[lod];
    path.sample(s0, regionSample);
    this.anchorX = regionSample.x;
    this.anchorY = regionSample.y;
    this.anchorZ = regionSample.z;
    this.root.position.set(
      this.anchorX - origin.x, this.anchorY, this.anchorZ - origin.z
    );

    for (const other of ['HIGH', 'MID', 'LOW']) {
      if (other !== lod) {
        for (const mesh of this.bands[other]) mesh.visible = false;
      }
    }
    const desc = this.desc;
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const data = geometryData();
      for (let r = 0; r < rows; r++) {
        const sA = s0 + r / rows * REGION_SPAN;
        const sB = s0 + (r + 1) / rows * REGION_SPAN;
        path.sample(sA, sampleA);
        path.sample(sB, sampleB);
        const innerA = regionInner(sampleA, sign);
        const innerB = regionInner(sampleB, sign);
        const reachA = regionReach(sampleA, sign) - innerA;
        const reachB = regionReach(sampleB, sign) - innerB;
        for (let c = 0; c < cols; c++) {
          const lat = (inner, reach, t) => sign * (inner + reach * t);
          const quad = [
            [sampleA, sA, lat(innerA, reachA, c / cols)],
            [sampleA, sA, lat(innerA, reachA, (c + 1) / cols)],
            [sampleB, sB, lat(innerB, reachB, c / cols)],
            [sampleB, sB, lat(innerB, reachB, (c + 1) / cols)]
          ];
          const verts = quad.map(([p, s, x]) => {
            const h = regionHeight(p, s, x, desc, s0);
            return [
              p.x + Math.cos(p.heading) * x - this.anchorX,
              p.y - this.anchorY + h,
              p.z - Math.sin(p.heading) * x - this.anchorZ,
              h
            ];
          });
          // Mirroring the lateral axis flips the winding; keep both
          // bands' faces pointing up so neither is back-face culled.
          for (const vi of sign > 0 ? [0, 2, 1, 1, 2, 3]
                                    : [0, 1, 2, 1, 3, 2]) {
            const [vx, vy, vz, vh] = verts[vi];
            data.position.push(vx, vy, vz);
            data.uv.push((vi % 2) * 4, r / rows * 8);
            // Forest green low, alpine gray-blue high, with jitter.
            const t = clamp((vh - 14) / 90, 0, 1);
            const j = Math.sin(vx * 0.9 + vz * 1.3) * 0.045;
            data.color.push(
              lerp(0.50, 0.66, t) + j,
              lerp(0.60, 0.68, t) + j,
              lerp(0.57, 0.72, t) + j
            );
          }
        }
      }
      const mesh = this.bands[lod][side];
      updateGeometry(mesh.geometry, data);
      mesh.visible = true;
    }

    // Forest impostors: sprite trees dot the slopes by biome density.
    const forest = (desc ? desc.forest : 0.5) * worldDensity *
      (lod === 'LOW' ? 0.55 : lod === 'MID' ? 0.8 : 1);
    const count = Math.min(96, Math.round(96 * forest));
    const rand = randomGenerator(
      Math.imul(this.index + 1, 2654435761) ^ (desc ? desc.seed : 0)
    );
    for (let j = 0; j < count; j++) {
      const s = s0 + rand() * REGION_SPAN;
      const sign = j & 1 ? -1 : 1;
      path.sample(s, workPath);
      const lateral = sign * (92 +
        rand() * (regionReach(workPath, sign) - 105));
      const base = workPath.y - this.anchorY +
        regionHeight(workPath, s, lateral, desc, s0);
      const x = workPath.x + Math.cos(workPath.heading) * lateral -
        this.anchorX;
      const z = workPath.z - Math.sin(workPath.heading) * lateral -
        this.anchorZ;
      const h = 7 + rand() * 11;
      setInstance(this.impostors, j, x, base - 0.4, z,
                  rand() * TAU, h, h, h);
    }
    this.impostors.count = count;
    this.impostors.visible = count > 0;
    this.impostors.instanceMatrix.needsUpdate = true;
  }
}

const regionPool = Array.from({ length: 8 }, () => new Region());
const regionFrustum = new THREE.Frustum();
const regionFrustumMatrix = new THREE.Matrix4();
const regionSphere = new THREE.Sphere(new THREE.Vector3(), 720);

function maintainRegions() {
  const center = Math.floor((state.s + 96) / REGION_SPAN);
  // The furthest wanted tile (center + 5) ends at (center + 6) spans;
  // the path must exist before any tile samples it, or the build
  // throws and the tile would be released and retried every frame.
  path.ensure((center + 6) * REGION_SPAN + CFG.pathStep);
  const want = new Set();
  for (let i = center - 2; i < center - 2 + 8; i++) {
    if (i >= 0) want.add(i);
  }
  for (const region of regionPool) {
    if (region.index >= 0 && !want.has(region.index)) {
      region.release();
    }
  }
  for (const i of want) {
    if (regionPool.some(r => r.index === i)) continue;
    const free = regionPool.find(r => r.index < 0);
    if (free) free.assign(i);
  }
  regionStats.active = 0;
  regionStats.culled = 0;
  regionStats.lod = [0, 0, 0];
  // Conservative frustum elimination: each region is bounded by a
  // sphere around its mid-path point (radius covers the half-span,
  // full lateral reach and terrain amplitude). Regions entirely
  // behind the camera skip all six band draws plus impostors.
  camera.updateMatrixWorld();
  regionFrustum.setFromProjectionMatrix(regionFrustumMatrix
    .multiplyMatrices(camera.projectionMatrix,
                      camera.matrixWorldInverse));
  for (const region of regionPool) {
    if (region.index < 0) continue;
    region.maybeRelod();
    path.sample(region.index * REGION_SPAN + REGION_SPAN / 2,
                regionSample);
    regionSphere.center.set(
      regionSample.x - origin.x, regionSample.y + 60,
      regionSample.z - origin.z);
    const visible = regionFrustum.intersectsSphere(regionSphere);
    region.root.visible = visible;
    regionStats.active++;
    regionStats.culled += visible ? 0 : 1;
    regionStats.lod[['HIGH', 'MID', 'LOW'].indexOf(region.lod)]++;
  }
}

function refreshRegions() {
  for (const region of regionPool) {
    if (region.index >= 0) region.rebuild();
  }
}

function setWorldDensity(v) {
  if (v === worldDensity) return;
  worldDensity = v;
  refreshRegions();
}
const worldModes = ['AUTO', 'HIGH', 'ECO'];
function cycleWorldMode() {
  worldMode = (worldMode + 1) % worldModes.length;
  worldDensity = worldMode === 2 ? 0.5 : 1;
  refreshRegions();
  toast(`WORLD ${worldModes[worldMode]}`, 1400);
}

// ================================================================
// 4. Procedural hypercar with layered PBR materials
// ================================================================

function loftGeometry(profiles) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const ringSize = 8;

  profiles.forEach(([z, w, bottom, top], row) => {
    const ring = [
      [-w * 0.88, bottom],
      [-w, bottom + 0.12],
      [-w * 0.94, top - 0.05],
      [-w * 0.58, top],
      [w * 0.58, top],
      [w * 0.94, top - 0.05],
      [w, bottom + 0.12],
      [w * 0.88, bottom]
    ];
    ring.forEach(([x, y], i) => {
      positions.push(x, y, z);
      uvs.push(i / ringSize, row / (profiles.length - 1));
    });
  });

  for (let row = 0; row < profiles.length - 1; row++) {
    for (let i = 0; i < ringSize; i++) {
      const a = row * ringSize + i;
      const b = row * ringSize + (i + 1) % ringSize;
      const c = a + ringSize;
      const d = b + ringSize;
      indices.push(a, b, c, b, d, c);
    }
  }

  // Caps: profile rings are clockwise when viewed from +Z.
  for (let i = 1; i < ringSize - 1; i++) {
    indices.push(0, i, i + 1);
    const end = (profiles.length - 1) * ringSize;
    indices.push(end, end + i + 1, end + i);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const bodyGeometry = loftGeometry([
  [-2.42, 0.74, 0.36, 0.73],
  [-2.10, 1.02, 0.32, 0.85],
  [-1.32, 1.04, 0.30, 0.94],
  [-0.45, 0.91, 0.32, 0.91],
  [0.65, 0.96, 0.30, 0.83],
  [1.55, 1.01, 0.27, 0.73],
  [2.38, 0.70, 0.33, 0.56]
]);

const canopyGeometry = loftGeometry([
  [-1.05, 0.58, 0.86, 0.98],
  [-0.55, 0.65, 0.86, 1.38],
  [0.30, 0.59, 0.84, 1.31],
  [1.04, 0.43, 0.78, 0.88]
]);

const tireGeometry = new THREE.CylinderGeometry(0.425, 0.425, 0.31, 24);
tireGeometry.rotateZ(Math.PI / 2);
const rimGeometry = new THREE.CylinderGeometry(0.29, 0.29, 0.325, 20);
rimGeometry.rotateZ(Math.PI / 2);
const discGeometry = new THREE.CylinderGeometry(0.235, 0.235, 0.338, 20);
discGeometry.rotateZ(Math.PI / 2);
const fenderGeometry = new THREE.TorusGeometry(0.455, 0.047, 6, 18, Math.PI);
fenderGeometry.rotateY(Math.PI / 2);
const contactGeometry = new THREE.PlaneGeometry(1, 1);
contactGeometry.rotateX(-Math.PI / 2);

function box(parent, material, x, y, z, sx, sy, sz, cast = true) {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addContact(parent, x, z, sx, sz) {
  const mesh = new THREE.Mesh(contactGeometry, materials.contact);
  mesh.position.set(x, 0.025, z);
  mesh.scale.set(sx, 1, sz);
  parent.add(mesh);
  return mesh;
}

const lightSpillTexture = canvasTexture(256, (ctx, size) => {
  const g = ctx.createRadialGradient(size / 2, size / 2, 1,
                                      size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.82)');
  g.addColorStop(0.17, 'rgba(255,255,255,0.64)');
  g.addColorStop(0.47, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-out';
  // Thin water-runoff bands break up the projected light uniformly.
  for (let i = 0; i < 42; i++) {
    const rand = randomGenerator(i * 3571 + 4002);
    ctx.fillStyle = 'rgba(0,0,0,.08)';
    ctx.fillRect(rand() * size, rand() * size, 1, rand() * 25);
  }
});
lightSpillTexture.wrapS = lightSpillTexture.wrapT = THREE.ClampToEdgeWrapping;

const lightHaloTexture = canvasTexture(128, (ctx, size) => {
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,.6)');
  g.addColorStop(0.5, 'rgba(255,255,255,.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
});
lightHaloTexture.wrapS = lightHaloTexture.wrapT = THREE.ClampToEdgeWrapping;

function makeLightSpill(parent, color, x, z, sx, sz, opacity) {
  const material = new THREE.MeshBasicMaterial({
    color, map: lightSpillTexture, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3,
    side: THREE.DoubleSide, toneMapped: false
  });
  const mesh = new THREE.Mesh(puddleGeometry, material);
  mesh.position.set(x, 0.038, z);
  mesh.scale.set(sx, 1, sz);
  mesh.renderOrder = 2;
  parent.add(mesh);
  return mesh;
}

function makeCar(color, detailed = false) {
  const root = new THREE.Group();
  const visual = new THREE.Group();
  root.add(visual);

  const paint = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.88,
    roughness: 0.19,
    clearcoat: 1,
    clearcoatRoughness: 0.085,
    iridescence: detailed ? 0.10 : 0,
    iridescenceIOR: 1.35,
    envMapIntensity: 1.65
  });

  const glass = detailed
    ? new THREE.MeshPhysicalMaterial({
        color: 0x142a3c,
        metalness: 0.04,
        roughness: 0.055,
        transmission: 0.32,
        thickness: 0.18,
        ior: 1.48,
        clearcoat: 1,
        envMapIntensity: 1.4
      })
    : new THREE.MeshStandardMaterial({
        color: 0x122332, metalness: 0.45, roughness: 0.10
      });

  const tail = new THREE.MeshStandardMaterial({
    color: 0xff173e,
    emissive: 0xff0732,
    emissiveIntensity: 3.2,
    roughness: 0.25
  });

  const headlight = new THREE.MeshStandardMaterial({
    color: 0xcbefff,
    emissive: 0x92d8ff,
    emissiveIntensity: 3.5
  });

  const rotor = new THREE.MeshStandardMaterial({
    color: 0x67676b, metalness: 0.8, roughness: 0.38,
    emissive: 0xff3308, emissiveIntensity: 0
  });

  const body = new THREE.Mesh(bodyGeometry, paint);
  body.castShadow = body.receiveShadow = true;
  visual.add(body);

  const canopy = new THREE.Mesh(canopyGeometry, glass);
  canopy.castShadow = true;
  visual.add(canopy);

  box(visual, materials.carbon, 0, 0.32, 1.96, 1.88, 0.07, 0.78);
  box(visual, materials.carbon, 0, 0.37, -2.15, 1.84, 0.13, 0.64);
  box(visual, materials.carbon, -0.94, 0.34, 0, 0.12, 0.13, 2.9);
  box(visual, materials.carbon, 0.94, 0.34, 0, 0.12, 0.13, 2.9);

  // Rear wing, pylons and angular light signature.
  box(visual, materials.carbon, 0, 1.10, -2.14, 2.16, 0.075, 0.39);
  box(visual, materials.carbon, -0.62, 0.90, -2.08, 0.055, 0.37, 0.12);
  box(visual, materials.carbon, 0.62, 0.90, -2.08, 0.055, 0.37, 0.12);
  box(visual, materials.carbon, -1.05, 1.14, -2.13, 0.055, 0.19, 0.43);
  box(visual, materials.carbon, 1.05, 1.14, -2.13, 0.055, 0.19, 0.43);

  for (const side of [-1, 1]) {
    const light = box(visual, tail, side * 0.57, 0.70, -2.405,
                      0.68, 0.045, 0.04, false);
    light.rotation.z = side * 0.14;
    box(visual, tail, side * 0.92, 0.79, -2.13, 0.045, 0.22, 0.06, false);
    box(visual, headlight, side * 0.65, 0.64, 1.95, 0.48, 0.035, 0.15, false);
    box(visual, paint, side * 1.08, 0.92, 0.48, 0.26, 0.10, 0.20);
    box(visual, materials.carbon, side * 0.95, 0.84, 0.46, 0.23, 0.035, 0.05);
    // Aero mirror, painted pod and dark specular mirror glass.
    box(visual, materials.carbon, side * 1.04, 0.86, 0.65, 0.20, 0.045, 0.09);
    box(visual, paint, side * 1.16, 0.895, 0.69, 0.22, 0.11, 0.19);
    box(visual, glass, side * 1.17, 0.91, 0.60, 0.14, 0.07, 0.013, false);
  }

  const wheels = [];
  for (const front of [false, true]) {
    for (const side of [-1, 1]) {
      const z = front ? 1.47 : -1.47;
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.045, 0.435, z);
      const spin = new THREE.Group();
      pivot.add(spin);
      visual.add(pivot);

      const tire = new THREE.Mesh(tireGeometry, materials.rubber);
      tire.castShadow = true;
      spin.add(tire);

      if (detailed) {
        spin.add(new THREE.Mesh(rimGeometry, materials.darkMetal));
        spin.add(new THREE.Mesh(discGeometry, rotor));

        const spokes = new THREE.InstancedMesh(unitBox, materials.rim, 5);
        for (let i = 0; i < 5; i++) {
          dummy.position.set(side * 0.178, 0, 0);
          dummy.rotation.set(i * Math.PI / 5, 0, 0);
          dummy.scale.set(0.027, 0.046, 0.54);
          dummy.updateMatrix();
          spokes.setMatrixAt(i, dummy.matrix);
        }
        spin.add(spokes);

        box(pivot, tail, side * 0.13, -0.035, -0.22, 0.075, 0.16, 0.10);
        const fender = new THREE.Mesh(fenderGeometry, paint);
        fender.position.copy(pivot.position);
        fender.castShadow = true;
        visual.add(fender);

        addContact(root, side * 1.045, z, 0.80, 1.05);
      } else {
        spin.add(new THREE.Mesh(rimGeometry, materials.rim));
      }

      wheels.push({ pivot, spin, front });
    }
  }

  if (detailed) {
    // Carbon engine deck and cooling slats.
    box(visual, materials.carbon, 0, 0.94, -1.28, 0.90, 0.035, 0.59);
    box(visual, materials.darkMetal, 0, 0.55, -2.425, 0.88, 0.26, 0.03);
    for (let i = -3; i <= 3; i++) {
      box(visual, materials.carbon, i * 0.17, 0.39, -2.46,
          0.055, 0.28, 0.33);
    }
    const license = new THREE.MeshStandardMaterial({
      color: 0x9da9aa, metalness: 0.08, roughness: 0.66
    });
    box(visual, license, 0, 0.625, -2.49, 0.58, 0.25, 0.012, false);
    for (const side of [-1, 1]) {
      const led = box(visual, tail, side * 0.78, 0.73, -2.444,
                      0.29, 0.025, 0.035, false);
      led.rotation.z = side * 0.25;
      box(visual, tail, side * 1.005, 0.76, -2.35,
          0.026, 0.17, 0.027, false);
    }

    const vents = new THREE.InstancedMesh(unitBox, materials.darkMetal, 8);
    for (let i = 0; i < 8; i++) {
      setInstance(vents, i, 0, 0.965, -1.59 + i * 0.077,
                  0, 0.68, 0.016, 0.031);
    }
    visual.add(vents);

    // A restrained painted stripe.
    const trim = new THREE.MeshStandardMaterial({
      color: 0x628da0, metalness: 0.8, roughness: 0.25
    });
    box(visual, trim, 0, 0.746, 1.45, 0.06, 0.013, 0.55, false);

    // Visible cockpit masses behind the dark refractive canopy.
    box(visual, materials.carbon, -0.27, 0.95, -0.05, 0.30, 0.28, 0.40);
    box(visual, materials.carbon, 0.27, 0.95, -0.05, 0.30, 0.28, 0.40);

    for (const side of [-1, 1]) {
      const exhaust = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.11, 0.22, 12),
        materials.darkMetal
      );
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(side * 0.23, 0.49, -2.43);
      visual.add(exhaust);
    }

    for (let i = -2; i <= 2; i++) {
      box(visual, materials.carbon, i * 0.29, 0.31, -2.35,
          0.035, 0.20, 0.42);
    }
  }

  addContact(root, 0, 0, 2.8, 5.5);
  // Approximate wet-ground light spill (not true screen-space reflection).
  // Geometry stays flush with the banked track and is visible from chase view.
  const rearSpill = [
    makeLightSpill(root, 0xff244c, -0.7, -3.82, 1.33, 5.8, 0.37),
    makeLightSpill(root, 0xff244c, 0.7, -3.82, 1.33, 5.8, 0.37)
  ];
  const frontSpill = [
    makeLightSpill(root, 0xa6d6ff, -0.67, 6.8, 2.0, 13.5, 0.12),
    makeLightSpill(root, 0xa6d6ff, 0.67, 6.8, 2.0, 13.5, 0.12)
  ];
  if (detailed) {
    for (const side of [-1, 1]) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0xff4660, map: lightHaloTexture, transparent: true,
        opacity: 0.56, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false
      }));
      halo.position.set(side * 0.67, 0.71, -2.49);
      halo.scale.set(0.62, 0.4, 1);
      root.add(halo);
    }
  }
  scene.add(root);
  return { root, visual, wheels, paint, tail, rotor, rearSpill,
           frontSpill, imported: null, importedWheels: [] };
}

const player = makeCar(0x1c303f, true);

// Real dynamic spotlight illumination, bounded to the hero vehicle.
// Shadow mapping is reserved for the directional light for performance.
const playerHeadlights = [];
for (const side of [-1, 1]) {
  const spot = new THREE.SpotLight(0xa8cfff, 33, 53, 0.37, 0.65, 1.25);
  spot.position.set(side * 0.66, 0.66, 1.91);
  spot.target.position.set(side * 0.75, -1.1, 27);
  spot.castShadow = false;
  player.root.add(spot, spot.target);
  playerHeadlights.push(spot);
}
const playerBrakeGlow = new THREE.PointLight(0xff2842, 0.48, 7, 2);
playerBrakeGlow.position.set(0, 0.66, -2.4);
player.root.add(playerBrakeGlow);

// Fake volumetric headlight cones: rim-faded additive shells that
// read as fog scattering, strongest inside rain and mist.
const beamGeometry = new THREE.CylinderGeometry(0.05, 3.2, 26, 18, 1, true);
beamGeometry.rotateX(-Math.PI / 2);
beamGeometry.translate(0, 0, 13);
const beamUniforms = { uBeamI: { value: 0 } };
const beamMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: beamUniforms,
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform float uBeamI;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      float rim = abs(dot(normalize(vNormal), normalize(vView)));
      float a = pow(vUv.y, 1.9) * pow(rim, 1.35) * uBeamI;
      gl_FragColor = vec4(0.62, 0.78, 0.95, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
});
const headlightBeams = [];
for (const side of [-1, 1]) {
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.position.set(side * 0.66, 0.55, 1.9);
  beam.rotation.x = 0.015;
  beam.renderOrder = 8;
  beam.frustumCulled = false;
  player.root.add(beam);
  headlightBeams.push(beam);
}


// Cockpit interior is built by entities/cockpit.js — the group
// uses DB4 axes (+X nose) and is already rotated into car space.
const { group: cockpit, cameraMount, steeringColumn,
        dials: cockpitDials } = createCockpit();
player.root.add(cockpit);

const rivals = [
  { car: makeCar(0x526477), s: 49, x: -3.0, speed: 0, cruise: 42, wheel: 0 },
  { car: makeCar(0x77414b), s: 66, x: 3.0, speed: 0, cruise: 46, wheel: 0 },
  { car: makeCar(0x596f62), s: 84, x: -2.5, speed: 0, cruise: 49, wheel: 0 }
];

// Ambient traffic: randomized cars circulating the road — slow
// same-way cruisers keeping right, plus oncoming vehicles (dir -1)
// in the opposing lane. Cars that fall behind or pass beyond the
// live window are recycled into the distance ahead.
const traffic = [];
{
  const trafficRand = randomGenerator(90210);
  const paints = [0x8a9099, 0x555c66, 0x74513a,
                  0x3c4652, 0x66505f, 0x5f6b5a];
  for (let i = 0; i < 14; i++) {
    const dir = i % 3 === 2 ? -1 : 1;
    // dir * driveSide: same-way cars keep to the regulated side,
    // oncoming cars take the opposite lane (their own side).
    const lane = dir * CFG.driveSide * (2.4 + trafficRand() * 1.4);
    traffic.push({
      car: makeCar(paints[i % paints.length]),
      s: dir > 0 ? 140 + trafficRand() * 1200
                 : 380 + trafficRand() * 1100,
      x: lane, lane, dir, speed: 0,
      cruise: dir > 0 ? 16 + trafficRand() * 11
                      : 24 + trafficRand() * 9,
      wheel: 0
    });
  }
}
// Lidar, autopilot and collision treat every other car uniformly.
const roadCars = rivals.concat(traffic);

// ================================================================
// 5. Rain and tire spray: fixed-size GPU particle systems
// ================================================================

const rainCount = MOBILE ? 700 : 1450;
const rainPositions = new Float32Array(rainCount * 2 * 3);
const rainEnds = new Float32Array(rainCount * 2);
const rainRandom = randomGenerator(31337);

for (let i = 0; i < rainCount; i++) {
  const x = (rainRandom() - 0.5) * 85;
  const y = rainRandom() * 42;
  const z = (rainRandom() - 0.5) * 85;
  for (let end = 0; end < 2; end++) {
    const offset = (i * 2 + end) * 3;
    rainPositions.set([x, y, z], offset);
    rainEnds[i * 2 + end] = end;
  }
}

const rainGeometry = new THREE.BufferGeometry();
rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
rainGeometry.setAttribute('aEnd', new THREE.BufferAttribute(rainEnds, 1));

const rainMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uBeamPos: { value: new THREE.Vector3() },
    uBeamDir: { value: new THREE.Vector3(0, 0, 1) },
    uBeamI: { value: 0 }
  },
  vertexShader: `
    uniform float uTime;
    uniform vec3 uBeamPos;
    uniform vec3 uBeamDir;
    uniform float uBeamI;
    attribute float aEnd;
    varying float vFade;
    void main() {
      vec3 p = position;
      p.y = mod(p.y - uTime * 26.0, 42.0) - 8.0;
      p.x += aEnd * 0.14;
      p.y -= aEnd * 0.85;
      p.z += aEnd * 0.08;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vFade = 1.0 - smoothstep(15.0, 60.0, -mv.z);
      // Rain brightens inside the headlight cones.
      vec3 rel = (modelMatrix * vec4(p, 1.0)).xyz - uBeamPos;
      float axial = dot(rel, uBeamDir);
      float beam = step(1.5, axial) * smoothstep(30.0, 14.0, axial)
                 * smoothstep(4.6, 1.0, length(rel - uBeamDir * axial));
      vFade *= 1.0 + beam * uBeamI;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform float uIntensity;
    varying float vFade;
    void main() {
      gl_FragColor = vec4(0.61, 0.78, 0.95, vFade * 0.31 * uIntensity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
});

const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
rain.frustumCulled = false;
scene.add(rain);

const sprayCount = MOBILE ? 90 : 180;
const sprayPositions = new Float32Array(sprayCount * 3);
for (let i = 0; i < sprayCount; i++) {
  sprayPositions.set([rainRandom(), rainRandom(), i & 1 ? 1 : -1], i * 3);
}

const sprayGeometry = new THREE.BufferGeometry();
sprayGeometry.setAttribute('position', new THREE.BufferAttribute(sprayPositions, 3));

const sprayMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uDPR: { value: dpr },
    uIntensity: { value: 1 }
  },
  vertexShader: `
    uniform float uTime;
    uniform float uSpeed;
    uniform float uDPR;
    uniform float uIntensity;
    varying float vAlpha;
    void main() {
      float life = fract(position.x + uTime * (0.75 + position.y * 0.8));
      vec3 p;
      p.x = position.z * (1.04 + life * 0.65)
          + sin(position.y * 95.0) * life * 0.32;
      p.y = 0.15 + sin(life * 2.4) * (0.25 + position.y * 0.65);
      p.z = -1.55 - life * (2.0 + uSpeed * 0.11);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(
        (13.0 + life * 20.0) * uDPR / max(1.0, -mv.z), 1.0, 12.0
      );
      vAlpha = (1.0 - life) * min(uSpeed / 30.0, 0.48) * uIntensity;
    }
  `,
  fragmentShader: `
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      gl_FragColor = vec4(0.60, 0.75, 0.83, (1.0 - d) * vAlpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
});

const spray = new THREE.Points(sprayGeometry, sprayMaterial);
spray.frustumCulled = false;
player.root.add(spray);

// Mirrored-camera planar reflection laid over the road ahead. The
// alpha mask confines it to irregular wet accumulation, so the road
// reads as patchy standing water rather than a perfect mirror.
const mirrorShader = {
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tMask: { value: null },
    uStrength: { value: 0.4 },
    uTime: { value: 0 },
    uWet: { value: 0 }
  },
  vertexShader: `
    uniform mat4 textureMatrix;
    varying vec4 vUvProj;
    varying vec2 vMapUv;
    void main() {
      vMapUv = uv;
      vUvProj = textureMatrix * vec4(position, 1.0);
      gl_Position =
        projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform sampler2D tMask;
    uniform float uStrength;
    uniform float uTime;
    uniform float uWet;
    varying vec4 vUvProj;
    varying vec2 vMapUv;
    float hash21(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
                 mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)),
                     f.x), f.y);
    }
    void main() {
      float mask = texture2D(tMask, vMapUv * vec2(2.0, 16.0)).r;
      vec4 uvp = vUvProj;
      // Rain relief wobbles the mirrored image; standing pools stay
      // calm, matching the WebGPU retroreflection sample's bump trick.
      vec2 wob = (vec2(vnoise(vMapUv * vec2(60.0, 420.0) + uTime * 0.8),
                       vnoise(vMapUv * vec2(50.0, 380.0) - uTime * 0.6))
                  - 0.5) * 0.05 * mix(1.0, 0.35, mask) * uWet;
      uvp.xy += wob * uvp.w;
      vec3 refl = texture2DProj(tDiffuse, uvp).rgb;
      // Streaky anisotropic blur on damp asphalt, sharpest in puddles.
      float streak = mix(0.004, 0.0004, mask) * uWet;
      refl += texture2DProj(tDiffuse, uvp + vec4(streak, 0, 0, 0)).rgb;
      refl += texture2DProj(tDiffuse, uvp - vec4(streak, 0, 0, 0)).rgb;
      refl += texture2DProj(tDiffuse,
                            uvp + vec4(0, streak * 2.4, 0, 0)).rgb;
      refl += texture2DProj(tDiffuse,
                            uvp - vec4(0, streak * 2.4, 0, 0)).rgb;
      refl *= 0.2;
      // Whole surface goes faintly damp-reflective; pools mirror hard.
      float alpha = smoothstep(0.16, 0.9, mask);
      alpha = mix(0.30, 1.0, alpha) * uStrength * (0.45 + 0.55 * uWet);
      gl_FragColor = vec4(refl * color, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
};
const mirrorGeometry = new THREE.PlaneGeometry(15.6, 96);
mirrorGeometry.rotateX(-Math.PI / 2);
mirrorGeometry.rotateY(Math.PI);
const roadMirror = new Reflector(mirrorGeometry, {
  clipBias: 0.0035,
  textureWidth: Math.min(1024, Math.floor(width * 0.5)),
  textureHeight: Math.min(1024, Math.floor(height * 0.5)),
  color: 0x9db4c9,
  shader: mirrorShader,
  multisample: 2
});
roadMirror.rotation.order = 'YXZ';
roadMirror.renderOrder = 4;
roadMirror.material.uniforms.tMask.value = mirrorMask;
roadMirror.material.transparent = true;
roadMirror.material.depthWrite = false;
scene.add(roadMirror);

// Retroreflective response for lane paint and rail reflectors —
// WebGL port of the retroreflection sample: a surface flares only
// when the eye direction aligns with the headlight direction, so
// dashes and catseyes glow inside the beam and nowhere else.
const retroUniforms = {
  uHeadPos: { value: new THREE.Vector3() },
  uRetroGain: { value: 0 }
};
const headlightWorld = new THREE.Vector3();
function addRetroResponse(material) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, retroUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 rwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            rwp = instanceMatrix * rwp;
          #endif
          vWorldPos = (modelMatrix * rwp).xyz; }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPos;
        uniform vec3 uHeadPos;
        uniform float uRetroGain;`)
      .replace('#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        { vec3 toEye = cameraPosition - vWorldPos;
          vec3 toLamp = uHeadPos - vWorldPos;
          float dist = length(toLamp);
          float retro =
            pow(max(dot(normalize(toEye), normalize(toLamp)), 0.0),
                22.0);
          float falloff = 1.0 / (1.0 + dist * dist * 0.006);
          totalEmissiveRadiance += diffuseColor.rgb *
            uRetroGain * retro * falloff * vec3(0.85, 0.92, 1.05); }`);
    material.userData.shader = shader;
  };
}
addRetroResponse(materials.marking);
addRetroResponse(materials.reflector);

// Position-dependent diffuse GI along the route — WebGL equivalent
// of the light-probe-volume sample. A cube capture at the car is
// folded into a spherical-harmonic probe every ~250 m so ambient
// light darkens under forest canopy and opens on ridges.
const probeRT = new THREE.WebGLCubeRenderTarget(48, {
  generateMipmaps: false });
const probeCamera = new THREE.CubeCamera(0.5, 600, probeRT);
scene.add(probeCamera);
const ambientProbe = new THREE.LightProbe();
ambientProbe.intensity = 0.4;
scene.add(ambientProbe);
let lastProbeS = -1e9;
let probeBaking = false;
async function bakeProbe() {
  if (probeBaking) return;
  probeBaking = true;
  try {
    probeCamera.position.copy(player.root.position);
    probeCamera.position.y += 3;
    const hidden = [roadMirror, ...headlightBeams, cockpit];
    const wasVisible = hidden.map(o => o.visible);
    for (const o of hidden) o.visible = false;
    probeCamera.update(renderer, scene);
    for (let i = 0; i < hidden.length; i++)
      hidden[i].visible = wasVisible[i];
    const probe =
      await LightProbeGenerator.fromCubeRenderTarget(renderer, probeRT);
    ambientProbe.sh.copy(probe.sh);
  } catch (error) {
    console.warn('probe bake skipped', error);
  } finally {
    probeBaking = false;
  }
}

// Low-lying mist sheets drifting across the road and verges.
const mistLayers = [];
for (let i = 0; i < 2; i++) {
  const layerTexture = i ? mistTexture.clone() : mistTexture;
  layerTexture.needsUpdate = true;
  const layer = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 320),
    new THREE.MeshBasicMaterial({
      map: layerTexture, color: 0x9db4c6, transparent: true,
      opacity: 0, depthWrite: false
    })
  );
  layer.rotation.x = -Math.PI / 2;
  layer.renderOrder = 7;
  layer.frustumCulled = false;
  scene.add(layer);
  mistLayers.push(layer);
}

// Screen-space reflections: ray-marches scene depth so wet asphalt
// mirrors the actual trees, rails and taillights. Selective: only
// the road meshes reflect (a null selection would turn every pixel
// into a mirror). F cycles SSR -> planar -> off.
let ssrPass = null;
try {
  ssrPass = new SSRPass({
    renderer, scene, camera, width, height,
    selects: chunks.map(chunk => chunk.road)
  });
  ssrPass.maxDistance = 60;
  ssrPass.thickness = 0.018;
  ssrPass.opacity = 0.3;
  ssrPass.fresnel = true;
  ssrPass.distanceAttenuation = true;
  ssrPass.blur = true;
  ssrPass.enabled = false;
  composer.insertPass(ssrPass, 1);
} catch (error) {
  ssrPass = null;
}

const reflectionModes = ssrPass ? ['SSR', 'PLANAR', 'OFF'] : ['PLANAR', 'OFF'];
let reflectionMode = reflectionModes[0];

// ================================================================
// 6. Inputs and fixed-step arcade vehicle dynamics
//
// Frenet coordinates: s is route distance, x is lateral offset.
// A bicycle yaw model plus damped lateral tire velocity provides
// inertia, understeer and controllable handbrake oversteer.
// ================================================================

const START_S = 32;
const state = {
  s: START_S,
  x: 0,
  speed: 0,
  sideSpeed: 0,
  yaw: 0,
  yawRate: 0,
  steer: 0,
  wheel: 0,
  acceleration: 0,
  brake: 0,
  handbrake: false,
  elapsed: 0,
  topSpeed: 0,
  hit: 0,
  collisionCooldown: 0,
  hydroCooldown: 0
};

const weatherNames = WEATHER.names;
const weatherLevels = WEATHER.levels;
let weatherIndex = 0;
let weatherIntensity = weatherLevels[0];
let qualityMode = 0;  // 0 adaptive, 1 maximum cinema, 2 fast
let diagnosticsOn = false;

function setWeather(index) {
  weatherIndex = (index + weatherNames.length) % weatherNames.length;
  weatherIntensity = weatherLevels[weatherIndex];
  $('weather-button').textContent = `RAIN: ${weatherNames[weatherIndex]}`;
  materials.puddle.opacity = weatherIntensity * 0.30;
  materials.road.roughness = 0.61 + (1 - weatherIntensity) * 0.31;
  materials.road.clearcoatRoughness = 0.085 + (1 - weatherIntensity) * 0.29;
  scene.fog.density = 0.00145 + weatherIntensity * 0.00055;
  $('lens-rain').style.opacity = String(weatherIntensity * 0.80);
  materials.road.needsUpdate = true;
}
function cycleWeather() {
  setWeather(weatherIndex + 1);
  toast(`WEATHER · ${weatherNames[weatherIndex]}`, 1300);
}
$('weather-button').onclick = cycleWeather;

let started = false;
let paused = false;
let orbitMode = false;
let cockpitMode = false;
let viewMode = 'CHASE';   // CHASE -> COCKPIT -> ORBIT
let pausedBeforeOrbit = false;
let accumulator = 0;
const keys = new Set();
const touchKeys = new Set();

const pressed = (...codes) =>
  codes.some(code => keys.has(code) || touchKeys.has(code));

let toastTimeout;
function toast(message, duration = 2200) {
  $('toast').textContent = message;
  $('toast').style.opacity = '1';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').style.opacity = '0', duration);
}

function clearInputs() {
  keys.clear();
  touchKeys.clear();
  document.querySelectorAll('#touch button').forEach(
    button => button.classList.remove('pressed')
  );
}

function updatePauseUI() {
  $('pause-label').textContent = orbitMode ? 'ORBIT INSPECTION' : 'PAUSED';
  $('camera-button').textContent =
    cockpitMode ? 'CAM COCKPIT' : orbitMode ? 'CAM ORBIT' : 'CAM C';
  $('pause-label').style.display = started && paused ? 'block' : 'none';
  $('pause-button').textContent = paused ? 'RESUME P' : 'PAUSE P';
}

function togglePause() {
  if (!started || orbitMode) return;
  paused = !paused;
  accumulator = 0;
  clearInputs();
  updatePauseUI();
}

const cameraAim = new THREE.Vector3();
const VIEWS = ['CHASE', 'COCKPIT', 'ORBIT'];
function toggleCamera() {
  if (!started) return;
  const entering = orbitMode;
  viewMode = VIEWS[(VIEWS.indexOf(viewMode) + 1) % VIEWS.length];
  orbitMode = viewMode === 'ORBIT';
  cockpitMode = viewMode === 'COCKPIT';
  controls.enabled = orbitMode;
  cockpit.visible = cockpitMode;
  player.visual.visible = !cockpitMode;
  if (player.imported) player.imported.visible = !cockpitMode;
  if (orbitMode && !entering) {
    pausedBeforeOrbit = paused;
    paused = true;
    controls.target.copy(player.root.position).add(new THREE.Vector3(0, 0.8, 0));
  } else if (!orbitMode) {
    paused = pausedBeforeOrbit;
    cameraAim.copy(controls.target);
  }
  if (!cockpitMode && camera.fov !== 65) {
    camera.fov = 65;
    camera.updateProjectionMatrix();
  }
  toast(viewMode === 'COCKPIT' ? 'COCKPIT VIEW' :
        viewMode === 'ORBIT' ? 'ORBIT INSPECTION' : 'CHASE VIEW', 1400);
  accumulator = 0;
  clearInputs();
  updatePauseUI();
}

function toggleDiagnostics() {
  diagnosticsOn = !diagnosticsOn;
  $('water-debug').classList.toggle('on', diagnosticsOn);
  toast(diagnosticsOn ? 'WATER TELEMETRY ON' : 'TELEMETRY OFF', 1100);
}

let profilerOn = false;
function toggleProfiler() {
  profilerOn = !profilerOn;
  $('stream-panel').classList.toggle('on', profilerOn);
  toast(profilerOn ? 'STREAM PROFILER ON' : 'PROFILER OFF', 1100);
}

function toggleReflections() {
  const i = reflectionModes.indexOf(reflectionMode);
  reflectionMode = reflectionModes[(i + 1) % reflectionModes.length];
  toast(`REFLECTIONS: ${reflectionMode}`, 1300);
}

let lightIndex = 1;
let beamsOn = true;
const lightColor = new THREE.Color();

function updateLighting(dt) {
  const t = LIGHT_PRESETS[lightIndex];
  const k = 1 - Math.exp(-2.4 * dt);
  scene.background.lerp(lightColor.setHex(t.bg), k);
  scene.fog.color.lerp(lightColor.setHex(t.fog), k);
  scene.fog.density += (t.fogD - scene.fog.density) * k;
  // The physical sky responds to the sun's position: lerp the
  // preset's elevation/azimuth so the disc sweeps smoothly, then
  // atmosphere density follows the same preset.
  skyElev += (t.elev - skyElev) * k;
  skyAzim += (t.azim - skyAzim) * k;
  skySunPos.setFromSphericalCoords(
    1, Math.PI / 2 - skyElev * Math.PI / 180,
    skyAzim * Math.PI / 180);
  skyU.sunPosition.value.copy(skySunPos);
  skyU.turbidity.value += (t.turb - skyU.turbidity.value) * k;
  skyU.rayleigh.value += (t.ray - skyU.rayleigh.value) * k;
  skyU.mieCoefficient.value +=
    (t.mie - skyU.mieCoefficient.value) * k;
  skyU.mieDirectionalG.value +=
    (t.mieG - skyU.mieDirectionalG.value) * k;
  starMaterial.opacity += (t.stars - starMaterial.opacity) * k;
  sun.color.lerp(lightColor.setHex(t.sun), k);
  sun.intensity += (t.sunI - sun.intensity) * k;
  hemi.color.lerp(lightColor.setHex(t.hemiSky), k);
  hemi.groundColor.lerp(lightColor.setHex(t.hemiGnd), k);
  hemi.intensity += (t.hemiI - hemi.intensity) * k;
  scene.environmentIntensity +=
    (t.envI - scene.environmentIntensity) * k;
  renderer.toneMappingExposure +=
    (t.exposure - renderer.toneMappingExposure) * k;
  bloom.strength += (t.bloom - bloom.strength) * k;
  for (const spot of playerHeadlights)
    spot.intensity += (33 * t.headI - spot.intensity) * k;
}

function cycleLighting() {
  lightIndex = (lightIndex + 1) % LIGHT_PRESETS.length;
  $('light-button').textContent = 'LIGHT: ' + LIGHT_PRESETS[lightIndex].name;
  toast(`LIGHTING · ${LIGHT_PRESETS[lightIndex].name}`, 1400);
}

function toggleBeams() {
  beamsOn = !beamsOn;
  toast(beamsOn ? 'HEADLIGHT BEAMS ON' : 'BEAMS OFF', 1100);
}

function recover() {
  if (!started) return;
  state.x = 0;
  state.speed = Math.min(state.speed, 8);
  state.sideSpeed = 0;
  state.yaw = 0;
  state.yawRate = 0;
  state.steer = 0;
  state.hit = 0;
  toast('BACK ON THE RACING LINE');
}

const drivingKeys = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'
]);

addEventListener('keydown', event => {
  if (drivingKeys.has(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'KeyP') togglePause();
  if (event.code === 'KeyC') toggleCamera();
  if (event.code === 'KeyF') toggleReflections();
  if (event.code === 'KeyH') toggleDiagnostics();
  if (event.code === 'KeyM') toggleProfiler();
  if (event.code === 'KeyT') cycleLighting();
  if (event.code === 'KeyG') toggleBeams();
  if (event.code === 'KeyB') toggleAutopilot();
  if (event.code === 'KeyN') cycleEnvMode();
  if (event.code === 'KeyJ') cycleWorldMode();
  if (event.code === 'KeyR') recover();
  if (event.code === 'KeyV') cycleWeather();
  if (event.code === 'Enter' && !started) $('start').click();
});

addEventListener('keyup', event => keys.delete(event.code));

for (const button of document.querySelectorAll('#touch button')) {
  const release = () => {
    touchKeys.delete(button.dataset.key);
    button.classList.remove('pressed');
  };
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touchKeys.add(button.dataset.key);
    button.classList.add('pressed');
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

function suspend() {
  clearInputs();
  accumulator = 0;
  if (started && !paused) {
    paused = true;
    updatePauseUI();
  }
}
addEventListener('blur', suspend);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspend();
});

$('pause-button').onclick = togglePause;
$('camera-button').onclick = toggleCamera;
$('light-button').onclick = cycleLighting;
$('beam-button').onclick = toggleBeams;
$('auto-button').onclick = toggleAutopilot;

$('start').onclick = () => {
  if (started) return;
  started = true;
  paused = false;
  clearInputs();
  $('start-screen').classList.add('hidden');
  updatePauseUI();
  toast('ENDLESS RIDGE · THE ROAD NEVER ENDS', 3200);
};

function setQuality(mode) {
  qualityMode = mode % 3;
  if (qualityMode === 0) {
    adaptiveQuality = true;
    effectsEnabled = !MOBILE;
    dpr = Math.min(dpr, maxDPR);
    $('quality').textContent = 'FX AUTO';
  } else if (qualityMode === 1) {
    adaptiveQuality = false;
    effectsEnabled = true;
    dpr = maxDPR;
    $('quality').textContent = 'FX CINEMA';
  } else {
    adaptiveQuality = false;
    effectsEnabled = false;
    dpr = Math.min(maxDPR, 1.0);
    $('quality').textContent = 'FX FAST';
  }
  resize();
}
$('quality').onclick = () => {
  setQuality(qualityMode + 1);
  toast(['ADAPTIVE RENDERING', 'CINEMATIC POST FX',
         'PERFORMANCE RENDERING'][qualityMode], 1400);
};

// Environment density: AUTO follows frame time, HIGH forces full
// undergrowth, ECO trims ferns/grass/rocks to half density.
const envModes = ['AUTO', 'HIGH', 'ECO'];
let envMode = 0;
function setEnvDensity(v) {
  if (v === envDensity) return;
  envDensity = v;
  rebuildActiveChunks();
}
function cycleEnvMode() {
  envMode = (envMode + 1) % envModes.length;
  setEnvDensity(envMode === 2 ? 0.55 : 1);
  toast(`ENVIRONMENT ${envModes[envMode]}`, 1400);
}

// ================================================================
// 6b. Autopilot: 6-ray lidar swept in road space plus a lane
// controller that steers toward a clear path and manages speed
// from corner curvature and obstacle range.
// ================================================================

const LIDAR_ANGLES = [-78, -42, -14, 14, 42, 78];
const LIDAR_RANGE = 60;
const lidarRanges = new Float32Array(LIDAR_ANGLES.length)
  .fill(LIDAR_RANGE);
let autopilotOn = false;

const lidarPositions =
  new Float32Array(LIDAR_ANGLES.length * 2 * 3);
const lidarGeometry = new THREE.BufferGeometry();
lidarGeometry.setAttribute(
  'position', new THREE.BufferAttribute(lidarPositions, 3)
);
const lidarRays = new THREE.LineSegments(
  lidarGeometry,
  new THREE.LineBasicMaterial({
    color: 0x7df3ff, transparent: true, opacity: 0.5,
    depthWrite: false
  })
);
lidarRays.frustumCulled = false;
lidarRays.visible = false;
lidarRays.renderOrder = 9;
player.root.add(lidarRays);

// Which rays ended on a car (vs. a barrier): only cars should push
// the lane target sideways, the walls are handled by lane limits.
const lidarHitCar = new Uint8Array(LIDAR_ANGLES.length);
function sweepLidar() {
  for (let i = 0; i < LIDAR_ANGLES.length; i++) {
    const a = state.yaw + LIDAR_ANGLES[i] * Math.PI / 180;
    const ds = Math.cos(a);
    const dx = Math.sin(a);
    let range = LIDAR_RANGE;
    let car = 0;
    for (let t = 0.5; t < LIDAR_RANGE && range === LIDAR_RANGE; t += 0.5) {
      const lx = state.x + dx * t;
      if (Math.abs(lx) > CFG.barrierLimit) { range = t; break; }
      const ls = state.s + ds * t;
      for (const rival of roadCars) {
        if (Math.abs(rival.s - ls) < 2.3 &&
            Math.abs(rival.x - lx) < 1.0) {
          range = t;
          car = 1;
          break;
        }
      }
    }
    lidarRanges[i] = range;
    lidarHitCar[i] = car;
  }
  // Ray fan drawn in car space: local +z forward, +x is the left lane.
  for (let i = 0; i < LIDAR_ANGLES.length; i++) {
    const a = LIDAR_ANGLES[i] * Math.PI / 180;
    const r = lidarRanges[i];
    lidarPositions[i * 6] = 0;
    lidarPositions[i * 6 + 1] = 0.75;
    lidarPositions[i * 6 + 2] = 0;
    lidarPositions[i * 6 + 3] = Math.sin(a) * r;
    lidarPositions[i * 6 + 4] = 0.75;
    lidarPositions[i * 6 + 5] = Math.cos(a) * r;
  }
  lidarGeometry.attributes.position.needsUpdate = true;
}

const autoInput = { throttle: 0, brake: 0, steer: 0 };
function autopilotInput() {
  const v = Math.max(state.speed, 3);

  // Lane target: cruise on the regulated side (CFG.driveSide), or
  // swing to the opposite lane to pass the nearest car ahead.
  const laneX = CFG.driveSide * 3.0;
  let xTarget = laneX;
  let nearest = Infinity;
  for (const rival of roadCars) {
    const gap = rival.s - state.s;
    if (gap > -6 && gap < 30 + v * 0.6 && gap < nearest &&
        Math.abs(rival.x - state.x) < 2.6) {
      nearest = gap;
      xTarget = -laneX;                  // overtake via opposite lane
    }
  }
  // Cars detected alongside by the outer rays nudge the line away.
  if (lidarHitCar[0] && lidarRanges[0] < 6) xTarget += 1.4;
  if (lidarHitCar[5] && lidarRanges[5] < 6) xTarget -= 1.4;
  xTarget = clamp(xTarget, -5.3, 5.3);

  // Cascaded steering: lateral error -> lateral velocity -> heading
  // -> yaw rate, inverted through the bicycle model stepVehicle()
  // uses. Commanding lateral *velocity* (not heading) keeps the loop
  // gain independent of speed; tire slip (sideSpeed) is compensated.
  // Gains tuned on an offline replica of stepVehicle(): 0 barrier
  // hits over 13.5 km vs. a weaving ±3.6 m with a heading-only law.
  const vLat = clamp(0.5 * (xTarget - state.x), -4, 4);
  const desiredYaw = Math.asin(
    clamp((vLat - state.sideSpeed) / v, -0.35, 0.35));
  const kappa = curvatureAt(state.s + v * 0.3);
  const wantYawRate = kappa * v + 3 * (desiredYaw - state.yaw);
  const steerAngle = Math.atan(wantYawRate * 2.94 / v);
  const maxSteer = 0.44 / (1 + state.speed * 0.105);
  autoInput.steer = clamp(steerAngle / maxSteer, -1, 1);

  // Speed: corner limit from curvature ahead, then traffic following.
  let kMax = 0;
  for (let d = 10; d <= 10 + v * 2.2; d += 12) {
    kMax = Math.max(kMax, Math.abs(curvatureAt(state.s + d)));
  }
  const gripScale = 1 - 0.35 * clamp(waterAtCar / 0.14, 0, 1);
  let vTarget = Math.min(68, Math.sqrt(7.5 * gripScale /
    Math.max(kMax, 0.0005)));
  const frontRange = Math.min(lidarRanges[2], lidarRanges[3]);
  const followDist = 8 + v * 0.5;
  if (frontRange < followDist && (lidarHitCar[2] || lidarHitCar[3])) {
    for (const rival of roadCars) {
      const gap = rival.s - state.s;
      // Only pace same-direction traffic — an oncoming car's
      // magnitude is not a speed to match, just brake room.
      if ((rival.dir ?? 1) > 0 && gap > 0 && gap < followDist &&
          Math.abs(rival.x - state.x) < 2.2) {
        vTarget = Math.min(vTarget, Math.max(6, rival.speed - 1.5));
      }
    }
  }

  autoInput.throttle = state.speed < vTarget - 0.6 ? 1 : 0;
  autoInput.brake = state.speed > vTarget + 2.5 ? 1 : 0;
  return autoInput;
}

function toggleAutopilot() {
  autopilotOn = !autopilotOn;
  lidarRays.visible = autopilotOn;
  $('auto-button').textContent = autopilotOn ? 'AUTO ON' : 'AUTO B';
  toast(autopilotOn ? 'AUTOPILOT ENGAGED' : 'MANUAL CONTROL', 1400);
}

function stepVehicle(dt) {
  let throttle, brake, direction, handbrake;
  if (autopilotOn) {
    const auto = autopilotInput();
    throttle = auto.throttle;
    brake = auto.brake;
    direction = auto.steer;
    handbrake = false;
  } else {
    throttle = pressed('KeyW', 'ArrowUp') ? 1 : 0;
    brake = pressed('KeyS', 'ArrowDown') ? 1 : 0;
    direction =
      (pressed('KeyA', 'ArrowLeft') ? 1 : 0) -
      (pressed('KeyD', 'ArrowRight') ? 1 : 0);
    handbrake = pressed('Space') && state.speed > 4;
  }
  const previousSpeed = state.speed;
  const oldS = state.s;
  const curvature = curvatureAt(state.s);

  state.brake = brake;
  state.handbrake = handbrake;
  state.hit = Math.max(0, state.hit - dt * 2);
  state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);
  state.hydroCooldown = Math.max(0, state.hydroCooldown - dt);

  if (waterAtCar > 0.14 && state.speed > 34 && state.hydroCooldown <= 0) {
    toast('STANDING WATER · GRIP LOW', 1200);
    state.hydroCooldown = 3;
  }

  const engine = throttle * (12.5 - 6.3 * state.speed / CFG.maxSpeed);
  const drag = 0.55 + 0.00065 * state.speed * state.speed;
  const shoulderDrag = Math.abs(state.x) > 6.05 ? 3.7 : 0;
  const acceleration = engine - drag - brake * 26
    - (handbrake ? 7.2 : 0) - shoulderDrag - gradeAt(state.s) * 9.81;

  state.speed = clamp(state.speed + acceleration * dt, 0, CFG.maxSpeed);

  const maxSteer = 0.44 / (1 + state.speed * 0.105);
  state.steer = damp(state.steer, direction * maxSteer, 8, dt);

  const rawYawRate = state.speed / 2.94 * Math.tan(state.steer);
  const yawLimit = Math.min(1.5, (handbrake ? 39 : 28) / Math.max(state.speed, 9));
  let targetYaw = Math.tanh(rawYawRate / Math.max(0.01, yawLimit)) * yawLimit;

  // Mild high-speed stabilization, not automatic route following.
  if (direction === 0) targetYaw -= state.yaw * 0.42;
  if (handbrake) targetYaw *= 1.20;

  state.yawRate = damp(state.yawRate, targetYaw, handbrake ? 4.2 : 8.5, dt);

  // Inertial lateral motion in the rotating vehicle frame.
  state.sideSpeed -= state.yawRate * state.speed * dt;
  const tireStiffness = handbrake ? 1.75 : 12;
  // Standing water cuts mechanical grip — aquaplaning on fast straights.
  const lateralGrip = (handbrake ? 8 : 34) *
    (1 - Math.min(0.45, waterAtCar * 2.8));
  const tireForce = clamp(
    -state.sideSpeed * tireStiffness, -lateralGrip, lateralGrip
  );
  state.sideSpeed += tireForce * dt;
  state.speed = Math.max(0, state.speed + state.sideSpeed * state.yawRate * dt);
  state.sideSpeed *= Math.exp(-0.08 * dt);

  if (state.speed < 0.5) {
    state.sideSpeed = damp(state.sideSpeed, 0, 12, dt);
    state.yawRate = damp(state.yawRate, 0, 12, dt);
  }

  const c = Math.cos(state.yaw);
  const n = Math.sin(state.yaw);
  const along = state.speed * c - state.sideSpeed * n;
  const lateral = state.speed * n + state.sideSpeed * c;

  const routeSpeed = Math.max(0, along) / Math.max(0.7, 1 - curvature * state.x);
  state.s += routeSpeed * dt;
  state.x += lateral * dt;
  state.yaw += state.yawRate * dt - (headingAt(state.s) - headingAt(oldS));
  state.yaw = clamp(state.yaw, -1.22, 1.22);

  // Barrier collision in route coordinates.
  if (Math.abs(state.x) > CFG.barrierLimit) {
    const side = Math.sign(state.x);
    state.x = side * CFG.barrierLimit;
    state.sideSpeed = -side * Math.min(Math.abs(lateral) * 0.30, 4);
    state.yaw = -side * 0.045;
    state.yawRate *= -0.25;

    if (state.collisionCooldown === 0) {
      state.speed *= 0.58;
      state.hit = 1;
      state.collisionCooldown = 0.7;
      toast('BARRIER CONTACT · R TO RECOVER', 1500);
    }
  }

  // Opponents have real independent progress, not a decorative position HUD.
  for (let i = 0; i < rivals.length; i++) {
    const rival = rivals[i];
    const bend = Math.abs(curvatureAt(rival.s + 45 + rival.speed));
    const targetSpeed = rival.cruise * (1 - Math.min(0.58, bend * 24));
    rival.speed = damp(rival.speed, targetSpeed, 0.48, dt);
    rival.s += rival.speed * dt;
    const targetLane = (i & 1 ? 2.8 : -2.8) + Math.sin(rival.s * 0.004 + i) * 0.5;
    rival.x = damp(rival.x, targetLane, 0.8, dt);
    rival.wheel += rival.speed * dt / 0.425;

    if (Math.abs(rival.s - state.s) < 4.5 &&
        Math.abs(rival.x - state.x) < 2.0) {
      const push = Math.sign(state.x - rival.x) || 1;
      state.x += push * dt * 3.8;

      if (state.s < rival.s && state.speed > rival.speed) {
        state.speed = damp(state.speed, rival.speed * 0.95, 12, dt);
      } else if (state.s > rival.s) {
        rival.speed = Math.min(rival.speed, state.speed);
      }

      state.hit = Math.max(state.hit, 0.22);
    }
  }

  // Ambient traffic: cruise toward each car's own pace with a small
  // in-lane wander, then recycle into the window ahead once it has
  // fallen behind or been overtaken out of range.
  for (const car of traffic) {
    const bend = Math.abs(curvatureAt(car.s + 45 * car.dir));
    car.speed = damp(car.speed,
      car.cruise * (1 - Math.min(0.25, bend * 45)), 0.5, dt);
    car.s += car.dir * car.speed * dt;
    car.wheel += car.speed * dt / 0.425;
    car.x = damp(car.x, car.lane + Math.sin(car.s * 0.003) * 0.35,
                 0.7, dt);
    if (car.s < state.s - 150 || car.s > state.s + 950) {
      car.s = state.s + (car.dir > 0 ? 560 : 420) +
        Math.random() * 420;
      car.lane = car.dir * CFG.driveSide * (2.4 + Math.random() * 1.4);
      car.x = car.lane;
      car.speed = car.cruise;
    }

    if (Math.abs(car.s - state.s) < 4.5 &&
        Math.abs(car.x - state.x) < 2.0) {
      const push = Math.sign(state.x - car.x) || 1;
      state.x += push * dt * 3.8;
      // Head-on contact costs more than a same-direction nudge.
      state.speed *= car.dir < 0 ? 0.82 : 0.94;
      if (car.dir > 0 && state.s < car.s) {
        car.speed = Math.min(car.speed, state.speed);
      }
      state.hit = Math.max(state.hit, car.dir < 0 ? 0.6 : 0.25);
    }
  }

  state.acceleration = damp(
    state.acceleration, (state.speed - previousSpeed) / dt, 5, dt
  );
  state.wheel += state.speed * dt / 0.425;
  state.elapsed += dt;
  state.topSpeed = Math.max(state.topSpeed, state.speed);
}

// ================================================================
// 7. Floating origin, visual transforms and chase camera
// ================================================================

function rebaseWorld(dx, dz) {
  origin.x += dx;
  origin.z += dz;
  for (const chunk of chunks) {
    chunk.root.position.x -= dx;
    chunk.root.position.z -= dz;
  }
  for (const car of [player, ...roadCars.map(rival => rival.car)]) {
    car.root.position.x -= dx;
    car.root.position.z -= dz;
  }
  for (const region of regionPool) {
    region.root.position.x -= dx;
    region.root.position.z -= dz;
  }
  camera.position.x -= dx;
  camera.position.z -= dz;
  cameraAim.x -= dx;
  cameraAim.z -= dz;
  controls.target.x -= dx;
  controls.target.z -= dz;
}

function maintainTrack() {
  firstChunk = Math.max(0, Math.floor(state.s / CFG.chunkLength) - CFG.chunksBehind);
  lastChunk = firstChunk + CFG.chunkCount - 1;

  path.ensure((lastChunk + 1) * CFG.chunkLength + CFG.pathStep);
  path.sample(state.s, playerPath);

  const localX = playerPath.x - origin.x;
  const localZ = playerPath.z - origin.z;
  if (Math.hypot(localX, localZ) > 1600) {
    rebaseWorld(localX, localZ);
  }

  for (let index = firstChunk; index <= lastChunk; index++) {
    const chunk = chunks[index % CFG.chunkCount];
    if (chunk.index !== index) chunk.rebuild(index);
  }
  updateChunkLOD();
  maintainRegions();
}

// Chunk distance LOD: heavy scanned assets only near the car. The
// road runs straight into the view frustum, so frustum culling
// alone would still submit every chunk out to 2 km. ECO shortens
// both bands; orbit inspection keeps them as they are.
function updateChunkLOD() {
  const here = Math.floor(state.s / CFG.chunkLength);
  const nearReach = envDensity < 1 ? 3 : 5;
  const midReach = envDensity < 1 ? 9 : 13;
  for (const chunk of chunks) {
    const d = chunk.index - here;
    chunk.lodNear.visible = d >= -2 && d <= nearReach;
    chunk.lodMid.visible = d >= -2 && d <= midReach;
  }
}

function placeCar(car, s, lateral, yawError, roll, pitch) {
  path.sample(s, workPath);
  const h = workPath.heading;
  car.root.position.set(
    workPath.x - origin.x + Math.cos(h) * lateral,
    workPath.y + workPath.bank * lateral + 0.015,
    workPath.z - origin.z - Math.sin(h) * lateral
  );
  car.root.rotation.order = 'YXZ';
  car.root.rotation.set(
    -Math.atan(workPath.grade) + pitch,
    h + yawError,
    Math.atan(workPath.bank) + roll
  );
}

function updateCarVisuals() {
  const bodyRoll = clamp(state.yawRate * state.speed * 0.0018, -0.065, 0.065);
  const bodyPitch = clamp(state.acceleration * 0.002, -0.025, 0.025);

  placeCar(player, state.s, state.x, state.yaw, bodyRoll, bodyPitch);

  for (const wheel of player.wheels) {
    wheel.pivot.rotation.y = wheel.front ? state.steer : 0;
    wheel.spin.rotation.x = state.wheel % TAU;
  }

  // Optional GLB wheel pivots follow an explicit naming/axis contract.
  for (const wheel of player.importedWheels) {
    wheel.node.rotation.x = wheel.baseX + state.wheel % TAU;
    wheel.node.rotation.y = wheel.baseY + (wheel.front ? state.steer : 0);
  }

  player.tail.emissiveIntensity = state.brake || state.handbrake ? 8 : 3.2;
  playerBrakeGlow.intensity = state.brake || state.handbrake ? 2.25 : 0.46;
  for (const pool of player.rearSpill) {
    pool.material.opacity = (state.brake || state.handbrake ? 0.65 : 0.38) *
                            (0.35 + 0.65 * weatherIntensity);
  }
  for (const pool of player.frontSpill) {
    pool.material.opacity = 0.15 * weatherIntensity;
  }
  player.rotor.emissiveIntensity =
    state.brake && state.speed > 18 ? Math.min(2.7, state.speed / 24) : 0;

  for (const rival of rivals) {
    const visible =
      rival.s >= firstChunk * CFG.chunkLength &&
      rival.s < (lastChunk + 1) * CFG.chunkLength - CFG.pathStep;
    rival.car.root.visible = visible;
    if (!visible) continue;

    placeCar(rival.car, rival.s, rival.x, 0, 0, 0);
    for (const pool of rival.car.rearSpill)
      pool.material.opacity = 0.29 * weatherIntensity;
    for (const pool of rival.car.frontSpill)
      pool.material.opacity = 0.09 * weatherIntensity;
    for (const wheel of rival.car.wheels) {
      wheel.spin.rotation.x = rival.wheel % TAU;
      wheel.pivot.rotation.y = wheel.front ? curvatureAt(rival.s) * 2.94 : 0;
    }
  }

  for (const car of traffic) {
    const visible =
      car.s >= firstChunk * CFG.chunkLength &&
      car.s < (lastChunk + 1) * CFG.chunkLength - CFG.pathStep;
    car.car.root.visible = visible;
    if (!visible) continue;

    // dir -1 faces upstream: flip yaw π and mirror the steer angle.
    placeCar(car.car, car.s, car.x, car.dir < 0 ? Math.PI : 0, 0, 0);
    for (const pool of car.car.rearSpill)
      pool.material.opacity = 0.29 * weatherIntensity;
    for (const pool of car.car.frontSpill)
      pool.material.opacity = 0.09 * weatherIntensity;
    for (const wheel of car.car.wheels) {
      wheel.spin.rotation.x = car.wheel % TAU;
      wheel.pivot.rotation.y =
        wheel.front ? curvatureAt(car.s) * 2.94 * car.dir : 0;
    }
  }
}

const desiredCamera = new THREE.Vector3();
const desiredAim = new THREE.Vector3();
const desiredUp = new THREE.Vector3();
const vehicleForwardQ = new THREE.Quaternion();
const vehicleForwardV = new THREE.Vector3();

let lastGaugeTime = -1;
function updateCamera(dt, snap = false) {
  if (orbitMode) {
    controls.update();
    return;
  }
  if (cockpitMode) {
    // Driver's-eye view: camera lives on a mount inside the cockpit
    // (GLB axes — +X is the nose). Idle vibration, steering glance
    // and a widening FOV come from the reference demo.
    const vibration = Math.min(Math.abs(state.speed) / 35, 1) * 0.004;
    cockpit.position.y = Math.sin(state.elapsed * 18.4) * vibration;
    cameraMount.position.y =
      1.065 + Math.sin(state.elapsed * 12) * vibration;
    cameraMount.rotation.y = damp(
      cameraMount.rotation.y, state.steer * 0.36, 3.6, dt);
    cameraMount.rotation.z = damp(
      cameraMount.rotation.z,
      -state.steer / 0.44 *
        clamp(Math.abs(state.speed) / 60, 0, 0.028),
      3, dt);
    steeringColumn.rotation.x = damp(
      steeringColumn.rotation.x,
      -state.steer / 0.44 * 2.6, 11, dt);   // +-149 deg at full lock
    if (state.elapsed - lastGaugeTime > 0.085) {
      const revving = pressed('KeyW', 'ArrowUp') ||
        (autopilotOn && state.acceleration > 0.4);
      const rpm = clamp(
        0.85 + Math.abs(state.speed) * 0.072 + (revving ? 0.85 : 0),
        0.85, 6.5);
      cockpitDials[0].draw(Math.abs(state.speed) * 3.6);  // m/s -> km/h
      cockpitDials[0].update();
      cockpitDials[1].draw(rpm);
      cockpitDials[1].update();
      cockpitDials[2].draw(72);                 // fuel ~3/4 tank
      cockpitDials[2].update();
      cockpitDials[3].draw(48 + Math.min(35, Math.abs(state.speed)));
      cockpitDials[3].update();
      lastGaugeTime = state.elapsed;
    }
    player.root.updateMatrixWorld(true);
    cameraMount.getWorldPosition(camera.position);
    cameraMount.getWorldQuaternion(vehicleForwardQ);
    vehicleForwardV.set(1, 0, 0).applyQuaternion(vehicleForwardQ);
    desiredAim.copy(camera.position)
      .addScaledVector(vehicleForwardV, 14);
    desiredAim.y += 0.09;
    camera.up.set(0, 1, 0);
    camera.lookAt(desiredAim);
    camera.fov = damp(
      camera.fov,
      72 + Math.min(Math.abs(state.speed) / CFG.maxSpeed, 1) * 5,
      2, dt);
    camera.updateProjectionMatrix();
    return;
  }

  const p = player.root.position;
  const h = playerPath.heading + state.yaw * 0.68;
  const distance = 5.4 + state.speed * 0.016;
  const cameraHeight = 2.4 + state.speed * 0.004;

  desiredCamera.set(
    p.x - Math.sin(h) * distance,
    p.y + cameraHeight,
    p.z - Math.cos(h) * distance
  );

  path.sample(state.s + 10 + state.speed * 0.10, workPath);
  desiredAim.set(
    workPath.x - origin.x + Math.cos(workPath.heading) * state.x * 0.65,
    workPath.y + 0.7,
    workPath.z - origin.z - Math.sin(workPath.heading) * state.x * 0.65
  );

  const follow = snap ? 1 : 1 - Math.exp(-5.2 * dt);
  const aimFollow = snap ? 1 : 1 - Math.exp(-8 * dt);
  camera.position.lerp(desiredCamera, follow);
  cameraAim.lerp(desiredAim, aimFollow);

  const tilt = clamp(-state.yawRate * 0.065, -0.035, 0.035);
  desiredUp.set(Math.cos(h) * tilt, 1, -Math.sin(h) * tilt).normalize();
  camera.up.lerp(desiredUp, snap ? 1 : 1 - Math.exp(-5 * dt)).normalize();
  camera.lookAt(cameraAim);

  const targetFOV = 63 + state.speed * 0.15;
  const nextFOV = damp(camera.fov, targetFOV, 3, dt);
  if (Math.abs(nextFOV - camera.fov) > 0.015) {
    camera.fov = nextFOV;
    camera.updateProjectionMatrix();
  }
}

function updateWorldEffects(time) {
  const p = player.root.position;

  sky.position.copy(camera.position);

  mountains.position.set(p.x, playerPath.y - 12, p.z);
  rain.position.copy(camera.position);
  rainMaterial.uniforms.uTime.value = time;
  rainMaterial.uniforms.uIntensity.value = weatherIntensity;

  // Vegetation wind and headlight atmosphere follow weather + preset.
  windUniforms.uTime.value = time;
  windUniforms.uWind.value = 0.35 + weatherIntensity * 1.15;
  const beamGain = beamsOn
    ? (0.10 + 0.55 * weatherIntensity) * LIGHT_PRESETS[lightIndex].beam
    : 0;
  beamUniforms.uBeamI.value = beamGain;
  const carHeading = player.root.rotation.y;
  rainMaterial.uniforms.uBeamPos.value.copy(p);
  rainMaterial.uniforms.uBeamDir.value.set(
    Math.sin(carHeading), 0, Math.cos(carHeading)
  );
  rainMaterial.uniforms.uBeamI.value = beamGain * 2.4;
  // Retroreflective markings/reflectors: feed the live headlight
  // world position and beam gain into the injected shader term.
  playerHeadlights[0].getWorldPosition(headlightWorld);
  retroUniforms.uHeadPos.value.copy(headlightWorld);
  retroUniforms.uRetroGain.value =
    2.6 * Math.min(playerHeadlights[0].intensity / 33, 1) *
    (beamsOn ? 1 : 0.25);
  roadMirror.material.uniforms.uTime.value = time;
  roadMirror.material.uniforms.uWet.value = weatherIntensity;
  sprayMaterial.uniforms.uTime.value = time;
  sprayMaterial.uniforms.uSpeed.value = state.speed;
  // Wheel spray scales with the water actually under the tires.
  sprayMaterial.uniforms.uIntensity.value =
    weatherIntensity * (0.35 + 2.4 * waterAtCar);
  filmGrade.uniforms.uTime.value = time;
  filmGrade.uniforms.uSpeed.value = clamp(state.speed / CFG.maxSpeed, 0, 1);
  filmGrade.uniforms.uRain.value = weatherIntensity;

  // The scene sun shares the sky's azimuth; its elevation clamps
  // just above the horizon so twilight keeps usable key light.
  const lightElev = Math.max(4, skyElev) * Math.PI / 180;
  const lightAzim = skyAzim * Math.PI / 180;
  sun.position.set(
    p.x + Math.cos(lightElev) * Math.sin(lightAzim) * 90,
    p.y + Math.sin(lightElev) * 90,
    p.z + Math.cos(lightElev) * Math.cos(lightAzim) * 90);
  sun.target.position.set(p.x, p.y, p.z + 8);

  const wantSSR =
    reflectionMode === 'SSR' && ssrPass && effectsEnabled && !orbitMode;
  const wantPlanar =
    reflectionMode === 'PLANAR' && effectsEnabled && !orbitMode;
  roadMirror.visible = wantPlanar;
  if (ssrPass) {
    ssrPass.enabled = wantSSR;
    // Retained surface water drives how strongly the road mirrors.
    ssrPass.opacity = 0.12 + 0.38 * surfaceWetness;
  }
  renderPass.enabled = !wantSSR;

  if (wantPlanar) {
    path.sample(state.s + 24, workPath);
    roadMirror.position.set(
      workPath.x - origin.x,
      workPath.y + 0.05,
      workPath.z - origin.z
    );
    roadMirror.rotation.set(
      -Math.atan(workPath.grade),
      workPath.heading,
      Math.atan(workPath.bank)
    );
    roadMirror.material.uniforms.uStrength.value =
      0.15 + 0.3 * weatherIntensity + 0.3 * surfaceWetness;
  }

  // Retained surface water feeds puddles and wet-edge glints.
  materials.puddle.opacity = 0.08 + 0.30 * surfaceWetness;
  materials.wetEdge.opacity = 0.04 + 0.10 * surfaceWetness;

  for (let i = 0; i < mistLayers.length; i++) {
    const layer = mistLayers[i];
    layer.position.set(p.x, playerPath.y + 0.9 + i * 2.1, p.z);
    layer.material.opacity =
      (0.05 + 0.17 * weatherIntensity) * (i ? 0.7 : 1);
    layer.material.map.offset.set(
      time * (i ? -0.0075 : 0.005), time * (i ? 0.004 : -0.006)
    );
  }
}

// ================================================================
// 8. Camera-lens rain: screen-space droplets, menisci and trickles.
// Uses a bounded 2D overlay: no WebGL readback or video compositing.
// ================================================================

const lensCanvas = $('lens-rain');
const lensCtx = lensCanvas.getContext('2d', { alpha: true });
const lensRandom = randomGenerator(44993);
const lensDroplets = Array.from({ length: MOBILE ? 34 : 65 }, () => ({
  x: lensRandom(),
  y: lensRandom(),
  r: 0.7 + Math.pow(lensRandom(), 3) * 5.4,
  drift: lensRandom() * 0.26 + 0.018,
  phase: lensRandom() * TAU,
  streak: 3 + lensRandom() * 21
}));
let lensLastDraw = -1;

function resizeLens() {
  // Render under native screen resolution to keep 2D gradients cheap.
  const lensScale = Math.min(devicePixelRatio || 1, MOBILE ? 0.75 : 1.0);
  lensCanvas.width = Math.max(1, Math.floor(width * lensScale));
  lensCanvas.height = Math.max(1, Math.floor(height * lensScale));
  lensCtx.setTransform(lensScale, 0, 0, lensScale, 0, 0);
}

function renderLensRain(time) {
  if (time - lensLastDraw < 1 / 24) return;
  const dt = lensLastDraw < 0 ? 0 : clamp(time - lensLastDraw, 0, 0.08);
  lensLastDraw = time;
  lensCtx.clearRect(0, 0, width, height);
  if (weatherIntensity < 0.01) return;

  lensCtx.save();
  const strength = weatherIntensity;
  for (const drop of lensDroplets) {
    drop.y += dt * drop.drift * (0.25 + strength * 0.9);
    drop.x += dt * 0.0024 * Math.sin(time * 1.7 + drop.phase);
    if (drop.y > 1.12) {
      drop.y = -0.08;
      drop.x = lensRandom();
    }
    if (drop.x > 1.01) drop.x = 0.01;
    const x = drop.x * width;
    const y = drop.y * height;
    const r = drop.r * (Math.min(width, height) / 760);
    if (r < 0.5) continue;
    // Thin downflow from larger droplets.
    if (drop.r > 2.8) {
      lensCtx.beginPath();
      lensCtx.moveTo(x, y - r * 0.5);
      lensCtx.bezierCurveTo(x - r * 0.15, y - r * 3,
                            x + r * 0.2, y - drop.streak, x, y - drop.streak);
      lensCtx.strokeStyle = `rgba(175,212,237,${0.07 * strength})`;
      lensCtx.lineWidth = Math.max(0.55, r * 0.32);
      lensCtx.stroke();
    }
    const g = lensCtx.createRadialGradient(
      x - r * 0.3, y - r * 0.36, r * 0.02, x, y, r * 1.25
    );
    g.addColorStop(0, `rgba(216,238,255,${0.27 * strength})`);
    g.addColorStop(0.34, `rgba(82,140,183,${0.03 * strength})`);
    g.addColorStop(0.78, `rgba(6,22,38,${0.12 * strength})`);
    g.addColorStop(1, 'rgba(24,52,74,0)');
    lensCtx.beginPath();
    lensCtx.ellipse(x, y, r * 0.83, r * 1.2, 0.07, 0, TAU);
    lensCtx.fillStyle = g;
    lensCtx.fill();
    if (r > 1.8) {
      lensCtx.beginPath();
      lensCtx.ellipse(x - r * 0.15, y - r * 0.24,
                      r * 0.51, r * 0.71, 0.07, 3.7, 5.65);
      lensCtx.strokeStyle = `rgba(214,238,255,${0.24 * strength})`;
      lensCtx.lineWidth = Math.max(0.6, r * 0.19);
      lensCtx.stroke();
    }
  }
  lensCtx.restore();
}

// ================================================================
// 9. Optional embedded GLB replacement
//
// Expected model orientation: Y-up, +Z-forward.
// Optional wheel pivot names: wheel_fl, wheel_fr, wheel_rl, wheel_rr.
// Those pivots should spin around local X and steer around local Y.
// Other models still load, but their wheel rig needs a model adapter.
// ================================================================

const gltfLoader = new GLTFLoader();

function disposeImported(root) {
  const geometries = new Set();
  const mats = new Set();
  const textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) {
      for (const material of Array.isArray(object.material)
        ? object.material : [object.material]) {
        mats.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    }
  });
  geometries.forEach(value => value.dispose());
  mats.forEach(value => value.dispose());
  textures.forEach(value => value.dispose());
}

$('model-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) {
    toast('CHOOSE AN EMBEDDED GLB SMALLER THAN 40 MB');
    return;
  }

  toast('LOADING OPTIONAL CAR MODEL…');
  try {
    const data = await file.arrayBuffer();
    const gltf = await new Promise((resolve, reject) =>
      gltfLoader.parse(data, '', resolve, reject)
    );

    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());

    if (!Number.isFinite(size.z) || size.z < 0.001) {
      disposeImported(model);
      throw new Error('Invalid car bounds');
    }

    const wrapper = new THREE.Group();
    const scale = 4.8 / size.z;
    wrapper.scale.setScalar(scale);
    model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
    wrapper.add(model);

    const importedWheels = [];
    model.traverse(object => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
      const match = /^wheel_(fl|fr|rl|rr)$/i.exec(object.name);
      if (match) {
        importedWheels.push({
          node: object,
          front: match[1].toLowerCase().startsWith('f'),
          baseX: object.rotation.x,
          baseY: object.rotation.y
        });
      }
    });

    if (player.imported) {
      player.root.remove(player.imported);
      // Shared clones must not have their pooled geometry disposed.
      if (!player.imported.userData.shared) disposeImported(player.imported);
    }

    // Drop wheel pivots left behind by the fleet-mount loader — their
    // groups are detached with the wrapper and would update forever.
    player.wheels = player.wheels.filter(w => !w.mounted);
    player.imported = wrapper;
    player.importedWheels = importedWheels;
    player.visual.visible = false;
    wrapper.visible = !cockpitMode;
    player.root.add(wrapper);

    toast(importedWheels.length
      ? 'GLB LOADED · NAMED WHEEL RIG ACTIVE'
      : 'GLB LOADED · WHEEL RIG NOT DETECTED', 3500);
  } catch (error) {
    console.error(error);
    toast('GLB COULD NOT BE LOADED · EXISTING CAR RETAINED', 3500);
  }
  event.target.value = '';
});

// ================================================================
// 10. HUD, minimap, adaptive resolution and main loop
// ================================================================

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const wholeSeconds = Math.floor(seconds % 60).toString().padStart(2, '0');
  const hundredths = Math.floor((seconds % 1) * 100).toString().padStart(2, '0');
  return `${minutes}:${wholeSeconds}.${hundredths}`;
}

const mapCanvas = $('map');
const mapContext = mapCanvas.getContext('2d');
const debugContext = $('water-debug').getContext('2d');
const mapPoint = {};
const mapOrigin = {};
const mapCoords = { x: 0, y: 0 };

function mapCoordinates(s, lateral = 0) {
  path.sample(s, mapPoint);
  const dx = mapPoint.x + Math.cos(mapPoint.heading) * lateral - mapOrigin.x;
  const dz = mapPoint.z - Math.sin(mapPoint.heading) * lateral - mapOrigin.z;
  const h = mapOrigin.heading;
  const right = dz * Math.sin(h) - dx * Math.cos(h);
  const forward = dx * Math.sin(h) + dz * Math.cos(h);
  mapCoords.x = 135 + right * 0.35;
  mapCoords.y = 270 - forward * 0.35;
  return mapCoords;
}

function drawMap() {
  const ctx = mapContext;
  ctx.clearRect(0, 0, 270, 310);
  path.sample(state.s, mapOrigin);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let ds = -48; ds <= 670; ds += 12) {
    const s = Math.max(firstChunk * CFG.chunkLength, state.s + ds);
    const p = mapCoordinates(s);
    if (ds === -48) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }

  ctx.strokeStyle = 'rgba(92,137,163,.25)';
  ctx.lineWidth = 13;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,212,233,.76)';
  ctx.lineWidth = 3;
  ctx.stroke();

  for (const rival of rivals) {
    if (rival.s < state.s - 48 || rival.s > state.s + 670) continue;
    const p = mapCoordinates(rival.s, rival.x);
    ctx.fillStyle = '#ffac87';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, TAU);
    ctx.fill();
  }
  for (const car of traffic) {
    if (car.s < state.s - 48 || car.s > state.s + 670) continue;
    const p = mapCoordinates(car.s, car.x);
    ctx.fillStyle = car.dir > 0 ? 'rgba(140,160,175,.8)'
                              : 'rgba(255,214,130,.85)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, TAU);
    ctx.fill();
  }

  const p = mapCoordinates(state.s, state.x);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-state.yaw);
  ctx.fillStyle = '#c5f6ff';
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(-6, 6);
  ctx.lineTo(6, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

let averageFrameMS = 16.7;
const frameHistory = [];

// Optional GPU elapsed-time measurement via the timer extension;
// unavailable on some drivers, in which case it just reports n/a.
const gpuTimerExt = renderer.getContext()
  .getExtension('EXT_disjoint_timer_query_webgl2');
const glCtx = renderer.getContext();
let gpuQuery = null;
let gpuTimeMS = null;
let renderCPUMS = 0;
const gpuSamples = [];
function pollGpuTimer() {
  if (!gpuQuery) return;
  const ready = glCtx.getQueryParameter(
    gpuQuery, glCtx.QUERY_RESULT_AVAILABLE);
  if (!ready) return;
  if (!glCtx.getParameter(gpuTimerExt.GPU_DISJOINT_EXT)) {
    gpuTimeMS =
      glCtx.getQueryParameter(gpuQuery, glCtx.QUERY_RESULT) / 1e6;
    gpuSamples.push(gpuTimeMS);
    if (gpuSamples.length > 240) gpuSamples.shift();
  }
  glCtx.deleteQuery(gpuQuery);
  gpuQuery = null;
}
function gpuPercentile(p) {
  if (!gpuSamples.length) return null;
  const sorted = Float64Array.from(gpuSamples).sort();
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
function updateHUD() {
  const kph = Math.round(state.speed * 3.6);
  const gear = Math.min(7, 1 + Math.floor(state.speed / 12.5));
  const place = 1 + rivals.filter(rival => rival.s > state.s).length;

  $('speed').textContent = String(kph).padStart(3, '0');
  $('gear').textContent = gear;
  $('position').innerHTML = `${place} <small>/ 4</small>`;
  $('lapTime').textContent = formatTime(state.elapsed);
  $('bestTime').textContent =
    `${Math.round(state.topSpeed * 3.6)} KM/H`;
  $('distance').textContent = `${((state.s - START_S) / 1000).toFixed(2)} KM`;
  $('grip-status').textContent = autopilotOn ? 'AUTO DRIVE' :
    state.handbrake ? 'DRIFT' :
    Math.abs(state.x) > 6.05 ? 'SHOULDER' :
    weatherIntensity > 0.5 ? 'WET GRIP' : weatherIntensity > 0 ? 'DAMP GRIP' : 'DRY';

  const rpm = clamp((state.speed % 12.5) / 12.5 * 0.7 + 0.25, 0, 1);
  $('rev').style.width = `${rpm * 100}%`;


  const bend = curvatureAt(state.s + 90);
  $('bend').textContent = Math.abs(bend) < 0.0009
    ? 'STRAIGHT AHEAD' : bend > 0 ? 'LEFT BEND AHEAD' : 'RIGHT BEND AHEAD';
  let lowFps = '';
  if (frameHistory.length > 30) {
    const sorted = Float64Array.from(frameHistory).sort();
    const p99 = sorted[
      Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))
    ];
    lowFps = `/${Math.round(1 / p99)}`;
  }
  $('stats').textContent =
    `${Math.round(1000 / averageFrameMS)}${lowFps} FPS · ${environmentStatus} · ${pbrStatus} · ${weatherNames[weatherIndex]}`;

  drawMap();

  if (diagnosticsOn) {
    const dctx = debugContext;
    dctx.clearRect(0, 0, 190, 164);
    const firstCell = waterCellRow(state.s - 32);
    const cw = 190 / WATER_COLS;
    const rh = 118 / WATER_ROWS;
    for (let r = 0; r < WATER_ROWS; r++) {
      const base = r * WATER_COLS;
      for (let c = 0; c < WATER_COLS; c++) {
        const b = waterBytes[base + c];
        if (b < 6) continue;
        dctx.fillStyle =
          `rgba(90,170,255,${(b / 255 * 0.85).toFixed(2)})`;
        dctx.fillRect(c * cw, 124 - (r + 1) * rh, cw + 0.5, rh + 0.5);
      }
    }
    const carRow = (state.s - firstCell * WATER_CELL_S) / WATER_CELL_S;
    const carCol = (state.x + WATER_HALF_W) / (2 * WATER_HALF_W);
    dctx.fillStyle = '#c5f6ff';
    dctx.fillRect(carCol * 190 - 2, 124 - carRow * rh - 2, 4, 4);
    dctx.fillStyle = '#9fd7ee';
    dctx.font = '9px monospace';
    dctx.fillText(`WATER ${(surfaceWetness * 100) | 0}%`, 6, 134);
    dctx.fillText(
      `${averageFrameMS.toFixed(1)}MS · ` +
      `${renderer.info.render.calls}DC · ` +
      `${(renderer.info.render.triangles / 1000) | 0}KTRI`, 6, 146
    );
    if (autopilotOn) {
      dctx.fillStyle = '#7df3ff';
      dctx.fillText(
        `LIDAR ${Array.from(lidarRanges)
          .map(r => r >= LIDAR_RANGE ? '--' : r.toFixed(0)).join(' ')}`,
        6, 158
      );
    }
  }

  if (profilerOn) {
    const q = streamQueue;
    const info = renderer.info;
    const gpuP50 = gpuPercentile(0.5);
    const gpuP95 = gpuPercentile(0.95);
    $('stream-panel').innerHTML =
      '<div class="head">BLUE HOUR / STREAM PROFILER</div>' +
      `GPU ${gpuTimeMS == null ? 'n/a' : gpuTimeMS.toFixed(1) + ' MS'}` +
      (gpuP50 == null ? '' :
        ` · p50 ${gpuP50.toFixed(1)} · p95 ${gpuP95.toFixed(1)}`) +
      ` · CPU ${renderCPUMS.toFixed(1)} MS` +
      ` · FRAME ${averageFrameMS.toFixed(1)} MS<br>` +
      `QUEUE ${q.pending.length} WAIT · ${q.active}/${q.cap} LIVE` +
      ` · ${q.done} DONE · ${q.failed} FAIL<br>` +
      `GEO ${info.memory.geometries} · TEX ${info.memory.textures}` +
      ` · ${info.render.calls} CALLS` +
      ` · ${(info.render.triangles / 1000) | 0}KTRI<br>` +
      `ASSETS ${forestParts ? forestParts.length : 0} TREE` +
      ` · ${sceneryParts.size} PROP · ${variantAssets.size} NATURE` +
      ` · ${pbrStatus}` +
      ` · ${ktx2Loader ? 'KTX2 READY' : 'RASTER'}` +
      ` · ${impostorMaterial.userData.atlas ? 'ATLAS' : 'GEN'}<br>` +
      `TILES ${regionStats.active}/8 · LOAD ${regionStats.loading}` +
      ` · CACHE ${regionDescCache.size}` +
      ` · LOD ${regionStats.lod.join('/')}` +
      ` · CULL ${regionStats.culled || 0}`;
  }
}

function resize() {
  width = innerWidth;
  height = innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  composer.setPixelRatio(dpr);
  composer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  sprayMaterial.uniforms.uDPR.value = dpr;
  filmGrade.uniforms.uResolution.value.set(width * dpr, height * dpr);
  resizeLens();
}
addEventListener('resize', resize);

renderer.domElement.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  suspend();
  $('boot-status').textContent = 'Graphics context lost. Reload to restart.';
  toast('GRAPHICS CONTEXT LOST · RELOAD TO RESTART', 60000);
});

// Initial bounded world construction.
maintainTrack();
loadForestGLB();
loadSceneryGLB();
loadNature();
loadCars();

// Opt-in inspection hook for automated runtime checks (?debug).
if (new URLSearchParams(location.search).has('debug')) {
  window.blueHour = {
    state, rivals, traffic, regionPool, streamQueue, variantAssets,
    renderer,
    chunks, lidarRanges, camera, controls, scene,
    get forestParts() { return forestParts; },
    get reflectionMode() { return reflectionMode; }
  };
}
updateCarVisuals();
cameraAim.copy(player.root.position).add(new THREE.Vector3(0, 0.8, 8));
updateCamera(1, true);
updateWorldEffects(0);
setWeather(0);
resize();
updateHUD();

$('start').disabled = false;
$('start').textContent = 'START ENGINE';
if (environmentStatus === 'HDR LOADING') {
  $('boot-status').textContent = 'Ready · HDR lighting is loading in the background';
}

let previousTime = performance.now();
let visualTime = 0;
let hudElapsed = 0;
let performanceElapsed = 0;

function animate(now) {
  requestAnimationFrame(animate);

  const rawDT = Math.max(0.001, (now - previousTime) / 1000);
  previousTime = now;
  const dt = Math.min(rawDT, 0.0667);

  if (!document.hidden && rawDT < 0.12) {
    averageFrameMS = damp(averageFrameMS, rawDT * 1000, 1.4, dt);
    frameHistory.push(rawDT);
    if (frameHistory.length > 240) frameHistory.shift();
  }

  const active = started && !paused && !document.hidden;

  if (active) {
    if (autopilotOn) sweepLidar();
    accumulator += dt;
    let substeps = 0;
    while (accumulator >= CFG.fixedStep && substeps < 8) {
      stepVehicle(CFG.fixedStep);
      accumulator -= CFG.fixedStep;
      substeps++;
    }

    // Avoid a simulation spiral after a long frame.
    if (substeps === 8) accumulator = Math.min(accumulator, CFG.fixedStep);
    updateWater(dt);
  } else {
    accumulator = 0;
  }

  if (!paused) visualTime += dt;

  maintainTrack();
  updateCarVisuals();
  updateCamera(dt);
  updateLighting(dt);
  updateWorldEffects(visualTime);
  renderLensRain(visualTime);
  // Re-bake the ambient light probe as the car travels — ambient
  // follows local occlusion (canopy tunnels vs open ridges).
  if (started && state.s - lastProbeS > 250) {
    lastProbeS = state.s;
    bakeProbe();
  }
  $('impact').style.opacity = String(state.hit * 0.27);

  hudElapsed += dt;
  if (hudElapsed > 0.10) {
    hudElapsed = 0;
    updateHUD();
  }

  // Prefer stable frame time over excessive pixel density.
  performanceElapsed += dt;
  if (adaptiveQuality && started && performanceElapsed > 3) {
    performanceElapsed = 0;
    if (averageFrameMS > 27 && reflectionMode === 'SSR') {
      reflectionMode = 'PLANAR';
      toast('SSR TOO HEAVY · PLANAR REFLECTIONS', 2200);
    } else if (averageFrameMS > 21 && envMode === 0 && envDensity > 0.55) {
      setEnvDensity(0.55);
      toast('ENVIRONMENT ECO (AUTO)', 1600);
    } else if (averageFrameMS > 24 && worldMode === 0 && worldDensity > 0.5) {
      setWorldDensity(0.5);
      toast('WORLD ECO (AUTO)', 1600);
    } else if (averageFrameMS > 22 && dpr > 0.85) {
      dpr = Math.max(0.85, dpr - 0.15);
      resize();
    } else if (averageFrameMS > 25 && effectsEnabled) {
      effectsEnabled = false;
      $('quality').textContent = 'FX AUTO LOW';
    } else if (averageFrameMS < 14.5 && envMode === 0 && envDensity < 1) {
      setEnvDensity(1);
      toast('ENVIRONMENT HIGH (AUTO)', 1600);
    } else if (averageFrameMS < 15 && worldMode === 0 && worldDensity < 1) {
      setWorldDensity(1);
      toast('WORLD HIGH (AUTO)', 1600);
    } else if (averageFrameMS < 15.2 && dpr < maxDPR - 0.08) {
      dpr = Math.min(maxDPR, dpr + 0.10);
      resize();
    }
  }

  pollGpuTimer();
  const cpuStart = performance.now();
  // Only one timer query may be in flight; while a previous result
  // is still pending, this frame is simply not measured.
  let timing = false;
  if (gpuTimerExt && !gpuQuery) {
    gpuQuery = glCtx.createQuery();
    glCtx.beginQuery(gpuTimerExt.TIME_ELAPSED_EXT, gpuQuery);
    timing = true;
  }
  // Count every pass of the frame, not just the composer's last quad.
  renderer.info.reset();
  if (effectsEnabled) composer.render();
  else renderer.render(scene, camera);
  if (timing) glCtx.endQuery(gpuTimerExt.TIME_ELAPSED_EXT);
  renderCPUMS = damp(renderCPUMS, performance.now() - cpuStart, 3, dt);
}

requestAnimationFrame(animate);
