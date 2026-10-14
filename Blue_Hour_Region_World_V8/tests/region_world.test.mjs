import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {REGION_SIZE,regionHash,fallbackRegion,validateRegion,validateIndex,
  sampleRegionHeight,RegionDescriptorStore,fetchBoundedJSON} from '../region_world.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(path.join(root,'assets/regions/manifest.json'),'utf8'));
const index=validateIndex(manifest);
assert.equal(REGION_SIZE,256);
assert.equal(index.size,16);
assert.equal(regionHash(400),regionHash(400));
assert.deepEqual(fallbackRegion(150),fallbackRegion(150));
assert.equal(fallbackRegion(150).source,'procedural');
const desc=validateRegion(0, JSON.parse(readFileSync(path.join(root,'assets/regions/region_000000.json'))));
assert.equal(desc.heightfield.west.length,81);
assert.ok(Math.abs(sampleRegionHeight(desc,0,220))<1e-9);
assert.ok(Math.abs(sampleRegionHeight(desc,128,90))<1e-9);
assert.ok(Math.abs(sampleRegionHeight(desc,256,220))<1e-9);
assert.ok(Number.isFinite(sampleRegionHeight(desc,128,-270)));
assert.notEqual(sampleRegionHeight(desc,128,-270),0);
assert.throws(()=>validateIndex({schema:'bluehour-region-v1',regions:[{id:2,path:'https://example.com/x'}]}));
assert.throws(()=>validateIndex({schema:'bluehour-region-v1',regions:[{id:2,path:'./assets/regions/region_000003.json'}]}));
assert.throws(()=>validateRegion(1,{...desc,id:1,heightfield:{rows:9,columns:9,west:[NaN],east:[]}}));
assert.throws(()=>validateRegion(0,{...desc,heightfield:{rows:9,columns:9,west:Array(81).fill(41),east:Array(81).fill(0)}}));
let concurrency=0, peak=0, cancelled=0;
const fetchMock = (url,{signal}={})=>new Promise((resolve,reject)=>{
  let payload;
  if(url==='./assets/regions/manifest.json') payload=manifest;
  else { const id=Number(url.match(/region_(\d+)\.json/)[1]);payload=JSON.parse(readFileSync(path.join(root,'assets/regions',`region_${String(id).padStart(6,'0')}.json`))); }
  concurrency++;peak=Math.max(peak,concurrency);
  const timeout=setTimeout(()=>{
    concurrency--;
    resolve({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(payload)});
  }, url.includes('manifest')?1:18);
  signal?.addEventListener('abort',()=>{clearTimeout(timeout);concurrency--;cancelled++;reject(new Error('aborted'));},{once:true});
});
const ready=[];
const manager=new RegionDescriptorStore({fetchImpl:fetchMock,maxConcurrent:2,cacheBytes:3600,
  onRegionReady:(id,desc)=>ready.push({id,source:desc.source})});
manager.sync([0,1,2,3,4]);
assert.equal(await manager.initialize(),true);
assert.ok(manager.stats().pending<=2);
await new Promise(r=>setTimeout(r,10));
manager.sync([6,7,8]);
await new Promise(r=>setTimeout(r,100));
assert.ok(peak<=2,`Peak requests ${peak}`);
assert.ok(manager.stats().aborted>=1,'pending request cancelled when player advances');
assert.ok(cancelled>=1);
assert.ok(ready.every(({id})=>[6,7,8].includes(id)),'no out-of-date callbacks');
assert.equal(manager.get(7).source,'disk');
assert.equal(manager.get(300).source,'procedural');
manager.sync([]);
assert.ok(manager.stats().bytes<=3600,'unreferenced descriptors evicted');
manager.dispose();
assert.equal(manager.stats().pending,0);
const huge='X'.repeat(16600);
await assert.rejects(()=>fetchBoundedJSON(async()=>({ok:true,headers:{get:()=>null},text:async()=>huge}),'/x',16384),/Payload too large/);
console.log('PASS v8 region store: descriptor validation, 9x9 samples, seams, max concurrency, cancellation, stale callbacks, budget and fallback');
