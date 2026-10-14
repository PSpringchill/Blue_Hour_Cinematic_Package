#!/usr/bin/env python3
"""Install one transparent RGBA PNG 4-column tree atlas into Blue Hour v9.
Each cell is a complete portrait tree with transparent background and trunk at bottom.
"""
import argparse, json, hashlib, shutil
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parent

def install(file:Path,license:str,source:str='user supplied',target_root=ROOT):
    if not file.is_file() or file.suffix.lower()!='.png':raise ValueError('Input must be an existing PNG')
    if file.stat().st_size>16*1024*1024:raise ValueError('Atlas exceeds 16 MiB')
    with Image.open(file) as im:
        im.verify()
    with Image.open(file) as im:
        width,height=im.size
        if im.mode!='RGBA':raise ValueError('RGBA (with alpha channel) required')
        if width!=height*4 or height<128 or height>2048:
            raise ValueError('Expected horizontal 4x1 atlas: width=4*height, cell 128..2048 px')
        alpha=im.getchannel('A')
        extrema=alpha.getextrema()
        if extrema[0]>=255:raise ValueError('Atlas must contain transparency')
    if not license.strip() or len(license)>120:raise ValueError('Provide verified license text')
    if len(source)>300:raise ValueError('Source metadata too long')
    target=target_root/'assets'/'impostors'
    target.mkdir(parents=True,exist_ok=True)
    outfile=target/'forest_atlas.png'
    shutil.copy2(file,outfile)
    data={'schema':'bluehour-impostor-atlas-v1','path':'./assets/impostors/forest_atlas.png',
          'columns':4,'rows':1,'colorSpace':'srgb','alphaMode':'mask',
          'license':license,'source':source,
          'sha256':hashlib.sha256(outfile.read_bytes()).hexdigest(),
          'width':width,'height':height}
    (target/'manifest.json').write_text(json.dumps(data,indent=2)+'\n')
    return data

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('png',type=Path)
    p.add_argument('--license',required=True)
    p.add_argument('--source',default='user supplied')
    a=p.parse_args()
    result=install(a.png,a.license,a.source)
    print('Installed',result['columns'],'tree sprite species; review assets/impostors/manifest.json')
