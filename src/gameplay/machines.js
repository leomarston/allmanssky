// Base machines: refiners (timed element transmutation) and bio planters
// (crop growth). Machines work over WALL-CLOCK time — job/crop timestamps are
// epoch ms persisted directly on the base-piece record (rec) that BaseBuilder
// stores in gameState.bases, so work continues across sessions.
//
//   refiner rec: { kind:'refiner', x,y,z,rotY,
//                  job:    { recipeIdx, started, qtyRuns, doneRuns? } | null,
//                  output: { id, qty } | null }
//   planter rec: { kind:'planter', x,y,z,rotY,
//                  crop:   { id, planted, growTime } | null }
//
// CONTRACT: BaseBuilder calls registerMachine({rec, mesh, gs}) on materialize
// and unregisterMachine(rec) on remove/dispose. A state owns one
// MachineRunner(gs): .update(dt, playerPos) each frame advances jobs, animates
// the 'machine-glow' ember + 'machine-light' + 'machine-crop' children;
// .nearestInteractable(playerPos, range) → { rec, kind, label } | null.
import * as THREE from 'three';

/** Element transmutations the handheld fabricator can't do (see items.js). */
export const REFINER_RECIPES = [
  { ins: [{ id: 'silica', qty: 2 }],                          out: { id: 'voltglass',   qty: 1 }, time: 60 },
  { ins: [{ id: 'carbyne', qty: 3 }],                         out: { id: 'chlorophane', qty: 1 }, time: 60 },
  { ins: [{ id: 'pyrene', qty: 2 }],                          out: { id: 'solanite',    qty: 1 }, time: 90 },
  { ins: [{ id: 'oxylite', qty: 2 }, { id: 'silica', qty: 1 }], out: { id: 'cryostal',  qty: 1 }, time: 90 },
  { ins: [{ id: 'ferrox', qty: 4 }],                          out: { id: 'aurium',      qty: 1 }, time: 120 },
  { ins: [{ id: 'nebulite', qty: 3 }],                        out: { id: 'voidsalt',    qty: 3 }, time: 45 },
];

/** Plantable crops. v1 exposes only chlorophane, structure supports more. */
export const CROPS = {
  chlorophane: {
    name: 'Chlorophane', seed: [{ id: 'carbyne', qty: 2 }],
    growTime: 180, yield: [3, 5], color: 0x8cff5f,
  },
};
export const DEFAULT_CROP = 'chlorophane';

// ---------------------------------------------------------------------------
// registry — one entry per materialized machine piece
// ---------------------------------------------------------------------------
const REGISTRY = [];

export function registerMachine({ rec, mesh, gs }) {
  unregisterMachine(rec); // idempotent re-registration
  const e = { rec, mesh, gs };
  if (rec.kind === 'refiner') {
    rec.job ??= null;
    rec.output ??= null;
    e.glow = mesh?.getObjectByName('machine-glow') ?? null;
    e.glowBase = e.glow?.material?.color?.clone() ?? null;
    e.light = mesh?.getObjectByName('machine-light') ?? null;
    e.lightBase = e.light ? e.light.intensity : 0;
  } else if (rec.kind === 'planter') {
    rec.crop ??= null;
    e.cropGroup = mesh?.getObjectByName('machine-crop') ?? null;
    e.cropKey = null;
  }
  REGISTRY.push(e);
  return e;
}

export function unregisterMachine(rec) {
  const i = REGISTRY.findIndex((e) => e.rec === rec);
  if (i < 0) return;
  const e = REGISTRY[i];
  if (e.cropGroup) _clearCrop(e.cropGroup);
  REGISTRY.splice(i, 1);
}

// ---------------------------------------------------------------------------
// pure progress helpers (also used by RefinerUI)
// ---------------------------------------------------------------------------

/** @returns {null|{recipe, runs, doneRuns, frac, remainMs, complete}} */
export function refinerProgress(rec) {
  const job = rec?.job;
  if (!job) return null;
  const recipe = REFINER_RECIPES[job.recipeIdx];
  if (!recipe) return null;
  const runMs = recipe.time * 1000;
  const runs = Math.max(1, job.qtyRuns | 0);
  const elapsed = Math.max(0, Date.now() - job.started);
  const doneRuns = Math.min(runs, Math.floor(elapsed / runMs));
  const complete = doneRuns >= runs;
  const frac = complete ? 1 : Math.min(1, (elapsed - doneRuns * runMs) / runMs);
  return { recipe, runs, doneRuns, frac, remainMs: Math.max(0, runs * runMs - elapsed), complete };
}

/**
 * Move finished runs into rec.output (merging same-id stacks) and clear the
 * job once fully done. Safe to call every frame and from the UI; if the
 * output hopper holds a DIFFERENT item, settlement waits until it's collected.
 * @returns {boolean} true if anything changed
 */
export function settleRefiner(rec) {
  const p = refinerProgress(rec);
  if (!p) return false;
  const job = rec.job;
  const newRuns = p.doneRuns - (job.doneRuns ?? 0);
  if (newRuns <= 0) return false;
  if (rec.output && rec.output.id !== p.recipe.out.id) return false; // hopper blocked
  if (!rec.output) rec.output = { id: p.recipe.out.id, qty: 0 };
  rec.output.qty += newRuns * p.recipe.out.qty;
  job.doneRuns = p.doneRuns;
  if (p.complete) rec.job = null;
  return true;
}

/** @returns {null|{def, id, frac, remainMs, ready}} */
export function planterProgress(rec) {
  const crop = rec?.crop;
  if (!crop) return null;
  const growMs = Math.max(1, (crop.growTime ?? CROPS[DEFAULT_CROP].growTime) * 1000);
  const elapsed = Math.max(0, Date.now() - crop.planted);
  const frac = Math.min(1, elapsed / growMs);
  return {
    def: CROPS[crop.id] ?? CROPS[DEFAULT_CROP], id: crop.id,
    frac, remainMs: Math.max(0, growMs - elapsed), ready: frac >= 1,
  };
}

// ---------------------------------------------------------------------------
// procedural crop sprouts — swapped on the planter's 'machine-crop' group
// ---------------------------------------------------------------------------
const SPOTS = [ // fixed layout inside the ~1.8×1.1 tray (x, z, scale)
  [-0.62, -0.3, 1.0], [0.02, -0.34, 0.85], [0.6, -0.26, 1.05],
  [-0.32, 0.28, 0.9], [0.32, 0.32, 1.0], [-0.68, 0.1, 0.8], [0.68, 0.06, 0.9],
];

function _buildCropStage(stage, ready, colorHex) {
  const g = new THREE.Group();
  const stalkMat = new THREE.MeshStandardMaterial({ color: 0x2f7a3c, roughness: 0.85 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5fd068, roughness: 0.75 });
  const bulbMat = ready
    ? new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 2.6, 0.8) }) // HDR: ripe glow
    : new THREE.MeshStandardMaterial({
      color: colorHex, emissive: colorHex, emissiveIntensity: 0.35, roughness: 0.5,
    });
  for (const [x, z, s] of SPOTS) {
    if (stage === 0) {
      const nub = new THREE.Mesh(new THREE.ConeGeometry(0.035 * s, 0.11 * s, 5), stalkMat);
      nub.position.set(x, 0.05 * s, z);
      g.add(nub);
    } else {
      const h = (stage === 1 ? 0.24 : 0.44) * s;
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.03, h, 5), stalkMat);
      stalk.position.set(x, h / 2, z);
      stalk.castShadow = true;
      g.add(stalk);
      const leaves = new THREE.Mesh(
        new THREE.ConeGeometry((stage === 1 ? 0.09 : 0.15) * s, (stage === 1 ? 0.12 : 0.2) * s, 6), leafMat);
      leaves.position.set(x, h * 0.62, z);
      leaves.castShadow = true;
      g.add(leaves);
      if (stage >= 2) {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.062 * s, 8, 8), bulbMat);
        bulb.position.set(x, h + 0.05 * s, z);
        g.add(bulb);
      }
    }
  }
  return g;
}

function _clearCrop(group) {
  for (const child of [...group.children]) {
    child.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (o.material?.dispose) o.material.dispose();
      }
    });
    group.remove(child);
  }
}

// ---------------------------------------------------------------------------
// runner — advances every registered machine, animates its mesh
// ---------------------------------------------------------------------------
export class MachineRunner {
  constructor(gs) {
    this.gs = gs;
    this._t = 0;
  }

  update(dt, playerPos) { // playerPos reserved for future proximity audio
    void playerPos;
    this._t += dt;
    for (const e of REGISTRY) {
      if (e.rec.kind === 'refiner') this._updateRefiner(e);
      else if (e.rec.kind === 'planter') this._updatePlanter(e);
    }
  }

  _updateRefiner(e) {
    settleRefiner(e.rec);
    const running = !!e.rec.job;
    const t = this._t;
    const phase = (e.rec.x ?? 0) * 1.7 + (e.rec.z ?? 0) * 0.9;
    // furnace flicker: slow breathing × fast crackle, deterministic per-machine
    const flick = 0.62 + 0.28 * Math.sin(t * 5.1 + phase) + 0.14 * Math.sin(t * 13.7 + phase * 2.3);
    if (e.glow && e.glowBase) {
      e.glow.material.color.copy(e.glowBase).multiplyScalar(running ? 0.9 + flick : 0.14);
    }
    if (e.light) {
      e.light.intensity = running ? e.lightBase * (0.55 + flick) : e.lightBase * 0.12;
    }
  }

  _updatePlanter(e) {
    const p = planterProgress(e.rec);
    const stage = p ? Math.min(2, Math.floor(p.frac * 3)) : -1;
    const key = p ? `${p.id}:${stage}:${p.ready ? 1 : 0}` : 'none';
    if (key === e.cropKey || !e.cropGroup) { e.cropKey = key; return; }
    e.cropKey = key;
    _clearCrop(e.cropGroup);
    if (p) {
      const def = CROPS[p.id] ?? CROPS[DEFAULT_CROP];
      e.cropGroup.add(_buildCropStage(stage, p.ready, def.color));
    }
  }

  /** nearest machine within range → { rec, kind, label } | null */
  nearestInteractable(playerPos, range = 4) {
    let best = null, bestD = range;
    for (const e of REGISTRY) {
      const d = Math.hypot(
        (e.rec.x ?? 0) - playerPos.x,
        (e.rec.y ?? 0) - playerPos.y,
        (e.rec.z ?? 0) - playerPos.z,
      );
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return null;
    const kind = best.rec.kind;
    let label;
    if (kind === 'refiner') {
      label = best.rec.output && !best.rec.job ? 'COLLECT REFINER OUTPUT' : 'USE REFINER';
    } else {
      label = planterProgress(best.rec)?.ready ? 'HARVEST BIO PLANTER' : 'USE BIO PLANTER';
    }
    return { rec: best.rec, kind, label };
  }

  dispose() {
    // registry entries are owned by BaseBuilder (register/unregister on
    // materialize/remove); nothing to tear down here
    this.gs = null;
  }
}
