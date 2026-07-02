// Nebula field: 3–6 clusters of large additive billboard sprites scattered
// around the far shell. Each sprite's texture is a domain-warped fbm cloud
// (SimplexNoise-stamped alpha, radially faded) baked in a seeded two-tone
// palette; layered scales/opacities/HDR core tints make the clusters read as
// glowing volumetric gas rather than flat blobs. Deterministic from the seed.
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';
import { SimplexNoise } from '../core/noise.js';

const SHELL_MIN = 4.4e5;
const SHELL_MAX = 6.2e5;

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth01(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

// saturated two-tone hue pairs (core → edge), linear-ish 0..1 rgb
const PALETTES = [
  { a: [0.35, 1.0, 0.95], b: [0.85, 0.22, 0.72] }, // teal → magenta
  { a: [0.72, 0.52, 1.0], b: [1.0, 0.44, 0.20] },  // violet → ember
  { a: [0.45, 0.76, 1.0], b: [0.3, 0.4, 1.0] },    // ice → deep blue
  { a: [1.0, 0.48, 0.9], b: [1.0, 0.66, 0.28] },   // magenta → amber
  { a: [0.4, 1.0, 0.68], b: [0.5, 0.34, 1.0] },    // mint → violet
  { a: [1.0, 0.62, 0.32], b: [0.75, 0.25, 0.5] },  // ember → wine
];

/**
 * Bake a radially-faded, domain-warped fbm cloud into a canvas texture,
 * colored core→edge between two palette colors with core whitening.
 */
function bakeNebulaTexture(noise, rng, colCore, colEdge, size, opts = {}) {
  const S = size;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const px = img.data;

  const ox = rng.range(-64, 64), oy = rng.range(-64, 64);
  const freq = opts.freq ?? rng.range(0.9, 1.5);
  const warp = rng.range(1.0, 1.8);
  const bias = opts.bias ?? rng.range(0.34, 0.48);
  const gamma = opts.gamma ?? rng.range(1.3, 1.9);
  const coreBoost = opts.coreBoost ?? 1.0;

  for (let y = 0; y < S; y++) {
    const ny = (y / (S - 1)) * 2 - 1;
    for (let x = 0; x < S; x++) {
      const nx = (x / (S - 1)) * 2 - 1;
      const r = Math.hypot(nx, ny);
      const t = clamp01((1 - r) / 0.95);
      const radial = t * t * (3 - 2 * t);
      const coreGlow = Math.exp(-r * r * 3.2) * coreBoost;

      let a = 0, mixK = 0, dens = 0;
      if (radial > 0.002) {
        const raw = noise.warped2(nx * freq + ox, ny * freq + oy, warp, 4) * 0.5 + 0.5;
        // broad blob mass keeps the cloud coherent; warped detail rides on top
        const rawLow = noise.fbm2(nx * freq * 0.55 - ox, ny * freq * 0.55 + oy, 3) * 0.5 + 0.5;
        const blob = smooth01((rawLow - 0.3) / 0.55);
        let d0 = smooth01((raw - bias) / 0.5);
        d0 = Math.pow(d0, 0.85 * gamma / 1.6); // lift the mid-tones
        d0 *= 0.55 + 0.45 * blob;
        // gentle filament shading (never carves hard holes)
        const fil = 1 - Math.abs(noise.fbm2(nx * freq * 2.4 + oy, ny * freq * 2.4 - ox, 3));
        dens = d0 * (0.85 + 0.15 * fil);
        a = clamp01(dens * (1.1 + 0.4 * coreGlow)) * radial;
        mixK = clamp01(d0 * (0.4 + 0.9 * coreGlow));
      }

      const wK = clamp01(dens * coreGlow * 1.6 - 0.18) * 0.5; // dense-core whitening
      let cr = lerp(colEdge[0], colCore[0], mixK);
      let cg = lerp(colEdge[1], colCore[1], mixK);
      let cb = lerp(colEdge[2], colCore[2], mixK);
      cr = lerp(cr, 1, wK); cg = lerp(cg, 1, wK); cb = lerp(cb, 1, wK);

      const bright = (0.95 + 0.55 * coreGlow) * (0.55 + 0.45 * Math.pow(dens, 0.7));
      const i = (y * S + x) * 4;
      px[i] = Math.min(255, cr * bright * 255);
      px[i + 1] = Math.min(255, cg * bright * 255);
      px[i + 2] = Math.min(255, cb * bright * 255);
      px[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // soften: replace the canvas with a slightly blurred copy of itself
  ctx.filter = `blur(${Math.max(2, S / 96)}px)`;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Small radial glint with cross diffraction spikes for embedded young stars. */
function bakeGlintTexture() {
  const S = 128, c = S / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'lighter';
  for (const ang of [0, Math.PI / 2]) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(ang);
    ctx.scale(1, 0.055);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.95);
    sg.addColorStop(0, 'rgba(255,255,255,0.9)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, c * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSpriteMaterial(tex, opacity, r, g, b, rotation) {
  const mat = new THREE.SpriteMaterial({
    map: tex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity,
    rotation,
  });
  mat.color.setRGB(r, g, b);
  return mat;
}

/* ---------------------------------------------------------------- exports */

/**
 * Clustered glowing nebulae on the far shell: additive billboard sprites with
 * procedural noise textures, HDR-tinted cores, embedded star glints, and slow
 * rotation drift. Deterministic from `seed`.
 * @param {number} seed integer world seed
 * @returns {{ object3d: THREE.Group, update: (dt: number) => void, dispose: () => void }}
 */
export function createNebulaField(seed) {
  const rng = new RNG(hash32(seed, hashString('nebula')));
  const group = new THREE.Group();
  group.name = 'nebulaField';

  /** @type {{mat: THREE.SpriteMaterial, speed: number}[]} */
  const spinners = [];
  /** @type {{mat: THREE.SpriteMaterial, base: number, phase: number, speed: number}[]} */
  const pulsers = [];
  const disposables = [];

  const glintTex = bakeGlintTexture();
  disposables.push(glintTex);

  const clusterCount = rng.int(3, 6);
  const palStart = rng.int(0, PALETTES.length - 1);

  for (let c = 0; c < clusterCount; c++) {
    const crng = rng.fork('cluster' + c);
    const cnoise = new SimplexNoise(hash32(seed, 7700 + c));
    const pal = PALETTES[(palStart + c) % PALETTES.length];

    // three cloud shapes (varied hue emphasis/frequency) + a bright-core shape
    const palMid = [
      lerp(pal.a[0], pal.b[0], 0.5), lerp(pal.a[1], pal.b[1], 0.5), lerp(pal.a[2], pal.b[2], 0.5),
    ];
    const texA = bakeNebulaTexture(cnoise, crng, pal.a, pal.b, 256, { freq: crng.range(0.7, 1.05) });
    const texB = bakeNebulaTexture(cnoise, crng, pal.b, pal.a, 256, { freq: crng.range(1.0, 1.4) });
    const texC = bakeNebulaTexture(cnoise, crng, palMid, pal.b, 256, { freq: crng.range(0.8, 1.2) });
    const clouds = [texA, texB, texC];
    const texCore = bakeNebulaTexture(cnoise, crng,
      [lerp(pal.a[0], 1, 0.45), lerp(pal.a[1], 1, 0.45), lerp(pal.a[2], 1, 0.45)],
      pal.a, 128, { bias: 0.3, gamma: 1.25, coreBoost: 1.7, freq: 2.0 });
    disposables.push(texA, texB, texC, texCore);

    // spread clusters in azimuth with jitter; mid latitudes for visibility
    const azim = (c / clusterCount) * Math.PI * 2 + crng.range(-0.45, 0.45);
    const yv = crng.range(-0.55, 0.55);
    const hr = Math.sqrt(Math.max(0, 1 - yv * yv));
    const dist = crng.range(SHELL_MIN, SHELL_MAX);

    const cluster = new THREE.Group();
    cluster.name = 'nebulaCluster' + c;
    cluster.userData.isCluster = true;
    cluster.position.set(hr * Math.cos(azim) * dist, yv * dist, hr * Math.sin(azim) * dist);

    const size = crng.range(1.1e5, 1.8e5);
    const ax = crng.range(0.7, 1.4), ay = crng.range(0.45, 1.0), azf = crng.range(0.7, 1.4);
    // heart of the cluster (bright cores + glints huddle here)
    const hx = crng.gaussian(0, 0.14) * size;
    const hy = crng.gaussian(0, 0.1) * size;
    const hz = crng.gaussian(0, 0.14) * size;

    const addSprite = (tex, scale, opacity, cr, cg, cb, spreadK, nearHeart) => {
      const mat = makeSpriteMaterial(tex, opacity, cr, cg, cb, crng.range(0, Math.PI * 2));
      const spr = new THREE.Sprite(mat);
      const bx = nearHeart ? hx : 0, by = nearHeart ? hy : 0, bz = nearHeart ? hz : 0;
      spr.position.set(
        bx + crng.gaussian(0, spreadK) * size * ax,
        by + crng.gaussian(0, spreadK * 0.85) * size * ay,
        bz + crng.gaussian(0, spreadK) * size * azf
      );
      // non-uniform stretch disguises texture reuse between sprites
      spr.scale.set(scale, scale * crng.range(0.65, 1.0), 1);
      spr.renderOrder = -999;
      spr.frustumCulled = false;
      cluster.add(spr);
      spinners.push({ mat, speed: crng.range(-0.016, 0.016) });
      return spr;
    };

    const nBig = crng.int(3, 5);
    const nMid = crng.int(5, 9);
    const nCore = crng.int(2, 4);

    // broad envelope, saturated toward the edge hue
    for (let i = 0; i < nBig; i++) {
      const mixT = crng.range(0.55, 0.9);
      addSprite(crng.pick(clouds), size * crng.range(1.8, 2.6),
        crng.range(0.12, 0.2),
        lerp(1, pal.b[0] * 1.1, mixT), lerp(1, pal.b[1] * 1.1, mixT), lerp(1, pal.b[2] * 1.1, mixT),
        0.32, false);
    }
    // structured mid layer, tinted toward either pole of the palette
    for (let i = 0; i < nMid; i++) {
      const toward = crng.chance(0.5) ? pal.a : pal.b;
      const mixT = crng.range(0.45, 0.9);
      addSprite(crng.pick(clouds), size * crng.range(0.8, 1.5),
        crng.range(0.22, 0.38),
        lerp(1, toward[0] * 1.15, mixT), lerp(1, toward[1] * 1.15, mixT), lerp(1, toward[2] * 1.15, mixT),
        0.26, false);
    }
    // bright HDR cores
    for (let i = 0; i < nCore; i++) {
      const h = crng.range(1.1, 1.6); // HDR multiplier → feeds bloom gently
      addSprite(texCore, size * crng.range(0.55, 0.95), crng.range(0.32, 0.5),
        lerp(pal.a[0], 1, 0.3) * h, lerp(pal.a[1], 1, 0.3) * h, lerp(pal.a[2], 1, 0.3) * h,
        0.14, true);
    }
    // embedded newborn-star glints
    const nGlint = crng.int(2, 4);
    for (let i = 0; i < nGlint; i++) {
      const h = crng.range(2.0, 3.2);
      const mat = makeSpriteMaterial(glintTex, crng.range(0.6, 0.9),
        lerp(pal.a[0], 1, 0.6) * h, lerp(pal.a[1], 1, 0.6) * h, lerp(pal.a[2], 1, 0.6) * h,
        crng.range(0, Math.PI * 2));
      const spr = new THREE.Sprite(mat);
      spr.position.set(
        hx + crng.gaussian(0, 0.1) * size * ax,
        hy + crng.gaussian(0, 0.08) * size * ay,
        hz + crng.gaussian(0, 0.1) * size * azf
      );
      spr.scale.setScalar(size * crng.range(0.04, 0.09));
      spr.renderOrder = -997;
      spr.frustumCulled = false;
      cluster.add(spr);
      pulsers.push({ mat, base: mat.opacity, phase: crng.range(0, Math.PI * 2), speed: crng.range(0.4, 1.1) });
    }

    group.add(cluster);
  }

  let time = 0;

  /**
   * Drift the cloud sprites' billboard rotation and pulse the star glints.
   * @param {number} dt seconds
   */
  function update(dt) {
    time += dt;
    for (const s of spinners) s.mat.rotation += s.speed * dt;
    for (const p of pulsers) p.mat.opacity = p.base * (0.82 + 0.18 * Math.sin(time * p.speed + p.phase));
  }

  /** Free GPU resources owned by the nebula field. */
  function dispose() {
    group.traverse((o) => { if (o.isSprite) o.material.dispose(); });
    for (const t of disposables) t.dispose();
  }

  return { object3d: group, update, dispose };
}
