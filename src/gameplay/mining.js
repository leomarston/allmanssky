// Mining: the Arcforge beam (on foot) and the ship mining laser (in space).
// CONTRACT (states depend on this):
//   new GroundMining(scene, effects, gameState, surfaceState)
//     .update(dt, camera, surfaceState)   — LMB fires when tool.mode==='mine'
//   new SpaceMining(scene, effects, gameState, spaceState)
//     .update(dt, camera)                 — LMB fires ship beam at asteroids
//   both: .dispose()
import * as THREE from 'three';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { ITEMS, itemColor } from './items.js';
import { audio } from '../audio/audio.js';

const REACH = 26;

export class GroundMining {
  constructor(scene, effects, gs, surface) {
    this.scene = scene;
    this.effects = effects;
    this.gs = gs;
    this.beam = null;
    this._ray = new THREE.Raycaster();
    this._mineTick = 0;
  }

  update(dt, camera, surface) {
    const mode = this.gs.tool.mode;
    if (mode === 'dig') { this._updateDig(dt, camera, surface); return; }
    const firing = input.mouseDown[0] && mode === 'mine' && input.aiming;
    if (!firing) { this._stopBeam(); return; }

    const origin = camera.position.clone();
    const dir = camera.getWorldDirection(new THREE.Vector3());
    // find a node or collectable along the aim line
    let target = null, targetPos = null;
    for (const p of surface.props.all) {
      if (p.kind !== 'node') continue;
      const to = p.position.clone().add(new THREE.Vector3(0, 1, 0)).sub(origin);
      const dist = to.length();
      if (dist > REACH) continue;
      const align = to.normalize().dot(dir);
      if (align > 0.965) { target = p; targetPos = p.position.clone().add(new THREE.Vector3(0, 1, 0)); break; }
    }
    let flora = null;
    if (!target && surface.flora.collectableAt) {
      const hit = surface.flora.collectableAt(origin.clone().addScaledVector(dir, 8), 6);
      if (hit && origin.distanceTo(hit.position) < REACH) { flora = hit; targetPos = hit.position.clone(); }
    }
    const endPos = targetPos ?? origin.clone().addScaledVector(dir, REACH);

    // beam visual from just below the camera (hand position)
    const from = origin.clone()
      .addScaledVector(dir, 0.8)
      .add(new THREE.Vector3(0, -0.35, 0));
    if (!this.beam) {
      this.beam = this.effects.miningBeam?.(from, endPos, '#ffb454');
      audio.sfx('mine');
    } else {
      this.beam.set?.(from, endPos);
    }

    const speed = 1 + (this.gs.upgrades.toolMine ?? 0) * 0.5;
    this._mineTick += dt * speed;
    if (this._mineTick >= 0.55) {
      this._mineTick = 0;
      if (target) {
        target.hp -= 1;
        this.effects.sparks?.(targetPos, new THREE.Vector3(0, 1, 0), itemColor(target.itemId));
        audio.sfx('mineHit');
        const qty = 1 + Math.floor(Math.random() * 2);
        if (this.gs.addItem(target.itemId, qty) > 0) {
          events.emit('resource:mined', { id: target.itemId, amount: qty });
          events.emit('notify', { text: `+${qty} ${ITEMS[target.itemId].name}`, tone: 'good' });
        }
        if (target.hp <= 0) {
          this.effects.sparks?.(targetPos, new THREE.Vector3(0, 1, 0), itemColor(target.itemId));
          surface.props.remove(target);
          audio.sfx('collect');
        }
      } else if (flora) {
        surface.flora.removeInstance?.(flora.id);
        const qty = 2 + Math.floor(Math.random() * 3);
        this.gs.addItem(flora.itemId ?? 'carbyne', qty);
        events.emit('resource:mined', { id: flora.itemId ?? 'carbyne', amount: qty });
        events.emit('notify', { text: `+${qty} ${ITEMS[flora.itemId ?? 'carbyne'].name}`, tone: 'good' });
        audio.sfx('collect');
      }
    }
  }

  /** Arcforge excavator: carve smooth bowls into the terrain itself. */
  _updateDig(dt, camera, surface) {
    const firing = input.mouseDown[0] && input.aiming;
    if (!firing) { this._stopBeam(); return; }

    // march the aim ray until it crosses the heightfield
    const origin = camera.position.clone();
    const dir = camera.getWorldDirection(new THREE.Vector3());
    let hit = null;
    const p = origin.clone();
    for (let i = 0; i < 60; i++) {
      p.addScaledVector(dir, 0.5);
      if (p.y <= surface.field.height(p.x, p.z)) { hit = p; break; }
      if (origin.distanceTo(p) > REACH) break;
    }
    const from = origin.clone().addScaledVector(dir, 0.8).add(new THREE.Vector3(0, -0.35, 0));
    const endPos = hit ?? origin.clone().addScaledVector(dir, REACH);
    if (!this.beam) { this.beam = this.effects.miningBeam?.(from, endPos, '#7dff8a'); audio.sfx('mine'); }
    else this.beam.set?.(from, endPos);
    if (!hit) return;

    this._mineTick += dt * (1 + (this.gs.upgrades.toolMine ?? 0) * 0.5);
    if (this._mineTick >= 0.35) {
      this._mineTick = 0;
      const R = 2.8, D = 1.05;
      if (!surface.field.addDig(hit.x, hit.z, R, D)) {
        events.emit('notify', { text: 'GROUND TOO UNSTABLE FOR FURTHER EXCAVATION', tone: 'warn' });
        return;
      }
      surface.terrain.invalidateArea(hit.x, hit.z, R + 1);
      this.gs.digs ??= {};
      (this.gs.digs[surface.def.id] ??= []).push([
        Math.round(hit.x * 10) / 10, Math.round(hit.z * 10) / 10, R, D,
      ]);
      this.effects.landingDust?.(hit.clone());
      audio.sfx('mineHit', { volume: 0.7 });
      if (Math.random() < 0.3) {
        const id = Math.random() < 0.6 ? 'ferrox' : 'silica';
        if (this.gs.addItem(id, 1) > 0) {
          events.emit('resource:mined', { id, amount: 1 });
          events.emit('notify', { text: `+1 ${ITEMS[id].name}`, tone: 'good' });
        }
      }
    }
  }

  _stopBeam() {
    if (this.beam) { this.beam.off?.(); this.beam = null; this._mineTick = 0; }
  }

  dispose() { this._stopBeam(); }
}

export class SpaceMining {
  constructor(scene, effects, gs, space) {
    this.scene = scene;
    this.effects = effects;
    this.gs = gs;
    this.space = space;
    this.beam = null;
    this._tick = 0;
  }

  update(dt, camera) {
    const firing = input.mouseDown[0] && input.aiming;
    if (!firing || !this.space.asteroids?.length) { this._stop(); return; }

    const shipPos = this.space.shipCtl.position;
    const dir = this.space.shipCtl.forward.clone();
    let target = null;
    for (const a of this.space.asteroids) {
      if (!a.alive) continue;
      const to = a.position.clone().sub(shipPos);
      const dist = to.length();
      if (dist > 220) continue;
      if (to.normalize().dot(dir) > 0.985) { target = a; break; }
    }
    if (!target) { this._stop(); return; }

    const from = shipPos.clone().addScaledVector(dir, 3);
    if (!this.beam) { this.beam = this.effects.miningBeam?.(from, target.position, '#ffd04a'); audio.sfx('mine'); }
    else this.beam.set?.(from, target.position);

    this._tick += dt;
    if (this._tick > 0.5) {
      this._tick = 0;
      target.hp -= 1;
      this.effects.sparks?.(target.position, dir.clone().negate(), itemColor(target.itemId));
      audio.sfx('mineHit');
      const qty = 2 + Math.floor(Math.random() * 3);
      if (this.gs.addItem(target.itemId, qty) > 0) {
        events.emit('resource:mined', { id: target.itemId, amount: qty });
        events.emit('notify', { text: `+${qty} ${ITEMS[target.itemId].name}`, tone: 'good' });
      }
      if (target.hp <= 0) {
        this.space.destroyAsteroid(target);
        this.effects.explosion?.(target.position, 0.6);
        audio.sfx('collect');
      }
    }
  }

  _stop() {
    if (this.beam) { this.beam.off?.(); this.beam = null; this._tick = 0; }
  }

  dispose() { this._stop(); }
}
