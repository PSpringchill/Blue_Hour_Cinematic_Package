"""Offline structural verification (NOT an Unreal Editor compile or playtest)."""
from pathlib import Path
import json,struct,re,sys
root=Path(__file__).resolve().parents[1]
prj=json.loads((root/'AstonDB4.uproject').read_text())
assert any(x['Name']=='ProceduralMeshComponent' and x['Enabled'] for x in prj['Plugins'])
assert (root/'Source'/'AstonDB4'/'DB4VehiclePawn.cpp').exists()
assert len(list((root/'Content'/'GeneratedTextures').glob('*.png')))==33
for f in sorted((root/'Import').glob('*.glb')):
    with f.open('rb') as z:
        magic,ver,n=struct.unpack('<III',z.read(12))
        assert magic==0x46546C67 and ver==2 and n==f.stat().st_size,(f,n)
        count,typ=struct.unpack('<II',z.read(8));meta=json.loads(z.read(count))
    assert len(meta['meshes'])==1 and meta['meshes'][0]['name']==f.stem
    assert len(meta['images'])==3
    print('OK GLB',f.stem,f.stat().st_size//1024,'KiB')
assert len(list((root/'Import').glob('*.glb')))==5
for src in (root/'Source'/'AstonDB4').glob('*.cpp'):
    text=src.read_text(); assert not re.search(r'\bTODO\b',text)
print('PASS: project metadata, source presence, texture counts, independent GLB structural integrity')
print('NOT VERIFIED: Unreal header compatibility, native compilation, runtime controls, rendering or performance')
