// PlanetFauna — wandering CREATURES for the SEAMLESS round planet (?state=planet).
//
// Streams a small population of procedural beasts (buildCreature) around the
// player, glued to the curved terrain, so walking the world feels alive. Reuses
// the verified creature builder verbatim — this module only PLACES, ORIENTS and
// DRIVES the herd on the sphere; it never rebuilds a creature.
//
// FLOATING-ORIGIN FRAME (mirrors PlanetScatter exactly)
//   PlanetSphere renders camera-relative: its root group sits at
//   (planetCenter - playerUniPos) while terrain vertices are ABSOLUTE planet-
//   local positions (dir * heightAt(dir)). We do the same: every creature lives
//   inside one Group whose position is set to (planetCenter - playerUniPos) each
//   frame, and each creature's own group.position is its ABSOLUTE planet-local
//   pose (uniPos). Creature world pos therefore equals uniPos - playerUniPos —
//   the identical frame the ground uses — so beasts sit exactly on the visible
//   terrain and slide with the world as you walk. Because creatures MOVE, we
//   rewrite each creature's position+orientation per frame (there are only a few
//   of them, so per-object is cheap), unlike the static instanced scatter.
//
// SPHERE PLACEMENT / ORIENTATION
//   A creature tracks its own planet-local uniPos and a unit tangent `heading`.
//   Each frame it advances tangentially (uniPos += heading * speed * dt), then
//   re-projects to heightAt(dir)+offset so it hugs the terrain, and re-projects
//   heading back into the (now-rotated) tangent plane. Orientation is a basis
//   whose local +Y = the radial normal dir (so the beast stands up out of the
//   round ground) and local +Z = heading (so it faces where it walks); +X =
//   dir x heading keeps the basis right-handed (no mirroring).
//
// WANDER AI (on the sphere)
//   Lightweight per-creature state machine: idle -> wander (gentle turns) ->
//   idle; skittish beasts FLEE the player tangentially; curious docile beasts
//   mildly APPROACH. Flyers/floaters hover a fixed offset above the ground and
//   drift. speed01 (smoothed toward a desired) feeds creature.animate() so legs/
//   wings animate in step with real tangential speed.
//
// STREAMING
//   Deterministic per (planetSeed, cube-face, cell) like PlanetScatter: cells on
//   a cube-face UV grid are rolled around the player, nearest first; a hit spawns
//   one beast if the ground there is above sea, below the snow line and not too
//   steep. Beasts beyond a despawn ring are released and their cell freed so the
//   same herd re-appears on return. Hard population cap. No fauna above an AGL
//   cutoff (so nothing spawns from orbit / high flight).

import * as THREE from 'three';
import { RNG, hash32 } from '../core/rng.js';
import { buildCreature } from './creature.js';

// --- tunables ---------------------------------------------------------------
const MAX_ACTIVE = 8;        // hard population cap
const SPAWN_R = 95;          // metres — roll/spawn cells within this ring
const DESPAWN_R = 150;       // metres — release beasts beyond this
const AGL_CUTOFF = 160;      // metres — no fauna above this altitude
const CELL_M = 34;           // metres — fauna cell size near a cube-face centre
const SCAN_INTERVAL = 0.5;   // seconds between population scans
const SLOPE_MIN = 0.60;      // reject spawns where local normal.y < this (too steep)
const MIN_ALT = 2.0;         // metres above sea — keep beasts off the shoreline
const SNOW_MARGIN = 0.92;    // stay below SNOW_MARGIN * snow line
const WALK_OFFSET = 0.05;    // metres — walkers' feet just clear of the ground
const TURN_SPEED = 0.9;      // rad/s — wander meander turn rate

// Biome pool for buildCreature — earthy/temperate ids that read well against the
// planet's grass/rock/snow bands. Picked deterministically from the planet seed.
// Used only as a fallback when no biome descriptor is supplied.
const BIOME_POOL = ['lush', 'lush', 'swamp', 'frozen', 'barren', 'crystal'];

// Planet biome key -> a creature-biome id understood by buildCreature (creature
// ids differ from planet keys: scorched worlds host 'volcanic' fauna, etc.).
const CREATURE_BIOME = {
  lush: 'lush', ocean: 'ocean', desert: 'desert', frozen: 'frozen',
  toxic: 'toxic', scorched: 'volcanic', barren: 'barren', exotic: 'exotic',
};

// Per-biome population multiplier (mirrors the cover density scale) — the cap is
// this * MAX_ACTIVE so herds thin out on arid/dead worlds (near-none on barren).
const FAUNA_DENSITY = {
  lush: 1.0, ocean: 0.85, toxic: 0.95, exotic: 0.8,
  frozen: 0.45, desert: 0.32, scorched: 0.14, barren: 0.06,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class PlanetFauna {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./planetsphere.js').PlanetSphere} planet
   * @param {object} [opts]
   * @param {number} [opts.seed]      deterministic placement seed
   * @param {object|string} [opts.biome] biome descriptor (palette/key) or a raw
   *                                   creature-biome id; drives fauna id + cap
   * @param {number} [opts.density=1] 0..1 scales spawn probability
   * @param {number} [opts.maxActive] override the population cap
   */
  constructor(scene, planet, opts = {}) {
    this.scene = scene;
    this.planet = planet;
    this.radius = planet.radius;
    this.seaLevel = planet.seaLevel;
    this.seed = (opts.seed ?? 0xfa0a) >>> 0;
    this.density = clamp(opts.density ?? 1, 0, 1);

    // Resolve the biome: a full descriptor object (planet biome), a raw creature-
    // biome id string, or a deterministic pick when absent. The creature-biome id
    // feeds buildCreature; the descriptor's key also scales the population cap so
    // arid/dead worlds read sparse (barren -> ~none).
    const b = opts.biome;
    const key = (b && typeof b === 'object') ? b.key
      : (typeof b === 'string' ? b : null);
    this.biome = (b && typeof b === 'object')
      ? (CREATURE_BIOME[b.key] || 'lush')
      : (typeof b === 'string' ? b
        : BIOME_POOL[hash32(this.seed, 0xb10e) % BIOME_POOL.length]);
    const capMul = (key && FAUNA_DENSITY[key] != null) ? FAUNA_DENSITY[key] : 1;
    let cap = Math.round(MAX_ACTIVE * capMul);
    if (cap < 1 && capMul >= 0.10) cap = 1;   // keep a lone beast except on dead worlds
    this.maxActive = opts.maxActive ?? cap;

    this.cellUV = CELL_M / this.radius;
    this._R = Math.ceil(SPAWN_R / CELL_M) + 1;   // cell neighbourhood radius
    this._spawn2 = SPAWN_R * SPAWN_R;
    this._despawn2 = DESPAWN_R * DESPAWN_R;

    // the rebased frame — tracks (planetCenter - playerUniPos) like PlanetSphere.
    this.root = new THREE.Group();
    this.root.name = 'planetFauna';
    scene.add(this.root);

    this.creatures = [];
    this.activeCells = new Set();   // cells already rolled (even if empty/invalid)
    this._scanT = 0;

    // scratch — no per-frame allocation in the hot path.
    this._up = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._t0 = new THREE.Vector3();
    this._b0 = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._xAxis = new THREE.Vector3();
    this._yAxis = new THREE.Vector3();
    this._zAxis = new THREE.Vector3();
    this._steer = new THREE.Vector3();
    this._cross = new THREE.Vector3();
    this._cc = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m4 = new THREE.Matrix4();
    this._face = 0; this._u = 0; this._v = 0;
  }

  // --- cube-face parameterisation (shared, seam-consistent grid) ------------

  _faceUV(x, y, z) {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax >= ay && ax >= az) {
      const inv = 1 / ax; this._face = x < 0 ? 1 : 0; this._u = y * inv; this._v = z * inv;
    } else if (ay >= az) {
      const inv = 1 / ay; this._face = y < 0 ? 3 : 2; this._u = x * inv; this._v = z * inv;
    } else {
      const inv = 1 / az; this._face = z < 0 ? 5 : 4; this._u = x * inv; this._v = y * inv;
    }
  }

  _dirFromFace(face, u, v, out) {
    const a = face >> 1, s = (face & 1) ? -1 : 1;
    if (a === 0) out.set(s, u, v);
    else if (a === 1) out.set(u, s, v);
    else out.set(u, v, s);
    return out.normalize();
  }

  // Deterministic orthonormal tangent pair at a radial dir (into _t0,_b0).
  _tangents(dir) {
    const t0 = this._t0;
    t0.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.9) t0.set(1, 0, 0);
    t0.addScaledVector(dir, -t0.dot(dir)).normalize();
    this._b0.crossVectors(dir, t0).normalize();
  }

  // Local surface normal.y at a unit dir via heightAt central differences.
  _slopeNy(dir) {
    this._tangents(dir);
    const eps = 1.5 / this.radius, e = 1.5, n = this._n;
    const hL = this.planet.heightAt(n.copy(dir).addScaledVector(this._t0, -eps));
    const hR = this.planet.heightAt(n.copy(dir).addScaledVector(this._t0, eps));
    const hD = this.planet.heightAt(n.copy(dir).addScaledVector(this._b0, -eps));
    const hU = this.planet.heightAt(n.copy(dir).addScaledVector(this._b0, eps));
    const du = hR - hL, dv = hU - hD, e2 = 2 * e;
    return e2 / Math.sqrt(du * du + e2 * e2 + dv * dv);
  }

  // --- population -----------------------------------------------------------

  _hoverFor(bodyType, rng) {
    if (bodyType === 'flyer') return rng.range(3.5, 7.5);
    if (bodyType === 'floater') return rng.range(1.4, 2.8);
    return WALK_OFFSET;
  }

  // Try to spawn one deterministic beast for a cube-face cell.
  _spawnCell(face, ci, cj, playerUniPos) {
    const key = face + ':' + ci + ':' + cj;
    if (this.activeCells.has(key)) return;
    this.activeCells.add(key);

    const rng = new RNG(hash32(this.seed, face, ci, cj));
    if (!rng.chance(this.density * 0.16)) return;

    const u = (ci + rng.next()) * this.cellUV;
    const v = (cj + rng.next()) * this.cellUV;
    const dir = this._dirFromFace(face, u, v, this._dir);
    const groundR = this.planet.heightAt(dir);
    const alt = groundR - this.seaLevel;
    const lat = Math.abs(dir.y);
    const snow = 155 * (1 - lat * 0.7);
    if (alt < MIN_ALT || alt > snow * SNOW_MARGIN) return;   // sea/snow reject
    if (this._slopeNy(dir) < SLOPE_MIN) return;              // steep reject

    // metric ring cull (measured from the player's ground point)
    this._cc.copy(dir).multiplyScalar(groundR);
    if (this._cc.distanceToSquared(playerUniPos) > this._spawn2) return;

    const cseed = hash32(this.seed, face, ci, cj, 0x1a);
    const obj = buildCreature(cseed, this.biome);
    const prof = obj.profile;
    const arng = new RNG(hash32(cseed, 0xa1));
    const offset = this._hoverFor(prof.bodyType, arng);

    const c = {
      obj, group: obj.group, profile: prof, rng: arng, cellKey: key,
      uniPos: dir.clone().multiplyScalar(groundR + offset),
      heading: new THREE.Vector3(),
      offset,
      speed01: 0, desired01: 0,
      state: 'idle', stateT: arng.range(0.5, 3.5),
      turnT: arng.range(1, 3), turnDir: 0,
    };
    // random initial tangent heading
    this._tangents(dir);
    const a = arng.range(0, Math.PI * 2);
    c.heading.copy(this._t0).multiplyScalar(Math.cos(a)).addScaledVector(this._b0, Math.sin(a)).normalize();

    this.root.add(c.group);
    this._orient(c, dir);
    this.creatures.push(c);
  }

  _release(c) {
    this.activeCells.delete(c.cellKey);
    c.obj.dispose();                 // also removes group from its parent
    const i = this.creatures.indexOf(c);
    if (i >= 0) this.creatures.splice(i, 1);
  }

  _releaseAll() {
    for (let i = this.creatures.length - 1; i >= 0; i--) this.creatures[i].obj.dispose();
    this.creatures.length = 0;
    this.activeCells.clear();
  }

  _scan(playerUniPos) {
    // despawn far beasts, free their cells for a deterministic re-roll later.
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      if (c.uniPos.distanceToSquared(playerUniPos) > this._despawn2) this._release(c);
    }
    // free rolled-but-empty far cells so they can re-roll on return.
    if (this.activeCells.size > 256) this.activeCells.clear();

    if (this.creatures.length >= this.maxActive) return;

    // roll unvisited cells near the player, nearest first.
    this._faceUV(this._up.x, this._up.y, this._up.z);
    const face = this._face;
    const ci0 = Math.floor(this._u / this.cellUV);
    const cj0 = Math.floor(this._v / this.cellUV);
    const R = this._R, cand = [];
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R; di <= R; di++) {
        const d2 = di * di + dj * dj;
        cand.push([d2, ci0 + di, cj0 + dj]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, ci, cj] of cand) {
      if (this.creatures.length >= this.maxActive) break;
      this._spawnCell(face, ci, cj, playerUniPos);
    }
  }

  // --- AI + motion ----------------------------------------------------------

  // Rotate c.heading toward a target tangent vector, at `rate` rad/s.
  _steerToward(c, target, dir, dt, rate) {
    this._steer.copy(target);
    this._steer.addScaledVector(dir, -this._steer.dot(dir));
    if (this._steer.lengthSq() < 1e-8) return;
    this._steer.normalize();
    const cosA = clamp(c.heading.dot(this._steer), -1, 1);
    this._cross.crossVectors(c.heading, this._steer);
    const sign = this._cross.dot(dir) >= 0 ? 1 : -1;
    const ang = sign * Math.acos(cosA);
    const step = clamp(ang, -rate * dt, rate * dt);
    this._q.setFromAxisAngle(dir, step);
    c.heading.applyQuaternion(this._q);
  }

  _think(c, dt, playerUniPos, dir) {
    const prof = c.profile;
    c.stateT -= dt;
    const dPlayer = Math.sqrt(c.uniPos.distanceToSquared(playerUniPos));

    // threat / curiosity overrides
    if (prof.temperament === 'skittish') {
      const fr = 8 + prof.size * 3;
      if (dPlayer < fr && c.state !== 'flee') { c.state = 'flee'; c.stateT = 4; }
    } else if (prof.temperament === 'docile' && prof.bodyType !== 'floater'
      && dPlayer < 20 && dPlayer > 5 && c.state !== 'approach' && c.stateT <= 0
      && c.rng.chance(0.4)) {
      c.state = 'approach'; c.stateT = c.rng.range(2.5, 5);
    }

    switch (c.state) {
      case 'idle':
        c.desired01 = 0;
        if (c.stateT <= 0) { c.state = 'wander'; c.stateT = c.rng.range(3, 7); c.turnT = 0; }
        break;

      case 'wander':
        c.desired01 = 0.42;
        c.turnT -= dt;
        if (c.turnT <= 0) {
          c.turnT = c.rng.range(1.5, 4);
          const r = c.rng.next();
          c.turnDir = r < 0.55 ? 0 : (r < 0.78 ? 1 : -1);
        }
        if (c.turnDir !== 0) {
          this._q.setFromAxisAngle(dir, c.turnDir * TURN_SPEED * dt);
          c.heading.applyQuaternion(this._q);
        }
        if (c.stateT <= 0) { c.state = 'idle'; c.stateT = c.rng.range(2, 5); }
        break;

      case 'flee': {
        c.desired01 = 1;
        // away from the player, in the tangent plane
        this._steer.copy(c.uniPos).sub(playerUniPos);
        this._steerToward(c, this._steer, dir, dt, 4.0);
        const fr = 8 + prof.size * 3;
        if (dPlayer > fr * 2.6 || c.stateT <= 0) { c.state = 'idle'; c.stateT = c.rng.range(2, 5); }
        break;
      }

      case 'approach': {
        c.desired01 = 0.5;
        this._steer.copy(playerUniPos).sub(c.uniPos);
        this._steerToward(c, this._steer, dir, dt, 2.0);
        if (dPlayer < 5 || c.stateT <= 0) { c.state = 'idle'; c.stateT = c.rng.range(2, 4); }
        break;
      }

      default:
        c.state = 'idle'; c.stateT = 1;
    }
  }

  // Advance tangentially, glue to terrain, re-project heading, orient.
  _move(c, dt) {
    // smooth speed toward the desired
    c.speed01 += clamp(c.desired01 - c.speed01, -3 * dt, 3 * dt);
    const v = c.profile.speed * c.speed01;
    if (v > 1e-5) c.uniPos.addScaledVector(c.heading, v * dt);

    // re-project onto the terrain (hug the surface)
    const dir = this._dir.copy(c.uniPos).normalize();
    const groundR = this.planet.heightAt(dir);
    c.uniPos.copy(dir).multiplyScalar(groundR + c.offset);

    // re-project heading into the current tangent plane (sphere turns under it)
    c.heading.addScaledVector(dir, -c.heading.dot(dir));
    if (c.heading.lengthSq() < 1e-8) {
      this._tangents(dir);
      c.heading.copy(this._t0);
    }
    c.heading.normalize();

    this._orient(c, dir);
  }

  // Place + orient a creature in the floating-origin frame: local +Y -> dir
  // (radial up), local +Z -> heading (tangent), +X = dir x heading (right).
  _orient(c, dir) {
    c.group.position.copy(c.uniPos);          // absolute planet-local (root is rebased)
    this._yAxis.copy(dir);
    this._zAxis.copy(c.heading);
    this._xAxis.crossVectors(this._yAxis, this._zAxis).normalize();
    this._zAxis.crossVectors(this._xAxis, this._yAxis).normalize();  // re-orthonormalise
    this._m4.makeBasis(this._xAxis, this._yAxis, this._zAxis);
    c.group.quaternion.setFromRotationMatrix(this._m4);
  }

  // --- per-frame ------------------------------------------------------------

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} playerUniPos player position (planet-centre frame)
   * @param {THREE.Vector3} [up] radial up (normalised); derived if omitted
   */
  update(dt, playerUniPos, up) {
    // rebase our frame under the camera exactly like PlanetSphere.root.
    this.root.position.copy(this.planet.planetCenter).sub(playerUniPos);

    if (up) this._up.copy(up).normalize();
    else this._up.copy(playerUniPos).normalize();

    // no fauna from high up: release everything and force a re-roll on descent.
    const groundR = this.planet.heightAt(this._up);
    const agl = playerUniPos.length() - groundR;
    if (agl > AGL_CUTOFF) {
      if (this.creatures.length) this._releaseAll();
      this._scanT = 0;
      return;
    }

    this._scanT -= dt;
    if (this._scanT <= 0) {
      this._scanT = SCAN_INTERVAL;
      this._scan(playerUniPos);
    }

    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      this._dir.copy(c.uniPos).normalize();     // current radial for the AI turn axis
      this._think(c, dt, playerUniPos, this._dir);
      this._move(c, dt);
      c.obj.animate(dt, c.speed01);
    }
  }

  dispose() {
    this._releaseAll();
    this.scene.remove(this.root);
  }
}
