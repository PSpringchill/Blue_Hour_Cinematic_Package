// Reactive UI state. The engine publishes into this store (via the
// event bus or direct writes) and Vue renders it — DOM ids are never
// touched by engine code.
import { reactive } from 'vue';

export const store = reactive({
  stage: 'PBR',
  status: 'booting…',
  preset: 'BLUE',
  env: '',
  fps: 0,
  draws: 0,
  tris: 0,
  queueDone: 0,
  queueFailed: 0,
  webgl: true
});
