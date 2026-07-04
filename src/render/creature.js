// Procedural fauna assembler: builds a rounded, articulated creature from
// parametric parts (multi-segment torso, jointed legs with thigh/knee/foot,
// snouted heads with hinged jaws, tapered tails, fins, wings, tentacles) with
// seeded per-vertex paint (belly-light / back-dark countershading + biome
// pattern) and optional biome-driven bioluminescent markings + glowing eyes
// that feed bloom. No skeletons — gait is per-limb transform animation driven
// by animate(dt, speed01). Fully deterministic from the seed.
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
 * userData.paint: 'skin' (gradient + pattern), 'accent' (mottled), 'bone',
 * 'dark', 'wing' (span gradient); 'none' skips (emissive eyes, lures, marks).
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

  const { belly, back, accent, accent2, bone, dark, noise, mode, patScale, countershade } = style;
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
        col.copy(belly).lerp(back, Math.pow(t, countershade));
        paintPattern(col, v, mode, accent, accent2, noise, patScale);
      } else if (kind === 'accent') {
        col.copy(accent);
        const n = noise.noise3D(v.x * 2.4, v.y * 2.4, v.z * 2.4);
        if (n > 0.28) col.lerp(accent2, 0.4);
      } else if (kind === 'bone') {
        col.copy(bone);
      } else if (kind === 'dark') {
        col.copy(dark);
      } else if (kind === 'wing') {
        const span = mesh.userData.span || 1;
        const t = clamp01(Math.abs(v.x) / span);
        col.copy(back).lerp(accent, Math.pow(t, 1.4) * 0.85);
        const n = noise.noise2D(Math.abs(v.x) * 4.0, v.z * 2.0);  // membrane veins
        if (n > 0.35) col.lerp(accent2, 0.45);
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

/** Two-tone skin patterning driven by seeded noise. Mutates `col` in place. */
function paintPattern(col, v, mode, accent, accent2, noise, patScale) {
  if (mode === 'stripes') {
    const warp = noise.noise3D(v.x * 0.5, v.y * 0.6, v.z * 0.3) * 0.8;
    const s = Math.sin((v.z + warp) * patScale * 2.1);
    if (s > 0.35) col.lerp(accent, 0.6);
    else if (s < -0.6) col.lerp(accent2, 0.3);
  } else if (mode === 'spots') {
    const n = noise.noise3D(v.x * patScale, v.y * patScale, v.z * patScale);
    if (n > 0.42) col.lerp(accent, 0.6);
  } else if (mode === 'rosettes') {
    const n = noise.noise3D(v.x * patScale * 0.8, v.y * patScale * 0.8, v.z * patScale * 0.8);
    const a = Math.abs(n);
    if (a > 0.55) col.lerp(accent, 0.55);         // filled center
    else if (a > 0.38) col.lerp(accent2, 0.4);    // ring
  } else if (mode === 'patches') {
    const n = noise.fbm3(v.x * patScale * 0.4, v.y * patScale * 0.4, v.z * patScale * 0.4, 3);
    if (n > 0.14) col.lerp(accent, smooth01((n - 0.14) * 3) * 0.6);
    else if (n < -0.2) col.lerp(accent2, 0.28);
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
function sphere(r, w = 12, h = 10) { return new THREE.SphereGeometry(r, w, h); }
function cone(r, h, s = 8) { return new THREE.ConeGeometry(r, h, s); }

/**
 * Scale a geometry's cross-section (x,y) along its own z extent by profile(t),
 * t∈[0,1] back→front. Turns a capsule into a shaped body/snout. Cheap, one-off.
 */
function taperZ(geom, profile) {
  const pos = geom.attributes.position;
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i); if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const span = Math.max(zmax - zmin, 1e-4);
  for (let i = 0; i < pos.count; i++) {
    const s = profile((pos.getZ(i) - zmin) / span);
    pos.setX(i, pos.getX(i) * s);
    pos.setY(i, pos.getY(i) * s);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

/**
 * Row of small emissive nodes along a segment (biome bioluminescence). No-op
 * unless ctx.biolum. Emissive > 1 so it feeds bloom.
 */
function makeGlowMarks(ctx, parent, { from, to, n, r }) {
  if (!ctx.biolum) return;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    addMesh(ctx, sphere(r, 6, 5), parent, {
      pos: [from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t],
      paint: 'none', mat: ctx.markMat,
    });
  }
}

/** Two-segment articulated leg: thigh muscle + upper/lower bones + jointed foot. */
function makeLeg(ctx, parent, { x, y, z, upper, lower, r, hipRest = 0.15, kneeRest = -0.32, splay = 0, toes = 0 }) {
  const hip = new THREE.Group();
  hip.position.set(x, y, z);
  hip.rotation.x = hipRest;
  hip.rotation.z = splay;
  parent.add(hip);

  // thigh muscle bulge
  addMesh(ctx, sphere(r * 1.7, 8, 6), hip, { pos: [0, -upper * 0.28, 0], scale: [1.0, 1.3, 1.1] });
  const up = capsule(r, upper);
  up.translate(0, -upper / 2, 0);
  addMesh(ctx, up, hip);

  const knee = new THREE.Group();
  knee.position.set(0, -upper, 0);
  knee.rotation.x = kneeRest;
  hip.add(knee);

  addMesh(ctx, sphere(r * 0.95, 7, 5), knee, { paint: 'dark' }); // knee joint
  const lo = capsule(r * 0.72, lower);
  lo.translate(0, -lower / 2, 0);
  addMesh(ctx, lo, knee);

  // foot pad + optional splayed toes
  addMesh(ctx, sphere(r * 1.05, 8, 6), knee, {
    pos: [0, -lower, r * 0.3], scale: [1.1, 0.55, 1.5], paint: 'dark',
  });
  for (let t = 0; t < toes; t++) {
    const a = (t - (toes - 1) / 2) * 0.55;
    addMesh(ctx, cone(r * 0.4, r * 1.0, 5), knee, {
      pos: [Math.sin(a) * r * 0.7, -lower - r * 0.05, r * 0.35 + Math.cos(a) * r * 0.85],
      rot: [Math.PI / 2.1, 0, 0], paint: 'bone',
    });
  }
  return { hip, knee, rest: { hip: hipRest, knee: kneeRest, splay } };
}

/**
 * Head on a neck pivot with a snouted/beaked/bulbous/antlered face, brow
 * ridges, hinged lower jaw and pupilled eyes. Returns { neck, head, skull, jaw }.
 */
function makeHead(ctx, parent, { x = 0, y, z, r, variant, neckLen = 0, fanged = false }) {
  const rng = ctx.rng;
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
  const isBeak = variant === 'beaked';
  const skull = addMesh(ctx, sphere(r), head, {
    scale: isBulb ? [1.25, 1.15, 1.2] : [0.92, 0.9, 1.14],
  });

  // muzzle / snout (skip for beak & bulb faces)
  if (!isBulb && !isBeak) {
    const mlen = r * 1.15;
    const mg = capsule(r * 0.58, mlen * 0.45, 5, 10);
    mg.rotateX(Math.PI / 2);
    mg.translate(0, 0, mlen * 0.35);
    taperZ(mg, (t) => 0.55 + 0.6 * (1 - t)); // narrows toward the nose
    addMesh(ctx, mg, head, { pos: [0, -r * 0.14, r * 0.42], scale: [0.92, 0.82, 1] });
    for (const s of [-1, 1]) {
      addMesh(ctx, sphere(r * 0.06, 5, 4), head, { pos: [s * r * 0.16, -r * 0.08, r * 1.12], paint: 'dark' });
    }
  }

  // hinged lower jaw (rests closed; builders may nudge it for breathing)
  const jaw = new THREE.Group();
  jaw.position.set(0, -r * 0.32, r * 0.12);
  head.add(jaw);
  const jl = isBulb ? r * 0.55 : r * 0.95;
  const jg = capsule(r * 0.4, jl * 0.5, 4, 8);
  jg.rotateX(Math.PI / 2);
  jg.translate(0, 0, jl * 0.4);
  addMesh(ctx, jg, jaw, { scale: [0.82, 0.55, 1], paint: 'dark' });

  // brow ridges — read as a face under key light
  for (const s of [-1, 1]) {
    addMesh(ctx, sphere(r * 0.24, 6, 5), head, {
      pos: [s * r * 0.46, r * 0.3, r * 0.5], scale: [1.2, 0.5, 1.3],
    });
  }

  if (isBeak) {
    addMesh(ctx, cone(r * 0.42, r * 1.5, 7), head, {
      pos: [0, -r * 0.05, r * 1.15], rot: [Math.PI / 2, 0, 0], paint: 'bone',
    });
    addMesh(ctx, cone(r * 0.3, r * 0.9, 6), jaw, {
      pos: [0, 0, jl * 0.55], rot: [Math.PI / 2, 0, 0], paint: 'bone',
    });
  } else if (variant === 'horned') {
    for (const s of [-1, 1]) {
      addMesh(ctx, cone(r * 0.22, r * 1.15, 6), head, {
        pos: [s * r * 0.55, r * 0.72, -r * 0.1], rot: [-0.5, 0, s * 0.55], paint: 'bone',
      });
    }
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
  } else if (isBulb) {
    for (const s of [-1, 1]) {
      addMesh(ctx, sphere(r * 0.3, 8, 6), head, { pos: [s * r * 0.85, 0, r * 0.3], scale: [0.8, 1, 0.8] });
    }
  }

  // ears — for beaked/horned faces sometimes, extra silhouette variety
  if ((isBeak || variant === 'horned') && rng.chance(0.5)) {
    for (const s of [-1, 1]) {
      addMesh(ctx, cone(r * 0.16, r * 0.8, 5), head, {
        pos: [s * r * 0.5, r * 0.5, -r * 0.2], rot: [-0.3, 0, s * 0.5], paint: 'skin',
      });
    }
  }

  if (fanged) {
    for (const s of [-1, 1]) {
      addMesh(ctx, cone(r * 0.08, r * 0.42, 4), head, {
        pos: [s * r * 0.26, -r * 0.4, r * 0.92], rot: [Math.PI, 0, 0], paint: 'bone',
      });
    }
  }

  // eyes + dark pupils (glow eyes bloom; pupil reads as a highlight/iris break)
  const eyeR = r * (isBulb ? 0.34 : 0.22);
  const emat = ctx.glowEyes ? ctx.glowEyeMat : ctx.eyeMat;
  for (const s of [-1, 1]) {
    const ex = s * r * (isBulb ? 0.62 : 0.64), ey = r * 0.26, ez = r * (isBulb ? 0.72 : 0.66);
    addMesh(ctx, sphere(eyeR, 10, 8), head, { pos: [ex, ey, ez], paint: 'none', mat: emat });
    addMesh(ctx, sphere(eyeR * 0.48, 6, 5), head, {
      pos: [ex + s * eyeR * 0.08, ey, ez + eyeR * 0.72], paint: 'none', mat: ctx.pupilMat,
    });
  }
  return { neck, head, skull, jaw };
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
        pos: [0, topY + h * 0.12 * f, z], scale: [0.35, 0.9 + f * 0.5, 0.7],
        paint: 'accent', mat: ctx.shellMat,
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
  const torsoLen = rng.range(0.9, 1.4);
  const torsoR = barrel ? rng.range(0.28, 0.42) : rng.range(0.17, 0.26);
  const hipY = rng.range(0.55, 0.9);
  const legLen = rng.range(0.9, 1.15); // proportion knob: stocky ↔ leggy

  const tg = capsule(torsoR, torsoLen, 6, 12);
  tg.rotateX(Math.PI / 2);
  taperZ(tg, (t) => 0.85 + 0.22 * Math.sin(Math.PI * t)); // chest/haunch, thinner mid
  const torso = addMesh(ctx, tg, body, { pos: [0, hipY, 0], scale: [1, barrel ? 1.12 : 1, 1] });
  // shoulder mass where the neck meets the body
  addMesh(ctx, sphere(torsoR * 1.05, 10, 8), body, {
    pos: [0, hipY + torsoR * 0.2, torsoLen * 0.34], scale: [1, 1.05, 0.9],
  });

  const legR = Math.min(torsoR * 0.32, 0.09) + 0.02;
  const legs = [];
  const phases = [0, Math.PI, Math.PI, 0]; // trot: FL, FR, BL, BR
  const lx = torsoR * 0.82;
  const lz = torsoLen * 0.42;
  const spots = [[-lx, lz], [lx, lz], [-lx, -lz], [lx, -lz]];
  for (let i = 0; i < 4; i++) {
    legs.push(makeLeg(ctx, root, {
      x: spots[i][0], y: hipY, z: spots[i][1],
      upper: hipY * 0.52 * legLen, lower: hipY * 0.5 * legLen, r: legR,
      hipRest: 0.12, kneeRest: -0.3, toes: 3,
    }));
  }

  const headR = torsoR * rng.range(0.75, 1.05);
  const { neck, jaw } = makeHead(ctx, body, {
    y: hipY + torsoR * 0.45, z: torsoLen * 0.5, r: headR,
    variant: rng.pick(['beaked', 'horned', 'bulbous', 'antlered']),
    neckLen: rng.range(0.15, 0.5), fanged: rng.chance(0.3),
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
  for (const s of [-1, 1]) {
    makeGlowMarks(ctx, body, {
      from: [s * torsoR * 0.92, hipY + torsoR * 0.1, torsoLen * 0.3],
      to: [s * torsoR * 0.92, hipY - torsoR * 0.1, -torsoLen * 0.4], n: 4, r: torsoR * 0.09,
    });
  }

  const bodyBase = 0;
  return (T, TI, m) => {
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
    jaw.rotation.x = 0.03 + Math.max(0, Math.sin(TI * 0.8)) * 0.12 * (1 - m * 0.5);
    for (let j = 0; j < tail.length; j++) {
      tail[j].rotation.y = Math.sin(TI * 1.7 + j * 0.7) * 0.14 + Math.sin(T + j) * 0.1 * m;
    }
  };
}

function buildHopper(ctx) {
  const { rng, body, root } = ctx;
  const hipY = rng.range(0.5, 0.78);
  const tr = rng.range(0.22, 0.34);

  const torso = addMesh(ctx, sphere(tr, 14, 12), body, {
    pos: [0, hipY + tr * 0.35, 0], scale: [0.85, 1.2, 1.05], rot: [0.25, 0, 0],
  });

  const legs = [];
  for (const s of [-1, 1]) {
    legs.push(makeLeg(ctx, root, {
      x: s * tr * 0.75, y: hipY, z: -tr * 0.35,
      upper: hipY * 0.72, lower: hipY * 0.7, r: tr * 0.28,
      hipRest: -0.85, kneeRest: 1.5, toes: 2,
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

  const { neck, jaw } = makeHead(ctx, body, {
    y: hipY + tr * 1.25, z: tr * 0.55, r: tr * rng.range(0.6, 0.82),
    variant: rng.pick(['beaked', 'bulbous', 'horned']), neckLen: tr * 0.3,
  });
  const tail = makeTail(ctx, body, {
    y: hipY + tr * 0.1, z: -tr * 0.8, r: tr * 0.4, segLen: rng.range(0.28, 0.4), segs: 3, droop: 0.45,
  });
  makeGlowMarks(ctx, body, {
    from: [0, hipY + tr, tr * 0.3], to: [0, hipY - tr * 0.2, tr * 0.3], n: 3, r: tr * 0.08,
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
    jaw.rotation.x = 0.04 + Math.max(0, Math.sin(TI * 1.1)) * 0.14 * (1 - m * 0.5);
    for (let j = 0; j < tail.length; j++) {
      tail[j].rotation.x = -0.45 + hop * 0.35 * m + Math.sin(TI * 1.9 + j) * 0.06;
    }
  };
}

function buildHexapod(ctx) {
  const { rng, body, root } = ctx;
  const len = rng.range(0.7, 1.05);
  const r = rng.range(0.18, 0.26);
  const bodyY = rng.range(0.3, 0.42);

  const tg = capsule(r, len, 5, 10);
  tg.rotateX(Math.PI / 2);
  taperZ(tg, (t) => 0.8 + 0.3 * Math.sin(Math.PI * t)); // segmented thorax feel
  addMesh(ctx, tg, body, { pos: [0, bodyY, 0], scale: [1.15, 0.8, 1] });

  if (rng.chance(0.6)) { // chitinous shell dome
    const dome = sphere(r * 1.5, 12, 6);
    addMesh(ctx, dome, body, {
      pos: [0, bodyY + r * 0.15, 0], scale: [1.0, 0.62, len / (r * 1.9)],
      paint: 'accent', mat: ctx.shellMat,
    });
    for (const s of [-1, 1]) {
      makeGlowMarks(ctx, body, {
        from: [s * r * 1.0, bodyY + r * 0.1, len * 0.2],
        to: [s * r * 1.0, bodyY + r * 0.1, -len * 0.3], n: 3, r: r * 0.1,
      });
    }
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

  const { neck, head, jaw } = makeHead(ctx, body, {
    y: bodyY + r * 0.25, z: len * 0.52, r: r * 0.78,
    variant: rng.pick(['bulbous', 'horned', 'beaked']), neckLen: 0.05,
    fanged: rng.chance(0.4),
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
    jaw.rotation.x = 0.05 + Math.max(0, Math.sin(TI * 2.3)) * 0.16;
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
  const finned = !spined && rng.chance(0.6);

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
    } else if (finned && i > 1 && i < n - 1) {
      addMesh(ctx, sphere(ri * 0.7, 7, 5), wrap, {
        pos: [0, ri * 0.7, 0], scale: [0.14, 1.1, 0.9], paint: 'accent',
      });
    }
    if (i > 1 && i % 3 === 0) {
      for (const s of [-1, 1]) {
        makeGlowMarks(ctx, wrap, { from: [s * ri * 0.9, 0, 0], to: [s * ri * 0.9, 0, 0], n: 1, r: ri * 0.16 });
      }
    }
    segs.push({ wrap, baseY: wrap.position.y, i });
  }

  // head features on segment 0
  const headWrap = segs[0].wrap;
  const hr = rBase * 1.05;
  const { neck, jaw } = makeHead(ctx, headWrap, {
    y: hr * 0.35, z: spacing * 0.55, r: hr,
    variant: rng.pick(['horned', 'bulbous', 'beaked']), neckLen: 0, fanged: rng.chance(0.6),
  });

  return (T, TI, m) => {
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
    jaw.rotation.x = 0.03 + Math.max(0, Math.sin(TI * 0.9)) * 0.1;
  };
}

function buildFloater(ctx) {
  const { rng, body } = ctx;
  const R = rng.range(0.36, 0.55);
  const tentLen = rng.range(0.7, 1.15);
  const nT = rng.int(3, 6);
  const bagY = tentLen + R * 0.85;

  const bag = addMesh(ctx, sphere(R, 16, 13), body, { pos: [0, bagY, 0], scale: [1, 0.82, 1] });
  addMesh(ctx, sphere(R * 0.5, 10, 7), body, { // crown
    pos: [0, bagY + R * 0.68, 0], scale: [1, 0.5, 1], paint: 'accent',
  });
  // skirt ring under the bag
  addMesh(ctx, sphere(R * 0.92, 14, 7), body, {
    pos: [0, bagY - R * 0.42, 0], scale: [1, 0.35, 1], paint: 'accent',
  });
  // bioluminescent ring of nodes around the bag equator
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    makeGlowMarks(ctx, body, {
      from: [Math.cos(a) * R * 0.98, bagY - R * 0.1, Math.sin(a) * R * 0.98],
      to: [Math.cos(a) * R * 0.98, bagY - R * 0.1, Math.sin(a) * R * 0.98], n: 1, r: R * 0.07,
    });
  }

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
  const bodyR = rng.range(0.12, 0.2);
  const bodyLen = rng.range(0.5, 0.78);
  const span = rng.range(0.7, 1.2);
  const restY = bodyR * 2.2;

  const tg = capsule(bodyR, bodyLen, 5, 10);
  tg.rotateX(Math.PI / 2);
  taperZ(tg, (t) => 0.6 + 0.55 * Math.sin(Math.PI * t)); // spindle body
  addMesh(ctx, tg, body, { pos: [0, restY, 0], scale: [1, 1.05, 1] });

  const chord = bodyLen * rng.range(0.55, 0.78);
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

  const { neck, jaw } = makeHead(ctx, body, {
    y: restY + bodyR * 0.35, z: bodyLen * 0.5, r: bodyR * rng.range(0.85, 1.15),
    variant: rng.pick(['beaked', 'beaked', 'horned', 'bulbous']), neckLen: bodyR * 0.4,
  });

  // tucked legs
  for (const s of [-1, 1]) {
    const g = capsule(bodyR * 0.16, restY * 0.7);
    g.translate(0, -restY * 0.35, 0);
    addMesh(ctx, g, body, { pos: [s * bodyR * 0.5, restY - bodyR * 0.4, -bodyLen * 0.1], rot: [0.25, 0, 0] });
  }
  makeGlowMarks(ctx, body, {
    from: [0, restY + bodyR * 0.6, bodyLen * 0.2], to: [0, restY + bodyR * 0.6, -bodyLen * 0.3],
    n: 3, r: bodyR * 0.14,
  });

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
    jaw.rotation.x = 0.03 + Math.max(0, Math.sin(TI * 1.6)) * 0.1 * fold;
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
  const accent2 = hsl(accentHue + rng.range(0.08, 0.22), Math.min(sat + 0.15, 0.75), 0.4);
  const bone = hsl(baseHue, 0.12, 0.8);
  const dark = hsl(baseHue, sat * 0.6, 0.16);
  const glowEyes = bodyType === 'floater' || rng.chance(style.glow);
  const biolum = bodyType === 'floater' || rng.chance(style.glow * 1.4 + 0.05);

  // ---- materials ------------------------------------------------------
  const skinMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: rng.range(0.74, 0.88), metalness: 0.02,
  });
  const shellMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: rng.range(0.35, 0.55), metalness: rng.range(0.15, 0.4),
  });
  const wingMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
  });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.25 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.2, metalness: 0.1 });
  const glowColor = hsl(accentHue, 0.85, 0.6);
  const glowEyeMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: glowColor, emissiveIntensity: 2.4, roughness: 0.4,
  });
  const lureMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: glowColor, emissiveIntensity: 3.2, roughness: 0.4,
  });
  const markColor = hsl(accentHue + rng.range(-0.05, 0.05), 0.9, 0.6);
  const markMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: markColor, emissiveIntensity: rng.range(1.5, 2.4), roughness: 0.5,
  });

  // ---- assemble -------------------------------------------------------
  const group = new THREE.Group();
  const body = new THREE.Group(); // bobbing sub-root: torso/head/tail ride it
  group.add(body);

  const ctx = {
    rng, noise, root: group, body, geoms: [], skinMat, shellMat, wingMat,
    eyeMat, pupilMat, glowEyeMat, lureMat, markMat, glowEyes, biolum,
  };
  const animateBody = BUILDERS[bodyType](ctx);

  paintCreature(group, {
    belly, back, accent, accent2, bone, dark, noise,
    mode: rng.pick(['none', 'stripes', 'spots', 'rosettes', 'patches', 'stripes', 'spots']),
    patScale: bodyType === 'serpent' ? 2.6 : rng.range(1.8, 3.2),
    countershade: rng.range(0.75, 1.5),
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
    skinMat.dispose(); shellMat.dispose(); wingMat.dispose();
    eyeMat.dispose(); pupilMat.dispose();
    glowEyeMat.dispose(); lureMat.dispose(); markMat.dispose();
    group.removeFromParent();
  }

  return { group, animate, profile, dispose };
}
