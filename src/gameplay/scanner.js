// Scanner: the Arcforge's V-key survey pulse. Fires an expanding
// ground-hugging ring across the terrain, then catalogues everything it
// swept — resource deposits, ruins, beacons, outposts, wrecks, pads and the
// nearest creature — into a persistent waypoint marker list the UI layer
// projects each frame. Creature/flora discoveries still bank Lumens.
//
// CONTRACT:
//   const scanner = new Scanner(gameState);
//   scanner.scan(surfaceState)  // V pressed (6 s cooldown)
//   scanner.markers             // [{ id, worldPos, kind, label, color? }]
//   scanner.update(dt)          // ring animation + marker expiry
import * as THREE from 'three';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';
import { ITEMS } from './items.js';

const COOLDOWN = 6;             // seconds between pulses
const PULSE_DUR = 1.2;          // ring expansion time
const PULSE_RADIUS = 350;       // final ring radius (m)
const COLLECT_DELAY = 900;      // ms after pulse start before POIs resolve
const POI_RANGE = 400;          // props catalogued within this range (m)
const CREATURE_RANGE = 120;     // creature scan reach (m)
const MARKER_TTL = 300;         // markers persist 5 min (or until next scan)
const MAX_FOUND = 20;           // leave pool headroom for quest markers
const RING_SEGS = 160;

/** static label + tint per prop kind; nodes resolve through ITEMS */
function describeProp(p) {
  switch (p.kind) {
    case 'node': {
      const item = ITEMS[p.itemId];
      return {
        label: `${(item?.name ?? p.itemId ?? 'Resource').toUpperCase()} DEPOSIT`,
        color: item?.color,
      };
    }
    case 'ruin': return { label: 'LUMINEL RUIN' };
    case 'beacon': return { label: 'LUMINEL BEACON' };
    case 'outpost': return { label: 'MERIDIAN OUTPOST' };
    case 'crash': return { label: 'CRASHED HULL' };
    case 'pad': return { label: 'LANDING PAD' };
    default: return null;
  }
}

export class Scanner {
  /** @param {object} gs GameState (discover/stats/lumens) */
  constructor(gs) {
    this.gs = gs;
    this._last = -Infinity;
    this._markers = [];
    this._expireAt = 0;
    this._ring = null;
    this._collectTimer = null;
  }

  /** Current marker list — persists until the next scan or 5 minutes. */
  get markers() { return this._markers; }

  /**
   * Fire a survey pulse from the player's position.
   * @param {object} surface the active SurfaceState (scene/field/props/creatures)
   */
  scan(surface) {
    const now = performance.now() / 1000;
    if (now - this._last < COOLDOWN) return;
    this._last = now;
    audio.sfx('scan');
    events.emit('scanner:pulse');
    this._spawnRing(surface);
    clearTimeout(this._collectTimer);
    this._collectTimer = setTimeout(() => this._collect(surface), COLLECT_DELAY);
  }

  /**
   * Advance the pulse ring and expire stale markers.
   * @param {number} dt seconds (timing itself is wall-clock)
   */
  update(dt) {
    const now = performance.now() / 1000;
    if (this._ring) this._updateRing(now);
    if (this._markers.length && now > this._expireAt) this._markers = [];
  }

  // ---- POI collection --------------------------------------------------------

  _collect(surface) {
    if (!surface?.player) return;
    const pos = surface.player.position;
    const found = [];
    const seen = new Set();

    // world props within range, nearest first
    const cands = [];
    for (const p of surface.props?.all ?? []) {
      const d = p.position.distanceTo(pos);
      if (d <= POI_RANGE) cands.push([d, p]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [, p] of cands) {
      if (found.length >= MAX_FOUND) break;
      const id = `${p.kind}:${Math.round(p.position.x)}:${Math.round(p.position.z)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const info = describeProp(p);
      if (!info) continue;
      found.push({ id, worldPos: p.position.clone(), kind: p.kind, label: info.label, color: info.color });
    }

    // nearest creature — discovery grants Lumens exactly as before
    const creature = surface.creatures?.scanNearest?.(pos, CREATURE_RANGE);
    if (creature) {
      const key = `${surface.def.id}:${creature.name}`;
      if (this.gs.discover('creatures', key, creature.name, 90)) {
        this.gs.stats.creaturesScanned += 1;
      }
      found.push({
        id: `creature:${key}`, worldPos: creature.position.clone(),
        kind: 'creature', label: creature.name.toUpperCase(),
      });
    }

    // catalogue the local flora family once per planet (no marker)
    if (surface.def?.floraDensity > 0.05) {
      this.gs.discover('flora', `${surface.def.id}:flora`, `${surface.def.name} flora`, 45);
    }

    this._markers = found;
    this._expireAt = performance.now() / 1000 + MARKER_TTL;
    audio.sfx('scanDone');
    events.emit('notify', found.length
      ? { text: `${found.length} SIGNAL${found.length === 1 ? '' : 'S'} FOUND`, tone: 'info' }
      : { text: 'SCAN COMPLETE — NO SIGNALS IN RANGE', tone: 'info' });
  }

  // ---- pulse ring visual -------------------------------------------------------

  _spawnRing(surface) {
    this._disposeRing();
    if (!surface?.scene || !surface.player) return;
    const dirs = new Float32Array(RING_SEGS * 2);
    for (let i = 0; i < RING_SEGS; i++) {
      const a = (i / RING_SEGS) * Math.PI * 2;
      dirs[i * 2] = Math.cos(a);
      dirs[i * 2 + 1] = Math.sin(a);
    }
    // vertex pairs [inner_i, outer_i] stitched into a band
    const positions = new Float32Array(RING_SEGS * 2 * 3);
    const index = [];
    for (let i = 0; i < RING_SEGS; i++) {
      const j = (i + 1) % RING_SEGS;
      const a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
      index.push(a, b, c, b, d, c);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(index);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.55, 1.9, 2.4), // HDR cyan — feeds bloom
      transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false; // positions are absolute + rewritten per frame
    mesh.renderOrder = 4;
    surface.scene.add(mesh);
    this._ring = {
      mesh, geom, mat, dirs,
      scene: surface.scene,
      field: surface.field ?? null,
      origin: surface.player.position.clone(),
      start: performance.now() / 1000,
    };
    this._updateRing(this._ring.start);
  }

  _updateRing(now) {
    const r = this._ring;
    const t = (now - r.start) / PULSE_DUR;
    if (t >= 1) { this._disposeRing(); return; }
    const e = 1 - Math.pow(1 - Math.max(0, t), 2.2); // ease-out sweep
    const radius = Math.max(0.6, PULSE_RADIUS * e);
    const width = 3.5 + radius * 0.035;
    const inner = Math.max(0.05, radius - width);
    const pos = r.geom.attributes.position.array;
    const seaY = r.field ? r.field.seaY : -Infinity;
    for (let i = 0; i < RING_SEGS; i++) {
      const dx = r.dirs[i * 2], dz = r.dirs[i * 2 + 1];
      const k = i * 6;
      let x = r.origin.x + dx * inner, z = r.origin.z + dz * inner;
      let y = r.field ? Math.max(r.field.height(x, z), seaY) : r.origin.y;
      pos[k] = x; pos[k + 1] = y + 1.1; pos[k + 2] = z;
      x = r.origin.x + dx * radius; z = r.origin.z + dz * radius;
      y = r.field ? Math.max(r.field.height(x, z), seaY) : r.origin.y;
      pos[k + 3] = x; pos[k + 4] = y + 1.1; pos[k + 5] = z;
    }
    r.geom.attributes.position.needsUpdate = true;
    r.mat.opacity = 0.9 * Math.pow(1 - t, 0.8);
  }

  _disposeRing() {
    const r = this._ring;
    if (!r) return;
    r.scene.remove(r.mesh);
    r.geom.dispose();
    r.mat.dispose();
    this._ring = null;
  }
}
