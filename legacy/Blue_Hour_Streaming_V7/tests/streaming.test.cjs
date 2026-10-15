'use strict';
// Node-only deterministic exercise of the actual inline asset-stream manager.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const s = fs.readFileSync(require('node:path').resolve(__dirname,'../index.html'),'utf8');
const a = s.indexOf('    const streamManager = {');
const b = s.indexOf('    let streamPanelOpen = false;',a);
assert(a !== -1 && b > a);
const code = s.slice(a,b)+'\n({streamManager,safeLocalAssetPath})';
const {streamManager: manager, safeLocalAssetPath:safe} = vm.runInNewContext(code,{MOBILE:false,Promise,RegExp});
assert(safe('./assets/textures/road_color.ktx2','textures','(?:png|ktx2)'));
assert(!safe('https://evil.example/x.ktx2','textures','(?:png|ktx2)'));
assert(!safe('./assets/textures/../../evil.ktx2','textures','(?:png|ktx2)'));
assert(!safe('./assets/scenery/foo.glb','textures','(?:png|ktx2)'));
const tick = () => new Promise(resolve => setImmediate(resolve));
(async() => {
 let running=0, peak=0;
 let resolvers=[];
 const job=name => () => new Promise(resolve => {
   running++; peak=Math.max(peak,running);
   resolvers.push(() => {running--;resolve(name)});
 });
 const p1=manager.enqueue('1',5,job('1'),100);
 const p2=manager.enqueue('2',5,job('2'),200);
 const p3=manager.enqueue('3',1,job('3'),300);
 const p4=manager.enqueue('4',9,job('4'),400);
 const dedup=manager.enqueue('3',1,job('never'));
 assert.equal(p3,dedup,'deduplicates in-flight work');
 await tick();assert.equal(running,2);assert.equal(manager.waiting.length,2);
 resolvers.shift()();await tick();await tick();
 assert.equal(running,2);assert(manager.waiting.some(j=>j.key==='3'),'higher priority runs first');
 // Drain asynchronously. These resolutions can start more jobs via microtasks.
 for(let i=0;i<4;i++) {if(resolvers.length) resolvers.shift()();await tick();await tick();}
 const results=await Promise.all([p1,p2,p3,p4]);
 assert.deepEqual(results,['1','2','3','4']);
 assert.equal(peak,2);
 assert.equal(manager.completed,4);
 assert.equal(manager.completedBytes,1000);
 assert.equal(manager.waiting.length,0);
 assert.equal(manager.active,0);
 try{ await manager.enqueue('fails',0,()=>Promise.reject(new Error('expected')));assert.fail('should reject'); }
 catch(e){ assert.equal(e.message,'expected'); }
 assert.equal(manager.failed,1);
 console.log('PASS v7 bounded stream queue: priorities, in-flight de-dup, failures, local URL safety');
})().catch(e=>{console.error(e);process.exitCode=1});
