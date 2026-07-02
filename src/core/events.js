// Global event bus. Systems communicate through named events rather than
// direct references so modules stay decoupled and testable.

class EventBus {
  constructor() { this._handlers = new Map(); }

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  once(event, fn) {
    const off = this.on(event, (...args) => { off(); fn(...args); });
    return off;
  }

  off(event, fn) {
    const set = this._handlers.get(event);
    if (set) set.delete(fn);
  }

  emit(event, ...args) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(...args); }
      catch (err) { console.error(`[events] handler for "${event}" threw`, err); }
    }
  }
}

export const events = new EventBus();

// Well-known events (documented here so systems agree on names/payloads):
//   'state:change'        (newStateName, oldStateName)
//   'player:damage'       ({ amount, type })
//   'player:death'        ()
//   'inventory:changed'   ()
//   'resource:mined'      ({ id, amount })
//   'discovery:new'       ({ kind, name, value })  kind: 'planet'|'creature'|'flora'|'system'|'ruin'
//   'quest:updated'       (quest)
//   'notify'              ({ text, icon?, tone? }) tone: 'info'|'good'|'warn'|'danger'
//   'ship:landed'         (planet)
//   'ship:takeoff'        ()
//   'warp:begin'          (targetSystem)
//   'warp:end'            (system)
//   'combat:hit'          ({ target, damage })
//   'audio:play'          (sfxName, opts?)
