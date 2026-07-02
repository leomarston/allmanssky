// Procedural fauna assembler: builds a low-poly rounded creature from
// parametric parts (torso, articulated legs, heads, tails, fins, wings,
// tentacles) with seeded per-vertex paint (belly-light / back-dark gradient,
// biome accent stripes or spots). No skeletons — gait is per-limb transform
// animation driven by animate(dt, speed01). Fully deterministic from the seed.
import * as THREE from 'three';
import { RNG, hash32 } from '../core/rng.js';
import { SimplexNoise } from '../core/noise.js';

/* ------------------------------------------------------------------ style */

// Per-biome palette discipline: base hue window, accent hue, glowing-eye odds.
const BIOME_STYLE = {
  lush:       { hue: [0.05, 0.45], sat: [0.35, 0.60], accent: 0.090, glow: 0.10 },
  swamp:      { hue: [0.16, 0.40], sat: [0.25, 0.50], accent: 0.155, glow: 0.22 },
  desert:     { hue: [0.02, 0.11], sat: [0.30, 0.55], accent: 0.990, glow: 0.06 },
  frozen:     { hue: [0.50, 0.68], sat: [0.15, 0.40], accent: 0.530, glow: 0.14 },
  volcanic:   { hue: [0.00, 0.06], sat: [0.25, 0.50], accent: 0.045, glow: 0.32 },
  toxic:      { hue: [0.22, 0.36], sat: [0.40, 0.70], accent: 0.290, glow: 0.36 },
  irradiated: { hue: [0.10, 0.20], sat: [0.35, 0.60], accent: 0.170, glow: 0.30 },
  ocean:      { hue: [0.45, 0.60], sat: [0.35, 0.65], accent: 0.490, glow: 0.16 },
  crystal:    { hue: [0.70, 0.95], sat: [0.35, 0.60], accent: 0.830, glow: 0.50 },
  barren:     { hue: [0.04, 0.12], sat: [0.08, 0.25], accent: 0.070, glow: 0.06 },
  exotic:     { hue: [0.00, 1.00], sat: [0.40, 0.75], accent: 0.780, glow: 0.45 },
};

const BODY_TYPES = ['quadruped', 'hopper', 'hexapod', 'serpent', 'floater', 'flyer'];

const TYPE_WEIGHTS = {
  default:    { quadruped: 3.0, hopper: 2.0, hexapod: 1.8, serpent: 1.4, floater: 0.9, flyer: 2.0 },
  desert:     { hexapod: 3.0, serpent: 2.6, hopper: 2.6 },
  barren:     { hexapod: 3.0, serpent: 2.2 },
  lush:       { quadruped: 3.6, flyer: 2.6 },
  swamp:      { floater: 2.2, serpent: 2.2 },
  frozen:     { quadruped: 3.6, hopper: 2.4 },
  toxic:      { floater: 2.6, hexapod: 2.4 },
  exotic:     { floater: 2.6, serpent: 2.0 },
  crystal:    { hexapod: 2.6, floater: 2.0 },
  ocean:      { floater: 2.4, flyer: 2.8 },
  irradiated: { hexapod: 2.4, serpent: 2.0 },
  volcanic:   { serpent: 2.4, hexapod: 2.2 },
};

// size in metres (overall scale), nominal = characteristic size of the unit build
const TYPE_DIMS = {
  quadruped: { size: [1.0, 4.8], nominal: 1.5, speed: (s) => 1.6 + s * 0.75 },
  hopper:    { size: [0.5, 2.0], nominal: 1.2, speed: (s) => 2.2 + s * 1.0 },
  hexapod:   { size: [0.4, 1.3], nominal: 0.9, speed: (s) => 1.4 + s * 1.2 },
  serpent:   { size: [1.2, 6.0], nominal: 3.2, speed: (s) => 1.0 + s * 0.35 },
  floater:   { size: [1.5, 5.0], nominal: 2.2, speed: (s) => 0.45 + s * 0.14 },
  flyer:     { size: [0.6, 2.5], nominal: 1.6, speed: (s) => 3.2 + s * 1.1 },
};

const DIETS = {
  quadruped: ['grazer', 'browser', 'frugivore', 'predator'],
  hopper:    ['grazer', 'frugivore', 'insectivore'],
  hexapod:   ['insectivore', 'lithovore', 'scavenger'],
  serpent:   ['predator', 'insectivore', 'lithovore'],
  floater:   ['photovore', 'filter-feeder', 'sporivore'],
  flyer:     ['insectivore', 'frugivore', 'predator'],
};

/* ------------------------------------------------------------------ utils */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth01 = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const fract = (v) => v - Math.floor(v);

function hsl(h, s, l) { return new THREE.Color().setHSL(fract(h + 1), clamp01(s), clamp01(l)); }

function pickWeighted(rng, weights) {
  let total = 0;
  for (const k of BODY_TYPES) total += weights[k] || 0;
  let r = rng.next() * total;
  for (const k of BODY_TYPES) { r -= weights[k] || 0; if (r <= 0) return k; }
  return 'quadruped';
}

/* --------------------------------------------------------------- naming */
// Self-contained latin-ish binomial generator (no lore.js coupling).

const SYL_A = ['va', 'tor', 'mi', 'ra', 'ka', 'lu', 'sae', 'no', 'pha', 'dro',
  'gle', 'hu', 'or', 'cra', 'ben', 'qui', 'vel', 'thi', 'mor', 'ael'];
const SYL_B = ['ru', 'li', 'na', 'vo', 'ta', 'ri', 'mo', 'ze', 'lo', 'ga', 'ni', 'du', 'pe', 'xa'];
const END_G = ['us', 'ix', 'or', 'ax', 'is', 'on', 'ura', 'era', 'yx'];
const END_S = ['ensis', 'arum', 'oides', 'ella', 'atus', 'ivora', 'ophis', 'odon', 'ipes'];

function latinName(rng) {
  let genus = rng.pick(SYL_A) + (rng.chance(0.55) ? rng.pick(SYL_B) : '') + rng.pick(END_G);
  genus = genus[0].toUpperCase() + genus.slice(1);
  const species = rng.pick(SYL_A) + rng.pick(END_S);
  return `${genus} ${species}`;
}

/* ------------------------------------------------------------- painting */

/**
 * Bakes vertex colors over the whole assembled creature. Meshes opt in via
 * userData.paint: 'skin' (gradient + pattern), 'accent', 'bone', 'dark',
 * 'wing' (span gradient); 'none' skips (emissive eyes, lures).
 */
function paintCreature(root, style) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && o.userData.paint && o.userData.paint !== 'none') meshes.push(o);
  });

  // gradient frame from skin vertices only
  const v = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (const mesh of meshes) {
    if (mesh.userData.paint !== 'skin') continue;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }
  if (!isFinite(minY)) { minY = 0; maxY = 1; }
  const spanY = Math.max(maxY - minY, 1e-3);

  const { belly, back, accent, bone, dark, noise, mode, patScale } = style;
  const col = new THREE.Color();

  for (const mesh of meshes) {
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const kind = mesh.userData.paint;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (kind === 'skin') {
        const t = smooth01((v.y - minY) / spanY);
        col.copy(belly).lerp(back, t);
        if (mode === 'stripes') {
          const n = noise.noise3D(v.x * 0.6, v.y * 0.8, v.z * patScale);
          if (n > 0.12) col.lerp(accent, 0.62);
        } else if (mode === 'spots') {
          const n = noise.noise3D(v.x * patScale, v.y * patScale, v.z * patScale);
          if (n > 0.40) col.lerp(accent, 0.58);
        }
      } else if (kind === 'accent') {
        col.copy(accent);
      } else if (kind === 'bone') {
        col.copy(bone);
      } else if (kind === 'dark') {
        col.copy(dark);
      } else if (kind === 'wing') {
        const span = mesh.userData.span || 1;
        const t = clamp01(Math.abs(v.x) / span);
        col.copy(back).lerp(accent, Math.pow(t, 1.4) * 0.85);
        const n = noise.noise2D(Math.abs(v.x) * 4.0, v.z * 2.0);
        if (n > 0.35) col.lerp(accent, 0.4);
      }
      // organic micro-variation
      const shade = 1 + 0.10 * noise.noise3D(v.x * 3.3, v.y * 3.3, v.z * 3.3);
      colors[i * 3] = Math.min(col.r * shade, 1);
      colors[i * 3 + 1] = Math.min(col.g * shade, 1);
      colors[i * 3 + 2] = Math.min(col.b * shade, 1);
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
}

/* ----------------------------------------------------------- part helpers */

function addMesh(ctx, geom, parent, { pos, rot, scale, paint = 'skin', mat } = {}) {
  ctx.geoms.push(geom);
  const mesh = new THREE.Mesh(geom, mat || ctx.skinMat);
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.userData.paint = paint;
  parent.add(mesh);
  return mesh;
}

function capsule(r, len, cs = 5, rs = 10) { return new THREE.CapsuleGeometry(r, len, cs, rs); }
function sphere(r, w = 12, h = 9) { return new THREE.SphereGeometry(r, w, h); }
function cone(r, h, s = 8) { return new THREE.ConeGeometry(r, h, s); }

/** Two-segment articulated leg. Returns { hip, knee } pivots. */
function makeLeg(ctx, parent, { x, y, z, upper, lower, r, hipRest = 0.15, kneeRest = -0.32, splay = 0 }) {
  const hip = new THREE.Group();
  hip.position.set(x, y, z);
  hip.rotation.x = hipRest;
  hip.rotation.z = splay;
  parent.add(hip);

  const up = capsule(r, upper);
  up.translate(0, -upper / 2, 0);
  addMesh(ctx, up, hip);

  const knee = new THREE.Group();
  knee.position.set(0, -upper, 0);
  knee.rotation.x = kneeRest;
  hip.add(knee);

  const lo = capsule(r * 0.72, lower);
  lo.translate(0, -lower / 2, 0);
  addMesh(ctx, lo, knee);

  // foot
  addMesh(ctx, sphere(r * 1.05, 8, 6), knee, {
    pos: [0, -lower, r * 0.3], scale: [1.1, 0.55, 1.5], paint: 'dark',
  });
  return { hip, knee, rest: { hip: hipRest, knee: kneeRest, splay } };
}

/** Head on a neck pivot. Variants: beaked | horned | bulbous | antlered. */
function makeHead(ctx, parent, { x = 0, y, z, r, variant, neckLen = 0 }) {
  const neck = new THREE.Group();
  neck.position.set(x, y, z);
  parent.add(neck);

  if (neckLen > 0) {
    const ng = capsule(r * 0.55, neckLen);
    ng.translate(0, neckLen / 2, 0);
    const nm = addMesh(ctx, ng, neck);
    nm.rotation.x = 0.5; // slanted forward
  }
  const head = new THREE.Group();
  head.position.set(0, neckLen * 0.85, neckLen * 0.45 + r * 0.4);
  neck.add(head);

  const isBulb = variant === 'bulbous';
  const skull = addMesh(ctx, sphere(r), head, {
    scale: isBulb ? [1.25, 1.15, 1.2] : [0.9, 0.85, 1.1],
  });

  if (variant === 'beaked') {
    addMesh(ctx, cone(r * 0.42, r * 1.5, 7), head, {
      pos: [0, -r * 0.12, r * 1.2], rot: [Math.PI / 2, 0, 0], paint: 'bone',
    });
  } else if (variant === 'horned') {
    for (const s of [-1, 1]) {
      addMesh(ctx, cone(r * 0.22, r * 1.15, 6), head, {
        pos: [s * r * 0.55, r * 0.72, -r * 0.1], rot: [-0.5, 0, s * 0.55], paint: 'bone',
      });
    }
    addMesh(ctx, sphere(r * 0.5, 8, 6), head, { pos: [0, -r * 0.2, r * 0.85], scale: [0.9, 0.7, 1.1] });
  } else if (variant === 'antlered') {
    for (const s of [-1, 1]) {
      const base = new THREE.Group();
      base.position.set(s * r * 0.45, r * 0.75, -r * 0.05);
      base.rotation.set(-0.35, 0, s * 0.7);
      head.add(base);
      const main = capsule(r * 0.09, r * 1.1);
      main.translate(0, r * 0.55, 0);
      addMesh(ctx, main, base, { paint: 'bone' });
      for (let k = 0; k < 3; k++) {
        const tine = cone(r * 0.07, r * 0.55, 5);
        tine.translate(0, r * 0.27, 0);
        addMesh(ctx, tine, base, {
          pos: [0, r * (0.35 + k * 0.32), 0],
          rot: [(k % 2 ? -0.9 : -0.4), 0, s * (0.9 - k * 0.2)],
          paint: 'bone',
        });
      }
    }
    addMesh(ctx, sphere(r * 0.45, 8, 6), head, { pos: [0, -r * 0.22, r * 0.8], scale: [0.9, 0.7, 1.2] });
  }

  // eyes
  const eyeR = r * (isBulb ? 0.34 : 0.2);
  const mat = ctx.glowEyes ? ctx.glowEyeMat : ctx.eyeMat;
  for (const s of [-1, 1]) {
    addMesh(ctx, sphere(eyeR, 8, 6), head, {
      pos: [s * r * (isBulb ? 0.62 : 0.68), r * 0.22, r * (isBulb ? 0.72 : 0.55)],
      paint: 'none', mat,
    });
  }
  return { neck, head, skull };
}

/** Tapering tail chain of pivots. Returns pivots array (root first). */
function makeTail(ctx, parent, { y, z, r, segLen, segs = 3, droop = 0.28 }) {
  const pivots = [];
  let node = parent, pz = z, py = y, pr = r;
  for (let i = 0; i < segs; i++) {
    const piv = new THREE.Group();
    piv.position.set(0, py, pz);
    piv.rotation.x = -droop;
    node.add(piv);
    const g = capsule(pr, segLen);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, -segLen / 2);
    addMesh(ctx, g, piv);
    pivots.push(piv);
    node = piv; pz = -segLen; py = 0; pr *= 0.62;
  }
  // tail tip tuft
  addMesh(ctx, cone(pr * 1.6, segLen * 0.8, 6), node, {
    pos: [0, 0, -segLen - segLen * 0.2], rot: [-Math.PI / 2, 0, 0], paint: 'accent',
  });
  return pivots;
}

/** Row of dorsal features along the spine. kind: spines | plates | fin. */
function makeBackFeature(ctx, parent, { kind, topY, zFrom, zTo, h, n = 5 }) {
  if (kind === 'none') return;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const z = zFrom + (zTo - zFrom) * t;
    const f = Math.sin(Math.PI * (0.2 + 0.8 * t)); // taller mid-back
    if (kind === 'spines') {
      addMesh(ctx, cone(h * 0.16, h * (0.5 + f * 0.8), 5), parent, {
        pos: [0, topY + h * 0.25 * f, z], rot: [-0.5, 0, 0], paint: 'accent',
      });
    } else if (kind === 'plates') {
      addMesh(ctx, sphere(h * 0.42, 7, 5), parent, {
        pos: [0, topY + h * 0.12 * f, z], scale: [0.35, 0.9 + f * 0.5, 0.7], paint: 'accent',
      });
    } else if (kind === 'fin') {
      addMesh(ctx, sphere(h * 0.5, 7, 5), parent, {
        pos: [0, topY + h * 0.3 * f, z], scale: [0.14, 0.8 + f * 0.9, 1.0], paint: 'accent',
      });
    }
  }
}

/** Stylized wing: scalloped flat shape lying in XZ, root at origin, tip +X. */
function makeWingGeometry(rng, span, chord) {
  const shape = new THREE.Shape();
  shape.moveTo(0, chord * 0.05);
  shape.quadraticCurveTo(span * 0.5, -chord * 0.22, span, chord * 0.28);
  const fingers = 3;
  for (let i = fingers; i >= 1; i--) {
    const x = (span * i) / (fingers + 0.6);
    const y = chord * (0.35 + 0.65 * (1 - i / (fingers + 1)));
    shape.quadraticCurveTo(x + span * 0.06, y * 0.72, x, y);
  }
  shape.quadraticCurveTo(span * 0.08, chord, 0, chord * 0.92);
  shape.lineTo(0, chord * 0.05);
  const geom = new THREE.ShapeGeometry(shape, 5);
  geom.rotateX(-Math.PI / 2); // lie flat: +shape-y becomes -z (trailing edge back)
  return geom;
}

/* ------------------------------------------------------------ body builds */
// Each builder assembles into ctx.body (bobbing group) / ctx.root and returns
// an animate(T, TI, m, dt) closure. Unit space ~1-3m, origin at ground.

function buildQuadruped(ctx) {
  const { rng, body, root } = ctx;
  const barrel = rng.chance(0.55);
  const torsoLen = rng.range(0.9, 1.35);
  const torsoR = barrel ? rng.range(0.28, 0.4) : rng.range(0.17, 0.26);
  const hipY = rng.range(0.55, 0.85);

  const tg = capsule(torsoR, torsoLen, 6, 12);
  tg.rotateX(Math.PI / 2);
  const torso = addMesh(ctx, tg, body, { pos: [0, hipY, 0], scale: [1, barrel ? 1.12 : 1, 1] });

  const legR = Math.min(torsoR * 0.32, 0.09) + 0.02;
  const legs = [];
  const phases = [0, Math.PI, Math.PI, 0]; // trot: FL, FR, BL, BR
  const lx = torsoR * 0.78;
  const lz = torsoLen * 0.42;
  const spots = [[-lx, lz], [lx, lz], [-lx, -lz], [lx, -lz]];
  for (let i = 0; i < 4; i++) {
    legs.push(makeLeg(ctx, root, {
      x: spots[i][0], y: hipY, z: spots[i][1],
      upper: hipY * 0.52, lower: hipY * 0.5, r: legR,
      hipRest: 0.12, kneeRest: -0.3,
    }));
  }

  const headR = torsoR * rng.range(0.75, 1.0);
  const { neck } = makeHead(ctx, body, {
    y: hipY + torsoR * 0.45, z: torsoLen * 0.5, r: headR,
    variant: rng.pick(['beaked', 'horned', 'bulbous', 'antlered']),
    neckLen: rng.range(0.15, 0.45),
  });
  const tail = makeTail(ctx, body, {
    y: hipY + torsoR * 0.1, z: -torsoLen * 0.52, r: torsoR * 0.45,
    segLen: rng.range(0.25, 0.4), segs: 3,
  });
  makeBackFeature(ctx, body, {
    kind: rng.pick(['none', 'spines', 'plates', 'fin', 'none']),
    topY: hipY + torsoR * 0.9, zFrom: torsoLen * 0.4, zTo: -torsoLen * 0.42,
    h: torsoR * 1.2, n: rng.int(4, 6),
  });

  const bodyBase = 0;
  return (T, TI, m, dt) => {
    for (let i = 0; i < 4; i++) {
      const L = legs[i], ph = phases[i];
      const sw = Math.sin(T + ph);
      L.hip.rotation.x = L.rest.hip + sw * 0.52 * m + Math.sin(TI * 1.2 + i * 1.7) * 0.02;
      L.knee.rotation.x = L.rest.knee - Math.max(0, Math.cos(T + ph)) * 0.7 * m;
    }
    body.position.y = bodyBase + Math.abs(Math.sin(T + 0.4)) * 0.045 * m
      + Math.sin(TI * 1.6) * 0.01 * (1 - m);
    torso.scale.x = 1 + 0.03 * Math.sin(TI * 1.7) * (1 - m * 0.6);
    neck.rotation.y = Math.sin(TI * 0.55) * 0.35 * (1 - m * 0.55);
    neck.rotation.x = Math.sin(T * 2) * 0.05 * m + Math.sin(TI * 0.9) * 0.05;
    for (let j = 0; j < tail.length; j++) {
      tail[j].rotation.y = Math.sin(TI * 1.7 + j * 0.7) * 0.14 + Math.sin(T + j) * 0.1 * m;
    }
  };
}

function buildHopper(ctx) {
  const { rng, body, root } = ctx;
  const hipY = rng.range(0.5, 0.75);
  const tr = rng.range(0.22, 0.32);

  const torso = addMesh(ctx, sphere(tr, 12, 10), body, {
    pos: [0, hipY + tr * 0.35, 0], scale: [0.85, 1.2, 1.05], rot: [0.25, 0, 0],
  });

  const legs = [];
  for (const s of [-1, 1]) {
    legs.push(makeLeg(ctx, root, {
      x: s * tr * 0.75, y: hipY, z: -tr * 0.35,
      upper: hipY * 0.72, lower: hipY * 0.7, r: tr * 0.28,
      hipRest: -0.85, kneeRest: 1.5,
    }));
  }
  // small arms
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * tr * 0.72, hipY + tr * 0.55, tr * 0.5);
    arm.rotation.x = -0.9;
    body.add(arm);
    const g = capsule(tr * 0.13, tr * 0.6);
    g.translate(0, -tr * 0.3, 0);
    addMesh(ctx, g, arm);
    arms.push(arm);
  }

  const { neck } = makeHead(ctx, body, {
    y: hipY + tr * 1.25, z: tr * 0.55, r: tr * rng.range(0.6, 0.8),
    variant: rng.pick(['beaked', 'bulbous', 'horned']), neckLen: tr * 0.3,
  });
  const tail = makeTail(ctx, body, {
    y: hipY + tr * 0.1, z: -tr * 0.8, r: tr * 0.4, segLen: rng.range(0.28, 0.4), segs: 3, droop: 0.45,
  });

  return (T, TI, m) => {
    const hop = Math.max(0, Math.sin(T));
    body.position.y = hop * hop * 0.24 * m + Math.sin(TI * 1.5) * 0.012 * (1 - m);
    body.rotation.x = -hop * 0.12 * m;
    for (const L of legs) {
      L.hip.rotation.x = L.rest.hip + Math.sin(T) * 0.55 * m;
      L.knee.rotation.x = L.rest.knee - Math.sin(T) * 0.75 * m;
    }
    for (let i = 0; i < 2; i++) {
      arms[i].rotation.x = -0.9 + Math.sin(T + i * 0.4) * 0.35 * m + Math.sin(TI * 1.3 + i) * 0.06;
    }
    torso.scale.y = 1.2 + 0.035 * Math.sin(TI * 2.0) * (1 - m * 0.5);
    neck.rotation.y = Math.sin(TI * 0.7) * 0.4 * (1 - m * 0.6);
    for (let j = 0; j < tail.length; j++) {
      tail[j].rotation.x = -0.45 + hop * 0.35 * m + Math.sin(TI * 1.9 + j) * 0.06;
    }
  };
}

function buildHexapod(ctx) {
  const { rng, body, root } = ctx;
  const len = rng.range(0.7, 1.05);
  const r = rng.range(0.18, 0.26);
  const bodyY = rng.range(0.3, 0.4);

  const tg = capsule(r, len, 5, 10);
  tg.rotateX(Math.PI / 2);
  addMesh(ctx, tg, body, { pos: [0, bodyY, 0], scale: [1.15, 0.8, 1] });

  if (rng.chance(0.55)) { // shell dome
    const dome = sphere(r * 1.5, 12, 6);
    addMesh(ctx, dome, body, {
      pos: [0, bodyY + r * 0.15, 0], scale: [1.0, 0.62, len / (r * 1.9)], paint: 'accent',
    });
  }

  const legs = [];
  const phases = [0, Math.PI, 0, Math.PI, 0, Math.PI]; // tripod gait
  for (let i = 0; i < 3; i++) {
    for (const s of [-1, 1]) {
      const idx = i * 2 + (s > 0 ? 1 : 0);
      legs.push(makeLeg(ctx, root, {
        x: s * r * 1.0, y: bodyY, z: (i - 1) * len * 0.38,
        upper: bodyY * 0.62, lower: bodyY * 0.72, r: r * 0.16,
        hipRest: 0, kneeRest: -0.55, splay: s * 0.55,
      }));
      legs[legs.length - 1].phase = phases[idx] + i * 0.5;
      legs[legs.length - 1].side = s;
    }
  }

  const { neck, head } = makeHead(ctx, body, {
    y: bodyY + r * 0.25, z: len * 0.52, r: r * 0.75,
    variant: rng.pick(['bulbous', 'horned', 'beaked']), neckLen: 0.05,
  });
  // antennae
  for (const s of [-1, 1]) {
    addMesh(ctx, cone(r * 0.06, r * 1.4, 4), head, {
      pos: [s * r * 0.3, r * 0.6, r * 0.4], rot: [0.7, 0, s * 0.4], paint: 'accent',
    });
  }
  const tail = makeTail(ctx, body, {
    y: bodyY, z: -len * 0.5, r: r * 0.5, segLen: 0.22, segs: 2, droop: 0.15,
  });

  return (T, TI, m) => {
    const Tf = T * 1.7; // skittery
    for (const L of legs) {
      L.hip.rotation.x = Math.sin(Tf + L.phase) * 0.45 * m;
      L.hip.rotation.z = L.rest.splay + Math.max(0, Math.cos(Tf + L.phase)) * 0.3 * m * L.side
        + Math.sin(TI * 1.4 + L.phase) * 0.02;
      L.knee.rotation.x = L.rest.knee - Math.max(0, Math.cos(Tf + L.phase)) * 0.4 * m;
    }
    body.position.y = Math.abs(Math.sin(Tf)) * 0.02 * m + Math.sin(TI * 2.2) * 0.008;
    neck.rotation.y = Math.sin(TI * 0.9) * 0.3 * (1 - m * 0.5);
    for (let j = 0; j < tail.length; j++) {
      tail[j].rotation.y = Math.sin(TI * 2.4 + j) * 0.1 + Math.sin(Tf * 0.5 + j) * 0.12 * m;
    }
  };
}

function buildSerpent(ctx) {
  const { rng, body } = ctx;
  const n = rng.int(9, 13);
  const rBase = rng.range(0.15, 0.24);
  const spacing = rBase * 1.45;
  const spined = rng.chance(0.5);

  const segs = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const ri = rBase * (0.7 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.9)) - t * 0.28);
    const wrap = new THREE.Group();
    wrap.position.set(0, Math.max(ri, rBase * 0.2), -i * spacing);
    body.add(wrap);
    addMesh(ctx, sphere(Math.max(ri, rBase * 0.18), 10, 8), wrap, { scale: [1, 0.95, 1.25] });
    if (spined && i > 0 && i < n - 2 && i % 2 === 0) {
      addMesh(ctx, cone(ri * 0.28, ri * 1.1, 5), wrap, {
        pos: [0, ri * 0.85, 0], rot: [-0.5, 0, 0], paint: 'accent',
      });
    }
    segs.push({ wrap, baseY: wrap.position.y, i });
  }

  // head features on segment 0
  const headWrap = segs[0].wrap;
  const hr = rBase * 1.05;
  const { neck } = makeHead(ctx, headWrap, {
    y: hr * 0.35, z: spacing * 0.55, r: hr,
    variant: rng.pick(['horned', 'bulbous', 'beaked']), neckLen: 0,
  });

  return (T, TI, m, dt) => {
    const TT = T * 0.55 + TI * 0.35;
    const sway = 0.28 + 0.72 * m;
    for (const s of segs) {
      const amp = rBase * (0.55 + s.i * 0.14) * sway;
      s.wrap.position.x = Math.sin(TT * 2.1 - s.i * 0.62) * amp;
      s.wrap.rotation.y = Math.cos(TT * 2.1 - s.i * 0.62) * 0.4 * sway;
      s.wrap.position.y = s.baseY + Math.max(0, Math.sin(TT * 1.3 - s.i * 0.5)) * rBase * 0.08 * sway;
    }
    neck.rotation.y = Math.sin(TI * 0.6) * 0.3 * (1 - m * 0.4);
    neck.rotation.x = Math.sin(TI * 1.1) * 0.08;
  };
}

function buildFloater(ctx) {
  const { rng, body } = ctx;
  const R = rng.range(0.36, 0.55);
  const tentLen = rng.range(0.7, 1.15);
  const nT = rng.int(3, 6);
  const bagY = tentLen + R * 0.85;

  const bag = addMesh(ctx, sphere(R, 14, 11), body, { pos: [0, bagY, 0], scale: [1, 0.82, 1] });
  addMesh(ctx, sphere(R * 0.5, 10, 7), body, { // crown
    pos: [0, bagY + R * 0.68, 0], scale: [1, 0.5, 1], paint: 'accent',
  });
  // skirt ring under the bag
  addMesh(ctx, sphere(R * 0.92, 14, 7), body, {
    pos: [0, bagY - R * 0.42, 0], scale: [1, 0.35, 1], paint: 'accent',
  });

  const tentacles = [];
  const jl = tentLen / 4;
  for (let k = 0; k < nT; k++) {
    const a = (k / nT) * Math.PI * 2 + rng.range(0, 0.4);
    let node = body;
    let px = Math.cos(a) * R * 0.5, pz = Math.sin(a) * R * 0.5, py = bagY - R * 0.55;
    const joints = [];
    let jr = R * 0.1;
    for (let j = 0; j < 4; j++) {
      const piv = new THREE.Group();
      piv.position.set(px, py, pz);
      node.add(piv);
      const g = capsule(jr, jl);
      g.translate(0, -jl / 2, 0);
      addMesh(ctx, g, piv);
      joints.push(piv);
      node = piv; px = 0; pz = 0; py = -jl; jr *= 0.78;
    }
    // glowing lure on some tips
    if (rng.chance(0.5)) {
      addMesh(ctx, sphere(jr * 2.6, 8, 6), node, {
        pos: [0, -jl - jr * 1.4, 0], paint: 'none', mat: ctx.lureMat,
      });
    }
    tentacles.push({ joints, phase: a * 2.3 });
  }

  // dim glow eyes on the bag front
  for (const s of [-1, 1]) {
    addMesh(ctx, sphere(R * 0.12, 8, 6), body, {
      pos: [s * R * 0.4, bagY - R * 0.1, R * 0.85], paint: 'none', mat: ctx.glowEyeMat,
    });
  }

  return (T, TI, m) => {
    body.position.y = Math.sin(TI * 0.85) * 0.1 + Math.sin(TI * 0.31) * 0.05;
    body.rotation.z = Math.sin(TI * 0.5) * 0.06;
    body.rotation.x = Math.cos(TI * 0.42) * 0.05;
    const pulse = 1 + 0.05 * Math.sin(TI * 1.15);
    bag.scale.set(pulse, 0.82 * (2 - pulse), pulse);
    for (const t of tentacles) {
      for (let j = 0; j < t.joints.length; j++) {
        t.joints[j].rotation.x = Math.sin(TI * 0.9 + j * 0.85 + t.phase) * (0.1 + m * 0.12);
        t.joints[j].rotation.z = Math.cos(TI * 0.75 + j * 0.7 + t.phase) * (0.09 + m * 0.1);
      }
    }
  };
}

function buildFlyer(ctx) {
  const { rng, body } = ctx;
  const bodyR = rng.range(0.12, 0.19);
  const bodyLen = rng.range(0.5, 0.75);
  const span = rng.range(0.7, 1.15);
  const restY = bodyR * 2.2;

  const tg = capsule(bodyR, bodyLen, 5, 10);
  tg.rotateX(Math.PI / 2);
  addMesh(ctx, tg, body, { pos: [0, restY, 0], scale: [1, 1.05, 1] });

  const chord = bodyLen * rng.range(0.55, 0.75);
  const wingGeom = makeWingGeometry(rng, span, chord);
  const wings = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(s * bodyR * 0.55, restY + bodyR * 0.5, bodyLen * 0.12);
    body.add(piv);
    const wm = addMesh(ctx, s > 0 ? wingGeom : wingGeom.clone(), piv, {
      paint: 'wing', mat: ctx.wingMat,
    });
    if (s < 0) { wm.scale.x = -1; ctx.geoms.push(wm.geometry); }
    wm.userData.span = span;
    wings.push({ piv, s });
  }

  // tail fan
  const fan = makeWingGeometry(rng, bodyLen * 0.45, bodyLen * 0.3);
  const fanM = addMesh(ctx, fan, body, {
    pos: [0, restY, -bodyLen * 0.52], rot: [0, Math.PI / 2, 0], paint: 'wing', mat: ctx.wingMat,
  });
  fanM.userData.span = bodyLen * 0.45;

  const { neck } = makeHead(ctx, body, {
    y: restY + bodyR * 0.35, z: bodyLen * 0.5, r: bodyR * rng.range(0.85, 1.1),
    variant: rng.pick(['beaked', 'beaked', 'horned', 'bulbous']), neckLen: bodyR * 0.4,
  });

  // tucked legs
  for (const s of [-1, 1]) {
    const g = capsule(bodyR * 0.16, restY * 0.7);
    g.translate(0, -restY * 0.35, 0);
    addMesh(ctx, g, body, { pos: [s * bodyR * 0.5, restY - bodyR * 0.4, -bodyLen * 0.1], rot: [0.25, 0, 0] });
  }

  return (T, TI, m) => {
    const fold = 1 - m;
    const flap = Math.sin(T * 2.6) * (0.15 + 0.75 * m);
    for (const w of wings) {
      w.piv.rotation.z = w.s * -(flap + fold * 1.05 - 0.1);
      w.piv.rotation.y = w.s * Math.cos(T * 2.6) * 0.12 * m;
    }
    body.position.y = Math.max(0, -Math.sin(T * 2.6)) * 0.05 * m + Math.sin(TI * 1.4) * 0.008 * fold;
    body.rotation.x = Math.sin(T * 1.3) * 0.05 * m;
    fanM.rotation.z = Math.sin(TI * 0.9) * 0.15;
    neck.rotation.y = Math.sin(TI * 0.8) * 0.45 * fold;
    neck.rotation.x = -0.1 * m + Math.sin(TI * 1.2) * 0.06 * fold;
  };
}

const BUILDERS = {
  quadruped: buildQuadruped,
  hopper: buildHopper,
  hexapod: buildHexapod,
  serpent: buildSerpent,
  floater: buildFloater,
  flyer: buildFlyer,
};

/* ---------------------------------------------------------------- export */

/**
 * Build a procedural creature.
 *
 * @param {number} seed integer seed — same seed + biome always yields the same beast
 * @param {string} biome biome id ('lush', 'desert', ... per src/universe/biomes.js)
 * @param {{forceType?: string, forceSize?: number}} [opts] optional overrides
 *   (debug/test pages forcing a body type or size in metres)
 * @returns {{
 *   group: THREE.Group,
 *   animate: (dt: number, speed01: number) => void,
 *   profile: { size: number, speed: number,
 *              temperament: 'docile'|'skittish'|'territorial',
 *              diet: string, name: string, bodyType: string },
 *   dispose: () => void
 * }} group origin sits at the creature's ground-contact point, facing +Z.
 */
export function buildCreature(seed, biome, opts = {}) {
  const rng = new RNG(hash32(seed | 0, 0xfa07a));
  const style = BIOME_STYLE[biome] || BIOME_STYLE.lush;
  const noise = new SimplexNoise(hash32(seed | 0, 0xc0107));

  const weights = { ...TYPE_WEIGHTS.default, ...(TYPE_WEIGHTS[biome] || {}) };
  const bodyType = opts.forceType && BUILDERS[opts.forceType]
    ? opts.forceType : pickWeighted(rng, weights);
  const dims = TYPE_DIMS[bodyType];

  // ---- palette --------------------------------------------------------
  const baseHue = rng.range(style.hue[0], style.hue[1]);
  const sat = rng.range(style.sat[0], style.sat[1]);
  const light = rng.range(0.4, 0.52);
  const belly = hsl(baseHue + 0.025, sat * 0.7, light + 0.22);
  const back = hsl(baseHue, sat, light - 0.14);
  const accentHue = style.accent + rng.range(-0.03, 0.03);
  const accent = hsl(accentHue, Math.min(sat + 0.25, 0.8), 0.5);
  const bone = hsl(baseHue, 0.12, 0.8);
  const dark = hsl(baseHue, sat * 0.6, 0.16);
  const glowEyes = bodyType === 'floater' || rng.chance(style.glow);

  // ---- materials ------------------------------------------------------
  const skinMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.82, metalness: 0.02,
  });
  const wingMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
  });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.25 });
  const glowColor = hsl(accentHue, 0.85, 0.6);
  const glowEyeMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: glowColor, emissiveIntensity: 2.4, roughness: 0.4,
  });
  const lureMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: glowColor, emissiveIntensity: 3.2, roughness: 0.4,
  });

  // ---- assemble -------------------------------------------------------
  const group = new THREE.Group();
  const body = new THREE.Group(); // bobbing sub-root: torso/head/tail ride it
  group.add(body);

  const ctx = {
    rng, noise, root: group, body, geoms: [], skinMat, wingMat, eyeMat,
    glowEyeMat, lureMat, glowEyes,
  };
  const animateBody = BUILDERS[bodyType](ctx);

  paintCreature(group, {
    belly, back, accent, bone, dark, noise,
    mode: rng.pick(['none', 'stripes', 'spots', 'stripes', 'spots']),
    patScale: bodyType === 'serpent' ? 2.6 : rng.range(1.8, 3.2),
  });

  group.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  // ---- profile + scale ------------------------------------------------
  const size = opts.forceSize
    ? THREE.MathUtils.clamp(opts.forceSize, 0.4, 6)
    : rng.range(dims.size[0], dims.size[1]);
  group.scale.setScalar(size / dims.nominal);

  const diet = rng.pick(DIETS[bodyType]);
  let temperament;
  const tRoll = rng.next();
  if (diet === 'predator') temperament = tRoll < 0.6 ? 'territorial' : 'docile';
  else if (size < 1.2) temperament = tRoll < 0.6 ? 'skittish' : 'docile';
  else temperament = tRoll < 0.5 ? 'docile' : (tRoll < 0.8 ? 'skittish' : 'territorial');

  const profile = {
    size,
    speed: dims.speed(size),
    temperament,
    diet,
    name: latinName(rng.fork('name')),
    bodyType,
  };

  // ---- animation ------------------------------------------------------
  let T = 0;  // gait clock (advances with speed01)
  let TI = rng.range(0, 20); // idle clock (always advances; desynced per beast)
  const gaitRate = THREE.MathUtils.clamp(7.5 / Math.sqrt(size), 2.8, 11);
  let sm = 0; // smoothed speed01

  function animate(dt, speed01) {
    dt = Math.min(dt || 0, 0.1);
    sm += (clamp01(speed01) - sm) * Math.min(1, 6 * dt);
    const m = smooth01(sm);
    T += dt * gaitRate * (0.1 + 0.9 * sm);
    TI += dt;
    animateBody(T, TI, m, dt);
  }

  function dispose() {
    for (const g of ctx.geoms) g.dispose();
    skinMat.dispose(); wingMat.dispose(); eyeMat.dispose();
    glowEyeMat.dispose(); lureMat.dispose();
    group.removeFromParent();
  }

  return { group, animate, profile, dispose };
}
