// Streams world props (ruins, beacons, outposts, crashed ships, resource
// nodes) on a coarse 256m macro-cell grid around the player. Deterministic
// per planet+cell, so revisits find the same world.
import * as THREE from 'three';
import {
  createRuin, createBeacon, createOutpost, createCrashedShip,
  createResourceNode, createLandingPad,
} from '../render/props.js';
import { createKnowledgeStone } from '../render/knowledgestone.js';
import { ruinLore } from '../universe/lore.js';

const CELL = 256;
const RANGE = 3;          // cells in each direction

export class PropManager {
  constructor(scene, planetDef, field) {
    this.scene = scene;
    this.def = planetDef;
    this.field = field;
    this.cells = new Map();   // 'cx:cz' -> { props: [placed] }
    this.all = [];            // flat list of active placed props
  }

  update(focusPos) {
    const ccx = Math.floor(focusPos.x / CELL), ccz = Math.floor(focusPos.z / CELL);
    const want = new Set();
    for (let dx = -RANGE; dx <= RANGE; dx++) {
      for (let dz = -RANGE; dz <= RANGE; dz++) {
        const cx = ccx + dx, cz = ccz + dz;
        const key = `${cx}:${cz}`;
        want.add(key);
        if (!this.cells.has(key)) this._spawnCell(cx, cz, key);
      }
    }
    for (const [key, cell] of this.cells) {
      if (!want.has(key)) {
        for (const p of cell.props) {
          this.scene.remove(p.object3d);
          p.dispose?.();
          this.all.splice(this.all.indexOf(p), 1);
        }
        this.cells.delete(key);
      }
    }
  }

  _spawnCell(cx, cz, key) {
    const rng = this.field.cellRng(cx, cz, 'props');
    const props = [];
    const place = (built, extra = {}) => {
      const x = (cx + rng.next()) * CELL, z = (cz + rng.next()) * CELL;
      const y = this.field.height(x, z);
      if (y < this.field.seaY + 0.5) return null;   // don't drown structures
      built.object3d.position.set(x, y, z);
      built.object3d.rotation.y = rng.next() * Math.PI * 2;
      this.scene.add(built.object3d);
      const placed = { ...built, ...extra, position: built.object3d.position, cellKey: key };
      props.push(placed);
      this.all.push(placed);
      return placed;
    };

    // resource nodes — the bread of the mining loop
    const nodeCount = rng.int(0, 3);
    for (let i = 0; i < nodeCount; i++) {
      const itemId = rng.pick(this.def.resources);
      place(createResourceNode(itemId, rng.fork(`node${i}`)), { itemId, hp: 4, kind: 'node' });
    }
    if (rng.chance(this.def.crystalDensity * 0.5)) {
      place(createResourceNode(rng.pick(['aurium', 'cryostal', 'voltglass']), rng.fork('rare')), {
        itemId: rng.pick(['aurium', 'cryostal', 'voltglass']), hp: 6, kind: 'node',
      });
    }

    // landmark structures — rare, memorable
    if (this.def.hasRuins && rng.chance(0.10)) {
      place(createRuin(rng.fork('ruin')), { kind: 'ruin', lore: ruinLore(rng.fork('lore')) });
    }
    if (rng.chance(0.045)) {
      place(createBeacon(rng.fork('beacon')), { kind: 'beacon', lore: ruinLore(rng.fork('blore')) });
    }
    if (this.def.hasOutpost && rng.chance(0.05)) {
      const o = place(createOutpost(rng.fork('outpost'), 'meridian'), { kind: 'outpost' });
      if (o) {
        const pad = createLandingPad(rng.fork('pad'));
        pad.object3d.position.copy(o.object3d.position).add(new THREE.Vector3(14, 0, 6));
        pad.object3d.position.y = this.field.height(pad.object3d.position.x, pad.object3d.position.z);
        this.scene.add(pad.object3d);
        props.push({ ...pad, kind: 'pad', position: pad.object3d.position, cellKey: key });
      }
    }
    if (rng.chance(0.035)) {
      place(createCrashedShip(rng.fork('crash')), { kind: 'crash', salvaged: false });
    }
    // Luminel knowledge stones — teach a word when touched
    if (rng.chance(0.12)) {
      place(createKnowledgeStone(rng.fork('stone')), { kind: 'stone' });
    }

    this.cells.set(key, { props });
  }

  /** advance any props with a pulse/animation (knowledge stones, etc.) */
  animate(dt) {
    for (const p of this.all) p.update?.(dt);
  }

  /** nearest interactable prop within range of pos */
  nearest(pos, range = 5) {
    let best = null, bestD = range;
    for (const p of this.all) {
      const d = pos.distanceTo(p.position);
      const r = bestD + (p.interactRadius ?? 0);
      if (d < r) { best = p; bestD = d; }
    }
    return best;
  }

  remove(prop) {
    this.scene.remove(prop.object3d);
    const i = this.all.indexOf(prop);
    if (i >= 0) this.all.splice(i, 1);
    const cell = this.cells.get(prop.cellKey);
    if (cell) {
      const j = cell.props.indexOf(prop);
      if (j >= 0) cell.props.splice(j, 1);
    }
  }

  dispose() {
    for (const p of this.all) { this.scene.remove(p.object3d); p.dispose?.(); }
    this.all.length = 0;
    this.cells.clear();
  }
}
