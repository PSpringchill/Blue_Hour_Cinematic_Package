"""Dependency-free static project check (does not replace a visual browser test)."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from urllib.request import urlopen
import struct, json, re, subprocess, contextlib, os

root=Path(__file__).parent
web=(root/'index.html').read_text()
js=(root/'src/main.js').read_text()
assert all(f'{key}:false' in js for key in ('gas','brake','left','right'))
ids=set(re.findall(r'\bid="([^"]+)"', web))
uses=set(re.findall(r"\$\('([^']+)'\)", js))
assert uses<=ids, f'Missing DOM IDs: {uses-ids}'
with (root/'assets/aston_db4.glb').open('rb') as f:
    magic, version, byte_size, chunk_len, json_type=struct.unpack('<IIIII',f.read(20))
    doc=json.loads(f.read(chunk_len))
assert magic==0x46546C67 and version==2
assert byte_size==(root/'assets/aston_db4.glb').stat().st_size
assert {m['name'] for m in doc['meshes']}=={'CAR_BODY','FL_WHEEL','FR_WHEEL','RL_WHEEL','RR_WHEEL'}
assert 'EXT_meshopt_compression' in doc.get('extensionsUsed',[])
assert 'MeshoptDecoder' in js
subprocess.run(['node','--check',str(root/'src/main.js')],check=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
os.chdir(root)
server=ThreadingHTTPServer(('127.0.0.1',0),Quiet)
Thread(target=server.serve_forever,daemon=True).start()
try:
    for route in ['index.html','src/main.js','assets/aston_db4.glb']:
        with contextlib.closing(urlopen(f'http://127.0.0.1:{server.server_port}/{route}',timeout=4)) as r:
            assert r.status==200, route
            assert len(r.read())>0, route
    print('PASS: JavaScript syntax, DOM references, GLB asset / wheel nodes, HTTP serving')
finally:
    server.shutdown()
