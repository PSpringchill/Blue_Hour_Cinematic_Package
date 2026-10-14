"""Split source Aston DB4 GT Zagato GLB into independently importable meshes.
Preserves full original geometry, normals, UVs, metallic-roughness maps, and normal maps.
Uses only Python standard library; no geometry downsampling.
"""
from pathlib import Path
import json, struct, copy, sys

SOURCE=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]/'aston_db4_raw.glb'
DEST=Path(sys.argv[2]) if len(sys.argv)>2 else Path(__file__).resolve().parents[1]/'Import'
DEST.mkdir(parents=True,exist_ok=True)
with SOURCE.open('rb') as f:
    magic,ver,total=struct.unpack('<III',f.read(12))
    assert magic == 0x46546C67 and ver==2
    jlen,jtype=struct.unpack('<II',f.read(8));assert jtype==0x4E4F534A
    doc=json.loads(f.read(jlen))
    blen,btype=struct.unpack('<II',f.read(8));assert btype==0x004E4942
    data=f.read(blen)

for mesh in doc['meshes']:
    name=mesh['name']
    prim=mesh['primitives'][0]
    old_mat=prim['material']
    # Same GLB contains two PBR materials with three texture references each.
    mat=copy.deepcopy(doc['materials'][old_mat])
    source_tex_ids=[mat['normalTexture']['index'],mat['pbrMetallicRoughness']['baseColorTexture']['index'],mat['pbrMetallicRoughness']['metallicRoughnessTexture']['index']]
    # Collect required accessors and images, then repack only referenced bufferViews.
    old_accessors=list(prim['attributes'].values())+[prim['indices']]
    old_images=[doc['textures'][i]['source'] for i in source_tex_ids]
    old_views=[doc['accessors'][i]['bufferView'] for i in old_accessors]+[doc['images'][i]['bufferView'] for i in old_images]
    packed=bytearray();new_views=[]
    for view_index in old_views:
        view=doc['bufferViews'][view_index]
        while len(packed)%4:packed.append(0)
        offset=len(packed); start=view.get('byteOffset',0);n=view['byteLength'];packed.extend(data[start:start+n])
        v={'buffer':0,'byteOffset':offset,'byteLength':n}
        for k in ('target','byteStride'): 
            if k in view:v[k]=view[k]
        new_views.append(v)
    accessors=[]
    for ai,old_index in enumerate(old_accessors):
        a=copy.deepcopy(doc['accessors'][old_index]);a['bufferView']=ai;accessors.append(a)
    attrs={key:i for i,key in enumerate(prim['attributes'])}
    np={'attributes':attrs,'indices':len(attrs),'material':0,'mode':4}
    new_images=[]
    for ti,img_index in enumerate(old_images):
        im=copy.deepcopy(doc['images'][img_index]);im['bufferView']=len(old_accessors)+ti
        new_images.append(im)
    mat['normalTexture']['index']=0
    mat['pbrMetallicRoughness']['baseColorTexture']['index']=1
    mat['pbrMetallicRoughness']['metallicRoughnessTexture']['index']=2
    out={'asset':{'version':'2.0','generator':'DB4 Unreal GLB splitter'},'scene':0,
         'scenes':[{'nodes':[0]}], 'nodes':[{'name':name,'mesh':0}],
         'meshes':[{'name':name,'primitives':[np]}],
         'materials':[mat], 'accessors':accessors,'bufferViews':new_views,
         'buffers':[{'byteLength':len(packed)}], 'images':new_images,
         'samplers':[{'magFilter':9729,'minFilter':9987}],
         'textures':[{'sampler':0,'source':i} for i in range(3)]}
    json_bytes=json.dumps(out,separators=(',',':')).encode()
    json_bytes+=b' ' *(-len(json_bytes)%4)
    packed.extend(b'\0'*(-len(packed)%4))
    dst=DEST/(name+'.glb')
    with dst.open('wb') as f:
        f.write(struct.pack('<III',0x46546C67,2,12+8+len(json_bytes)+8+len(packed)))
        f.write(struct.pack('<II',len(json_bytes),0x4E4F534A));f.write(json_bytes)
        f.write(struct.pack('<II',len(packed),0x004E4942));f.write(packed)
    print(name,round(dst.stat().st_size/1e6,1),'MB')
