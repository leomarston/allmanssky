// The Aurelia Reach: a seeded spiral-disc galaxy on a 3D sector grid.
// Sector-hash star generation — any sector can be queried in any order and
// always yields the same stars; systems are generated lazily and cached.
import * as THREE from 'three';
import { RNG, hash32 } from '../core/rng.js';
import { generateSystem, STAR_CLASSES } from './starsystem.js';
import { systemName } from './lore.js';

export const GALAXY_SEED_DEFAULT = 1337;

const DISC_RADIUS = 60;        // density has mostly died out by ~60 sectors
const MAX_SECTOR_CACHE = 8192; // sector-list LRU cap (scans can touch 10^4+)
const CLASS_ORDER = Object.keys(STAR_CLASSES);
const CLASS_TOTAL = CLASS_ORDER.reduce((s, k) => s + STAR_CLASSES[k].weight, 0);

// deterministic fixed anchor for the starting-system search: mid-disc, on an
// arm-ish radius, so new Wayfarers wake with the whole Reach ahead of them
const START_ANCHOR = { x: 22, y: 0, z: 6 };

/** Weighted star-class pick (M common → O rare, exotic ~0.5%). */
function rollStarClass(rng) {
  let t = rng.next() * CLASS_TOTAL;
  for (const k of CLASS_ORDER) { t -= STAR_CLASSES[k].weight; if (t <= 0) return k; }
  return 'M';
}

/**
 * Deterministic galaxy: ~10^7 reachable stars in a thin spiral disc.
 * StarStub: { id:'sx:sy:sz:i', seed, name, pos:THREE.Vector3 (sector coords,
 * 1 sector = 1 unit), starClass, starColorHex }.
 */
export class Galaxy {
  /** @param {number} seed universe seed (same seed ⇒ identical galaxy) */
  constructor(seed = GALAXY_SEED_DEFAULT) {
    this.seed = seed >>> 0;
    this._sectors = new Map();  // 'sx:sy:sz' → [StarStub]
    this._systems = new Map();  // starId → StarSystem
    this._startId = null;
    // each galaxy seed twists its spiral arms differently
    this._armPhase = (hash32(this.seed, 0xa11) / 0xffffffff) * Math.PI * 2;
  }

  /** Expected star count for a sector: radial falloff + thin disc + 2 spiral arms. */
  _expectedCount(sx, sy, sz) {
    const r = Math.hypot(sx, sz);
    if (r > DISC_RADIUS * 1.15) return 0;
    const radial = Math.exp(-(r * r) / (2 * 24 * 24)) + 0.35 * Math.exp(-r / 30);
    const theta = Math.atan2(sz, sx);
    const arm = 0.5 + 0.5 * Math.cos(2 * theta - r * 0.3 - this._armPhase);
    const armMul = r < 5 ? 1 : 0.3 + 0.7 * Math.pow(arm, 1.6);
    const scaleH = 0.9 + 2.6 * Math.exp(-r / 22); // central bulge is thicker
    const vert = Math.exp(-(sy * sy) / (2 * scaleH * scaleH));
    return 3.6 * radial * armMul * vert;
  }

  /**
   * Deterministic stars for one sector (0–4), cached.
   * @returns {Array<object>} StarStub[]
   */
  starsInSector(sx, sy, sz) {
    sx |= 0; sy |= 0; sz |= 0;
    const key = `${sx}:${sy}:${sz}`;
    const hit = this._sectors.get(key);
    if (hit) return hit;

    const rng = new RNG(hash32(this.seed, sx, sy, sz));
    const expected = this._expectedCount(sx, sy, sz);
    let count = Math.floor(expected);
    if (rng.chance(expected - count)) count++;
    count = Math.max(0, Math.min(4, count));

    const stars = [];
    for (let i = 0; i < count; i++) {
      const sRng = rng.fork(i);
      const starClass = rollStarClass(sRng);
      stars.push({
        id: `${sx}:${sy}:${sz}:${i}`,
        seed: hash32(this.seed, sx, sy, sz, i),
        name: systemName(sRng.fork('name')),
        pos: new THREE.Vector3(
          sx + sRng.range(0.08, 0.92),
          sy + sRng.range(0.08, 0.92),
          sz + sRng.range(0.08, 0.92),
        ),
        starClass,
        starColorHex: sRng.pick(STAR_CLASSES[starClass].colors),
      });
    }

    if (this._sectors.size >= MAX_SECTOR_CACHE) {
      this._sectors.delete(this._sectors.keys().next().value);
    }
    this._sectors.set(key, stars);
    return stars;
  }

  /** Find a StarStub by its 'sx:sy:sz:i' id, or null. */
  _stubById(starId) {
    if (typeof starId !== 'string') return null;
    const parts = starId.split(':');
    if (parts.length !== 4) return null;
    const [sx, sy, sz, i] = parts.map(Number);
    if ([sx, sy, sz, i].some(Number.isNaN)) return null;
    return this.starsInSector(sx, sy, sz)[i] ?? null;
  }

  /**
   * Full StarSystem for a star id (cached).
   * @param {string} starId StarStub.id
   * @returns {object|null} StarSystem
   */
  getSystem(starId) {
    const hit = this._systems.get(starId);
    if (hit) return hit;
    const stub = this._stubById(starId);
    if (!stub) return null;
    const system = generateSystem(stub, this.seed);
    this._systems.set(starId, system);
    return system;
  }

  /**
   * Star stubs within `radiusSectors` (euclidean, sector units) of the given
   * star, sorted nearest-first, excluding the star itself.
   * @returns {Array<object>} StarStub[]
   */
  neighborsOf(starId, radiusSectors = 3) {
    const self = this._stubById(starId);
    if (!self) return [];
    const [cx, cy, cz] = starId.split(':').map(Number);
    const reach = Math.max(1, Math.ceil(radiusSectors));
    const out = [];
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dz = -reach; dz <= reach; dz++) {
          for (const stub of this.starsInSector(cx + dx, cy + dy, cz + dz)) {
            if (stub.id === starId) continue;
            const d = stub.pos.distanceTo(self.pos);
            if (d <= radiusSectors) out.push({ stub, d });
          }
        }
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.stub);
  }

  /**
   * Deterministic pleasant start: searches outward from a fixed anchor sector
   * for the first G/K-class star whose system holds a lush world. Same galaxy
   * seed ⇒ same starting system, always.
   * @returns {string} starId
   */
  startingSystemId() {
    if (this._startId) return this._startId;
    let fallback = null;
    for (let shell = 0; shell <= 16; shell++) {
      for (let dx = -shell; dx <= shell; dx++) {
        for (let dy = -shell; dy <= shell; dy++) {
          const ay = START_ANCHOR.y + dy;
          if (Math.abs(ay) > 3) continue; // the disc is thin — stay in it
          for (let dz = -shell; dz <= shell; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== shell) continue;
            for (const stub of this.starsInSector(START_ANCHOR.x + dx, ay, START_ANCHOR.z + dz)) {
              fallback = fallback ?? stub.id;
              if (stub.starClass !== 'G' && stub.starClass !== 'K') continue;
              const system = this.getSystem(stub.id);
              if (system?.planets.some((p) => p.biome === 'lush')) {
                this._startId = stub.id;
                return this._startId;
              }
            }
          }
        }
      }
    }
    this._startId = fallback ?? `${START_ANCHOR.x}:${START_ANCHOR.y}:${START_ANCHOR.z}:0`;
    return this._startId;
  }
}
