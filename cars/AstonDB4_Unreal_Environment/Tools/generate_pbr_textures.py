"""Generates tileable, deterministic synthetic PBR surface maps for Unreal.
Not scanned photogrammetry: replace with high-res Fab/Megascans materials for final cinematic quality.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
R=Path(__file__).resolve().parents[1]/'Content'/'GeneratedTextures'
R.mkdir(parents=True,exist_ok=True)
S=768
rng=np.random.default_rng(14763)

def tile_noise(small, amplitude=1.0):
    # upscale multiple octaves with smooth interpolation and seamless opposite edges
    a=rng.normal(0,1,(small,small)).astype('float32')
    # Blend opposite sides around a wrap to make tile seams less visible.
    a=(a+np.roll(a,1,0)*.25+np.roll(a,1,1)*.25)/1.5
    im=Image.fromarray(a,mode='F').resize((S,S),Image.Resampling.BICUBIC)
    return np.asarray(im).astype('float32')*amplitude

def save(name,palette,roughness,metallic,normal_strength=1.0,speckle=0.015,wood=False):
    n=(tile_noise(4,.55)+tile_noise(16,.32)+tile_noise(85,.12))
    micro=rng.standard_normal((S,S)).astype('float32')*.38
    if wood:
        x=np.arange(S)[None,:];y=np.arange(S)[:,None]
        n=.65*np.sin((y+18*n)/4.4)+.23*np.sin((y+7*n)/.9)+micro*.11
    else: n+=micro
    n-=n.mean();n/=max(n.std(),.1)
    p=np.array(palette,dtype='float32')
    rgb=p[None,None,:]+n[...,None]*(speckle*255)
    if name=='Asphalt':
        grains=(rng.random((S,S))>.968)
        rgb+=grains[...,None]*rng.integers(16,48,(S,S,1))
        # mild tire wear along traffic lanes
        tire=np.cos(np.arange(S)[None,:]/40.)
        rgb-=np.clip(tire,0,1)[...,None]*2.5
    if name=='Stone':
        cracks=(np.abs(np.sin(np.arange(S)[:,None]/58+np.arange(S)[None,:]/84+3*n))>.985)
        rgb-=cracks[...,None]*12
    rgb=np.clip(rgb,0,255).astype('uint8')
    height=n*.003*normal_strength
    gy,gx=np.gradient(height)
    nn=np.stack((-gx,-gy,np.ones_like(gx)*.5),axis=-1)
    nn/=np.maximum(np.linalg.norm(nn,axis=-1,keepdims=True),1e-8)
    normal=np.clip((nn*.5+.5)*255,0,255).astype('uint8')
    rou=np.clip(roughness*255+28*n,2,253).astype('uint8')
    met=np.full((S,S),int(metallic*255),dtype='uint8')
    orm=np.stack((np.full_like(rou,255),rou,met),axis=-1)
    Image.fromarray(rgb,'RGB').save(R/f'T_{name}_BaseColor.png',optimize=True)
    Image.fromarray(normal,'RGB').save(R/f'T_{name}_Normal.png',optimize=True)
    Image.fromarray(orm,'RGB').save(R/f'T_{name}_ORM.png',optimize=True)
    print('created',name)

save('Asphalt',(36,38,40),.92,.01,2.3,0.09)
save('Ground',(76,90,64),.96,.0,2.2,0.14)
save('Gravel',(108,94,72),.94,.0,2.6,0.21)
save('Stone',(108,112,107),.92,.0,3.4,0.15)
save('Bark',(72,46,29),.96,.0,3.1,0.16,True)
save('Foliage',(28,77,44),.9,.0,2.2,0.15)
save('Wood',(115,57,24),.43,.0,2.2,0.16,True)
save('Leather',(21,19,17),.77,.0,1.3,0.04)
save('BrushedMetal',(126,132,135),.32,.86,1.6,0.07)
save('PaintCar',(28,104,63),.20,.64,.6,0.035)
save('Paint',(220,216,191),.85,.0,1.2,.05)
