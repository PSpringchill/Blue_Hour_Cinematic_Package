#!/usr/bin/env python3
"""Generate editable 256 m region heightfield/biome JSON assets and a safe manifest.
The sample heightfields are synthetic, not scanned terrain or survey data.
"""
import argparse, json, math, random
from pathlib import Path
BASE=Path(__file__).resolve().parent
OUTPUT=BASE/'assets'/'regions'
BIOMES=('pine','rocky','alpine','mist')
def create(start=0,count=16,seed=202608,overwrite=False):
    if start<0 or count<1 or count>128 or start+count>10_000_000:
        raise ValueError('Invalid region range (max 128 per batch)')
    OUTPUT.mkdir(parents=True,exist_ok=True)
    for id in range(start,start+count):
        target=OUTPUT/f'region_{id:06d}.json'
        if target.exists() and not overwrite:continue
        r=random.Random((seed^(id*0x9e3779b1))&0xffffffff)
        def field():
            return [round((r.random()-.5)*14 +3.3*math.sin(i*.8+j*.5),2)
                    for i in range(9) for j in range(9)]
        data={'id':id,'biome':BIOMES[(id//3)%len(BIOMES)],
              'seed':r.randrange(2**32),
              'heightfield':{'rows':9,'columns':9,'west':field(),'east':field()},
              'density':round(.58+r.random()*.32,4),
              'relief':round(.60+r.random()*.76,4),
              'tint':round((r.random()-.5)*.18,4)}
        target.write_text(json.dumps(data,indent=2)+'\n',encoding='utf8')
    entries=[]
    for path in sorted(OUTPUT.glob('region_*.json')):
        try:
            id=json.loads(path.read_text(encoding='utf8'))['id']
            if not isinstance(id,int) or id<0 or id>10000000:continue
            if path.name!=f'region_{id:06d}.json':continue
            entries.append({'id':id,'path':f'./assets/regions/{path.name}'})
        except (ValueError,KeyError,TypeError):continue
    if len(entries)>1024:raise ValueError('Index max is 1024. Remove unused tiles.')
    manifest={'schema':'bluehour-region-v1','regions':entries}
    (OUTPUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return len(entries)
if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--start',type=int,default=0)
    a.add_argument('--count',type=int,default=16)
    a.add_argument('--seed',type=int,default=202608)
    a.add_argument('--overwrite',action='store_true')
    args=a.parse_args()
    print('Region descriptors installed:',create(args.start,args.count,args.seed,args.overwrite))
