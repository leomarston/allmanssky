// Higher-fidelity procedural flora & rock builders. Each builder is
// deterministic from the passed RNG and returns a self-contained bundle
// { group, materials, material, update?(dt), dispose() } so it can be dropped
// in as a world prop (see integration notes) or have its geometry/material
// harvested for instancing/LOD later.
//
// Design goals (vs. the flat low-poly blobs elsewhere):
//   * trunks/branches are swept, tapered, noise-displaced limbs (real bend)
//   * canopies are several clustered, displaced leaf-masses with intra-canopy
//     colour variation + a faint emissive "translucency" feel, not one sphere
//   * rocks are multi-octave noise-displaced icosahedra with faceted shading
//   * ferns/shrubs use procedurally-masked curved blades/fronds
//   * everything varies by def.biome (snow-dusted / sparse / charred / …)
//
// Determinism: all randomness flows from the passed RNG (or a SimplexNoise
// seeded from it), so seed -> identical model.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplexNoise } from '../core/noise.js';

const TAU = Math.PI * 2;

// --------------------------------------------------------------- material kit
// Optional PBR material factory from a parallel module. Guarded: if it is
// absent (or throws) we fall back to locally-built MeshStandardMaterials so
// this file works standalone. Top-level await resolves before any builder runs.
let _factory = null;
try {
  const mod = await import('./materials.js');
  _factory = (mod && typeof mod.makeMaterial === 'function') ? mod.makeMaterial : null;
} catch { _factory = null; }

/** Albedo is always driven by per-vertex colour (base colour forced white),
 *  matching the codebase convention (see flora.js). The factory, when present,
 *  still contributes procedural roughness/normal detail. */
function tuneMaterial(m, preset, color) {
  m.vertexColors = true;
  if (m.color) m.color.setScalar(1);
  if (preset === 'foliage') {
    m.side = THREE.DoubleSide;
    if ('emissive' in m) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = Math.max(m.emissiveIntensity ?? 0, 0.13);
    }
  }
  m.needsUpdate = true;
  return m;
}

function fallbackMaterial(preset, color) {
  const c = new THREE.Color(color);
  switch (preset) {
    case 'bark':
      return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.87, metalness: 0.0 });
    case 'foliage':
      return new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.64, metalness: 0.0, side: THREE.DoubleSide,
        emissive: c, emissiveIntensity: 0.13,
      });
    case 'rock':
      return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: true });
    default:
      return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0 });
  }
}

/** Resolve a material for a preset, factory-first with a local fallback. */
function makeMat(preset, { seed = 0, color = 0xffffff, repeat = 1 } = {}) {
  if (_factory) {
    try {
      const m = _factory(preset, { seed, repeat, color });
      if (m && m.isMaterial) return tuneMaterial(m, preset, color);
    } catch { /* fall through */ }
  }
  return fallbackMaterial(preset, color);
}

/** Alpha-masked blade/frond material (built locally — factory has no such preset). */
function bladeMaterial(tex, color) {
  return new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true,
    roughness: 0.58, metalness: 0.0,
    emissive: new THREE.Color(color), emissiveIntensity: 0.1,
  });
}

// -------------------------------------------------------------- colour helpers
const col = (hex) => new THREE.Color(hex);
const mix = (a, b, t) => a.clone().lerp(b instanceof THREE.Color ? b : col(b), t);

const PAL_FALLBACK = {
  shore: '#c9b98c', low: '#3f7f3a', mid: '#7a9a4f', high: '#cfd8cc',
  peak: '#f4f8f8', cliff: '#6b6257', accent: '#59b552', glow: '#7de8ff',
};

/** Parse def.palette into THREE.Colors with sane fallbacks. */
function kitOf(def) {
  const k = {};
  for (const key of Object.keys(PAL_FALLBACK)) k[key] = col(def?.palette?.[key] ?? PAL_FALLBACK[key]);
  return k;
}

// ------------------------------------------------------------ geometry helpers

/** Bake a TRS transform into a geometry (px..s like flora.js). */
function xf(geo, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const sc = Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s);
  geo.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    sc,
  ));
  return geo;
}

/** Merge a list of geometries (normalising indexed/non-indexed like flora.js). */
function mergeGeos(list) {
  if (list.length === 1) return list[0];
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false);
  for (let i = 0; i < list.length; i++) {
    if (flat[i] !== list[i]) flat[i].dispose();
    list[i].dispose();
  }
  return merged;
}

/**
 * Per-vertex colour via callback. fn(color, x, y, z, i, normal, bb) mutates
 * `color` in place. Normals are computed first so callbacks can read them.
 */
function paint(geo, fn) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const p = geo.attributes.position, nrm = geo.attributes.normal, n = p.count;
  const arr = new Float32Array(n * 3), c = new THREE.Color();
  const nv = { x: 0, y: 1, z: 0 };
  for (let i = 0; i < n; i++) {
    nv.x = nrm.getX(i); nv.y = nrm.getY(i); nv.z = nrm.getZ(i);
    fn(c, p.getX(i), p.getY(i), p.getZ(i), i, nv, bb);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// -- swept limb (trunk / branch) ---------------------------------------------

/** Parallel-transport frames along a poly-spine (avoids twisting). */
function spineFrames(points) {
  const N = points.length;
  const tan = [], nor = [], bin = [];
  for (let i = 0; i < N; i++) {
    let t;
    if (i === 0) t = points[1].clone().sub(points[0]);
    else if (i === N - 1) t = points[N - 1].clone().sub(points[N - 2]);
    else t = points[i + 1].clone().sub(points[i - 1]);
    tan.push(t.normalize());
  }
  let n0 = new THREE.Vector3(0, 1, 0);
  if (Math.abs(tan[0].dot(n0)) > 0.99) n0.set(1, 0, 0);
  n0 = new THREE.Vector3().crossVectors(tan[0], n0).normalize();
  nor[0] = n0;
  bin[0] = new THREE.Vector3().crossVectors(tan[0], n0).normalize();
  for (let i = 1; i < N; i++) {
    const n = nor[i - 1].clone();
    const axis = new THREE.Vector3().crossVectors(tan[i - 1], tan[i]);
    const len = axis.length();
    if (len > 1e-6) {
      axis.divideScalar(len);
      n.applyAxisAngle(axis, Math.acos(THREE.MathUtils.clamp(tan[i - 1].dot(tan[i]), -1, 1)));
    }
    nor[i] = n.normalize();
    bin[i] = new THREE.Vector3().crossVectors(tan[i], nor[i]).normalize();
  }
  return { nor, bin };
}

/**
 * Sweep a tapered, noise-displaced tube along a spine.
 * @param {THREE.Vector3[]} points spine (>=2)
 * @param {(t:number)=>number} radiusFn radius by normalized length t
 * @param {number} sides radial segments
 * @param {object} o { noise, noiseAmp, noiseFreq, capBottom }
 */
function limb(points, radiusFn, sides, o = {}) {
  const { nor, bin } = spineFrames(points);
  const N = points.length;
  const noise = o.noise, nAmp = o.noiseAmp ?? 0, nFreq = o.noiseFreq ?? 1.4;
  const pos = [], idx = [];
  const dir = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const r = radiusFn(t);
    const c = points[i];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * TAU;
      const cs = Math.cos(a), sn = Math.sin(a);
      dir.set(0, 0, 0).addScaledVector(nor[i], cs).addScaledVector(bin[i], sn);
      let rr = r;
      if (noise) rr *= 1 + nAmp * noise.fbm3(dir.x * nFreq + c.x * 0.6, dir.y * nFreq + c.y * 0.6 + t * 4, dir.z * nFreq + c.z * 0.6, 3);
      pos.push(c.x + dir.x * rr, c.y + dir.y * rr, c.z + dir.z * rr);
    }
  }
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides;
      const cc = (i + 1) * sides + j, d = (i + 1) * sides + (j + 1) % sides;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  if (o.capBottom) {
    const centre = pos.length / 3;
    pos.push(points[0].x, points[0].y - 0.02, points[0].z);
    for (let j = 0; j < sides; j++) idx.push(centre, (j + 1) % sides, j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// -- displaced blob (leaf-mass / rock) ---------------------------------------

/** Multi-octave noise-displaced icosphere. Returns geometry at origin. */
function blob(r, detail, noise, seed, { amp = 0.22, freq = 1.5, squash = 1, warp = 0 } = {}) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, n = p.count;
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const d = v.clone().normalize();
    let s = amp * noise.fbm3(d.x * freq + seed, d.y * freq, d.z * freq - seed, 4);
    if (warp) s += warp * amp * noise.fbm3(d.x * freq * 3.1, d.y * freq * 3.1 + seed, d.z * freq * 3.1, 2);
    v.multiplyScalar(1 + s);
    v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// -- curved blade / frond -----------------------------------------------------

/** An arching, tapered strip (base at origin, growing +Y, arching +Z). UVs 0..1. */
function blade(length, width, { segs = 6, arch = 0.55, droop = 0.15, taper = 0.9, curl = 0.12, noise = null, seed = 0 } = {}) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = width * (1 - taper * t) * 0.5;
    const sy = length * (t - droop * t * t);
    const sz = arch * length * t * t;
    const wob = noise ? noise.noise3D(t * 3 + seed, 4.3, 1.1) * curl * length : 0;
    pos.push(-w + wob, sy, sz, w + wob, sy, sz);
    uv.push(0, t, 1, t);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Colour a blade base->tip using its UV.y, with mottle. */
function paintBlade(geo, base, tip, noise, seed) {
  const uvAttr = geo.attributes.uv;
  return paint(geo, (c, x, y, z, i) => {
    const t = uvAttr.getY(i);
    c.copy(base).lerp(tip, t);
    const m = noise.noise3D(x * 2 + seed, y * 2, z * 2);
    c.offsetHSL(m * 0.015, m * 0.05, m * 0.05);
  });
}

// ----------------------------------------------------------- shared textures
// Module-scoped so many instances share a handful of alpha masks instead of
// minting one canvas per prop. NOT disposed per-instance (see dispose()).
const _texCache = new Map();

function frondTexture(variant) {
  const key = `frond${variant}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const W = 48, H = 168;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  const mid = W / 2;
  const leaflets = 13 + variant * 2;
  const ang = 0.62 + variant * 0.08;
  // rachis (v: bottom=base -> top=tip; canvas y inverted so tip at y=0)
  g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(mid, H - 4); g.lineTo(mid, 6); g.stroke();
  for (let i = 0; i < leaflets; i++) {
    const t = i / (leaflets - 1);                 // 0 base -> 1 tip
    const y = H - 8 - t * (H - 16);
    const len = (0.5 + 0.5 * Math.sin(t * Math.PI)) * (W * 0.44) * (1 - 0.35 * t);
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(mid, y);
      g.quadraticCurveTo(mid + s * dx * 0.5, y - dy * 0.2, mid + s * dx, y - dy);
      g.quadraticCurveTo(mid + s * dx * 0.55, y - dy * 0.05, mid, y + 2.2);
      g.closePath(); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  _texCache.set(key, tex);
  return tex;
}

function leafTexture(variant) {
  const key = `leaf${variant}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const W = 64, H = 96;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#fff';
  const mid = W / 2;
  const lobes = variant === 0 ? 1 : 3;              // simple ovate vs trilobed
  const draw = (cx, wScale, hScale, base) => {
    g.beginPath();
    g.moveTo(cx, base);
    g.quadraticCurveTo(cx + W * 0.32 * wScale, base - H * 0.32 * hScale, cx, base - H * 0.7 * hScale);
    g.quadraticCurveTo(cx - W * 0.32 * wScale, base - H * 0.32 * hScale, cx, base);
    g.closePath(); g.fill();
  };
  if (lobes === 1) draw(mid, 1, 1, H - 4);
  else { draw(mid, 0.8, 1, H - 4); draw(mid - W * 0.22, 0.55, 0.7, H - 10); draw(mid + W * 0.22, 0.55, 0.7, H - 10); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  _texCache.set(key, tex);
  return tex;
}

// -------------------------------------------------------------- biome profiles

const NAT = {
  leaf: 0x5aa64e, leafDark: 0x376b38, leafDry: 0x8f9a4a, pine: 0x2f5d44,
  bark: 0x6b4a33, barkDark: 0x3f2c1d, snow: 0xeaf3fb, char: 0x241d18,
  ember: 0xff7a2a, sick: 0x9fe04a, toxic: 0x7a4a9a,
};

/** Per-biome tree parameters. Colours are blended toward the planet palette. */
function treeProfile(biome, kit, rng) {
  const leaf = mix(col(NAT.leaf), kit.accent, 0.42);
  const leafD = mix(col(NAT.leafDark), kit.low, 0.4);
  const barkT = mix(col(NAT.bark), kit.cliff, 0.28);
  const barkB = mix(col(NAT.barkDark), kit.cliff, 0.32);
  const base = {
    form: 'broadleaf', hMin: 5, hMax: 8, baseR: 0.34, bend: 0.11, taper: 0.74,
    branches: 5, masses: 6, massR: 1.55, squash: 0.78, spread: 2.1, droop: 0,
    leafA: leaf, leafB: leafD, topLight: mix(leaf, col(0xffffff), 0.4),
    barkT, barkB, snow: false, glow: 0x0a1206, pivotFrac: 1.0, leafVar: 3,
  };
  switch (biome) {
    case 'lush':
      return { ...base, hMin: 5.5, hMax: 9, masses: 7, massR: 1.7, glow: 0x0e2208 };
    case 'swamp':
      return {
        ...base, hMin: 5, hMax: 8, bend: 0.16, masses: 5, massR: 1.9, squash: 0.62,
        droop: 0.1, leafA: mix(leaf, kit.low, 0.35), leafB: mix(leafD, col(0x33402a), 0.4),
        topLight: mix(leaf, col(0xbfd08a), 0.4), glow: 0x0c1a08,
      };
    case 'desert':
      return {
        ...base, form: 'umbrella', hMin: 3.6, hMax: 5.6, baseR: 0.26, bend: 0.14,
        branches: 6, masses: 4, massR: 1.5, squash: 0.42, spread: 2.6,
        leafA: mix(col(NAT.leafDry), kit.shore, 0.35), leafB: mix(col(0x6d7238), kit.low, 0.3),
        topLight: mix(col(NAT.leafDry), col(0xe8e0a0), 0.4), glow: 0x141206,
      };
    case 'frozen':
      return {
        ...base, form: 'conifer', hMin: 6, hMax: 10, baseR: 0.3, bend: 0.05, taper: 0.82,
        branches: 0, masses: 6, massR: 1.6, squash: 0.62, spread: 1.5, pivotFrac: 0.18,
        leafA: mix(col(NAT.pine), kit.accent, 0.28), leafB: mix(col(0x24463a), kit.low, 0.3),
        topLight: mix(col(NAT.pine), col(NAT.snow), 0.3), snow: true, glow: 0x08160f,
      };
    case 'volcanic':
      return {
        ...base, hMin: 4, hMax: 6.5, baseR: 0.24, bend: 0.22, branches: 6, masses: 4,
        massR: 1.2, squash: 0.7, spread: 2.0,
        leafA: mix(col(NAT.char), col(NAT.ember), 0.25), leafB: col(NAT.char),
        topLight: mix(col(NAT.ember), col(0xffb060), 0.4), barkT: mix(col(NAT.char), kit.cliff, 0.4),
        barkB: col(NAT.char), glow: 0x281006,
      };
    case 'toxic':
      return {
        ...base, hMin: 4.5, hMax: 7, bend: 0.14, masses: 5, massR: 1.6, squash: 0.72,
        leafA: mix(kit.accent, col(NAT.toxic), 0.4), leafB: mix(col(NAT.sick), kit.low, 0.4),
        topLight: mix(col(NAT.sick), col(0xd8ff9a), 0.4), glow: 0x1a2e0a,
      };
    case 'irradiated':
      return {
        ...base, hMin: 4, hMax: 6.5, bend: 0.24, branches: 4, masses: 5, massR: 1.35,
        leafA: mix(col(0x58ff8a), kit.glow, 0.35), leafB: mix(kit.low, col(0x4a5a3a), 0.5),
        topLight: mix(col(0x8affb0), col(0xffffff), 0.3), glow: 0x123018,
      };
    case 'ocean':
      return {
        ...base, form: 'palm', hMin: 5, hMax: 8, baseR: 0.22, bend: 0.18, taper: 0.72,
        branches: 0, masses: 8, spread: 0, droop: 0.35,
        leafA: mix(leaf, kit.accent, 0.4), leafB: mix(leafD, kit.shore, 0.2),
        topLight: mix(leaf, col(0xd8ff9a), 0.3), glow: 0x0e2408,
      };
    case 'barren':
      return {
        ...base, form: 'dead', hMin: 3.5, hMax: 6, baseR: 0.22, bend: 0.2, branches: 8,
        masses: 3, massR: 0.7, squash: 0.6, spread: 1.8,
        leafA: mix(col(0x8a7a55), kit.shore, 0.4), leafB: mix(col(NAT.barkDark), kit.cliff, 0.4),
        topLight: col(0xb5a373), glow: 0x0a0906,
      };
    default: // crystal / exotic / unknown -> muted broadleaf keyed to palette
      return {
        ...base, hMin: 4, hMax: 7, masses: 5,
        leafA: mix(leaf, kit.glow, 0.2), leafB: leafD, topLight: mix(leaf, kit.glow, 0.35),
        glow: 0x0c1a12,
      };
  }
}

// ------------------------------------------------------------------- disposal

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      // NOTE: m.map is a module-shared texture — intentionally not disposed.
    }
  });
}

// -------------------------------------------------------------- tree assembly

function trunkSpine(rng, noise, h, bend, segs) {
  const dir = rng.range(0, TAU);
  const bx = Math.cos(dir) * bend, bz = Math.sin(dir) * bend;
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, curve = t * t;
    const wx = noise.noise3D(t * 2.1, 11.3, 4.7) * 0.06 * h;
    const wz = noise.noise3D(7.1, t * 2.1, 2.2) * 0.06 * h;
    pts.push(new THREE.Vector3(bx * h * curve + wx, h * t, bz * h * curve + wz));
  }
  return pts;
}

function pointAtFrac(pts, frac) {
  const idx = Math.round(THREE.MathUtils.clamp(frac, 0, 1) * (pts.length - 1));
  return pts[idx].clone();
}

/**
 * Build a higher-fidelity tree.
 * @param {import('../core/rng.js').RNG} rng deterministic source
 * @param {object} def PlanetDef-ish ({ biome, palette }) — optional
 * @returns {{ group: THREE.Group, materials: object, material: THREE.Material,
 *            update: (dt:number)=>void, dispose: ()=>void }}
 */
export function buildTree(rng, def = {}) {
  const kit = kitOf(def);
  const P = treeProfile(def?.biome ?? 'lush', kit, rng);
  const seed = rng.int(1, 0x7ffffffe);
  const noise = new SimplexNoise(seed);

  const group = new THREE.Group();
  const h = rng.range(P.hMin, P.hMax);
  const segs = 6;
  const spine = trunkSpine(rng, noise, h, P.bend, segs);
  const tip = spine[spine.length - 1];

  // --- trunk (static, group-local absolute) ---
  const trunkGeo = limb(spine, (t) => P.baseR * (1 - P.taper * t) * (1 + 0.55 * Math.exp(-t * 7)), 6,
    { noise, noiseAmp: 0.16, noiseFreq: 1.6, capBottom: true });
  paint(trunkGeo, (c, x, y) => {
    const t = THREE.MathUtils.clamp(y / h, 0, 1);
    c.copy(P.barkB).lerp(P.barkT, t);
    const m = noise.fbm3(x * 3, y * 3, 0, 2);
    c.offsetHSL(m * 0.01, m * 0.04, m * 0.05);
    c.multiplyScalar(0.8 + 0.2 * t);                 // ambient occlusion toward base
  });
  const barkMat = makeMat('bark', { seed: seed ^ 0x1111, color: P.barkT.getHex() });
  const trunkMesh = new THREE.Mesh(trunkGeo, barkMat);
  trunkMesh.castShadow = true; trunkMesh.receiveShadow = true;
  group.add(trunkMesh);

  // --- crown pivot (sways in update) ---
  const pivot = pointAtFrac(spine, P.pivotFrac);
  const crown = new THREE.Group();
  crown.position.copy(pivot);
  group.add(crown);
  const rel = (g) => { g.translate(-pivot.x, -pivot.y, -pivot.z); return g; };

  const foliageMat = makeMat('foliage', { seed: seed ^ 0x2222, color: P.leafA.getHex() });
  const materials = { bark: barkMat, foliage: foliageMat };

  const paintMass = (g, tint) => paint(g, (c, x, y, z, i, nv, bb) => {
    const t = THREE.MathUtils.clamp((y - bb.min.y) / Math.max(bb.max.y - bb.min.y, 1e-4), 0, 1);
    c.copy(tint).lerp(P.topLight, t * 0.5);
    c.multiplyScalar(0.72 + 0.28 * t);               // inner-canopy AO
    const m = noise.fbm3(x * 2.4 + 3, y * 2.4, z * 2.4, 2);
    c.offsetHSL(m * 0.02, m * 0.05, m * 0.04);
    if (P.snow && nv.y > 0.2) c.lerp(col(NAT.snow), THREE.MathUtils.clamp((nv.y - 0.2) * 1.5, 0, 0.85) * (0.4 + 0.6 * t));
  });

  const massGeos = [];          // foliage blobs
  const branchGeos = [];        // bark branches (in crown space)

  if (P.form === 'palm') {
    // crown of arching, drooping fronds keyed by an alpha frond mask
    const variant = rng.int(0, 2);
    const tex = frondTexture(variant);
    const frondMat = bladeMaterial(tex, P.leafA.getHex());
    materials.frond = frondMat;
    const n = 7 + rng.int(0, 3);
    const frondGeos = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.range(-0.15, 0.15);
      const len = rng.range(2.3, 3.4), wid = rng.range(0.7, 1.0);
      let g = blade(len, wid, { segs: 7, arch: 0.5, droop: P.droop + rng.range(-0.05, 0.1), taper: 0.85, noise, seed: i * 3 });
      paintBlade(g, P.leafB, P.leafA, noise, i);
      xf(g, 0, 0, 0, -1.15 + rng.range(-0.1, 0.1), a, 0);  // lean outward
      frondGeos.push(rel(g));
    }
    const frondMesh = new THREE.Mesh(mergeGeos(frondGeos), frondMat);
    frondMesh.castShadow = true;
    crown.add(frondMesh);
  } else if (P.form === 'conifer') {
    // stacked, tapering foliage skirts from low to high
    for (let i = 0; i < P.masses; i++) {
      const t = i / (P.masses - 1);
      const r = P.massR * (1.1 - 0.8 * t);
      const y = h * (0.2 + 0.75 * t);
      const cp = pointAtFrac(spine, 0.2 + 0.75 * t);
      let g = blob(r, 1, noise, seed + i * 7, { amp: 0.26, freq: 1.8, squash: P.squash, warp: 0.5 });
      xf(g, cp.x + rng.range(-0.1, 0.1), y, cp.z + rng.range(-0.1, 0.1), 0, rng.range(0, TAU), 0);
      const tint = mix(P.leafA, P.leafB, rng.range(0, 0.5));
      massGeos.push(rel(paintMass(g, tint)));
    }
  } else if (P.form === 'dead') {
    // mostly bare branches, a few dried tufts
    for (let i = 0; i < 3; i++) {
      const r = P.massR * rng.range(0.6, 1);
      let g = blob(r, 1, noise, seed + i * 5, { amp: 0.3, freq: 2, squash: P.squash });
      const a = rng.range(0, TAU);
      xf(g, Math.cos(a) * P.spread * 0.6, rng.range(0.2, 0.9), Math.sin(a) * P.spread * 0.6);
      massGeos.push(rel(paintMass(g, mix(P.leafA, P.leafB, rng.range(0, 1)))));
    }
  } else {
    // broadleaf / umbrella: clustered leaf-masses (+ a few at branch tips)
    const flat = P.form === 'umbrella';
    for (let i = 0; i < P.masses; i++) {
      const a = rng.range(0, TAU), rad = rng.range(0.2, 1) * P.spread;
      const r = P.massR * rng.range(0.7, 1.15);
      const y = flat ? rng.range(0, 0.5) : rng.range(-0.2, 1.2);
      let g = blob(r, 1, noise, seed + i * 9, { amp: 0.24, freq: 1.6, squash: flat ? P.squash : P.squash * rng.range(0.9, 1.15), warp: 0.4 });
      xf(g, Math.cos(a) * rad, y + (flat ? 0.2 : 0), Math.sin(a) * rad, 0, rng.range(0, TAU), 0);
      massGeos.push(rel(paintMass(g, mix(P.leafA, P.leafB, rng.range(0, 1)))));
    }
  }

  // --- branches (in crown space, from pivot outward) ---
  for (let i = 0; i < P.branches; i++) {
    const a = (i / Math.max(P.branches, 1)) * TAU + rng.range(-0.4, 0.4);
    const el = P.form === 'umbrella' ? rng.range(0.05, 0.35) : rng.range(0.35, 0.95);
    const bl = rng.range(0.9, 1.8) * (P.form === 'dead' ? 1.4 : 1);
    const steps = 3;
    const bp = [new THREE.Vector3(0, -0.05, 0)];
    const cur = new THREE.Vector3(0, -0.05, 0);
    for (let s = 1; s <= steps; s++) {
      const st = bl / steps;
      cur.x += Math.cos(a) * Math.cos(el) * st + rng.range(-0.1, 0.1);
      cur.z += Math.sin(a) * Math.cos(el) * st + rng.range(-0.1, 0.1);
      cur.y += (Math.sin(el) + 0.1 * (s / steps)) * st + rng.range(-0.05, 0.05);
      bp.push(cur.clone());
    }
    const bg = limb(bp, (t) => P.baseR * 0.42 * (1 - 0.85 * t) + 0.02, 4, { noise, noiseAmp: 0.12, noiseFreq: 2 });
    paint(bg, (c, x, y, z) => {
      c.copy(P.barkB).lerp(P.barkT, 0.4);
      const m = noise.fbm3(x * 3, y * 3, z * 3, 2);
      c.offsetHSL(m * 0.01, m * 0.04, m * 0.05);
    });
    branchGeos.push(bg);
    if (P.form === 'broadleaf' && rng.chance(0.6)) {
      const tipP = bp[bp.length - 1];
      const r = P.massR * rng.range(0.5, 0.8);
      let g = blob(r, 1, noise, seed + 100 + i, { amp: 0.24, freq: 1.7, squash: P.squash });
      xf(g, tipP.x, tipP.y + r * 0.4, tipP.z);
      massGeos.push(paintMass(g, mix(P.leafA, P.leafB, rng.range(0, 1))));
    }
  }

  if (branchGeos.length) {
    const bm = new THREE.Mesh(mergeGeos(branchGeos), barkMat);
    bm.castShadow = true; bm.receiveShadow = true;
    crown.add(bm);
  }
  if (massGeos.length) {
    const lm = new THREE.Mesh(mergeGeos(massGeos), foliageMat);
    lm.castShadow = true; lm.receiveShadow = false;
    crown.add(lm);
  }

  // subtle wind sway — pivots the crown around its anchor (cheap, O(1)/frame)
  let tAcc = rng.range(0, TAU);
  const speed = rng.range(0.55, 0.95);
  const amp = (P.form === 'conifer' ? 0.02 : 0.045) * rng.range(0.8, 1.2);
  const update = (dt) => {
    tAcc += dt * speed;
    crown.rotation.z = Math.sin(tAcc) * amp;
    crown.rotation.x = Math.cos(tAcc * 0.8) * amp * 0.7;
  };

  return { group, materials, material: foliageMat, update, dispose: () => disposeGroup(group) };
}

// -------------------------------------------------------------- rock assembly

const ROCK_CLASSES = {
  small: { r: [0.4, 0.8], detail: 1 },
  medium: { r: [0.9, 1.7], detail: 2 },
  large: { r: [1.8, 3.0], detail: 2 },
};

/**
 * Faceted boulder from a multi-octave noise-displaced icosahedron.
 * @param {import('../core/rng.js').RNG} rng
 * @param {object} opts { sizeClass?: 'small'|'medium'|'large', def?, biome? }
 * @returns {{ group: THREE.Group, materials: object, material: THREE.Material, dispose: ()=>void }}
 */
export function buildRock(rng, opts = {}) {
  const biome = opts.biome ?? opts.def?.biome ?? null;
  const kit = kitOf(opts.def ?? {});
  const sizeClass = opts.sizeClass ?? rng.pick(['small', 'medium', 'large']);
  const cls = ROCK_CLASSES[sizeClass] ?? ROCK_CLASSES.medium;
  const r = rng.range(cls.r[0], cls.r[1]);
  const seed = rng.int(1, 0x7ffffffe);
  const noise = new SimplexNoise(seed);

  const geo = new THREE.IcosahedronGeometry(r, cls.detail);
  const p = geo.attributes.position, n = p.count;
  const v = new THREE.Vector3(), d = new THREE.Vector3();
  const squashY = rng.range(0.6, 0.9);              // boulders sit low
  for (let i = 0; i < n; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    d.copy(v).normalize();
    const lo = noise.fbm3(d.x * 1.1 + seed, d.y * 1.1, d.z * 1.1 - seed, 3);   // overall lumps
    const hi = noise.fbm3(d.x * 3.4, d.y * 3.4 + seed, d.z * 3.4, 3);          // facet bumps
    v.multiplyScalar(1 + 0.3 * lo + 0.12 * hi);
    v.y *= squashY;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const minY = geo.boundingBox.min.y;
  geo.translate(0, -minY - r * 0.12, 0);            // seat on ground, slight embed

  // stone palette: neutral base tinted toward the planet cliff colour
  let stoneA = mix(col(0x6f6a62), kit.cliff, 0.45);
  let stoneB = mix(col(0x3c3833), kit.cliff, 0.35);
  let lichen = mix(kit.accent, col(0x6f7f4a), 0.4);
  let lichenAmt = 0.35;
  if (biome === 'frozen') { stoneA = mix(stoneA, col(0xdfe9f2), 0.3); lichen = col(NAT.snow); lichenAmt = 0.6; }
  else if (biome === 'volcanic') { stoneA = mix(col(0x2a2622), kit.cliff, 0.3); stoneB = col(0x161311); lichenAmt = 0; }
  else if (biome === 'desert') { stoneA = mix(stoneA, kit.shore, 0.4); lichenAmt = 0.08; }
  else if (biome === 'lush' || biome === 'swamp' || biome === 'toxic') { lichenAmt = 0.5; }
  else if (biome === 'barren' || biome == null) { lichenAmt = 0.12; }

  paint(geo, (c, x, y, z, i, nv, box) => {
    const t = THREE.MathUtils.clamp((y - box.min.y) / Math.max(box.max.y - box.min.y, 1e-4), 0, 1);
    const m = noise.fbm3(x * 1.8, y * 1.8, z * 1.8, 3);
    c.copy(stoneB).lerp(stoneA, THREE.MathUtils.clamp(0.5 + 0.6 * m, 0, 1));
    c.multiplyScalar(0.7 + 0.3 * t);                 // crevice AO
    if (lichenAmt > 0 && nv.y > 0.35) {
      const lm = noise.fbm3(x * 2.6 + 9, z * 2.6, y * 2.6, 2);
      c.lerp(lichen, THREE.MathUtils.clamp((nv.y - 0.35) * lichenAmt * (0.5 + 0.5 * lm), 0, lichenAmt));
    }
  });

  const rockMat = makeMat('rock', { seed, color: stoneA.getHex() });
  const mesh = new THREE.Mesh(geo, rockMat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.rotation.y = rng.range(0, TAU);
  const group = new THREE.Group();
  group.add(mesh);
  return { group, materials: { rock: rockMat }, material: rockMat, sizeClass, dispose: () => disposeGroup(group) };
}

// ------------------------------------------------------------ shrub assembly

/**
 * Bushy shrub — clustered leaf-masses over a couple of short stems, with a few
 * upright leaf blades for silhouette. Biome-tinted.
 * @param {import('../core/rng.js').RNG} rng
 * @param {object} def { biome, palette }
 */
export function buildShrub(rng, def = {}) {
  const kit = kitOf(def);
  const P = treeProfile(def?.biome ?? 'lush', kit, rng);
  const seed = rng.int(1, 0x7ffffffe);
  const noise = new SimplexNoise(seed);
  const group = new THREE.Group();

  const barkMat = makeMat('bark', { seed: seed ^ 0x33, color: P.barkT.getHex() });
  const foliageMat = makeMat('foliage', { seed: seed ^ 0x44, color: P.leafA.getHex() });
  const materials = { bark: barkMat, foliage: foliageMat };

  // short stems
  const stemGeos = [];
  const nStem = rng.int(2, 3);
  for (let i = 0; i < nStem; i++) {
    const a = rng.range(0, TAU), lean = rng.range(0.1, 0.35), sh = rng.range(0.35, 0.7);
    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.cos(a) * lean * sh, sh * 0.6, Math.sin(a) * lean * sh),
      new THREE.Vector3(Math.cos(a) * lean * sh * 1.6, sh, Math.sin(a) * lean * sh * 1.6),
    ];
    const g = limb(pts, (t) => 0.06 * (1 - 0.7 * t) + 0.015, 4, { noise, noiseAmp: 0.1, capBottom: true });
    paint(g, (c) => c.copy(P.barkB).lerp(P.barkT, 0.3));
    stemGeos.push(g);
  }
  const stemMesh = new THREE.Mesh(mergeGeos(stemGeos), barkMat);
  stemMesh.castShadow = true;
  group.add(stemMesh);

  // clustered leaf-masses
  const massGeos = [];
  const nMass = rng.int(3, 5);
  for (let i = 0; i < nMass; i++) {
    const a = rng.range(0, TAU), rad = rng.range(0, 0.4);
    const r = rng.range(0.35, 0.6);
    let g = blob(r, 1, noise, seed + i * 7, { amp: 0.26, freq: 2.0, squash: 0.85, warp: 0.4 });
    xf(g, Math.cos(a) * rad, rng.range(0.45, 0.85), Math.sin(a) * rad, 0, rng.range(0, TAU), 0);
    massGeos.push(paint(g, (c, x, y, z, i2, nv, bb) => {
      const t = THREE.MathUtils.clamp((y - bb.min.y) / Math.max(bb.max.y - bb.min.y, 1e-4), 0, 1);
      c.copy(mix(P.leafA, P.leafB, rng.range(0, 1))).lerp(P.topLight, t * 0.5);
      c.multiplyScalar(0.72 + 0.28 * t);
      const m = noise.fbm3(x * 3 + 2, y * 3, z * 3, 2);
      c.offsetHSL(m * 0.02, m * 0.05, m * 0.05);
      if (P.snow && nv.y > 0.25) c.lerp(col(NAT.snow), THREE.MathUtils.clamp((nv.y - 0.25) * 1.4, 0, 0.7) * t);
    }));
  }
  const massMesh = new THREE.Mesh(mergeGeos(massGeos), foliageMat);
  massMesh.castShadow = true;
  group.add(massMesh);

  // a few upright leaf blades for silhouette
  const tex = leafTexture(rng.int(0, 1));
  const bladeMat = bladeMaterial(tex, P.leafA.getHex());
  materials.blade = bladeMat;
  const bladeGeos = [];
  const nBlade = rng.int(4, 7);
  for (let i = 0; i < nBlade; i++) {
    const a = rng.range(0, TAU);
    let g = blade(rng.range(0.5, 0.9), rng.range(0.28, 0.42), { segs: 4, arch: 0.4, droop: 0.2, taper: 0.6, noise, seed: i });
    paintBlade(g, P.leafB, P.leafA, noise, i);
    xf(g, Math.cos(a) * rng.range(0.1, 0.5), rng.range(0.2, 0.5), Math.sin(a) * rng.range(0.1, 0.5), rng.range(-0.4, -0.1), a, 0);
    bladeGeos.push(g);
  }
  const bladeMesh = new THREE.Mesh(mergeGeos(bladeGeos), bladeMat);
  bladeMesh.castShadow = true;
  group.add(bladeMesh);

  return { group, materials, material: foliageMat, dispose: () => disposeGroup(group) };
}

// ------------------------------------------------------------- fern assembly

/**
 * Fern — a rosette of arching, drooping fronds masked by a procedural pinnate
 * alpha texture. Biome-tinted.
 * @param {import('../core/rng.js').RNG} rng
 * @param {object} def { biome, palette }
 */
export function buildFern(rng, def = {}) {
  const kit = kitOf(def);
  const P = treeProfile(def?.biome ?? 'lush', kit, rng);
  const seed = rng.int(1, 0x7ffffffe);
  const noise = new SimplexNoise(seed);
  const group = new THREE.Group();

  const variant = rng.int(0, 2);
  const tex = frondTexture(variant);
  const frondMat = bladeMaterial(tex, P.leafA.getHex());

  const frondGeos = [];
  const n = 6 + rng.int(0, 5);
  const leafA = mix(P.leafA, kit.accent, 0.2), leafB = P.leafB;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.range(-0.2, 0.2);
    const inner = rng.chance(0.35);
    const len = rng.range(1.1, 1.9) * (inner ? 0.6 : 1);
    const wid = rng.range(0.34, 0.5) * (inner ? 0.8 : 1);
    const tilt = inner ? rng.range(-0.4, -0.1) : rng.range(0.15, 0.5);   // inner upright, outer splayed
    let g = blade(len, wid, { segs: 7, arch: 0.6, droop: rng.range(0.25, 0.45), taper: 0.88, curl: 0.16, noise, seed: i * 4 });
    paintBlade(g, leafB, leafA, noise, i);
    xf(g, 0, 0, 0, tilt, a, 0);
    frondGeos.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeos(frondGeos), frondMat);
  mesh.castShadow = true; mesh.receiveShadow = false;
  group.add(mesh);

  return { group, materials: { frond: frondMat }, material: frondMat, dispose: () => disposeGroup(group) };
}

/** Dispose module-shared alpha textures (call only on full teardown). */
export function disposeSharedTextures() {
  for (const t of _texCache.values()) t.dispose();
  _texCache.clear();
}
