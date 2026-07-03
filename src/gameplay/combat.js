// Combat: Luminel custodian machines ("Wardens") police planets and punish
// over-mining; the Ashen Fleet raids star systems. Both sides use the pooled
// bolt/explosion VFX from EffectsSystem.
//
// CONTRACT (states depend on these exact shapes):
//   new GroundCombat(scene, effects, gameState, surfaceState)
//     .update(dt, camera, player)  .onMined(position)  .dispose()
//   new SpaceCombat(scene, effects, gameState, system, shipCtl)
//     .update(dt, camera)  .dispose()
import * as THREE from 'three';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { RNG, hash32 } from '../core/rng.js';
import { buildShip } from '../render/shipmesh.js';
import { audio } from '../audio/audio.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

// ---------------------------------------------------------------- Wardens ---

const WARDEN_BOLT_SPEED = 55;
const PLAYER_BOLT_SPEED = 90;

/** Floating custodian drone: dark octahedral core, ring shards, one HDR eye. */
function buildWarden(rng) {
  const g = new THREE.Group();
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.4, metalness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x555f6e, roughness: 0.5, metalness: 0.8 });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), coreMat);
  core.castShadow = true;
  g.add(core);

  const ring = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 5, 10, Math.PI * 0.5), trimMat);
    arc.rotation.z = (i / 3) * Math.PI * 2 + rng.next();
    arc.castShadow = true;
    ring.add(arc);
  }
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.2, 4.0) });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), eyeMat);
  eye.position.set(0, 0, -0.52);
  g.add(eye);

  return { group: g, ring, eye, eyeMat, coreMat };
}

export class GroundCombat {
  constructor(scene, effects, gs, surface) {
    this.scene = scene;
    this.effects = effects;
    this.gs = gs;
    this.surface = surface;
    this.wardens = [];
    this.playerBolts = [];   // { handle, done }
    this.hostileBolts = [];  // { handle, damage }
    this._fireCd = 0;
    this._spawnTimer = 12;
    this._heat = 0;
    this._warnedHostile = false;

    const def = surface.def;
    // machine presence follows mineral wealth: crystal worlds are watched
    this.activity = Math.min(1, (def.crystalDensity ?? 0) * 0.9
      + (def.hasRuins ? 0.25 : 0) + (def.hazard?.rad ?? 0) * 0.3 + 0.15);
    this.cap = Math.round(1 + this.activity * 3);
    this.rng = new RNG(hash32(def.seed ?? 1, 0x77a2d));

    this._onMinedEvt = () => this.onMined(surface.player?.position);
    events.on('resource:mined', this._onMinedEvt);
  }

  /** mining heat — Wardens investigate, then turn hostile */
  onMined(position) {
    this._heat = Math.min(8, this._heat + 1);
    if (!position) return;
    for (const w of this.wardens) {
      if (w.state === 'dead') continue;
      const d = w.obj.group.position.distanceTo(position);
      if (d < 140 && w.state === 'patrol') {
        w.state = 'alert';
        w.target.copy(position);
        w.stateT = 0;
      } else if (d < 60 && this._heat >= 5 && w.state !== 'hostile') {
        this._goHostile(w);
      }
    }
  }

  _goHostile(w) {
    w.state = 'hostile';
    w.stateT = 0;
    if (!this._warnedHostile) {
      this._warnedHostile = true;
      events.emit('notify', { text: 'WARDEN PROTOCOL ESCALATION — weapons free', tone: 'danger' });
      audio.sfx('deny');
    }
  }

  _spawn(playerPos) {
    const rng = this.rng;
    const a = rng.next() * Math.PI * 2;
    const d = rng.range(55, 95);
    const x = playerPos.x + Math.cos(a) * d, z = playerPos.z + Math.sin(a) * d;
    const obj = buildWarden(rng.fork(`w${this.wardens.length}`));
    const y = this.surface.field.height(x, z) + 2.6;
    obj.group.position.set(x, y, z);
    this.scene.add(obj.group);
    this.wardens.push({
      obj, hp: 5, state: 'patrol', stateT: 0,
      target: new THREE.Vector3(x, y, z),
      fireT: this.rng.range(0.5, 2), volley: 0,
      bobPhase: rng.next() * 6.28,
    });
  }

  update(dt, camera, player) {
    const gs = this.gs;
    this._heat = Math.max(0, this._heat - dt * 0.12);
    this._fireCd -= dt;

    // population control
    this._spawnTimer -= dt;
    const alive = this.wardens.filter((w) => w.state !== 'dead');
    if (this._spawnTimer <= 0) {
      this._spawnTimer = 24;
      if (alive.length < this.cap && this.rng.chance(0.35 + this.activity * 0.4)) {
        this._spawn(player.position);
      }
    }

    // player bolt fire (Arcforge bolt caster; suppressed while build mode owns LMB)
    if (gs.tool.mode === 'bolt' && !this.suppressFire
      && input.mouseDown[0] && input.aiming && this._fireCd <= 0) {
      this._fireCd = 0.24 / (1 + (gs.upgrades.toolBolt ?? 0) * 0.35);
      const dir = camera.getWorldDirection(_v1.set(0, 0, 0)).clone();
      dir.x += (Math.random() - 0.5) * 0.012;
      dir.y += (Math.random() - 0.5) * 0.012;
      dir.normalize();
      const from = camera.position.clone().addScaledVector(dir, 0.9).add(_v2.set(0, -0.3, 0));
      const handle = this.effects.laserBolt(from, dir, PLAYER_BOLT_SPEED, '#6fffd0');
      this.playerBolts.push({ handle, prev: from.clone() });
      audio.sfx('laser');
    }

    // player bolts vs wardens (swept sphere)
    for (let i = this.playerBolts.length - 1; i >= 0; i--) {
      const b = this.playerBolts[i];
      if (!b.handle.alive) { this.playerBolts.splice(i, 1); continue; }
      for (const w of this.wardens) {
        if (w.state === 'dead') continue;
        const seg = _v1.copy(b.handle.position).sub(b.prev);
        const toW = _v2.copy(w.obj.group.position).sub(b.prev);
        const t = THREE.MathUtils.clamp(toW.dot(seg) / Math.max(seg.lengthSq(), 1e-6), 0, 1);
        const closest = _v3.copy(b.prev).addScaledVector(seg, t);
        if (closest.distanceToSquared(w.obj.group.position) < 1.35) {
          b.handle.alive = false;
          this.playerBolts.splice(i, 1);
          this._hitWarden(w);
          break;
        }
      }
      if (b.handle.alive) b.prev.copy(b.handle.position);
    }

    // hostile bolts vs player
    for (let i = this.hostileBolts.length - 1; i >= 0; i--) {
      const b = this.hostileBolts[i];
      if (!b.handle.alive) { this.hostileBolts.splice(i, 1); continue; }
      const eye = _v1.copy(player.position); eye.y += 1.2;
      if (b.handle.position.distanceToSquared(eye) < 2.3) {
        b.handle.alive = false;
        this.hostileBolts.splice(i, 1);
        this.surface.survival.applyDamage(b.damage, 'laser');
      }
    }

    // warden behavior
    for (const w of this.wardens) {
      if (w.state === 'dead') continue;
      w.stateT += dt;
      const g = w.obj.group;
      w.obj.ring.rotation.z += dt * (w.state === 'hostile' ? 3.2 : 0.8);
      const groundY = this.surface.field.height(g.position.x, g.position.z);
      const hoverY = groundY + 2.6 + Math.sin(this.surface._elapsed * 1.1 + w.bobPhase) * 0.25;

      const dPlayer = g.position.distanceTo(player.position);

      if (w.state === 'patrol') {
        if (w.stateT > 7 || g.position.distanceTo(w.target) < 3) {
          w.stateT = 0;
          const a = this.rng.next() * Math.PI * 2;
          w.target.set(g.position.x + Math.cos(a) * 30, 0, g.position.z + Math.sin(a) * 30);
        }
        this._moveToward(w, w.target, 5, hoverY, dt);
        // provoked by fire
        if (dPlayer > 400) this._despawn(w);
      } else if (w.state === 'alert') {
        this._moveToward(w, w.target, 9, hoverY, dt);
        g.lookAt(player.position.x, g.position.y, player.position.z);
        if (w.stateT > 12) { w.state = 'patrol'; w.stateT = 0; }
        if (this._heat >= 5 && dPlayer < 70) this._goHostile(w);
      } else if (w.state === 'hostile') {
        // strafe-orbit the player at ~18 m
        const orbit = _v1.copy(g.position).sub(player.position);
        orbit.y = 0;
        const r = Math.max(orbit.length(), 0.001);
        const tangent = _v2.set(-orbit.z / r, 0, orbit.x / r);
        const radial = (r - 18) / 18;
        _v3.copy(player.position)
          .addScaledVector(orbit, Math.max(0.2, 1 - radial * 0.5) / r * 18)
          .addScaledVector(tangent, 10);
        this._moveToward(w, _v3, 8.5, hoverY + 1.2, dt);
        g.lookAt(player.position.x, player.position.y + 1.4, player.position.z);

        // telegraphed volleys
        w.fireT -= dt;
        const tele = w.fireT < 0.45 && w.fireT > 0;
        w.obj.eye.scale.setScalar(tele ? 1.9 : 1);
        if (w.fireT <= 0) {
          w.volley = 3;
          w.fireT = this.rng.range(1.7, 2.6);
        }
        if (w.volley > 0 && (w.fireT < 1.45) && dPlayer < 60) {
          w.volley -= 1;
          const from = g.localToWorld(_v1.set(0, 0, -0.6));
          const aim = _v2.copy(player.position);
          aim.y += 1.1;
          aim.x += (Math.random() - 0.5) * 2.2;
          aim.z += (Math.random() - 0.5) * 2.2;
          const dir = aim.sub(from).normalize();
          const handle = this.effects.laserBolt(from.clone(), dir, WARDEN_BOLT_SPEED, '#ff4a3c');
          this.hostileBolts.push({ handle, damage: 9 });
          audio.sfx('laser', { volume: 0.5 });
        }
        if (dPlayer > 120) { w.state = 'alert'; w.stateT = 0; }
      }
    }
  }

  _moveToward(w, target, speed, hoverY, dt) {
    const g = w.obj.group.position;
    _v1.set(target.x - g.x, 0, target.z - g.z);
    const d = _v1.length();
    if (d > 0.5) g.addScaledVector(_v1.normalize(), Math.min(speed, d) * dt);
    g.y += (hoverY - g.y) * Math.min(1, dt * 3);
  }

  _hitWarden(w) {
    w.hp -= 1;
    this.effects.sparks(w.obj.group.position.clone(), _v1.set(0, 1, 0), '#7de8ff');
    audio.sfx('boltHit');
    if (w.state !== 'hostile') this._goHostile(w);
    if (w.hp <= 0) {
      w.state = 'dead';
      this.effects.explosion(w.obj.group.position.clone(), 0.9, '#7de8ff');
      audio.sfx('explosion');
      const drops = 2 + Math.floor(Math.random() * 3);
      this.gs.addItem('nebulite', drops);
      events.emit('notify', { text: `WARDEN DOWN — +${drops} Nebulite`, tone: 'good' });
      events.emit('combat:wardenKilled');
      if (Math.random() < 0.06) {
        this.gs.addItem('luminelshard', 1);
        events.emit('notify', { text: 'It was carrying a Luminel Shard.', tone: 'info' });
      }
      this.scene.remove(w.obj.group);
    }
  }

  _despawn(w) {
    w.state = 'dead';
    this.scene.remove(w.obj.group);
  }

  dispose() {
    events.off('resource:mined', this._onMinedEvt);
    for (const w of this.wardens) this.scene.remove(w.obj.group);
    this.wardens.length = 0;
  }
}

// ------------------------------------------------------------ Ashen Fleet ---

const PIRATE_BOLT_SPEED = 260;
const SHIP_BOLT_SPEED = 420;

export class SpaceCombat {
  constructor(scene, effects, gs, system, shipCtl) {
    this.scene = scene;
    this.effects = effects;
    this.gs = gs;
    this.system = system;
    this.shipCtl = shipCtl;
    this.pirates = [];
    this.playerBolts = [];
    this.hostileBolts = [];
    this.rng = new RNG(hash32(system.seed ?? 1, 0xa5e17));
    this._fireCd = 0;
    this._waveTimer = 40 + this.rng.range(0, 30);  // grace period
    this.cap = Math.max(1, Math.round(1 + (system.pirateThreat ?? 0) * 2));
  }

  get hasHostiles() { return this.pirates.some((p) => p.hp > 0); }

  _spawnWave() {
    const n = this.rng.int(1, this.cap);
    for (let i = 0; i < n; i++) {
      const built = buildShip(hash32(this.system.seed, 900 + this.pirates.length), 'talon');
      // ashen livery: scorch the hull toward ember-red
      built.group.traverse((o) => {
        if (o.isMesh && o.material?.color && !o.material.emissive) o.material = o.material.clone();
        if (o.isMesh && o.material?.color && o.material.emissive !== undefined) {
          o.material = o.material.clone();
          o.material.color.lerp(new THREE.Color(0x8c2a22), 0.55);
        }
      });
      const a = this.rng.next() * Math.PI * 2;
      const pos = this.shipCtl.position.clone().add(
        _v1.set(Math.cos(a) * 700, this.rng.range(-120, 160), Math.sin(a) * 700));
      built.group.position.copy(pos);
      this.scene.add(built.group);
      const trail = this.effects.engineTrail(built.group, '#ff5a3c');
      trail.setLevel?.(0.7);
      this.pirates.push({
        built, trail, hp: 6, state: 'approach', stateT: 0,
        fireT: 1, peel: new THREE.Vector3(),
      });
    }
    events.emit('notify', { text: `ASHEN FLEET RAIDERS INBOUND ×${n}`, tone: 'danger' });
    audio.sfx('deny');
  }

  update(dt, camera) {
    const gs = this.gs;
    this._fireCd -= dt;

    // wave spawning
    if ((this.system.pirateThreat ?? 0) > 0.12) {
      this._waveTimer -= dt;
      if (this._waveTimer <= 0) {
        this._waveTimer = this.rng.range(90, 160);
        if (!this.hasHostiles) this._spawnWave();
      }
    }

    // player fire: LMB fires nose bolts with soft aim assist
    if (input.mouseDown[0] && input.aiming && this._fireCd <= 0 && this.hasHostiles) {
      this._fireCd = 0.22;
      const fwd = this.shipCtl.forward.clone();
      let dir = fwd;
      let best = null, bestDot = Math.cos(THREE.MathUtils.degToRad(10));
      for (const p of this.pirates) {
        if (p.hp <= 0) continue;
        _v1.copy(p.built.group.position).sub(this.shipCtl.position);
        const dist = _v1.length();
        const d = _v1.normalize().dot(fwd);
        if (d > bestDot) { bestDot = d; best = { p, dist }; }
      }
      if (best) {
        // lead the target
        const lead = best.p.built.group.position.clone()
          .addScaledVector(best.p.vel ?? _v2.set(0, 0, 0), best.dist / SHIP_BOLT_SPEED);
        dir = lead.sub(this.shipCtl.position).normalize();
      }
      const from = this.shipCtl.position.clone().addScaledVector(this.shipCtl.forward, 3.2);
      const handle = this.effects.laserBolt(from, dir, SHIP_BOLT_SPEED, '#7de8ff');
      this.playerBolts.push({ handle, prev: from.clone() });
      audio.sfx('laser');
    }

    // player bolts vs pirates
    for (let i = this.playerBolts.length - 1; i >= 0; i--) {
      const b = this.playerBolts[i];
      if (!b.handle.alive) { this.playerBolts.splice(i, 1); continue; }
      for (const p of this.pirates) {
        if (p.hp <= 0) continue;
        const seg = _v1.copy(b.handle.position).sub(b.prev);
        const toP = _v2.copy(p.built.group.position).sub(b.prev);
        const t = THREE.MathUtils.clamp(toP.dot(seg) / Math.max(seg.lengthSq(), 1e-6), 0, 1);
        if (_v3.copy(b.prev).addScaledVector(seg, t)
          .distanceToSquared(p.built.group.position) < 14) {
          b.handle.alive = false;
          this.playerBolts.splice(i, 1);
          this._hitPirate(p);
          break;
        }
      }
      if (b.handle.alive) b.prev.copy(b.handle.position);
    }

    // hostile bolts vs player ship
    for (let i = this.hostileBolts.length - 1; i >= 0; i--) {
      const b = this.hostileBolts[i];
      if (!b.handle.alive) { this.hostileBolts.splice(i, 1); continue; }
      if (b.handle.position.distanceToSquared(this.shipCtl.position) < 20) {
        b.handle.alive = false;
        this.hostileBolts.splice(i, 1);
        this._damagePlayer(8);
      }
    }

    // pirate AI
    for (const p of this.pirates) {
      if (p.hp <= 0) continue;
      p.stateT += dt;
      const g = p.built.group;
      const toPlayer = _v1.copy(this.shipCtl.position).sub(g.position);
      const dist = toPlayer.length();
      toPlayer.normalize();

      let want = toPlayer, speed = 62;
      if (p.state === 'approach') {
        if (dist < 240) { p.state = 'attack'; p.stateT = 0; }
      } else if (p.state === 'attack') {
        speed = 74;
        p.fireT -= dt;
        const fwd = g.getWorldDirection(_v2).negate();
        if (p.fireT <= 0 && fwd.dot(toPlayer) > 0.94 && dist < 320) {
          p.fireT = 0.55;
          const from = g.position.clone().addScaledVector(fwd, 3);
          const aim = this.shipCtl.position.clone()
            .addScaledVector(this.shipCtl.velocity, dist / PIRATE_BOLT_SPEED);
          aim.x += (Math.random() - 0.5) * 6;
          aim.y += (Math.random() - 0.5) * 6;
          const handle = this.effects.laserBolt(from, aim.sub(from).normalize(), PIRATE_BOLT_SPEED, '#ff5a3c');
          this.hostileBolts.push({ handle });
          audio.sfx('laser', { volume: 0.45 });
        }
        if (dist < 70) {
          p.state = 'peel';
          p.stateT = 0;
          p.peel.copy(g.position).addScaledVector(_v2.set(
            this.rng.range(-1, 1), this.rng.range(-0.4, 0.7), this.rng.range(-1, 1)).normalize(), 380);
        }
      } else if (p.state === 'peel') {
        want = _v2.copy(p.peel).sub(g.position).normalize();
        speed = 85;
        if (p.stateT > 4.5 || g.position.distanceTo(p.peel) < 60) { p.state = 'approach'; p.stateT = 0; }
      }

      // steer: slerp the nose toward the desired direction, fly forward
      _q1.setFromUnitVectors(_v3.set(0, 0, -1), want);
      g.quaternion.slerp(_q1, Math.min(1, dt * 1.6));
      const fwd = g.getWorldDirection(_v3).negate();
      p.vel = p.vel ?? new THREE.Vector3();
      p.vel.copy(fwd).multiplyScalar(speed);
      g.position.addScaledVector(p.vel, dt);
    }
  }

  _damagePlayer(amount) {
    const gs = this.gs;
    const sAbs = Math.min(gs.ship.shield, amount);
    gs.ship.shield -= sAbs;
    const through = amount - sAbs;
    if (through > 0) {
      gs.ship.hull = Math.max(0, gs.ship.hull - through);
      const frac = gs.ship.hull / gs.ship.hullMax;
      if (frac <= 0.5 && !this._warn50) { this._warn50 = true; events.emit('notify', { text: 'HULL 50% — disengage or fight', tone: 'warn' }); }
      if (frac <= 0.25 && !this._warn25) { this._warn25 = true; events.emit('notify', { text: 'HULL CRITICAL', tone: 'danger' }); }
      if (gs.ship.hull <= 0) {
        this.effects.explosion(this.shipCtl.position.clone(), 2.2, '#ffb454');
        audio.sfx('explosion');
        events.emit('player:death');
        return;
      }
    }
    this.shipCtl.shake(0.8);
    audio.sfx('boltHit');
  }

  _hitPirate(p) {
    p.hp -= 1;
    this.effects.sparks(p.built.group.position.clone(), _v1.set(0, 1, 0), '#ffb454');
    audio.sfx('boltHit');
    if (p.hp <= 0) {
      this.effects.explosion(p.built.group.position.clone(), 1.6, '#ff8a3c');
      audio.sfx('explosion');
      p.trail?.dispose?.();
      this.scene.remove(p.built.group);
      const bounty = 150 + Math.floor(Math.random() * 150);
      this.gs.addLumens(bounty);
      events.emit('notify', { text: `RAIDER DESTROYED — +${bounty} ⌾`, tone: 'good' });
      events.emit('combat:pirateKilled');
      if (Math.random() < 0.4) {
        this.gs.addItem('nebulite', 2);
        events.emit('notify', { text: '+2 Nebulite salvaged', tone: 'good' });
      }
      if (!this.hasHostiles) {
        events.emit('notify', { text: 'THREAT CLEARED', tone: 'info' });
      }
    }
  }

  dispose() {
    for (const p of this.pirates) {
      p.trail?.dispose?.();
      this.scene.remove(p.built.group);
    }
    this.pirates.length = 0;
  }
}
