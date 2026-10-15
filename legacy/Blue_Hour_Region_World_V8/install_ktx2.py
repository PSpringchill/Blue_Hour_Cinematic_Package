#!/usr/bin/env python3
"""Install user-supplied Basis Universal KTX2 PBR maps (does not encode images).

Usage:
  python3 install_ktx2.py --road albedo.ktx2 normal.ktx2 roughness.ktx2
  python3 install_ktx2.py --forest albedo.ktx2 normal.ktx2 roughness.ktx2

Must supply every map for each selected material. Use OpenGL (+Y) normal maps.
The KTX2 container header is validated, not the full Basis/texture payload.
The project loads and transcodes files in the browser using Three.js KTX2Loader.
"""
import argparse
import hashlib
import json
import re
import shutil
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'assets' / 'textures'
MATERIALS = ('road','forest','gravel','mud','rock')
SLOTS = ('color','normal','roughness')
KTX2_MAGIC = b'\xabKTX 20\xbb\r\n\x1a\n'
MAX_BYTES = 48 * 1024 * 1024
MAX_RESOLUTION = 4096

def inspect_ktx2(path):
    """Conservative structural checks; cannot prove a complete valid Basis stream."""
    size = path.stat().st_size
    if size < 80 or size > MAX_BYTES:
        raise ValueError(f'{path.name}: KTX2 byte length outside 80..{MAX_BYTES}')
    with path.open('rb') as inp:
        header = inp.read(48)
    if header[:12] != KTX2_MAGIC:
        raise ValueError(f'{path.name}: invalid KTX2 magic')
    vk_format, type_size, width, height, depth, layers, faces, levels, compression = \
        struct.unpack_from('<9I',header,12)
    if width < 1 or height < 1 or width > MAX_RESOLUTION or height > MAX_RESOLUTION:
        raise ValueError(f'{path.name}: unreasonable resolution {width}x{height}')
    if depth > 1 or layers > 1 or faces != 1 or levels < 1 or levels > 14:
        raise ValueError(f'{path.name}: expected 2D single-layer non-cubemap mipmapped texture')
    if vk_format != 0 or compression not in (0,1,2):
        raise ValueError(f'{path.name}: requires BasisU ETC1S/UASTC (vkFormat=0)')
    return {'width':width,'height':height,'levels':levels,'bytes':size,
            'supercompression':compression}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    for key in MATERIALS:
        parser.add_argument('--'+key,nargs=3,metavar=('ALBEDO','NORMAL_GL','ROUGHNESS'),
                            help=f'3 pre-encoded Basis Universal KTX2 files for {key}')
    parser.add_argument('--license',default='unspecified',help='License you verified for the supplied maps')
    parser.add_argument('--source',default='',help='Original asset page URL (for provenance)')
    args=parser.parse_args(argv)
    selected = {key:getattr(args,key) for key in MATERIALS if getattr(args,key)}
    if not selected: parser.error('Provide --road, --forest, --gravel, --mud, or --rock')
    if args.source and not args.source.startswith(('https://','http://')):
        parser.error('Source must be a web URL')
    # Validate every supplied file before copying any file or updating manifest.
    inventory={}
    for kind, paths in selected.items():
        inventory[kind]={}
        for slot, source in zip(SLOTS,paths):
            inp=Path(source).expanduser().resolve()
            if not inp.is_file() or inp.suffix.lower()!='.ktx2':
                raise ValueError(f'{inp}: expected local .ktx2 file')
            stats=inspect_ktx2(inp)
            inventory[kind][slot]=(inp,stats)
    OUT.mkdir(parents=True,exist_ok=True)
    manifest_file=OUT/'manifest.json'
    manifest=json.loads(manifest_file.read_text()) if manifest_file.is_file() else {}
    for kind, textures in inventory.items():
        entry={}
        for slot,(src,stats) in textures.items():
            clean=re.sub(r'[^a-zA-Z0-9_-]','_',src.stem)[:36]
            out=OUT/f'{kind}_{slot}_{clean}.ktx2'
            if src!=out: shutil.copyfile(src,out)
            with out.open('rb') as inp:
                sha=hashlib.file_digest(inp,'sha256').hexdigest()
            entry[slot]='./assets/textures/'+out.name
            entry[slot+'_sha256']=sha
            entry[slot+'_stats']=stats
        entry['license']=args.license
        entry['source']=args.source
        manifest[kind]=entry
        print(f'{kind}: installed 3 KTX2 maps, preserving other material slots')
    manifest_file.write_text(json.dumps(manifest,indent=2)+'\n')
    print('Wrote',manifest_file)
    if args.license=='unspecified':
        print('WARNING: Verify the asset license before redistribution.')
    print('KTX2 headers verified; actual Basis transcoding still requires browser testing.')

if __name__=='__main__': main()
