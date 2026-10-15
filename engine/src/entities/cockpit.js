// DB4 cockpit interior. The car GLB is an exterior shell only, so this
// cabin is a purpose-built interior in DB4 coordinates (+X forward,
// +Z passenger side) — ported from the first-person driving reference
// (cars/Aston_DB4_First_Person_Driving). The returned group is already
// rotated -90 deg so demo coordinates work verbatim; attach it to a
// car root whose +Z is the nose.
import * as THREE from 'three';
import { clamp, randomGenerator, TAU } from '../core/math.js';

export function createCockpit() {
  const group = new THREE.Group();
  group.rotation.y = -Math.PI / 2;
  group.visible = false;

  const cameraMount = new THREE.Group();
  cameraMount.position.set(-0.72, 1.065, -0.335);   // driver eye, LHD
  group.add(cameraMount);

  const cp = {
    upholstery: new THREE.MeshStandardMaterial(
      { color: 0x171a1a, roughness: 0.85 }),
    leather: new THREE.MeshStandardMaterial(
      { color: 0x1d211d, roughness: 0.85 }),
    polished: new THREE.MeshStandardMaterial(
      { color: 0xb9b8a9, roughness: 0.22, metalness: 0.79 }),
    satin: new THREE.MeshStandardMaterial(
      { color: 0xa9b1ab, roughness: 0.33, metalness: 0.66 }),
    black: new THREE.MeshStandardMaterial(
      { color: 0x0b1110, roughness: 0.24, metalness: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xd6edf3, roughness: 0.06, metalness: 0,
      transmission: 0.72, transparent: true, opacity: 0.18,
      depthWrite: false, side: THREE.DoubleSide
    }),
    green: new THREE.MeshPhysicalMaterial({
      color: 0x234d37, metalness: 0.39, roughness: 0.27,
      clearcoat: 0.95, clearcoatRoughness: 0.12, side: THREE.DoubleSide
    })
  };
  const cockpitRand = randomGenerator(0xDB4A61);

  function mesh(geometry, material, position, rotation) {
    const m = new THREE.Mesh(geometry, material);
    if (position) m.position.set(...position);
    if (rotation) m.rotation.set(...rotation);
    group.add(m);
    return m;
  }
  function rodBetween(a, b, radius, material, parent = group, segments = 10) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b);
    const delta = bv.clone().sub(av);
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, delta.length(), segments),
      material);
    m.position.copy(av).addScaledVector(delta, 0.5);
    m.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), delta.normalize());
    parent.add(m);
    return m;
  }
  function roundedRectShape(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function framePanel(w, h, d, r, material, position) {
    const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
      depth: d, bevelEnabled: true,
      bevelSize: Math.min(0.008, d / 4),
      bevelThickness: Math.min(0.008, d / 4),
      bevelSegments: 2, curveSegments: 5
    });
    return mesh(geo, material, position, [0, Math.PI / 2, 0]);
  }
  function woodTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5a3929'; ctx.fillRect(0, 0, 512, 256);
    for (let y = 0; y < 256; y++) {
      const wave = Math.sin(y * 0.19) * 5 + Math.sin(y * 0.06 + 2) * 6;
      const strength = Math.round(
        61 + 28 * Math.sin(y * 0.23) + 12 * Math.sin(y * 0.67));
      ctx.strokeStyle =
        `rgba(${strength + 60},${35 + strength / 4},20,${0.1 + cockpitRand() * 0.16})`;
      ctx.lineWidth = 0.5 + cockpitRand() * 2;
      ctx.beginPath();
      ctx.moveTo(0, y + wave);
      ctx.bezierCurveTo(160, y + Math.sin(y * 0.017) * 9,
                        280, y - wave, 512, y + wave);
      ctx.stroke();
    }
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  }
  const woodMat = new THREE.MeshPhysicalMaterial({
    map: woodTexture(), roughness: 0.28,
    clearcoat: 0.75, clearcoatRoughness: 0.18, metalness: 0.02
  });

  // Analogue gauge: canvas dial with a live needle.
  function makeGaugeImage(title, sub, maxValue, accent = '#e4dfce') {
    const cn = document.createElement('canvas');
    cn.width = 512; cn.height = 512;
    const ctx = cn.getContext('2d');
    const c = 256;
    function draw(value = 0) {
      ctx.clearRect(0, 0, 512, 512);
      const grad = ctx.createRadialGradient(c, c, 10, c, c, 239);
      grad.addColorStop(0, '#171b1a');
      grad.addColorStop(0.76, '#0b0e0c');
      grad.addColorStop(1, '#343832');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(c, c, 236, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#b0b5ac'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(c, c, 226, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#6f746b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(c, c, 218, 0, TAU); ctx.stroke();
      for (let i = 0; i <= maxValue; i += maxValue / 40) {
        const angle = Math.PI * 0.77 + (i / maxValue) * Math.PI * 1.46;
        const major = Math.round(i / (maxValue / 8)) === i / (maxValue / 8);
        const ri = major ? 174 : 187, ro = 205;
        ctx.strokeStyle = '#eee8d9';
        ctx.lineWidth = major ? 5 : 2;
        ctx.beginPath();
        ctx.moveTo(c + Math.sin(angle) * ri, c - Math.cos(angle) * ri);
        ctx.lineTo(c + Math.sin(angle) * ro, c - Math.cos(angle) * ro);
        ctx.stroke();
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ede9dc'; ctx.font = '32px Georgia,serif';
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * 0.77 + i / 8 * Math.PI * 1.46, r = 146;
        ctx.fillText(String(Math.round(maxValue * i / 8)),
                     c + Math.sin(a) * r, c - Math.cos(a) * r);
      }
      ctx.fillStyle = '#c8d2bf';
      ctx.font = 'bold 24px Georgia,serif';
      ctx.fillText(title, c, c + 68);
      ctx.font = '19px Arial,sans-serif';
      ctx.fillText(sub, c, c + 96);
      ctx.strokeStyle = accent; ctx.lineWidth = 7;
      const needleAngle =
        Math.PI * 0.77 + clamp(value, 0, maxValue) / maxValue * Math.PI * 1.46;
      ctx.beginPath();
      ctx.moveTo(c - Math.sin(needleAngle) * 30, c + Math.cos(needleAngle) * 30);
      ctx.lineTo(c + Math.sin(needleAngle) * 157, c - Math.cos(needleAngle) * 157);
      ctx.stroke();
      ctx.fillStyle = '#cfd6c5';
      ctx.beginPath(); ctx.arc(c, c, 13, 0, TAU); ctx.fill();
    }
    draw();
    const tex = new THREE.CanvasTexture(cn);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, draw, update: () => { tex.needsUpdate = true; } };
  }

  const dials = [];
  function dial(title, sub, max, x, y, z, diameter) {
    const d = makeGaugeImage(title, sub, max,
      title === 'RPM' ? '#d9b6a3' : '#ebdbb7');
    mesh(new THREE.CircleGeometry(diameter / 2, 56),
         new THREE.MeshBasicMaterial(
           { map: d.tex, side: THREE.DoubleSide, depthWrite: false }),
         [x, y, z], [0, -Math.PI / 2, 0]);   // face -X, toward the driver
    mesh(new THREE.TorusGeometry(diameter / 2 + 0.01, 0.018, 10, 55),
         cp.polished, [x - 0.004, y, z], [0, Math.PI / 2, 0]);
    dials.push({ ...d, max });
  }

  mesh(new THREE.BoxGeometry(1.60, 0.12, 1.62), cp.leather,
       [-0.26, 0.18, 0.13]);
  mesh(new THREE.BoxGeometry(0.78, 0.38, 1.66), cp.upholstery,
       [0.38, 0.58, 0.135]);
  const dashTop = mesh(
    new THREE.BoxGeometry(0.84, 0.115, 1.61), cp.leather,
    [0.43, 0.84, 0.135]);
  dashTop.rotation.z = -0.052;
  mesh(new THREE.BoxGeometry(0.035, 0.125, 1.52), woodMat,
       [0.012, 0.677, 0.136]);
  mesh(new THREE.BoxGeometry(0.02, 0.012, 1.53), cp.polished,
       [-0.022, 0.745, 0.136]);
  framePanel(0.61, 0.29, 0.025, 0.055, cp.black, [-0.032, 0.683, -0.31]);
  dial('KM/H', 'SPEED', 240, -0.047, 0.705, -0.48, 0.285);
  dial('RPM', 'x1000', 8, -0.047, 0.705, -0.16, 0.285);
  dial('FUEL', 'E  /  F', 100, -0.047, 0.674, 0.19, 0.142);
  dial('OIL', 'PRESS', 100, -0.047, 0.674, 0.36, 0.142);
  mesh(new THREE.BoxGeometry(0.83, 0.24, 0.30), cp.leather,
       [0.03, 0.39, 0.13]);
  mesh(new THREE.CylinderGeometry(0.031, 0.037, 0.29, 16),
       cp.polished, [-0.20, 0.55, 0.15]);
  mesh(new THREE.SphereGeometry(0.061, 16, 12), cp.black,
       [-0.20, 0.71, 0.15]);
  for (let i = 0; i < 4; i++) {
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 12),
         cp.satin, [0.006, 0.63, 0.52 + i * 0.075], [Math.PI / 2, 0, 0]);
  }
  // Swept A-pillars, header rail and a faint windscreen.
  const bottomL = [0.87, 0.835, -0.735], bottomR = [0.87, 0.835, 0.94];
  const topL = [0.27, 1.315, -0.70], topR = [0.27, 1.315, 0.90];
  rodBetween(bottomL, topL, 0.043, cp.polished);
  rodBetween(bottomR, topR, 0.043, cp.polished);
  rodBetween(topL, topR, 0.04, cp.leather);
  mesh(new THREE.BoxGeometry(0.17, 0.042, 1.60), cp.black,
       [0.32, 1.345, 0.11]);
  rodBetween([0.86, 0.86, -0.73], [0.86, 0.86, 0.92], 0.036, cp.polished);
  mesh(new THREE.BoxGeometry(0.21, 0.12, 0.34), cp.black,
       [0.31, 1.23, 0.07]);
  mesh(new THREE.BoxGeometry(0.025, 0.099, 0.25),
       new THREE.MeshStandardMaterial(
         { color: 0x4a5b60, roughness: 0.13, metalness: 0.35 }),
       [0.19, 1.24, 0.065]);
  // Door trim visible in peripheral vision.
  mesh(new THREE.BoxGeometry(0.90, 0.40, 0.055), cp.leather,
       [-0.24, 0.59, -0.70]);
  mesh(new THREE.BoxGeometry(0.8, 0.036, 0.062), woodMat,
       [-0.22, 0.76, -0.67]);
  mesh(new THREE.BoxGeometry(0.8, 0.026, 0.06), cp.satin,
       [-0.23, 0.79, -0.66]);
  rodBetween([-0.10, 0.68, -0.665], [0.19, 0.68, -0.665], 0.014,
             cp.polished);
  const winGeo = new THREE.BufferGeometry();
  winGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [...bottomL, ...bottomR, ...topL, ...topL, ...bottomR, ...topR], 3));
  winGeo.computeVertexNormals();
  mesh(winGeo, cp.glass);
  // Hood in Aston racing green, with a stitched center stripe.
  const points = [], uvs = [], idx = [];
  for (let i = 0; i <= 22; i++) {
    const t = i / 22, x = 0.80 + t * 1.45;
    const y = 0.827 - t * 0.082 + 0.015 * Math.sin(Math.PI * t);
    const halfW = 0.70 - t * 0.1;
    for (let j = 0; j <= 14; j++) {
      const w = j / 14 * 2 - 1, z = 0.115 + w * halfW;
      points.push(x, y - 0.047 * w * w, z);
      uvs.push(t, j / 14);
      if (i < 22 && j < 14) {
        const k = i * 15 + j;
        idx.push(k, k + 15, k + 1, k + 1, k + 15, k + 16);
      }
    }
  }
  const hood = new THREE.BufferGeometry();
  hood.setIndex(idx);
  hood.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  hood.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  hood.computeVertexNormals();
  mesh(hood, cp.green);
  rodBetween([0.89, 0.843, 0.12], [2.13, 0.755, 0.12], 0.0055,
    new THREE.MeshStandardMaterial(
      { color: 0x678b67, roughness: 0.29, metalness: 0.32 }));

  // Wood-rim wheel; the caller rotates steeringColumn.rotation.x with
  // the steer input (+-149 deg at full lock).
  const steeringColumn = new THREE.Group();
  steeringColumn.position.set(-0.105, 0.768, -0.352);
  group.add(steeringColumn);
  const wheelMesh = (g, m, p, r) => {
    const mm = new THREE.Mesh(g, m);
    if (p) mm.position.set(...p);
    if (r) mm.rotation.set(...r);
    steeringColumn.add(mm);
    return mm;
  };
  wheelMesh(new THREE.TorusGeometry(0.235, 0.030, 15, 72), woodMat,
            [0, 0, 0], [0, Math.PI / 2, 0]);
  wheelMesh(new THREE.TorusGeometry(0.218, 0.005, 8, 70), cp.polished,
            [0, 0, 0], [0, Math.PI / 2, 0]);
  for (const deg of [90, 210, 330]) {
    const a = THREE.MathUtils.degToRad(deg);
    rodBetween([-0.013, 0, 0],
      [-0.013, Math.cos(a) * 0.21, Math.sin(a) * 0.21],
      0.018, cp.polished, steeringColumn);
    rodBetween(
      [-0.013, Math.cos(a + 0.13) * 0.063, Math.sin(a + 0.13) * 0.063],
      [-0.013, Math.cos(a + 0.13) * 0.195, Math.sin(a + 0.13) * 0.195],
      0.0042, cp.satin, steeringColumn, 8);
  }
  wheelMesh(new THREE.CylinderGeometry(0.063, 0.063, 0.048, 36),
            cp.polished, [-0.01, 0, 0], [0, 0, -Math.PI / 2]);
  wheelMesh(new THREE.CylinderGeometry(0.041, 0.041, 0.05, 30),
            new THREE.MeshStandardMaterial(
              { color: 0x214431, roughness: 0.32, metalness: 0.25 }),
            [-0.047, 0, 0], [0, 0, -Math.PI / 2]);
  // Seats.
  mesh(new THREE.BoxGeometry(0.62, 0.70, 0.55), cp.leather,
       [-0.62, 0.60, 0.53]);
  mesh(new THREE.BoxGeometry(0.64, 0.15, 0.56), cp.leather,
       [-0.65, 0.27, 0.53]);

  return { group, cameraMount, steeringColumn, dials };
}
