// Renderer + post chain. WebGL2 with ACES tone mapping, soft shadows
// and a composer carrying bloom -> filmic grade -> output transform.
// SSR is intentionally NOT created here — the pass allocates several
// full-resolution targets in its constructor, so it is built lazily
// by the reflections module on first toggle.
import * as THREE from 'three';
import { EffectComposer }
  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }
  from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }
  from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MOBILE } from '../core/math.js';

export function createRendererStack(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false
  });
  const maxDPR = Math.min(devicePixelRatio || 1, MOBILE ? 1.25 : 1.65);
  renderer.setPixelRatio(maxDPR);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Stats are reset once per frame so multi-pass frames sum correctly.
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera =
    new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 2400);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight), 0.36, 0.46, 0.94
  );
  composer.addPass(bloom);

  // Filmic grade, subtle peripheral velocity smear and fine-grained
  // luminance noise, before the output color transform.
  const filmGrade = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uSpeed: { value: 0 },
      uRain: { value: 1 },
      uResolution: { value: new THREE.Vector2(innerWidth, innerHeight) }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position =
          projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
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
        float edge =
          smoothstep(0.14, 0.73, length(delta * vec2(1.0, 0.9)));
        float smear = edge * uSpeed * 0.006;
        vec2 direction = normalize(delta + vec2(0.00001));
        vec3 col = texture2D(tDiffuse, uv).rgb * 0.58;
        col += texture2D(tDiffuse,
          clamp(uv - direction * smear, 0.001, 0.999)).rgb * 0.22;
        col += texture2D(tDiffuse,
          clamp(uv + direction * smear, 0.001, 0.999)).rgb * 0.20;
        // Warm lights against cool indirect illumination.
        float luminance = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col *= vec3(0.976, 1.007, 1.047);
        col = mix(vec3(luminance), col, 1.09);
        col *= 1.025 - edge * 0.15;
        float grain =
          hash21(floor(uv * uResolution * 0.56) + uTime * 34.0) - 0.5;
        col += grain * (0.0048 + uRain * 0.0018);
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }`
  });
  composer.addPass(filmGrade);
  composer.addPass(new OutputPass());

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    filmGrade.uniforms.uResolution.value.set(innerWidth, innerHeight);
  }
  addEventListener('resize', resize);

  return { renderer, scene, camera, composer, bloom, filmGrade,
           resize, maxDPR };
}
