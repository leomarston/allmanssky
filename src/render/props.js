// World props — ruins, beacons, outposts, crashed ships, resource nodes and
// landing pads. Each builder is deterministic from the passed RNG and returns
// { object3d, interactRadius, kind } (plus dispose()); the surface state
// positions them on the terrain. Everything procedural: canvas glyph textures,
// jittered low-poly geometry, HDR emissive accents that feed bloom.
import * as THREE from 'three';

/** Fallback tints for the 12 base resources (mirrors gameplay/items.js). */
const ITEM_COLORS = {
  ferrox: '#b8722c', carbyne: '#5fd068', oxylite: '#ff5f5f', silica: '#e8dcc0',
  pyrene: '#ffd04a', voidsalt: '#9d7bff', aurium: '#ffc94d', cryostal: '#7de8ff',
  solanite: '#ff8c3a', chlorophane: '#8cff5f', voltglass: '#5fb4ff', nebulite: '#ff6fd8',
};

const FACTION_COLORS = {
  meridian: 0xffb454, chorale: 0x7de8ff, sunward: 0xff8c3a,
  ashen: 0xff5470, none: 0x7dffb4,
};

// ------------------------------------------------------------------- helpers

function jitterGeo(geo, rng, amt) {
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

function stoneMat(hex, rough = 0.95) {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0.04, flatShading: true });
}

function metalMat(hex, rough = 0.5, metal = 0.6) {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
}

/** Unlit HDR glow material (color components > 1 feed bloom). */
function glowMat(hex, intensity, opts = {}) {
  const c = new THREE.Color(hex).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({ color: c, ...opts });
}

function put(group, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (Array.isArray(s)) m.scale.set(...s); else m.scale.setScalar(s);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/** Vertical strip of Luminel glyph marks — white on black canvas. */
function glyphTexture(rng, w = 32, h = 256) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  let y = 8;
  while (y < h - 10) {
    if (rng.chance(0.82)) {
      const kind = rng.int(0, 3);
      const cxp = w / 2;
      if (kind === 0) g.fillRect(cxp - 6, y, 12, 3);                    // bar
      else if (kind === 1) { g.fillRect(cxp - 2, y, 4, 10); }           // stem
      else if (kind === 2) {                                           // ring
        g.beginPath(); g.arc(cxp, y + 5, 4.5, 0, Math.PI * 2);
        g.lineWidth = 2.4; g.strokeStyle = '#fff'; g.stroke();
      } else { g.fillRect(cxp - 6, y, 5, 5); g.fillRect(cxp + 1, y + 4, 5, 5); } // dots
      y += rng.int(12, 20);
    } else y += rng.int(8, 16);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Glowing glyph strip plane (dark band, HDR glyphs). */
function glyphStrip(rng, width, height, intensity = 2.6, hex = 0xbfeaff) {
  const tex = glyphTexture(rng);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: new THREE.Color(hex).multiplyScalar(intensity),
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}

function taperBox(rng, w, h, d, taper = 0.72, jit = 0.05) {
  const geo = new THREE.BoxGeometry(w, h, d, 1, 2, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) / h + 0.5); // 0 bottom → 1 top
    const k = 1 - (1 - taper) * t;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  jitterGeo(geo, rng, jit);
  return geo;
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.map?.dispose();
        m.dispose();
      }
    }
  });
}

function result(group, interactRadius, kind) {
  return { object3d: group, interactRadius, kind, dispose: () => disposeGroup(group) };
}

// ------------------------------------------------------------------ builders

/**
 * Weathered Luminel monolith cluster with an arch and glowing glyph strips.
 * @param {import('../core/rng.js').RNG} rng
 * @returns {{object3d: THREE.Group, interactRadius: number, kind: string, dispose: Function}}
 */
export function createRuin(rng) {
  const group = new THREE.Group();
  const stone = stoneMat(new THREE.Color(0x33363f).offsetHSL(rng.range(-0.03, 0.05), rng.range(0, 0.05), rng.range(-0.03, 0.03)));

  const nMono = rng.int(3, 5);
  const ringR = rng.range(3.2, 5);
  for (let i = 0; i < nMono; i++) {
    const a = (i / nMono) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const h = rng.range(3.2, 6.2), w = rng.range(0.9, 1.5), d = rng.range(0.55, 0.8);
    const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR;
    const mono = put(group, taperBox(rng, w, h, d), stone, x, h / 2 - 0.55, z,
      rng.range(-0.06, 0.06), -a + Math.PI / 2 + rng.range(-0.2, 0.2), rng.range(-0.07, 0.07));
    if (rng.chance(0.8)) {
      const strip = glyphStrip(rng, 0.26, h * 0.62, rng.range(2.2, 3.2));
      strip.position.set(0, h * 0.05, d / 2 + 0.03);
      mono.add(strip);
    }
  }

  // arch — two pillars and a lintel
  const aA = rng.range(0, Math.PI * 2);
  const ax = Math.cos(aA) * (ringR + 2.2), az = Math.sin(aA) * (ringR + 2.2);
  const ah = rng.range(4, 5.2);
  const p1 = put(group, taperBox(rng, 1, ah, 0.9, 0.85), stone, ax - 1.4, ah / 2 - 0.5, az, 0, -aA, rng.range(-0.04, 0.04));
  put(group, taperBox(rng, 1, ah, 0.9, 0.85), stone, ax + 1.4, ah / 2 - 0.5, az, 0, -aA, rng.range(-0.04, 0.04));
  put(group, taperBox(rng, 3.9, 0.85, 1.05, 0.92), stone, ax, ah - 0.35, az, 0, -aA, rng.range(-0.03, 0.03));
  const archStrip = glyphStrip(rng, 0.3, ah * 0.55, 2.8);
  archStrip.position.set(0, 0, 0.5);
  p1.add(archStrip);

  // fallen slab, half sunk
  put(group, taperBox(rng, 1.1, rng.range(2.6, 4), 0.7, 0.8, 0.08), stone,
    rng.range(-2, 2), 0.1, rng.range(-2, 2), Math.PI / 2 - 0.12, rng.range(0, Math.PI * 2), 0);

  // scattered rubble
  for (let i = 0; i < 5; i++) {
    const r = rng.range(0.25, 0.55);
    put(group, jitterGeo(new THREE.IcosahedronGeometry(r, 0), rng, r * 0.25), stone,
      rng.range(-ringR, ringR), r * 0.3, rng.range(-ringR, ringR), 0, rng.range(0, 3), 0);
  }
  return result(group, 7, 'ruin');
}

/**
 * Tall Luminel obelisk with a pulsing HDR crystal apex and a floating ring.
 * @param {import('../core/rng.js').RNG} rng
 */
export function createBeacon(rng) {
  const group = new THREE.Group();
  const stone = stoneMat(0x2c3038, 0.85);
  const h = rng.range(6.2, 8.4);

  // stepped base
  put(group, new THREE.CylinderGeometry(2.3, 2.7, 0.5, 8), stone, 0, 0.05, 0);
  put(group, new THREE.CylinderGeometry(1.55, 1.85, 0.45, 8), stone, 0, 0.5, 0, 0, Math.PI / 8, 0);

  // obelisk — 4-sided tapered shaft
  const shaft = put(group, jitterGeo(new THREE.CylinderGeometry(0.34, 0.8, h, 4, 3), rng, 0.03),
    stone, 0, h / 2 + 0.6, 0, 0, Math.PI / 4, 0);
  for (let i = 0; i < 2; i++) {
    const strip = glyphStrip(rng, 0.22, h * 0.7, 3.0);
    strip.position.set(0, 0, 0.42);
    strip.rotation.y = i * Math.PI;
    shaft.add(strip);
  }

  // apex crystal (pulses) + floating ring (slow spin) — self-animating via
  // onBeforeRender so no update() contract is needed on props.
  const apexBase = new THREE.Color(0x9fe8ff);
  const apexMat = glowMat(0x9fe8ff, 2.6);
  const apexGeo = new THREE.OctahedronGeometry(0.55, 0);
  apexGeo.scale(1, 1.9, 1);
  const apex = put(group, apexGeo, apexMat, 0, h + 1.35, 0);
  apex.castShadow = false;

  const ringMat = glowMat(0x7de8ff, 1.9);
  const ring = put(group, new THREE.TorusGeometry(1.25, 0.055, 6, 28), ringMat, 0, h + 1.35, 0, Math.PI / 2);
  ring.castShadow = false;
  const phase = rng.range(0, Math.PI * 2);
  apex.onBeforeRender = () => {
    const t = performance.now() * 0.001 + phase;
    apexMat.color.copy(apexBase).multiplyScalar(2.0 + 0.9 * Math.sin(t * 2.2));
    apex.rotation.y = t * 0.5;
    ring.rotation.z = t * 0.4;
    ring.position.y = h + 1.35 + Math.sin(t * 1.3) * 0.18;
  };
  return result(group, 6, 'beacon');
}

/**
 * Small habitat cluster — dome modules, corridor, antenna, solar panel and
 * faction-colored light strips + landing light.
 * @param {import('../core/rng.js').RNG} rng
 * @param {string} faction 'meridian'|'chorale'|'sunward'|'ashen'|'none'
 */
export function createOutpost(rng, faction = 'none') {
  const group = new THREE.Group();
  const fc = FACTION_COLORS[faction] ?? FACTION_COLORS.none;
  const hull = metalMat(0x8f98a3, 0.55, 0.5);
  const hullDark = metalMat(0x4b525c, 0.6, 0.55);
  const trim = glowMat(fc, 1.9);

  const modules = rng.int(2, 3);
  const dir = rng.range(0, Math.PI * 2);
  let prev = null;
  for (let i = 0; i < modules; i++) {
    const r = rng.range(1.8, 2.5) * (i === 0 ? 1.15 : 0.9);
    const x = Math.cos(dir) * i * 5.2 + (i ? rng.range(-1, 1) : 0);
    const z = Math.sin(dir) * i * 5.2 + (i ? rng.range(-1, 1) : 0);
    put(group, new THREE.CylinderGeometry(r, r * 1.06, 1.9, 12), hull, x, 0.95, z);
    const domeGeo = new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    put(group, domeGeo, hullDark, x, 1.9, z);
    // faction light band
    const band = put(group, new THREE.TorusGeometry(r + 0.03, 0.05, 4, 20), trim, x, 1.55, z, Math.PI / 2);
    band.castShadow = false;
    // corridor to previous module
    if (prev) {
      const dx = x - prev.x, dz = z - prev.z;
      const len = Math.hypot(dx, dz);
      put(group, new THREE.BoxGeometry(1.3, 1.5, len - 2), hullDark,
        (x + prev.x) / 2, 0.85, (z + prev.z) / 2, 0, -Math.atan2(dz, dx) + Math.PI / 2, 0);
    }
    prev = { x, z };
  }

  // door on the main module + light above
  const doorA = dir + Math.PI;
  put(group, new THREE.BoxGeometry(1.1, 1.5, 0.14), hullDark,
    Math.cos(doorA) * 2.5, 0.85, Math.sin(doorA) * 2.5, 0, -doorA + Math.PI / 2, 0);
  const doorLight = put(group, new THREE.BoxGeometry(0.7, 0.1, 0.1), trim,
    Math.cos(doorA) * 2.56, 1.75, Math.sin(doorA) * 2.56, 0, -doorA + Math.PI / 2, 0);
  doorLight.castShadow = false;

  // antenna mast
  const mx = Math.cos(dir + 1.9) * 3.2, mz = Math.sin(dir + 1.9) * 3.2;
  put(group, new THREE.CylinderGeometry(0.05, 0.09, 5.4, 5), hullDark, mx, 2.7, mz);
  put(group, new THREE.BoxGeometry(1.5, 0.05, 0.05), hullDark, mx, 4.4, mz, 0, rng.range(0, 3), 0);
  put(group, new THREE.BoxGeometry(1.0, 0.05, 0.05), hullDark, mx, 5.0, mz, 0, rng.range(0, 3), 0);
  const tip = put(group, new THREE.SphereGeometry(0.09, 6, 5), glowMat(0xff5f5f, 2.4), mx, 5.5, mz);
  tip.castShadow = false;

  // solar panel on a pole
  const px = Math.cos(dir - 1.7) * 3.6, pz = Math.sin(dir - 1.7) * 3.6;
  put(group, new THREE.CylinderGeometry(0.07, 0.1, 1.8, 5), hullDark, px, 0.9, pz);
  const panel = put(group, new THREE.BoxGeometry(2.6, 0.08, 1.6), metalMat(0x1d2c4e, 0.35, 0.7),
    px, 1.9, pz, -0.5, dir, 0);
  panel.castShadow = true;

  // landing light pole
  const lx = Math.cos(dir + 0.9) * 4.4, lz = Math.sin(dir + 0.9) * 4.4;
  put(group, new THREE.CylinderGeometry(0.05, 0.07, 1.5, 5), hullDark, lx, 0.75, lz);
  const lamp = put(group, new THREE.BoxGeometry(0.22, 0.22, 0.22), glowMat(fc, 2.6), lx, 1.55, lz);
  lamp.castShadow = false;

  // supply crates
  for (let i = 0; i < rng.int(2, 3); i++) {
    const s = rng.range(0.5, 0.8);
    put(group, new THREE.BoxGeometry(s, s, s), hullDark,
      rng.range(-4, 4), s / 2, rng.range(-4, 4), 0, rng.range(0, 3), 0);
  }
  return result(group, 8, 'outpost');
}

/**
 * Broken fuselage half-buried in the ground with scattered debris and
 * static HDR spark bits.
 * @param {import('../core/rng.js').RNG} rng
 */
export function createCrashedShip(rng) {
  const group = new THREE.Group();
  const paint = new THREE.Color().setHSL(rng.next(), rng.range(0.2, 0.45), rng.range(0.22, 0.35));
  const hull = metalMat(paint, 0.7, 0.55);
  const scorched = metalMat(0x23262b, 0.9, 0.35);

  // main fuselage, nose pitched into the dirt
  const fusGeo = new THREE.CylinderGeometry(0.85, 1.15, 6.4, 9, 3);
  // mangle the rear rim
  const fp = fusGeo.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    if (fp.getY(i) < -2.6) {
      fp.setXYZ(i, fp.getX(i) * rng.range(0.5, 1.2), fp.getY(i) + rng.range(-0.5, 0.3), fp.getZ(i) * rng.range(0.5, 1.2));
    }
  }
  fusGeo.computeVertexNormals();
  const fus = put(group, fusGeo, hull, 0, 0.62, 0, Math.PI / 2 - 0.22, 0, rng.range(-0.15, 0.15));
  fus.rotation.order = 'ZYX';

  // nose cone, buried
  put(group, new THREE.ConeGeometry(0.85, 2.2, 9), hull, 0, 0.02, 3.6, Math.PI / 2 + 0.35, 0, 0);

  // stub wing + torn-off wing lying nearby
  put(group, new THREE.BoxGeometry(2.4, 0.14, 1.5), hull, 1.6, 0.7, 0.4, 0, 0.2, rng.range(0.15, 0.3));
  put(group, new THREE.BoxGeometry(3.4, 0.14, 1.7), scorched,
    rng.range(-5, -3.4), 0.12, rng.range(-1.5, 1.5), rng.range(-0.15, 0.15), rng.range(0, 3), rng.range(-0.2, 0.2));

  // tail fin on the broken rear
  put(group, new THREE.BoxGeometry(0.12, 1.4, 1.1), hull, 0, 1.6, -2.6, -0.5, 0, rng.range(-0.3, 0.3));

  // engine ring, dead and dark
  put(group, new THREE.TorusGeometry(0.6, 0.16, 6, 12), scorched, 0, 0.7, -3.1, 0.25, 0, 0);

  // debris field
  for (let i = 0; i < rng.int(4, 7); i++) {
    const s = rng.range(0.2, 0.55);
    put(group, jitterGeo(new THREE.IcosahedronGeometry(s, 0), rng, s * 0.3), rng.chance(0.5) ? hull : scorched,
      rng.range(-5, 5), s * 0.35, rng.range(-4.5, 4.5), rng.range(0, 3), rng.range(0, 3), 0);
  }

  // static spark bits at the break — tiny HDR shards
  const sparkMat = glowMat(0xffb36b, 3.2);
  for (let i = 0; i < 4; i++) {
    const sp = put(group, new THREE.OctahedronGeometry(rng.range(0.045, 0.09), 0), sparkMat,
      rng.range(-0.7, 0.7), rng.range(0.5, 1.4), -2.9 + rng.range(-0.4, 0.4), rng.range(0, 3), rng.range(0, 3), 0);
    sp.castShadow = false;
  }
  // faint burnt glow inside the split hull
  const emberGlow = put(group, new THREE.SphereGeometry(0.34, 6, 5), glowMat(0xff6a2a, 1.6), 0, 0.6, -2.8);
  emberGlow.castShadow = false;
  return result(group, 7, 'crash');
}

/**
 * Faceted ore/crystal cluster tinted and emissive by item color.
 * @param {string} itemId resource id (see ITEM_COLORS fallback)
 * @param {import('../core/rng.js').RNG} rng
 * @param {string} [colorHex] optional explicit color override (e.g. from ITEMS)
 */
export function createResourceNode(itemId, rng, colorHex) {
  const group = new THREE.Group();
  const c = new THREE.Color(colorHex ?? ITEM_COLORS[itemId] ?? '#9adcff');
  const rocky = itemId === 'ferrox' || itemId === 'silica';

  const rockMat = stoneMat(new THREE.Color(0x554e44).lerp(c, 0.16));
  const crysMat = new THREE.MeshStandardMaterial({
    color: c.clone().multiplyScalar(0.28), emissive: c,
    emissiveIntensity: rocky ? 0.9 : rng.range(1.25, 1.7),
    roughness: 0.32, metalness: 0.1, flatShading: true,
  });

  // base rocks
  const nRock = rocky ? 3 : 2;
  for (let i = 0; i < nRock; i++) {
    const r = rng.range(0.55, 1.0) * (rocky ? 1.2 : 1);
    put(group, jitterGeo(new THREE.IcosahedronGeometry(r, 1), rng, r * 0.22), rockMat,
      rng.range(-0.8, 0.8), r * 0.35, rng.range(-0.8, 0.8), 0, rng.range(0, 3), 0);
  }

  // crystal shards fanning out of the rock
  const nCry = rocky ? rng.int(3, 5) : rng.int(5, 8);
  for (let i = 0; i < nCry; i++) {
    const len = rng.range(0.7, rocky ? 1.3 : 2.2);
    const geo = new THREE.OctahedronGeometry(rng.range(0.16, 0.3), 0);
    geo.scale(1, len / 0.3, 1);
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0.1, 0.9);
    const sh = put(group, geo, crysMat,
      Math.cos(a) * rr, len * 0.42, Math.sin(a) * rr,
      Math.cos(a) * rng.range(0.1, 0.5), rng.range(0, 3), -Math.sin(a) * rng.range(0.1, 0.5));
    sh.castShadow = false;
  }
  return result(group, 5, 'node');
}

/**
 * Octagonal landing pad with HDR edge lights and a center marker ring.
 * @param {import('../core/rng.js').RNG} rng
 */
export function createLandingPad(rng) {
  const group = new THREE.Group();
  const base = metalMat(0x2f353c, 0.7, 0.5);
  const plate = metalMat(0x434b55, 0.55, 0.55);

  put(group, new THREE.CylinderGeometry(5.7, 6.3, 0.65, 8), base, 0, 0.28, 0);
  put(group, new THREE.CylinderGeometry(5.25, 5.25, 0.14, 8), plate, 0, 0.66, 0);

  // edge lights at the 8 rim vertices (warm amber or cool cyan per pad)
  const lightMat = glowMat(rng.chance(0.7) ? 0xffb454 : 0x7de8ff, rng.range(2.1, 2.6));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const l = put(group, new THREE.BoxGeometry(0.3, 0.22, 0.3), lightMat,
      Math.cos(a) * 5.35, 0.72, Math.sin(a) * 5.35, 0, -a, 0);
    l.castShadow = false;
  }

  // center marker ring + dot (slightly above the plate to avoid z-fighting)
  const ringMat = glowMat(0x7de8ff, 1.25, { side: THREE.DoubleSide });
  const ring = put(group, new THREE.RingGeometry(2.15, 2.5, 8), ringMat, 0, 0.745, 0, -Math.PI / 2, 0, Math.PI / 8);
  ring.castShadow = false; ring.receiveShadow = false;
  const dot = put(group, new THREE.CircleGeometry(0.55, 8), ringMat, 0, 0.745, 0, -Math.PI / 2);
  dot.castShadow = false; dot.receiveShadow = false;

  // support feet
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    put(group, new THREE.BoxGeometry(0.5, 0.5, 0.9), base, Math.cos(a) * 5.55, -0.05, Math.sin(a) * 5.55, 0, -a, 0);
  }
  return result(group, 9, 'pad');
}
