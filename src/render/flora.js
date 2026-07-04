// FloraSystem — instanced, streamed vegetation for planet surfaces.
// Deterministic per 64 m cell via field.cellRng(cx, cz, 'flora'); 3–5 merged
// low-poly archetype geometries per biome family, one InstancedMesh per
// archetype (re-filled as cells stream around focusPos), plus a cheap
// cross-quad grass layer near the player. Emissive accents (crystals, ember
// pods, mushroom gills…) use an HDR per-vertex glow channel so they feed bloom.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, hash32, hashString } from '../core/rng.js';

const CELL = 64;          // metres — must match TerrainField cell grid
const VIEW_CELLS = 5;     // stream radius in cells (~320 m)
const GRASS_RADIUS = 84;  // metres — grass only near the player
const ARCH_CAP = 3000;    // max instances per archetype
const GRASS_CAP = 11000;
const MAX_PER_CELL = 14;  // archetype instances at density 1, moisture 1

// ------------------------------------------------------------- color helpers

const NATURE = {
  leaf: 0x58a54b, leafDark: 0x3d7f42, trunk: 0x6f4b32, trunkDark: 0x46331f,
  dry: 0xb9a05f, dryDark: 0x8a744a, snow: 0xe9f3fb, pine: 0x2f5d44,
  char: 0x201b17, ember: 0xff7a2a, sick: 0x8fd44a, bone: 0xcfc4ae,
};

function col(hex) { return new THREE.Color(hex); }
function mix(a, b, t) { return a.clone().lerp(b instanceof THREE.Color ? b : col(b), t); }

const PALETTE_FALLBACK = {
  deepWater: '#123a5e', shallowWater: '#2c6f8a', shore: '#c9b98c',
  low: '#3f7f3a', mid: '#7a9a4f', high: '#cfd8cc', peak: '#f4f8f8',
  cliff: '#6b6257', accent: '#59b552', glow: '#7de8ff',
};

/** Parse def.palette into THREE.Colors with sane fallbacks. */
function paletteKit(def) {
  const kit = {};
  for (const k of Object.keys(PALETTE_FALLBACK)) {
    kit[k] = col(def?.palette?.[k] ?? PALETTE_FALLBACK[k]);
  }
  return kit;
}

// ---------------------------------------------------------- geometry helpers

/** Bake a TRS transform into a geometry. */
function xf(geo, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const sc = Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    sc,
  );
  geo.applyMatrix4(m);
  return geo;
}

/** Random organic vertex jitter (welded verts stay welded on indexed geos). */
function jitter(geo, rng, amt) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) + rng.range(-amt, amt),
      p.getY(i) + rng.range(-amt, amt),
      p.getZ(i) + rng.range(-amt, amt));
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Paint per-vertex color (+ optional bottom→top gradient) and glow channel.
 * glow > ~1 becomes HDR emissive (vColor * glow) and feeds bloom.
 */
function paint(geo, cA, cB = null, glowA = 0, glowB = null) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, span = Math.max(bb.max.y - bb.min.y, 1e-5);
  const p = geo.attributes.position, n = p.count;
  const colors = new Float32Array(n * 3), glows = new Float32Array(n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = cB ? THREE.MathUtils.clamp((p.getY(i) - bb.min.y) / span, 0, 1) : 0;
    c.copy(cA); if (cB) c.lerp(cB, t);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    glows[i] = glowB == null ? glowA : glowA + (glowB - glowA) * t;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glows, 1));
  return geo;
}

function merge(parts) {
  // mergeGeometries rejects mixed indexed/non-indexed inputs — normalize first
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const g = mergeGeometries(flat, false);
  for (const p of parts) p.dispose();
  for (const p of flat) { if (!parts.includes(p)) p.dispose(); }
  return g;
}

// low-poly primitive shorthands
const cyl = (rT, rB, h, seg = 5, hs = 1) => new THREE.CylinderGeometry(rT, rB, h, seg, hs);
const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const cone = (r, h, seg = 5) => new THREE.ConeGeometry(r, h, seg);
const octa = (r) => new THREE.OctahedronGeometry(r, 0);

/** Bent, tapered trunk with base at y=0 (short taproot below for slopes). */
function trunk(rng, h, r, bend, cTop, cBot) {
  const g = cyl(r * 0.55, r, h + 0.5, 5, 3);
  xf(g, 0, h / 2 - 0.25, 0);
  const p = g.attributes.position;
  const dir = rng.range(0, Math.PI * 2);
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(p.getY(i), 0) / h;
    p.setX(i, p.getX(i) + Math.cos(dir) * bend * t * t * h);
    p.setZ(i, p.getZ(i) + Math.sin(dir) * bend * t * t * h);
  }
  jitter(g, rng, r * 0.16);
  return { geo: paint(g, cBot, cTop), tipX: Math.cos(dir) * bend * h, tipZ: Math.sin(dir) * bend * h };
}

/** Squashed leaf/canopy blob. */
function blob(rng, r, flat, cA, cB, glow = 0) {
  const g = ico(r, 1);
  xf(g, 0, 0, 0, 0, rng.range(0, 3), 0, [1, flat, 1]);
  jitter(g, rng, r * 0.16);
  return paint(g, cA, cB, 0, glow);
}

/** Stretched crystal shard. */
function shard(rng, r, h, cA, cB, gA, gB) {
  const g = octa(r);
  xf(g, 0, h * 0.32, 0, rng.range(-0.1, 0.1), rng.range(0, 3), rng.range(-0.1, 0.1), [1, h / r * 0.5, 1]);
  return paint(g, cA, cB, gA, gB);
}

/** Radial arrangement of tilted fronds (squashed cones) — ferns, palms. */
function fronds(rng, count, len, w, tilt, y, cA, cB, droop = 0) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const g = cone(w, len, 4);
    xf(g, 0, len / 2, 0);                                    // base at origin
    xf(g, 0, 0, 0, tilt + rng.range(-0.12, 0.12) + droop, 0, 0);
    xf(g, 0, y, 0, 0, a, 0, [1, 1, 0.34]);
    parts.push(paint(g, cA, cB));
  }
  return parts;
}

// ----------------------------------------------------- biome archetype builds

/**
 * Each archetype: { name, geo, weight, sMin, sMax, tilt, collect, shore }.
 * collect = itemId harvestable via collectableAt (carbyne loop).
 */
function buildArchetypes(def, kit, rng) {
  const biome = def?.biome ?? 'barren';
  const leaf = mix(col(NATURE.leaf), kit.accent, 0.5);
  const leafD = mix(col(NATURE.leafDark), kit.low, 0.45);
  const trkC = mix(col(0x836043), kit.shore, 0.28);   // warmer, lighter bark
  const trkD = mix(col(0x5c4229), kit.cliff, 0.25);
  const A = [];
  const add = (name, geo, o = {}) => A.push({
    name, geo, weight: o.weight ?? 1, sMin: o.sMin ?? 0.8, sMax: o.sMax ?? 1.3,
    tilt: o.tilt ?? 0.08, collect: o.collect ?? null, shore: o.shore ?? false,
  });

  const canopyTree = (r, hMul, cA, cB) => { // r = forked RNG
    const h = r.range(3.0, 4.4) * hMul;
    const t = trunk(r, h, r.range(0.26, 0.36), r.range(0.05, 0.22), trkC, trkD);
    const parts = [t.geo];
    // SOLID rounded crown: a tight cluster of big overlapping leaf-masses at the
    // top that fully envelop the trunk tip — no branches/gaps that read as spikes
    const nBlob = r.int(4, 6);
    const cr = r.range(1.5, 2.2) * hMul;              // crown cluster radius
    for (let i = 0; i < nBlob; i++) {
      const br = cr * r.range(0.72, 1.0);
      const b = blob(r, br, r.range(0.72, 0.96), cB, cA);
      const a = r.range(0, Math.PI * 2), rad = r.range(0, 0.6) * cr;
      xf(b, t.tipX + Math.cos(a) * rad, h + r.range(-0.35, 0.5), t.tipZ + Math.sin(a) * rad);
      parts.push(b);
    }
    return merge(parts);
  };
  const twigs = (r, n, len, cA, cB) => {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const g = cone(r.range(0.03, 0.06), len * r.range(0.7, 1.2), 4);
      xf(g, 0, len / 2 - 0.1, 0);
      xf(g, 0, 0, 0, r.range(0.25, 0.8), r.range(0, Math.PI * 2), 0);
      parts.push(paint(g, cA, cB));
    }
    return merge(parts);
  };

  switch (biome) {
    case 'lush': {
      add('canopyA', canopyTree(rng.fork('cA'), 1.0, leaf, leafD), { weight: 3, sMin: 0.9, sMax: 1.6 });
      add('canopyB', canopyTree(rng.fork('cB'), 1.12, mix(leaf, kit.accent, 0.4), leafD), { weight: 2, sMin: 0.9, sMax: 1.4 });
      const fr = rng.fork('fern');
      // low, spread, bright fronds — a ground fern, not a black spike cluster
      add('fern', merge(fronds(fr, fr.int(8, 11), 0.9, 0.4, 0.5, 0.08, mix(leaf, kit.low, 0.25), mix(leaf, kit.accent, 0.7), 0.2)),
        { weight: 2, collect: 'carbyne', sMin: 0.55, sMax: 0.95 });
      const bu = rng.fork('bush');
      add('bush', paint(xf(jitter(ico(0.9, 1), bu, 0.16), 0, 0.55, 0, 0, 0, 0, [1, 0.75, 1]), leafD, leaf), { weight: 2, sMin: 0.7, sMax: 1.4 });
      break;
    }
    case 'swamp': {
      const gr = rng.fork('gnarl');
      const h = gr.range(4.2, 6);
      const t = trunk(gr, h, 0.38, 0.34, trkD, mix(trkD, kit.low, 0.4));
      const cap = blob(gr, 1.9, 0.42, mix(leafD, kit.accent, 0.35), leafD);
      xf(cap, t.tipX, h + 0.2, t.tipZ);
      const root1 = paint(xf(cone(0.16, 1.6, 4), 0.5, 0.4, 0.2, 0, 0, -1, 1), trkD);
      const root2 = paint(xf(cone(0.16, 1.4, 4), -0.4, 0.35, -0.4, 1, 0.5, 0.9, 1), trkD);
      add('gnarled', merge([t.geo, cap, root1, root2]), { weight: 3, sMin: 0.8, sMax: 1.5 });
      const re = rng.fork('reed');
      const reeds = [];
      for (let i = 0; i < 8; i++) {
        const rh = re.range(1.2, 2.3);
        const g = cyl(0.02, 0.05, rh, 4);
        xf(g, re.range(-0.7, 0.7), rh / 2, re.range(-0.7, 0.7), re.range(-0.14, 0.14), 0, re.range(-0.14, 0.14));
        reeds.push(paint(g, mix(leafD, kit.low, 0.5), mix(kit.accent, leaf, 0.4), 0, 0.3));
      }
      add('reeds', merge(reeds), { weight: 4, collect: 'carbyne', sMin: 0.7, sMax: 1.3 });
      const mo = rng.fork('mound');
      add('mound', paint(xf(jitter(ico(0.8, 1), mo, 0.14), 0, 0.4, 0, 0, 0, 0, [1.3, 0.55, 1.3]), mix(leafD, trkD, 0.4), leafD), { weight: 2 });
      break;
    }
    case 'desert': {
      const cg = rng.fork('cact');
      const cactC = mix(col(0x5f8f4a), kit.accent, 0.45), cactD = mix(col(0x3c6b38), kit.low, 0.4);
      const body = paint(jitter(cyl(0.3, 0.36, 3.4, 7, 2), cg, 0.05), cactD, cactC);
      xf(body, 0, 1.7, 0);
      const capg = paint(xf(new THREE.SphereGeometry(0.3, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 3.4, 0), cactC);
      const armParts = [body, capg];
      for (let i = 0; i < 2; i++) {
        const a = cg.range(0, Math.PI * 2), ay = cg.range(1.1, 2.1);
        const ax = Math.cos(a), az = Math.sin(a);
        // horizontal elbow pointing along direction a, then an upright segment
        const elbow = cyl(0.16, 0.16, 0.8, 6);
        xf(elbow, 0, 0, 0, Math.PI / 2, 0, 0);        // lie along +z
        xf(elbow, ax * 0.5, ay, az * 0.5, 0, -a + Math.PI / 2, 0);
        const up = cyl(0.15, 0.18, 1.3, 6);
        xf(up, ax * 0.85, ay + 0.62, az * 0.85);
        const cap2 = xf(new THREE.SphereGeometry(0.15, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), ax * 0.85, ay + 1.27, az * 0.85);
        armParts.push(paint(elbow, cactD, cactC), paint(up, cactD, cactC), paint(cap2, cactC));
      }
      add('saguaro', merge(armParts), { weight: 2, collect: 'carbyne', sMin: 0.8, sMax: 1.5, tilt: 0.05 });
      const ba = rng.fork('barrel');
      add('barrel', paint(xf(jitter(new THREE.SphereGeometry(0.5, 8, 5), ba, 0.05), 0, 0.42, 0, 0, 0, 0, [1, 0.85, 1]), cactD, mix(cactC, kit.accent, 0.5)), { weight: 2, sMin: 0.6, sMax: 1.2 });
      add('dryshrub', twigs(rng.fork('dshr'), 7, 1.1, col(NATURE.dryDark), mix(col(NATURE.dry), kit.shore, 0.4)), { weight: 3, sMin: 0.7, sMax: 1.3 });
      break;
    }
    case 'frozen': {
      const cf = rng.fork('conif');
      const pine = mix(col(NATURE.pine), kit.accent, 0.3), snow = mix(col(NATURE.snow), kit.high, 0.4);
      const th = cf.range(4, 6);
      const conifParts = [paint(xf(cyl(0.12, 0.24, th * 0.4, 5), 0, th * 0.2 - 0.2, 0), trkD)];
      for (let i = 0; i < 3; i++) {
        const cr = (1.5 - i * 0.4) * cf.range(0.9, 1.1), cy = th * (0.3 + i * 0.26);
        conifParts.push(paint(xf(jitter(cone(cr, th * 0.42, 7), cf, 0.06), 0, cy, 0), pine, i === 2 ? snow : mix(pine, snow, 0.35)));
      }
      add('conifer', merge(conifParts), { weight: 3, sMin: 0.8, sMax: 1.6, tilt: 0.04 });
      const is = rng.fork('ice');
      const iceC = mix(kit.glow, col(0xbfe8ff), 0.4);
      const iceParts = [];
      for (let i = 0; i < is.int(3, 5); i++) {
        iceParts.push(xf(shard(is, is.range(0.22, 0.4), is.range(1, 2.4), mix(iceC, col(0x1a2c3c), 0.6), iceC, 0.15, 1.6),
          is.range(-0.6, 0.6), 0, is.range(-0.6, 0.6), is.range(-0.3, 0.3), 0, is.range(-0.3, 0.3)));
      }
      add('iceshard', merge(iceParts), { weight: 2, sMin: 0.6, sMax: 1.3, tilt: 0.1 });
      add('frostscrub', twigs(rng.fork('fscr'), 6, 0.9, mix(trkD, col(NATURE.snow), 0.2), mix(col(NATURE.bone), kit.high, 0.4)), { weight: 2, collect: 'carbyne', sMin: 0.6, sMax: 1.1 });
      break;
    }
    case 'volcanic': {
      const sp = rng.fork('spike');
      const charC = col(NATURE.char), charT = mix(col(NATURE.char), kit.cliff, 0.5);
      const spikes = [];
      for (let i = 0; i < sp.int(2, 4); i++) {
        const sh = sp.range(2.2, 4.6);
        const t = trunk(sp, sh, sp.range(0.12, 0.2), sp.range(0.15, 0.4), charT, charC);
        xf(t.geo, sp.range(-0.7, 0.7), 0, sp.range(-0.7, 0.7));
        spikes.push(t.geo);
      }
      add('charspike', merge(spikes), { weight: 3, sMin: 0.8, sMax: 1.5, tilt: 0.12 });
      const em = rng.fork('ember');
      const emberC = mix(kit.glow, col(NATURE.ember), 0.5);
      const podParts = [paint(xf(jitter(ico(0.5, 1), em, 0.08), 0, 0.4, 0, 0, 0, 0, [1, 0.8, 1]), charC, charT)];
      for (let i = 0; i < 3; i++) {
        const a = em.range(0, Math.PI * 2);
        podParts.push(xf(shard(em, 0.12, 0.55, mix(emberC, charC, 0.5), emberC, 0.4, 3.2),
          Math.cos(a) * 0.3, 0.72, Math.sin(a) * 0.3, em.range(-0.4, 0.4), 0, em.range(-0.4, 0.4)));
      }
      add('emberpod', merge(podParts), { weight: 3, collect: 'carbyne', sMin: 0.6, sMax: 1.2 });
      add('ashscrub', twigs(rng.fork('ashs'), 6, 0.9, charC, charT), { weight: 2, sMin: 0.6, sMax: 1.2 });
      break;
    }
    case 'toxic': {
      const mu = rng.fork('shroom');
      const stalkC = mix(col(NATURE.bone), kit.mid, 0.3);
      const capC = mix(kit.accent, col(0x7a4a9a), 0.35);
      const mh = mu.range(2.6, 4.4);
      const gillGlow = mix(kit.glow, col(NATURE.sick), 0.4);
      const mParts = [
        paint(jitter(xf(cyl(0.24, 0.42, mh, 7, 2), 0, mh / 2 - 0.2, 0), mu, 0.06), mix(stalkC, col(0x555a4a), 0.4), stalkC),
        paint(xf(jitter(new THREE.SphereGeometry(1.5, 9, 5), mu, 0.1), 0, mh + 0.1, 0, 0, 0, 0, [1, 0.5, 1]), mix(capC, kit.low, 0.3), capC),
        paint(xf(cyl(1.12, 0.86, 0.3, 9), 0, mh - 0.18, 0), gillGlow, gillGlow, 2.4, 2.4),
      ];
      add('mushroom', merge(mParts), { weight: 3, sMin: 0.7, sMax: 1.6, tilt: 0.06 });
      const ss = rng.fork('sac');
      const sacParts = [];
      for (let i = 0; i < ss.int(3, 5); i++) {
        const sr = ss.range(0.24, 0.5);
        sacParts.push(paint(xf(jitter(ico(sr, 1), ss, sr * 0.14), ss.range(-0.6, 0.6), sr * 0.8, ss.range(-0.6, 0.6), 0, 0, 0, [1, 1.2, 1]),
          mix(capC, kit.low, 0.5), gillGlow, 0.05, 0.9));
      }
      add('sporesac', merge(sacParts), { weight: 3, collect: 'carbyne', sMin: 0.7, sMax: 1.3 });
      add('tendril', twigs(rng.fork('tend'), 6, 1.4, mix(kit.low, capC, 0.4), mix(kit.accent, gillGlow, 0.4)), { weight: 2, sMin: 0.7, sMax: 1.2 });
      break;
    }
    case 'irradiated': {
      const tw = rng.fork('twist');
      const glowG = mix(col(0x58ff8a), kit.glow, 0.35);
      const bodyC = mix(kit.low, col(0x4a5a3a), 0.5);
      const tParts = [];
      let ty = 0.2, tx = 0, tz = 0;
      const nSeg = tw.int(4, 6);
      for (let i = 0; i < nSeg; i++) {
        const br = 0.75 * (1 - i / nSeg) + 0.12;
        const b = blob(tw, br, 0.9, bodyC, i >= nSeg - 2 ? glowG : mix(bodyC, glowG, 0.3), i >= nSeg - 2 ? 1.1 : 0);
        xf(b, tx, ty, tz);
        ty += br * 1.15; tx += tw.range(-0.35, 0.35); tz += tw.range(-0.35, 0.35);
        tParts.push(b);
      }
      add('twisted', merge(tParts), { weight: 3, sMin: 0.8, sMax: 1.5, tilt: 0.1 });
      const cs = rng.fork('cspire');
      add('crookspire', merge([trunk(cs, cs.range(3, 5), 0.18, 0.45, mix(bodyC, glowG, 0.5), col(NATURE.char)).geo]), { weight: 2, sMin: 0.7, sMax: 1.4, tilt: 0.14 });
      add('blightshrub', twigs(rng.fork('blsh'), 7, 1.1, mix(bodyC, col(NATURE.char), 0.4), glowG), { weight: 3, collect: 'carbyne', sMin: 0.6, sMax: 1.2 });
      break;
    }
    case 'crystal':
    case 'exotic': {
      const cr = rng.fork('cry');
      const gC = kit.glow.clone(), gDark = mix(kit.glow, col(0x101820), 0.75);
      const big = [];
      for (let i = 0; i < cr.int(4, 7); i++) {
        big.push(xf(shard(cr, cr.range(0.3, 0.55), cr.range(1.6, 3.6), gDark, gC, 0.25, 2.6),
          cr.range(-0.9, 0.9), 0, cr.range(-0.9, 0.9), cr.range(-0.35, 0.35), 0, cr.range(-0.35, 0.35)));
      }
      add('crycluster', merge(big), { weight: 3, sMin: 0.8, sMax: 1.7, tilt: 0.12 });
      const sm = rng.fork('smsh');
      const small = [];
      for (let i = 0; i < 4; i++) {
        small.push(xf(shard(sm, 0.18, sm.range(0.5, 1), gDark, mix(gC, kit.accent, 0.35), 0.2, 1.8),
          sm.range(-0.5, 0.5), 0, sm.range(-0.5, 0.5), sm.range(-0.4, 0.4), 0, sm.range(-0.4, 0.4)));
      }
      add('cryshard', merge(small), { weight: 4, collect: 'carbyne', sMin: 0.6, sMax: 1.2, tilt: 0.14 });
      if (biome === 'exotic') {
        const or = rng.fork('orb');
        const stem = paint(jitter(xf(cyl(0.05, 0.1, 2.6, 5), 0, 1.1, 0), or, 0.05), gDark, mix(gC, kit.accent, 0.5));
        const orb = paint(xf(ico(0.42, 1), 0, 2.6, 0), gC, gC, 2.2, 2.2);
        add('orbstalk', merge([stem, orb]), { weight: 2, sMin: 0.8, sMax: 1.5, tilt: 0.1 });
      } else {
        const fa = rng.fork('fan');
        const fan = [];
        for (let i = 0; i < 5; i++) {
          fan.push(xf(shard(fa, 0.22, fa.range(1, 1.9), gDark, gC, 0.2, 2.2), 0, 0, 0, 0, 0, -0.9 + i * 0.42));
        }
        add('cryfan', merge(fan), { weight: 2, sMin: 0.7, sMax: 1.4, tilt: 0.1 });
      }
      break;
    }
    case 'ocean': {
      const pa = rng.fork('palm');
      const ph = pa.range(4, 6.2);
      const pt = trunk(pa, ph, 0.22, 0.35, mix(trkC, kit.shore, 0.35), trkD);
      const frs = fronds(pa, pa.int(5, 7), 2.4, 0.5, 1.35, 0, leafD, mix(leaf, kit.accent, 0.5), 0.15);
      for (const f of frs) xf(f, pt.tipX, ph, pt.tipZ);
      add('palm', merge([pt.geo, ...frs]), { weight: 3, shore: true, sMin: 0.8, sMax: 1.4, tilt: 0.1 });
      const sg = rng.fork('sgr');
      add('shoregrass', merge(fronds(sg, 7, 1.1, 0.16, 0.95, 0.05, mix(leaf, kit.shore, 0.4), mix(kit.accent, col(NATURE.dry), 0.4))),
        { weight: 4, collect: 'carbyne', sMin: 0.6, sMax: 1.2 });
      const bs = rng.fork('bshr');
      add('beachshrub', paint(xf(jitter(ico(0.7, 1), bs, 0.12), 0, 0.45, 0, 0, 0, 0, [1.2, 0.7, 1.2]), leafD, leaf), { weight: 2 });
      break;
    }
    default: { // barren + unknown biomes — sparse dead scrub
      add('deadscrub', twigs(rng.fork('dead'), 6, 1.2, mix(col(NATURE.trunkDark), kit.cliff, 0.5), mix(col(NATURE.bone), kit.shore, 0.5)),
        { weight: 3, collect: 'carbyne', sMin: 0.6, sMax: 1.3, tilt: 0.12 });
      const st = rng.fork('stone');
      add('rocktuft', paint(xf(jitter(ico(0.5, 1), st, 0.12), 0, 0.3, 0, 0, 0, 0, [1.1, 0.6, 1.1]), kit.cliff, mix(kit.mid, kit.cliff, 0.5)), { weight: 2, sMin: 0.6, sMax: 1.2 });
      const dsh = rng.fork('dsh');
      add('drieshard', merge([shard(dsh, 0.2, 0.9, mix(kit.cliff, col(0x141414), 0.5), mix(kit.glow, kit.cliff, 0.55), 0.05, 0.5)]), { weight: 1, sMin: 0.6, sMax: 1.1, tilt: 0.15 });
      break;
    }
  }
  return A;
}

/** Grass (near-player cross-quad ground cover) profile per biome, or null. */
function grassProfile(biome, kit) {
  const leaf = mix(col(NATURE.leaf), kit.accent, 0.5);
  switch (biome) {
    // grass follows the terrain greens (NATURE.leaf/low), NOT the planet accent —
    // otherwise it inherits exotic accent hues (purple) and clashes with the ground
    case 'lush': return { perCell: 95, cA: mix(col(NATURE.leaf), kit.low, 0.4), cB: mix(col(NATURE.leafDark), kit.low, 0.45), h: 0.7 };
    case 'swamp': return { perCell: 85, cA: mix(kit.low, col(NATURE.leaf), 0.5), cB: mix(col(NATURE.leafDark), kit.low, 0.5), h: 0.9 };
    case 'ocean': return { perCell: 72, cA: mix(col(NATURE.leaf), kit.low, 0.4), cB: mix(col(NATURE.dryDark), kit.low, 0.4), h: 0.78 };
    case 'desert': return { perCell: 14, cA: mix(col(NATURE.dryDark), kit.shore, 0.4), cB: col(NATURE.dry), h: 0.7 };
    case 'frozen': return { perCell: 12, cA: mix(col(NATURE.bone), kit.high, 0.5), cB: mix(col(NATURE.snow), kit.high, 0.4), h: 0.6 };
    case 'toxic': return { perCell: 28, cA: mix(kit.low, col(NATURE.sick), 0.4), cB: mix(kit.accent, col(NATURE.sick), 0.5), h: 0.9 };
    case 'irradiated': return { perCell: 20, cA: mix(kit.low, col(0x4a5a3a), 0.5), cB: mix(col(NATURE.sick), kit.glow, 0.3), h: 0.8 };
    case 'barren': return { perCell: 6, cA: mix(kit.cliff, col(NATURE.dryDark), 0.5), cB: mix(col(NATURE.bone), kit.shore, 0.5), h: 0.6 };
    default: return null; // volcanic / crystal / exotic: no soft ground cover
  }
}

// ------------------------------------------------------------------ materials

function makeFloraMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, side: THREE.DoubleSide,
    roughness: 0.92, metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n'
        + 'totalEmissiveRadiance += vColor.rgb * vGlow * (0.86 + 0.14 * sin(uTime * 2.1));');
  };
  mat.customProgramCacheKey = () => 'ams-flora-glow';
  return mat;
}

function makeGrassTexture() {
  const cv = document.createElement('canvas');
  cv.width = 96; cv.height = 128;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 96, 128);
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 15; i++) {
    const bx = 6 + (i / 15) * 84 + (Math.sin(i * 37.7) * 4);
    const w = 2.4 + Math.sin(i * 13.3) * 1.1;
    const h = 52 + Math.abs(Math.sin(i * 7.9)) * 66;
    const lean = Math.sin(i * 23.1) * 14;
    g.beginPath();
    g.moveTo(bx - w, 128);
    g.quadraticCurveTo(bx - w * 0.4 + lean * 0.4, 128 - h * 0.6, bx + lean, 128 - h);
    g.quadraticCurveTo(bx + w * 0.4 + lean * 0.4, 128 - h * 0.6, bx + w, 128);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGrassMaterial(uniforms, tex) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.45, side: THREE.DoubleSide,
    vertexColors: true, roughness: 1.0, metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        'vec3 iOri = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
        'float swy = sin(uTime * 1.7 + iOri.x * 0.43 + iOri.z * 0.31) * 0.16 * max(position.y, 0.0);',
        'transformed.x += swy; transformed.z += swy * 0.6;',
        '#endif',
      ].join('\n'));
    // green self-lift: thin vertical blades get little direct sun and soak the
    // blue sky fill — push their own colour so they read as sunlit grass
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.38;');
  };
  mat.customProgramCacheKey = () => 'ams-flora-grass-v2';
  return mat;
}

function makeGrassGeometry(h) {
  const parts = [];
  for (let i = 0; i < 2; i++) {
    const p = new THREE.PlaneGeometry(1.15, h, 1, 1);
    xf(p, 0, h / 2, 0, 0, i * Math.PI / 2, 0);
    // grayscale gradient — brighter base so blades read as lit grass, not dark
    // spikes (thin vertical quads otherwise get almost no direct sun)
    paint(p, col(0x8f8f8f), col(0xffffff));
    parts.push(p);
  }
  return merge(parts);
}

// -------------------------------------------------------------------- system

/**
 * Instanced vegetation streamed in 64 m cells around the player.
 * Contract: update(dt, focusPos), dispose(), collectableAt(pos, radius),
 * removeInstance(id).
 */
export class FloraSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} planetDef PlanetDef (biome, palette, floraDensity, seed…)
   * @param {object} field TerrainField (height/normal/seaY/moisture/cellRng)
   */
  constructor(scene, planetDef, field) {
    this.scene = scene;
    this.def = planetDef;
    this.field = field;
    this.time = 0;
    this.cells = new Map();      // 'cx:cz' -> [placement]
    this.grassCells = new Map(); // 'cx:cz' -> [grass placement]
    this.removed = new Set();    // harvested instance ids (session-persistent)
    this._focusCell = null;
    this._grassCell = null;
    this._dirty = false;

    const kit = paletteKit(planetDef);
    const rng = new RNG(hash32(planetDef?.seed ?? 1, hashString('flora-arch')));
    this.uniforms = { uTime: { value: 0 } };
    this.material = makeFloraMaterial(this.uniforms);
    this.archetypes = buildArchetypes(planetDef, kit, rng);
    this._weightSum = this.archetypes.reduce((s, a) => s + a.weight, 0);

    this.meshes = this.archetypes.map((a) => {
      const m = new THREE.InstancedMesh(a.geo, this.material, ARCH_CAP);
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = false;
      m.name = `flora:${a.name}`;
      scene.add(m);
      return m;
    });

    this.grass = grassProfile(planetDef?.biome ?? 'barren', kit);
    this.grassMesh = null;
    if (this.grass) {
      this.grassTex = makeGrassTexture();
      this.grassMat = makeGrassMaterial(this.uniforms, this.grassTex);
      this.grassGeo = makeGrassGeometry(this.grass.h * 0.9);
      const gm = new THREE.InstancedMesh(this.grassGeo, this.grassMat, GRASS_CAP);
      gm.count = 0;
      gm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      gm.frustumCulled = false;
      gm.name = 'flora:grass';
      scene.add(gm);
      this.grassMesh = gm;
    }

    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._vs = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /**
   * Stream cells around focusPos and animate glow/sway.
   * @param {number} dt seconds
   * @param {THREE.Vector3} focusPos player/camera position
   */
  update(dt, focusPos) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (!focusPos) return;

    const cx = Math.floor(focusPos.x / CELL), cz = Math.floor(focusPos.z / CELL);
    const key = `${cx}:${cz}`;
    if (key !== this._focusCell || this._dirty) {
      this._focusCell = key;
      const want = new Set();
      for (let dx = -VIEW_CELLS; dx <= VIEW_CELLS; dx++) {
        for (let dz = -VIEW_CELLS; dz <= VIEW_CELLS; dz++) {
          const k = `${cx + dx}:${cz + dz}`;
          want.add(k);
          if (!this.cells.has(k)) this.cells.set(k, this._genCell(cx + dx, cz + dz));
        }
      }
      for (const k of this.cells.keys()) if (!want.has(k)) this.cells.delete(k);
      this._rebuild();
      this._dirty = false;
    }

    if (this.grassMesh) {
      const gKey = `${Math.floor(focusPos.x / 32)}:${Math.floor(focusPos.z / 32)}`;
      if (gKey !== this._grassCell) {
        this._grassCell = gKey;
        this._streamGrass(focusPos);
      }
    }
  }

  _pickArchetype(rng) {
    let r = rng.next() * this._weightSum;
    for (let i = 0; i < this.archetypes.length; i++) {
      r -= this.archetypes[i].weight;
      if (r <= 0) return i;
    }
    return this.archetypes.length - 1;
  }

  _genCell(cx, cz) {
    const rng = this.field.cellRng(cx, cz, 'flora');
    const out = [];
    const density = THREE.MathUtils.clamp(this.def?.floraDensity ?? 0.5, 0, 1);
    if (density <= 0.001 || !this.archetypes.length) return out;
    const moist = THREE.MathUtils.clamp(this.field.moisture((cx + 0.5) * CELL, (cz + 0.5) * CELL), 0, 1);
    const target = Math.round(MAX_PER_CELL * density * (0.35 + 0.85 * moist) * rng.range(0.7, 1.15));
    const seaY = this.field.seaY;
    for (let i = 0; i < target; i++) {
      const x = (cx + rng.next()) * CELL, z = (cz + rng.next()) * CELL;
      const ai = this._pickArchetype(rng);
      const a = this.archetypes[ai];
      const s = rng.range(a.sMin, a.sMax);
      const sy = s * rng.range(0.85, 1.2);
      const rotY = rng.range(0, Math.PI * 2);
      const tx = rng.range(-a.tilt, a.tilt), tz = rng.range(-a.tilt, a.tilt);
      const shade = rng.range(0.82, 1.12);
      const y = this.field.height(x, z);
      if (y < seaY + 0.45) continue;
      if (a.shore && y > seaY + 7) continue;
      if (this.field.normal(x, z).y < 0.7) continue;
      out.push({
        id: `${cx}:${cz}:${i}`, arch: ai, x, y, z, s, sy, rotY, tx, tz,
        shade, collect: a.collect,
      });
    }
    return out;
  }

  _rebuild() {
    const counts = new Array(this.meshes.length).fill(0);
    for (const list of this.cells.values()) {
      for (const p of list) {
        if (this.removed.has(p.id)) continue;
        const idx = counts[p.arch];
        if (idx >= ARCH_CAP) continue;
        counts[p.arch] = idx + 1;
        const mesh = this.meshes[p.arch];
        this._e.set(p.tx, p.rotY, p.tz);
        this._q.setFromEuler(this._e);
        this._m4.compose(this._v.set(p.x, p.y, p.z), this._q, this._vs.set(p.s, p.sy, p.s));
        mesh.setMatrixAt(idx, this._m4);
        mesh.setColorAt(idx, this._c.setScalar(p.shade));
      }
    }
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].count = counts[i];
      this.meshes[i].instanceMatrix.needsUpdate = true;
      if (this.meshes[i].instanceColor) this.meshes[i].instanceColor.needsUpdate = true;
    }
  }

  _genGrassCell(cx, cz) {
    const rng = this.field.cellRng(cx, cz, 'grass');
    const out = [];
    const density = THREE.MathUtils.clamp(this.def?.floraDensity ?? 0.5, 0, 1);
    const seaY = this.field.seaY;
    const n = Math.round(this.grass.perCell * (0.35 + 0.75 * density) * rng.range(0.8, 1.1));
    for (let i = 0; i < n; i++) {
      const x = (cx + rng.next()) * CELL, z = (cz + rng.next()) * CELL;
      const s = rng.range(0.65, 1.45);
      const rotY = rng.range(0, Math.PI * 2);
      const hueT = rng.range(0, 1);
      const y = this.field.height(x, z);
      if (y < seaY + 0.3) continue;
      if (this.field.normal(x, z).y < 0.62) continue;
      const m = THREE.MathUtils.clamp(this.field.moisture(x, z), 0, 1);
      const c = this.grass.cA.clone().lerp(this.grass.cB, (1 - m) * 0.8 + hueT * 0.2);
      out.push({ x, y, z, s, rotY, r: c.r, g: c.g, b: c.b });
    }
    return out;
  }

  _streamGrass(focusPos) {
    const r = GRASS_RADIUS;
    const c0x = Math.floor((focusPos.x - r) / CELL), c1x = Math.floor((focusPos.x + r) / CELL);
    const c0z = Math.floor((focusPos.z - r) / CELL), c1z = Math.floor((focusPos.z + r) / CELL);
    const want = new Set();
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const k = `${cx}:${cz}`;
        want.add(k);
        if (!this.grassCells.has(k)) this.grassCells.set(k, this._genGrassCell(cx, cz));
      }
    }
    for (const k of this.grassCells.keys()) if (!want.has(k)) this.grassCells.delete(k);

    const mesh = this.grassMesh;
    let idx = 0;
    const r2 = r * r;
    for (const list of this.grassCells.values()) {
      for (const p of list) {
        if (idx >= GRASS_CAP) break;
        const dx = p.x - focusPos.x, dz = p.z - focusPos.z;
        if (dx * dx + dz * dz > r2) continue;
        this._e.set(0, p.rotY, 0);
        this._q.setFromEuler(this._e);
        this._m4.compose(this._v.set(p.x, p.y, p.z), this._q, this._vs.set(p.s, p.s, p.s));
        mesh.setMatrixAt(idx, this._m4);
        mesh.setColorAt(idx, this._c.setRGB(p.r, p.g, p.b));
        idx++;
      }
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Nearest harvestable flora instance within radius of pos.
   * @param {THREE.Vector3} pos
   * @param {number} radius metres
   * @returns {{id: string, itemId: string, position: THREE.Vector3} | null}
   */
  collectableAt(pos, radius) {
    let best = null, bestD2 = radius * radius;
    for (const list of this.cells.values()) {
      for (const p of list) {
        if (!p.collect || this.removed.has(p.id)) continue;
        const dx = p.x - pos.x, dy = p.y + 0.6 * p.sy - pos.y, dz = p.z - pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = p; }
      }
    }
    if (!best) return null;
    return {
      id: best.id, itemId: best.collect,
      position: new THREE.Vector3(best.x, best.y + 0.6 * best.sy, best.z),
    };
  }

  /**
   * Remove a harvested instance (stays removed for this session).
   * @param {string} id id from collectableAt
   */
  removeInstance(id) {
    if (this.removed.has(id)) return;
    this.removed.add(id);
    this._dirty = true;
    this._rebuild();
  }

  /** Remove meshes from the scene and free GPU resources. */
  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    if (this.grassMesh) {
      this.scene.remove(this.grassMesh);
      this.grassGeo.dispose();
      this.grassMat.dispose();
      this.grassTex.dispose();
      this.grassMesh.dispose();
    }
    this.material.dispose();
    this.cells.clear();
    this.grassCells.clear();
  }
}
