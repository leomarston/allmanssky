// TerrainField — THE deterministic height authority for planet surfaces.
// Pure math, no scene objects. Consumed by the terrain renderer AND gameplay
// physics, so height() is allocation-free and every noise instance is
// precomputed in the constructor. All content derives from planetDef.seed.
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';
import { SimplexNoise } from '../core/noise.js';

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth01(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

// Allocation-free 4-int hash (mirrors core hash32 mixing, without rest args —
// height() runs per vertex and per physics step, so no per-call arrays).
function mix32(h, k) {
  k = Math.imul(k, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
  h ^= k; h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}
function hash4(a, b, c, d) {
  let h = 0x9e3779b9 | 0;
  h = mix32(h, a | 0); h = mix32(h, b | 0); h = mix32(h, c | 0); h = mix32(h, d | 0);
  h ^= 4;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministic heightfield for one planet.
 * Continents (warped fbm, ~1500 m wavelength) + ridged mountains scaled by
 * def.terrain.relief (up to ~90 m) + roughness detail octaves, with smooth
 * plateau terracing, branching canyon carving, and crater bowls on a cell grid.
 */
export class TerrainField {
  /** @param {object} def PlanetDef (see ARCHITECTURE.md) */
  constructor(def) {
    this.def = def;
    this.seed = (def.seed ?? hashString(String(def.id ?? 'planet'))) >>> 0;
    const t = def.terrain ?? {};
    this.relief = clamp01(t.relief ?? 0.5);
    this.roughness = clamp01(t.roughness ?? 0.5);
    this.plateauAmt = clamp01(t.plateau ?? 0);
    this.craterAmt = clamp01(t.crater ?? 0);
    this.canyonAmt = clamp01(t.canyon ?? 0);
    this.warpAmt = 0.5 + clamp01(t.warp ?? 0.4) * 2.0;

    // amplitudes (metres) and wavelengths (1/m frequencies)
    this.contAmp = 14 + 34 * this.relief;
    this.mountAmp = 90 * this.relief;
    this.detailAmp = 1.2 + 6.5 * this.roughness;
    this.plateauStep = 12;
    this._craterCell = 230;

    this._nCont = new SimplexNoise(hash32(this.seed, 101));
    this._nMount = new SimplexNoise(hash32(this.seed, 102));
    this._nDetail = new SimplexNoise(hash32(this.seed, 103));
    this._nMoist = new SimplexNoise(hash32(this.seed, 104));
    this._nCanyon = new SimplexNoise(hash32(this.seed, 105));

    // player terrain edits (Arcforge dig mode): smooth bowls subtracted from
    // the base field. Indexed by 32 m cell; zero cost while empty.
    this._digs = [];
    this._digIndex = new Map();

    // Sea plane: def.seaLevel is the fraction of the height distribution that
    // sits below water. Estimate the quantile from a deterministic sample grid.
    this._seaY = -Infinity;
    const lvl = clamp01(def.seaLevel ?? 0);
    if (lvl > 0) {
      const n = 44, span = 3200, samples = new Float64Array(n * n);
      let k = 0;
      for (let j = 0; j < n; j++) {
        const z = -span / 2 + (span * j) / (n - 1);
        for (let i = 0; i < n; i++) {
          samples[k++] = this.height(-span / 2 + (span * i) / (n - 1), z);
        }
      }
      samples.sort();
      this._seaY = samples[Math.min(samples.length - 1, Math.floor(lvl * samples.length))];
    }
  }

  /** World Y of the sea plane, or -Infinity when the planet has no sea. */
  get seaY() { return this._seaY; }

  /**
   * Terrain height (metres) at world x,z. Fast + allocation-free: called per
   * vertex during chunk builds and per physics step.
   * @param {number} x @param {number} z @returns {number}
   */
  height(x, z) {
    // continents: domain-warped fbm, ~1500 m wavelength
    const c = this._nCont.warped2(x * (1 / 1500), z * (1 / 1500), this.warpAmt, 4);
    let h = c * this.contAmp;

    // ridged mountains rise on high continent regions
    if (this.mountAmp > 0.5) {
      const mask = smooth01((c + 0.05) / 0.55);
      if (mask > 0.002) {
        const r = this._nMount.ridged2(x * (1 / 620), z * (1 / 620), 4);
        h += r * r * this.mountAmp * mask;
      }
    }

    // roughness detail octaves
    h += this._nDetail.fbm2(x * (1 / 72), z * (1 / 72), 3) * this.detailAmp;

    // smooth plateau terracing
    if (this.plateauAmt > 0.01) {
      const s = h / this.plateauStep;
      const f = Math.floor(s);
      let g = (s - f - 0.5) * (1 + this.plateauAmt * 9) + 0.5;
      g = g < 0 ? 0 : g > 1 ? 1 : g;
      g = g * g * (3 - 2 * g);
      h += this.plateauAmt * ((f + g) * this.plateauStep - h);
    }

    // canyons: branching valleys where |warped noise| collapses to zero
    if (this.canyonAmt > 0.01) {
      const cv = Math.abs(this._nCanyon.warped2(x * (1 / 850), z * (1 / 850), 1.6, 3));
      const w = 0.10 + 0.10 * this.canyonAmt;
      if (cv < w) {
        const d = smooth01(1 - cv / w);
        h -= d * (14 + 26 * this.canyonAmt) * smooth01((c + 0.2) / 0.5);
      }
    }

    // craters: bowl + rim stamps on a deterministic cell grid
    if (this.craterAmt > 0.005) h += this._craterAt(x, z);

    // player excavations
    if (this._digs.length) h += this._digAt(x, z);
    return h;
  }

  /**
   * Carve a smooth bowl (Arcforge dig mode). Capped so save files stay sane.
   * @returns {boolean} false when the per-planet edit budget is exhausted
   */
  addDig(x, z, r, d) {
    if (this._digs.length >= 400) return false;
    const idx = this._digs.length;
    this._digs.push({ x, z, r, d });
    const c0x = Math.floor((x - r) / 32), c1x = Math.floor((x + r) / 32);
    const c0z = Math.floor((z - r) / 32), c1z = Math.floor((z + r) / 32);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const k = cx + ':' + cz;
        let a = this._digIndex.get(k);
        if (!a) this._digIndex.set(k, a = []);
        a.push(idx);
      }
    }
    return true;
  }

  /** restore persisted excavations: [[x,z,r,d], ...] */
  loadDigs(arr) {
    for (const [x, z, r, d] of arr ?? []) this.addDig(x, z, r, d);
  }

  _digAt(x, z) {
    const a = this._digIndex.get(Math.floor(x / 32) + ':' + Math.floor(z / 32));
    if (!a) return 0;
    let dh = 0;
    for (let i = 0; i < a.length; i++) {
      const m = this._digs[a[i]];
      const dx = x - m.x, dz = z - m.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= m.r * m.r) continue;
      const t = 1 - Math.sqrt(d2) / m.r;
      dh -= m.d * t * t * (3 - 2 * t);
    }
    return dh;
  }

  _craterAt(x, z) {
    const cell = this._craterCell;
    const cx0 = Math.floor(x / cell), cz0 = Math.floor(z / cell);
    let dh = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = cx0 + i, cz = cz0 + j;
        if (hash4(this.seed, cx, cz, 71) / 4294967296 > this.craterAmt * 0.8) continue;
        const ccx = (cx + 0.22 + 0.56 * (hash4(this.seed, cx, cz, 72) / 4294967296)) * cell;
        const ccz = (cz + 0.22 + 0.56 * (hash4(this.seed, cx, cz, 73) / 4294967296)) * cell;
        const rad = cell * (0.14 + 0.28 * (hash4(this.seed, cx, cz, 74) / 4294967296));
        const dx = x - ccx, dz = z - ccz;
        const d2 = dx * dx + dz * dz;
        if (d2 > rad * rad * 2.5) continue;
        const d = Math.sqrt(d2) / rad;
        const depth = (3 + rad * 0.14) * (0.5 + this.craterAmt);
        if (d < 1) dh += depth * (d * d - 1); // parabolic bowl
        const rim = 1 - Math.abs(d - 1.04) * 2.4;
        if (rim > 0) dh += depth * 0.35 * rim * rim; // raised rim
      }
    }
    return dh;
  }

  /**
   * Slow-varying moisture 0..1 — drives flora placement and terrain tinting.
   * @param {number} x @param {number} z @returns {number}
   */
  moisture(x, z) {
    const m = this._nMoist.fbm2(x * (1 / 1350) + 7.3, z * (1 / 1350) - 4.1, 3) * 0.62 + 0.5;
    return clamp01(m);
  }

  /**
   * Surface normal via central differences.
   * @param {number} x @param {number} z @param {number} [eps=1]
   * @returns {THREE.Vector3}
   */
  normal(x, z, eps = 1) {
    const hl = this.height(x - eps, z), hr = this.height(x + eps, z);
    const hd = this.height(x, z - eps), hu = this.height(x, z + eps);
    return new THREE.Vector3(hl - hr, 2 * eps, hd - hu).normalize();
  }

  /**
   * Deterministic RNG for a 64 m placement cell.
   * @param {number} cx @param {number} cz @param {number|string} [salt=0]
   * @returns {RNG}
   */
  cellRng(cx, cz, salt = 0) {
    const s = typeof salt === 'string' ? hashString(salt) : salt | 0;
    return new RNG(hash32(this.seed, cx | 0, cz | 0, s));
  }
}
