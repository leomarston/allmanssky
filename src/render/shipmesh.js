// Procedural ship + station meshes. Modular kit-bash construction: lofted
// superellipse fuselages, extruded wing planforms, engine nacelles with HDR
// glow nozzles, canvas-painted PBR hulls (panel lines, stripes, wear, decals).
// Everything is deterministic from the seed; zero external assets.
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';

/* ------------------------------------------------------------------ const */

const FACTION_COLORS = {
  meridian: 0xffb454, // Meridian Combine — amber
  chorale: 0x7de8ff,  // Choir of Glass — cyan
  sunward: 0xff7a52,  // Sunward Kin — ember orange
  ashen: 0xff5470,    // Ashen Fleet — warning red
  none: 0x9ab8c8,     // unaligned — cold steel
};

const ENGINE_COLORS = {
  swift: 0x6fd8ff,
  talon: 0xff8a4d,
  dray: 0xffc46b,
  prospect: 0x8dffb0,
  vanta: 0xb37dff,
};

const NAME_A = ['Vesper', 'Aurel', 'Solace', 'Kestrel', 'Ember', 'Halcyon', 'Nadir', 'Zephyr', 'Lumen', 'Sable', 'Corvid', 'Ilex'];
const NAME_B = ['Lark', 'Warden', 'Runner', 'Chord', 'Djinn', 'Petrel', 'Vagrant', 'Spire', 'Wake', 'Errant', 'Sky', 'Sojourn'];

/* ------------------------------------------------------------------ utils */

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** hsl → THREE.Color (keeps albedo well-formed, ≤ 1). */
function hsl(h, s, l) {
  const c = new THREE.Color();
  c.setHSL(((h % 1) + 1) % 1, clamp01(s), clamp01(l), THREE.SRGBColorSpace);
  return c;
}

function cssOf(color, a = 1) {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Loft a fuselage from superellipse cross-sections.
 * sections: [{ z, w, h, y?, n? }] ordered nose→tail; n = squareness (2=ellipse,
 * 5+=boxy). UVs: u wraps the circumference, v runs along the length.
 */
function loftGeometry(sections, radial = 20) {
  const rows = sections.length;
  const verts = [], uvs = [], idx = [];
  for (let s = 0; s < rows; s++) {
    const sec = sections[s];
    const n = sec.n ?? 2.2;
    for (let r = 0; r <= radial; r++) {
      const a = (r / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const m = 1 / Math.pow(Math.pow(Math.abs(ca), n) + Math.pow(Math.abs(sa), n), 1 / n);
      verts.push(ca * m * sec.w, sa * m * sec.h + (sec.y || 0), sec.z);
      uvs.push(r / radial, s / (rows - 1));
    }
  }
  for (let s = 0; s < rows - 1; s++) {
    for (let r = 0; r < radial; r++) {
      const a = s * (radial + 1) + r, b = a + radial + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Rescale a geometry's UVs into [0,1] so extruded parts sample the whole paint. */
function normalizeUVs(geo) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  const su = maxU > minU ? 1 / (maxU - minU) : 1;
  const sv = maxV > minV ? 1 / (maxV - minV) : 1;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - minU) * su, (uv.getY(i) - minV) * sv);
  }
  return geo;
}

/**
 * Extruded wing slab from a planform polygon.
 * points: [[spanX, chordY]...] in the XY plane; extruded through `thickness`,
 * then laid flat so span runs +X and chord runs +Z (leading edge at z=0).
 */
function wingGeometry(points, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const bevel = Math.min(thickness * 0.45, 0.02);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(thickness - bevel * 2, 0.004),
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1,
  });
  geo.rotateX(Math.PI / 2);          // shape-Y (chord) → +Z, thickness → -Y
  geo.translate(0, thickness * 0.5, 0);
  normalizeUVs(geo);
  return geo;
}

/** Straight tapered wing planform helper. */
function planform(span, rootChord, tipChord, sweep, tipShear = 0.35) {
  return [
    [0, 0],
    [span, sweep],
    [span, sweep + tipChord],
    [span * tipShear, rootChord],
    [0, rootChord],
  ];
}

/* -------------------------------------------------------- paint textures */

/**
 * Procedural hull paint: base coat, panel lines, stripes, decals, wear.
 * Canvas x wraps the fuselage circumference (u), y runs nose→tail (v).
 */
function makePaintTexture(rng, pal, opts = {}) {
  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = cssOf(pal.base);
  ctx.fillRect(0, 0, W, H);

  // large tonal panels (subtle value shifts)
  const panels = rng.int(14, 22);
  for (let i = 0; i < panels; i++) {
    const x = rng.range(0, W), y = rng.range(0, H);
    const w = rng.range(30, 150), h = rng.range(24, 110);
    const lighter = rng.chance(0.5);
    ctx.fillStyle = lighter ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, y, w, h);
  }

  // secondary color blocking — nose cap and tail band
  ctx.fillStyle = cssOf(pal.secondary);
  const noseBand = rng.range(0.06, 0.14) * H;
  ctx.fillRect(0, 0, W, noseBand);
  const tailBand = rng.range(0.05, 0.12) * H;
  ctx.fillRect(0, H - tailBand, W, tailBand);
  if (rng.chance(0.6)) { // mid hull band
    const y = rng.range(0.35, 0.6) * H;
    ctx.fillRect(0, y, W, rng.range(14, 42));
  }

  // accent racing stripes along the spine (u≈0.25 is the top of the loft)
  const stripeCount = rng.int(1, 2);
  for (let i = 0; i < stripeCount; i++) {
    const cx = W * (0.25 + rng.range(-0.05, 0.05) + i * rng.range(0.05, 0.09));
    const sw = rng.range(7, 20);
    ctx.fillStyle = cssOf(pal.accent);
    ctx.fillRect(cx - sw / 2, 0, sw, H);
    if (rng.chance(0.6)) { // pinstripe companion
      ctx.fillRect(cx + sw * 1.1, 0, Math.max(2, sw * 0.22), H);
    }
    // mirror on the belly for symmetry when the hull rolls
    ctx.fillStyle = cssOf(pal.accent, 0.85);
    ctx.fillRect(W * 0.75 - sw / 2 + (cx - W * 0.25), 0, sw, H);
  }

  // panel seam lines
  ctx.strokeStyle = 'rgba(8,10,14,0.35)';
  ctx.lineWidth = 2;
  const vSeams = rng.int(7, 11);
  for (let i = 0; i < vSeams; i++) {
    const y = (i + rng.range(0.2, 0.8)) * (H / vSeams);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  const uSeams = rng.int(6, 10);
  for (let i = 0; i < uSeams; i++) {
    const x = (i + rng.range(0.2, 0.8)) * (W / uSeams);
    const y0 = rng.range(0, H * 0.5), y1 = y0 + rng.range(H * 0.2, H * 0.5);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
  }

  // fine seam detail + rivet dots
  ctx.strokeStyle = 'rgba(8,10,14,0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, W), y = rng.range(0, H);
    const len = rng.range(16, 90);
    ctx.beginPath();
    if (rng.chance(0.5)) { ctx.moveTo(x, y); ctx.lineTo(x + len, y); }
    else { ctx.moveTo(x, y); ctx.lineTo(x, y + len); }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(10,12,16,0.25)';
  for (let i = 0; i < 90; i++) {
    ctx.fillRect(rng.range(0, W), rng.range(0, H), 2, 2);
  }

  // faction-ish decal shapes: chevrons / roundel / tally bars
  const dx = rng.range(0.06, 0.36) * W, dy = rng.range(0.2, 0.42) * H;
  ctx.fillStyle = cssOf(pal.accent, 0.95);
  const decal = rng.int(0, 2);
  if (decal === 0) { // double chevron
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      const o = k * 26;
      ctx.moveTo(dx + o, dy); ctx.lineTo(dx + 18 + o, dy + 16); ctx.lineTo(dx + o, dy + 32);
      ctx.lineTo(dx + 9 + o, dy + 16); ctx.closePath(); ctx.fill();
    }
  } else if (decal === 1) { // roundel + tick
    ctx.beginPath(); ctx.arc(dx, dy, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = cssOf(pal.secondary);
    ctx.beginPath(); ctx.arc(dx, dy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = cssOf(pal.accent, 0.95);
    ctx.fillRect(dx + 22, dy - 3, 30, 6);
  } else { // registry tally bars
    for (let k = 0; k < rng.int(3, 5); k++) ctx.fillRect(dx + k * 12, dy, 6, 26);
  }

  // wear: scuffs and burnt streaks toward the tail
  for (let i = 0; i < 140; i++) {
    const y = H * (0.55 + 0.45 * rng.next() ** 0.6);
    const x = rng.range(0, W);
    ctx.fillStyle = `rgba(20,18,16,${rng.range(0.03, 0.12)})`;
    ctx.fillRect(x, y, rng.range(2, 14), rng.range(1, 3));
  }
  for (let i = 0; i < 60; i++) { // chipped paint glints
    ctx.fillStyle = `rgba(220,228,236,${rng.range(0.04, 0.1)})`;
    ctx.fillRect(rng.range(0, W), rng.range(0, H), rng.range(1, 5), 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* ----------------------------------------------------------- ship builder */

/** Per-ship material + part kit shared by the class assemblers. */
class ShipKit {
  constructor(rng, shipClass) {
    this.rng = rng;
    this.shipClass = shipClass;
    this.group = new THREE.Group();
    this.engineGlows = [];
    this._resources = new Set();

    // -- palette: curated 2–3 color scheme recipes, seed-tinted -------------
    const h = rng.next();
    const accH = h + rng.pick([0.5, 0.42, 0.58, 0.08, -0.08]);
    const exotic = shipClass === 'vanta';
    if (exotic) {
      this.pal = {
        base: hsl(h, 0.25, 0.11),
        secondary: hsl(h + 0.5, 0.3, 0.22),
        accent: hsl(accH, 0.85, 0.58),
      };
    } else {
      const scheme = rng.int(0, 3);
      this.pal =
        scheme === 0 ? { // light industrial: pale hull, dark blocking, hot accent
          base: hsl(h, rng.range(0.04, 0.1), rng.range(0.58, 0.68)),
          secondary: hsl(h + rng.range(-0.04, 0.04), rng.range(0.2, 0.35), rng.range(0.16, 0.24)),
          accent: hsl(accH, rng.range(0.78, 0.92), rng.range(0.5, 0.6)),
        } : scheme === 1 ? { // deep-tone hull, pale panels
          base: hsl(h, rng.range(0.28, 0.4), rng.range(0.2, 0.28)),
          secondary: hsl(h + rng.range(-0.03, 0.03), rng.range(0.08, 0.16), rng.range(0.5, 0.62)),
          accent: hsl(accH, rng.range(0.8, 0.92), rng.range(0.52, 0.62)),
        } : scheme === 2 ? { // off-white racer, two-tone trim
          base: hsl(h, rng.range(0.03, 0.07), rng.range(0.66, 0.74)),
          secondary: hsl(accH, rng.range(0.4, 0.55), rng.range(0.26, 0.34)),
          accent: hsl(accH, rng.range(0.8, 0.9), rng.range(0.5, 0.58)),
        } : { // muted color hull, charcoal blocking
          base: hsl(h, rng.range(0.18, 0.3), rng.range(0.38, 0.5)),
          secondary: hsl(h, rng.range(0.18, 0.28), rng.range(0.14, 0.2)),
          accent: hsl(accH, rng.range(0.75, 0.88), rng.range(0.52, 0.62)),
        };
    }

    // -- materials --------------------------------------------------------
    const paint = makePaintTexture(rng.fork('paint'), this.pal);
    this.hullMat = new THREE.MeshStandardMaterial({
      map: paint, metalness: 0.75, roughness: 0.35,
    });
    this.darkMat = new THREE.MeshStandardMaterial({
      color: 0x23282f, metalness: 0.85, roughness: 0.5,
    });
    this.trimMat = new THREE.MeshStandardMaterial({
      color: this.pal.accent.clone().multiplyScalar(0.8), metalness: 0.55, roughness: 0.5,
      envMapIntensity: 0.6,
    });
    const canopyTint = rng.pick([0x0a2733, 0x0c2030, 0x18240e, 0x2b1c0c]);
    this.canopyMat = new THREE.MeshStandardMaterial({
      color: canopyTint, metalness: 1.0, roughness: 0.06,
      transparent: true, opacity: 0.62,
      emissive: new THREE.Color(0x3fd6ff), emissiveIntensity: 0.22,
    });
    const eng = new THREE.Color(ENGINE_COLORS[shipClass] || 0x6fd8ff);
    eng.offsetHSL(rng.range(-0.03, 0.03), 0, 0);
    this.glowMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: eng, emissiveIntensity: 3.2,
    });
    this.accentGlowMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: this.pal.accent.clone(), emissiveIntensity: 2.2,
    });
    for (const m of [this.hullMat, this.darkMat, this.trimMat, this.canopyMat, this.glowMat, this.accentGlowMat]) {
      this._resources.add(m);
    }
    this._resources.add(paint);
  }

  _mesh(geo, mat, parent = this.group) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    this._resources.add(geo);
    parent.add(m);
    return m;
  }

  /** Lofted fuselage; sections in local units, nose at -z. */
  fuselage(sections, radial = 20) {
    return this._mesh(loftGeometry(sections, radial), this.hullMat);
  }

  /** Mirrored pair of extruded wings; returns [right, left]. */
  wingPair(points, thickness, y, z, dihedral = 0, mat = this.hullMat) {
    const geo = wingGeometry(points, thickness);
    const right = this._mesh(geo, mat);
    right.position.set(0, y, z);
    right.rotation.z = dihedral;
    const left = right.clone();
    left.scale.x = -1;
    this.group.add(left);
    return [right, left];
  }

  /** Canopy blister: squashed sphere with glassy tinted material. */
  canopy(len, w, h, y, z) {
    const geo = new THREE.SphereGeometry(1, 20, 12);
    const m = this._mesh(geo, this.canopyMat);
    m.scale.set(w, h, len);
    m.position.set(0, y, z);
    m.castShadow = false;
    // frame rail under the glass
    const rail = this._mesh(new THREE.SphereGeometry(1, 16, 8), this.darkMat);
    rail.scale.set(w * 1.06, h * 0.5, len * 1.05);
    rail.position.set(0, y - h * 0.42, z);
    return m;
  }

  /**
   * Engine nacelle: body + nozzle cone + HDR glow disc & rim.
   * The disc mesh is registered in engineGlows for flight code.
   */
  engine(r, len, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    this.group.add(g);
    const body = this._mesh(new THREE.CylinderGeometry(r, r * 0.92, len, 14), this.hullMat, g);
    body.rotation.x = Math.PI / 2;
    const intake = this._mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.0, len * 0.2, 14), this.trimMat, g);
    intake.rotation.x = Math.PI / 2;
    intake.position.z = -len * 0.45;
    const nozzle = this._mesh(new THREE.CylinderGeometry(r * 0.88, r * 0.7, len * 0.36, 14), this.darkMat, g);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = len * 0.6;
    const disc = this._mesh(new THREE.CircleGeometry(r * 0.62, 14), this.glowMat, g);
    disc.position.z = len * 0.74;
    disc.castShadow = false;
    const rim = this._mesh(new THREE.TorusGeometry(r * 0.64, r * 0.09, 6, 18), this.glowMat, g);
    rim.position.z = len * 0.75;
    rim.castShadow = false;
    this.engineGlows.push(disc);
    return g;
  }

  /** Vertical stabilizer fin. */
  fin(height, rootChord, tipChord, sweep, x, y, z, cant = 0) {
    const geo = wingGeometry(planform(height, rootChord, tipChord, sweep), 0.02);
    const m = this._mesh(geo, this.hullMat);
    m.position.set(x, y, z);
    m.rotation.z = Math.PI / 2 - cant;
    return m;
  }

  /** Landing skid: angled strut + foot pad. */
  skid(x, y, z, len = 0.16) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    this.group.add(g);
    const strut = this._mesh(new THREE.BoxGeometry(0.035, len, 0.05), this.darkMat, g);
    strut.position.y = -len / 2;
    strut.rotation.x = 0.25;
    const foot = this._mesh(new THREE.BoxGeometry(0.07, 0.025, 0.2), this.darkMat, g);
    foot.position.set(0, -len - 0.005, -len * 0.13);
    return g;
  }

  /** Whip antenna with a tiny emissive tip. */
  antenna(x, y, z, h = 0.2) {
    const rod = this._mesh(new THREE.CylinderGeometry(0.006, 0.009, h, 5), this.darkMat);
    rod.position.set(x, y + h / 2, z);
    const tip = this._mesh(new THREE.SphereGeometry(0.014, 6, 5), this.accentGlowMat);
    tip.position.set(x, y + h, z);
    tip.castShadow = false;
    return rod;
  }

  /** Small greeble boxes scattered on the spine for mechanical texture. */
  greebles(count, zMin, zMax, yAt) {
    for (let i = 0; i < count; i++) {
      const w = this.rng.range(0.04, 0.11);
      const b = this._mesh(new THREE.BoxGeometry(w, this.rng.range(0.02, 0.05), this.rng.range(0.05, 0.16)), this.darkMat);
      const z = this.rng.range(zMin, zMax);
      b.position.set(this.rng.range(-0.05, 0.05), yAt(z), z);
    }
  }

  dispose() {
    for (const r of this._resources) {
      if (r.dispose) r.dispose();
      if (r.map) r.map.dispose?.();
    }
    this._resources.clear();
  }
}

/* ----------------------------------------------------- class assemblers */

function buildSwift(kit) {
  const r = kit.rng;
  const L = 1.9 * r.range(0.95, 1.05);
  const half = L / 2;
  kit.fuselage([
    { z: -half, w: 0.015, h: 0.012 },
    { z: -half * 0.72, w: 0.075, h: 0.06, y: 0.005 },
    { z: -half * 0.3, w: 0.13, h: 0.1, y: 0.015 },
    { z: 0, w: 0.15, h: 0.115, y: 0.02, n: 2.5 },
    { z: half * 0.45, w: 0.135, h: 0.105, y: 0.02, n: 2.5 },
    { z: half * 0.85, w: 0.1, h: 0.085, y: 0.015 },
    { z: half, w: 0.02, h: 0.02, y: 0.01 },
  ]);
  kit.canopy(0.3, 0.095, 0.075, 0.1, -half * 0.42);
  // long elegant swept wings
  const span = r.range(0.95, 1.15);
  kit.wingPair(planform(span, 0.5, 0.13, 0.55), 0.028, 0.0, -0.15, 0.06);
  // wingtip trim blades
  const [wr, wl] = kit.wingPair(planform(0.1, 0.3, 0.16, 0.1), 0.02, 0.02, 0.42, 0, kit.trimMat);
  wr.position.x = span * 0.97; wl.position.x = -span * 0.97;
  kit.fin(0.32, 0.34, 0.1, 0.24, 0, 0.08, half * 0.55);
  kit.engine(0.085, 0.5, 0.2, 0.0, half * 0.72);
  kit.engine(0.085, 0.5, -0.2, 0.0, half * 0.72);
  kit.skid(0, -0.1, -half * 0.5, 0.12);
  kit.skid(0.24, -0.06, half * 0.35, 0.14);
  kit.skid(-0.24, -0.06, half * 0.35, 0.14);
  kit.antenna(0.03, 0.11, 0.1, 0.18);
  kit.greebles(4, 0.1, half * 0.7, () => 0.1);
}

function buildTalon(kit) {
  const r = kit.rng;
  const L = 1.8 * r.range(0.95, 1.05);
  const half = L / 2;
  kit.fuselage([
    { z: -half, w: 0.012, h: 0.01 },
    { z: -half * 0.68, w: 0.06, h: 0.055, y: 0.01 },
    { z: -half * 0.25, w: 0.11, h: 0.09, y: 0.02, n: 2.8 },
    { z: half * 0.1, w: 0.14, h: 0.1, y: 0.02, n: 3.2 },
    { z: half * 0.6, w: 0.13, h: 0.09, y: 0.015, n: 3 },
    { z: half, w: 0.05, h: 0.045, y: 0.01 },
  ], 18);
  kit.canopy(0.26, 0.08, 0.07, 0.095, -half * 0.35);
  // aggressive forward-swept wings
  const span = r.range(0.72, 0.85);
  kit.wingPair(planform(span, 0.55, 0.2, -0.48), 0.034, -0.01, 0.12, -0.06);
  // twin gun barrels under the wing roots
  for (const side of [1, -1]) {
    const barrel = kit._mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.62, 8), kit.darkMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(side * 0.24, -0.045, -half * 0.55);
    const muzzle = kit._mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 8), kit.trimMat);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(side * 0.24, -0.045, -half * 0.55 - 0.32);
    const mount = kit._mesh(new THREE.BoxGeometry(0.05, 0.07, 0.3), kit.darkMat);
    mount.position.set(side * 0.24, -0.02, -half * 0.4);
  }
  // twin canted tail fins
  kit.fin(0.26, 0.3, 0.08, 0.22, 0.09, 0.06, half * 0.5, 0.35);
  kit.fin(0.26, 0.3, 0.08, 0.22, -0.09, 0.06, half * 0.5, -0.35);
  kit.engine(0.075, 0.46, 0.11, 0.0, half * 0.78);
  kit.engine(0.075, 0.46, -0.11, 0.0, half * 0.78);
  kit.skid(0, -0.09, -half * 0.45, 0.11);
  kit.skid(0.2, -0.07, half * 0.3, 0.12);
  kit.skid(-0.2, -0.07, half * 0.3, 0.12);
  kit.antenna(-0.02, 0.1, 0.25, 0.16);
}

function buildDray(kit) {
  const r = kit.rng;
  const L = 2.3 * r.range(0.95, 1.05);
  const half = L / 2;
  kit.fuselage([
    { z: -half, w: 0.06, h: 0.05, y: 0.02, n: 3 },
    { z: -half * 0.75, w: 0.16, h: 0.13, y: 0.03, n: 4 },
    { z: -half * 0.3, w: 0.21, h: 0.17, y: 0.03, n: 5.5 },
    { z: half * 0.3, w: 0.22, h: 0.18, y: 0.03, n: 5.5 },
    { z: half * 0.75, w: 0.18, h: 0.15, y: 0.03, n: 4.5 },
    { z: half, w: 0.08, h: 0.08, y: 0.02, n: 3 },
  ], 18);
  kit.canopy(0.22, 0.1, 0.06, 0.2, -half * 0.62);
  // cargo container pods slung on side rails
  for (const side of [1, -1]) {
    const rail = kit._mesh(new THREE.BoxGeometry(0.05, 0.06, L * 0.62), kit.darkMat);
    rail.position.set(side * 0.26, -0.02, 0.08);
    for (let i = 0; i < 2; i++) {
      const pod = kit._mesh(new THREE.CapsuleGeometry(0.13, 0.42, 4, 10), kit.hullMat);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(side * 0.36, -0.02, -0.28 + i * 0.72);
      for (let k = -1; k <= 1; k++) { // strap rings
        const ring = kit._mesh(new THREE.TorusGeometry(0.135, 0.014, 5, 14), kit.trimMat);
        ring.position.set(side * 0.36, -0.02, -0.28 + i * 0.72 + k * 0.18);
      }
    }
  }
  // small winglets aft
  kit.wingPair(planform(0.34, 0.3, 0.12, 0.16), 0.03, 0.05, half * 0.4, 0.35);
  kit.fin(0.24, 0.28, 0.1, 0.16, 0, 0.15, half * 0.5);
  kit.engine(0.12, 0.55, 0.3, 0.02, half * 0.8);
  kit.engine(0.12, 0.55, -0.3, 0.02, half * 0.8);
  kit.engine(0.07, 0.4, 0, 0.16, half * 0.85);
  kit.skid(0.3, -0.14, -half * 0.5, 0.13);
  kit.skid(-0.3, -0.14, -half * 0.5, 0.13);
  kit.skid(0.3, -0.14, half * 0.45, 0.13);
  kit.skid(-0.3, -0.14, half * 0.45, 0.13);
  kit.antenna(0.06, 0.21, -half * 0.3, 0.22);
  kit.greebles(6, -half * 0.2, half * 0.6, () => 0.2);
}

function buildProspect(kit) {
  const r = kit.rng;
  const L = 2.0 * r.range(0.95, 1.05);
  const half = L / 2;
  kit.fuselage([
    { z: -half * 0.9, w: 0.05, h: 0.05, y: 0.0, n: 3 },
    { z: -half * 0.55, w: 0.13, h: 0.11, y: 0.01, n: 3.5 },
    { z: 0, w: 0.16, h: 0.13, y: 0.015, n: 4 },
    { z: half * 0.55, w: 0.15, h: 0.12, y: 0.015, n: 4 },
    { z: half, w: 0.06, h: 0.06, y: 0.01, n: 3 },
  ], 16);
  kit.canopy(0.24, 0.09, 0.065, 0.11, -half * 0.5);
  // exposed dorsal truss frame
  for (let i = 0; i < 5; i++) {
    const z = -half * 0.25 + i * (half * 0.28);
    const hoop = kit._mesh(new THREE.TorusGeometry(0.17, 0.016, 5, 12), kit.darkMat);
    hoop.position.set(0, 0.05, z);
  }
  const spine = kit._mesh(new THREE.CylinderGeometry(0.02, 0.02, half * 1.4, 6), kit.darkMat);
  spine.rotation.x = Math.PI / 2;
  spine.position.set(0, 0.22, half * 0.3);
  // saddle tanks (painted hull, accent straps)
  for (const side of [1, -1]) {
    const tank = kit._mesh(new THREE.CapsuleGeometry(0.1, 0.34, 4, 10), kit.hullMat);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(side * 0.22, 0.12, half * 0.35);
    for (const dz of [-0.09, 0.09]) {
      const strap = kit._mesh(new THREE.TorusGeometry(0.104, 0.012, 5, 12), kit.trimMat);
      strap.position.set(side * 0.22, 0.12, half * 0.35 + dz);
    }
  }
  // forward drill / beam emitter arms
  for (const side of [1, -1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.2, -0.05, -half * 0.55);
    kit.group.add(arm);
    const seg1 = kit._mesh(new THREE.BoxGeometry(0.05, 0.05, 0.4), kit.darkMat, arm);
    seg1.position.z = -0.2;
    const joint = kit._mesh(new THREE.SphereGeometry(0.045, 8, 6), kit.trimMat, arm);
    joint.position.z = -0.42;
    const seg2 = kit._mesh(new THREE.CylinderGeometry(0.028, 0.04, 0.3, 8), kit.darkMat, arm);
    seg2.rotation.x = Math.PI / 2;
    seg2.position.set(side * -0.04, 0, -0.58);
    const emitter = kit._mesh(new THREE.ConeGeometry(0.055, 0.12, 10), kit.trimMat, arm);
    emitter.rotation.x = -Math.PI / 2;
    emitter.position.set(side * -0.04, 0, -0.76);
    const tip = kit._mesh(new THREE.SphereGeometry(0.028, 8, 6), kit.accentGlowMat, arm);
    tip.position.set(side * -0.04, 0, -0.8);
    tip.castShadow = false;
  }
  // stub wings with equipment pylons
  kit.wingPair(planform(0.45, 0.36, 0.18, 0.14), 0.036, -0.01, 0.0, 0.1);
  kit.fin(0.22, 0.26, 0.1, 0.14, 0, 0.13, half * 0.55);
  kit.engine(0.1, 0.5, 0.22, 0.0, half * 0.75);
  kit.engine(0.1, 0.5, -0.22, 0.0, half * 0.75);
  kit.skid(0, -0.12, -half * 0.4, 0.12);
  kit.skid(0.24, -0.1, half * 0.35, 0.13);
  kit.skid(-0.24, -0.1, half * 0.35, 0.13);
  kit.antenna(-0.05, 0.1, -half * 0.15, 0.24);
}

function buildVanta(kit) {
  const r = kit.rng;
  const L = 2.1 * r.range(0.95, 1.05);
  const half = L / 2;
  kit.fuselage([
    { z: -half, w: 0.008, h: 0.008 },
    { z: -half * 0.6, w: 0.06, h: 0.055, y: 0.01, n: 1.9 },
    { z: -half * 0.15, w: 0.12, h: 0.1, y: 0.025, n: 2 },
    { z: half * 0.35, w: 0.14, h: 0.1, y: 0.02, n: 2.2 },
    { z: half * 0.8, w: 0.09, h: 0.07, y: 0.0, n: 2 },
    { z: half, w: 0.03, h: 0.025, y: -0.01 },
  ], 22);
  kit.canopy(0.34, 0.075, 0.06, 0.1, -half * 0.3);
  // asymmetric: one grand blade wing starboard, small canard port
  const [blade, bladeL] = kit.wingPair(planform(0.95, 0.6, 0.1, 0.7), 0.03, 0.01, -0.1, 0.12);
  blade.rotation.x = -0.04;
  bladeL.visible = false; // asymmetric: starboard blade only
  const canard = kit._mesh(wingGeometry(planform(0.4, 0.26, 0.08, -0.18), 0.024), kit.hullMat);
  canard.position.set(0, 0.03, -half * 0.35);
  canard.scale.x = -1;
  canard.rotation.z = -0.15;
  // offset dorsal fin, canted
  kit.fin(0.4, 0.42, 0.06, 0.42, 0.05, 0.06, half * 0.3, 0.25);
  // ventral keel blade
  const keel = kit.fin(0.18, 0.3, 0.06, 0.2, -0.03, -0.05, half * 0.4, Math.PI - 0.2);
  keel.rotation.z = -Math.PI / 2 + 0.2;
  // orb details on port-side pylon arc
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    const px = -0.28 - 0.1 * Math.sin(t * Math.PI);
    const pz = -0.25 + t * 0.62;
    const pylon = kit._mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.16, 6), kit.darkMat);
    pylon.rotation.z = Math.PI / 2 - 0.35;
    pylon.position.set(px + 0.09, 0.02, pz);
    const orb = kit._mesh(new THREE.SphereGeometry(0.042 - i * 0.007, 12, 9), kit.accentGlowMat);
    orb.position.set(px, 0.05, pz);
    orb.castShadow = false;
  }
  // wide single slot engine
  const slot = kit.engine(0.1, 0.5, 0.05, 0.0, half * 0.72);
  slot.scale.x = 1.9;
  kit.skid(0, -0.09, -half * 0.4, 0.11);
  kit.skid(0.2, -0.07, half * 0.3, 0.12);
  kit.skid(-0.2, -0.07, half * 0.3, 0.12);
  kit.antenna(0.02, 0.1, half * 0.05, 0.2);
}

const CLASS_BUILDERS = {
  swift: buildSwift,
  talon: buildTalon,
  dray: buildDray,
  prospect: buildProspect,
  vanta: buildVanta,
};

/**
 * Build a procedural ship of the given class.
 * Modular kit: lofted fuselage, glass canopy, class-specific wings/pods,
 * engine nacelles with HDR glow nozzles, landing skids, antennae, and a
 * seed-tinted painted hull (panel lines, stripes, wear, decals).
 *
 * @param {number} seed  deterministic world seed for this ship
 * @param {'swift'|'talon'|'dray'|'prospect'|'vanta'} shipClass
 * @returns {{ group: THREE.Group, engineGlows: THREE.Mesh[],
 *   profile: { class: string, name: string }, dispose: () => void }}
 *   engineGlows are nozzle meshes whose material.emissiveIntensity the
 *   flight code drives (idle ≈ 0.4, full burn ≈ 6).
 */
export function buildShip(seed, shipClass = 'swift') {
  const cls = CLASS_BUILDERS[shipClass] ? shipClass : 'swift';
  const rng = new RNG(hash32(seed | 0, hashString('ship'), hashString(cls)));
  const kit = new ShipKit(rng, cls);
  CLASS_BUILDERS[cls](kit);
  const name = `${rng.pick(NAME_A)} ${rng.pick(NAME_B)}`;
  kit.group.name = `ship:${cls}:${name}`;
  return {
    group: kit.group,
    engineGlows: kit.engineGlows,
    profile: { class: cls, name },
    dispose: () => kit.dispose(),
  };
}

/* ------------------------------------------------------------- station */

/** Station hull color + emissive window maps (drawn once per station). */
function makeStationMaps(rng, factionColor) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8b939e';
  ctx.fillRect(0, 0, W, H);
  // plating
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)';
    ctx.fillRect(rng.range(0, W), rng.range(0, H), rng.range(20, 90), rng.range(10, 40));
  }
  ctx.strokeStyle = 'rgba(10,12,16,0.4)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    const y = (i + 0.5) * (H / 10);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const x = (i + 0.5) * (W / 16);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  // faction trim bands
  ctx.fillStyle = cssOf(factionColor);
  ctx.fillRect(0, H * 0.08, W, 8);
  ctx.fillRect(0, H * 0.86, W, 6);

  const e = document.createElement('canvas');
  e.width = W; e.height = H;
  const ectx = e.getContext('2d');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  // window rows — warm interior lights, some dark
  for (let row = 0; row < 4; row++) {
    const y = H * (0.22 + row * 0.17);
    for (let x = 6; x < W - 6; x += 14) {
      if (rng.chance(0.62)) {
        ectx.fillStyle = rng.chance(0.85) ? 'rgba(255,214,150,0.95)' : 'rgba(150,220,255,0.9)';
        ectx.fillRect(x, y, 8, 5);
      }
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const emissiveMap = new THREE.CanvasTexture(e);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  return { map, emissiveMap };
}

/**
 * Build a grand orbital station (~46 units across): hub spindle + habitat
 * drum, rotating torus ring with spokes, docking arm ending in a lit bay,
 * solar arrays, blinking nav lights, faction-colored trim.
 *
 * @param {number} seed  deterministic seed
 * @param {'meridian'|'chorale'|'sunward'|'ashen'|'none'} faction
 * @returns {{ group: THREE.Group, dockPos: THREE.Vector3,
 *   update: (dt: number) => void, dispose: () => void }}
 *   dockPos is in the station group's local space (bay mouth).
 */
export function buildStation(seed, faction = 'none') {
  const rng = new RNG(hash32(seed | 0, hashString('station'), hashString(faction)));
  const group = new THREE.Group();
  group.name = `station:${faction}`;
  const resources = new Set();
  const factionColor = new THREE.Color(FACTION_COLORS[faction] || FACTION_COLORS.none);

  const { map, emissiveMap } = makeStationMaps(rng.fork('maps'), factionColor);
  resources.add(map); resources.add(emissiveMap);

  const hullMat = new THREE.MeshStandardMaterial({
    map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.9,
    metalness: 0.6, roughness: 0.5,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.8, roughness: 0.55 });
  const trimMat = new THREE.MeshStandardMaterial({ color: factionColor, metalness: 0.55, roughness: 0.4 });
  const trimGlowMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: factionColor, emissiveIntensity: 2.4,
  });
  const bayLightMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(1.0, 0.9, 0.7), emissiveIntensity: 3.0,
  });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x101d33, metalness: 0.9, roughness: 0.32 });
  for (const m of [hullMat, darkMat, trimMat, trimGlowMat, bayLightMat, panelMat]) resources.add(m);

  const add = (geo, mat, parent = group) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    resources.add(geo);
    parent.add(mesh);
    return mesh;
  };

  // -- central spindle + habitat drum -------------------------------------
  const spindle = add(new THREE.CylinderGeometry(2.6, 2.6, 30, 16), darkMat);
  spindle.name = 'spindle';
  const drum = add(new THREE.CylinderGeometry(7, 7, 9, 28), hullMat);
  drum.position.y = 0;
  const drumCapT = add(new THREE.CylinderGeometry(5, 7, 2.2, 28), darkMat);
  drumCapT.position.y = 5.6;
  const drumCapB = add(new THREE.CylinderGeometry(7, 5, 2.2, 28), darkMat);
  drumCapB.position.y = -5.6;
  // faction trim collars on the drum
  for (const y of [4.2, -4.2]) {
    const collar = add(new THREE.CylinderGeometry(7.12, 7.12, 0.5, 28), trimMat);
    collar.position.y = y;
  }
  // command sphere + dish at the top
  const command = add(new THREE.SphereGeometry(3.4, 20, 14), hullMat);
  command.position.y = 13.5;
  const dish = add(new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), darkMat);
  dish.position.y = 16.6;
  dish.rotation.z = 0.5;
  dish.name = 'dish';

  // -- rotating ring -------------------------------------------------------
  const ringGroup = new THREE.Group();
  group.add(ringGroup);
  const RING_R = 22;
  const torus = add(new THREE.TorusGeometry(RING_R, 2.1, 12, 72), hullMat, ringGroup);
  torus.rotation.x = Math.PI / 2;
  const spokes = 5;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const spoke = add(new THREE.CylinderGeometry(0.55, 0.75, RING_R - 2, 8), darkMat, ringGroup);
    spoke.position.set(Math.cos(a) * RING_R * 0.5, 0, Math.sin(a) * RING_R * 0.5);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = -a;
    // trim light strip riding the ring at each spoke root
    const strip = add(new THREE.BoxGeometry(1.6, 0.3, 0.35), trimGlowMat, ringGroup);
    strip.position.set(Math.cos(a) * (RING_R + 2.15), 0, Math.sin(a) * (RING_R + 2.15));
    strip.rotation.y = -a + Math.PI / 2;
    strip.castShadow = false;
  }

  // -- docking arm + bay ----------------------------------------------------
  const ARM_Y = -9, ARM_LEN = 20, BAY_W = 7, BAY_H = 5.4, BAY_D = 8;
  const armRoot = 6.5;
  const arm = add(new THREE.BoxGeometry(ARM_LEN, 2.0, 2.0), darkMat);
  arm.position.set(armRoot + ARM_LEN / 2, ARM_Y, 0);
  for (let i = 0; i < 4; i++) { // truss collars
    const collar = add(new THREE.BoxGeometry(0.7, 2.8, 2.8), trimMat);
    collar.position.set(armRoot + 3 + i * 4.6, ARM_Y, 0);
  }
  const bayX = armRoot + ARM_LEN;
  const bay = new THREE.Group();
  bay.position.set(bayX + BAY_D / 2, ARM_Y, 0);
  group.add(bay);
  // bay shell: dark plating box, mouth opens +X
  const shellT = 0.6;
  add(new THREE.BoxGeometry(BAY_D, shellT, BAY_W), darkMat, bay).position.y = -BAY_H / 2;
  add(new THREE.BoxGeometry(BAY_D, shellT, BAY_W), darkMat, bay).position.y = BAY_H / 2;
  const wallL = add(new THREE.BoxGeometry(BAY_D, BAY_H, shellT), darkMat, bay);
  wallL.position.z = BAY_W / 2;
  const wallR = add(new THREE.BoxGeometry(BAY_D, BAY_H, shellT), darkMat, bay);
  wallR.position.z = -BAY_W / 2;
  const back = add(new THREE.BoxGeometry(shellT, BAY_H, BAY_W), darkMat, bay);
  back.position.x = -BAY_D / 2 + shellT / 2;
  // faction trim frame around the mouth
  const frameT = add(new THREE.BoxGeometry(0.5, 0.5, BAY_W + 0.5), trimMat, bay);
  frameT.position.set(BAY_D / 2, BAY_H / 2 + 0.1, 0);
  const frameB = add(new THREE.BoxGeometry(0.5, 0.5, BAY_W + 0.5), trimMat, bay);
  frameB.position.set(BAY_D / 2, -BAY_H / 2 - 0.1, 0);
  for (const z of [BAY_W / 2 + 0.1, -BAY_W / 2 - 0.1]) {
    const frameV = add(new THREE.BoxGeometry(0.5, BAY_H + 0.9, 0.5), trimMat, bay);
    frameV.position.set(BAY_D / 2, 0, z);
  }
  // interior glow pad on the back wall + floor guide strip
  const padGlow = add(new THREE.PlaneGeometry(BAY_H * 0.7, BAY_W * 0.7), bayLightMat, bay);
  padGlow.position.x = -BAY_D / 2 + shellT + 0.05;
  padGlow.rotation.y = Math.PI / 2;
  padGlow.rotation.z = Math.PI / 2;
  padGlow.castShadow = false;
  const guide = add(new THREE.BoxGeometry(BAY_D * 0.85, 0.1, 0.4), trimGlowMat, bay);
  guide.position.y = -BAY_H / 2 + shellT / 2 + 0.08;
  guide.castShadow = false;
  // HDR strip lights rimming the mouth
  const mouthX = BAY_D / 2 - 0.1;
  const stripH = add(new THREE.BoxGeometry(0.22, 0.22, BAY_W), bayLightMat, bay);
  stripH.position.set(mouthX, BAY_H / 2 - 0.1, 0);
  const stripL = add(new THREE.BoxGeometry(0.22, 0.22, BAY_W), bayLightMat, bay);
  stripL.position.set(mouthX, -BAY_H / 2 + 0.1, 0);
  for (const z of [BAY_W / 2 - 0.1, -BAY_W / 2 + 0.1]) {
    const stripV = add(new THREE.BoxGeometry(0.22, BAY_H, 0.22), bayLightMat, bay);
    stripV.position.set(mouthX, 0, z);
    stripV.castShadow = false;
  }
  stripH.castShadow = stripL.castShadow = false;
  const dockPos = new THREE.Vector3(bayX + BAY_D + 1.5, ARM_Y, 0);

  // -- solar arrays ---------------------------------------------------------
  for (const sy of [1, -1]) {
    const boom = add(new THREE.CylinderGeometry(0.35, 0.35, 26, 8), darkMat);
    boom.position.y = sy * 11.5;
    boom.rotation.x = Math.PI / 2;
    for (const sz of [1, -1]) {
      for (let i = 0; i < 3; i++) {
        const panel = add(new THREE.BoxGeometry(5.4, 0.12, 3.4), panelMat);
        panel.position.set(0, sy * 11.5, sz * (5 + i * 4));
        const frame = add(new THREE.BoxGeometry(5.7, 0.08, 0.3), trimMat);
        frame.position.set(0, sy * 11.5 + 0.12, sz * (5 + i * 4));
      }
    }
  }

  // -- blinking nav lights ----------------------------------------------------
  const navLights = [];
  const mkNav = (x, y, z, colorHex, parent = group, speed = 1.6) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: new THREE.Color(colorHex), emissiveIntensity: 0,
    });
    resources.add(mat);
    const m = add(new THREE.SphereGeometry(0.32, 8, 6), mat, parent);
    m.position.set(x, y, z);
    m.castShadow = false;
    navLights.push({ mat, phase: rng.range(0, Math.PI * 2), speed });
    return m;
  };
  mkNav(0, 17.6, 0, 0xffffff, group, 1.1);
  mkNav(0, -15.6, 0, 0xff4455, group, 1.3);
  mkNav(dockPos.x - 0.5, ARM_Y + BAY_H / 2 + 0.6, 0, 0x66ff88, group, 2.2);
  mkNav(RING_R + 2.4, 0.8, 0, 0xff4455, ringGroup, 1.6);
  mkNav(-(RING_R + 2.4), 0.8, 0, 0x66ff88, ringGroup, 1.6);
  mkNav(0, 0.8, RING_R + 2.4, 0xffffff, ringGroup, 1.9);
  mkNav(0, 0.8, -(RING_R + 2.4), 0xffffff, ringGroup, 1.9);

  // -- animation -------------------------------------------------------------
  let t = rng.range(0, 100);
  const ringRate = rng.range(0.05, 0.085);
  function update(dt) {
    t += dt;
    ringGroup.rotation.y += dt * ringRate;
    dish.rotation.y += dt * 0.4;
    for (const nl of navLights) {
      const s = Math.sin(t * nl.speed + nl.phase);
      nl.mat.emissiveIntensity = Math.max(0, s) ** 10 * 5.0;
    }
  }

  function dispose() {
    for (const r of resources) r.dispose?.();
    resources.clear();
  }

  return { group, dockPos, update, dispose };
}
