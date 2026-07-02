// Deterministic hashing + seeded RNG. Every procedural system derives from these
// so a given universe seed always reproduces the same galaxy.

/** 32-bit integer hash of any number of integer inputs (xxhash-inspired mix). */
export function hash32(...ints) {
  let h = 0x9e3779b9 >>> 0;
  for (let i = 0; i < ints.length; i++) {
    let k = ints[i] | 0;
    k = Math.imul(k, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= ints.length;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash a string to a 32-bit integer. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: returns () => float in [0,1). Fast, decent quality, seedable. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience wrapper with typed draws. Construct with any integer seed. */
export class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }
  /** float in [0,1) */
  next() { return this._next(); }
  /** float in [a,b) */
  range(a, b) { return a + (b - a) * this._next(); }
  /** integer in [a,b] inclusive */
  int(a, b) { return a + Math.floor(this._next() * (b - a + 1)); }
  /** true with probability p */
  chance(p) { return this._next() < p; }
  /** random element of array */
  pick(arr) { return arr[Math.floor(this._next() * arr.length)]; }
  /** random unit-ish gaussian via Box-Muller */
  gaussian(mean = 0, std = 1) {
    const u = Math.max(this._next(), 1e-9), v = this._next();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** fork a child RNG with an extra label, without disturbing this stream */
  fork(label) { return new RNG(hash32(this.seed, typeof label === 'string' ? hashString(label) : label | 0)); }
}
