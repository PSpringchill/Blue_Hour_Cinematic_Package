"""Static v7 integration contracts; runtime WebGL requires a browser test."""
from pathlib import Path
from html.parser import HTMLParser
import subprocess,tempfile
root=Path(__file__).resolve().parents[1]
s=(root/'index.html').read_text()
class Scan(HTMLParser):
    def __init__(self): super().__init__();self.ids=[]
    def handle_starttag(self,tag,attrs):self.ids.extend(v for k,v in attrs if k=='id')
scan=Scan();scan.feed(s)
assert len(scan.ids)==len(set(scan.ids))
for id in ['stream-button','stream-panel','stream-details','stream-status','forest-status','scenery-status']:
    assert id in scan.ids
source=s.split('<script type="module">',1)[1].split('</script>',1)[0]
for needle in ["import { KTX2Loader }", "import { DRACOLoader }", "import { MeshoptDecoder }",
               'function makeStreamingGLTFLoader()', 'const streamManager = {',
               'maxConcurrent: MOBILE ? 1 : 2', 'safeLocalAssetPath(',
               'function beginEnvironmentStreaming()', 'beginEnvironmentStreaming();',
               "if (event.code === 'KeyB') toggleStreamPanel();", 'function renderWithDiagnostics(',
               'EXT_disjoint_timer_query_webgl2', 'function updateStreamDiagnostics()',
               'new GLTFLoader()', 'streamManager.enqueue(', 'function updateReflection(']:
    assert needle in source,needle
with tempfile.TemporaryDirectory() as td:
    path=Path(td)/'scene.mjs';path.write_text(source)
    subprocess.run(['node','--check',str(path)],check=True)
print('PASS v7 syntax, decoder configuration, streaming priority, optional GPU timing, controls')
