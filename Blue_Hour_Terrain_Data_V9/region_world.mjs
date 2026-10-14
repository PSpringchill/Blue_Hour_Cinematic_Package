// Blue Hour V8 — bounded world-region descriptors, independent of Three.js.
// All region IDs are world-route coordinates (metres / REGION_SIZE).
export const REGION_SIZE = 256;
export const MAX_INDEX_BYTES = 131072;
export const MAX_TILE_BYTES = 16384;
export const DEFAULT_CACHE_BYTES = 98304;
export const REGION_BIOMES = Object.freeze(['pine','rocky','alpine','mist']);

export function regionHash(x) {
  let n = (x | 0) ^ 0x417e9bc7;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}
export function fallbackRegion(id) {
  const h = regionHash(id);
  return {
    id, biome: REGION_BIOMES[h % REGION_BIOMES.length],
    seed: h, heightfield: null, density: 0.58 + ((h >>> 8) % 35) / 100,
    relief: 0.7 + ((h >>> 16) % 50) / 100, tint: ((h >>> 24) % 21 - 10) / 100,
    source: 'procedural'
  };
}
export function validateRegion(id, raw) {
  if (!Number.isSafeInteger(id) || id < 0 || id > 10000000) throw new Error('Invalid region ID');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.id !== id) throw new Error('Region ID mismatch');
  if (!REGION_BIOMES.includes(raw.biome)) throw new Error('Invalid biome');
  const density = Number(raw.density), relief = Number(raw.relief), tint = Number(raw.tint);
  if (![density, relief, tint].every(Number.isFinite) ||
      density < 0.1 || density > 1.5 || relief < 0.25 || relief > 2 ||
      tint < -0.3 || tint > 0.3) throw new Error('Invalid region parameters');
  if (!Number.isSafeInteger(raw.seed) || raw.seed < 0 || raw.seed > 4294967295)
    throw new Error('Invalid region seed');
  let heightfield = null;
  if (raw.heightfield !== undefined) {
    const field = raw.heightfield;
    if (!field || field.rows !== 9 || field.columns !== 9 ||
        !Array.isArray(field.west) || !Array.isArray(field.east) ||
        field.west.length !== 81 || field.east.length !== 81 ||
        ![...field.west,...field.east].every(value =>
          typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 40))
      throw new Error('Invalid heightfield (expected 9x9 west/east grids in metres)');
    heightfield = {west:field.west.slice(),east:field.east.slice()};
  }
  return Object.freeze({id, biome:raw.biome, density, relief, tint,
    seed:raw.seed >>> 0, heightfield, source:'disk'});
}
export function sampleRegionHeight(descriptor,s,lat,start=descriptor.id*REGION_SIZE) {
  if (!descriptor.heightfield) return 0;
  const u=Math.max(0,Math.min(1,(s-start)/REGION_SIZE));
  const v=Math.max(0,Math.min(1,(Math.abs(lat)-90)/280));
  const data=lat<0?descriptor.heightfield.west:descriptor.heightfield.east;
  const a=u*8, b=v*8, x=Math.min(7,Math.floor(a)), y=Math.min(7,Math.floor(b));
  const fx=a-x, fy=b-y;
  const lerp=(a,b,t)=>a+(b-a)*t;
  const v0=lerp(data[x*9+y],data[(x+1)*9+y],fx);
  const v1=lerp(data[x*9+y+1],data[(x+1)*9+y+1],fx);
  // The inner road seam and longitudinal tile boundaries must remain exact.
  const fade=Math.pow(Math.sin(Math.PI*u),2)*v*v*(3-2*v);
  return lerp(v0,v1,fy)*fade;
}
export function validateIndex(raw) {
  if (!raw || raw.schema !== 'bluehour-region-v1' || !Array.isArray(raw.regions) ||
      raw.regions.length > 1024) throw new Error('Unsupported region index');
  const map = new Map();
  for (const item of raw.regions) {
    if (!item || !Number.isSafeInteger(item.id) || item.id < 0 || item.id > 10000000 ||
        typeof item.path !== 'string' ||
        !/^\.\/assets\/regions\/region_[0-9]{6,8}\.json$/.test(item.path) ||
        map.has(item.id)) throw new Error('Unsafe or duplicate region index entry');
    const encoded = String(item.id).padStart(6,'0');
    if (item.path !== `./assets/regions/region_${encoded}.json`)
      throw new Error('Region path does not match ID');
    map.set(item.id, item.path);
  }
  return map;
}
export async function fetchBoundedJSON(fetchImpl, path, limit, signal) {
  const response = await fetchImpl(path, {signal, cache:'default'});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('Payload too large');
  // Read incremental chunks with a byte cap. Do not allocate arbitrary JSON.
  let raw = '';
  if (response.body && response.body.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) throw new Error('Payload too large');
        raw += decoder.decode(value, {stream:true});
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
  } else {
    raw = await response.text();
    if (new TextEncoder().encode(raw).length > limit) throw new Error('Payload too large');
  }
  return JSON.parse(raw);
}

export class RegionDescriptorStore {
  constructor({fetchImpl = fetch, maxConcurrent = 2, cacheBytes = DEFAULT_CACHE_BYTES,
               onRegionReady = () => {}} = {}) {
    this.fetchImpl = fetchImpl;
    this.maxConcurrent = maxConcurrent;
    this.cacheBytes = cacheBytes;
    this.onRegionReady = onRegionReady;
    this.cache = new Map();
    this.cacheUsedBytes = 0;
    this.index = new Map();
    this.activeIDs = new Set();
    this.queue = [];
    this.pending = new Map();
    this.running = 0;
    this.loaded = 0;
    this.failures = 0;
    this.aborted = 0;
    this.hits = 0;
    this.ready = false;
    this._initialization = null;
  }
  initialize() {
    if (this._initialization) return this._initialization;
    this._initialization = fetchBoundedJSON(this.fetchImpl,
      './assets/regions/manifest.json', MAX_INDEX_BYTES).then(raw => {
        this.index = validateIndex(raw);
        this.ready = true;
        this.sync([...this.activeIDs]);
        return true;
      }).catch(error => {
        // Missing optional manifest is a supported procedural-world mode.
        this.ready = true;
        console.info('[Blue Hour] Region descriptors fallback to procedural:', error.message);
        return false;
      });
    return this._initialization;
  }
  get(id) {
    const record = this.cache.get(id);
    if (record) {
      this.cache.delete(id);
      this.cache.set(id, record);
      this.hits++;
      return record.value;
    }
    return fallbackRegion(id);
  }
  sync(ids) {
    this.activeIDs = new Set(ids.filter(id => Number.isSafeInteger(id) && id >= 0));
    for (const job of this.queue) {
      if (!this.activeIDs.has(job.id)) job.cancelled = true;
    }
    this.queue = this.queue.filter(job => !job.cancelled);
    for (const [id, active] of this.pending) {
      if (!this.activeIDs.has(id)) active.controller.abort();
    }
    if (this.ready) {
      const front = ids.length ? ids[Math.min(1, ids.length - 1)] : 0;
      for (const id of this.activeIDs) {
        if (!this.index.has(id) || this.cache.has(id) || this.pending.has(id) ||
            this.queue.some(job => job.id === id)) continue;
        this.queue.push({id, priority: -Math.abs(id - front), cancelled:false});
      }
      this.queue.sort((a,b) => b.priority - a.priority);
    }
    this.evict();
    this.pump();
  }
  pump() {
    while (this.running < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      if (job.cancelled || !this.activeIDs.has(job.id)) continue;
      const controller = new AbortController();
      this.pending.set(job.id, {controller});
      this.running++;
      const path = this.index.get(job.id);
      fetchBoundedJSON(this.fetchImpl, path, MAX_TILE_BYTES, controller.signal)
        .then(raw => {
          const value = validateRegion(job.id, raw);
          const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
          if (this.activeIDs.has(job.id)) {
            this.cache.set(job.id, {value, bytes});
            this.cacheUsedBytes += bytes;
            this.loaded++;
            this.onRegionReady(job.id, value);
          }
        }).catch(error => {
          if (controller.signal.aborted) this.aborted++;
          else { this.failures++; console.warn('[Blue Hour] Region failed:', job.id, error.message); }
        }).finally(() => {
          this.running--;
          this.pending.delete(job.id);
          this.evict();
          this.pump();
        });
    }
  }
  evict() {
    if (this.cacheUsedBytes <= this.cacheBytes) return;
    for (const [id,record] of this.cache) {
      if (this.cacheUsedBytes <= this.cacheBytes) break;
      if (this.activeIDs.has(id)) continue;
      this.cache.delete(id);
      this.cacheUsedBytes -= record.bytes;
    }
  }
  stats() {
    return {active:this.activeIDs.size, cached:this.cache.size,
      bytes:this.cacheUsedBytes, pending:this.running, queued:this.queue.length,
      loaded:this.loaded, failures:this.failures, aborted:this.aborted,
      files:this.index.size, cacheBytes:this.cacheBytes};
  }
  dispose() {
    for (const active of this.pending.values()) active.controller.abort();
    this.queue.length = 0;
    this.activeIDs.clear();
    this.cache.clear();
    this.cacheUsedBytes = 0;
  }
}
