#!/usr/bin/env python3
"""Install Poly Haven PBR ZIP texture sets without external Python dependencies.
Usage: python3 install_pbr.py PATH_TO_ASPHALT_ZIP PATH_TO_FOREST_GROUND_ZIP
Input may be a directory containing extracted texture maps, or a ZIP file.
"""
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / 'assets' / 'textures'
EXT = {'.png', '.jpg', '.jpeg', '.webp'}

def candidates(names, kind):
    result=[]
    for name in names:
        p=Path(name)
        if p.suffix.lower() not in EXT: continue
        stem=p.stem.lower()
        if kind=='color':
            valid=bool(re.search(r'(^|_)(diff|albedo|basecolor|color|col)(_|$)',stem))
        elif kind=='normal':
            valid=bool(re.search(r'(^|_)(nor_gl|normal_gl|normal_opengl)(_|$)',stem))
        else:
            valid=bool(re.search(r'(^|_)(rough)(_|$)',stem))
            valid=valid and not any(tag in stem for tag in ('rough_ao','roughao','arm','metal','ao_rough'))
        if not valid:continue
        # prefer 2K JPG, then 1K, then 4K, then 8K; don't downsample high-res textures here
        order={'2k':0,'1k':1,'4k':2,'8k':3}
        resolution=next((v for k,v in order.items() if re.search(r'(^|_)'+k+r'(_|$)',stem)),4)
        filetype={'.jpg':0,'.jpeg':0,'.webp':1,'.png':2}[p.suffix.lower()]
        result.append(((resolution,filetype,len(name)),name))
    return [x for _,x in sorted(result)]

def install(kind, path):
    path=Path(path).expanduser().resolve()
    if not path.exists(): raise FileNotFoundError(path)
    iszip=zipfile.is_zipfile(path)
    archive=zipfile.ZipFile(path) if iszip else None
    if archive:
        names=[n for n in archive.namelist() if not n.endswith('/')]
    elif path.is_dir():
        names=[str(p.relative_to(path)) for p in path.rglob('*') if p.is_file()]
    else:
        raise ValueError('Expected a Poly Haven .zip or extracted texture folder: '+str(path))
    folder=TARGET/kind
    folder.mkdir(parents=True,exist_ok=True)
    mappings={}
    for role in ('color','normal','roughness'):
        options=candidates(names,role)
        if not options: raise ValueError(f'Missing {role} map in {path}. Please download Diffuse, Normal(GL) and Rough maps.')
        picked=options[0]
        outfile=folder / (role+Path(picked).suffix.lower())
        with (archive.open(picked) if archive else open(path/picked,'rb')) as src, open(outfile,'wb') as dest:
            shutil.copyfileobj(src,dest)
        mappings[role]='./assets/textures/'+kind+'/'+outfile.name
        print(f'  {role:9s}: {picked} -> {outfile.relative_to(ROOT)}')
    if archive: archive.close()
    return mappings

def main():
    if len(sys.argv)!=3:
        print(__doc__)
        sys.exit(2)
    print('Installing scanned asphalt:')
    road=install('road',sys.argv[1]); print('Installing scanned forest floor:')
    forest=install('forest',sys.argv[2])
    manifest={'road':road,'forest':forest}
    (TARGET/'manifest.json').write_text(json.dumps(manifest,indent=2))
    print('Installed materials. Open index.html through a local web server.')
if __name__=='__main__': main()
