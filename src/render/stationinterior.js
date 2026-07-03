// WIP — NOT YET WIRED. Foundation for the walkable-station feature (Wave 2).
// buildHangar() works and self-verifies, but the companion NPC crowd and the
// space-state "hangar" sub-mode that mounts it are not built yet, so nothing
// imports this module today. Kept as a head-start for resuming that feature.
//
// Walkable station hangar interior — the grand hall the player docks into.
// A ~70×30×18 m vaulted bay: procedural deck plating with glowing guide
// strips, a raised landing pad, a huge open bay mouth showing space (starfield
// panel + drifting nebula sprites), catwalk balconies, faction trim lights,
// three holographic terminal alcoves (TRADE / SHIPYARD / MISSIONS), cargo
// clutter, ceiling fans and rotating dock beacons. Zero external assets;
// deterministic from (seed, faction). Lighting discipline: ≤6 punctual lights,
// emissive strips + hemisphere fill carry the mood (HDR emissives feed bloom).
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';
import { FACTIONS } from '../universe/lore.js';

/* ------------------------------------------------------------------ layout */

const HALL_W = 30;            // x extent
const HALL_L = 70;            // z extent (bay mouth opens at +z)
const HALL_H = 18;
const HALF_W = HALL_W / 2;
const HALF_L = HALL_L / 2;
const PAD = { x: 2.5, z: 10, r: 6, h: 0.35 };   // landing pad
const MOUTH_W = 24;           // bay opening width
const MOUTH_H = 13;           // bay opening height

const HOLO_COLORS = { trade: 0xffb454, shipyard: 0x7de8ff, missions: 0x7dffb4 };

/* ------------------------------------------------------------------- utils */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function cssOf(color, a = 1) {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  return `rgba(${r},${g},${b},${a})`;
}

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function canvasTexture(c, { srgb = true, repeat = null } = {}) {
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}

/* ---------------------------------------------------------------- textures */

/** Dark deck plating: plate grid, tread hatch, scuffs, faction paint marks. */
function makeDeckTexture(rng, factionColor) {
  const [c, ctx] = canvas2d(512, 512);
  ctx.fillStyle = '#20242b';
  ctx.fillRect(0, 0, 512, 512);
  const cell = 512 / 6;
  for (let py = 0; py < 6; py++) {
    for (let px = 0; px < 6; px++) {
      const x = px * cell, y = py * cell;
      const v = rng.range(-0.05, 0.06);
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v * 1.6})`;
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      if (rng.chance(0.3)) { // tread hatch plate
        ctx.strokeStyle = 'rgba(255,255,255,0.035)';
        ctx.lineWidth = 3;
        for (let k = -6; k < 6; k++) {
          ctx.beginPath();
          ctx.moveTo(x + k * 14, y);
          ctx.lineTo(x + k * 14 + cell, y + cell);
          ctx.stroke();
        }
      }
    }
  }
  // plate seams
  ctx.strokeStyle = 'rgba(4,6,9,0.7)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 6; i++) {
    ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(512, i * cell); ctx.stroke();
  }
  // bolts at seam crossings
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      ctx.fillRect((i * cell + 8) % 512, (j * cell + 8) % 512, 3, 3);
      ctx.fillRect((i * cell - 11 + 512) % 512, (j * cell + 8) % 512, 3, 3);
    }
  }
  // faction paint: corner brackets and worn lane ticks
  ctx.strokeStyle = cssOf(factionColor, 0.20);
  ctx.lineWidth = 5;
  for (let i = 0; i < 5; i++) {
    const x = rng.range(30, 460), y = rng.range(30, 460), s = rng.range(18, 40);
    ctx.beginPath();
    ctx.moveTo(x, y + s); ctx.lineTo(x, y); ctx.lineTo(x + s, y);
    ctx.stroke();
  }
  // scuffs and oil
  for (let i = 0; i < 130; i++) {
    ctx.fillStyle = `rgba(8,9,12,${rng.range(0.06, 0.2)})`;
    ctx.fillRect(rng.range(0, 512), rng.range(0, 512), rng.range(3, 26), rng.range(1, 3));
  }
  for (let i = 0; i < 8; i++) {
    const x = rng.range(0, 512), y = rng.range(0, 512), r = rng.range(14, 44);
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

/** Wall paneling: big plates, vents, conduit runs. */
function makeWallTexture(rng) {
  const [c, ctx] = canvas2d(512, 512);
  ctx.fillStyle = '#333a44';
  ctx.fillRect(0, 0, 512, 512);
  // panel rows
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    let x = 0;
    const y = r * (512 / rows);
    while (x < 512) {
      const w = rng.range(70, 160);
      const v = rng.range(-0.06, 0.06);
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v * 1.5})`;
      ctx.fillRect(x + 2, y + 2, w - 4, 512 / rows - 4);
      if (rng.chance(0.25)) { // vent slats
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        const vw = Math.min(w * 0.6, 70), vh = 34;
        const vx = x + w / 2 - vw / 2, vy = y + 512 / rows / 2 - vh / 2;
        for (let s = 0; s < 5; s++) ctx.fillRect(vx, vy + s * 7, vw, 3.4);
      }
      x += w;
    }
  }
  ctx.strokeStyle = 'rgba(6,8,11,0.6)';
  ctx.lineWidth = 3;
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * (512 / rows)); ctx.lineTo(512, r * (512 / rows)); ctx.stroke();
  }
  // vertical conduits
  for (let i = 0; i < 5; i++) {
    const x = rng.range(20, 490);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, 0, 7, 512);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x + 1, 0, 2, 512);
  }
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(8,9,12,${rng.range(0.05, 0.14)})`;
    ctx.fillRect(rng.range(0, 512), rng.range(0, 512), rng.range(2, 18), rng.range(1, 3));
  }
  return c;
}

/** Landing pad top: faction ring, hazard ticks, chevron, heavy wear. */
function makePadTexture(rng, factionColor) {
  const [c, ctx] = canvas2d(512, 512);
  ctx.fillStyle = '#1b1f25';
  ctx.fillRect(0, 0, 512, 512);
  ctx.save();
  ctx.translate(256, 256);
  // radial plates
  ctx.strokeStyle = 'rgba(5,7,10,0.7)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(i / 12 * Math.PI * 2) * 256, Math.sin(i / 12 * Math.PI * 2) * 256);
    ctx.stroke();
  }
  for (const r of [70, 140, 205]) {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  }
  // faction ring + hazard ticks
  ctx.strokeStyle = cssOf(factionColor, 0.85);
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(0, 0, 225, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 12;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(0, 0, 243, a, a + 0.13);
    ctx.stroke();
  }
  // center chevron
  ctx.fillStyle = cssOf(factionColor, 0.55);
  ctx.beginPath();
  ctx.moveTo(0, -66); ctx.lineTo(46, 30); ctx.lineTo(0, 6); ctx.lineTo(-46, 30);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // burn wear
  for (let i = 0; i < 220; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0, 250);
    ctx.fillStyle = `rgba(6,7,9,${rng.range(0.06, 0.22)})`;
    ctx.fillRect(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, rng.range(2, 16), rng.range(1, 4));
  }
  return c;
}

/** Amber/charcoal diagonal hazard stripes. */
function makeHazardTexture(factionColor) {
  const [c, ctx] = canvas2d(128, 128);
  ctx.fillStyle = '#14161a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = cssOf(factionColor, 0.9);
  ctx.save();
  ctx.translate(64, 64);
  ctx.rotate(-Math.PI / 4);
  for (let i = -4; i <= 4; i++) ctx.fillRect(i * 32 - 8, -120, 16, 240);
  ctx.restore();
  return c;
}

/** Cargo crate faces: frame, faction band, stencil glyph, wear. */
function makeCrateTexture(rng, factionColor) {
  const [c, ctx] = canvas2d(256, 256);
  const base = rng.pick(['#3c4149', '#414a41', '#4a4238', '#39424c']);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(8,10,13,0.8)';
  ctx.lineWidth = 10;
  ctx.strokeRect(6, 6, 244, 244);
  ctx.lineWidth = 3;
  ctx.strokeRect(26, 26, 204, 204);
  // faction band
  ctx.fillStyle = cssOf(factionColor, 0.8);
  ctx.fillRect(26, rng.chance(0.5) ? 36 : 196, 204, 16);
  // stencil glyph
  ctx.fillStyle = 'rgba(220,228,236,0.35)';
  const gx = 128, gy = 128;
  if (rng.chance(0.5)) {
    ctx.beginPath();
    ctx.moveTo(gx - 26, gy + 18); ctx.lineTo(gx, gy - 22); ctx.lineTo(gx + 26, gy + 18);
    ctx.lineTo(gx + 12, gy + 18); ctx.lineTo(gx, gy - 2); ctx.lineTo(gx - 12, gy + 18);
    ctx.closePath(); ctx.fill();
  } else {
    for (let k = 0; k < 3; k++) ctx.fillRect(gx - 30 + k * 24, gy - 20, 12, 40);
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(10,11,14,${rng.range(0.08, 0.22)})`;
    ctx.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(2, 20), rng.range(1, 4));
  }
  return c;
}

/** Deep-space backdrop: point stars, a few glow stars, faint milky band. */
function makeStarTexture(rng) {
  const [c, ctx] = canvas2d(1024, 512);
  ctx.fillStyle = '#000105';
  ctx.fillRect(0, 0, 1024, 512);
  // faint galactic band
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const x = t * 1024;
    const y = 200 + Math.sin(t * 3.1) * 70 + rng.range(-40, 40);
    const r = rng.range(30, 90);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rng.int(70, 110)},${rng.int(80, 120)},${rng.int(120, 160)},0.05)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // stars
  for (let i = 0; i < 750; i++) {
    const x = rng.range(0, 1024), y = rng.range(0, 512);
    const r = rng.range(0.3, 1.3);
    const warm = rng.chance(0.3);
    const blue = !warm && rng.chance(0.4);
    const a = rng.range(0.25, 0.95);
    ctx.fillStyle = warm ? `rgba(255,226,190,${a})` : blue ? `rgba(180,208,255,${a})` : `rgba(235,240,248,${a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // hero stars with glow
  for (let i = 0; i < 14; i++) {
    const x = rng.range(20, 1004), y = rng.range(20, 492);
    const r = rng.range(4, 9);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = rng.pick(['255,238,214', '198,220,255', '255,255,255']);
    g.addColorStop(0, `rgba(${col},0.95)`);
    g.addColorStop(0.25, `rgba(${col},0.35)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = `rgba(${col},1)`;
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

/** Soft additive nebula blob for drift sprites. */
function makeNebulaTexture(rng, hue) {
  const [c, ctx] = canvas2d(256, 256);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, 256, 256);
  const col = new THREE.Color().setHSL(hue, 0.7, 0.55);
  for (let i = 0; i < 42; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, 70) * rng.next();
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    const r = rng.range(18, 62);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, cssOf(col, rng.range(0.03, 0.09)));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // circular falloff mask
  const mask = ctx.createRadialGradient(128, 128, 60, 128, 128, 126);
  ctx.globalCompositeOperation = 'destination-in';
  mask.addColorStop(0, 'rgba(255,255,255,1)');
  mask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

/** Terminal screen: cyan console rows and a bar chart, no readable text. */
function makeScreenTexture(rng, hex) {
  const [c, ctx] = canvas2d(256, 160);
  ctx.fillStyle = '#030a0e';
  ctx.fillRect(0, 0, 256, 160);
  const col = new THREE.Color(hex);
  ctx.fillStyle = cssOf(col, 0.9);
  ctx.fillRect(10, 10, rng.range(80, 150), 8);
  ctx.fillStyle = cssOf(col, 0.4);
  for (let r = 0; r < 6; r++) {
    let x = 10;
    const y = 32 + r * 14;
    while (x < 200) {
      const w = rng.range(8, 42);
      if (rng.chance(0.8)) ctx.fillRect(x, y, w, 6);
      x += w + 7;
    }
  }
  for (let i = 0; i < 8; i++) { // bar chart
    ctx.fillStyle = cssOf(col, rng.range(0.35, 0.95));
    const h = rng.range(6, 34);
    ctx.fillRect(160 + i * 11, 150 - h, 8, h);
  }
  ctx.strokeStyle = cssOf(col, 0.5);
  ctx.lineWidth = 2;
  ctx.strokeRect(3, 3, 250, 154);
  return c;
}

/* ------------------------------------------------------------------ export */

/**
 * Build a walkable hangar-interior hall (~70×30×18 m, 1 unit = 1 m, +Y up).
 * The bay mouth opens toward +Z onto a starfield; the deck is y = 0 with a
 * raised landing pad. All lights/meshes live under `group` — add it to a
 * scene, call `update(dt)` each frame, `dispose()` on unmount.
 *
 * @param {number} seed deterministic seed
 * @param {'meridian'|'chorale'|'sunward'|'ashen'|'none'} faction trim colors
 * @returns {{
 *   group: THREE.Group,
 *   spawnPoint: THREE.Vector3,           // on-foot spawn (deck level)
 *   shipPad: THREE.Vector3,              // pad-top center (park the ship here)
 *   floorY: (x: number, z: number) => number|null, // walk height, null = wall
 *   bounds: { minX: number, maxX: number, minZ: number, maxZ: number },
 *   interactables: Array<{ kind: 'trade'|'shipyard'|'missions',
 *                          position: THREE.Vector3, label: string }>,
 *   update: (dt: number) => void,
 *   dispose: () => void,
 * }}
 */
export function buildHangar(seed, faction = 'none') {
  const rng = new RNG(hash32(seed | 0, hashString('hangar'), hashString(faction)));
  const factionColor = new THREE.Color(FACTIONS[faction]?.colorHex ?? '#9ab8c8');
  const group = new THREE.Group();
  group.name = `hangar:${faction}`;
  const resources = new Set();
  const track = (r) => { resources.add(r); return r; };

  const add = (geo, mat, parent = group) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    resources.add(geo);
    parent.add(mesh);
    return mesh;
  };
  const glow = (geo, mat, parent = group) => {
    const mesh = add(geo, mat, parent);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  };

  /* ---- textures ---------------------------------------------------------- */
  const deckTex = track(canvasTexture(makeDeckTexture(rng.fork('deck'), factionColor), { repeat: [5, 11] }));
  const wallCanvas = makeWallTexture(rng.fork('wall'));
  const wallTexLong = track(canvasTexture(wallCanvas, { repeat: [7, 1.8] }));
  const wallTexBack = track(canvasTexture(wallCanvas, { repeat: [3, 1.8] }));
  const wallTexSmall = track(canvasTexture(wallCanvas, { repeat: [0.6, 1.8] }));
  const padTex = track(canvasTexture(makePadTexture(rng.fork('pad'), factionColor)));
  const hazardTex = track(canvasTexture(makeHazardTexture(factionColor), { repeat: [14, 1] }));
  const starCanvas = makeStarTexture(rng.fork('stars'));
  const starTex = track(canvasTexture(starCanvas));
  const crateTexA = track(canvasTexture(makeCrateTexture(rng.fork('crateA'), factionColor)));
  const crateTexB = track(canvasTexture(makeCrateTexture(rng.fork('crateB'), factionColor)));

  /* ---- materials --------------------------------------------------------- */
  const deckMat = track(new THREE.MeshStandardMaterial({ map: deckTex, metalness: 0.55, roughness: 0.62 }));
  const wallMat = track(new THREE.MeshStandardMaterial({ map: wallTexLong, metalness: 0.4, roughness: 0.7 }));
  const wallMatBack = track(new THREE.MeshStandardMaterial({ map: wallTexBack, metalness: 0.4, roughness: 0.7 }));
  const wallMatSmall = track(new THREE.MeshStandardMaterial({ map: wallTexSmall, metalness: 0.4, roughness: 0.7 }));
  const ceilMat = track(new THREE.MeshStandardMaterial({ map: wallTexBack, color: 0x5a6068, metalness: 0.5, roughness: 0.75 }));
  const darkMat = track(new THREE.MeshStandardMaterial({ color: 0x1c2126, metalness: 0.8, roughness: 0.55 }));
  const steelMat = track(new THREE.MeshStandardMaterial({ color: 0x454e59, metalness: 0.75, roughness: 0.45 }));
  const padMat = track(new THREE.MeshStandardMaterial({ map: padTex, metalness: 0.6, roughness: 0.55 }));
  const padSideMat = track(new THREE.MeshStandardMaterial({ map: hazardTex, metalness: 0.4, roughness: 0.6 }));
  const trimMat = track(new THREE.MeshStandardMaterial({
    color: factionColor.clone().multiplyScalar(0.75), metalness: 0.5, roughness: 0.5,
  }));
  const trimGlowMat = track(new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: factionColor, emissiveIntensity: 1.7,
  }));
  const guideGlowMat = track(new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: factionColor, emissiveIntensity: 1.4,
  }));
  const bayLightMat = track(new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(1.0, 0.92, 0.72), emissiveIntensity: 2.8,
  }));
  const wellMat = track(new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(1.0, 0.95, 0.86), emissiveIntensity: 0.55,
  }));
  const coolStripMat = track(new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(0.65, 0.85, 1.0), emissiveIntensity: 1.2,
  }));
  const starMat = track(new THREE.MeshBasicMaterial({ map: starTex, toneMapped: true }));
  const fieldMat = track(new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x6fd8ff), transparent: true, opacity: 0.045,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  const crateMatA = track(new THREE.MeshStandardMaterial({ map: crateTexA, metalness: 0.35, roughness: 0.7 }));
  const crateMatB = track(new THREE.MeshStandardMaterial({ map: crateTexB, metalness: 0.35, roughness: 0.7 }));
  const barrelMat = track(new THREE.MeshStandardMaterial({
    color: factionColor.clone().lerp(new THREE.Color(0x39404a), 0.62), metalness: 0.55, roughness: 0.5,
  }));

  /* ---- floor + guide strips ---------------------------------------------- */
  const floor = add(new THREE.PlaneGeometry(HALL_W + 1, HALL_L + 1), deckMat);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;

  // continuous side rails of the approach lane
  for (const dx of [-1.7, 1.7]) {
    const rail = glow(new THREE.BoxGeometry(0.16, 0.03, HALL_L - 6), guideGlowMat);
    rail.position.set(PAD.x + dx, 0.02, 1);
  }
  // chase dashes running the lane center toward the pad/mouth
  const chaseMats = [];
  for (let i = 0; i < 8; i++) {
    chaseMats.push(track(new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: factionColor.clone(), emissiveIntensity: 0.6,
    })));
  }
  {
    const dashGeo = new THREE.BoxGeometry(0.42, 0.035, 1.15);
    resources.add(dashGeo);
    let k = 0;
    for (let z = -HALF_L + 4; z < HALF_L - 1.5; z += 2.4) {
      const dash = glow(dashGeo, chaseMats[k % 8]);
      dash.position.set(PAD.x, 0.02, z);
      k++;
    }
  }
  // cross aisle from the terminal wall to the lane
  {
    const aisle = glow(new THREE.BoxGeometry(10.8, 0.03, 0.16), guideGlowMat);
    aisle.position.set(PAD.x - 1.7 - 5.4, 0.02, -2);
  }

  /* ---- landing pad -------------------------------------------------------- */
  const padBody = add(new THREE.CylinderGeometry(PAD.r, PAD.r + 0.25, PAD.h, 40, 1, true), padSideMat);
  padBody.position.set(PAD.x, PAD.h / 2, PAD.z);
  const padTop = add(new THREE.CircleGeometry(PAD.r, 40), padMat);
  padTop.rotation.x = -Math.PI / 2;
  padTop.position.set(PAD.x, PAD.h + 0.001, PAD.z);
  padTop.castShadow = false;
  const padRing = glow(new THREE.RingGeometry(PAD.r - 0.5, PAD.r - 0.22, 48), trimGlowMat);
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.set(PAD.x, PAD.h + 0.012, PAD.z);
  // four corner marker lights
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const post = add(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 8), darkMat);
    post.position.set(PAD.x + Math.cos(a) * (PAD.r + 0.7), 0.25, PAD.z + Math.sin(a) * (PAD.r + 0.7));
    const cap = glow(new THREE.SphereGeometry(0.09, 8, 6), bayLightMat);
    cap.position.set(post.position.x, 0.55, post.position.z);
  }

  /* ---- walls -------------------------------------------------------------- */
  const wallGeoLong = new THREE.BoxGeometry(0.5, HALL_H, HALL_L + 1);
  resources.add(wallGeoLong);
  const westWall = add(wallGeoLong, wallMat);
  westWall.position.set(-HALF_W - 0.25, HALL_H / 2, 0);
  const eastWall = add(wallGeoLong, wallMat);
  eastWall.position.set(HALF_W + 0.25, HALL_H / 2, 0);
  const backWall = add(new THREE.BoxGeometry(HALL_W + 1.5, HALL_H, 0.5), wallMatBack);
  backWall.position.set(0, HALL_H / 2, -HALF_L - 0.25);
  // mouth wall: two flanks + header above the opening
  for (const sx of [-1, 1]) {
    const flankW = HALF_W - MOUTH_W / 2;
    const flank = add(new THREE.BoxGeometry(flankW + 0.75, HALL_H, 0.6), wallMatSmall);
    flank.position.set(sx * (MOUTH_W / 2 + flankW / 2 + 0.37), HALL_H / 2, HALF_L + 0.3);
  }
  const header = add(new THREE.BoxGeometry(MOUTH_W, HALL_H - MOUTH_H, 0.6), wallMatSmall);
  header.position.set(0, MOUTH_H + (HALL_H - MOUTH_H) / 2, HALF_L + 0.3);

  // waist-height faction trim strips down both side walls
  for (const sx of [-1, 1]) {
    const strip = glow(new THREE.BoxGeometry(0.08, 0.18, HALL_L - 2), trimGlowMat);
    strip.position.set(sx * (HALF_W - 0.04), 2.4, 0);
  }

  /* ---- windows (east wall, above the catwalk) ------------------------------ */
  for (const wz of [-13, 9]) {
    const W = 9, H = 3.4, cy = 10.6;
    // recess shell
    const backPlate = add(new THREE.BoxGeometry(0.1, H, W), darkMat);
    backPlate.position.set(HALF_W + 0.4, cy, wz);
    const starPane = glow(new THREE.PlaneGeometry(W - 0.3, H - 0.3), starMat);
    starPane.rotation.y = -Math.PI / 2;
    starPane.position.set(HALF_W + 0.32, cy, wz);
    // frame
    const frameGeoH = new THREE.BoxGeometry(0.55, 0.24, W + 0.5);
    resources.add(frameGeoH);
    for (const dy of [-H / 2 - 0.12, H / 2 + 0.12]) {
      const f = add(frameGeoH, steelMat);
      f.position.set(HALF_W + 0.05, cy + dy, wz);
    }
    const frameGeoV = new THREE.BoxGeometry(0.55, H + 0.5, 0.24);
    resources.add(frameGeoV);
    for (const dz of [-W / 2 - 0.12, W / 2 + 0.12]) {
      const f = add(frameGeoV, steelMat);
      f.position.set(HALF_W + 0.05, cy, wz + dz);
    }
    // cool light rim under the sill
    const sill = glow(new THREE.BoxGeometry(0.06, 0.08, W), coolStripMat);
    sill.position.set(HALF_W - 0.22, cy - H / 2 - 0.28, wz);
  }

  /* ---- vaulted ribs + ceiling --------------------------------------------- */
  const ribGeo = new THREE.TorusGeometry(HALF_W, 0.42, 8, 30, Math.PI);
  resources.add(ribGeo);
  const colGeo = new THREE.BoxGeometry(0.9, 6.4, 0.9);
  resources.add(colGeo);
  const collarGeo = new THREE.BoxGeometry(1.0, 0.28, 1.0);
  resources.add(collarGeo);
  for (let i = 0; i < 9; i++) {
    const z = -HALF_L + 5 + i * 7.5;
    const rib = add(ribGeo, steelMat);
    rib.position.set(0, 6, z);
    rib.scale.y = (HALL_H - 6) / HALF_W;
    for (const sx of [-1, 1]) {
      const col = add(colGeo, darkMat);
      col.position.set(sx * (HALF_W - 0.45), 3.0, z);
      const collar = glow(collarGeo, trimGlowMat);
      collar.position.set(sx * (HALF_W - 0.45), 5.9, z);
    }
  }
  const ceiling = add(new THREE.BoxGeometry(HALL_W + 1, 0.5, HALL_L + 1), ceilMat);
  ceiling.position.set(0, HALL_H + 0.45, 0);
  // central recessed lightwell (soft, non-blooming)
  const well = glow(new THREE.BoxGeometry(2.2, 0.12, HALL_L - 8), wellMat);
  well.position.set(0, HALL_H - 0.05, 0);
  for (const sx of [-1, 1]) { // narrow cool ceiling seams
    const seam = glow(new THREE.BoxGeometry(0.35, 0.1, HALL_L - 8), coolStripMat);
    seam.position.set(sx * 8.5, HALL_H - 0.04, 0);
  }

  // ceiling fans
  const fans = [];
  {
    const ringGeo = new THREE.TorusGeometry(1.7, 0.13, 8, 24);
    const bladeGeo = new THREE.BoxGeometry(3.1, 0.05, 0.38);
    const hubGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.4, 10);
    resources.add(ringGeo); resources.add(bladeGeo); resources.add(hubGeo);
    for (const fz of [-14, 8]) {
      const fanRoot = new THREE.Group();
      fanRoot.position.set(0, HALL_H - 0.55, fz);
      group.add(fanRoot);
      const ring = add(ringGeo, darkMat, fanRoot);
      ring.rotation.x = Math.PI / 2;
      add(hubGeo, steelMat, fanRoot);
      const spinner = new THREE.Group();
      fanRoot.add(spinner);
      add(bladeGeo, darkMat, spinner).position.y = -0.12;
      const b2 = add(bladeGeo, darkMat, spinner);
      b2.position.y = -0.12;
      b2.rotation.y = Math.PI / 2;
      fans.push({ spinner, rate: (fz < 0 ? 0.7 : -0.55) + rng.range(-0.08, 0.08) });
    }
  }

  /* ---- catwalk balconies --------------------------------------------------- */
  {
    const walkGeo = new THREE.BoxGeometry(2.5, 0.16, HALL_L - 8);
    const lipGeo = new THREE.BoxGeometry(0.12, 0.5, HALL_L - 8);
    const railGeo = new THREE.BoxGeometry(0.05, 0.05, HALL_L - 8);
    const postGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.05, 6);
    const braceGeo = new THREE.BoxGeometry(0.16, 0.16, 2.9);
    const stripGeo = new THREE.BoxGeometry(0.06, 0.1, HALL_L - 8);
    for (const g of [walkGeo, lipGeo, railGeo, postGeo, braceGeo, stripGeo]) resources.add(g);
    for (const sx of [-1, 1]) {
      const cx = sx * (HALF_W - 1.35);
      const walk = add(walkGeo, darkMat);
      walk.position.set(cx, 7, 0);
      const lip = add(lipGeo, steelMat);
      lip.position.set(cx - sx * 1.25, 7.2, 0);
      for (const ry of [7.6, 8.05]) {
        const rail = add(railGeo, steelMat);
        rail.position.set(cx - sx * 1.25, ry, 0);
      }
      for (let z = -HALF_L + 5; z <= HALF_L - 5; z += 4.2) {
        const post = add(postGeo, darkMat);
        post.position.set(cx - sx * 1.25, 7.55, z);
      }
      for (let z = -HALF_L + 7; z <= HALF_L - 7; z += 8.4) {
        const brace = add(braceGeo, darkMat);
        brace.position.set(cx, 6.1, z);
        brace.rotation.z = sx * 0.6;
      }
      // under-edge running light
      const strip = glow(stripGeo, trimGlowMat);
      strip.position.set(cx - sx * 1.2, 6.85, 0);
    }
  }

  /* ---- bay mouth + space beyond -------------------------------------------- */
  {
    // heavy frame pylons + lintel
    const pylonGeo = new THREE.BoxGeometry(1.6, MOUTH_H + 1.2, 1.6);
    resources.add(pylonGeo);
    for (const sx of [-1, 1]) {
      const pylon = add(pylonGeo, darkMat);
      pylon.position.set(sx * (MOUTH_W / 2 + 0.6), (MOUTH_H + 1.2) / 2, HALF_L - 0.4);
      const trim = add(new THREE.BoxGeometry(0.3, MOUTH_H, 0.3), trimMat);
      trim.position.set(sx * (MOUTH_W / 2 - 0.2), MOUTH_H / 2, HALF_L - 1.1);
    }
    const lintel = add(new THREE.BoxGeometry(MOUTH_W + 4.5, 1.5, 1.8), darkMat);
    lintel.position.set(0, MOUTH_H + 0.7, HALF_L - 0.4);
    // hazard banner under the lintel
    const hazMat = track(new THREE.MeshStandardMaterial({ map: hazardTex, metalness: 0.3, roughness: 0.6 }));
    const haz = add(new THREE.BoxGeometry(MOUTH_W, 0.6, 0.25), hazMat);
    haz.position.set(0, MOUTH_H - 0.35, HALF_L - 0.55);
    // HDR strips rimming the opening
    const stripTop = glow(new THREE.BoxGeometry(MOUTH_W, 0.22, 0.22), bayLightMat);
    stripTop.position.set(0, MOUTH_H + 0.05, HALF_L - 1.0);
    for (const sx of [-1, 1]) {
      const stripV = glow(new THREE.BoxGeometry(0.22, MOUTH_H, 0.22), bayLightMat);
      stripV.position.set(sx * (MOUTH_W / 2 + 0.05), MOUTH_H / 2, HALF_L - 1.0);
    }
    const stripFloor = glow(new THREE.BoxGeometry(MOUTH_W, 0.1, 0.35), trimGlowMat);
    stripFloor.position.set(0, 0.05, HALF_L - 0.6);
    // atmosphere retention field — a barely-there shimmer
    const field = glow(new THREE.PlaneGeometry(MOUTH_W, MOUTH_H), fieldMat);
    field.position.set(0, MOUTH_H / 2, HALF_L + 0.1);
    field.renderOrder = 2;
    this_field = field; // eslint-disable-line no-undef
  }
  // (kept simple: reference stored below via closure variables)

  const starPanel = glow(new THREE.PlaneGeometry(130, 60), starMat);
  starPanel.rotation.y = Math.PI;
  starPanel.position.set(0, 9, HALF_L + 24);

  const nebulas = [];
  {
    const hues = [rng.range(0.55, 0.72), rng.range(0.85, 1.02)];
    for (let i = 0; i < 2; i++) {
      const tex = track(canvasTexture(makeNebulaTexture(rng.fork('neb' + i), hues[i] % 1)));
      const mat = track(new THREE.SpriteMaterial({
        map: tex, blending: THREE.AdditiveBlending, depthWrite: false,
        opacity: 0.85, color: 0xffffff,
      }));
      const spr = new THREE.Sprite(mat);
      spr.scale.setScalar(i === 0 ? 46 : 30);
      spr.position.set(i === 0 ? -14 : 20, i === 0 ? 10 : 16, HALF_L + 20 - i * 2);
      group.add(spr);
      nebulas.push({ spr, baseX: spr.position.x, baseY: spr.position.y, rate: 0.011 + i * 0.007, phase: rng.range(0, 9) });
    }
  }

  // rotating dock beacons on the mouth pylons
  const beacons = [];
  {
    const lobeGeo = new THREE.BoxGeometry(0.5, 0.14, 0.14);
    resources.add(lobeGeo);
    for (const sx of [-1, 1]) {
      const beaconMat = track(new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: new THREE.Color(0xffa040), emissiveIntensity: 3.0,
      }));
      const base = add(new THREE.CylinderGeometry(0.18, 0.22, 0.3, 10), darkMat);
      base.position.set(sx * (MOUTH_W / 2 + 0.6), MOUTH_H + 1.6, HALF_L - 0.4);
      const head = new THREE.Group();
      head.position.set(base.position.x, MOUTH_H + 1.85, base.position.z);
      group.add(head);
      glow(lobeGeo, beaconMat, head).position.x = 0.22;
      const l2 = glow(lobeGeo, beaconMat, head);
      l2.position.x = -0.22;
      beacons.push({ head, mat: beaconMat, rate: sx * 2.6, phase: rng.range(0, Math.PI * 2) });
    }
  }

  /* ---- terminal alcoves (west wall) ---------------------------------------- */
  const interactables = [];
  const holos = [];
  {
    const defs = [
      { kind: 'trade', z: -14, label: 'TRADE' },
      { kind: 'shipyard', z: -2, label: 'SHIPYARD' },
      { kind: 'missions', z: 10, label: 'MISSIONS' },
    ];
    const backGeo = new THREE.BoxGeometry(0.35, 5.2, 3.8);
    const edgeGeo = new THREE.BoxGeometry(0.1, 5.2, 0.1);
    const headerGeo = new THREE.BoxGeometry(0.7, 0.35, 4.0);
    const deskGeo = new THREE.BoxGeometry(0.85, 1.05, 1.7);
    const screenGeo = new THREE.BoxGeometry(0.1, 0.85, 1.5);
    for (const g of [backGeo, edgeGeo, headerGeo, deskGeo, screenGeo]) resources.add(g);

    for (const def of defs) {
      const hex = HOLO_COLORS[def.kind];
      const holoColor = new THREE.Color(hex);
      const wallX = -HALF_W;

      const back = add(backGeo, darkMat);
      back.position.set(wallX + 0.2, 2.6, def.z);
      const holoEdgeMat = track(new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: holoColor, emissiveIntensity: 1.5,
      }));
      for (const dz of [-1.85, 1.85]) {
        const edge = glow(edgeGeo, holoEdgeMat);
        edge.position.set(wallX + 0.42, 2.6, def.z + dz);
      }
      const head = add(headerGeo, steelMat);
      head.position.set(wallX + 0.4, 5.35, def.z);

      // console desk + screen
      const desk = add(deskGeo, steelMat);
      desk.position.set(wallX + 1.05, 0.53, def.z);
      const screenTex = track(canvasTexture(makeScreenTexture(rng.fork('scr' + def.kind), hex)));
      const screenMat = track(new THREE.MeshStandardMaterial({
        color: 0x05080b, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 1.0,
        roughness: 0.35, metalness: 0.2,
      }));
      const screen = glow(screenGeo, screenMat);
      screen.position.set(wallX + 1.35, 1.25, def.z);
      screen.rotation.z = -0.5;

      // holographic glyph sign
      const holoMat = track(new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: holoColor, emissiveIntensity: 3.0,
        transparent: true, opacity: 0.92,
      }));
      const sign = new THREE.Group();
      sign.position.set(wallX + 1.1, 4.1, def.z);
      group.add(sign);
      if (def.kind === 'trade') {
        // lumens glyph — ring and core
        glow(track(new THREE.TorusGeometry(0.52, 0.075, 10, 26)), holoMat, sign);
        glow(track(new THREE.SphereGeometry(0.17, 10, 8)), holoMat, sign);
      } else if (def.kind === 'shipyard') {
        // stylized hull silhouette
        const body = glow(track(new THREE.OctahedronGeometry(0.5)), holoMat, sign);
        body.scale.set(0.28, 0.28, 1.15);
        const wingGeo = track(new THREE.BoxGeometry(1.25, 0.05, 0.34));
        const w1 = glow(wingGeo, holoMat, sign);
        w1.position.z = 0.12;
        w1.rotation.z = 0.16;
        const fin = glow(track(new THREE.BoxGeometry(0.05, 0.42, 0.3)), holoMat, sign);
        fin.position.set(0, 0.26, 0.3);
      } else {
        // missions — exclamation diamond
        const barGeo = track(new THREE.OctahedronGeometry(0.3));
        const bar = glow(barGeo, holoMat, sign);
        bar.scale.set(0.55, 1.65, 0.55);
        bar.position.y = 0.22;
        const dot = glow(track(new THREE.OctahedronGeometry(0.15)), holoMat, sign);
        dot.position.y = -0.62;
      }
      // projection cone rising from the desk
      const coneMat = track(new THREE.MeshBasicMaterial({
        color: holoColor, transparent: true, opacity: 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const cone = glow(track(new THREE.ConeGeometry(0.85, 2.6, 14, 1, true)), coneMat);
      cone.position.set(wallX + 1.1, 2.55, def.z);
      cone.rotation.x = Math.PI;
      holos.push({ sign, mat: holoMat, baseY: 4.1, phase: rng.range(0, Math.PI * 2), rate: 0.7 + rng.range(-0.1, 0.15) });

      interactables.push({
        kind: def.kind,
        position: new THREE.Vector3(wallX + 2.6, 0, def.z),
        label: def.label,
      });
    }
  }

  /* ---- cargo clutter -------------------------------------------------------- */
  {
    const crateGeo = new THREE.BoxGeometry(1.15, 1.15, 1.15);
    const crateGeoS = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.45, 1.1, 12);
    const ribGeoB = new THREE.TorusGeometry(0.44, 0.035, 6, 14);
    const ledGeo = new THREE.BoxGeometry(0.07, 0.07, 0.02);
    for (const g of [crateGeo, crateGeoS, barrelGeo, ribGeoB, ledGeo]) resources.add(g);
    const ledMat = track(new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: new THREE.Color(0x7dffb4), emissiveIntensity: 2.2,
    }));

    const spotOK = (x, z) => {
      if (x < -10.5 || x > HALF_W - 1.4 || z < -HALF_L + 2 || z > HALF_L - 5) return false;
      const dx = x - PAD.x, dz = z - PAD.z;
      if (dx * dx + dz * dz < (PAD.r + 2.2) ** 2) return false;
      if (Math.abs(x - PAD.x) < 2.6) return false; // keep the lane clear
      return true;
    };
    let placed = 0, tries = 0;
    while (placed < 11 && tries < 120) {
      tries++;
      const x = rng.range(-10, HALF_W - 2);
      const z = rng.range(-HALF_L + 3, HALF_L - 6);
      if (!spotOK(x, z)) continue;
      const big = rng.chance(0.72);
      const geo = big ? crateGeo : crateGeoS;
      const h = big ? 1.15 : 0.8;
      const crate = add(geo, rng.chance(0.5) ? crateMatA : crateMatB);
      crate.position.set(x, h / 2, z);
      crate.rotation.y = rng.range(-0.4, 0.4);
      if (big && rng.chance(0.5)) {
        const top = add(crateGeoS, rng.chance(0.5) ? crateMatA : crateMatB);
        top.position.set(x + rng.range(-0.1, 0.1), h + 0.4, z + rng.range(-0.1, 0.1));
        top.rotation.y = crate.rotation.y + rng.range(-0.5, 0.5);
      }
      if (rng.chance(0.5)) {
        const led = glow(ledGeo, ledMat);
        led.position.set(x, h * 0.75, z + Math.cos(crate.rotation.y) * (h / 2 + 0.011));
        led.rotation.y = crate.rotation.y;
      }
      // barrels huddle next to some crates
      if (rng.chance(0.55)) {
        for (let b = 0; b < rng.int(1, 3); b++) {
          const bx = x + rng.range(-1.6, 1.6), bz = z + rng.range(-1.6, 1.6);
          if (!spotOK(bx, bz)) continue;
          const barrel = add(barrelGeo, barrelMat);
          barrel.position.set(bx, 0.55, bz);
          const ring = add(ribGeoB, darkMat);
          ring.position.set(bx, rng.pick([0.3, 0.8]), bz);
          ring.rotation.x = Math.PI / 2;
        }
      }
      placed++;
    }
  }

  /* ---- lights (≤6 punctual, hemisphere fill) -------------------------------- */
  const hemi = new THREE.HemisphereLight(0x39485a, 0x131820, 0.6);
  group.add(hemi);
  const padSpot = new THREE.SpotLight(0xffe0b0, 900, 46, 0.62, 0.5, 1.7);
  padSpot.position.set(PAD.x, HALL_H - 1, PAD.z - 2);
  padSpot.target.position.set(PAD.x, 0, PAD.z);
  padSpot.castShadow = true;
  padSpot.shadow.mapSize.set(1024, 1024);
  padSpot.shadow.bias = -0.0008;
  group.add(padSpot);
  group.add(padSpot.target);
  const mouthLight = new THREE.PointLight(0x9fc4ff, 65, 48, 1.8);
  mouthLight.position.set(0, 11, HALF_L - 4);
  group.add(mouthLight);
  const termLight = new THREE.PointLight(0x7de8ff, 26, 20, 1.8);
  termLight.position.set(-HALF_W + 4, 4.5, -2);
  group.add(termLight);
  const backLight = new THREE.PointLight(0xffd9a8, 45, 34, 1.8);
  backLight.position.set(0, 10, -HALF_L + 8);
  group.add(backLight);
  const midLight = new THREE.PointLight(0xffc890, 30, 26, 1.8);
  midLight.position.set(6, 6, -8);
  group.add(midLight);

  /* ---- contract points -------------------------------------------------------- */
  const spawnPoint = new THREE.Vector3(-3.5, 0, -22);
  const shipPad = new THREE.Vector3(PAD.x, PAD.h, PAD.z);
  const bounds = { minX: -HALF_W + 0.7, maxX: HALF_W - 0.7, minZ: -HALF_L + 0.7, maxZ: HALF_L - 0.4 };

  /**
   * Deck walk height at (x, z): 0 on the deck, pad height on the pad,
   * null outside the walkable interior (treat as a wall).
   */
  function floorY(x, z) {
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return null;
    const dx = x - PAD.x, dz = z - PAD.z;
    if (dx * dx + dz * dz <= PAD.r * PAD.r) return PAD.h;
    return 0;
  }

  /* ---- animation ---------------------------------------------------------------- */
  let t = rng.range(0, 100);
  const fieldBase = fieldMat.opacity;
  function update(dt) {
    t += dt;
    for (const f of fans) f.spinner.rotation.y += dt * f.rate;
    for (const b of beacons) {
      b.head.rotation.y += dt * b.rate;
      b.mat.emissiveIntensity = 2.0 + 1.6 * Math.max(0, Math.sin(t * 2.4 + b.phase));
    }
    for (const h of holos) {
      h.sign.rotation.y += dt * h.rate;
      h.sign.position.y = h.baseY + Math.sin(t * 1.1 + h.phase) * 0.06;
      h.mat.emissiveIntensity = 3.0 * (0.86 + 0.11 * Math.sin(t * 9 + h.phase) + 0.05 * Math.sin(t * 27.7));
    }
    for (let k = 0; k < chaseMats.length; k++) {
      const w = Math.max(0, Math.sin(t * 2.1 - k * (Math.PI * 2 / 8)));
      chaseMats[k].emissiveIntensity = 0.55 + 2.3 * w * w * w;
    }
    fieldMat.opacity = fieldBase * (1 + 0.35 * Math.sin(t * 1.7) * Math.sin(t * 0.43));
    for (const n of nebulas) {
      n.spr.position.x = n.baseX + Math.sin(t * n.rate + n.phase) * 6;
      n.spr.position.y = n.baseY + Math.sin(t * n.rate * 0.6 + n.phase * 2) * 2;
      n.spr.material.rotation = t * 0.004 + n.phase;
    }
  }

  function dispose() {
    for (const r of resources) r.dispose?.();
    resources.clear();
    padSpot.dispose?.();
    group.removeFromParent();
  }

  return { group, spawnPoint, shipPad, floorY, bounds, interactables, update, dispose };
}
