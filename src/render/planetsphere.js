// PlanetSphere — a REAL seamless spherical planet.
//
// One round world you fly from orbit to the surface with no cut: a cube-sphere
// whose six faces are each a quadtree of chunks that split/merge by
// screen-space size, displaced along the sphere normal by multi-octave 3D
// simplex noise (continents + ridged mountains + detail), rendered
// camera-relative (floating origin) so 32-bit float precision holds at
// planetary scale. A sea-level sphere and a back-side Fresnel atmosphere shell
// complete the look.
//
// This is a self-contained prototype module. It does not touch the live game.
//
// PUBLIC API
//   const p = new PlanetSphere(scene, { seed, radius, seaLevel });
//   p.update(dt, cameraWorldPos)  // LOD split/merge + floating-origin rebase + atmosphere
//   p.heightAt(dirVec3) -> number // terrain radius (planet-local) along a unit direction
//   p.setSunDirection(vec3)       // world-space unit vector toward the sun (drives atmosphere)
//   p.setPlanetCenter(vec3)       // universe-space centre of the planet (default 0,0,0)
//   p.getStats() -> { leaves, triangles, builds }
//   p.dispose()
//
// COST NOTES
//   - The per-frame update() walks the quadtree doing only scalar distance math
//     and Vector3.distanceTo (no allocation). It is O(active nodes) ~ a few
//     hundred and cheap.
//   - Actual GPU geometry is (re)built ONLY on a split or merge event, not per
//     frame. A chunk build allocates a handful of typed arrays and does
//     ~(GRID+3)^2 height samples plus 2 extra samples/vertex for analytic
//     normals. During a fast descent a few chunks rebuild per frame; a full
//     cold build of the near field is a few ms. See buildBudget to cap it.

import * as THREE from 'three';
import { SimplexNoise } from '../core/noise.js';
import { hash32 } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Cube-sphere face basis. Each face is a plane in cube space spanned by (u, v)
// with outward normal n; u x v == +n for every face so triangle winding stays
// consistent (CCW = outward = front face). A cube point (n + u*s + v*t),
// s,t in [-1,1], normalized to unit length gives the sphere direction.
// ---------------------------------------------------------------------------
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },  // +X
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },  // -X
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },  // +Y
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },  // -Y
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },  // +Z
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }, // -Z
];

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// A small tiling detail texture (R = fine grain height, G = mid mottle) baked
// once from wrapping torus-sampled simplex noise — the source for in-shader
// micro-relief normals + albedo/roughness break-up on the terrain. Zero assets.
function makeDetailTexture(seed) {
  const S = 256;
  const n1 = new SimplexNoise(hash32(seed, 771) >>> 0);
  const n2 = new SimplexNoise(hash32(seed, 772) >>> 0);
  const img = new Uint8Array(S * S * 4);
  const TAU = Math.PI * 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = (x / S) * TAU, b = (y / S) * TAU;
      const nx = Math.cos(a) * 1.6, ny = Math.sin(a) * 1.6;
      const nz = Math.cos(b) * 1.6, nw = Math.sin(b) * 1.6;
      const fine = n1.fbm3(nx * 2.3 + nz * 1.7, ny * 2.3 + nw * 1.7, nz * 2.9, 4)
        + n1.noise3D(nx * 7.1, ny * 7.1, nz * 7.1 + nw * 3.3) * 0.35;
      const mid = n2.fbm3(nx + nz * 0.8, ny + nw * 0.8, nw * 1.2, 3);
      const i = (y * S + x) * 4;
      img[i] = Math.max(0, Math.min(255, 128 + fine * 108));
      img[i + 1] = Math.max(0, Math.min(255, 128 + mid * 118));
      img[i + 2] = 128;
      img[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(img, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Ridged multifractal in 3D (sharp mountain ridges), returns roughly [0,1].
function ridged3(noise, x, y, z, octaves, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0, prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise.noise3D(x * freq, y * freq, z * freq));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    amp *= gain; freq *= lacunarity;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Biome archetypes. Each fully parameterises PlanetSphere so one engine can be
// any No Man's Sky-style world: terrain colour stops, terrain shaping, sea,
// atmosphere shell, cloud deck, and the scene lighting (read by planetstate.js).
// Colours are hex ints; atmosphere zenith/horizon are LINEAR rgb triples.
// ---------------------------------------------------------------------------
export const BIOMES = {
  lush: {
    key: 'lush', name: 'Verdant',
    palette: { deep: 0x05213a, wet: 0x8a7a55, beach: 0xcdb98f, grassLush: 0x4f7a3a, grassArid: 0x8a8a46, soil: 0x6b5334, rock: 0x6d5f4d, cliff: 0x5a5048, snow: 0xf2f5fb },
    moistureBias: 0.15,
    terrain: { contMul: 1.0, mtnMul: 1.0, detMul: 1.0, hasSea: true, snowScale: 1.0 },
    atmosphere: { limb: 0x5aa2ff, zenith: [0.10, 0.26, 0.62], horizon: [0.52, 0.66, 0.85], sunColor: 0xfff2d8, strength: 1.35, thin: false },
    sea: { color: 0x184b7a, roughness: 0.18 },
    clouds: { coverageLo: 0.50, coverageHi: 0.74, opacity: 0.6, tint: 0xffffff },
    light: { sunColor: 0xffe6c2, sunIntensity: 3.2, hemiSky: 0x9fb4d6, hemiGround: 0x5a4a34, hemiInt: 0.22, envZenith: 0x3d6ea8, envHorizon: 0xbcd0e0, envGround: 0x6b5a44, envIntensity: 1.15, fog: 0xbcd0e0 },
    hazard: 'none',
  },
  ocean: {
    key: 'ocean', name: 'Aquatic',
    palette: { deep: 0x03253f, wet: 0x8fae7a, beach: 0xd8cc9a, grassLush: 0x3f8a5a, grassArid: 0x6a9a4a, soil: 0x5a6a3a, rock: 0x6a6a5a, cliff: 0x4a5a4a, snow: 0xf0f8ff },
    moistureBias: 0.7,
    terrain: { contMul: 0.55, mtnMul: 0.6, detMul: 0.9, hasSea: true, snowScale: 1.2 },
    atmosphere: { limb: 0x4ab8ff, zenith: [0.12, 0.34, 0.66], horizon: [0.58, 0.74, 0.88], sunColor: 0xffffe8, strength: 1.4, thin: false },
    sea: { color: 0x0a6a9a, roughness: 0.14 },
    clouds: { coverageLo: 0.42, coverageHi: 0.66, opacity: 0.72, tint: 0xffffff },
    light: { sunColor: 0xfff4e0, sunIntensity: 3.3, hemiSky: 0x8ac0e0, hemiGround: 0x3a6a5a, hemiInt: 0.26, envZenith: 0x3a80b0, envHorizon: 0xbce0ee, envGround: 0x2a5a6a, envIntensity: 1.2, fog: 0xbce0ee },
    hazard: 'none',
  },
  desert: {
    key: 'desert', name: 'Arid',
    palette: { deep: 0x2a2a20, wet: 0xa07a4a, beach: 0xd8b878, grassLush: 0xb89a5a, grassArid: 0xc8a05e, soil: 0xa8703a, rock: 0x9a5f3a, cliff: 0x7a4529, snow: 0xe8d8b8 },
    moistureBias: -0.8,
    terrain: { contMul: 0.85, mtnMul: 1.2, detMul: 1.2, hasSea: false, snowScale: 0.0 },
    atmosphere: { limb: 0xffb060, zenith: [0.35, 0.30, 0.42], horizon: [0.85, 0.68, 0.45], sunColor: 0xfff0d0, strength: 1.1, thin: false },
    sea: { color: 0x3a2a1a, roughness: 0.5 },
    clouds: { coverageLo: 0.62, coverageHi: 0.86, opacity: 0.26, tint: 0xe8d0b0 },
    light: { sunColor: 0xfff0d8, sunIntensity: 3.6, hemiSky: 0xe0c090, hemiGround: 0x6a4a2a, hemiInt: 0.28, envZenith: 0x9a7a6a, envHorizon: 0xe8c898, envGround: 0x8a6038, envIntensity: 1.2, fog: 0xe8c898 },
    hazard: 'heat',
  },
  frozen: {
    key: 'frozen', name: 'Glacial',
    palette: { deep: 0x1a3a5a, wet: 0xb8c8d8, beach: 0xd8e4ee, grassLush: 0xc8d8e0, grassArid: 0xa8b8c0, soil: 0x8a9aa8, rock: 0x8494a0, cliff: 0x6a7a88, snow: 0xffffff },
    moistureBias: -0.2,
    terrain: { contMul: 1.1, mtnMul: 1.15, detMul: 1.0, hasSea: true, snowScale: 0.15 },
    atmosphere: { limb: 0x9ec8ff, zenith: [0.18, 0.34, 0.60], horizon: [0.72, 0.82, 0.92], sunColor: 0xeef4ff, strength: 1.4, thin: false },
    sea: { color: 0x2a5a7a, roughness: 0.3 },
    clouds: { coverageLo: 0.45, coverageHi: 0.70, opacity: 0.7, tint: 0xeaf0f8 },
    light: { sunColor: 0xdfeaff, sunIntensity: 2.6, hemiSky: 0xb8cce0, hemiGround: 0x8090a0, hemiInt: 0.32, envZenith: 0x5a80b0, envHorizon: 0xcdd9e6, envGround: 0x8896a4, envIntensity: 1.25, fog: 0xcdd9e6 },
    hazard: 'cold',
  },
  toxic: {
    key: 'toxic', name: 'Blighted',
    palette: { deep: 0x1a2a12, wet: 0x5a6a2a, beach: 0x7a8a3a, grassLush: 0x6a9a2a, grassArid: 0x8a9a3a, soil: 0x4a5a22, rock: 0x5a5a3a, cliff: 0x44502a, snow: 0xc8d89a },
    moistureBias: 0.5,
    terrain: { contMul: 0.9, mtnMul: 0.8, detMul: 1.1, hasSea: true, snowScale: 0.6 },
    atmosphere: { limb: 0x9aff6a, zenith: [0.16, 0.30, 0.14], horizon: [0.55, 0.68, 0.30], sunColor: 0xd8ffb0, strength: 1.5, thin: false },
    sea: { color: 0x3a5a2a, roughness: 0.22 },
    clouds: { coverageLo: 0.38, coverageHi: 0.62, opacity: 0.75, tint: 0xb0c878 },
    light: { sunColor: 0xd8ffb0, sunIntensity: 2.8, hemiSky: 0x8aa85a, hemiGround: 0x4a5a2a, hemiInt: 0.35, envZenith: 0x6a8a3a, envHorizon: 0x9ab060, envGround: 0x4a5a2a, envIntensity: 1.2, fog: 0x9ab060 },
    hazard: 'toxic',
  },
  scorched: {
    key: 'scorched', name: 'Scorched',
    palette: { deep: 0x1a0a06, wet: 0x3a1a10, beach: 0x4a2418, grassLush: 0x3a2018, grassArid: 0x2a1810, soil: 0x5a2818, rock: 0x3a2420, cliff: 0x2a1a16, snow: 0xff6a2a },
    moistureBias: -0.9,
    terrain: { contMul: 0.9, mtnMul: 1.4, detMul: 1.3, hasSea: false, snowScale: 0.0 },
    atmosphere: { limb: 0xff5a2a, zenith: [0.30, 0.10, 0.06], horizon: [0.75, 0.28, 0.12], sunColor: 0xffd0a0, strength: 1.5, thin: false },
    sea: { color: 0x2a0a06, roughness: 0.5 },
    clouds: { coverageLo: 0.55, coverageHi: 0.80, opacity: 0.5, tint: 0x6a4a3a },
    light: { sunColor: 0xffb890, sunIntensity: 2.8, hemiSky: 0xaa5a3a, hemiGround: 0x3a1a12, hemiInt: 0.4, envZenith: 0x6a2a1a, envHorizon: 0xc85a2a, envGround: 0x3a1a10, envIntensity: 1.1, fog: 0x8a3a20 },
    hazard: 'heat',
  },
  barren: {
    key: 'barren', name: 'Barren',
    palette: { deep: 0x2a2a2e, wet: 0x6a6a70, beach: 0x7a7a80, grassLush: 0x8a8a90, grassArid: 0x9a9aa0, soil: 0x6a6a72, rock: 0x8a8a92, cliff: 0x5a5a62, snow: 0xd8d8e0 },
    moistureBias: -0.5,
    terrain: { contMul: 0.7, mtnMul: 1.0, detMul: 1.4, hasSea: false, snowScale: 0.4 },
    atmosphere: { limb: 0x6a7a9a, zenith: [0.02, 0.03, 0.05], horizon: [0.10, 0.12, 0.16], sunColor: 0xffffff, strength: 0.35, thin: true },
    sea: { color: 0x1a1a1e, roughness: 0.6 },
    clouds: { coverageLo: 0.9, coverageHi: 1.0, opacity: 0.0, tint: 0xffffff },
    light: { sunColor: 0xffffff, sunIntensity: 3.4, hemiSky: 0x2a3040, hemiGround: 0x1a1a1e, hemiInt: 0.12, envZenith: 0x1a2030, envHorizon: 0x3a4050, envGround: 0x2a2a2e, envIntensity: 0.7, fog: 0x0a0c10 },
    hazard: 'radiation',
  },
  exotic: {
    key: 'exotic', name: 'Anomalous',
    palette: { deep: 0x2a0a3a, wet: 0x8a4a9a, beach: 0xba7ac8, grassLush: 0x9a3aca, grassArid: 0x3acaba, soil: 0x6a2a7a, rock: 0x4a3a6a, cliff: 0x3a2a5a, snow: 0xf0d8ff },
    moistureBias: 0.0,
    terrain: { contMul: 1.0, mtnMul: 1.2, detMul: 1.1, hasSea: true, snowScale: 0.7 },
    atmosphere: { limb: 0xd85aff, zenith: [0.22, 0.10, 0.34], horizon: [0.72, 0.45, 0.82], sunColor: 0xffd8ff, strength: 1.5, thin: false },
    sea: { color: 0x5a2a8a, roughness: 0.16 },
    clouds: { coverageLo: 0.48, coverageHi: 0.72, opacity: 0.55, tint: 0xe0b0f0 },
    light: { sunColor: 0xf0c8ff, sunIntensity: 3.0, hemiSky: 0xba7aca, hemiGround: 0x4a2a6a, hemiInt: 0.3, envZenith: 0x6a3a8a, envHorizon: 0xc890e0, envGround: 0x4a2a6a, envIntensity: 1.2, fog: 0xc890e0 },
    hazard: 'exotic',
  },
};

// Deterministic seed -> biome. Weighted so common worlds dominate and exotic is
// rare, mirroring NMS's distribution. Returns a biome descriptor object.
const BIOME_WEIGHTS = [
  ['lush', 20], ['desert', 16], ['frozen', 16], ['barren', 14],
  ['toxic', 12], ['scorched', 11], ['ocean', 8], ['exotic', 3],
];
export function pickBiome(seed) {
  let total = 0;
  for (const [, w] of BIOME_WEIGHTS) total += w;
  let r = (hash32(seed, 0xb10e) >>> 0) % total;
  for (const [k, w] of BIOME_WEIGHTS) { if (r < w) return BIOMES[k]; r -= w; }
  return BIOMES.lush;
}

// ---------------------------------------------------------------------------
// Chunk: one quadtree node on a cube face. Owns either a mesh (leaf) or four
// children. Distance-to-camera drives split/merge.
// ---------------------------------------------------------------------------
class Chunk {
  constructor(planet, faceIdx, cu, cv, half, depth) {
    this.planet = planet;
    this.faceIdx = faceIdx;
    this.cu = cu;          // node centre in face-uv space [-1,1]
    this.cv = cv;
    this.half = half;      // half extent in face-uv space
    this.depth = depth;
    this.mesh = null;
    this.children = null;

    // Precompute the node's sphere-surface centre (planet-local) and an
    // approximate world-space edge size, used for the LOD screen-space test.
    const f = FACES[faceIdx];
    this.centerLocal = new THREE.Vector3();
    this._dir(cu, cv, this.centerLocal);
    const cr = planet._surfaceRadius(this.centerLocal.x, this.centerLocal.y, this.centerLocal.z);
    this.centerLocal.multiplyScalar(cr);

    // Edge chord length ~ angular width * radius; use the max of the two axes.
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this._dir(cu - half, cv, a); this._dir(cu + half, cv, b);
    const eu = a.distanceTo(b) * planet.radius;
    this._dir(cu, cv - half, a); this._dir(cu, cv + half, b);
    const ev = a.distanceTo(b) * planet.radius;
    this.worldSize = Math.max(eu, ev);
  }

  // face-uv (s,t) -> unit sphere direction, into `out`.
  _dir(s, t, out) {
    const f = FACES[this.faceIdx];
    const x = f.n[0] + f.u[0] * s + f.v[0] * t;
    const y = f.n[1] + f.u[1] * s + f.v[1] * t;
    const z = f.n[2] + f.u[2] * s + f.v[2] * t;
    return out.set(x, y, z).normalize();
  }

  // Screen-space-error style metric: chunk angular size = worldSize / distance.
  // Nearest-point distance keeps chunks under the camera splitting hardest.
  _ratio(camLocal) {
    const d = camLocal.distanceTo(this.centerLocal) - this.worldSize * 0.5;
    return this.worldSize / Math.max(d, 1.0);
  }

  update(camLocal) {
    const p = this.planet;
    const ratio = this._ratio(camLocal);
    if (this.children) {
      // merge when comfortably below the split threshold (hysteresis avoids
      // flip-flop popping across the boundary)
      if (ratio < p.splitRatio * 0.5 || this.depth >= p.maxDepth) {
        this._merge();
        this._ensureMesh();
      } else {
        for (let i = 0; i < 4; i++) this.children[i].update(camLocal);
      }
      return;
    }
    if (this.depth < p.maxDepth && ratio > p.splitRatio) {
      this._split();
      for (let i = 0; i < 4; i++) this.children[i].update(camLocal);
    } else {
      this._ensureMesh();
    }
  }

  _split() {
    if (this.children) return;
    this._disposeMesh();
    const h = this.half * 0.5, d = this.depth + 1;
    this.children = [
      new Chunk(this.planet, this.faceIdx, this.cu - h, this.cv - h, h, d),
      new Chunk(this.planet, this.faceIdx, this.cu + h, this.cv - h, h, d),
      new Chunk(this.planet, this.faceIdx, this.cu - h, this.cv + h, h, d),
      new Chunk(this.planet, this.faceIdx, this.cu + h, this.cv + h, h, d),
    ];
  }

  _merge() {
    if (!this.children) return;
    for (let i = 0; i < 4; i++) this.children[i]._destroy();
    this.children = null;
  }

  _destroy() {
    this._merge();
    this._disposeMesh();
  }

  _ensureMesh() {
    if (this.mesh || this.children) return;
    this.mesh = this.planet._buildChunkMesh(this);
    this.planet.root.add(this.mesh);
    this.planet._builds++;
  }

  _disposeMesh() {
    if (!this.mesh) return;
    this.planet.root.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
}

// ---------------------------------------------------------------------------
export class PlanetSphere {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts
   * @param {number} [opts.seed=1337]
   * @param {number} [opts.radius=4000]  planet base radius (world units)
   * @param {number} [opts.seaLevel=radius]  absolute sea radius
   * @param {number} [opts.maxDepth=8]   quadtree depth cap (near-surface detail)
   * @param {number} [opts.grid=16]      quads per chunk edge
   * @param {number} [opts.splitRatio=0.16]  split when worldSize/dist exceeds this
   */
  constructor(scene, opts = {}) {
    const seed = (opts.seed ?? 1337) >>> 0;
    this.scene = scene;
    this.radius = opts.radius ?? 4000;
    this.maxDepth = opts.maxDepth ?? 7;
    this.grid = opts.grid ?? 16;
    this.splitRatio = opts.splitRatio ?? 0.28;

    // Biome: a descriptor object (opts.biome), a key string (opts.biome='desert'),
    // or deterministically picked from the seed. Drives palette, terrain shaping,
    // sea, atmosphere, clouds — and the scene lighting read by planetstate.js.
    this.biome = (opts.biome && typeof opts.biome === 'object') ? opts.biome
      : (typeof opts.biome === 'string' && BIOMES[opts.biome]) ? BIOMES[opts.biome]
        : pickBiome(seed);
    const bt = this.biome.terrain;
    this.hasSea = bt.hasSea;
    // No-sea worlds park the sea radius below the terrain floor so nothing ever
    // reads as "underwater" and the sea sphere is skipped entirely.
    this.seaLevel = opts.seaLevel ?? (this.hasSea ? this.radius : this.radius * 0.95);
    this.snowScale = bt.snowScale;

    // Elevation amplitudes as a fraction of radius (biome-shaped, exaggerated).
    this.contAmp = this.radius * 0.018 * bt.contMul;  // rolling continents
    this.mtnAmp = this.radius * 0.045 * bt.mtnMul;    // ridged mountain ranges
    this.detAmp = this.radius * 0.005 * bt.detMul;    // fine surface detail
    // Near-surface relief: two higher-frequency, low-amplitude octaves so the
    // ground reads as rolling undulation up close (metres-to-tens-of-metres),
    // not a flat ball. Kept gentle so slopes stay walkable and — because both
    // the mesh build AND heightAt() flow through _elevation — collision stays
    // consistent. These only resolve visually once chunks reach deep LOD.
    this.fine1Amp = this.radius * 0.00052;  // ~2.1 m over ~72 m wavelength
    this.fine2Amp = this.radius * 0.00026;  // ~1.0 m over ~33 m wavelength
    this._floor = this.radius * 0.965;   // ocean-basin floor clamp

    // Skirt depth as a fraction of a chunk's world size — hangs a vertical
    // flange off each chunk edge to hide LOD T-junction cracks.
    this.skirtFactor = 0.5;

    // Deterministic noise fields for the three terrain layers.
    this.contNoise = new SimplexNoise(seed);
    this.mtnNoise = new SimplexNoise(hash32(seed, 0x4d) >>> 0);
    this.detNoise = new SimplexNoise(hash32(seed, 0x9a) >>> 0);
    // large-scale moisture field: drives lush-vs-arid grass and soil patches so
    // the biome reads as varied terrain rather than one flat green.
    this.bioNoise = new SimplexNoise(hash32(seed, 0x7c) >>> 0);

    // Precompute the biome palette as THREE.Color once (no per-vertex setHex).
    const P = this.biome.palette;
    this._pal = {
      shallow: new THREE.Color(this.biome.sea.color),
      deep: new THREE.Color(P.deep), wet: new THREE.Color(P.wet), beach: new THREE.Color(P.beach),
      grassLush: new THREE.Color(P.grassLush), grassArid: new THREE.Color(P.grassArid),
      soil: new THREE.Color(P.soil), rock: new THREE.Color(P.rock),
      cliff: new THREE.Color(P.cliff), snow: new THREE.Color(P.snow),
    };
    this._moistBias = this.biome.moistureBias ?? 0;

    this.planetCenter = new THREE.Vector3(0, 0, 0);
    this._camLocal = new THREE.Vector3();
    this._builds = 0;

    // Root group holds terrain chunks + sea + atmosphere. update() sets its
    // position to (planetCenter - cameraWorldPos): camera-relative rendering.
    this.root = new THREE.Group();
    this.root.name = 'planetSphere';
    scene.add(this.root);

    // Shared terrain material — vertex-coloured, matte, receives the scene's
    // directional (sun) light. Works on SwiftShader; log-depth is injected by
    // three automatically when the renderer enables logarithmicDepthBuffer.
    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, metalness: 0.0,
    });

    // Procedural micro-relief: sample a baked detail texture in OBJECT space
    // (the chunk vertices are absolute planet-local ~radius-magnitude and STABLE
    // — world space rebases every frame and would make the grain crawl) via a
    // dominant-axis (cube) projection, and inject albedo/roughness break-up plus
    // a tangent-frame bump normal. All distance-faded so far/orbit chunks pay
    // nothing. Chunk meshes are translation-only (root holds the rebase), so
    // object direction == world direction and mat3(viewMatrix) rotates the bump
    // to view space. SwiftShader-safe: branch-light ALU, no loops.
    this._detailTex = makeDetailTexture(hash32(seed, 0xd7) >>> 0);
    this.terrainMat.onBeforeCompile = (sh) => {
      sh.uniforms.uDetail = { value: this._detailTex };
      sh.uniforms.uBumpAmt = { value: 0.9 };
      sh.uniforms.uSeaLevel = { value: this.seaLevel };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying vec3 vAmsObj;\nvarying vec3 vAmsObjN;\nvarying vec3 vAmsView;')
        .replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          'vAmsObj = transformed;',
          'vAmsObjN = normalize(normal);',
          'vAmsView = (modelViewMatrix * vec4(transformed, 1.0)).xyz;',
        ].join('\n'));
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', [
          '#include <common>',
          'uniform sampler2D uDetail;',
          'uniform float uBumpAmt;',
          'uniform float uSeaLevel;',
          'varying vec3 vAmsObj;',
          'varying vec3 vAmsObjN;',
          'varying vec3 vAmsView;',
          // dominant-axis (cube) projection of an object point -> 2D tile coord.
          'vec2 amsUV(vec3 p, vec3 an){ if (an.x>=an.y&&an.x>=an.z) return p.yz; else if (an.y>=an.z) return p.xz; return p.xy; }',
          'float amsDetailH(vec2 w){ return texture2D(uDetail, w*0.19).r*0.72 + texture2D(uDetail, w*0.031).g*0.28; }',
        ].join('\n'))
        .replace('#include <color_fragment>', [
          '#include <color_fragment>',
          'vec3 amsAbs = abs(normalize(vAmsObjN));',
          'vec2 amsW = amsUV(vAmsObj, amsAbs);',
          'float amsDist = length(vAmsView);',
          'float amsFade = 1.0 - smoothstep(120.0, 520.0, amsDist);',
          'float amsGrain = texture2D(uDetail, amsW*0.19).r;',
          'float amsMott = texture2D(uDetail, amsW*0.031).g;',
          'diffuseColor.rgb *= 1.0 + (amsGrain-0.5)*0.30*amsFade + (amsMott-0.5)*0.20;',
        ].join('\n'))
        .replace('#include <roughnessmap_fragment>', [
          '#include <roughnessmap_fragment>',
          'roughnessFactor *= 0.86 + 0.26 * texture2D(uDetail, amsUV(vAmsObj, abs(normalize(vAmsObjN)))*0.031).g;',
          // wet-sand sheen: the first few metres above the waterline go glossy so
          // the sun glints on the shoreline (HDR spec feeds the bloom gently).
          'float amsWet = smoothstep(6.0, 0.0, length(vAmsObj) - uSeaLevel);',
          'roughnessFactor *= mix(1.0, 0.45, amsWet);',
        ].join('\n'))
        .replace('#include <normal_fragment_begin>', [
          '#include <normal_fragment_begin>',
          '{',
          '  vec3 amsN = normalize(vAmsObjN);',
          '  float amsD = length(vAmsView);',
          '  float amsMF = 1.0 - smoothstep(60.0, 340.0, amsD);',
          '  if (amsMF > 0.001) {',
          '    vec3 amsA = abs(amsN);',
          '    vec3 amsT = normalize(cross(amsN, amsA.y < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));',
          '    vec3 amsBt = cross(amsN, amsT);',
          '    float e = 0.6;',
          '    float hL = amsDetailH(amsUV(vAmsObj - amsT*e, amsA));',
          '    float hR = amsDetailH(amsUV(vAmsObj + amsT*e, amsA));',
          '    float hDn = amsDetailH(amsUV(vAmsObj - amsBt*e, amsA));',
          '    float hUp = amsDetailH(amsUV(vAmsObj + amsBt*e, amsA));',
          '    vec3 amsBump = normalize(amsN - (amsT*(hR-hL) + amsBt*(hUp-hDn)) * uBumpAmt * amsMF);',
          '    normal = normalize(mat3(viewMatrix) * amsBump);',
          '  }',
          '}',
        ].join('\n'));
    };
    this.terrainMat.customProgramCacheKey = () => 'ams-psphere-detail-v1';

    this._buildFaces();
    this._buildSea();
    this._buildAtmosphere();
    this._buildSkyDome();
    this._buildClouds();
  }

  _buildFaces() {
    this.faces = [];
    for (let f = 0; f < 6; f++) {
      this.faces.push(new Chunk(this, f, 0, 0, 1, 0));
    }
  }

  // --- terrain field -------------------------------------------------------

  // Elevation offset (may be negative) at a unit direction (components).
  _elevation(nx, ny, nz) {
    const cont = this.contNoise.fbm3(nx * 1.5 + 11.3, ny * 1.5 + 3.1, nz * 1.5 + 7.7, 5);
    const land = smoothstep(-0.06, 0.20, cont);
    const ridge = ridged3(this.mtnNoise, nx * 2.7 + 1.2, ny * 2.7 + 4.5, nz * 2.7 + 9.9, 5);
    const mont = ridge * land * (0.35 + 0.65 * smoothstep(0.0, 0.45, cont));
    const det = this.detNoise.fbm3(nx * 9.0 + 2.0, ny * 9.0 + 5.0, nz * 9.0 + 1.0, 3);
    // fine near-surface undulation (single high-frequency octaves; reuse the
    // detail field at different offsets/frequencies — no extra noise object).
    const f1 = this.detNoise.noise3D(nx * 55.0 + 21.3, ny * 55.0 + 8.7, nz * 55.0 + 33.1);
    const f2 = this.detNoise.noise3D(nx * 120.0 + 4.2, ny * 120.0 + 51.5, nz * 120.0 + 17.9);
    const fine = (f1 * this.fine1Amp + f2 * this.fine2Amp) * land;
    return cont * this.contAmp + mont * this.mtnAmp + det * this.detAmp * land + fine;
  }

  // Terrain radius (planet-local) along a unit direction, floor-clamped.
  _surfaceRadius(nx, ny, nz) {
    const r = this.radius + this._elevation(nx, ny, nz);
    return r < this._floor ? this._floor : r;
  }

  /** Terrain radius along a unit direction — for walking/collision later. */
  heightAt(dir) {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    return this._surfaceRadius(dir.x / l, dir.y / l, dir.z / l);
  }

  // Biome colour by altitude-above-sea, latitude, macro-moisture and SLOPE,
  // written into (out*) as LINEAR rgb (THREE.Color.setHex converts from sRGB).
  // Slope (0 flat .. 1 vertical) lets cliffs show bare rock — the NMS read.
  _biomeColor(r, nx, ny, nz, slope, col) {
    const pal = this._pal;
    const alt = r - this.seaLevel;
    const lat = Math.abs(ny);            // pole axis = y
    if (alt < 0) {
      // underwater floor: biome shallow tint -> deep (still visible at shore).
      const t = smoothstep(0, -140, alt);
      col.copy(pal.shallow).lerp(SCRATCH_COL.copy(pal.deep), t);
      return col;
    }
    // macro moisture (large patches): lush where wet, arid where dry, plus the
    // biome's own bias (deserts skew arid, marshes/oceans skew lush).
    const moist = 0.5 + 0.5 * this.bioNoise.fbm3(nx * 1.9 + 5.1, ny * 1.9 + 2.3, nz * 1.9 + 8.8, 4);
    const dry = Math.max(0, Math.min(1, (1 - moist) - this._moistBias));
    // snowScale 0 pushes the snow line to infinity (deserts/scorched never cap).
    const snowStart = this.snowScale <= 0 ? 1e9 : 150 * this.snowScale * (1 - lat * 0.7);
    // shoreline: wet -> dry beach across the first few metres.
    col.copy(pal.wet).lerp(SCRATCH_COL.copy(pal.beach), smoothstep(0, 4, alt));
    // beach -> ground (moisture picks lush vs. arid).
    const grass = SCRATCH_COL3.copy(pal.grassLush).lerp(SCRATCH_COL.copy(pal.grassArid), dry);
    col.lerp(grass, smoothstep(3, 22, alt));
    // drier mid-altitude ground shows exposed soil.
    col.lerp(SCRATCH_COL.copy(pal.soil), smoothstep(40, 80, alt) * (0.3 + 0.5 * dry));
    // -> altitude rock as it climbs toward the peaks.
    col.lerp(SCRATCH_COL.copy(pal.rock), smoothstep(70, snowStart * 0.85, alt));
    // steep faces below the snow line read as bare cliff rock.
    const belowSnow = 1 - smoothstep(snowStart, snowStart + 30, alt);
    col.lerp(SCRATCH_COL.copy(pal.cliff), smoothstep(0.34, 0.62, slope) * belowSnow);
    // rock -> snow/cap above the snow line.
    col.lerp(SCRATCH_COL.copy(pal.snow), smoothstep(snowStart, snowStart + 55, alt));
    // extra polar whitening — only for worlds that actually cap (snowScale>0).
    if (this.snowScale > 0) {
      col.lerp(SCRATCH_COL.copy(pal.snow), smoothstep(0.80, 0.96, lat) * 0.85);
    }
    return col;
  }

  // --- chunk geometry ------------------------------------------------------

  // Build a leaf chunk mesh. Geometry is a (grid+3)^2 vertex grid: the inner
  // (grid+1)^2 is the surface, the surrounding ring is a downward skirt whose
  // horizontal position is clamped to the edge (a vertical flange). Analytic
  // normals come from finite differences on the true (un-skirted) surface so
  // that shared edges between neighbours match and lighting has no seam.
  _buildChunkMesh(chunk) {
    const N = this.grid;
    const W = N + 3;                       // points per side incl. skirt ring
    const nVerts = W * W;
    const pos = new Float32Array(nVerts * 3);
    const nrm = new Float32Array(nVerts * 3);
    const colArr = new Float32Array(nVerts * 3);
    const surf = new Float32Array(nVerts * 3);   // true surface pos (for normals)
    const dirs = new Float32Array(nVerts * 3);   // unit sphere dir (for outward test)
    const rCs = new Float32Array(nVerts);        // floor-clamped radius per vertex

    const f = FACES[chunk.faceIdx];
    const cu = chunk.cu, cv = chunk.cv, half = chunk.half;
    const s0 = cu - half, t0 = cv - half, span = 2 * half;
    const skirt = chunk.worldSize * this.skirtFactor;
    const col = SCRATCH_COL2;

    for (let gy = 0; gy < W; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const k = gy * W + gx;
        const i = gx - 1, j = gy - 1;             // -1 .. N+1
        const ci = i < 0 ? 0 : i > N ? N : i;     // clamp to surface grid
        const cj = j < 0 ? 0 : j > N ? N : j;
        const isSkirt = (i !== ci) || (j !== cj);

        // surf[] (used for normals) samples the EXTENDED position — one cell
        // beyond the node on the skirt ring — so central differences at a chunk
        // border use the true neighbouring surface. Equal-LOD neighbours then
        // compute identical edge normals: no lighting seam.
        const se = s0 + (i / N) * span, te = t0 + (j / N) * span;
        let ex = f.n[0] + f.u[0] * se + f.v[0] * te;
        let ey = f.n[1] + f.u[1] * se + f.v[1] * te;
        let ez = f.n[2] + f.u[2] * se + f.v[2] * te;
        const ei = 1 / Math.hypot(ex, ey, ez);
        ex *= ei; ey *= ei; ez *= ei;
        const rE = this._surfaceRadius(ex, ey, ez);
        surf[k * 3] = ex * rE; surf[k * 3 + 1] = ey * rE; surf[k * 3 + 2] = ez * rE;

        // Geometry uses the CLAMPED position: interior == surface; the skirt
        // ring keeps the border's horizontal but drops radially by `skirt`,
        // forming a vertical flange that hides LOD cracks.
        let dx, dy, dz, rC;
        if (isSkirt) {
          const sc = s0 + (ci / N) * span, tc = t0 + (cj / N) * span;
          dx = f.n[0] + f.u[0] * sc + f.v[0] * tc;
          dy = f.n[1] + f.u[1] * sc + f.v[1] * tc;
          dz = f.n[2] + f.u[2] * sc + f.v[2] * tc;
          const ic = 1 / Math.hypot(dx, dy, dz);
          dx *= ic; dy *= ic; dz *= ic;
          rC = this._surfaceRadius(dx, dy, dz);
          const r = rC - skirt;
          pos[k * 3] = dx * r; pos[k * 3 + 1] = dy * r; pos[k * 3 + 2] = dz * r;
        } else {
          dx = ex; dy = ey; dz = ez; rC = rE;
          pos[k * 3] = surf[k * 3]; pos[k * 3 + 1] = surf[k * 3 + 1]; pos[k * 3 + 2] = surf[k * 3 + 2];
        }
        dirs[k * 3] = dx; dirs[k * 3 + 1] = dy; dirs[k * 3 + 2] = dz;
        rCs[k] = rC;      // stash; biome colour runs after normals (needs slope)
      }
    }

    // Analytic normals from central differences on the surface grid.
    for (let gy = 0; gy < W; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const k = gy * W + gx;
        const kxm = (gy * W + (gx > 0 ? gx - 1 : gx)) * 3;
        const kxp = (gy * W + (gx < W - 1 ? gx + 1 : gx)) * 3;
        const kym = ((gy > 0 ? gy - 1 : gy) * W + gx) * 3;
        const kyp = ((gy < W - 1 ? gy + 1 : gy) * W + gx) * 3;
        const ux = surf[kxp] - surf[kxm], uy = surf[kxp + 1] - surf[kxm + 1], uz = surf[kxp + 2] - surf[kxm + 2];
        const vx = surf[kyp] - surf[kym], vy = surf[kyp + 1] - surf[kym + 1], vz = surf[kyp + 2] - surf[kym + 2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        // ensure outward (align with sphere direction)
        if (nx * dirs[k * 3] + ny * dirs[k * 3 + 1] + nz * dirs[k * 3 + 2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
        nrm[k * 3] = nx; nrm[k * 3 + 1] = ny; nrm[k * 3 + 2] = nz;
      }
    }

    // Third pass: biome colour. Runs AFTER normals because it needs slope =
    // 1 - dot(surfaceNormal, radialDir) so cliffs can read as bare rock.
    for (let k = 0; k < nVerts; k++) {
      const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
      let dot = nrm[k * 3] * dx + nrm[k * 3 + 1] * dy + nrm[k * 3 + 2] * dz;
      dot = dot < 0 ? 0 : dot > 1 ? 1 : dot;
      this._biomeColor(rCs[k], dx, dy, dz, 1 - dot, col);
      colArr[k * 3] = col.r; colArr[k * 3 + 1] = col.g; colArr[k * 3 + 2] = col.b;
    }

    // Indices — CCW-outward winding (front faces).
    const quads = (W - 1) * (W - 1);
    const idx = new (nVerts > 65535 ? Uint32Array : Uint16Array)(quads * 6);
    let o = 0;
    for (let gy = 0; gy < W - 1; gy++) {
      for (let gx = 0; gx < W - 1; gx++) {
        const a = gy * W + gx;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        idx[o++] = a; idx[o++] = b; idx[o++] = c;
        idx[o++] = b; idx[o++] = d; idx[o++] = c;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;   // chunk sits at root origin; verts are absolute
    mesh.updateMatrix();
    return mesh;
  }

  // --- sea + atmosphere ----------------------------------------------------

  _buildSea() {
    if (!this.hasSea) { this.seaMesh = null; this.seaMat = null; return; }
    this.seaMat = new THREE.MeshStandardMaterial({
      color: this.biome.sea.color, roughness: this.biome.sea.roughness, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    this.seaMesh = new THREE.Mesh(new THREE.SphereGeometry(this.seaLevel, 128, 96), this.seaMat);
    this.seaMesh.name = 'sea';
    this.seaMesh.renderOrder = 1;
    this.root.add(this.seaMesh);
  }

  _buildAtmosphere() {
    const shellR = this.radius * 1.035;
    const ratio = this.radius / shellR;
    const muMax = Math.sqrt(Math.max(1 - ratio * ratio, 1e-4));
    const A = this.biome.atmosphere;
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(A.limb) },         // limb tint
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uSunColor: { value: new THREE.Color(A.sunColor) },
        uZenith: { value: new THREE.Color(A.zenith[0], A.zenith[1], A.zenith[2]) },
        uHorizon: { value: new THREE.Color(A.horizon[0], A.horizon[1], A.horizon[2]) },  // matches the fog palette
        uMuMax: { value: muMax },
        uStrength: { value: A.strength },
        uUp: { value: new THREE.Vector3(0, 1, 0) },         // radial up at the player
        uGroundAmt: { value: 0 },                            // 1 at surface -> 0 in orbit
      },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform float uMuMax;
        uniform float uStrength;
        uniform vec3 uUp;
        uniform float uGroundAmt;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 V = normalize(cameraPosition - vWorldPos);   // fragment -> camera
          vec3 N = normalize(vNormalW);

          // ---- orbital limb (UNCHANGED grazing-airmass glow, proven look) ----
          float mu = clamp(-dot(V, N) / uMuMax, 0.0, 1.0);
          float glow = pow(mu, 1.8) * 0.75 + pow(mu, 7.0) * 0.55 + mu * 0.07;
          vec3 rim = N - V * dot(N, V);
          float sunSide = dot(normalize(rim + 1e-4), uSunDir);
          float day = pow(clamp(sunSide * 0.62 + 0.45, 0.0, 1.0), 1.6);
          day = max(day, 0.03);
          float glare = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 6.0) * 0.6 * mu;
          vec3 limb = uColor * (glow * day * uStrength) + uColor * glare;

          // ---- ground sky dome (only when inside the atmosphere) ----
          // viewDir = camera -> fragment = the sky direction the player looks along.
          vec3 viewDir = -V;
          float elev = clamp(dot(viewDir, uUp), -1.0, 1.0);
          float sunUp = dot(uSunDir, uUp);
          float sd = max(dot(viewDir, uSunDir), 0.0);
          float dayMaster = smoothstep(-0.28, 0.10, sunUp);   // night side stays dark
          // Rayleigh-ish vertical gradient horizon -> zenith.
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(elev, 0.0, 1.0), 0.55));
          // warm sunset band low on the horizon when the sun is low.
          float horizonBand = pow(1.0 - abs(elev), 3.0);
          sky = mix(sky, vec3(1.0, 0.52, 0.26), horizonBand * smoothstep(0.30, -0.12, sunUp) * 0.6);
          // Mie forward halo + a crisp sun disc (emissive > 1 blooms for free).
          float halo = pow(sd, 8.0) * 0.5 + pow(sd, 90.0) * 2.2;
          float disc = smoothstep(0.9992, 0.9997, sd) * 8.0;
          vec3 ground = (sky + uSunColor * (halo + disc)) * dayMaster;

          // The thin shell now renders ONLY the orbital limb; the full ground
          // sky lives on the camera-centred sky dome (a thin shell cannot cover
          // the zenith from the surface). The ground term is kept as a faint
          // horizon wash near the surface so the terrain-to-sky seam stays warm.
          // The limb glow is an ORBIT phenomenon — fade it out near the surface
          // so its grazing silhouette line does not cross the foreground terrain.
          vec3 c = limb * (1.0 - uGroundAmt * 0.9) + ground * uGroundAmt * 0.12;
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(shellR, 64, 48), this.atmoMat);
    this.atmoMesh.name = 'atmosphere';
    this.atmoMesh.renderOrder = 4;
    this.root.add(this.atmoMesh);
  }

  // Full ground sky: a big camera-centred inward sphere (the camera is pinned at
  // the world origin, so a sphere at origin surrounds it and covers the whole
  // dome — unlike the thin atmosphere shell). Opaque background drawn first;
  // colour * uGroundAmt so it fades to black (space) as you climb to orbit, at
  // which point the stars (faded in by planetstate) take over.
  _buildSkyDome() {
    const A = this.biome.atmosphere;
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uSunColor: { value: new THREE.Color(A.sunColor) },
        uZenith: { value: new THREE.Color(A.zenith[0], A.zenith[1], A.zenith[2]) },
        uHorizon: { value: new THREE.Color(A.horizon[0], A.horizon[1], A.horizon[2]) },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uGroundAmt: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uZenith; uniform vec3 uHorizon;
        uniform vec3 uUp; uniform float uGroundAmt;
        varying vec3 vDir;
        void main() {
          vec3 viewDir = normalize(vDir);
          float elev = clamp(dot(viewDir, uUp), -1.0, 1.0);
          float sunUp = dot(uSunDir, uUp);
          float sd = max(dot(viewDir, uSunDir), 0.0);
          float dayMaster = smoothstep(-0.28, 0.10, sunUp);
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(elev, 0.0, 1.0), 0.55));
          float horizonBand = pow(1.0 - abs(elev), 3.0);
          sky = mix(sky, vec3(1.0, 0.52, 0.26), horizonBand * smoothstep(0.30, -0.12, sunUp) * 0.6);
          float halo = pow(sd, 8.0) * 0.5 + pow(sd, 90.0) * 2.2;
          float disc = smoothstep(0.9992, 0.9997, sd) * 8.0;
          vec3 ground = (sky + uSunColor * (halo + disc)) * dayMaster;
          gl_FragColor = vec4(ground * uGroundAmt, 1.0);
        }`,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(6e4, 32, 16), this.skyMat);
    this.skyMesh.name = 'skyDome';
    this.skyMesh.renderOrder = -1000;   // drawn first, as the background
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);        // at origin = camera; does NOT rebase
  }

  // A thin drifting cloud deck: coverage baked once from seamless 3D noise
  // (sampled per-texel through the sphere direction, so no equirect seam), lit
  // by the sun, with soft-thresholded gaps so continents show through. Sits
  // above most terrain; the tallest peaks poke through. Zero assets.
  _buildClouds() {
    const CL = this.biome.clouds;
    if (!CL || CL.opacity <= 0) { this.cloudMesh = null; this.cloudMat = null; this._cloudTex = null; return; }
    const W = 256, H = 128;
    const img = new Uint8Array(W * H * 4);
    const n = this.contNoise;
    for (let y = 0; y < H; y++) {
      const lat = (y / (H - 1) - 0.5) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < W; x++) {
        const lon = (x / W) * Math.PI * 2;
        const dx = cl * Math.cos(lon), dy = sl, dz = cl * Math.sin(lon);
        const c = 0.5 + 0.5 * n.fbm3(dx * 2.4 + 13.1, dy * 2.4 + 7.7, dz * 2.4 + 21.3, 5);
        const i = (y * W + x) * 4;
        img[i] = 255; img[i + 1] = 255; img[i + 2] = 255;
        img[i + 3] = Math.max(0, Math.min(255, c * 255));
      }
    }
    const tex = new THREE.DataTexture(img, W, H, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this._cloudTex = tex;

    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: tex },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uOpacity: { value: CL.opacity },
        uCovLo: { value: CL.coverageLo },
        uCovHi: { value: CL.coverageHi },
        uTint: { value: new THREE.Color(CL.tint) },
      },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vN; varying vec2 vUv;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uTex; uniform vec3 uSunDir; uniform float uOpacity;
        uniform float uCovLo; uniform float uCovHi; uniform vec3 uTint;
        varying vec3 vN; varying vec2 vUv;
        void main() {
          #include <logdepthbuf_fragment>
          float cov = texture2D(uTex, vUv).a;
          float cloud = smoothstep(uCovLo, uCovHi, cov);
          if (cloud < 0.01) discard;
          float lit = clamp(dot(normalize(vN), uSunDir) * 0.6 + 0.55, 0.24, 1.12);
          gl_FragColor = vec4(uTint * lit, cloud * uOpacity);
        }`,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    this.cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(this.radius * 1.05, 96, 48), this.cloudMat);
    this.cloudMesh.name = 'clouds';
    this.cloudMesh.renderOrder = 3;
    this.root.add(this.cloudMesh);
  }

  /** World-space unit vector pointing toward the sun (lights the atmo limb + clouds + sky). */
  setSunDirection(v) {
    this.atmoMat.uniforms.uSunDir.value.copy(v).normalize();
    this.skyMat.uniforms.uSunDir.value.copy(v).normalize();
    if (this.cloudMat) this.cloudMat.uniforms.uSunDir.value.copy(v).normalize();
  }

  /** 1 at the surface -> 0 in orbit (read by planetstate to fade stars in space). */
  get groundAmt() { return this.atmoMat.uniforms.uGroundAmt.value; }

  /** Universe-space centre of the planet (default origin). */
  setPlanetCenter(v) { this.planetCenter.copy(v); }

  // --- per-frame -----------------------------------------------------------

  /**
   * @param {number} dt seconds (reserved; no time-based motion here)
   * @param {THREE.Vector3} cameraWorldPos camera position in universe space
   */
  update(dt, cameraWorldPos) {
    // Floating origin: place the planet so the camera sits near world origin.
    // Everything the shader sees is then small-magnitude -> float32 precision
    // holds even though the universe coordinate may be huge.
    this.root.position.copy(this.planetCenter).sub(cameraWorldPos);
    this.root.updateMatrixWorld(true);

    // Camera position in planet-local space drives LOD.
    this._camLocal.copy(cameraWorldPos).sub(this.planetCenter);
    for (let i = 0; i < 6; i++) this.faces[i].update(this._camLocal);

    // Feed the atmosphere shell the player's radial up + a ground/orbit blend so
    // one shader serves both the ground sky dome and the orbital limb. uUp must
    // be the player radial (NOT cameraPosition, which is pinned at the origin).
    const rLen = this._camLocal.length();
    const agl = rLen - this.radius;
    const g = 1 - agl / (this.radius * 0.5);
    const groundAmt = g < 0 ? 0 : g > 1 ? 1 : g;
    if (rLen > 1e-3) {
      this.atmoMat.uniforms.uUp.value.copy(this._camLocal).multiplyScalar(1 / rLen);
      this.skyMat.uniforms.uUp.value.copy(this.atmoMat.uniforms.uUp.value);
    }
    this.atmoMat.uniforms.uGroundAmt.value = groundAmt;
    this.skyMat.uniforms.uGroundAmt.value = groundAmt;   // fades the ground sky to space

    // slow cloud drift (the mesh is a child of root, so it rebases correctly).
    if (this.cloudMesh) this.cloudMesh.rotation.y += dt * 0.003;
  }

  /** { leaves, triangles, builds } — walks the tree; call sparingly. */
  getStats() {
    let leaves = 0, tris = 0;
    const walk = (c) => {
      if (c.children) { for (let i = 0; i < 4; i++) walk(c.children[i]); return; }
      if (c.mesh) { leaves++; tris += c.mesh.geometry.index.count / 3; }
    };
    for (let i = 0; i < 6; i++) walk(this.faces[i]);
    return { leaves, triangles: tris, builds: this._builds };
  }

  dispose() {
    for (let i = 0; i < 6; i++) this.faces[i]._destroy();
    this.faces = null;
    this.terrainMat.dispose();
    this._detailTex?.dispose();
    if (this.seaMesh) { this.seaMesh.geometry.dispose(); this.seaMat.dispose(); }
    this.atmoMesh.geometry.dispose(); this.atmoMat.dispose();
    this.scene.remove(this.skyMesh); this.skyMesh.geometry.dispose(); this.skyMat.dispose();
    if (this.cloudMesh) { this.cloudMesh.geometry.dispose(); this.cloudMat.dispose(); this._cloudTex.dispose(); }
    this.scene.remove(this.root);
  }
}

// Scratch colours reused inside the hot build loop (no per-vertex allocation).
const SCRATCH_COL = new THREE.Color();
const SCRATCH_COL2 = new THREE.Color();
const SCRATCH_COL3 = new THREE.Color();
