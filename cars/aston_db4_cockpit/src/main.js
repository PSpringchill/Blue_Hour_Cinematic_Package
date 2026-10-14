import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// DB4 GT Zagato coordinate contract: +X front, +Y up, +Z passenger/right.
// The enclosed GLB has a CAR_BODY mesh and four independent wheel meshes.
const $ = id => document.getElementById(id);
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const DEG = 180 / Math.PI;
const TAU = Math.PI * 2;
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9abbd0');
scene.fog = new THREE.FogExp2('#a5c3d4', .0021);

const camera = new THREE.PerspectiveCamera(72, 1, .035, 1350);
const body = new THREE.Group();
scene.add(body);
const cockpit = new THREE.Group();
body.add(cockpit);
const cameraMount = new THREE.Group();
body.add(cameraMount);
cameraMount.position.set(-.72, 1.065, -.335);
const driverCameraPosition = cameraMount.position.clone();
const driverLookTarget = new THREE.Vector3(12, 1.24, -.28);
const chaseLookTarget = new THREE.Vector3();
const worldCameraPos = new THREE.Vector3();
const worldTarget = new THREE.Vector3();
const desiredCameraPos = new THREE.Vector3();

scene.add(new THREE.HemisphereLight(0xf4f9ff, 0x45543b, 2.25));
const sun = new THREE.DirectionalLight(0xffe6bf, 3.3);
sun.position.set(-82, 130, -85);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 340;
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
sun.shadow.bias = -.0001;
scene.add(sun, sun.target);

const paint = (color, roughness = .65, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const upholstery = paint('#171a1a', .85);
const darkLeather = paint('#1d211d', .85);
const polishedMetal = paint('#b9b8a9', .22, .79);
const satinMetal = paint('#a9b1ab', .33, .66);
const blackPaint = paint('#0b1110', .24, .3);
const glassMaterial = new THREE.MeshPhysicalMaterial({color:0xd6edf3,roughness:.06,metalness:0,transmission:.72,transparent:true,opacity:.18,depthWrite:false,side:THREE.DoubleSide});
const carGreen = new THREE.MeshPhysicalMaterial({color:'#234d37',metalness:.39,roughness:.27,clearcoat:.95,clearcoatRoughness:.12,side:THREE.DoubleSide});

function mesh(geometry, material, parent = cockpit, position, rotation) {
  const m = new THREE.Mesh(geometry, material);
  if (position) m.position.set(...position);
  if (rotation) m.rotation.set(...rotation);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function rodBetween(a, b, radius, material, parent = cockpit, segments=10){
  a = new THREE.Vector3(...a); b = new THREE.Vector3(...b);
  const delta = b.clone().sub(a);
  const result = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), segments), material, parent);
  result.position.copy(a).addScaledVector(delta,.5);
  result.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize());
  return result;
}
function roundedRectShape(w,h,r){
  const s = new THREE.Shape();
  const x = -w/2, y = -h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
  s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
  s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
  return s;
}
function framePanel(w,h,d,r,material,position,parent=cockpit){
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(w,h,r),{depth:d,bevelEnabled:true,bevelSize:Math.min(.008,d/4),bevelThickness:Math.min(.008,d/4),bevelSegments:2,curveSegments:5});
  const obj = mesh(geo,material,parent,position,[0,Math.PI/2,0]);
  return obj;
}
function rngFactory(seed=0xDB4A61){let n=seed>>>0;return ()=>((n=Math.imul(n,1664525)+1013904223>>>0)/4294967296)}
const rand=rngFactory();
function roadZ(x){
  const t=Math.max(0,x-88);
  return Math.sin(t*.010)*17 + Math.sin(t*.024)*5.4;
}
function roadDz(x){
  if(x<=88)return 0;
  const t=x-88;
  return .17*Math.cos(t*.010)+.1296*Math.cos(t*.024);
}

// An original curving asphalt route, not an image backdrop. Drive and turn off it.
function createRoute(){
  mesh(new THREE.PlaneGeometry(2500,1600),paint('#66856b',.99),scene,[470,-.055,0],[-Math.PI/2,0,0]).receiveShadow=true;
  const n=510, a=-190, b=1400, width=8.8;
  const verts=[],uv=[],indices=[],lanes=[];
  for(let i=0;i<=n;i++){
    const x=a+(b-a)*i/n,center=roadZ(x), slope=roadDz(x),norm=Math.hypot(1,slope),nx=-slope/norm,nz=1/norm;
    for (const side of [-1,1]){verts.push(x+nx*side*width/2,.012,center+nz*side*width/2);uv.push(i*1.8,side<0?0:1)}
    if(i<n){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2)}
  }
  const g=new THREE.BufferGeometry();g.setIndex(indices);g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();
  const roadTexture=makeRoadTexture();
  mesh(g,new THREE.MeshStandardMaterial({map:roadTexture,roughness:.97,metalness:0,side:THREE.DoubleSide}),scene).receiveShadow=true;
  function stripe(x0,x1,zOffset,linewidth,color){
    const length=x1-x0, pts=[];
    for(let k=0;k<=5;k++){
      let x=x0+length*k/5, c=roadZ(x), slope=roadDz(x),norm=Math.hypot(1,slope);
      pts.push(new THREE.Vector3(x-zOffset*slope/norm,.036,c+zOffset/norm));
    }
    const curve=new THREE.CatmullRomCurve3(pts);
    const line=mesh(new THREE.TubeGeometry(curve,8,linewidth,4,false),paint(color,.95),scene);
    line.castShadow=false;
  }
  for(let x=-185;x<1400;x+=14){stripe(x,Math.min(x+6,1400),0,.044,'#eee0b0')}
  for(let x=-185;x<1400;x+=13){stripe(x,Math.min(x+13,1400),-4.08,.041,'#d7ded8');stripe(x,Math.min(x+13,1400),4.08,.041,'#d7ded8')}
  // Grass clumps and trees are instanced in batches to keep draw calls affordable.
  const trunkG=new THREE.CylinderGeometry(.13,.21,2.3,5),trunkM=paint('#5b4838');
  const foliageG=new THREE.ConeGeometry(1.85,5.7,7),foliageM=paint('#315e48',.93);
  const trunkInst=new THREE.InstancedMesh(trunkG,trunkM,410);
  const foliageInst=new THREE.InstancedMesh(foliageG,foliageM,410);
  const dummy=new THREE.Object3D();let planted=0;
  for(let i=0;i<410;i++){
    const x=-165+rand()*1530,center=roadZ(x),side=rand()<.5?-1:1,z=center+side*(12+rand()*65);
    const scale=.65+rand()*1.2;
    dummy.position.set(x,1.1*scale,z);dummy.rotation.set(0,rand()*TAU,0);dummy.scale.setScalar(scale);dummy.updateMatrix();trunkInst.setMatrixAt(planted,dummy.matrix);
    dummy.position.y=4.85*scale;dummy.updateMatrix();foliageInst.setMatrixAt(planted,dummy.matrix);
    planted++;
  }
  trunkInst.count=foliageInst.count=planted;
  trunkInst.castShadow=true; foliageInst.castShadow=true;scene.add(trunkInst,foliageInst);
  // Rolling mountain range beyond the trees.
  for(let side of [-1,1]){
    const pos=[],idx=[];
    for(let i=0;i<=140;i++){
      const x=-350+i*16.7, z=side*380;
      const h=39+17*Math.sin(i*.31)+23*Math.sin(i*.103+side)+7*Math.sin(i*1.2);
      pos.push(x,-.1,z,x,h,z);
      if(i<140){let k=i*2;idx.push(k,k+2,k+1,k+1,k+2,k+3)}
    }
    const geo=new THREE.BufferGeometry();geo.setIndex(idx);geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.computeVertexNormals();
    mesh(geo,paint(side===-1?'#7a9995':'#6b8b80',.99),scene).castShadow=false;
  }
  for(let i=0;i<17;i++){
    const x=60+i*75, side=(i%2===0?-1:1),roadCenter=roadZ(x),poleZ=roadCenter+side*7.0;
    rodBetween([x,0,poleZ],[x,2.15,poleZ],.047,satinMetal,scene);
    const sign=mesh(new THREE.BoxGeometry(.09,.69,.98),paint('#1f493d',.57,.18),scene,[x,2.09,poleZ+side*.06]);
    const stripe=mesh(new THREE.BoxGeometry(.095,.07,.80),paint('#dbe5ca',.65),scene,[x,2.08,poleZ+side*.06]);
    sign.castShadow=true;stripe.castShadow=false;
  }
}
function makeRoadTexture(){
  const cn=document.createElement('canvas');cn.width=256;cn.height=256;
  const c=cn.getContext('2d');c.fillStyle='#515658';c.fillRect(0,0,256,256);
  const image=c.getImageData(0,0,256,256);
  for(let i=0;i<image.data.length;i+=4){const noise=(rand()-.5)*38;for(let j=0;j<3;j++) image.data[i+j]=clamp(image.data[i+j]+noise,0,255)}
  c.putImageData(image,0,0);
  const tx=new THREE.CanvasTexture(cn);tx.colorSpace=THREE.SRGBColorSpace;tx.wrapS=tx.wrapT=THREE.RepeatWrapping;tx.anisotropy=8;
  return tx;
}
createRoute();

function woodTexture(){
  const c=document.createElement('canvas');c.width=512;c.height=256;
  const ctx=c.getContext('2d');ctx.fillStyle='#5a3929';ctx.fillRect(0,0,512,256);
  for(let y=0;y<256;y++){
    const wave=Math.sin(y*.19)*5+Math.sin(y*.06+2)*6;
    const strength=Math.round(61+28*Math.sin(y*.23)+12*Math.sin(y*.67));
    ctx.strokeStyle=`rgba(${strength+60},${35+strength/4},20,${.1+rand()*.16})`;
    ctx.lineWidth=.5+rand()*2;ctx.beginPath();ctx.moveTo(0,y+wave);ctx.bezierCurveTo(160,y+Math.sin(y*.017)*9,280,y-wave,512,y+wave);ctx.stroke();
  }
  const tx=new THREE.CanvasTexture(c);tx.colorSpace=THREE.SRGBColorSpace;return tx;
}
const woodMat=new THREE.MeshPhysicalMaterial({map:woodTexture(),roughness:.28,clearcoat:.75,clearcoatRoughness:.18,metalness:.02});

let steeringColumn;
const dials=[];
function makeGaugeImage(title,sub,maxValue,accent='#e4dfce'){
  const cn=document.createElement('canvas');cn.width=512;cn.height=512;
  const ctx=cn.getContext('2d');const c=256;
  function draw(value=0){
    ctx.clearRect(0,0,512,512);
    const grad=ctx.createRadialGradient(c,c,10,c,c,239);grad.addColorStop(0,'#171b1a');grad.addColorStop(.76,'#0b0e0c');grad.addColorStop(1,'#343832');
    ctx.fillStyle=grad;ctx.beginPath();ctx.arc(c,c,236,0,TAU);ctx.fill();
    ctx.strokeStyle='#b0b5ac';ctx.lineWidth=8;ctx.beginPath();ctx.arc(c,c,226,0,TAU);ctx.stroke();
    ctx.strokeStyle='#6f746b';ctx.lineWidth=3;ctx.beginPath();ctx.arc(c,c,218,0,TAU);ctx.stroke();
    for(let i=0;i<=maxValue;i+=maxValue/40){
      const angle=(Math.PI*.77)+(i/maxValue)*Math.PI*1.46;
      const major=Math.round(i/(maxValue/8))===i/(maxValue/8);
      const ri=major?174:187,ro=205;
      ctx.strokeStyle='#eee8d9';ctx.lineWidth=major?5:2;
      ctx.beginPath();ctx.moveTo(c+Math.sin(angle)*ri,c-Math.cos(angle)*ri);ctx.lineTo(c+Math.sin(angle)*ro,c-Math.cos(angle)*ro);ctx.stroke();
    }
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ede9dc';ctx.font='32px Georgia,serif';
    for(let i=0;i<=8;i++){
      const a=Math.PI*.77+i/8*Math.PI*1.46,r=146;
      ctx.fillText(String(Math.round(maxValue*i/8)),c+Math.sin(a)*r,c-Math.cos(a)*r);
    }
    ctx.fillStyle='#c8d2bf';ctx.font='bold 24px Georgia,serif';ctx.fillText(title,c,c+68);
    ctx.font='19px Arial,sans-serif';ctx.fillText(sub,c,c+96);
    ctx.strokeStyle=accent;ctx.lineWidth=7;
    const needleAngle=Math.PI*.77+clamp(value,0,maxValue)/maxValue*Math.PI*1.46;
    ctx.beginPath();ctx.moveTo(c-Math.sin(needleAngle)*30,c+Math.cos(needleAngle)*30);
    ctx.lineTo(c+Math.sin(needleAngle)*157,c-Math.cos(needleAngle)*157);ctx.stroke();
    ctx.fillStyle='#cfd6c5';ctx.beginPath();ctx.arc(c,c,13,0,TAU);ctx.fill();
  }
  draw();
  const tex=new THREE.CanvasTexture(cn);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
  return {tex,draw,update:()=>{tex.needsUpdate=true}};
}
function dial(title,sub,max,x,y,z,diameter){
  const dialTex=makeGaugeImage(title,sub,max,title==='RPM'?'#d9b6a3':'#ebdbb7');
  const disc=mesh(new THREE.CircleGeometry(diameter/2,56),new THREE.MeshBasicMaterial({map:dialTex.tex,side:THREE.DoubleSide,depthWrite:false}),cockpit,[x,y,z],[0,Math.PI/2,0]);
  disc.castShadow=false;
  const frame=mesh(new THREE.TorusGeometry(diameter/2+.01,.018,10,55),polishedMetal,cockpit,[x-.004,y,z],[0,Math.PI/2,0]);
  frame.castShadow=false;
  dials.push({ ...dialTex,max });return disc;
}
function createInterior(){
  // The uploaded car body is an exterior shell. This independently modelled cabin
  // preserves visibility through the windscreen while keeping dimensions in metres.
  mesh(new THREE.BoxGeometry(1.60,.12,1.62),darkLeather,cockpit,[-.26,.18,.13]);
  mesh(new THREE.BoxGeometry(.78,.38,1.66),upholstery,cockpit,[.38,.58,.135]);
  const dashTop=mesh(new THREE.BoxGeometry(.84,.115,1.61),darkLeather,cockpit,[.43,.84,.135]);
  dashTop.rotation.z=-.052;
  mesh(new THREE.BoxGeometry(.035,.125,1.52),woodMat,cockpit,[.012,.677,.136]);
  mesh(new THREE.BoxGeometry(.02,.012,1.53),polishedMetal,cockpit,[-.022,.745,.136]);
  framePanel(.61,.29,.025,.055,blackPaint,[-.032,.683,-.31]);
  dial('MPH','SPEED',180,-.047,.705,-.48,.285);
  dial('RPM','x1000',8,-.047,.705,-.16,.285);
  dial('FUEL','E  /  F',100,-.047,.674,.19,.142);
  dial('OIL','PRESS',100,-.047,.674,.36,.142);
  // Transmission tunnel + switchgear
  mesh(new THREE.BoxGeometry(.83,.24,.30),darkLeather,cockpit,[.03,.39,.13]);
  mesh(new THREE.CylinderGeometry(.031,.037,.29,16),polishedMetal,cockpit,[-.20,.55,.15]);
  mesh(new THREE.SphereGeometry(.061,16,12),blackPaint,cockpit,[-.20,.71,.15]);
  for(let i=0;i<4;i++){
    mesh(new THREE.CylinderGeometry(.012,.012,.11,12),satinMetal,cockpit,[.006,.63,.52+i*.075],[Math.PI/2,0,0]);
  }
  // Windshield: A-pillars follow a swept period roofline.
  const bottomL=[.87,.835,-.735],bottomR=[.87,.835,.94];
  const topL=[.27,1.315,-.70],topR=[.27,1.315,.90];
  rodBetween(bottomL,topL,.043,polishedMetal);
  rodBetween(bottomR,topR,.043,polishedMetal);
  rodBetween(topL,topR,.04,darkLeather);
  mesh(new THREE.BoxGeometry(.17,.042,1.60),blackPaint,cockpit,[.32,1.345,.11]);
  rodBetween([.86,.86,-.73],[.86,.86,.92],.036,polishedMetal);
  mesh(new THREE.BoxGeometry(.21,.12,.34),blackPaint,cockpit,[.31,1.23,.07]);
  const mirror=mesh(new THREE.BoxGeometry(.025,.099,.25),paint('#4a5b60',.13,.35),cockpit,[.19,1.24,.065]);
  mirror.castShadow=false;
  // Inside of the side-door (visible in driver peripheral vision).
  mesh(new THREE.BoxGeometry(.90,.40,.055),darkLeather,cockpit,[-.24,.59,-.70]);
  mesh(new THREE.BoxGeometry(.8,.036,.062),woodMat,cockpit,[-.22,.76,-.67]);
  mesh(new THREE.BoxGeometry(.8,.026,.06),satinMetal,cockpit,[-.23,.79,-.66]);
  rodBetween([-.10,.68,-.665],[.19,.68,-.665],.014,polishedMetal);
  // Windshield glass is deliberately faint: transparency without obscuring the road.
  const winGeo=new THREE.BufferGeometry();
  winGeo.setAttribute('position',new THREE.Float32BufferAttribute([
    ...bottomL,...bottomR,...topL,...topL,...bottomR,...topR
  ],3));winGeo.computeVertexNormals();
  const windscreen=mesh(winGeo,glassMaterial,cockpit);windscreen.castShadow=false;
  // Hood visible beyond the dash. It shares the exterior's classic racing green.
  const points=[],normals=[],uvs=[],idx=[];
  for(let i=0;i<=22;i++){
    const t=i/22,x=.80+t*1.45,y=.827-t*.082+.015*Math.sin(Math.PI*t),halfW=.70-t*.1;
    for(let j=0;j<=14;j++){
      const w=j/14*2-1,z=.115+w*halfW;
      points.push(x,y-.047*w*w,z);uvs.push(t,j/14);
      if(i<22&&j<14){let k=i*15+j;idx.push(k,k+15,k+1,k+1,k+15,k+16)}
    }
  }
  const hood=new THREE.BufferGeometry();hood.setIndex(idx);hood.setAttribute('position',new THREE.Float32BufferAttribute(points,3));hood.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));hood.computeVertexNormals();
  mesh(hood,carGreen,cockpit);
  // White stitched centre-stripe adds a frame of reference when cornering.
  rodBetween([.89,.843,.12],[2.13,.755,.12],.0055,paint('#678b67',.29,.32));
  const wheelFrame=new THREE.Group();
  wheelFrame.position.set(-.105,.768,-.352);
  wheelFrame.rotation.y=0;
  cockpit.add(wheelFrame);
  steeringColumn=wheelFrame;
  // Wheel is in the YZ plane; rotation around car's X axis is the turning animation.
  const woodWheel=mesh(new THREE.TorusGeometry(.235,.030,15,72),woodMat,wheelFrame,[0,0,0],[0,Math.PI/2,0]);
  woodWheel.castShadow=true;
  mesh(new THREE.TorusGeometry(.218,.005,8,70),polishedMetal,wheelFrame,[0,0,0],[0,Math.PI/2,0]);
  for(const deg of [90,210,330]){
    const a=THREE.MathUtils.degToRad(deg);
    // radial spokes: cos at y, sin at z
    rodBetween([-.013,0,0],[-.013,Math.cos(a)*.21,Math.sin(a)*.21],.018,polishedMetal,wheelFrame,9);
    rodBetween([-.013,Math.cos(a+.13)*.063,Math.sin(a+.13)*.063],[-.013,Math.cos(a+.13)*.195,Math.sin(a+.13)*.195],.0042,satinMetal,wheelFrame,8);
  }
  mesh(new THREE.CylinderGeometry(.063,.063,.048,36),polishedMetal,wheelFrame,[-.01,0,0],[0,0,-Math.PI/2]);
  mesh(new THREE.CylinderGeometry(.041,.041,.05,30),paint('#214431',.32,.25),wheelFrame,[-.047,0,0],[0,0,-Math.PI/2]);
  // Two classic black leather seats visible on wider fields of view.
  mesh(new THREE.BoxGeometry(.62,.70,.55),darkLeather,cockpit,[-.62,.60,.53]);
  mesh(new THREE.BoxGeometry(.64,.15,.56),darkLeather,cockpit,[-.65,.27,.53]);
}
createInterior();

const state={
  speed:0, steer:0, steerTarget:0, yaw:0, x:0,z:0, rpm:850,
  view:'cockpit', loading:true, indicator:0, elapsed:0, sound:false,
};
const hold={ gas:false, brake:false, left:false, right:false };
const wheels={};
let carShell=null;
let lastGauge=0;
const carLoader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
carLoader.load('./assets/aston_db4.glb', gltf=>{
  carShell=gltf.scene;
  body.add(carShell);
  const wheelNodes=[];
  carShell.traverse(o=>{
    if(!o.isMesh)return;
    o.castShadow=true;
    o.receiveShadow=true;
    o.material.side=THREE.DoubleSide;
    if(o.name==='CAR_BODY'){
      o.material.metalness=Math.max(o.material.metalness||0,.18);
      o.material.roughness=.36;
    }
    if(['FL_WHEEL','FR_WHEEL','RL_WHEEL','RR_WHEEL'].includes(o.name)) wheelNodes.push(o);
  });
  // Reparent only AFTER traversal. Mutating the hierarchy while traversing
  // skips siblings and can recursively revisit reparented objects.
  for(const o of wheelNodes){
    const parent=o.parent, wheelPivot=new THREE.Group();
    wheelPivot.name=`${o.name}_PIVOT`;
    wheelPivot.position.copy(o.position);
    parent.add(wheelPivot);
    o.position.set(0,0,0);
    wheelPivot.add(o);
    wheels[o.name]={pivot:wheelPivot,geometry:o,roll:0};
  }
  setView('cockpit',false);
  $('loading').classList.add('hidden');
  state.loading=false;
  setTimeout(()=>$('loading').style.display='none',800);
},undefined,error=>{
  console.error('GLB loading error:',error);
  // The procedurally created first-person cockpit still functions without it.
  state.loading=false;
  $('loading').classList.add('hidden');
  setTimeout(()=>$('loading').style.display='none',800);
  toast('Exterior model did not load — cockpit remains drivable',3500);
});

function setView(view,notify=true){
  state.view=view;
  cockpit.visible=view==='cockpit';
  if(carShell)carShell.visible=view!=='cockpit';
  $('cameraBtn').textContent=view==='cockpit'?'◉ COCKPIT':view==='chase'?'◉ FOLLOW':'◉ ORBIT';
  $('viewName').textContent=view==='cockpit'?"DRIVER'S SEAT":view==='chase'?'CHASE CAMERA':'CINEMATIC CAMERA';
  $('cameraBtn').classList.toggle('active',view==='cockpit');
  if(notify)toast(view==='cockpit'?'First-person driver's seat':view==='chase'?'Third-person chase':'Cinematic orbit',1600);
}
function cycleCamera(){const views=['cockpit','chase','orbit'];setView(views[(views.indexOf(state.view)+1)%views.length]);}
function toast(text,duration=2000){
  const el=$('centerToast');el.textContent=text;el.style.opacity=1;
  clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>el.style.opacity=0,duration);
}
function resetCar(){
  state.x=0;state.z=0;state.yaw=0;state.speed=0;state.steer=state.steerTarget=0;state.indicator=0;
  body.position.set(0,0,0);body.rotation.set(0,0,0);
  toast('Vehicle reset to starting position');
}
function toggleIndicator(side){state.indicator=state.indicator===side?0:side;toast(state.indicator===0?'Indicators off':state.indicator>0?'Left indicator':'Right indicator',1300)}

let engineAudio=null;
function toggleSound(){
  state.sound=!state.sound;
  if(state.sound){
    try{
      const ctx=new (window.AudioContext||window.webkitAudioContext)();
      const osc=ctx.createOscillator(),osc2=ctx.createOscillator(),gain=ctx.createGain(),low=ctx.createBiquadFilter();
      osc.type='sawtooth';osc2.type='triangle';low.type='lowpass';low.frequency.value=135;
      gain.gain.value=.012;
      osc.connect(low);osc2.connect(low);low.connect(gain);gain.connect(ctx.destination);
      osc.start();osc2.start();engineAudio={ctx,osc,osc2,gain,low};
      ctx.resume();
    }catch(err){state.sound=false;console.warn(err)}
  }else if(engineAudio){
    const old=engineAudio;old.gain.gain.setTargetAtTime(0,old.ctx.currentTime,.03);setTimeout(()=>old.ctx.close(),150);engineAudio=null;
  }
  $('soundBtn').textContent=state.sound?'♫ SOUND ON':'♫ SOUND OFF';
  $('soundBtn').classList.toggle('active',state.sound);
}
$('cameraBtn').addEventListener('click',cycleCamera);
$('resetBtn').addEventListener('click',resetCar);
$('soundBtn').addEventListener('click',toggleSound);
const keybinds={KeyW:'gas',ArrowUp:'gas',KeyS:'brake',ArrowDown:'brake',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};
window.addEventListener('keydown',e=>{
  if(keybinds[e.code]){hold[keybinds[e.code]]=true;e.preventDefault()}
  if(e.repeat)return;
  if(e.code==='KeyC')cycleCamera();
  if(e.code==='KeyR')resetCar();
  if(e.code==='KeyQ')toggleIndicator(1);
  if(e.code==='KeyE')toggleIndicator(-1);
  if(e.code==='KeyM')toggleSound();
});
window.addEventListener('keyup',e=>{if(keybinds[e.code]){hold[keybinds[e.code]]=false;e.preventDefault()}});
window.addEventListener('blur',()=>{Object.keys(hold).forEach(k=>hold[k]=false)});
for(const b of document.querySelectorAll('[data-key]')){
  const k=b.dataset.key;
  b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);hold[k]=true;b.classList.add('pressed')});
  for(const evt of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(evt,()=>{hold[k]=false;b.classList.remove('pressed')});
}
let lookAngle=0,orbitPitch=.18;
canvas.addEventListener('pointerdown',e=>{if(state.view==='orbit'){canvas.setPointerCapture(e.pointerId);canvas.dataset.lastX=e.clientX;canvas.dataset.lastY=e.clientY}});
canvas.addEventListener('pointermove',e=>{
  if(state.view==='orbit'&&canvas.hasPointerCapture(e.pointerId)){
    lookAngle+=(e.clientX-Number(canvas.dataset.lastX))*.007;
    orbitPitch=clamp(orbitPitch+(e.clientY-Number(canvas.dataset.lastY))*.004,-.27,1.00);
    canvas.dataset.lastX=e.clientX;canvas.dataset.lastY=e.clientY;
  }
});

function update(dt){
  state.elapsed+=dt;
  state.steerTarget=Number(hold.left)-Number(hold.right);
  // An actual damped steering response; the center self-aligns on key release.
  const smoothing=state.steerTarget===0?4.3:6.4;
  state.steer=lerp(state.steer,state.steerTarget,1-Math.exp(-smoothing*dt));
  const accelerating=hold.gas,braking=hold.brake;
  if(accelerating)state.speed+=8.9*dt;
  if(braking){
    if(state.speed>0)state.speed-=16.7*dt;
    else state.speed-=4.0*dt;
  }
  if(!accelerating&&!braking){
    const drag=(.64+.008*state.speed*state.speed)*dt;
    if(Math.abs(state.speed)<=drag)state.speed=0;
    else state.speed-=Math.sign(state.speed)*drag;
  }
  state.speed=clamp(state.speed,-9.0,57.5);
  // Bicycle model: angle at road wheels is 26 degrees at full lock.
  const maxSteerAngle=Math.min(.455,Math.atan((7.0*2.46)/Math.max(5,Math.abs(state.speed))**2));
  const wheelAngle=state.steer*maxSteerAngle;
  const turnRate=state.speed/2.46*Math.tan(wheelAngle);
  state.yaw+=turnRate*dt;
  state.x+=Math.cos(state.yaw)*state.speed*dt;
  state.z-=Math.sin(state.yaw)*state.speed*dt;
  body.position.set(state.x,0,state.z);
  body.rotation.y=state.yaw;
  // Mild lean to communicate weight transfer without changing input physics.
  body.rotation.x=lerp(body.rotation.x,-clamp(turnRate*state.speed*.0009,-.045,.045),1-Math.exp(-3*dt));
  body.rotation.z=lerp(body.rotation.z,clamp((accelerating?-.006:braking?.016:0),-.02,.02),1-Math.exp(-2.5*dt));
  const vibration=Math.min(Math.abs(state.speed)/35,1)*.004;
  cockpit.position.y=vibration*Math.sin(state.elapsed*18.4);
  if(steeringColumn) steeringColumn.rotation.x=lerp(steeringColumn.rotation.x,-state.steer*2.6,1-Math.exp(-11*dt));
  // GLB rolling wheel mesh is aligned to Z axle. The *pivots* steer around Y.
  for(const [name,w] of Object.entries(wheels)){
    if(name.startsWith('F'))w.pivot.rotation.y=wheelAngle;
    w.roll-=state.speed*dt/.3529;
    w.geometry.rotation.z=w.roll;
  }
  // Smoothed head motion and eye-line into the bend.
  if(state.view==='cockpit'){
    cameraMount.position.set(driverCameraPosition.x,driverCameraPosition.y+Math.sin(state.elapsed*12)*vibration,driverCameraPosition.z);
    const glance=state.steer*.16;
    cameraMount.rotation.y=lerp(cameraMount.rotation.y,glance,1-Math.exp(-3.6*dt));
    cameraMount.rotation.z=lerp(cameraMount.rotation.z,-state.steer*clamp(Math.abs(state.speed)/60,0,.028),1-Math.exp(-3*dt));
    body.updateMatrixWorld(true);
    cameraMount.getWorldPosition(worldCameraPos);
    camera.position.copy(worldCameraPos);
    const forward=new THREE.Vector3(1,0,0).applyQuaternion(cameraMount.getWorldQuaternion(new THREE.Quaternion()));
    camera.lookAt(worldTarget.copy(camera.position).addScaledVector(forward,12).add(new THREE.Vector3(0,.09,0)));
    camera.fov=lerp(camera.fov,72+Math.min(Math.abs(state.speed)/57,1)*5,1-Math.exp(-2*dt));
  }else{
    const orbit=state.view==='orbit'?lookAngle:0;
    const dist=state.view==='chase'?8.9:9.7;
    const h=state.view==='chase'?3.30:3.9+orbitPitch*6;
    const behindX=-Math.cos(orbit)*dist,behindZ=Math.sin(orbit)*dist;
    desiredCameraPos.set(behindX,h,behindZ).applyAxisAngle(new THREE.Vector3(0,1,0),state.yaw).add(body.position);
    if(camera.position.distanceTo(desiredCameraPos)>90)camera.position.copy(desiredCameraPos);
    else camera.position.lerp(desiredCameraPos,1-Math.exp(-3.5*dt));
    chaseLookTarget.set(1.45,.91,0).applyAxisAngle(new THREE.Vector3(0,1,0),state.yaw).add(body.position);
    camera.lookAt(chaseLookTarget);
    camera.fov=lerp(camera.fov,state.view==='chase'?63:59,1-Math.exp(-3*dt));
  }
  camera.updateProjectionMatrix();
  state.rpm=clamp(850+Math.abs(state.speed)*99+(accelerating?850:0),850,6500);
  if(state.elapsed-lastGauge>.085){
    if(dials[0]){dials[0].draw(Math.abs(state.speed)*2.23694);dials[0].update()}
    if(dials[1]){dials[1].draw(state.rpm/1000);dials[1].update()}
    if(dials[2]){dials[2].draw(72);dials[2].update()}
    if(dials[3]){dials[3].draw(48+Math.min(35,Math.abs(state.speed)));dials[3].update()}
    $('speed').textContent=Math.round(Math.abs(state.speed)*3.6);
    $('rpm').textContent=`${Math.round(state.rpm/50)*50} RPM`;
    $('gear').textContent=state.speed<-.4?'R':state.speed>.4?'D':'N';
    $('angle').textContent=`${Math.round(wheelAngle*DEG)}°`;
    const flash=Math.sin(state.elapsed*TAU*1.15)>0;
    $('turnL').classList.toggle('signal-active',state.indicator===1&&flash);
    $('turnR').classList.toggle('signal-active',state.indicator===-1&&flash);
    if(engineAudio){
      const a=engineAudio,now=a.ctx.currentTime;
      a.osc.frequency.setTargetAtTime(24+state.rpm/80,now,.07);
      a.osc2.frequency.setTargetAtTime(12+state.rpm/160,now,.08);
      a.low.frequency.setTargetAtTime(135+state.rpm*.054,now,.1);
    }
    lastGauge=state.elapsed;
  }
  // Recenter main directional shadow on vehicle while driving.
  sun.position.set(state.x-65,115,state.z-60);
  sun.target.position.set(state.x,0,state.z);
  sun.target.updateMatrixWorld();
}

function resize(){
  const w=window.innerWidth,h=window.innerHeight;
  renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
}
window.addEventListener('resize',resize);resize();
function animate(){
  const dt=Math.min(clock.getDelta(),.045);
  update(dt);
  renderer.render(scene,camera);
}
const clock=new THREE.Clock();
renderer.setAnimationLoop(animate);
// Test harness for browser and future integrations, intentionally read-only.
window.__DB4_DIAGNOSTICS__={
  getState:()=>({x:state.x,z:state.z,yaw:state.yaw,speed:state.speed,steering:state.steer,view:state.view,modelLoaded:!!carShell,ready:!state.loading}),
  getWheelCount:()=>Object.keys(wheels).length,
};
