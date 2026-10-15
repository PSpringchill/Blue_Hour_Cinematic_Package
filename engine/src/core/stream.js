// Asset streaming + texture-memory helpers.
// A small priority queue with a concurrent request cap so heavy
// assets arrive progressively instead of all at once; a second
// semaphore bounds raster image decodes, and capTexture downsizes
// oversized maps before they reach the GPU.
import { CFG } from './config.js';

export const streamQueue = {
  pending: [], active: 0,
  cap: CFG.streamConcurrency, done: 0, failed: 0,
  enqueue(key, priority, task) {
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

// Same key -> same promise, so duplicate in-flight requests share one
// load. Once settled the entry is dropped: retaining resolved job
// values would pin every decoded GLB (scene, parser, geometry and
// full-res images) for the whole session.
const streamJobs = new Map();
export function queuedJob(key, priority, task) {
  if (streamJobs.has(key)) return streamJobs.get(key);
  const job = new Promise((resolve, reject) => {
    streamQueue.enqueue(key, priority,
      () => task().then(resolve, reject));
  });
  streamJobs.set(key, job);
  const clean = () => streamJobs.delete(key);
  job.then(clean, clean);
  return job;
}

// Raster textures arrive uncompressed: a 2048x2048 map holds ~21 MB
// of GPU memory each, and the asset sets push the total toward 1 GB.
// Downscaling oversized images to CFG.textureCap through a canvas
// keeps the look while quartering the footprint. The original decode
// buffers are released once the upload happens.
export function capTexture(texture, cap = CFG.textureCap) {
  const image = texture.image;
  if (!image || texture.userData.capped) return texture;
  texture.userData.capped = true;
  const w = image.width, h = image.height;
  const longest = Math.max(w, h);
  if (!w || !h || longest <= cap) return texture;
  const scale = cap / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d')
    .drawImage(image, 0, 0, canvas.width, canvas.height);
  // Release the decoded source: ImageBitmap.close() frees the raster
  // buffer synchronously; HTMLImageElement drops on GC once no
  // texture references it anymore.
  if (typeof image.close === 'function') image.close();
  texture.image = canvas;
  texture.needsUpdate = true;
  return texture;
}

// Every texture slot on a GLB material (GLTFLoader decodes embedded
// images to full resolution regardless of mesh size on screen).
export function capMaterialTextures(material, cap = CFG.textureCap) {
  for (const slot of [
    'map', 'normalMap', 'roughnessMap', 'metalnessMap',
    'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'
  ]) {
    if (material[slot]) capTexture(material[slot], cap);
  }
}

// Raster decodes bypass the mesh stream queue, so parallel
// Promise.all() batches spike the JS heap with image buffers.
// A small semaphore keeps at most four decodes in flight.
let texDecodeActive = 0;
const texDecodePending = [];
export function acquireTexDecode() {
  if (texDecodeActive < 4) { texDecodeActive++; return null; }
  return new Promise(resolve => texDecodePending.push(resolve));
}
export function releaseTexDecode() {
  const next = texDecodePending.shift();
  if (next) next(); else texDecodeActive--;
}
