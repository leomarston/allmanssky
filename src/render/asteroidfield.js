// Local asteroid field: a wraparound cloud of instanced rocks the ship flies
// through and mines — NMS-style "space feels full of stuff", not just a distant
// belt ring. Rocks live in a box of half-extent R around the ship; as the ship
// flies, rocks that fall out the back are recycled onto the leading face ahead
// (fresh size/spin/resource), so the field never depletes and never pops in at
// close range. Two InstancedMeshes: the rocks, and a matching cloud of emissive
// resource-vein specks (tritium-cyan / metal-amber) that feed HDR bloom.
//
// Deterministic-ish: initial layout + every recycle draws from one RNG stream
// seeded off the system seed. The exact rock you pass on the third orbit isn't
// reproducible (it's been recycled), but a given system always feels the same.
//
// CONTRACT (spacestate depends on these exact shapes):
//   new AsteroidField(scene, system, { center?, density?, count?, radius?, seed? })
//     .update(dt, shipPos, shipVel)                       — stream + tumble
//     .hitScan(origin, dir, maxDist) -> { asteroid, point } | null
//     .damage(asteroid, amount) -> { destroyed, resource, amount } | null
//     .nearestWithin(pos, radius) -> asteroid | null
//     .positionOf(asteroid) -> THREE.Vector3   (live ref — read only)
//     .dispose()
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';
import { SimplexNoise } from '../core/noise.js';
import { ITEMS } from '../gameplay/items.js';

const HARD_CAP = 300;         // absolute ceiling on instances (perf guardrail)
const VEIN_HDR = 3.6;         // emissive multiplier so specks clear bloom threshold

// Resource yield table (ids verified against items.js). Weighted common→rare.
function rollResource(rng) {
  const r = rng.next();
  if (r < 0.40) return 'ferrox';    // amber structural metal (common)
  if (r < 0.68) return 'silica';    // pale glass dust (common)
  if (r < 0.80) return 'cryostal';  // cyan ice (the "tritium-cyan" vein)
  if (r < 0.89) return 'voidsalt';  // violet warp salt
  if (r < 0.94) return 'carbyne';   // green carbon
  if (r < 0.98) return 'aurium';    // gold precious
  return 'solanite';                // ember precious (rare)
}

/** Item color as a linear THREE.Color (falls back to cold blue). */
function itemLinColor(out, id) {
  return out.set(ITEMS[id]?.color ?? '#9adcff');
}

export class AsteroidField {
  /**
   * @param {THREE.Scene} scene scene that owns the two instanced meshes
   * @param {object} system star system def (uses system.seed, system.belt?.density)
   * @param {object} [opts]
   * @param {THREE.Vector3} [opts.center] initial field center (pass the ship pos)
   * @param {number} [opts.density] 0..1 rock density (default from belt / 0.4)
   * @param {number} [opts.count] explicit instance count (else derived, capped)
   * @param {number} [opts.radius] box half-extent R in metres (default 450)
   * @param {number} [opts.seed] override RNG seed
   */
  constructor(scene, system, opts = {}) {
    this.scene = scene;
    this.system = system;

    // Density: prefer the belt's, but every system gets a sane local field.
    const density = THREE.MathUtils.clamp(opts.density ?? system?.belt?.density ?? 0.4, 0, 1);
    this.R = opts.radius ?? 450;
    this.count = Math.max(24, Math.min(HARD_CAP,
      Math.round(opts.count ?? (120 + density * 180))));

    const seed = (opts.seed ?? hash32(system?.seed | 0, hashString('asteroidfield'))) >>> 0;
    this.rng = new RNG(seed);

    // -- geometry + materials (all stock; SwiftShader-safe, no custom shaders) --
    this.rockGeo = this._buildRockGeo(seed ^ 0x9151);
    this.rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.92, metalness: 0.08,
      vertexColors: true, flatShading: true,  // crevice shade × per-instance albedo
    });
    this.rock = new THREE.InstancedMesh(this.rockGeo, this.rockMat, this.count);
    this.rock.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rock.frustumCulled = false;       // positions stream; bounding sphere is stale
    this.rock.castShadow = false;
    this.rock.receiveShadow = false;

    this.veinGeo = new THREE.OctahedronGeometry(1, 0);   // tiny faceted crystal
    this.veinMat = new THREE.MeshBasicMaterial({ color: 0xffffff });  // HDR via instanceColor
    this.vein = new THREE.InstancedMesh(this.veinGeo, this.veinMat, this.count);
    this.vein.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.vein.frustumCulled = false;

    scene.add(this.rock, this.vein);

    // -- seed the cloud around the initial center -----------------------------
    const c = opts.center ?? new THREE.Vector3();
    this.asteroids = new Array(this.count);
    this._colorDirty = false;
    for (let i = 0; i < this.count; i++) {
      const a = {
        i,
        pos: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(),
        scaleVec: new THREE.Vector3(), veinScaleVec: new THREE.Vector3(),
        veinOffset: new THREE.Vector3(),
        radius: 1, hp: 1, maxHp: 1, yieldBase: 1,
        alive: true, resource: 'ferrox', hasVein: false,
      };
      a.pos.set(
        c.x + this.rng.range(-1, 1) * this.R,
        c.y + this.rng.range(-1, 1) * this.R,
        c.z + this.rng.range(-1, 1) * this.R,
      );
      this._roll(a);
      this.asteroids[i] = a;
      this._compose(a);
    }
    this.rock.instanceMatrix.needsUpdate = true;
    this.vein.instanceMatrix.needsUpdate = true;
    if (this.rock.instanceColor) this.rock.instanceColor.needsUpdate = true;
    if (this.vein.instanceColor) this.vein.instanceColor.needsUpdate = true;
  }

  // ---- per-frame streaming ---------------------------------------------------

  /**
   * Tumble every rock, recycle any that fell outside the box onto the leading
   * face, and re-upload the instance matrices.
   * @param {number} dt seconds
   * @param {THREE.Vector3} shipPos field center (ship position)
   * @param {THREE.Vector3} [shipVel] ship velocity (aims respawns ahead)
   */
  update(dt, shipPos, shipVel) {
    const R = this.R;
    const cx = shipPos.x, cy = shipPos.y, cz = shipPos.z;
    const vx = shipVel ? shipVel.x : 0, vy = shipVel ? shipVel.y : 0, vz = shipVel ? shipVel.z : 0;
    this._colorDirty = false;

    for (let idx = 0; idx < this.count; idx++) {
      const a = this.asteroids[idx];
      // slow tumble
      a.rot.x += a.spin.x * dt;
      a.rot.y += a.spin.y * dt;
      a.rot.z += a.spin.z * dt;
      // recycle when it leaves the box (destroyed rocks recycle too → never depletes)
      if (Math.abs(a.pos.x - cx) > R || Math.abs(a.pos.y - cy) > R || Math.abs(a.pos.z - cz) > R) {
        this._respawn(a, cx, cy, cz, vx, vy, vz);
      }
      this._compose(a);
    }

    this.rock.instanceMatrix.needsUpdate = true;
    this.vein.instanceMatrix.needsUpdate = true;
    if (this._colorDirty) {
      if (this.rock.instanceColor) this.rock.instanceColor.needsUpdate = true;
      if (this.vein.instanceColor) this.vein.instanceColor.needsUpdate = true;
    }
  }

  // ---- weapons / mining API --------------------------------------------------

  /**
   * Nearest asteroid a ray hits (ray–sphere against each live rock). Mirrors the
   * hit test SpaceCombat runs against pirates, but as a forward ray from the nose.
   * @param {THREE.Vector3} origin ray start (ship position / muzzle)
   * @param {THREE.Vector3} dir normalized aim direction
   * @param {number} [maxDist=Infinity] ignore hits beyond this range
   * @returns {{ asteroid: object, point: THREE.Vector3 } | null}
   */
  hitScan(origin, dir, maxDist = Infinity) {
    _dir.copy(dir).normalize();
    const dx = _dir.x, dy = _dir.y, dz = _dir.z;
    let best = null, bestT = maxDist;
    for (let idx = 0; idx < this.count; idx++) {
      const a = this.asteroids[idx];
      if (!a.alive) continue;
      const ocx = a.pos.x - origin.x, ocy = a.pos.y - origin.y, ocz = a.pos.z - origin.z;
      const tca = ocx * dx + ocy * dy + ocz * dz;
      const r = a.radius;
      const d2 = (ocx * ocx + ocy * ocy + ocz * ocz) - tca * tca;
      if (d2 > r * r) continue;
      const thc = Math.sqrt(r * r - d2);
      let t = tca - thc;
      if (t < 0) t = tca;          // origin inside the rock — clamp to center dist
      if (t < 0 || t >= bestT) continue;
      bestT = t; best = a;
    }
    if (!best) return null;
    return { asteroid: best, point: _dir.clone().multiplyScalar(bestT).add(origin) };
  }

  /**
   * Apply mining/weapon damage. Returns null if the target is gone; otherwise a
   * result with the rock's resource and, on destruction, the granted yield.
   * @param {object} asteroid handle from hitScan / nearestWithin
   * @param {number} amount hp to remove
   * @returns {{ destroyed: boolean, resource: string, amount: number } | null}
   */
  damage(asteroid, amount) {
    if (!asteroid || !asteroid.alive) return null;
    asteroid.hp -= amount;
    if (asteroid.hp > 0) {
      return { destroyed: false, resource: asteroid.resource, amount: 0 };
    }
    asteroid.alive = false;         // hidden (scale 0) on next _compose; recycled on wrap
    this._compose(asteroid);        // hide immediately so it can't be re-hit this frame
    this.rock.instanceMatrix.needsUpdate = true;
    this.vein.instanceMatrix.needsUpdate = true;
    const base = asteroid.yieldBase;
    const rolled = base + this.rng.int(0, base);            // yield scales with size
    const total = Math.max(1, Math.round(rolled * (asteroid.hasVein ? 1.6 : 1)));
    return { destroyed: true, resource: asteroid.resource, amount: total };
  }

  /**
   * Nearest live asteroid whose surface is within `radius` of `pos` (for a simple
   * ship-collision nudge). Distance is to the rock surface, not its center.
   * @param {THREE.Vector3} pos @param {number} radius
   * @returns {object | null}
   */
  nearestWithin(pos, radius) {
    let best = null, bestD = radius;
    for (let idx = 0; idx < this.count; idx++) {
      const a = this.asteroids[idx];
      if (!a.alive) continue;
      const dx = a.pos.x - pos.x, dy = a.pos.y - pos.y, dz = a.pos.z - pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - a.radius;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  /** Live world position of an asteroid handle (read-only reference). */
  positionOf(asteroid) { return asteroid.pos; }

  dispose() {
    this.scene.remove(this.rock);
    this.scene.remove(this.vein);
    this.rock.dispose();
    this.vein.dispose();
    this.rockGeo.dispose();
    this.rockMat.dispose();
    this.veinGeo.dispose();
    this.veinMat.dispose();
    this.asteroids.length = 0;
  }

  // ---- internals -------------------------------------------------------------

  /** Write an asteroid's (and its vein speck's) instance matrix. */
  _compose(a) {
    _q.setFromEuler(a.rot);
    if (a.alive) {
      _m.compose(a.pos, _q, a.scaleVec);
      this.rock.setMatrixAt(a.i, _m);
      if (a.hasVein) {
        _v.copy(a.veinOffset).applyQuaternion(_q).add(a.pos);
        _m.compose(_v, _q, a.veinScaleVec);
      } else {
        _m.compose(a.pos, _QI, _ZERO);
      }
      this.vein.setMatrixAt(a.i, _m);
    } else {
      _m.compose(a.pos, _QI, _ZERO);       // scale 0 → invisible
      this.rock.setMatrixAt(a.i, _m);
      this.vein.setMatrixAt(a.i, _m);
    }
  }

  /** Recycle a rock onto the leading face (ahead of travel), fully refreshed. */
  _respawn(a, cx, cy, cz, vx, vy, vz) {
    const rng = this.rng, R = this.R;
    // pick the axis most aligned with travel so recycled rocks stream in ahead
    const ax = Math.abs(vx), ay = Math.abs(vy), az = Math.abs(vz);
    let axis, sign;
    if (ax >= ay && ax >= az && ax > 1e-4) { axis = 0; sign = Math.sign(vx); }
    else if (ay >= az && ay > 1e-4) { axis = 1; sign = Math.sign(vy); }
    else if (az > 1e-4) { axis = 2; sign = Math.sign(vz); }
    else { axis = rng.int(0, 2); sign = rng.chance(0.5) ? 1 : -1; }
    // leading face at 0.86..1.0 R keeps every respawn ≥ ~0.86R away (no close pop-in)
    a.pos.set(
      cx + (axis === 0 ? sign * R * rng.range(0.86, 1) : rng.range(-1, 1) * R),
      cy + (axis === 1 ? sign * R * rng.range(0.86, 1) : rng.range(-1, 1) * R),
      cz + (axis === 2 ? sign * R * rng.range(0.86, 1) : rng.range(-1, 1) * R),
    );
    this._roll(a);
  }

  /** Roll a rock's size class, spin, resource, vein and colors (fresh instance). */
  _roll(a) {
    const rng = this.rng;
    a.alive = true;
    // size classes: mostly small gravel, some boulders, a few hero rocks
    const t = rng.next();
    let base, hp, ybase;
    if (t < 0.55) { base = rng.range(2.5, 5); hp = 2; ybase = 2; }
    else if (t < 0.87) { base = rng.range(5, 10); hp = 3; ybase = 4; }
    else { base = rng.range(11, 22); hp = 5; ybase = 8; }
    a.scaleVec.set(
      base * rng.range(0.78, 1.22),
      base * rng.range(0.78, 1.22),
      base * rng.range(0.78, 1.22),
    );
    a.radius = base * 1.35;               // generous bound for hit / collision
    a.maxHp = hp; a.hp = hp; a.yieldBase = ybase;
    // tumble (smaller rocks spin faster)
    const s = 0.12 + (1 / base) * 0.9;
    a.spin.set(rng.range(-s, s), rng.range(-s, s), rng.range(-s, s));
    a.rot.set(rng.range(0, 6.283), rng.range(0, 6.283), rng.range(0, 6.283));
    // resource + vein
    a.resource = rollResource(rng);
    a.hasVein = rng.chance(0.42);
    if (a.hasVein) {
      _randDir(_v, rng).multiplyScalar(base * rng.range(0.7, 0.95));
      a.veinOffset.copy(_v);
      const vs = base * rng.range(0.12, 0.22);
      a.veinScaleVec.set(vs, vs, vs);
    }
    this._applyColors(a);
  }

  /** Per-instance albedo tint + HDR vein color. */
  _applyColors(a) {
    itemLinColor(_res, a.resource);
    _tint.set(0x8a7f72).lerp(_res, 0.24);     // rocky base, faintly resource-tinted
    this.rock.setColorAt(a.i, _tint);
    if (a.hasVein) {
      _vein.copy(_res).multiplyScalar(VEIN_HDR);
      this.vein.setColorAt(a.i, _vein);
    } else {
      this.vein.setColorAt(a.i, _BLACK);      // (scale 0 already hides it)
    }
    this._colorDirty = true;
  }

  /**
   * Faceted, noise-displaced icosahedron. Displacement is a pure function of the
   * unit-sphere direction, so the non-indexed polyhedron's duplicated corner
   * verts move identically — watertight, no cracks. Baked vertex color darkens
   * crevices; per-instance albedo multiplies on top.
   */
  _buildRockGeo(seed) {
    const noise = new SimplexNoise(seed >>> 0);
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).normalize();
      const d = 0.5 * noise.noise3D(_v.x * 1.6, _v.y * 1.6, _v.z * 1.6)
              + 0.28 * noise.noise3D(_v.x * 3.4 + 11, _v.y * 3.4, _v.z * 3.4)
              + 0.14 * noise.noise3D(_v.x * 7.1, _v.y * 7.1 + 7, _v.z * 7.1);
      const disp = Math.max(0.55, 1 + d * 0.42);
      pos.setXYZ(i, _v.x * disp, _v.y * disp, _v.z * disp);
      const shade = 0.6 + 0.4 * THREE.MathUtils.clamp(0.5 + d * 0.6, 0, 1);
      col[i * 3] = shade; col[i * 3 + 1] = shade; col[i * 3 + 2] = shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }
}

// module-scope scratch (no per-frame allocation)
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _QI = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ZERO = new THREE.Vector3(0, 0, 0);
const _res = new THREE.Color();
const _tint = new THREE.Color();
const _vein = new THREE.Color();
const _BLACK = new THREE.Color(0, 0, 0);

function _randDir(out, rng) {
  const u = rng.range(-1, 1), a = rng.range(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), s * Math.sin(a), u);
}
