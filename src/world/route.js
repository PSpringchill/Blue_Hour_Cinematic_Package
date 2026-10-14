// Route geometry: heading/elevation sine tables + the path ring that
// integrates heading into XZ positions. All shape constants live in
// core/config.js (ROUTE) so a new map is a data change.
import { clamp, lerp } from '../core/math.js';
import { CFG, ROUTE } from '../core/config.js';

// Mountain route: low frequencies give the large wander that lets the
// road double back on itself, high frequencies hook tight switchbacks.
export function headingAt(s) {
  let h = ROUTE.headingBias;
  for (const [amp, freq, phase] of ROUTE.heading) {
    h += amp * Math.sin(s * freq + phase);
  }
  return h;
}

export function curvatureAt(s) {
  let k = 0;
  for (const [amp, freq, phase] of ROUTE.heading) {
    k += amp * freq * Math.cos(s * freq + phase);
  }
  return k;
}

export function elevationAt(s) {
  let y = 0;
  for (const [amp, freq, phase] of ROUTE.elevation) {
    y += amp * Math.sin(s * freq + phase);
  }
  return y;
}

export function gradeAt(s) {
  let g = 0;
  for (const [amp, freq, phase] of ROUTE.elevation) {
    g += amp * freq * Math.cos(s * freq + phase);
  }
  return g;
}

// At curvature k the road bends onto itself beyond lateral 1/k;
// terrain and scatter must clamp inside of hairpins or they fold
// back across the pavement.
export function turnLimit(p) {
  const k = Math.abs(p.curvature);
  return k > 1e-5 ? Math.min(90, 0.82 / k) : 90;
}
export function clampInside(p, lateral) {
  if (p.curvature * lateral <= 0) return lateral;
  const limit = Math.max(9.7, turnLimit(p) - 2);
  return Math.sign(lateral) * Math.min(Math.abs(lateral), limit);
}

export class PathRing {
  constructor() {
    this.x = new Float64Array(CFG.pathCapacity);
    this.z = new Float64Array(CFG.pathCapacity);
    this.ids = new Int32Array(CFG.pathCapacity).fill(-1);
    this.ids[0] = 0;
    this.last = 0;
    this.lastX = 0;
    this.lastZ = 0;
  }

  ensure(s) {
    const target = Math.ceil(s / CFG.pathStep) + 1;
    while (this.last < target) {
      const next = this.last + 1;
      const h = headingAt((this.last + 0.5) * CFG.pathStep);
      this.lastX += Math.sin(h) * CFG.pathStep;
      this.lastZ += Math.cos(h) * CFG.pathStep;
      const slot = next % CFG.pathCapacity;
      this.x[slot] = this.lastX;
      this.z[slot] = this.lastZ;
      this.ids[slot] = next;
      this.last = next;
    }
  }

  sample(s, out) {
    s = Math.max(0, s);
    const q = s / CFG.pathStep;
    const index = Math.floor(q);
    const a = index % CFG.pathCapacity;
    const b = (index + 1) % CFG.pathCapacity;

    // Reads must stay inside the active window; AI outside it is hidden.
    if (this.ids[a] !== index || this.ids[b] !== index + 1) {
      throw new Error('Path sample outside the active ring window.');
    }

    const t = q - index;
    out.x = lerp(this.x[a], this.x[b], t);
    out.z = lerp(this.z[a], this.z[b], t);
    out.y = elevationAt(s);
    out.heading = headingAt(s);
    out.curvature = curvatureAt(s);
    out.bank = -clamp(out.curvature * ROUTE.bankScale,
                      -ROUTE.bankClamp, ROUTE.bankClamp);
    out.grade = gradeAt(s);
    return out;
  }
}

// Terrain height offset relative to the path sample at (s, lateral).
export function groundOffset(p, s, lateral) {
  const outer = Math.max(0, Math.abs(lateral) - 8);
  const hill = Math.sin(s * 0.009 + lateral * 0.043) * 0.19
             + Math.sin(s * 0.0028 - lateral * 0.077) * 0.28;
  // Broad swells grow with distance from the road corridor, so the
  // corridor itself stays even while the forest floor rolls in hills.
  const swell =
    Math.sin(s * 0.0019 + Math.abs(lateral) * 0.021 + 2.1) *
    Math.sin(s * 0.00073 - lateral * 0.011 + 0.6) *
    Math.min(outer, 64) * 0.11;
  const lumps =
    Math.sin(s * 0.11 + lateral * 0.31) * Math.min(outer, 12) * 0.028;
  return lateral * p.bank - 0.11
       + outer * 0.047 + outer * hill * 0.13
       + Math.sin(s * 0.045 + lateral * 0.20) * Math.min(outer, 20) * 0.035
       + swell + lumps;
}
