// Fixed-step simulation loop. Physics advances in CFG.fixedStep
// increments from an accumulator (deterministic regardless of frame
// rate); render runs once per rAF with the wall-clock delta.
import { CFG } from './config.js';

export function createLoop({ step, render }) {
  let accumulator = 0;
  let previous = performance.now();
  let running = true;
  let paused = false;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    if (!paused) {
      accumulator += dt;
      while (accumulator >= CFG.fixedStep) {
        step(CFG.fixedStep);
        accumulator -= CFG.fixedStep;
      }
    }
    render(dt, now / 1000);
  }

  return {
    start() { previous = performance.now(); requestAnimationFrame(frame); },
    stop() { running = false; },
    pause(v) { paused = v === undefined ? !paused : v; },
    get paused() { return paused; }
  };
}
