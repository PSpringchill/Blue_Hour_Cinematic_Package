"""Static scene and installer validation; doesn't test actual GPU draw output."""
import json
import re
import struct
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

root = Path(__file__).resolve().parents[1]
s = (root / 'index.html').read_text()
assert s.count('<script type="module">') == 1
source = s.split('<script type="module">', 1)[1].split('</script>', 1)[0]
with tempfile.TemporaryDirectory() as scratch:
    d = Path(scratch)
    js = d / 'scene.mjs'
    js.write_text(source)
    subprocess.run(['node', '--check', str(js)], check=True)
    class Scan(HTMLParser):
        def __init__(self): super().__init__(); self.ids = []
        def handle_starttag(self, tag, attrs):
            self.ids.extend(v for k, v in attrs if k == 'id')
    scan=Scan(); scan.feed(s)
    assert len(scan.ids) == len(set(scan.ids))
    for target in ['scenery-button','scenery-status','forest-status','hydro-button',
                   'atmos-status','quality','time-button','canvas','start','speed']:
        assert target in scan.ids, target
    required = ['function terrainHash(', 'function terrainNoise(', 'function terrainFBM(',
                'function groundOffset(', 'const weatheredRock = weatheredRockGeometry()',
                'const sharedFernGeometry = fernGeometry()',
                'async function loadSceneryGLBs()',
                "fetch('./assets/scenery/manifest.json'", 'rebuildSceneryModels()',
                'applySceneryLOD()', 'function refreshSceneryLOD(',
                'function cycleSceneryMode()', 'refreshSceneryLOD();',
                'this.sceneryData = Object.fromEntries(', 'CFG.sceneryCounts.rock',
                "if (event.code === 'KeyN') cycleSceneryMode();", 'function updateHydrology(',
                'function updateReflection(', 'new SSRPass(', 'function stepVehicle(',
                'loadForestGLBs();', 'updateAtmosphericLighting(',
                'const rainMaterial', 'function updateHUD()']
    for snippet in required: assert snippet in source, snippet
    assert "geom.setDrawRange(group.start, group.count);" in source
    assert 'for (let row=0;row<2;row++) {' in source
    # Check ground noise is deterministic, finite, and continuous at chunk boundaries
    terrain = source[source.index('    function terrainHash('):source.index('    function geometryData()')]
    check = d/'terrain.cjs'
    check.write_text('const lerp=(a,b,t)=>a+(b-a)*t;'+
                     'const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));\n'+terrain+'''\n
    const road={bank:0.019};
    for (const lateral of [-80,-43,-17,-9,9,17,43,80]) {
      for (const s of [0,32,63.99999,64.00001,224,4096,8192]) {
        let y=groundOffset(road,s,lateral);
        if(!Number.isFinite(y))throw Error('NaN terrain');
        if(y!==groundOffset(road,s,lateral))throw Error('nondeterministic');
      }
      if(Math.abs(groundOffset(road,63.99999,lateral)-groundOffset(road,64.00001,lateral))>0.01)
        throw Error('chunk-height seam');
    }
    console.log('PASS terrain: continuity, determinism, finite heights');
    ''')
    subprocess.run(['node', str(check)], check=True)
    # Minimal synthetic static mesh; metadata test only, not GPU asset validity.
    doc = {'asset': {'version':'2.0'},
           'meshes': [{'primitives':[{'indices':0,'attributes':{'POSITION':1}}]}],
           'accessors':[{'count':3},{'count':3}]}
    payload = json.dumps(doc).encode(); payload += b' '*(-len(payload)%4)
    blob=struct.pack('<4sII',b'glTF',2,20+len(payload))
    blob+=struct.pack('<I4s',len(payload),b'JSON')+payload
    sample=d/'synthetic.glb';sample.write_bytes(blob)
    import importlib.util
    spec=importlib.util.spec_from_file_location('install_scenery',root/'install_scenery.py')
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    stats=mod.inspect_glb(sample)
    assert stats['triangles_estimate']==1
    # Test actual installer without writing into the distributed project folder.
    package=d/'package';package.mkdir()
    import shutil
    shutil.copyfile(root/'install_scenery.py',package/'install_scenery.py')
    subprocess.run([sys.executable,str(package/'install_scenery.py'),
                   '--rock',str(sample),'--fern',str(sample),'--license','CC0'],check=True)
    manifest=json.loads((package/'assets/scenery/manifest.json').read_text())
    assert [p['type'] for p in manifest['props']]==['rock','fern']
    assert all(p['sha256'] for p in manifest['props'])
    # Unknown external file references must not pass install validation.
    doc['images']=[{'uri':'https://not-allowed.example/texture.png'}]
    p=json.dumps(doc).encode();p+=b' '*(-len(p)%4)
    sample.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(p)) +
                       struct.pack('<I4s',len(p),b'JSON')+p)
    try: mod.inspect_glb(sample)
    except ValueError as exc: assert 'External images' in str(exc)
    else: raise AssertionError('Failed to reject external URL in GLB')
print('PASS v6: JS syntax, UI, terrain continuity, streamed-scene contracts, GLB security, installer')
