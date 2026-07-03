// GameState — the single mutable record of a playthrough: vitals, inventory,
// ship, discoveries, quests, bases. Persisted to localStorage.
import { events } from '../core/events.js';
import { hashString, RNG } from '../core/rng.js';
import { ITEMS } from './items.js';

const SAVE_KEY = 'ams-save-v1';           // legacy single-slot key (migrated)
const SLOT_KEY = (n) => `ams-save-v1:slot${n}`;
export const SAVE_SLOTS = 3;
export const BASE_SLOTS = 24;

export class GameState {
  constructor(galaxySeed = 1337) {
    this.version = 1;
    this.slot = 1;                    // save slot this run writes to
    this.galaxySeed = galaxySeed;
    this.currentSystemId = null;      // set on new game / load
    this.visitedSystems = [];
    // location.mode: 'space' | 'surface'
    this.location = { mode: 'space', planetIndex: -1, pos: null, landingPos: null };

    this.healthMax = 100; this.health = 100;
    this.shieldMax = 50;  this.shield = 50;
    this.oxygenMax = 100; this.oxygen = 100;
    this.energyMax = 100; this.energy = 100;   // suit power (hazard protection)
    this.jetpack = 1;                          // 0..1, transient but saved
    this.lumens = 250;

    this.inventory = [];               // [{id, qty}] — one entry per item type
    this.upgrades = { shipSpeed: 0, shipShield: 0, shipCargo: 0, toolMine: 0, toolBolt: 0, suitEnergy: 0 };

    this.ship = {
      class: 'swift',
      seed: hashString('first-light'),
      name: 'First Light',
      hullMax: 100, hull: 100,
      shieldMax: 60, shield: 60,
      fuel: 1,                         // 0..1 launch fuel
      warpCells: 1,
    };
    this.tool = { mode: 'mine' };      // 'mine' | 'bolt'

    this.discoveries = { systems: {}, planets: {}, creatures: {}, flora: {}, ruins: {} };
    this.quests = { active: [], completed: [], vesperDepth: 0, vesperTarget: null };
    this.bases = [];                   // [{systemId, planetIndex, pieces:[{kind,x,y,z,rotY}]}]
    this.digs = {};                    // planetId → [[x,z,r,d]] terrain excavations
    this.language = { known: [] };     // learned Luminel words
    this.exocraft = { unlocked: false }; // rover summonable once purchased
    this.stats = { warps: 0, planetsVisited: 0, creaturesScanned: 0, distanceOnFoot: 0 };
  }

  // ---- inventory ----
  get maxSlots() { return BASE_SLOTS + this.upgrades.shipCargo * 8 + (this.ship.stats?.cargoBonus ?? 0); }
  usedSlots() { return this.inventory.length; }

  countItem(id) { return this.inventory.find((s) => s.id === id)?.qty ?? 0; }

  /** add items; returns qty actually added (0 if no room) */
  addItem(id, qty = 1) {
    if (!ITEMS[id] || qty <= 0) return 0;
    const stackMax = ITEMS[id].stack;
    let slot = this.inventory.find((s) => s.id === id);
    if (!slot) {
      if (this.inventory.length >= this.maxSlots) { events.emit('notify', { text: 'CARGO FULL', tone: 'warn' }); return 0; }
      slot = { id, qty: 0 };
      this.inventory.push(slot);
    }
    const added = Math.min(qty, stackMax - slot.qty);
    slot.qty += added;
    if (added > 0) events.emit('inventory:changed');
    if (added < qty) events.emit('notify', { text: `${ITEMS[id].name} stack full`, tone: 'warn' });
    return added;
  }

  /** remove items; returns true if the full qty was available and removed */
  removeItem(id, qty = 1) {
    const slot = this.inventory.find((s) => s.id === id);
    if (!slot || slot.qty < qty) return false;
    slot.qty -= qty;
    if (slot.qty === 0) this.inventory.splice(this.inventory.indexOf(slot), 1);
    events.emit('inventory:changed');
    return true;
  }

  hasItems(list) { return list.every(({ id, qty }) => this.countItem(id) >= qty); }
  removeItems(list) {
    if (!this.hasItems(list)) return false;
    list.forEach(({ id, qty }) => this.removeItem(id, qty));
    return true;
  }

  addLumens(n) {
    this.lumens = Math.max(0, this.lumens + n);
    events.emit('inventory:changed');
  }

  // ---- discoveries ----
  discover(kind, key, name, value) {
    const book = this.discoveries[kind];
    if (!book || book[key]) return false;
    book[key] = { name, at: this.currentSystemId };
    this.addLumens(value);
    events.emit('discovery:new', { kind, name, value });
    return true;
  }

  // ---- persistence (3 slots; legacy single-key saves migrate to slot 1) ----
  save() {
    try {
      this.savedAt = Date.now();
      localStorage.setItem(SLOT_KEY(this.slot ?? 1), JSON.stringify(this));
      events.emit('notify', { text: 'PROGRESS SAVED', tone: 'good' });
      return true;
    } catch (e) { console.error('save failed', e); return false; }
  }

  static _migrateLegacy() {
    try {
      const legacy = localStorage.getItem(SAVE_KEY);
      if (legacy && !localStorage.getItem(SLOT_KEY(1))) {
        localStorage.setItem(SLOT_KEY(1), legacy);
        localStorage.removeItem(SAVE_KEY);
      }
    } catch { /* ignore */ }
  }

  static hasSave(slot = null) {
    GameState._migrateLegacy();
    try {
      if (slot != null) return !!localStorage.getItem(SLOT_KEY(slot));
      for (let n = 1; n <= SAVE_SLOTS; n++) if (localStorage.getItem(SLOT_KEY(n))) return true;
      return false;
    } catch { return false; }
  }

  /** light metadata for the load menu: [{slot, systemId, lumens, warps, savedAt} | null] */
  static listSaves() {
    GameState._migrateLegacy();
    const out = [];
    for (let n = 1; n <= SAVE_SLOTS; n++) {
      try {
        const raw = localStorage.getItem(SLOT_KEY(n));
        if (!raw) { out.push(null); continue; }
        const d = JSON.parse(raw);
        out.push({
          slot: n,
          systemId: d.currentSystemId,
          lumens: d.lumens ?? 0,
          warps: d.stats?.warps ?? 0,
          mode: d.location?.mode ?? 'space',
          savedAt: d.savedAt ?? null,
        });
      } catch { out.push(null); }
    }
    return out;
  }

  /** most recently saved slot number, or null */
  static latestSlot() {
    const saves = GameState.listSaves().filter(Boolean);
    if (!saves.length) return null;
    saves.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    return saves[0].slot;
  }

  static load(slot = null) {
    GameState._migrateLegacy();
    try {
      const n = slot ?? GameState.latestSlot();
      if (!n) return null;
      const raw = localStorage.getItem(SLOT_KEY(n));
      if (!raw) return null;
      const data = JSON.parse(raw);
      const gs = new GameState(data.galaxySeed);
      Object.assign(gs, data);
      gs.slot = n;
      return gs;
    } catch (e) { console.error('load failed', e); return null; }
  }

  static clearSave(slot = 1) { try { localStorage.removeItem(SLOT_KEY(slot)); } catch { /* ignore */ } }

  /** deterministic RNG stream tied to this playthrough */
  rng(label) { return new RNG(hashString(`${this.galaxySeed}:${label}`)); }
}
