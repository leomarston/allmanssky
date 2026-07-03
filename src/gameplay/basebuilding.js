// Base building: modular habitat pieces placed on terrain with grid snapping,
// resource costs, and persistence in gameState.bases (rebuilt on revisit).
//
// CONTRACT: new BaseBuilder(scene, field, gameState, systemId, planetIndex)
//   .update(dt, camera, player)   .active (build mode flag)   .dispose()
// B toggles build mode · 1-9 select piece · R rotate · LMB place · RMB remove
// Machine pieces (refiner/planter) are registered with gameplay/machines.js on
// materialize and unregistered on remove; their recs carry extra persisted
// state (job/output/crop) beyond {kind,x,y,z,rotY}.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { ITEMS } from './items.js';
import { audio } from '../audio/audio.js';
import { registerMachine, unregisterMachine } from './machines.js';

const GRID = 4;
const _v1 = new THREE.Vector3();

const ALLOY = 0x9aa7b0, ALLOY_DARK = 0x5b6670, GLASS = 0xbfefff, STRIP = new THREE.Color(1.2, 2.6, 3.0);

export const PIECES = [ // ≤ 9 entries — BuildUI binds them to keys 1-9
  { kind: 'foundation', name: 'Foundation', cost: [['ferrox', 4]] },
  { kind: 'wall',       name: 'Wall',       cost: [['ferrox', 3], ['carbyne', 1]] },
  { kind: 'door',       name: 'Doorway',    cost: [['ferrox', 3]] },
  { kind: 'roof',       name: 'Roof',       cost: [['ferrox', 3]] },
  { kind: 'light',      name: 'Light Mast', cost: [['ferrox', 1], ['voltglass', 1]] },
  { kind: 'storage',    name: 'Storage Crate', cost: [['ferroweave', 2]] },
  { kind: 'refiner',    name: 'Refiner',    cost: [['ferrox', 5], ['voltglass', 1]] },
  { kind: 'planter',    name: 'Bio Planter', cost: [['ferrox', 2], ['carbyne', 4]] },
  { kind: 'pad',        name: 'Landing Pad', cost: [['ferrox', 6], ['silica', 2]] },
];

// kinds retired from the build bar but still materialized/reclaimed for old saves
const LEGACY_PIECES = {
  window: { kind: 'window', name: 'Window Wall', cost: [['ferrox', 2], ['luminglass', 1]] },
};

const MACHINE_KINDS = new Set(['refiner', 'planter']);

let _matAlloy, _matDark, _matGlass, _matStrip;
function mats() {
  _matAlloy ??= new THREE.MeshStandardMaterial({ color: ALLOY, roughness: 0.55, metalness: 0.6 });
  _matDark ??= new THREE.MeshStandardMaterial({ color: ALLOY_DARK, roughness: 0.7, metalness: 0.5 });
  _matGlass ??= new THREE.MeshStandardMaterial({
    color: GLASS, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.35,
    emissive: new THREE.Color(0x1a3038), emissiveIntensity: 0.6,
  });
  _matStrip ??= new THREE.MeshBasicMaterial({ color: STRIP });
  return [_matAlloy, _matDark, _matGlass, _matStrip];
}

/** Build the visual for a piece kind. Returns a Group with shadows set up. */
export function buildPiece(kind, withLight = true) {
  const [alloy, dark, glass, strip] = mats();
  const g = new THREE.Group();
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  switch (kind) {
    case 'foundation':
      box(GRID, 0.32, GRID, alloy, 0, 0.16, 0);
      box(GRID * 0.94, 0.1, GRID * 0.94, dark, 0, 0.36, 0);
      break;
    case 'wall':
      box(GRID, 3, 0.24, alloy, 0, 1.5, 0);
      box(GRID * 0.96, 0.12, 0.26, strip, 0, 2.9, 0);
      break;
    case 'window':
      box(GRID, 0.8, 0.24, alloy, 0, 0.4, 0);
      box(GRID, 0.5, 0.24, alloy, 0, 2.75, 0);
      box(GRID * 0.94, 1.7, 0.12, glass, 0, 1.65, 0);
      box(0.18, 3, 0.26, dark, -GRID / 2 + 0.09, 1.5, 0);
      box(0.18, 3, 0.26, dark, GRID / 2 - 0.09, 1.5, 0);
      break;
    case 'door':
      box(GRID / 2 - 0.7, 3, 0.24, alloy, -(GRID / 4 + 0.35), 1.5, 0);
      box(GRID / 2 - 0.7, 3, 0.24, alloy, GRID / 4 + 0.35, 1.5, 0);
      box(1.4, 0.6, 0.24, alloy, 0, 2.7, 0);
      box(1.5, 0.1, 0.26, strip, 0, 2.34, 0);
      break;
    case 'roof':
      box(GRID, 0.24, GRID, alloy, 0, 0.12, 0);
      box(GRID * 0.7, 0.14, GRID * 0.7, dark, 0, 0.3, 0);
      break;
    case 'light': {
      box(0.16, 3.2, 0.16, dark, 0, 1.6, 0);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 2.5, 1.6) }));
      lamp.position.set(0, 3.3, 0);
      g.add(lamp);
      if (withLight) {
        const pt = new THREE.PointLight(0xffe8b8, 26, 26, 1.8);
        pt.position.set(0, 3.4, 0);
        g.add(pt);
      }
      break;
    }
    case 'storage':
      box(1.3, 1.1, 1.3, alloy, 0, 0.55, 0);
      box(1.34, 0.12, 1.34, strip, 0, 0.62, 0);
      break;
    case 'refiner': {
      // squat cylinder furnace: plinth, riveted body, hopper, side pipes,
      // and an HDR ember slot ('machine-glow') animated by MachineRunner
      const cyl = (rt, rb, h, m, x, y, z, seg = 16) => {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
        mesh.position.set(x, y, z);
        mesh.castShadow = mesh.receiveShadow = true;
        g.add(mesh);
        return mesh;
      };
      cyl(1.02, 1.14, 0.22, dark, 0, 0.11, 0);              // plinth
      cyl(0.8, 0.92, 1.18, alloy, 0, 0.79, 0);              // body
      cyl(0.86, 0.86, 0.1, dark, 0, 1.42, 0);               // collar
      cyl(0.56, 0.22, 0.52, alloy, 0, 1.76, 0, 12);         // hopper funnel
      cyl(0.6, 0.56, 0.07, dark, 0, 2.04, 0, 12);           // hopper rim
      box(0.6, 0.09, 0.6, strip, 0, 1.48, 0);               // collar light band
      // ember slot — fresh HDR material so each furnace animates independently
      box(0.72, 0.52, 0.18, dark, 0, 0.56, 0.78);           // slot frame
      const ember = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.3, 0.08),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(3.1, 1.15, 0.28) }));
      ember.name = 'machine-glow';
      ember.position.set(0, 0.56, 0.86);
      g.add(ember);
      // side pipes with elbows into the body
      for (const sx of [-1, 1]) {
        const pipe = cyl(0.085, 0.085, 1.15, dark, sx * 1.02, 0.72, 0, 8);
        pipe.castShadow = false;
        const elbow = box(0.26, 0.17, 0.17, dark, sx * 0.88, 1.24, 0);
        elbow.castShadow = false;
        cyl(0.11, 0.11, 0.1, alloy, sx * 1.02, 0.2, 0, 8);  // pipe foot
      }
      if (withLight) {
        const pt = new THREE.PointLight(0xff7a2a, 14, 10, 1.8);
        pt.name = 'machine-light';
        pt.position.set(0, 0.68, 1.1);
        g.add(pt);
      }
      break;
    }
    case 'planter': {
      // raised hydroponic tray: legs, rim walls, moist dark soil, cyan rim
      // strips; 'machine-crop' group hosts procedural sprouts (machines.js)
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) box(0.12, 0.44, 0.12, dark, sx * 0.86, 0.22, sz * 0.5);
      }
      box(1.96, 0.08, 1.24, dark, 0, 0.46, 0);              // tray bottom
      box(2.04, 0.3, 0.1, alloy, 0, 0.6, 0.62);             // rim walls
      box(2.04, 0.3, 0.1, alloy, 0, 0.6, -0.62);
      box(0.1, 0.3, 1.34, alloy, 0.97, 0.6, 0);
      box(0.1, 0.3, 1.34, alloy, -0.97, 0.6, 0);
      const soil = new THREE.Mesh(
        new THREE.BoxGeometry(1.84, 0.16, 1.12),
        new THREE.MeshStandardMaterial({ color: 0x221710, roughness: 1, metalness: 0 }));
      soil.position.set(0, 0.56, 0);
      soil.receiveShadow = true;
      g.add(soil);
      // rim light strips
      box(1.9, 0.05, 0.05, strip, 0, 0.77, 0.62);
      box(1.9, 0.05, 0.05, strip, 0, 0.77, -0.62);
      box(0.05, 0.05, 1.26, strip, 0.97, 0.77, 0);
      box(0.05, 0.05, 1.26, strip, -0.97, 0.77, 0);
      const cropG = new THREE.Group();
      cropG.name = 'machine-crop';
      cropG.position.set(0, 0.64, 0);
      g.add(cropG);
      break;
    }
    case 'pad': {
      const padMesh = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.7, 0.4, 8), dark);
      padMesh.position.y = 0.2;
      padMesh.castShadow = padMesh.receiveShadow = true;
      g.add(padMesh);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const lightBox = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.22), strip);
        lightBox.position.set(Math.cos(a) * 4.1, 0.46, Math.sin(a) * 4.1);
        g.add(lightBox);
      }
      break;
    }
  }
  return g;
}

export class BaseBuilder {
  constructor(scene, field, gs, systemId, planetIndex) {
    this.scene = scene;
    this.field = field;
    this.gs = gs;
    this.systemId = systemId;
    this.planetIndex = planetIndex;
    this.active = false;
    this.sel = 0;
    this.rotY = 0;
    this.placed = [];        // { kind, mesh, rec }
    this.ghost = null;
    this._ghostKind = null;
    this._ghostOk = false;
    this._lightCount = 0;

    this.base = gs.bases.find((b) => b.systemId === systemId && b.planetIndex === planetIndex);
    if (this.base) {
      for (const rec of this.base.pieces) this._materialize(rec);
    }
  }

  _materialize(rec) {
    if (rec.kind === 'light' && this._lightCount >= 4) return;
    if (rec.kind === 'light') this._lightCount++;
    const mesh = buildPiece(rec.kind, rec.kind !== 'light' || this._lightCount <= 4);
    mesh.position.set(rec.x, rec.y, rec.z);
    mesh.rotation.y = rec.rotY ?? 0;
    this.scene.add(mesh);
    this.placed.push({ kind: rec.kind, mesh, rec });
    // machines register with the runner; the rec object is shared by
    // reference so job/output/crop state persists through gs.bases
    if (MACHINE_KINDS.has(rec.kind)) registerMachine({ rec, mesh, gs: this.gs });
  }

  _ensureGhost(kind) {
    if (this._ghostKind === kind) return;
    this._removeGhost();
    const g = buildPiece(kind, false);
    g.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({
          color: 0x7de8ff, transparent: true, opacity: 0.34, depthWrite: false,
        });
        o.castShadow = o.receiveShadow = false;
      }
    });
    this.scene.add(g);
    this.ghost = g;
    this._ghostKind = kind;
  }

  _removeGhost() {
    if (this.ghost) {
      this.ghost.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      this.scene.remove(this.ghost);
      this.ghost = null;
      this._ghostKind = null;
    }
  }

  _snap(point, kind) {
    if (kind === 'foundation' || kind === 'roof' || kind === 'pad') {
      point.x = Math.round(point.x / GRID) * GRID;
      point.z = Math.round(point.z / GRID) * GRID;
    }
    // walls/doors/windows snap to the nearest foundation edge
    if (kind === 'wall' || kind === 'window' || kind === 'door') {
      let best = null, bestD = 7;
      for (const p of this.placed) {
        if (p.kind !== 'foundation') continue;
        const d = Math.hypot(p.mesh.position.x - point.x, p.mesh.position.z - point.z);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) {
        const dx = point.x - best.mesh.position.x, dz = point.z - best.mesh.position.z;
        if (Math.abs(dx) > Math.abs(dz)) {
          point.x = best.mesh.position.x + Math.sign(dx) * GRID / 2;
          point.z = best.mesh.position.z;
          this.rotY = Math.PI / 2;
        } else {
          point.x = best.mesh.position.x;
          point.z = best.mesh.position.z + Math.sign(dz) * GRID / 2;
          this.rotY = 0;
        }
        point.y = best.mesh.position.y + 0.32;
        return true;
      }
    }
    // roofs stack on wall tops over a foundation cell
    if (kind === 'roof') {
      for (const p of this.placed) {
        if (p.kind !== 'foundation') continue;
        if (Math.abs(p.mesh.position.x - point.x) < 0.1 && Math.abs(p.mesh.position.z - point.z) < 0.1) {
          point.y = p.mesh.position.y + 0.32 + 3;
          return true;
        }
      }
    }
    return false;
  }

  update(dt, camera, player) {
    if (input.actionPressed('build')) {
      this.active = !this.active;
      audio.sfx('click');
      events.emit('build:mode', this.active, this);
      if (!this.active) this._removeGhost();
    }
    if (!this.active) return;

    // selection
    for (let i = 0; i < PIECES.length; i++) {
      if (input.keyPressed(`Digit${i + 1}`)) {
        this.sel = i;
        audio.sfx('hover');
        events.emit('build:mode', true, this);
      }
    }
    if (input.actionPressed('swapWeapon')) this.rotY = (this.rotY + Math.PI / 2) % (Math.PI * 2);

    const piece = PIECES[this.sel];
    this._ensureGhost(piece.kind);

    // aim point: 7 m ahead of the camera, dropped to terrain
    const dir = camera.getWorldDirection(_v1);
    const point = camera.position.clone().addScaledVector(dir, 7.5);
    point.y = this.field.height(point.x, point.z);
    const snapped = this._snap(point, piece.kind);
    if ((piece.kind === 'wall' || piece.kind === 'window' || piece.kind === 'door' || piece.kind === 'roof')
      && !snapped) {
      this._ghostOk = false;
    } else {
      this._ghostOk = this.gs.hasItems(piece.cost.map(([id, qty]) => ({ id, qty })));
    }

    this.ghost.position.copy(point);
    this.ghost.rotation.y = this.rotY;
    this.ghost.traverse((o) => {
      if (o.isMesh) o.material.color.set(this._ghostOk ? 0x7de8ff : 0xff5470);
    });

    // place
    if (input.mouseClicked[0] && input.aiming && this._ghostOk) {
      const cost = piece.cost.map(([id, qty]) => ({ id, qty }));
      if (this.gs.removeItems(cost)) {
        if (!this.base) {
          this.base = { systemId: this.systemId, planetIndex: this.planetIndex, pieces: [] };
          this.gs.bases.push(this.base);
        }
        const rec = {
          kind: piece.kind,
          x: point.x, y: point.y, z: point.z,
          rotY: this.rotY,
        };
        this.base.pieces.push(rec);
        this._materialize(rec);
        audio.sfx('craft');
        this.gs.save();
      } else {
        audio.sfx('deny');
      }
    }

    // remove aimed own piece
    if (input.mouseClicked[2] && input.aiming) {
      let best = null, bestD = 6;
      for (const p of this.placed) {
        const d = p.mesh.position.distanceTo(this.ghost.position);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) {
        const def = PIECES.find((x) => x.kind === best.kind) ?? LEGACY_PIECES[best.kind];
        if (!def) return;
        if (MACHINE_KINDS.has(best.kind)) unregisterMachine(best.rec);
        for (const [id, qty] of def.cost) this.gs.addItem(id, Math.ceil(qty / 2));
        this.scene.remove(best.mesh);
        this.placed.splice(this.placed.indexOf(best), 1);
        this.base.pieces.splice(this.base.pieces.indexOf(best.rec), 1);
        audio.sfx('collect');
        events.emit('notify', { text: `${def.name} reclaimed (half cost refunded)`, tone: 'info' });
        this.gs.save();
      }
    }
  }

  dispose() {
    this._removeGhost();
    for (const p of this.placed) {
      if (MACHINE_KINDS.has(p.kind)) unregisterMachine(p.rec);
      this.scene.remove(p.mesh);
    }
    this.placed.length = 0;
  }
}
