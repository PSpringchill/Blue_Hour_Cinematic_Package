// ================================================================
// Kalman sensor fusion for the autopilot.
//
// The six lidar rays measure *position only* — the distance to the
// first surface along a fixed bearing. A constant-velocity Kalman
// filter turns those position samples into a smoothed estimate with
// a closing-rate velocity, and the tracker keeps one filter pair
// (along-route s, lateral x) per car inside the scan window so the
// controller can brake on time-to-collision and plan overtakes
// against *predicted* positions instead of raw samples.
// ================================================================

// Constant-velocity 1-D filter: state [p, v], F = [[1, dt], [0, 1]],
// measurement z = p. Symmetric random-walk process noise on both
// states keeps gains honest between measurements.
export class KalmanFilter {
  constructor(processNoise = 4, measureNoise = 2) {
    this.q = processNoise;
    this.r = measureNoise;
    this.reset(0);
  }
  reset(p = 0, v = 0) {
    this.p = p;
    this.v = v;
    this.p00 = 16; this.p01 = 0;
    this.p10 = 0;  this.p11 = 16;
    return this;
  }
  predict(dt) {
    this.p += this.v * dt;
    const qd = this.q * dt;
    const p00 = this.p00 + dt * (this.p10 + this.p01) +
      dt * dt * this.p11;
    const p01 = this.p01 + dt * this.p11;
    const p10 = this.p10 + dt * this.p11;
    this.p00 = p00 + qd;
    this.p01 = p01;
    this.p10 = p10;
    this.p11 = this.p11 + qd;
  }
  update(z) {
    const s = this.p00 + this.r;
    const k0 = this.p00 / s;
    const k1 = this.p10 / s;
    const y = z - this.p;
    this.p += k0 * y;
    this.v += k1 * y;
    const p00 = this.p00, p01 = this.p01;
    this.p00 = p00 - k0 * p00;
    this.p01 = p01 - k0 * p01;
    this.p10 = this.p10 - k1 * p00;
    this.p11 = this.p11 - k1 * p01;
  }
  step(z, dt) {
    this.predict(dt);
    this.update(z);
    return this;
  }
}

// One filter pair per observed car. s runs along the route (so an
// oncoming car has negative s.v), x is the lateral lane offset.
class ObstacleTrack {
  constructor(car) {
    this.car = car;
    this.s = new KalmanFilter(9, 1.4);   // fast process: cars can brake
    this.x = new KalmanFilter(3, 0.9);   // lateral wanders slowly
    this.missed = 0;
  }
}

// Tracks are keyed by car object identity — the traffic pool reuses
// car objects, and recycled cars teleport, which is rejected by the
// 30 m jump gate and re-initialised instead of corrupting velocity.
export class ObstacleTracker {
  constructor(scanRange = 120) {
    this.scanRange = scanRange;
    this.tracks = new Map();
  }
  update(dt, cars, egoS) {
    for (const [car, track] of this.tracks) {
      track.s.predict(dt);
      track.x.predict(dt);
      track.missed++;
      if (track.missed > 45 ||
          Math.abs(track.s.p - egoS) > this.scanRange) {
        this.tracks.delete(car);
      }
    }
    for (const car of cars) {
      if (Math.abs(car.s - egoS) > this.scanRange) continue;
      let track = this.tracks.get(car);
      if (!track) {
        track = new ObstacleTrack(car);
        track.s.reset(car.s);
        track.x.reset(car.x);
        this.tracks.set(car, track);
      }
      if (Math.abs(car.s - track.s.p) > 30) {
        track.s.reset(car.s);
        track.x.reset(car.x);
      } else {
        track.s.update(car.s);
        track.x.update(car.x);
      }
      track.missed = 0;
    }
    return this.tracks;
  }
  reset() {
    this.tracks.clear();
  }
}

// Predicted s/x of a tracked car `horizon` seconds ahead under the
// filtered velocity — the inputs the controller actually acts on.
export function predictAt(track, horizon) {
  return {
    s: track.s.p + track.s.v * horizon,
    x: track.x.p + track.x.v * horizon
  };
}
