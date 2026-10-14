"""Static v4 integration verification; no remote modules and no GPU rendering."""
from pathlib import Path
from html.parser import HTMLParser
import subprocess, tempfile
root=Path(__file__).resolve().parents[1]
s=(root/'index.html').read_text()
class IDs(HTMLParser):
    def __init__(self): super().__init__();self.ids=[]
    def handle_starttag(self,tag,attrs): self.ids.extend(v for k,v in attrs if k=='id')
h=IDs();h.feed(s)
assert len(h.ids)==len(set(h.ids)), 'duplicate HTML id'
for name in ['hydro-button','hydro-status','perf-status','weather-button','reflection-button',
             'start','speed','map','forest-status','lens-rain','quality']:
    assert name in h.ids, name
assert s.count('<script type="module">')==1
source=s.split('<script type="module">',1)[1].split('</script>',1)[0]
for token in ['class HydroGrid','function updateHydrology(', 'attribute float aWater;',
              'roughnessFactor = mix(roughnessFactor', 'function updateTireWakes(',
              'function stepVehicle(', 'function updateReflection(',
              'function maintainTrack(', 'const ssrPass = new SSRPass(',
              'const chunks = Array.from', 'function refreshForestLOD(',
              'function installScannedPBR(', 'updateHydrology(0);',
              'colorComponents: 4', 'GLTFLoader', 'setQuality(']:
    assert token in source,token
assert source.count('const WATER_LANES = ')==1
assert source.count('new THREE.BufferAttribute(new Float32Array(vertices), 1)')==1
assert source.count('shader.vertexShader = shader.vertexShader')==1
assert source.count('shader.fragmentShader = shader.fragmentShader')==1
with tempfile.TemporaryDirectory() as td:
    module=Path(td)/'scene.mjs';module.write_text(source)
    subprocess.run(['node','--check',str(module)],check=True)
subprocess.run(['node',str(root/'tests/hydrology.test.cjs')],check=True)
print('PASS: v4 HTML ids, water shader hooks, geometry fields, physics, SSR, preserved game, syntax')
