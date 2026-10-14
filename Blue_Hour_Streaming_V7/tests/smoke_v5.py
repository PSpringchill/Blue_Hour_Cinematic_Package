"""V5 contracts, shader hooks, controls, and preserved v4 systems.
No external Three.js downloads or WebGL context required.
"""
from pathlib import Path
from html.parser import HTMLParser
import re, subprocess, tempfile

root=Path(__file__).resolve().parents[1]
s=(root/'index.html').read_text()
class Scan(HTMLParser):
    def __init__(self): super().__init__(); self.ids=[]
    def handle_starttag(self,tag,attrs): self.ids += [v for k,v in attrs if k=='id']
scan=Scan();scan.feed(s)
assert len(scan.ids)==len(set(scan.ids)), 'Duplicate DOM IDs'
for target in ['time-button','beams-button','atmos-status','frame-status','hydro-button',
               'weather-button','forest-status','quality','reflection-button','speed','map']:
    assert target in scan.ids,target
src=s.split('<script type="module">',1)[1].split('</script>',1)[0]
for symbol in ['const lightPresets = [', 'const stars = new THREE.Points(',
               'function setTimePreset(', 'function updateAtmosphericLighting(',
               'const headlightMistGroup = new THREE.Group()',
               'const mistBeamGeometry = new THREE.CylinderGeometry(',
               'windUniforms.uWindTime.value = time;',
               'rainMaterial.uniforms.uHeadPos.value.copy(',
               'rainMaterial.uniforms.uHeadDir.value.copy(',
               'atmosphericBudgetReduced = averageFrameMS > 21;',
               'function framePacingSummary()',
               'function updateHydrology(', 'const ssrPass = new SSRPass(',
               'function refreshForestLOD(', 'function installScannedPBR(',
               'function stepVehicle(', 'function updateReflection(']:
    assert symbol in src, symbol
assert "if (event.code === 'KeyT') cycleTimePreset();" in src
assert "if (event.code === 'KeyG') setBeamToggle(!atmosphericScatteringEnabled);" in src
assert len(re.findall(r'\bname:\s*[\'\"](?:DAY|BLUE|NIGHT)[\'\"]',src))==3
for v in ['uHeadPos','uHeadDir','uHeadPower','uFogDensity','uNightFactor','uWindTime','uWindStrength']:
    assert src.count(v)>=3, v
# Shader signature must carry world coordinates to correctly light rain on curving roads.
assert 'vec3 w = (modelMatrix * vec4(p, 1.0)).xyz;' in src
assert 'uHeadDir * along' in src
assert 'player.root.updateMatrixWorld(true)' in src
assert 'Math.exp(-Math.max(0, dt) * 1.45)' in src
# Each mesh family reuses a single geometry and material, no new per-frame geometry.
assert src.count('new THREE.CylinderGeometry(2.9, 0.13, 27')==1
assert src.count('new THREE.ShaderMaterial({') >= 4
with tempfile.TemporaryDirectory() as directory:
    output=Path(directory)/'scene.mjs';output.write_text(src)
    subprocess.run(['node','--check',str(output)],check=True)
print('PASS v5: atmosphere, star depth, beams, light-aware rain, wind, UI, perf, v4 preservation, JS parser')
