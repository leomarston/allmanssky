// Surface fauna population + AI. Spawns deterministic per-cell herds around
// the player (same herd exists on revisit via field.cellRng), despawns far
// ones, and runs lightweight state-machine AI: graze/wander, skittish flee,
// territorial approach+circle, floater drift, flyer orbit/land. Creatures
// always terrain-stick via field.height and tilt subtly with the slope.
// Pure system: emits no events, reads no input.
import * as THREE from 'three';
import { RNG, hash32 } from '../core/rng.js';
import { buildCreature } from '../render/creature.js';

const CELL = 64;            // matches field.cellRng cell size (metres)
const SPAWN_R = 300;        // spawn creatures within this range of the player
const DESPAWN_R = 400;      // release beyond this
const MAX_ACTIVE = 12;
const SCAN_INTERVAL = 0.7;  // seconds between population scans

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _qTarget = new THREE.Quaternion();

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Population + AI system for planetary fauna.
 * Population scales with planetDef.faunaDensity (0 → empty world is fine).
 */
export class CreatureSystem {
  /**
   * @param {THREE.Scene} scene surface scene
   * @param {object} planetDef PlanetDef (uses .seed, .biome, .faunaDensity)
   * @param {object} field TerrainField (height/normal/seaY/cellRng)
   */
  constructor(scene, planetDef, field) {
    this.scene = scene;
    this.def = planetDef;
    this.field = field;
    this.density = Math.max(0, Math.min(1, planetDef.faunaDensity || 0));
    this.root = new THREE.Group();
    this.root.name = 'creatures';
    scene.add(this.root);

    this.creatures = [];
    this.activeCells = new Set(); // cells currently rolled (even if empty/invalid)
    this._scanT = 0;
  }

  /* ------------------------------------------------------- population */

  /** Deterministic herd spec for a cell — identical on every visit. */
  _cellSpecs(cx, cz) {
    const rng = this.field.cellRng(cx, cz, 'fauna');
    const specs = [];
    if (this.density <= 0) return specs;
    if (!rng.chance(this.density * 0.11)) return specs;
    const herd = 1 + (rng.chance(0.5) ? rng.int(1, 2) : 0); // 1..3
    for (let i = 0; i < herd; i++) {
      specs.push({
        seed: hash32(this.def.seed | 0, cx | 0, cz | 0, i),
        x: (cx + rng.next()) * CELL,
        z: (cz + rng.next()) * CELL,
      });
    }
    return specs;
  }

  _spawnCell(cx, cz, key) {
    this.activeCells.add(key);
    const specs = this._cellSpecs(cx, cz);
    const seaY = this.field.seaY;
    for (const spec of specs) {
      if (this.creatures.length >= MAX_ACTIVE) return;
      const h = this.field.height(spec.x, spec.z);
      if (h <= seaY + 0.4) continue;                      // no underwater spawns
      if (this.field.normal(spec.x, spec.z).y < 0.55) continue; // no cliff spawns
      this._spawn(spec, key, h);
    }
  }

  _spawn(spec, cellKey, groundY) {
    const obj = buildCreature(spec.seed, this.def.biome);
    const p = obj.profile;
    const rng = new RNG(hash32(spec.seed, 0xa1));
    const flyer = p.bodyType === 'flyer';
    const floater = p.bodyType === 'floater';
    const c = {
      obj, group: obj.group, profile: p, cellKey, rng,
      home: new THREE.Vector3(spec.x, groundY, spec.z),
      target: new THREE.Vector3(spec.x, groundY, spec.z),
      heading: rng.range(0, Math.PI * 2),
      speed01: 0, desired01: 0,
      state: floater ? 'drift' : (flyer ? 'fly' : 'idle'),
      stateT: rng.range(1, 5),
      hover: floater ? rng.range(1.2, 2.6) : 0,
      alt: flyer ? rng.range(4, 9) : 0,          // current fly altitude
      altT: flyer ? rng.range(5, 11) : 0,        // target altitude
      orbA: rng.range(0, Math.PI * 2),           // orbit angle (circle/fly)
      orbR: rng.range(8, 22),
      nT: 0, ny: 1, nx: 0, nz: 0,                // cached slope normal
      fleeFrom: null,
    };
    c.group.position.set(spec.x, groundY + c.hover + (flyer ? c.alt : 0), spec.z);
    c.group.rotation.y = c.heading;
    this.root.add(c.group);
    this.creatures.push(c);
  }

  _release(c) {
    c.obj.dispose();
    const i = this.creatures.indexOf(c);
    if (i >= 0) this.creatures.splice(i, 1);
  }

  _scan(playerPos) {
    // despawn far creatures, free their cells for deterministic re-roll later
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      if (c.group.position.distanceTo(playerPos) > DESPAWN_R) {
        this.activeCells.delete(c.cellKey);
        this._release(c);
      }
    }
    // free rolled-but-empty far cells so they can re-roll on return
    if (this.activeCells.size > 512) {
      for (const key of this.activeCells) {
        const [cx, cz] = key.split(',').map(Number);
        const dx = (cx + 0.5) * CELL - playerPos.x, dz = (cz + 0.5) * CELL - playerPos.z;
        if (dx * dx + dz * dz > DESPAWN_R * DESPAWN_R) this.activeCells.delete(key);
      }
    }
    if (this.density <= 0 || this.creatures.length >= MAX_ACTIVE) return;

    // roll unvisited cells near the player, nearest first
    const pcx = Math.floor(playerPos.x / CELL), pcz = Math.floor(playerPos.z / CELL);
    const range = Math.ceil(SPAWN_R / CELL);
    const cand = [];
    for (let dz = -range; dz <= range; dz++) {
      for (let dx = -range; dx <= range; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const key = cx + ',' + cz;
        if (this.activeCells.has(key)) continue;
        const wx = (cx + 0.5) * CELL - playerPos.x, wz = (cz + 0.5) * CELL - playerPos.z;
        const d2 = wx * wx + wz * wz;
        if (d2 > SPAWN_R * SPAWN_R) continue;
        cand.push([d2, cx, cz, key]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz, key] of cand) {
      if (this.creatures.length >= MAX_ACTIVE) break;
      this._spawnCell(cx, cz, key);
    }
  }

  /* --------------------------------------------------------------- AI */

  _think(c, dt, playerPos) {
    const p = c.group.position;
    const prof = c.profile;
    const type = prof.bodyType;
    const dPlayer = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
    c.stateT -= dt;

    // threat responses override calm states
    if (prof.temperament === 'skittish') {
      const fr = 9 + prof.size * 3.5;
      if (dPlayer < fr && c.state !== 'flee') { c.state = 'flee'; c.stateT = 6; }
    } else if (prof.temperament === 'territorial' && type !== 'floater') {
      const ar = 15 + prof.size * 2.5;
      if (dPlayer < ar && c.state !== 'circle' && c.state !== 'flee') {
        c.state = 'circle'; c.stateT = c.rng.range(8, 16);
      }
    }

    switch (c.state) {
      case 'idle': // graze
        c.desired01 = 0;
        if (c.stateT <= 0) {
          if (type === 'flyer' && c.rng.chance(0.6)) {
            c.state = 'fly'; c.stateT = c.rng.range(10, 22);
            c.altT = c.rng.range(4, 11); c.orbR = c.rng.range(8, 22);
          } else {
            c.state = 'wander'; c.stateT = c.rng.range(5, 10);
            const a = c.rng.range(0, Math.PI * 2), r = c.rng.range(6, 24);
            c.target.set(c.home.x + Math.cos(a) * r, 0, c.home.z + Math.sin(a) * r);
          }
        }
        break;

      case 'wander': {
        c.desired01 = 0.42;
        this._steerTo(c, c.target.x, c.target.z, dt, 2.2);
        const dt2 = Math.hypot(p.x - c.target.x, p.z - c.target.z);
        if (dt2 < 1.6 || c.stateT <= 0) { c.state = 'idle'; c.stateT = c.rng.range(2, 6); }
        break;
      }

      case 'flee': {
        c.desired01 = 1;
        const away = Math.atan2(p.x - playerPos.x, p.z - playerPos.z);
        this._turnToward(c, away, dt, 4.5);
        if (type === 'flyer') { c.altT = 9; }
        const fr = 9 + prof.size * 3.5;
        if (dPlayer > fr * 2.6 || c.stateT <= 0) {
          c.state = type === 'floater' ? 'drift' : (type === 'flyer' ? 'fly' : 'idle');
          c.stateT = c.rng.range(3, 8);
        }
        break;
      }

      case 'circle': { // territorial: close in, then prowl a ring around the player
        c.desired01 = 0.72;
        c.orbA += dt * 0.55;
        const ring = 5 + prof.size * 1.6;
        const tx = playerPos.x + Math.sin(c.orbA) * ring;
        const tz = playerPos.z + Math.cos(c.orbA) * ring;
        this._steerTo(c, tx, tz, dt, 3.2);
        if (dPlayer > 34 || c.stateT <= 0) { c.state = 'idle'; c.stateT = c.rng.range(2, 5); }
        break;
      }

      case 'drift': { // floaters: aimless slow meander around home
        c.desired01 = 0.32;
        if (c.stateT <= 0) {
          c.stateT = c.rng.range(3, 7);
          const a = c.rng.range(0, Math.PI * 2), r = c.rng.range(10, 30);
          c.target.set(c.home.x + Math.cos(a) * r, 0, c.home.z + Math.sin(a) * r);
        }
        this._steerTo(c, c.target.x, c.target.z, dt, 0.6);
        break;
      }

      case 'fly': { // flyers: orbit home aloft, occasionally land
        c.desired01 = 0.85;
        c.orbA += dt * (prof.speed * 0.85) / c.orbR;
        const tx = c.home.x + Math.sin(c.orbA) * c.orbR;
        const tz = c.home.z + Math.cos(c.orbA) * c.orbR;
        this._steerTo(c, tx, tz, dt, 2.6);
        c.altT += Math.sin(c.orbA * 2.3) * dt * 1.5;
        c.altT = Math.min(12, Math.max(3.5, c.altT));
        if (c.stateT <= 0 && c.rng.chance(0.4)) {
          c.state = 'landing'; c.stateT = 12; c.altT = 0;
          c.target.set(c.home.x + c.rng.range(-8, 8), 0, c.home.z + c.rng.range(-8, 8));
        } else if (c.stateT <= 0) c.stateT = c.rng.range(6, 14);
        break;
      }

      case 'landing': {
        c.desired01 = 0.45;
        this._steerTo(c, c.target.x, c.target.z, dt, 2.4);
        if (c.alt < 0.25 || c.stateT <= 0) {
          c.alt = 0; c.state = 'idle'; c.stateT = c.rng.range(3, 7);
        }
        break;
      }

      default:
        c.state = 'idle'; c.stateT = 1;
    }
  }

  _steerTo(c, tx, tz, dt, turnRate) {
    const p = c.group.position;
    const want = Math.atan2(tx - p.x, tz - p.z);
    this._turnToward(c, want, dt, turnRate);
  }

  _turnToward(c, want, dt, turnRate) {
    const d = wrapAngle(want - c.heading);
    const step = Math.max(-turnRate * dt, Math.min(turnRate * dt, d));
    c.heading = wrapAngle(c.heading + step);
  }

  _move(c, dt) {
    const p = c.group.position;
    const prof = c.profile;
    const type = prof.bodyType;

    c.speed01 += Math.max(-3 * dt, Math.min(3 * dt, c.desired01 - c.speed01));
    const v = prof.speed * c.speed01;
    const nx = p.x + Math.sin(c.heading) * v * dt;
    const nz = p.z + Math.cos(c.heading) * v * dt;

    let ground = this.field.height(nx, nz);
    // refuse to walk into the sea — bounce heading back toward home
    if (type !== 'flyer' && type !== 'floater' && ground <= this.field.seaY + 0.3) {
      c.heading = Math.atan2(c.home.x - p.x, c.home.z - p.z);
      c.state = 'wander'; c.target.copy(c.home);
      ground = this.field.height(p.x, p.z);
    } else {
      p.x = nx; p.z = nz;
    }

    // altitude for flyers
    if (type === 'flyer') {
      const rate = c.state === 'landing' ? 2.2 : 3.2;
      c.alt += Math.max(-rate * dt, Math.min(rate * dt, c.altT - c.alt));
    }
    const targetY = ground + c.hover + c.alt;
    p.y += (targetY - p.y) * Math.min(1, 9 * dt);

    // subtle slope alignment (walkers only), throttled normal sampling
    c.nT -= dt;
    if (c.nT <= 0) {
      c.nT = 0.15 + Math.random() * 0.1; // transient stagger only
      const n = this.field.normal(p.x, p.z);
      c.nx = n.x; c.ny = n.y; c.nz = n.z;
    }
    const tiltAmt = (type === 'flyer' || type === 'floater') ? 0.06 : 0.3;
    _n.set(c.nx, c.ny, c.nz).lerp(_up, 1 - tiltAmt).normalize();
    _qTilt.setFromUnitVectors(_up, _n);
    _qYaw.setFromAxisAngle(_up, c.heading);
    _qTarget.copy(_qTilt).multiply(_qYaw);
    c.group.quaternion.slerp(_qTarget, Math.min(1, 6 * dt));
  }

  /* ------------------------------------------------------------ public */

  /**
   * Advance population + AI + gait animation.
   * @param {number} dt seconds
   * @param {THREE.Vector3} playerPos player position in surface metres
   */
  update(dt, playerPos) {
    if (!playerPos) return;
    this._scanT -= dt;
    if (this._scanT <= 0) {
      this._scanT = SCAN_INTERVAL;
      this._scan(playerPos);
    }
    for (const c of this.creatures) {
      this._think(c, dt, playerPos);
      this._move(c, dt);
      c.obj.animate(dt, c.speed01);
    }
  }

  /**
   * Nearest creature to a point within range (scanner support).
   * @param {THREE.Vector3} pos
   * @param {number} range metres
   * @returns {{name: string, profile: object, position: THREE.Vector3}|null}
   */
  scanNearest(pos, range) {
    let best = null, bestD = range * range;
    for (const c of this.creatures) {
      const d = c.group.position.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) return null;
    return { name: best.profile.name, profile: best.profile, position: best.group.position.clone() };
  }

  /** Release all creatures and detach from the scene. */
  dispose() {
    for (let i = this.creatures.length - 1; i >= 0; i--) this._release(this.creatures[i]);
    this.creatures.length = 0;
    this.activeCells.clear();
    this.scene.remove(this.root);
  }
}
