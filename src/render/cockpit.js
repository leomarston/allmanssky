// First-person cockpit frame — the pilot's body inside the ship. The returned
// group is designed to be added AS A CHILD OF THE SCENE CAMERA (near plane
// ~0.08); every mesh lives 0.1–0.5 units from the lens so nothing in the world
// can slice through it in normal flight. It wraps the screen edges only:
// canopy A-pillars angling in from the sides, a dashboard sill along the
// bottom of view with seeded class-tinted panels, HDR instrument strips and
// gauge blips that answer the throttle, a scratched-canopy vignette on curved
// glass (a sphere cap, not a screen-space quad), and a faint warm interior
// fill light. The central 60% of the view stays clear. Low-poly (< 2500 tris),
// zero external assets, deterministic from (shipClass, seed).
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';

const CYAN = 0x7de8ff;
const AMBER = 0xffb454;
const RED = 0xff5470;
const GREEN = 0x7dffb4;

/**
 * Per-class flavor knobs.
 * swift = slim elegant · talon = angular aggressive · dray = chunky industrial
 * prospect = utilitarian w/ pipes · vanta = sleek minimal.
 */
const CLASS_STYLES = {
  swift:    { tint: 0x6fd8ff, pillarW: 0.017, lean: 0.26, chunk: 0.85, greebles: 2, pipes: false, brace: false, overhead: false, rivets: 0, hairline: false },
  talon:    { tint: 0xff8a4d, pillarW: 0.026, lean: 0.33, chunk: 1.0,  greebles: 3, pipes: false, brace: true,  overhead: true,  rivets: 4, hairline: false },
  dray:     { tint: 0xffc46b, pillarW: 0.036, lean: 0.17, chunk: 1.35, greebles: 5, pipes: false, brace: false, overhead: true,  rivets: 9, hairline: false },
  prospect: { tint: 0x8dffb0, pillarW: 0.027, lean: 0.21, chunk: 1.15, greebles: 4, pipes: true,  brace: false, overhead: false, rivets: 5, hairline: false },
  vanta:    { tint: 0xb37dff, pillarW: 0.012, lean: 0.28, chunk: 0.68, greebles: 1, pipes: false, brace: false, overhead: false, rivets: 0, hairline: true },
};

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function cssOf(color, a = 1) {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  return `rgba(${r},${g},${b},${a})`;
}

/* ------------------------------------------------------- canvas textures */

/** Dark instrument-panel albedo: seams, class-tinted sub-panels, tiny labels. */
function makeDashTexture(rng, tint) {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0c1014';
  ctx.fillRect(0, 0, W, H);
  // class-tinted recessed panels
  for (let i = 0; i < 12; i++) {
    const x = rng.range(0, W), y = rng.range(0, H);
    const w = rng.range(18, 64), h = rng.range(12, 40);
    ctx.fillStyle = cssOf(tint, rng.range(0.03, 0.1));
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }
  // seam grid
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 6; i++) {
    const y = (i + rng.range(0.2, 0.8)) * (H / 6);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let i = 0; i < 9; i++) {
    const x = (i + rng.range(0.2, 0.8)) * (W / 9);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  // tiny stencil label dashes + screws
  ctx.fillStyle = 'rgba(150,180,196,0.35)';
  for (let i = 0; i < 22; i++) {
    ctx.fillRect(rng.range(4, W - 14), rng.range(4, H - 6), rng.range(4, 10), 2);
  }
  ctx.fillStyle = 'rgba(190,210,222,0.28)';
  for (let i = 0; i < 26; i++) ctx.fillRect(rng.range(0, W), rng.range(0, H), 2, 2);
  // worn edge highlights
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 12; i++) ctx.fillRect(rng.range(0, W), rng.range(0, H), rng.range(6, 22), 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Tiny instrument readout (wave / radar / bars) used as a basic-material map. */
function makeScreenTexture(rng, style, hexA, hexB) {
  const W = 96, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#030608';
  ctx.fillRect(0, 0, W, H);
  const A = cssOf(new THREE.Color(hexA), 0.9);
  const dimA = cssOf(new THREE.Color(hexA), 0.22);
  const B = cssOf(new THREE.Color(hexB), 0.85);
  ctx.strokeStyle = dimA;
  ctx.lineWidth = 1;
  for (let x = 8; x < W; x += 16) { ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, H - 2); ctx.stroke(); }
  for (let y = 8; y < H; y += 12) { ctx.beginPath(); ctx.moveTo(2, y); ctx.lineTo(W - 2, y); ctx.stroke(); }
  if (style === 'radar') {
    ctx.strokeStyle = A;
    for (const r of [10, 19, 27]) { ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = B;
    for (let i = 0; i < 4; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(6, 25);
      ctx.fillRect(W / 2 + Math.cos(a) * r - 1, H / 2 + Math.sin(a) * r - 1, 3, 3);
    }
    const sweep = rng.range(0, Math.PI * 2);
    ctx.strokeStyle = A;
    ctx.beginPath(); ctx.moveTo(W / 2, H / 2);
    ctx.lineTo(W / 2 + Math.cos(sweep) * 27, H / 2 + Math.sin(sweep) * 27); ctx.stroke();
  } else if (style === 'bars') {
    for (let i = 0; i < 8; i++) {
      const h = rng.range(6, H - 18);
      ctx.fillStyle = i === 5 ? B : A;
      ctx.fillRect(6 + i * 11, H - 8 - h, 7, h);
    }
    ctx.fillStyle = A;
    ctx.fillRect(4, 4, rng.range(20, 60), 3);
  } else { // wave
    ctx.strokeStyle = A;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let y = H * 0.55;
    ctx.moveTo(2, y);
    for (let x = 6; x < W; x += 6) {
      y = THREE.MathUtils.clamp(y + rng.range(-9, 9), 8, H - 8);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = B;
    ctx.fillRect(4, H - 8, rng.range(14, 44), 4);
    ctx.fillRect(W - 20, 4, 14, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Scratched-canopy vignette map for the curved glass cap. The cap's UV.y runs
 * 1 at the view axis → 0 at the outer rim; with the default flipY canvas
 * mapping, uv.y=0 samples the canvas BOTTOM row — so haze and scratches are
 * drawn near y=H: clear center, faint wear at the extreme edges only.
 */
function makeVignetteTexture(rng) {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  // haze gradient: canvas y=H is the outer rim of the cap
  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, 'rgba(168,196,212,0.08)');
  g.addColorStop(0.3, 'rgba(168,196,212,0.028)');
  g.addColorStop(0.6, 'rgba(168,196,212,0)');
  g.addColorStop(1, 'rgba(168,196,212,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // micro-scratches, denser near the rim (canvas bottom)
  for (let i = 0; i < 46; i++) {
    const e = rng.next() ** 2.4 * 0.55;          // 0 = rim
    const y0 = H * (1 - e);
    const x0 = rng.range(0, W);
    const len = rng.range(6, 26);
    const dy = rng.range(-3, 5);
    ctx.strokeStyle = `rgba(200,224,236,${rng.range(0.02, 0.07) * (1 - e / 0.55)})`;
    ctx.lineWidth = rng.chance(0.2) ? 1.5 : 0.8;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + len, y0 + dy); ctx.stroke();
  }
  // dust specks
  for (let i = 0; i < 30; i++) {
    const y = H * (1 - rng.next() ** 2 * 0.5);
    ctx.fillStyle = `rgba(210,230,240,${rng.range(0.04, 0.1)})`;
    ctx.fillRect(rng.range(0, W), y, 1.4, 1.4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/* --------------------------------------------------------------- builder */

/**
 * Build a first-person cockpit frame for the given ship class.
 *
 * Attach: `camera.add(cockpit.group)` (and make sure the camera itself is in
 * the scene: `scene.add(camera)`). The group's own transform is left at
 * identity for the integrator; all animation happens on an internal rig.
 * Designed for camera near ≈ 0.08 and fov 60–75.
 *
 * @param {'swift'|'talon'|'dray'|'prospect'|'vanta'} shipClass
 * @param {number} seed deterministic seed (e.g. state.ship.seed)
 * @returns {{
 *   group: THREE.Group,
 *   update: (dt: number, opts?: { throttle?: number, boost?: boolean,
 *     speed?: number, agl?: number, health?: number }) => void,
 *   dispose: () => void
 * }} update: throttle 0..1 drives instrument glow + gauge pulse rate, boost
 *   overdrives the strips, speed (m/s) scales frame vibration (±0.004),
 *   agl < 30 m lights the landing lamp, health (0..1 or 0..100) < 35%
 *   flashes the master-warning blip.
 */
export function createCockpit(shipClass = 'swift', seed = 0) {
  const style = CLASS_STYLES[shipClass] || CLASS_STYLES.swift;
  const rng = new RNG(hash32(seed | 0, hashString('cockpit'), hashString(shipClass)));
  const tint = new THREE.Color(style.tint);
  tint.offsetHSL(rng.range(-0.04, 0.04), 0, rng.range(-0.03, 0.03));

  const group = new THREE.Group();
  group.name = `cockpit:${shipClass}`;
  const rig = new THREE.Group();
  group.add(rig);

  const resources = new Set();

  // -- materials -----------------------------------------------------------
  const hsl = { h: 0, s: 0, l: 0 };
  tint.getHSL(hsl);
  // dark interior tones: the frame must silhouette against bright skies
  const frameMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hsl.h, 0.09 + rng.range(0, 0.07), 0.085 + rng.range(0, 0.03)),
    roughness: 0.62, metalness: 0.35,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0f13, roughness: 0.75, metalness: 0.3 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: tint.clone().multiplyScalar(0.28), roughness: 0.5, metalness: 0.5,
  });
  const dashTex = makeDashTexture(rng.fork('dash'), tint);
  const dashMat = new THREE.MeshStandardMaterial({ map: dashTex, roughness: 0.66, metalness: 0.35 });
  const stripCyanMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(CYAN), emissiveIntensity: 1.1 });
  const stripAmberMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(AMBER), emissiveIntensity: 1.0 });
  const hairlineMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: tint.clone(), emissiveIntensity: 1.2 });
  for (const m of [frameMat, darkMat, trimMat, dashMat, stripCyanMat, stripAmberMat, hairlineMat]) resources.add(m);
  resources.add(dashTex);

  // -- shared geometry -----------------------------------------------------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const blipGeo = new THREE.SphereGeometry(1, 6, 5);
  const pipeGeo = new THREE.CylinderGeometry(1, 1, 1, 7);
  resources.add(boxGeo); resources.add(planeGeo); resources.add(blipGeo); resources.add(pipeGeo);

  /** unit box, scaled/placed; rotation order YXZ so yaw-then-tilt reads naturally */
  const mk = (mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0, parent = rig, geo = boxGeo) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.rotation.order = 'YXZ';
    m.rotation.set(rx, ry, rz);
    m.frustumCulled = false;
    parent.add(m);
    return m;
  };

  const ch = style.chunk;

  // -- canopy A-pillars ------------------------------------------------------
  for (const s of [1, -1]) {
    mk(frameMat, style.pillarW, 0.56, 0.038 * ch, s * 0.345, 0.03, -0.41, 0, s * 0.1, s * style.lean);
    // inner trim edge riding the pillar
    mk(trimMat, style.pillarW * 0.35, 0.5, 0.01, s * (0.345 - style.pillarW * 0.75), 0.03, -0.394, 0, s * 0.1, s * style.lean);
    if (style.brace) { // talon: aggressive diagonal cross-brace
      mk(frameMat, 0.012, 0.24, 0.018, s * 0.275, 0.155, -0.405, 0, s * 0.1, s * 0.95);
    }
  }

  // -- canopy header bar -----------------------------------------------------
  mk(frameMat, 0.64, 0.026 * ch, 0.045, 0, 0.242, -0.415, 0.25, 0, 0);
  if (style.overhead) {
    const oh = mk(darkMat, 0.17, 0.045, 0.055, 0, 0.216, -0.385, 0.35, 0, 0);
    oh.name = 'overhead';
  }

  // -- lower corner masses (door sills) ---------------------------------------
  for (const s of [1, -1]) {
    mk(darkMat, 0.1, 0.2, 0.3, s * 0.43, -0.22, -0.32, 0, -s * 0.4, 0);
    mk(frameMat, 0.06, 0.12, 0.22, s * 0.4, -0.26, -0.3, 0, -s * 0.4, 0);
  }

  // -- dashboard: arc of tilted, class-tinted panels ---------------------------
  const DASH_R = 0.35;
  const DASH_Y = -0.19;
  const angles = [-0.52, -0.26, 0, 0.26, 0.52];
  const panels = [];
  for (const a of angles) {
    const pg = new THREE.Group();
    pg.position.set(-Math.sin(a) * DASH_R, DASH_Y, -Math.cos(a) * DASH_R);
    pg.rotation.order = 'YXZ';
    pg.rotation.y = a;
    pg.rotation.x = 0.35;
    rig.add(pg);
    mk(dashMat, 0.128, 0.085, 0.024 * ch, 0, 0, 0, 0, 0, 0, pg);
    panels.push(pg);
  }
  // continuous sill row under the panels (no gaps at screen bottom)
  for (const a of [-0.52, -0.26, 0, 0.26, 0.52]) {
    mk(frameMat, 0.15, 0.16, 0.05 * ch, -Math.sin(a) * 0.37, -0.275, -Math.cos(a) * 0.37, 0.3, a, 0);
  }
  // dark lip trim running along the dash top, unifying the panel arc
  for (const a of [-0.39, -0.13, 0.13, 0.39]) {
    mk(darkMat, 0.135, 0.014, 0.03 * ch, -Math.sin(a) * 0.352, -0.147, -Math.cos(a) * 0.352, 0.3, a, 0);
  }
  // one wide cowl mass behind everything at the very bottom
  mk(darkMat, 0.95, 0.16, 0.1, 0, -0.31, -0.34, 0.5, 0, 0);

  // -- instruments ------------------------------------------------------------
  const strips = [
    { p: 1, mat: stripCyanMat }, { p: 2, mat: stripCyanMat }, { p: 3, mat: stripCyanMat },
    { p: 0, mat: stripAmberMat }, { p: 4, mat: stripAmberMat },
  ];
  for (const s of strips) {
    const long = s.mat === stripCyanMat;
    mk(s.mat, long ? 0.1 : 0.05, 0.0045, 0.006, 0, 0.047, 0.016 * ch, 0, 0, 0, panels[s.p]);
  }

  // screens (unlit basic materials → readable regardless of scene lighting)
  const screenMats = [];
  const screenDefs = [
    { p: 2, style: 'radar', hexA: CYAN, hexB: AMBER, w: 0.08, h: 0.05, dx: 0 },
    { p: 1, style: 'wave', hexA: CYAN, hexB: GREEN, w: 0.07, h: 0.042, dx: 0.012 },
    { p: 3, style: 'bars', hexA: AMBER, hexB: CYAN, w: 0.07, h: 0.042, dx: -0.012 },
  ];
  for (const d of screenDefs) {
    const tex = makeScreenTexture(rng.fork(`scr${d.p}`), d.style, d.hexA, d.hexB);
    resources.add(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: true });
    resources.add(mat);
    mat.color.setScalar(0.9);
    mk(mat, d.w, d.h, 1, d.dx, 0.004, 0.0135 * ch + 0.002, 0, 0, 0, panels[d.p], planeGeo);
    // bezel
    mk(darkMat, d.w + 0.012, d.h + 0.012, 0.006, d.dx, 0.004, 0.011 * ch, 0, 0, 0, panels[d.p]);
    screenMats.push(mat);
  }

  // gauge blips — tiny emissive domes that pulse with throttle
  const blips = [];
  const mkBlip = (panel, x, y, hex, base) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(hex), emissiveIntensity: base });
    resources.add(mat);
    mk(mat, 0.0052, 0.0052, 0.0052, x, y, 0.015 * ch, 0, 0, 0, panels[panel], blipGeo);
    blips.push({ mat, base, phase: rng.range(0, Math.PI * 2), rate: rng.range(0.7, 1.4) });
    return mat;
  };
  mkBlip(0, -0.02, -0.02, CYAN, 0.9);
  mkBlip(0, 0.015, -0.02, GREEN, 0.8);
  mkBlip(1, -0.035, -0.025, AMBER, 0.9);
  mkBlip(2, -0.05, 0.028, CYAN, 1.0);
  mkBlip(3, 0.038, -0.025, CYAN, 0.8);
  mkBlip(4, -0.015, -0.02, GREEN, 0.9);
  mkBlip(4, 0.02, 0.02, AMBER, 0.8);
  // master warning + landing lamps (driven directly, not pulsed)
  const warnMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(RED), emissiveIntensity: 0.12 });
  const landMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(AMBER), emissiveIntensity: 0.12 });
  resources.add(warnMat); resources.add(landMat);
  mk(warnMat, 0.007, 0.007, 0.007, 0.052, 0.028, 0.015 * ch, 0, 0, 0, panels[2], blipGeo);
  mk(landMat, 0.006, 0.006, 0.006, -0.035, 0.026, 0.015 * ch, 0, 0, 0, panels[3], blipGeo);

  // throttle lever on the left-center panel
  const lever = new THREE.Group();
  lever.position.set(-0.034, -0.03, 0.016 * ch);
  panels[1].add(lever);
  mk(darkMat, 0.016, 0.008, 0.022, 0, -0.002, 0, 0, 0, 0, lever);  // base
  mk(trimMat, 0.006, 0.036, 0.006, 0, 0.016, 0, 0, 0, 0, lever);   // arm
  mk(darkMat, 0.012, 0.008, 0.014, 0, 0.036, 0, 0, 0, 0, lever);   // knob

  // hairline accent (vanta): emissive tint line across each panel top
  if (style.hairline) {
    for (const pg of panels) mk(hairlineMat, 0.12, 0.0022, 0.004, 0, 0.052, 0.014 * ch, 0, 0, 0, pg);
  }

  // pipes (prospect): conduit run along the dash front + pillar feeds
  if (style.pipes) {
    for (let i = 0; i < angles.length - 1; i++) {
      const a0 = angles[i], a1 = angles[i + 1];
      const am = (a0 + a1) / 2;
      const p = mk(darkMat, 0.008, 0.105, 0.008, -Math.sin(am) * 0.335, -0.235, -Math.cos(am) * 0.335, Math.PI / 2, am, 0, rig, pipeGeo);
      p.rotation.z = 0;
      const elbow = mk(trimMat, 0.011, 0.011, 0.011, -Math.sin(a1) * 0.335, -0.235, -Math.cos(a1) * 0.335, 0, 0, 0, rig, blipGeo);
      elbow.frustumCulled = false;
    }
    for (const s of [1, -1]) {
      mk(darkMat, 0.0075, 0.3, 0.0075, s * 0.375, -0.05, -0.375, 0, 0, s * style.lean, rig, pipeGeo);
      mk(trimMat, 0.012, 0.012, 0.012, s * 0.375, 0.1, -0.375, 0, 0, 0, rig, blipGeo);
    }
  }

  // rivets (dray/industrial)
  for (let i = 0; i < style.rivets; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    const t = (Math.floor(i / 2) + 0.5) / Math.max(1, Math.ceil(style.rivets / 2));
    mk(darkMat, 0.008, 0.008, 0.008, s * (0.4 - t * 0.11), -0.2 + t * 0.42, -0.395, 0, s * 0.1, s * style.lean);
  }

  // greebles on the sill
  for (let i = 0; i < style.greebles; i++) {
    const a = rng.range(-0.45, 0.45);
    mk(darkMat, rng.range(0.02, 0.045), rng.range(0.01, 0.02), 0.02,
      -Math.sin(a) * 0.345, -0.155 + rng.range(-0.008, 0.008), -Math.cos(a) * 0.345, 0.3, a, 0);
  }

  // -- scratched-canopy vignette: curved sphere-cap glass ----------------------
  const vigTex = makeVignetteTexture(rng.fork('vignette'));
  resources.add(vigTex);
  const capGeo = new THREE.SphereGeometry(0.3, 28, 10, 0, Math.PI * 2, 0, 1.06);
  capGeo.rotateX(-Math.PI / 2); // cap axis → -Z (view direction)
  resources.add(capGeo);
  const vigMat = new THREE.MeshBasicMaterial({
    map: vigTex, transparent: true, side: THREE.BackSide,
    depthWrite: false, toneMapped: false,
  });
  resources.add(vigMat);
  const canopyGlass = new THREE.Mesh(capGeo, vigMat);
  canopyGlass.frustumCulled = false;
  canopyGlass.renderOrder = 2;
  rig.add(canopyGlass);

  // -- interior fill light ------------------------------------------------------
  // NOTE: at 0.2–0.4 m the inverse-square falloff multiplies ~6–25x, so the
  // candela value must stay tiny or the whole frame washes out.
  const fill = new THREE.PointLight(0xffd2a0, 0.05, 1.6, 2);
  fill.position.set(0, -0.05, -0.24);
  rig.add(fill);

  // -- animation state -----------------------------------------------------------
  let t = rng.range(0, 20);
  let thrSm = 0;

  /**
   * @param {number} dt seconds
   * @param {{throttle?:number, boost?:boolean, speed?:number, agl?:number,
   *   health?:number}} [o]
   */
  function update(dt, o = {}) {
    t += dt;
    const throttle = clamp01(o.throttle ?? 0);
    const boost = !!o.boost;
    const speed = Math.max(0, o.speed ?? 0);
    const agl = o.agl ?? Infinity;
    const healthRaw = o.health ?? 1;
    const health = healthRaw > 1 ? clamp01(healthRaw / 100) : clamp01(healthRaw);

    thrSm += (throttle - thrSm) * Math.min(1, dt * 6);

    // instrument strip glow answers throttle/boost (HDR feeds bloom)
    const stripDrive = 0.8 + 1.1 * thrSm + (boost ? 0.6 : 0);
    stripCyanMat.emissiveIntensity = stripDrive;
    stripAmberMat.emissiveIntensity = stripDrive * 0.85;
    hairlineMat.emissiveIntensity = 0.9 + 1.3 * thrSm;
    for (const m of screenMats) m.color.setScalar(0.8 + 0.5 * thrSm);

    // gauge blips pulse faster and brighter under throttle
    const pulseRate = 1.6 + thrSm * 6.5;
    const blipDrive = 0.55 + 1.5 * thrSm + (boost ? 0.5 : 0);
    for (const b of blips) {
      const s = Math.max(0, Math.sin(t * pulseRate * b.rate + b.phase));
      b.mat.emissiveIntensity = b.base * (0.35 + 0.75 * s * s) * blipDrive;
    }

    // master warning: flashes hard when health is low
    warnMat.emissiveIntensity = health < 0.35
      ? (Math.sin(t * 9) > 0 ? 3.4 : 0.25)
      : 0.12;
    // landing lamp: steady amber pulse near the ground
    landMat.emissiveIntensity = agl < 30
      ? 1.6 + 0.8 * Math.sin(t * 5)
      : 0.12;

    // throttle lever follows the smoothed throttle
    lever.rotation.x = 0.55 - thrSm * 1.05;

    // frame vibration: layered sines, amplitude ±0.004 scaling with speed
    const vib = Math.min(1, speed / 240) * 0.004 + (boost ? 0.0022 : 0) + thrSm * 0.0006;
    rig.position.set(
      (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 23.7 + 1.3) * 0.4) * vib,
      (Math.sin(t * 39.1 + 0.7) * 0.6 + Math.sin(t * 61.7) * 0.4) * vib,
      Math.sin(t * 29.3 + 2.1) * vib * 0.35
    );
    rig.rotation.z = Math.sin(t * 43.7 + 0.4) * vib * 0.35;

    // interior light breathes very slightly with the engine
    fill.intensity = 0.045 + 0.018 * thrSm + 0.004 * Math.sin(t * 2.2);
  }

  function dispose() {
    group.removeFromParent();
    for (const r of resources) r.dispose?.();
    resources.clear();
  }

  return { group, update, dispose };
}
