// Vue HUD. Components are plain objects with template strings —
// no build step, matching the rest of the engine. Engine callbacks
// (preset cycling etc.) are provided down as `actions`.
import { createApp } from 'vue';
import { store } from './store.js';

const Hud = {
  inject: ['actions'],
  template: `
    <div class="hud-panel hud-title">
      BLUE HOUR <span class="stage">· stage {{ store.stage }}</span>
    </div>
    <div class="hud-panel hud-actions">
      <button @click="actions.cyclePreset">LIGHT: {{ store.preset }}</button>
    </div>
    <div class="hud-panel hud-status">
      <div v-if="!store.webgl" class="dim">NO WEBGL — open in a browser
with GPU acceleration to render</div>
      {{ store.status }}
      <div v-if="store.env" class="dim">{{ store.env }}</div>
      <div v-if="store.queueDone + store.queueFailed > 0" class="dim">
        assets {{ store.queueDone }} ok / {{ store.queueFailed }} failed
      </div>
    </div>
    <div class="hud-panel hud-perf" v-if="store.webgl">
      {{ store.fps }} fps · {{ store.draws }} calls
      <div class="dim">{{ store.tris.toLocaleString() }} tris</div>
    </div>`,
  setup() { return { store }; }
};

export function createHud(actions = {}) {
  const app = createApp({
    provide: { actions },
    template: '<Hud />',
    components: { Hud }
  });
  return app.mount('#ui');
}
