// Procedural fallback textures, card geometries and the shared
// material table. Scanned PBR sets (see install_pbr.py) replace
// several of these at runtime; everything here is generated so the
// scene still renders complete with no assets installed.
import * as THREE from 'three';
import * as BufferGeometryUtils
  from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, randomGenerator } from '../core/math.js';

export function createProctex(renderer) {
  function canvasTexture(size, draw, srgb = true) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    draw(canvas.getContext('2d'), size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy =
      Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const asphaltTexture = canvasTexture(512, (ctx, size) => {
    const rand = randomGenerator(521);
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = 73 + rand() * 35;
      image.data[i] = n * 0.88;
      image.data[i + 1] = n * 0.95;
      image.data[i + 2] = n;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    // Longitudinal aggregate and hairline seams soften repeating
    // tiles.
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 2100; i++) {
      const x = rand() * size;
      const y = rand() * size;
      ctx.fillStyle = rand() > 0.5 ? '#b7c5cd' : '#050f18';
      ctx.fillRect(x, y, 0.5 + rand() * 1.7, rand() * 5 + 0.6);
    }
    ctx.globalAlpha = 1;
  });

  const wetRoughness = canvasTexture(512, (ctx, size) => {
    const rand = randomGenerator(991);
    ctx.fillStyle = '#c2c2c2';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 65; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 25 + rand() * 100;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(8,8,8,.97)');
      g.addColorStop(1, 'rgba(80,80,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, false);

  const soilTexture = canvasTexture(256, (ctx, size) => {
    const rand = randomGenerator(6081);
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = 45 + rand() * 65;
      image.data[i] = n * 0.64;
      image.data[i + 1] = n * 0.78;
      image.data[i + 2] = n * 0.61;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  });

  const puddleMask = canvasTexture(256, (ctx, size) => {
    const rand = randomGenerator(801);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(0.95, 0.58);
    const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, 125);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.48, '#f8f8f8');
    grad.addColorStop(0.73, '#aaaaaa');
    grad.addColorStop(0.90, '#171717');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.beginPath();
    for (let j = 0; j <= 64; j++) {
      const a = j / 64 * Math.PI * 2;
      const r = 111 + 5 * Math.sin(a * 7) + 7 * Math.sin(a * 11 + 1.3);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (!j) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }, false);
  puddleMask.wrapS = puddleMask.wrapT = THREE.ClampToEdgeWrapping;

  const carbonTexture = canvasTexture(64, (ctx, size) => {
    ctx.fillStyle = '#151c23';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 8) {
      for (let x = 0; x < size; x += 8) {
        ctx.fillStyle = ((x + y) / 8) % 2 ? '#303a42' : '#1b242c';
        ctx.fillRect(x, y, 7, 7);
        ctx.fillStyle = 'rgba(130,150,165,.12)';
        ctx.fillRect(x, y, 2, 7);
      }
    }
  });
  carbonTexture.repeat.set(5, 5);

  const contactTexture = canvasTexture(128, (ctx, size) => {
    const g = ctx.createRadialGradient(
      size / 2, size / 2, 4, size / 2, size / 2, size / 2
    );
    g.addColorStop(0, 'rgba(0,0,0,.86)');
    g.addColorStop(0.4, 'rgba(0,0,0,.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
  contactTexture.wrapS = contactTexture.wrapT =
    THREE.ClampToEdgeWrapping;

  // Irregular wet-patch mask for the planar road reflection: bright
  // streaks and blobs mirror the scene, the rest stays diffuse
  // asphalt.
  const mirrorMask = canvasTexture(256, (ctx, size) => {
    const rand = randomGenerator(4177);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 46; i++) {
      const x = rand() * size;
      const y = rand() * size;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(9 + rand() * 30, 24 + rand() * 105);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(255,255,255,.95)');
      g.addColorStop(0.55, 'rgba(210,210,210,.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Wheel-track wet lines running along the tile.
    ctx.globalAlpha = 0.28;
    for (const lx of [0.30, 0.68]) {
      const g = ctx.createLinearGradient(
        lx * size - 15, 0, lx * size + 15, 0
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(235,235,235,.9)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(lx * size - 15, 0, 30, size);
    }
    ctx.globalAlpha = 1;
  }, false);

  // Soft alpha blotches for the low-lying mist sheets.
  const mistTexture = canvasTexture(256, (ctx, size) => {
    const rand = randomGenerator(9053);
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 64; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 16 + rand() * 72;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,.17)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });

  // Crossed-card grass tufts for the road verges.
  const grassTexture = canvasTexture(64, (ctx, size) => {
    const rand = randomGenerator(2213);
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 26; i++) {
      const x = 4 + rand() * (size - 8);
      const top = size * (0.02 + rand() * 0.24);
      const grad = ctx.createLinearGradient(0, size, 0, top);
      grad.addColorStop(0, '#25311f');
      grad.addColorStop(1, '#63755a');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.1 + rand() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x, size);
      ctx.quadraticCurveTo(
        x + (rand() - 0.5) * 10, size * 0.55,
        x + (rand() - 0.5) * 16, top
      );
      ctx.stroke();
    }
  });
  const grassCardA = new THREE.PlaneGeometry(1, 1);
  grassCardA.translate(0, 0.5, 0);
  const grassGeometry = BufferGeometryUtils.mergeGeometries([
    grassCardA, grassCardA.clone().rotateY(Math.PI / 2)
  ]);

  // Fern fronds radiating from a base; wider arched strokes than
  // grass.
  const fernTexture = canvasTexture(96, (ctx, size) => {
    const rand = randomGenerator(4417);
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9 - 0.5) * 2.1 + (rand() - 0.5) * 0.2;
      const length = size * (0.55 + rand() * 0.4);
      const tipX = size / 2 + Math.sin(angle) * length;
      const tipY = size - Math.cos(angle) * length;
      const midX = size / 2 + Math.sin(angle) * length * 0.45;
      const midY = size - Math.cos(angle) * length * 0.62;
      for (let t = 0.2; t < 1; t += 0.09) {
        const bx =
          lerp(lerp(size / 2, midX, t), lerp(midX, tipX, t), t);
        const by =
          lerp(lerp(size, midY, t), lerp(midY, tipY, t), t);
        const leafLen = (1 - t) * size * 0.11;
        ctx.strokeStyle = `rgba(${52 + rand() * 26 | 0},${
          92 + rand() * 34 | 0},${44 + rand() * 20 | 0},.92)`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(bx - leafLen, by - leafLen * 0.4);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + leafLen, by - leafLen * 0.4);
        ctx.stroke();
      }
    }
  });
  const fernCardA = new THREE.PlaneGeometry(1.3, 1);
  fernCardA.translate(0, 0.45, 0);
  const fernGeometry = BufferGeometryUtils.mergeGeometries([
    fernCardA,
    fernCardA.clone().rotateY(Math.PI / 3),
    fernCardA.clone().rotateY(-Math.PI / 3)
  ]);

  // Conifer silhouette card for distant forest impostors.
  const impostorTexture = canvasTexture(96, (ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(14,30,22,.96)';
    ctx.fillRect(size * 0.46, size * 0.72, size * 0.08, size * 0.28);
    for (let i = 0; i < 5; i++) {
      const w = size * (0.44 - i * 0.058);
      const top = size * (0.06 + i * 0.14);
      const base = top + size * 0.22;
      ctx.beginPath();
      ctx.moveTo(size / 2, top);
      ctx.lineTo(size / 2 - w, base);
      ctx.lineTo(size / 2 + w, base);
      ctx.closePath();
      ctx.fill();
    }
  });
  const impostorCard = new THREE.PlaneGeometry(1, 1);
  impostorCard.translate(0, 0.5, 0);
  const impostorGeometry = BufferGeometryUtils.mergeGeometries([
    impostorCard, impostorCard.clone().rotateY(Math.PI / 2)
  ]);

  const lightSpillTexture = canvasTexture(256, (ctx, size) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 1,
                                        size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.82)');
    g.addColorStop(0.17, 'rgba(255,255,255,0.64)');
    g.addColorStop(0.47, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'destination-out';
    // Thin water-runoff bands break up the projected light
    // uniformly.
    for (let i = 0; i < 42; i++) {
      const rand = randomGenerator(i * 3571 + 4002);
      ctx.fillStyle = 'rgba(0,0,0,.08)';
      ctx.fillRect(rand() * size, rand() * size, 1, rand() * 25);
    }
  });
  lightSpillTexture.wrapS = lightSpillTexture.wrapT =
    THREE.ClampToEdgeWrapping;

  const lightHaloTexture = canvasTexture(128, (ctx, size) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,.6)');
    g.addColorStop(0.5, 'rgba(255,255,255,.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
  lightHaloTexture.wrapS = lightHaloTexture.wrapT =
    THREE.ClampToEdgeWrapping;

  const materials = {
    road: new THREE.MeshPhysicalMaterial({
      color: 0x8297a9,
      map: asphaltTexture,
      bumpMap: asphaltTexture,
      bumpScale: 0.013,
      roughnessMap: wetRoughness,
      roughness: 0.61,
      metalness: 0.14,
      clearcoat: 1,
      clearcoatRoughness: 0.085,
      envMapIntensity: 2.0
    }),
    ground: new THREE.MeshStandardMaterial({
      color: 0x526352, map: soilTexture, roughness: 0.99,
      vertexColors: true, flatShading: true
    }),
    verge: new THREE.MeshStandardMaterial({
      color: 0x6a5f52, map: soilTexture, roughness: 0.98,
      vertexColors: true, flatShading: true
    }),
    grass: new THREE.MeshStandardMaterial({
      map: grassTexture, alphaTest: 0.42, roughness: 0.95,
      side: THREE.DoubleSide
    }),
    fern: new THREE.MeshStandardMaterial({
      map: fernTexture, alphaTest: 0.4, roughness: 0.96,
      side: THREE.DoubleSide
    }),
    rock: new THREE.MeshStandardMaterial({
      color: 0x374348, roughness: 0.98, flatShading: true
    }),
    // Distant massif silhouettes — kept dark and matte so fog and the
    // atmospheric sky haze do the photoreal work.
    mountain: new THREE.MeshStandardMaterial({
      color: 0x3d4a55, roughness: 1.0, metalness: 0.0,
      flatShading: true
    }),
    puddle: new THREE.MeshPhysicalMaterial({
      color: 0x7392a5, metalness: 0.28, roughness: 0.09,
      clearcoat: 1, clearcoatRoughness: 0.035,
      alphaMap: puddleMask, transparent: true, opacity: 0.32,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      envMapIntensity: 2.4, side: THREE.DoubleSide
    }),
    marking: new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.45, metalness: 0.05
    }),
    foliage: new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, flatShading: true,
      side: THREE.DoubleSide
    }),
    carbon: new THREE.MeshStandardMaterial({
      color: 0x5d6972, map: carbonTexture, roughness: 0.42,
      metalness: 0.55
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x101316, roughness: 0.82, metalness: 0.03
    }),
    rim: new THREE.MeshStandardMaterial({
      color: 0x89949e, metalness: 0.94, roughness: 0.22
    }),
    darkMetal: new THREE.MeshStandardMaterial({
      color: 0x20272d, metalness: 0.84, roughness: 0.33
    }),
    contact: new THREE.MeshBasicMaterial({
      map: contactTexture,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2
    })
  };

  return {
    canvasTexture,
    asphaltTexture, wetRoughness, soilTexture, puddleMask,
    carbonTexture, contactTexture, mirrorMask, mistTexture,
    grassTexture, grassGeometry, fernTexture, fernGeometry,
    impostorTexture, impostorGeometry,
    lightSpillTexture, lightHaloTexture,
    materials
  };
}
