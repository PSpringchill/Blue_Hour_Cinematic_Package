"""KTX2 tool smoke test; does not decode Basis texture payload or use a GPU."""
from pathlib import Path
import tempfile,subprocess,sys,json,struct,importlib.util,shutil
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('ktx2',root/'install_ktx2.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
with tempfile.TemporaryDirectory() as td:
    d=Path(td)
    texture=d/'asset.ktx2'
    hdr=mod.KTX2_MAGIC+struct.pack('<9I',0,1,512,512,0,0,1,1,1)+b'\0'*(80-48)
    texture.write_bytes(hdr+b'fake basis payload')
    assert mod.inspect_ktx2(texture)['width']==512
    root2=d/'package';root2.mkdir();shutil.copyfile(root/'install_ktx2.py',root2/'install_ktx2.py')
    subprocess.run([sys.executable,str(root2/'install_ktx2.py'), '--road',*[str(texture)]*3,
                    '--license','CC0'],check=True)
    mf=json.loads((root2/'assets/textures/manifest.json').read_text())
    assert all(mf['road'][k].endswith('.ktx2') for k in ('color','normal','roughness'))
    assert all(len(mf['road'][k+'_sha256'])==64 for k in ('color','normal','roughness'))
    texture.write_bytes(b'corrupt container')
    try: mod.inspect_ktx2(texture)
    except ValueError: pass
    else: raise AssertionError('corrupt KTX2 was accepted')
print('PASS KTX2 header validation, installer manifest, digest, corrupt rejection')
