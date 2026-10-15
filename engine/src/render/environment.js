// Environment layer: physical Sky (Preetham scattering — the same
// shader as three.js webgl_shaders_sky), star dome, sun/hemi/fill
// rig, PMREM + HDRI image-based lighting, and per-frame preset
// blending from LIGHT_PRESETS.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment }
  from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { LIGHT_PRESETS, PARTICLES, ASSETS } from '../core/config.js';
import { MOBILE } from '../core/math.js';

const HDR_FALLBACK = '../assets/hdri/dikhololo_night_1k.hdr';

export function createEnvironment({ renderer, scene, bloom }) {
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

  // Generated environment is immediately available if HDR loading
  // fails.
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const room = new RoomEnvironment();
  let environmentRT = pmrem.fromScene(room, 0.04);
  scene.environment = environmentRT.texture;
  room.dispose();

  let environmentStatus = 'HDR LOADING';
  const onEnv = { loaded: null, failed: null };
  new RGBELoader().load(
    ASSETS.hdri,
    texture => {
      const next = pmrem.fromEquirectangular(texture);
      scene.environment = next.texture;
      environmentRT.dispose();
      environmentRT = next;
      texture.dispose();
      pmrem.dispose();
      environmentStatus = 'LOCAL HDR';
      if (onEnv.loaded) onEnv.loaded(environmentStatus);
    },
    undefined,
    () => {
      // Try the remote fallback once before settling on the room.
      new RGBELoader().load(HDR_FALLBACK, texture => {
        const next = pmrem.fromEquirectangular(texture);
        scene.environment = next.texture;
        environmentRT.dispose();
        environmentRT = next;
        texture.dispose();
        pmrem.dispose();
        environmentStatus = '2K HDR';
        if (onEnv.loaded) onEnv.loaded(environmentStatus);
      }, undefined, () => {
        pmrem.dispose();
        environmentStatus = 'LOCAL IBL';
        if (onEnv.failed) onEnv.failed(environmentStatus);
      });
    }
  );

  const sky = new Sky();
  sky.scale.setScalar(2400);
  scene.add(sky);
  const skyU = sky.material.uniforms;
  skyU.turbidity.value = 8;
  skyU.rayleigh.value = 2.6;
  skyU.mieCoefficient.value = 0.007;
  skyU.mieDirectionalG.value = 0.85;
  let skyElev = -0.8, skyAzim = 205;
  const skySunPos = new THREE.Vector3();

  // The Sky shader has no night stars — a light additive point dome
  // fades in under the night preset instead.
  const starMaterial = new THREE.PointsMaterial({
    color: 0xd8e6ff, size: 1.6, sizeAttenuation: false,
    transparent: true, opacity: 0.1, depthWrite: false, fog: false
  });
  const starPositions = new Float32Array(PARTICLES.stars * 3);
  for (let i = 0; i < PARTICLES.stars; i++) {
    const a = Math.random() * Math.PI * 2;
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

  let lightIndex = 1;   // BLUE is the authored look
  const lightColor = new THREE.Color();

  scene.background = new THREE.Color(LIGHT_PRESETS[lightIndex].bg);
  scene.fog = new THREE.FogExp2(
    LIGHT_PRESETS[lightIndex].fog, LIGHT_PRESETS[lightIndex].fogD);
  scene.environmentIntensity = LIGHT_PRESETS[lightIndex].envI;

  // headlights: optional hook — pass an array of SpotLights whose
  // intensity tracks the preset's headI (the vehicle layer supplies
  // them once cars are loaded).
  function update(dt, headlights = []) {
    const t = LIGHT_PRESETS[lightIndex];
    const k = 1 - Math.exp(-2.4 * dt);
    scene.background.lerp(lightColor.setHex(t.bg), k);
    scene.fog.color.lerp(lightColor.setHex(t.fog), k);
    scene.fog.density += (t.fogD - scene.fog.density) * k;
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
    for (const spot of headlights)
      spot.intensity += (33 * t.headI - spot.intensity) * k;
  }

  function cycle() {
    lightIndex = (lightIndex + 1) % LIGHT_PRESETS.length;
    return LIGHT_PRESETS[lightIndex].name;
  }

  return {
    hemi, sun, fill, sky, skyU, starMaterial,
    update, cycle, onEnv,
    get preset() { return LIGHT_PRESETS[lightIndex]; },
    get environmentStatus() { return environmentStatus; }
  };
}
