"""Static/offline integration checks; does not verify GPU output."""
import json
import re
import shutil
import struct
import subprocess
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
s = (ROOT / 'index.html').read_text()

class HTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
    def handle_starttag(self, tag, attrs):
        self.ids.update(v for k, v in attrs if k == 'id' and v)

h = HTML()
h.feed(s)
required = ('canvas', 'quality', 'reflection-button', 'reflection-status', 'forest-status',
            'speed', 'position', 'model-file', 'weather-button', 'map', 'start')
assert all(x in h.ids for x in required)
assert s.count('<script type="module">') == 1
source = s.split('<script type="module">', 1)[1].split('</script>', 1)[0]
for component in ('new SSRPass(', 'ssrPass.setSize(', 'composer.insertPass(ssrPass, 1)',
                  'const baseRenderPass', 'new Reflector(', 'refreshForestLOD(',
                  'colorComponents: 4', 'const blendedGravel', 'const blendedMud',
                  "updateGeometry(this.gravelBlend.geometry, blendedGravel)",
                  "updateGeometry(this.mudBlend.geometry, blendedMud)",
                  'function stepVehicle(', 'function maintainTrack(', 'GLTFLoader',
                  'function updateReflection(', 'sizeSSR()', 'function setQuality('):
    assert component in source, component
with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    mjs = td / 'scene.mjs'
    mjs.write_text(source)
    subprocess.run(['node', '--check', str(mjs)], check=True)
    # Minimal real GLB2 JSON chunk with one static indexed triangle mesh.
    payload = json.dumps({
        'asset': {'version': '2.0'},
        'meshes': [{'primitives': [{'indices': 0, 'attributes': {'POSITION': 1}}]}],
        'accessors': [{'count': 3}, {'count': 3}]
    }).encode()
    payload += b' ' * (-len(payload) % 4)
    data = struct.pack('<4sII', b'glTF', 2, 20 + len(payload)) + struct.pack('<I4s', len(payload), b'JSON') + payload
    asset = td / 'sample-tree.glb'
    asset.write_bytes(data)
    target = td / 'project'
    (target / 'assets').mkdir(parents=True)
    shutil.copyfile(ROOT / 'install_forest.py', target / 'install_forest.py')
    subprocess.run(['python3', str(target / 'install_forest.py'), str(asset), '--license', 'CC0'], check=True)
    manifest = json.loads((target / 'assets/models/manifest.json').read_text())
    assert len(manifest['trees']) == 1
    assert manifest['trees'][0]['sha256'] and manifest['trees'][0]['license'] == 'CC0'
    print('PASS: static source contracts, Node syntax, HTML targets, GLB installer & manifest')
