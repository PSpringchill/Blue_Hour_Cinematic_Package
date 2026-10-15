// Minimal event bus — decouples engine layers. Subsystems publish
// lifecycle signals ('chunk:rebuild', 'asset:loaded', 'preset:apply')
// instead of reaching across modules.
export class EventBus {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, []);
    this.map.get(type).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.map.get(type);
    if (list) list.splice(list.indexOf(fn) >>> 0, 1);
  }
  emit(type, data) {
    for (const fn of this.map.get(type) || []) fn(data);
  }
}
