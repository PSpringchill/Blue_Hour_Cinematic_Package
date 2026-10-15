// Asset loaders: GLTF with Draco/Meshopt decode, optional KTX2
// compressed textures, and the raster PBR path capped through
// core/stream.js. All network load goes through queuedJob so heavy
// content arrives progressively and decodes stay bounded.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder }
  from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { ASSETS } from './config.js';
import { queuedJob, capTexture,
         acquireTexDecode, releaseTexDecode } from './stream.js';

// Decoder/transcoder binaries are vendored so asset loading never
// depends on CDN reachability at runtime.
const DRACO_PATH = '../vendor/draco/';
const BASIS_PATH = '../vendor/basis/';

const dracoLoader = new DRACOLoader().setDecoderPath(DRACO_PATH);

export function makeGLTFLoader() {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  try { loader.setMeshoptDecoder(MeshoptDecoder); } catch (error) {}
  return loader;
}

// install_ktx2.py records every installed file; only those are
// probed, so a project without KTX2 assets makes one request total.
export function createAssetLoaders(renderer) {
  let ktx2Loader = null;
  try {
    ktx2Loader = new KTX2Loader()
      .setTranscoderPath(BASIS_PATH)
      .detectSupport(renderer);
  } catch (error) { ktx2Loader = null; }

  const gltf = makeGLTFLoader();
  const raster = new THREE.TextureLoader();

  const ktx2Files = (ktx2Loader
    ? fetch(ASSETS.ktx2Manifest)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    : Promise.resolve(null)
  ).then(manifest => new Set(
    Object.values((manifest && manifest.ktx2) || {}).map(e => e.file)
  ));

  // Loads url as .ktx2 when the manifest lists it, else falls back to
  // the raster file under the decode semaphore + size cap.
  function pbrTexture(url, srgb, cap) {
    const ktx2url = url.replace(/\.(jpg|jpeg|png|webp)$/i, '.ktx2');
    return ktx2Files.then(files =>
      files.has(ktx2url)
        ? Promise.race([
            ktx2Loader.loadAsync(ktx2url).catch(() => null),
            new Promise(resolve => setTimeout(() => resolve(null), 8000))
          ])
        : null
    ).then(compressed => {
      if (compressed) {
        compressed.wrapS = compressed.wrapT = THREE.RepeatWrapping;
        if (srgb) compressed.colorSpace = THREE.SRGBColorSpace;
        return compressed;
      }
      return Promise.resolve(acquireTexDecode()).then(() =>
        new Promise(resolve => {
          raster.load(url, texture => {
            releaseTexDecode();
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.anisotropy =
              Math.min(16, renderer.capabilities.getMaxAnisotropy());
            if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
            resolve(capTexture(texture, cap));
          }, undefined, () => { releaseTexDecode(); resolve(null); });
        }));
    });
  }

  return { gltf, raster, ktx2Loader, pbrTexture, queuedJob };
}
