from pathlib import Path
import json,re,subprocess,tempfile,shutil
root=Path(__file__).resolve().parents[1]
h=(root/'index.html').read_text()
assert 'V8_REGION_WORLD_START' in h and 'V8_REGION_WORLD_END' in h
for mark in ['regionStore.initialize()', 'maintainRegions()', 'sampleRegionHeight(descriptor',
             'regionTiles', 'regionStats.geometryBytes', 'id="world-button"',
             'id="region-status"',"KeyJ",'REGION_POOL_COUNT = 8',
             'regionForestMaterial = materials.ground',
             'this.ground.geometry=makeRegionTerrain',
             'this.root.visible=false',
             'for (const tile of regionTiles) {']:
    assert mark in h, mark
assert h.index('      maintainTrack();\n      maintainRegions();') < h.index('      updateCarVisuals();\n      updateCamera(dt);')
assert h.count('function maintainRegions()')==1
assert h.count('V8_REGION_WORLD_START')==1
assert len(list((root/'assets/regions').glob('region_*.json'))) >= 16
index=json.loads((root/'assets/regions/manifest.json').read_text())
assert index['schema']=='bluehour-region-v1'
assert len(index['regions'])==16
for entry in index['regions']:
    p=root/entry['path'].removeprefix('./')
    region=json.loads(p.read_text())
    assert region['id']==entry['id']
    assert len(region['heightfield']['west'])==81
    assert len(region['heightfield']['east'])==81
    assert p.stat().st_size<16384
s=h.split('<script type="module">')[-1].split('</script>')[0]
with tempfile.TemporaryDirectory() as d:
    js=Path(d)/'src.mjs';js.write_text(s)
    subprocess.run(['node','--check',str(js)],check=True,capture_output=True)
    subprocess.run(['node','--check',str(root/'region_world.mjs')],check=True,capture_output=True)
    sandbox=Path(d)/'project';sandbox.mkdir();shutil.copy(root/'install_regions.py',sandbox)
    subprocess.run(['python3',str(sandbox/'install_regions.py'),'--start','40','--count','2'],check=True,capture_output=True)
    valid=json.loads((sandbox/'assets/regions/manifest.json').read_text())
    assert [x['id'] for x in valid['regions']]==[40,41]
print('PASS v8 HTML source, stream hooks, origin rebase, bounded tile pool, region index and installer')
