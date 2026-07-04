// Procedural PBR material factory. Turns flat MeshStandardMaterial colors into
// real physically-based surfaces: albedo + tangent-space normal + roughness +
// AO/cavity, all derived from ONE seamless procedurally-generated height field
// so the four maps stay perfectly coherent (a crevice in the height is dark in
// the AO, rough in the roughness, dented in the normal, and tinted in the
// albedo). Zero external assets — every texel is synthesized from the shared
// SimplexNoise + RNG so a given (preset, seed) always reproduces byte-for-byte.
//
// Seamless tiling: noise is torus-sampled (like terrain.js makeDetailTexture),
// so every map wraps cleanly under RepeatWrapping at any repeat count.
//
// -------------------------------------------------------------------- USAGE
//   import { makeMaterial } from './materials.js';
//   const mat = makeMaterial('rock', { seed: planetSeed, repeat: 4 });
//   const mesh = new THREE.Mesh(geo, mat);   // geo MUST have a `uv` attribute
//
// makeMaterial() returns a SHARED, CACHED material (cheap to call repeatedly
// with the same key). Do not mutate the returned instance in place — clone it,
// or pass a distinct `seed`/`color`, if you need a per-mesh variant.
//
// ----------------------------------------------------------- aoMap / uv NOTE
//  * map / normalMap / roughnessMap all read the mesh's primary `uv` set. Any
//    mesh that draws these needs a `uv` attribute (Box/Sphere/Cylinder/Plane
//    geometries all have one; hand-built BufferGeometry may not — terrain's
//    ground mesh, for instance, has none, so it does its detail in-shader).
//  * aoMap ONLY affects INDIRECT (ambient / hemisphere / env) light — correct
//    PBR behavior. In three r160 it samples whatever UV channel `aoMap.channel`
//    points at. We default to channel 0 (the SAME primary `uv`), so AO tiles
//    identically to the other maps and needs NO second UV set — it just works.
//  * Classic three wisdom "aoMap needs a second UV set (uv2)" only applies if
//    you deliberately want a distinct AO unwrap. To do that pass
//    `{ aoChannel: 1 }` AND give the geometry a `uv1` attribute (this is the
//    r160 name for the old `uv2` set), e.g.
//        geo.setAttribute('uv1', geo.attributes.uv.clone());
//    If you would rather skip AO entirely, pass `{ ao: false }`.
//
// -------------------------------------------------------------- MEMORY / PERF
//  * Default map size is 256×256 (opts.size, clamped 64..512, snapped to POT).
//    Four RGBA8 maps ≈ 4 × 256KB = 1MB + ~33% mipmaps ≈ 1.3MB per unique key.
//  * Generation cost is all up-front (a few ms per material at 256px) and only
//    paid once per cache key — steady-state frames touch nothing here.
//  * Everything is cached by (preset, seed, repeat, size, color, ao, channel,
//    scalar-overrides). Reuse the same opts across meshes to share GPU memory
//    and cut draw-call state changes. Call disposeMaterialCache() on teardown.

import * as THREE from 'three';
import { SimplexNoise } from '../core/noise.js';
import { hash32 } from '../core/rng.js';

const TAU = Math.PI * 2;

/* ----------------------------------------------------------------- helpers */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const wrap = (i, n) => ((i % n) + n) % n;

/** Linear → sRGB transfer (so linear THREE.Color values land correctly in an
 *  sRGB-flagged texture the GPU will decode back to linear). */
function lin2srgb(c) {
  c = clamp01(c);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Deterministic white-noise speckle in [0,1) from integer pixel coords. */
function hash2(x, y) { return hash32(x, y) / 4294967296; }

/** Clamp requested texture size into [64,512] and snap to a power of two so
 *  mipmapping is rock-solid on SwiftShader / WebGL2. */
function clampSize(s) {
  s = (s | 0) || 256;
  s = Math.max(64, Math.min(512, s));
  return 1 << Math.round(Math.log2(s));
}

/** Normalize a repeat option (number | [x,y]) to [x,y]. */
function normRepeat(r) {
  if (Array.isArray(r)) return [r[0] || 1, r[1] || 1];
  const n = r || 1;
  return [n, n];
}

/** Apply the standard tiling/mip/anisotropy config to a generated texture. */
function finishTex(tex, { srgb = false, anisotropy = 4, repeat } = {}) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;      // else default = raw/linear
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  tex.needsUpdate = true;
  return tex;
}

/** Accept a height source as {data,size}, a canvas from makeHeightCanvas
 *  (carries .heightField), or a raw grayscale canvas (8-bit fallback). */
function asHeight(src) {
  if (src && src.data instanceof Float32Array && src.size) return src;
  if (src && src.heightField) return src.heightField;
  if (src && typeof src.getContext === 'function') {
    const size = src.width;
    const px = src.getContext('2d').getImageData(0, 0, size, size).data;
    const data = new Float32Array(size * size);
    for (let i = 0; i < data.length; i++) data[i] = px[i * 4] / 255;
    return { data, size };
  }
  throw new Error('materials: unrecognized height source');
}

/* ------------------------------------------------------------ height field */

const HEIGHT_DEFAULTS = {
  freq: 2.6,          // base tiling frequency (torus circle radius)
  octaves: 5,
  gain: 0.5,
  lacunarity: 2.0,
  warp: 0.5,          // domain-warp amount (organic flow); 0 = off
  ridged: 0.0,        // 0 = billowy fbm, 1 = sharp ridges (strata / facets)
  stretch: [1, 1],    // anisotropic feature stretch [u, v] (bark grain, brushing)
};

function heightCfg(opts = {}) {
  return { ...HEIGHT_DEFAULTS, ...(opts.height || {}) };
}

/**
 * Generate a seamless-tiling height field in [0,1]. Noise is sampled on a
 * torus — every input coordinate is a linear combination of cos/sin(a) and
 * cos/sin(b) with a=2π·x/size, b=2π·y/size — so the tile wraps with no seam
 * at any edge, exactly like terrain.js makeDetailTexture.
 * @returns {Float32Array} length size*size, row-major.
 */
function genHeight(size, cfg, seed) {
  const nA = new SimplexNoise(hash32(seed, 8311));
  const nW = new SimplexNoise(hash32(seed, 8312));
  const { freq, octaves, gain, lacunarity, warp, ridged, stretch } = cfg;
  const rx = freq * stretch[0], ry = freq * stretch[1];
  const data = new Float32Array(size * size);
  let mn = Infinity, mx = -Infinity;

  for (let y = 0; y < size; y++) {
    const b = (y / size) * TAU;
    const qx = Math.cos(b), qy = Math.sin(b);
    for (let x = 0; x < size; x++) {
      const a = (x / size) * TAU;
      const px = Math.cos(a), py = Math.sin(a);
      // 4D torus coords → 3D noise input (any linear mix stays periodic in a,b)
      const cx = px * rx, cy = py * rx, cz = qx * ry, cw = qy * ry;
      let ix = cx + cz * 0.75;
      let iy = cy + cw * 0.75;
      const iz = cz * 0.6 - cy * 0.4 + cw * 0.5;

      if (warp > 0) {
        const wx = nW.fbm3(ix + 11.3, iy + 5.1, iz, 3);
        const wy = nW.fbm3(ix - 7.7, iy + 2.4, iz + 3.1, 3);
        ix += warp * wx; iy += warp * wy;
      }

      let h;
      if (ridged > 0) {
        let amp = 0.5, f = 1, sum = 0;
        for (let o = 0; o < octaves; o++) {
          const n = 1 - Math.abs(nA.noise3D(ix * f, iy * f, iz * f));
          sum += n * n * amp;
          amp *= gain; f *= lacunarity;
        }
        const fb = nA.fbm3(ix, iy, iz, octaves, lacunarity, gain) * 0.5 + 0.5;
        h = fb * (1 - ridged) + sum * ridged;
      } else {
        h = nA.fbm3(ix, iy, iz, octaves, lacunarity, gain) * 0.5 + 0.5;
      }

      data[y * size + x] = h;
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
  }
  // normalize to full [0,1] so downstream response is consistent across presets
  const inv = mx > mn ? 1 / (mx - mn) : 1;
  for (let i = 0; i < data.length; i++) data[i] = (data[i] - mn) * inv;
  return data;
}

/** Separable wrap-around box blur (sliding window). Used for cavity AO and the
 *  macro albedo tint — the wrap keeps blurred maps seamless too. */
function boxBlurWrap(data, size, r) {
  if (r < 1) return data.slice();
  const tmp = new Float32Array(size * size);
  const out = new Float32Array(size * size);
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += data[row + wrap(k, size)];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = acc * norm;
      acc += data[row + wrap(x + r + 1, size)] - data[row + wrap(x - r, size)];
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[wrap(k, size) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = acc * norm;
      acc += tmp[wrap(y + r + 1, size) * size + x] - tmp[wrap(y - r, size) * size + x];
    }
  }
  return out;
}

/* --------------------------------------------------------- map generators */
/* All four are exported so other modules can hand-roll custom materials from a
   shared height field: genHeight → heightToNormal / makeRoughness / makeAO. */

/**
 * Build a grayscale height canvas (seamless, tiling). Returned canvas carries
 * a `.heightField = { data:Float32Array, size }` property (full precision) that
 * the other generators consume directly, so no 8-bit round-trip is needed.
 * @param {object} [opts] { size, seed, height:{freq,octaves,gain,lacunarity,warp,ridged,stretch} }
 * @returns {HTMLCanvasElement}
 */
export function makeHeightCanvas(opts = {}) {
  const size = clampSize(opts.size ?? 256);
  const seed = (opts.seed ?? 1) >>> 0;
  const data = genHeight(size, heightCfg(opts), seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const im = ctx.createImageData(size, size);
  for (let i = 0; i < data.length; i++) {
    const b = Math.round(data[i] * 255);
    const k = i * 4;
    im.data[k] = im.data[k + 1] = im.data[k + 2] = b;
    im.data[k + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  c.heightField = { data, size };
  return c;
}

/**
 * Height field → tangent-space normal map (Sobel central differences, packed
 * RGB with the standard n = (rgb*2-1) encoding, blue = out-of-surface). Built
 * as a DataTexture (flipY=false), matching the albedo/rough/ao so all four
 * maps share orientation. OpenGL/green-up convention; if a surface lights
 * inverted, flip the material's normalScale.y.
 * @param {HTMLCanvasElement|{data,size}} src height source
 * @param {object} [opts] { strength=1, anisotropy, repeat }
 * @returns {THREE.DataTexture}
 */
export function heightToNormal(src, opts = {}) {
  const { data, size } = asHeight(src);
  const K = 1.3;                          // base slope gain; artistic tuning via strength + normalScale
  const sc = (opts.strength ?? 1) * K;
  const img = new Uint8Array(size * size * 4);
  const H = (x, y) => data[wrap(y, size) * size + wrap(x, size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = H(x - 1, y - 1), tm = H(x, y - 1), tr = H(x + 1, y - 1);
      const ml = H(x - 1, y),                        mr = H(x + 1, y);
      const bl = H(x - 1, y + 1), bm = H(x, y + 1), br = H(x + 1, y + 1);
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl); // d/du
      const gy = (bl + 2 * bm + br) - (tl + 2 * tm + tr); // d/dv (row+ = v+ with flipY=false)
      let nx = -gx * sc, ny = -gy * sc, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * size + x) * 4;
      // round (not truncate) so a flat surface encodes to the neutral 128,128,255
      img[i]     = Math.round((nx * 0.5 + 0.5) * 255);
      img[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img[i + 3] = 255;
    }
  }
  return finishTex(new THREE.DataTexture(img, size, size, THREE.RGBAFormat), { srgb: false, ...opts });
}

/**
 * Height field → roughness map (grayscale, value replicated across RGB so it
 * reads correctly through roughnessMap's green channel). Crevices read rougher
 * (grime/scatter), raised areas smoother — invert for the opposite. A little
 * hashed micro-speckle keeps highlights from being a dead flat wash so the sun
 * shimmers as it glances across.
 * @param {HTMLCanvasElement|{data,size}} src
 * @param {object} [opts] { base=0.7, vary=0.22, speckle=0.05, invert=false, anisotropy, repeat }
 * @returns {THREE.DataTexture}
 */
export function makeRoughness(src, opts = {}) {
  const { data, size } = asHeight(src);
  const base = opts.base ?? 0.7;
  const vary = opts.vary ?? 0.22;
  const speckle = opts.speckle ?? 0.05;
  const invert = opts.invert ? 1 : -1;    // -1: low height (crevice) → rougher
  const img = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const h = data[idx];
      let r = base + invert * (h - 0.5) * vary + (hash2(x, y) - 0.5) * speckle;
      r = Math.round(clamp01(r) * 255);
      const k = idx * 4;
      img[k] = img[k + 1] = img[k + 2] = r;
      img[k + 3] = 255;
    }
  }
  return finishTex(new THREE.DataTexture(img, size, size, THREE.RGBAFormat), { srgb: false, ...opts });
}

/**
 * Height field → AO / cavity map (grayscale; aoMap reads the red channel).
 * Approximates occlusion by comparing each texel to a local blurred average:
 * texels sitting below their neighborhood (crevices) darken; a gentle broad
 * term also shades macro recesses. Bright-biased with a floor so it enriches
 * rather than muddies.
 * @param {HTMLCanvasElement|{data,size}} src
 * @param {object} [opts] { strength=1, radius, floor=0.4, anisotropy, repeat }
 * @returns {THREE.DataTexture}
 */
export function makeAO(src, opts = {}) {
  const { data, size } = asHeight(src);
  const radius = opts.radius ?? Math.max(2, Math.round(size / 48));
  const strength = opts.strength ?? 1;
  const floor = opts.floor ?? 0.4;
  const blur = boxBlurWrap(data, size, radius);
  const img = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) {
    const cavity = data[i] - blur[i];               // <0 in crevices
    let ao = 1 + Math.min(0, cavity) * strength * 3;
    ao *= 0.85 + 0.15 * blur[i];                    // broad recess shading
    ao = Math.max(clamp01(ao), floor);
    const b = Math.round(ao * 255);
    const k = i * 4;
    img[k] = img[k + 1] = img[k + 2] = b;
    img[k + 3] = 255;
  }
  return finishTex(new THREE.DataTexture(img, size, size, THREE.RGBAFormat), { srgb: false, ...opts });
}

/**
 * Height field → albedo map (sRGB DataTexture). Two-tones between `color` and
 * `color2` by elevation, modulates lightness by height, and adds a faint
 * desaturated grain — all keyed off the same height so albedo variation lines
 * up with the normal/AO. Exported for custom materials.
 * @param {HTMLCanvasElement|{data,size}} src
 * @param {object} [opts] { color, color2, var=0.32, grain=0.05, macro=true, anisotropy, repeat }
 * @returns {THREE.DataTexture}
 */
export function makeAlbedo(src, opts = {}) {
  const { data, size } = asHeight(src);
  const base = new THREE.Color(opts.color ?? '#808080');
  const c2 = opts.color2 ? new THREE.Color(opts.color2) : base.clone();
  const varAmt = opts.var ?? 0.32;
  const grain = opts.grain ?? 0.05;
  const macro = opts.macro === false ? null : boxBlurWrap(data, size, Math.max(3, Math.round(size / 20)));
  const tmp = new THREE.Color();
  const img = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const h = data[idx];
      const t = macro ? smooth01(macro[idx] * 1.15 - 0.05) : smooth01(h);
      tmp.copy(base).lerp(c2, t);
      const l = 1 + (h - 0.5) * varAmt;
      const gr = (hash2(x, y) - 0.5) * grain;
      const k = idx * 4;
      img[k]     = Math.round(lin2srgb(clamp01(tmp.r * l + gr)) * 255);
      img[k + 1] = Math.round(lin2srgb(clamp01(tmp.g * l + gr)) * 255);
      img[k + 2] = Math.round(lin2srgb(clamp01(tmp.b * l + gr)) * 255);
      img[k + 3] = 255;
    }
  }
  return finishTex(new THREE.DataTexture(img, size, size, THREE.RGBAFormat), { srgb: true, ...opts });
}

/* ------------------------------------------------------------------ presets */
/* Each preset tunes base color(s), scalar roughness/metalness, normal strength,
   envMapIntensity (used when a scene sets scene.environment), plus the height
   generator config and the roughness/AO shaping. Sensible ranges chosen to read
   convincingly under the ACES + bloom pipeline. */

export const PRESETS = Object.freeze({
  rock: {
    color: '#6f665b', color2: '#514a41', metalness: 0.0, normal: 1.1, env: 0.7,
    albVar: 0.4, aoIntensity: 1.0,
    height: { freq: 2.6, octaves: 5, warp: 0.6, ridged: 0.3 },
    rough: { base: 0.82, vary: 0.22 }, ao: { strength: 1.15 },
  },
  cliff: {
    color: '#776e60', color2: '#463f36', metalness: 0.0, normal: 1.4, env: 0.6,
    albVar: 0.5, aoIntensity: 1.15,
    height: { freq: 2.0, octaves: 6, warp: 0.35, ridged: 0.65, stretch: [1, 1.7] },
    rough: { base: 0.86, vary: 0.2 }, ao: { strength: 1.4, radius: 3 },
  },
  soil: {
    color: '#4a3a29', color2: '#2f2418', metalness: 0.0, normal: 0.85, env: 0.5,
    albVar: 0.42, aoIntensity: 1.1,
    height: { freq: 3.4, octaves: 5, warp: 0.8, ridged: 0.1 },
    rough: { base: 0.93, vary: 0.14 }, ao: { strength: 1.2 },
  },
  sand: {
    color: '#cdb489', color2: '#b49a6c', metalness: 0.0, normal: 0.6, env: 0.7,
    albVar: 0.22, aoIntensity: 0.7,
    height: { freq: 5.5, octaves: 4, warp: 0.25, ridged: 0.0, stretch: [1, 3.2] },
    rough: { base: 0.8, vary: 0.12, speckle: 0.09 }, ao: { strength: 0.6, floor: 0.6 },
  },
  snow: {
    color: '#e9f1fb', color2: '#cfe0f2', metalness: 0.0, normal: 0.5, env: 1.1,
    albVar: 0.16, aoIntensity: 0.6,
    height: { freq: 4.0, octaves: 5, warp: 0.4, ridged: 0.15 },
    rough: { base: 0.42, vary: 0.28, speckle: 0.14 }, ao: { strength: 0.7, floor: 0.6 },
  },
  ice: {
    color: '#bcd8e6', color2: '#8fb6cc', metalness: 0.0, normal: 0.45, env: 1.3,
    albVar: 0.18, aoIntensity: 0.7,
    height: { freq: 3.0, octaves: 5, warp: 0.3, ridged: 0.7 },
    rough: { base: 0.14, vary: 0.22 }, ao: { strength: 0.9, floor: 0.55 },
  },
  bark: {
    color: '#4b3826', color2: '#2c2015', metalness: 0.0, normal: 1.15, env: 0.4,
    albVar: 0.5, aoIntensity: 1.2,
    height: { freq: 3.0, octaves: 5, warp: 0.5, ridged: 0.5, stretch: [2.4, 0.35] },
    rough: { base: 0.9, vary: 0.16 }, ao: { strength: 1.35 },
  },
  foliage: {
    color: '#35502a', color2: '#213a19', metalness: 0.0, normal: 0.55, env: 0.5,
    albVar: 0.45, aoIntensity: 0.9,
    height: { freq: 4.5, octaves: 4, warp: 0.7, ridged: 0.2 },
    rough: { base: 0.72, vary: 0.2, speckle: 0.08 }, ao: { strength: 1.0, floor: 0.5 },
  },
  metalPanel: {
    color: '#8a929c', color2: '#6c747e', metalness: 0.9, normal: 0.7, env: 1.0,
    albVar: 0.22, aoIntensity: 1.0,
    height: { freq: 3.2, octaves: 4, warp: 0.3, ridged: 0.4 },
    rough: { base: 0.4, vary: 0.28, speckle: 0.06 }, ao: { strength: 1.1 },
  },
  hullPaint: {
    color: '#9aa4ad', color2: '#7c858e', metalness: 0.15, normal: 0.4, env: 0.9,
    albVar: 0.16, aoIntensity: 0.85,
    height: { freq: 3.0, octaves: 4, warp: 0.4, ridged: 0.15 },
    rough: { base: 0.48, vary: 0.16, speckle: 0.05 }, ao: { strength: 0.8, floor: 0.55 },
  },
  concrete: {
    color: '#9a968e', color2: '#78746c', metalness: 0.0, normal: 0.75, env: 0.55,
    albVar: 0.28, aoIntensity: 1.05,
    height: { freq: 3.8, octaves: 5, warp: 0.55, ridged: 0.2 },
    rough: { base: 0.85, vary: 0.16, speckle: 0.07 }, ao: { strength: 1.15 },
  },
  crystal: {
    color: '#8fe6ff', color2: '#5aa9d6', metalness: 0.0, normal: 0.9, env: 1.35,
    albVar: 0.3, aoIntensity: 0.8,
    height: { freq: 2.2, octaves: 5, warp: 0.2, ridged: 0.85 },
    rough: { base: 0.16, vary: 0.24 }, ao: { strength: 1.0, floor: 0.5 },
  },
});

/* --------------------------------------------------------- material factory */

const _cache = new Map(); // key -> { material, textures:[] }

/**
 * Get a cached, fully-configured MeshStandardMaterial for a preset. Repeated
 * calls with the same key are free (return the shared instance).
 *
 * @param {keyof PRESETS} preset  one of the PRESETS names
 * @param {object} [opts]
 *   @param {string|number|THREE.Color} [opts.color]  override base albedo color
 *   @param {number}   [opts.seed=1]        determinism seed
 *   @param {number|[number,number]} [opts.repeat=1]  texture tiling
 *   @param {number}   [opts.size=256]      map resolution (64..512, POT-snapped)
 *   @param {boolean}  [opts.ao=true]       include aoMap
 *   @param {0|1}      [opts.aoChannel=0]   UV set for aoMap (1 => needs `uv1`)
 *   @param {number}   [opts.anisotropy=4]  texture anisotropy
 *   @param {object}   [opts.height]        override height-gen config (per-field)
 *   @param {number}   [opts.normalScale]   override normal strength (Vector2 xy)
 *   @param {number}   [opts.roughness]     multiplies the baked roughness map
 *   @param {number}   [opts.metalness]     override scalar metalness
 *   @param {number}   [opts.envMapIntensity]
 * @returns {THREE.MeshStandardMaterial} shared/cached — clone before mutating
 */
export function makeMaterial(preset, opts = {}) {
  const P = PRESETS[preset];
  if (!P) throw new Error(`materials: unknown preset "${preset}"`);

  const size = clampSize(opts.size ?? 256);
  const seed = (opts.seed ?? 1) >>> 0;
  const repeat = normRepeat(opts.repeat ?? 1);
  const colorHex = new THREE.Color(opts.color ?? P.color).getHexString();
  const ao = opts.ao !== false;
  const aoChannel = opts.aoChannel ?? 0;

  const key = [
    preset, seed, `${repeat[0]}x${repeat[1]}`, size, colorHex, ao ? 1 : 0, aoChannel,
    opts.height ? JSON.stringify(opts.height) : '',
    opts.normalScale ?? '', opts.roughness ?? '', opts.metalness ?? '', opts.envMapIntensity ?? '',
    opts.anisotropy ?? '',
  ].join('|');
  const hit = _cache.get(key);
  if (hit) return hit.material;

  const cfg = heightCfg({ height: { ...(P.height || {}), ...(opts.height || {}) } });
  const height = { data: genHeight(size, cfg, seed), size };
  const anisotropy = opts.anisotropy ?? 4;

  const albedo = makeAlbedo(height, { color: opts.color ?? P.color, color2: P.color2, var: P.albVar, anisotropy, repeat });
  const normal = heightToNormal(height, { strength: P.normal, anisotropy, repeat });
  const rough = makeRoughness(height, { ...(P.rough || {}), anisotropy, repeat });
  const aoTex = ao ? makeAO(height, { ...(P.ao || {}), anisotropy, repeat }) : null;

  const nScale = opts.normalScale ?? P.normal ?? 1;
  const mat = new THREE.MeshStandardMaterial({
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(nScale, nScale),
    roughnessMap: rough,
    roughness: opts.roughness ?? 1.0,           // absolute roughness lives in the map
    metalness: opts.metalness ?? P.metalness ?? 0.0,
    envMapIntensity: opts.envMapIntensity ?? P.env ?? 1.0,
  });
  if (aoTex) {
    mat.aoMap = aoTex;
    mat.aoMap.channel = aoChannel;              // 0 => primary uv (default), 1 => uv1
    mat.aoMapIntensity = P.aoIntensity ?? 1.0;
  }
  mat.name = `ams:${preset}`;

  const textures = [albedo, normal, rough];
  if (aoTex) textures.push(aoTex);
  _cache.set(key, { material: mat, textures });
  return mat;
}

/** Free every cached material and the textures it owns. Call on scene teardown
 *  (e.g. when leaving a planet surface / unloading a station). */
export function disposeMaterialCache() {
  for (const { material, textures } of _cache.values()) {
    for (const t of textures) t.dispose();
    material.dispose();
  }
  _cache.clear();
}

/** Number of live cached materials (diagnostics / tests). */
export function materialCacheSize() { return _cache.size; }
