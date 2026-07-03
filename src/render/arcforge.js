// The Arcforge — the Wayfarer's forearm multitool, rendered first-person in
// the lower-right of view. The returned group is designed to be added AS A
// CHILD OF THE SCENE CAMERA; it positions itself at (0.34, -0.28, -0.55) and
// angles slightly toward screen center. Procedural angular alloy chassis +
// grip, with an emitter head that visibly swaps per tool mode:
//   mine = focusing crystal prongs, amber glow
//   bolt = twin accelerator rails, cyan glow
//   dig  = wide scoop emitter, green glow
// Mode changes play a quick 0.15 s twirl/settle. update() drives idle sway,
// movement bob, firing recoil/vibration and HDR emitter glow (up to ~2.5x).
// muzzleWorld(out) yields the emitter tip in world space for beam/bolt
// origins. Low-poly (< 1500 tris), zero external assets.
import * as THREE from 'three';
import { RNG, hashString } from '../core/rng.js';

export const ARCFORGE_MODES = ['mine', 'bolt', 'dig'];

const MODE_COLORS = {
  mine: 0xffb454, // amber
  bolt: 0x7de8ff, // cyan
  dig: 0x7dffb4,  // green
};

const SWAP_TIME = 0.15;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Small alloy detail map: brushed panels, seams, wear nicks. */
function makeAlloyTexture(rng) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a424b';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(14, 52), rng.range(10, 34));
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    const y = rng.range(0, S);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const x = rng.range(0, S);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(200,215,225,0.16)';
  for (let i = 0; i < 26; i++) ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 5), 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Build the first-person Arcforge multitool.
 *
 * Attach: `camera.add(arcforge.group)` (camera must itself be in the scene).
 * The group ships pre-positioned at (0.34, -0.28, -0.55) with a slight inward
 * yaw; the integrator may re-place it — all animation happens on an internal
 * rig, so `group.position/rotation` stay integrator-owned after creation.
 *
 * @returns {{
 *   group: THREE.Group,
 *   update: (dt: number, opts?: { mode?: 'mine'|'bolt'|'dig',
 *     firing?: boolean, moveSpeed?: number, onGround?: boolean }) => void,
 *   muzzleWorld: (outVec3: THREE.Vector3) => THREE.Vector3,
 *   setVisible: (v: boolean) => void,
 *   dispose: () => void
 * }} update: mode swaps trigger a 0.15 s twirl; firing drives kick recoil
 *   (bolt) or steady vibration (mine/dig) plus HDR emitter glow (~2.5x);
 *   moveSpeed (m/s) + onGround drive the walk bob. muzzleWorld writes the
 *   emitter tip world position (beam/bolt origin) into outVec3 and returns it.
 */
export function createArcforge() {
  const rng = new RNG(hashString('arcforge'));

  const group = new THREE.Group();
  group.name = 'arcforge';
  group.position.set(0.34, -0.28, -0.55);
  group.rotation.order = 'YXZ';
  group.rotation.set(0.02, 0.1, 0);

  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  group.add(rig);

  const resources = new Set();

  // -- materials --------------------------------------------------------------
  const alloyTex = makeAlloyTexture(rng);
  resources.add(alloyTex);
  // moderate metalness: the tool must read without a scene environment map
  const alloyMat = new THREE.MeshStandardMaterial({ map: alloyTex, roughness: 0.55, metalness: 0.4 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.7, metalness: 0.3 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.9, metalness: 0.1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.45, metalness: 0.55 });
  for (const m of [alloyMat, darkMat, gripMat, trimMat]) resources.add(m);

  // per-mode emissives (glow driven in update) + shared status parts
  const glowMats = {};
  for (const mode of ARCFORGE_MODES) {
    glowMats[mode] = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: new THREE.Color(MODE_COLORS[mode]), emissiveIntensity: 1.1,
    });
    resources.add(glowMats[mode]);
  }
  const displayMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(MODE_COLORS.mine), emissiveIntensity: 1.1,
  });
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(MODE_COLORS.mine), emissiveIntensity: 0.9,
  });
  resources.add(displayMat); resources.add(ringMat);

  // -- shared geometry ----------------------------------------------------------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  resources.add(boxGeo);
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
  const cylGeo = (rt, rb, h, seg, open = false) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    resources.add(g);
    return g;
  };

  // -- chassis (forward = -Z) -----------------------------------------------------
  mk(alloyMat, 0.075, 0.068, 0.24, 0, 0.01, -0.02);                    // receiver
  mk(alloyMat, 0.058, 0.052, 0.1, 0, 0.004, -0.155);                   // nose taper
  mk(darkMat, 0.062, 0.02, 0.13, 0, 0.047, -0.09, 0.14, 0, 0);         // slanted top plate
  mk(darkMat, 0.03, 0.013, 0.2, 0, 0.062, -0.02);                      // top rail
  for (let i = 0; i < 4; i++) mk(alloyMat, 0.033, 0.007, 0.014, 0, 0.069, -0.1 + i * 0.05); // rail notches
  for (const s of [1, -1]) {
    mk(darkMat, 0.012, 0.052, 0.17, s * 0.046, 0.006, -0.04, 0, 0, s * 0.05);   // side plates
    mk(trimMat, 0.013, 0.015, 0.085, s * 0.047, -0.024, -0.015, 0, 0, 0);       // trim accents
    mk(darkMat, 0.004, 0.004, 0.15, s * 0.03, -0.032, -0.115, 0.06, 0, 0, rig, cylGeo(1, 1, 1, 6)); // cables
  }
  mk(alloyMat, 0.056, 0.05, 0.062, 0, 0.018, 0.1);                     // rear hump
  // rear status display, tilted up-back toward the pilot's eye
  mk(displayMat, 0.05, 0.004, 0.03, 0, 0.052, 0.095, 0.5, 0, 0);
  mk(darkMat, 0.058, 0.006, 0.038, 0, 0.049, 0.096, 0.5, 0, 0);

  // grip + trigger guard
  mk(gripMat, 0.034, 0.115, 0.046, 0, -0.07, 0.095, 0.42, 0, 0);
  for (let i = 0; i < 3; i++) mk(darkMat, 0.036, 0.008, 0.01, 0, -0.05 - i * 0.024, 0.072 + i * 0.011, 0.42, 0, 0);
  mk(darkMat, 0.008, 0.05, 0.008, 0, -0.058, 0.028);
  mk(darkMat, 0.008, 0.008, 0.05, 0, -0.082, 0.05);

  // underbarrel energy cell + mode-colored ring
  const cellGeo = cylGeo(1, 1, 1, 10);
  mk(alloyMat, 0.023, 0.09, 0.023, 0, -0.046, -0.055, Math.PI / 2, 0, 0, rig, cellGeo);
  mk(ringMat, 0.0245, 0.012, 0.0245, 0, -0.046, -0.014, Math.PI / 2, 0, 0, rig, cellGeo);

  // -- emitter head (spins on mode swap) --------------------------------------------
  const head = new THREE.Group();
  head.position.set(0, 0.005, -0.185);
  rig.add(head);
  mk(alloyMat, 1, 1, 1, 0, 0, -0.005, Math.PI / 2, 0, 0, head, cylGeo(0.034, 0.038, 0.045, 8));
  // mode-colored collar ring — readable from the pilot's viewpoint in any mode
  mk(ringMat, 1, 1, 1, 0, 0, -0.032, Math.PI / 2, 0, 0, head, cylGeo(0.0365, 0.0365, 0.01, 10));

  const variants = {};
  const V3 = THREE.Vector3;

  // mine: focusing crystal prongs w/ amber core
  {
    const v = new THREE.Group();
    head.add(v);
    mk(darkMat, 1, 1, 1, 0, 0, -0.035, Math.PI / 2, 0, 0, v, cylGeo(0.03, 0.033, 0.022, 8));
    const prongGeo = cylGeo(0.0035, 0.011, 0.085, 6);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const pg = new THREE.Group();
      pg.position.set(Math.cos(a) * 0.027, Math.sin(a) * 0.027, -0.075);
      pg.quaternion.setFromAxisAngle(new V3(-Math.sin(a), Math.cos(a), 0), -0.24);
      v.add(pg);
      mk(trimMat, 1, 1, 1, 0, 0, 0, -Math.PI / 2, 0, 0, pg, prongGeo);
      mk(glowMats.mine, 0.0075, 0.0075, 0.0075, 0, 0, -0.046, 0, 0, 0, pg);
    }
    const crystalGeo = new THREE.OctahedronGeometry(0.02);
    resources.add(crystalGeo);
    const crystal = mk(glowMats.mine, 1, 1, 1.9, 0, 0, -0.1, 0, 0, 0, v, crystalGeo);
    crystal.rotation.set(0, 0, Math.PI / 4);
    variants.mine = v;
  }

  // bolt: twin accelerator rails w/ cyan channel
  {
    const v = new THREE.Group();
    head.add(v);
    for (const s of [1, -1]) {
      mk(darkMat, 0.013, 0.026, 0.115, s * 0.023, 0, -0.06, 0, 0, 0, v);
      mk(trimMat, 0.016, 0.03, 0.02, s * 0.023, 0, -0.122, 0, 0, 0, v);
      mk(glowMats.bolt, 0.004, 0.005, 0.1, s * 0.0165, 0.012, -0.06, 0, 0, 0, v); // rail-top glow
    }
    mk(glowMats.bolt, 0.008, 0.014, 0.1, 0, 0, -0.06, 0, 0, 0, v);      // energy channel
    for (const z of [-0.03, -0.09]) {
      mk(darkMat, 1, 1, 1, 0, 0, z, Math.PI / 2, 0, 0, v, cylGeo(0.031, 0.031, 0.008, 8));
    }
    variants.bolt = v;
  }

  // dig: wide scoop emitter w/ green slot
  {
    const v = new THREE.Group();
    head.add(v);
    // half-tube scoop, opening upward, flared wide
    const scoopGeo = new THREE.CylinderGeometry(0.048, 0.03, 0.075, 10, 1, true, 0, Math.PI);
    resources.add(scoopGeo);
    const scoopMat = alloyMat.clone();
    scoopMat.side = THREE.DoubleSide;
    resources.add(scoopMat);
    const scoop = new THREE.Mesh(scoopGeo, scoopMat);
    scoop.rotation.order = 'YXZ';
    scoop.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    scoop.scale.set(1.5, 1, 0.9);
    scoop.position.set(0, -0.002, -0.075);
    scoop.frustumCulled = false;
    v.add(scoop);
    mk(darkMat, 0.1, 0.012, 0.075, 0, -0.028, -0.075, 0, 0, 0, v);       // base plate
    mk(glowMats.dig, 0.072, 0.008, 0.05, 0, -0.012, -0.078, 0, 0, 0, v); // emitter slot
    mk(glowMats.dig, 0.085, 0.006, 0.011, 0, 0.013, -0.046, 0, 0, 0, v); // mouth charge bar
    for (const s of [1, -1]) {                                           // edge teeth
      mk(trimMat, 0.012, 0.01, 0.024, s * 0.055, -0.02, -0.108, 0.3, 0, 0, v);
    }
    variants.dig = v;
  }

  // muzzle anchor: emitter tip (beam/bolt origin)
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.125);
  head.add(muzzle);

  // -- state ---------------------------------------------------------------------
  let mode = 'mine';
  for (const m of ARCFORGE_MODES) variants[m].visible = m === mode;
  displayMat.emissive.set(MODE_COLORS[mode]);
  ringMat.emissive.set(MODE_COLORS[mode]);

  let t = 0;
  let swapT = -1;              // >= 0 while the twirl runs
  let swapTo = mode;
  let glow = 1.1;
  let kick = 0;
  let kickTimer = 0;
  let bobPhase = 0;
  let bobAmp = 0;

  /**
   * @param {number} dt seconds
   * @param {{mode?:'mine'|'bolt'|'dig', firing?:boolean, moveSpeed?:number,
   *   onGround?:boolean}} [o]
   */
  function update(dt, o = {}) {
    t += dt;
    const wantMode = ARCFORGE_MODES.includes(o.mode) ? o.mode : mode;
    const firing = !!o.firing;
    const moveSpeed = Math.max(0, o.moveSpeed ?? 0);
    const onGround = o.onGround ?? true;

    // --- mode swap twirl -------------------------------------------------------
    if (wantMode !== mode && swapT < 0) { swapT = 0; swapTo = wantMode; }
    let swapDip = 0;
    if (swapT >= 0) {
      swapT += dt;
      const k = Math.min(1, swapT / SWAP_TIME);
      const ease = k * k * (3 - 2 * k);         // smoothstep spin
      head.rotation.z = ease * Math.PI * 2;
      swapDip = Math.sin(k * Math.PI) * 0.02;   // quick duck + settle
      if (mode !== swapTo && k >= 0.5) {
        mode = swapTo;
        for (const m of ARCFORGE_MODES) variants[m].visible = m === mode;
        displayMat.emissive.set(MODE_COLORS[mode]);
        ringMat.emissive.set(MODE_COLORS[mode]);
      }
      if (k >= 1) { swapT = -1; head.rotation.z = 0; }
    }

    // --- firing feel -------------------------------------------------------------
    if (firing && mode === 'bolt') {
      kickTimer -= dt;
      if (kickTimer <= 0) { kick = 1; kickTimer = 0.14; }
    } else {
      kickTimer = 0;
    }
    kick = Math.max(0, kick - dt * 9);
    const vibe = firing && mode !== 'bolt' ? 0.0028 : 0;

    // --- emitter glow: HDR while firing --------------------------------------------
    const glowTarget = firing ? 2.5 : 1.1;
    glow += (glowTarget - glow) * Math.min(1, dt * 10);
    const flick = firing ? 1 + 0.12 * Math.sin(t * 31) : 1;
    glowMats[mode].emissiveIntensity = glow * flick;
    for (const m of ARCFORGE_MODES) if (m !== mode) glowMats[m].emissiveIntensity = 1.1;
    displayMat.emissiveIntensity = firing ? 1.35 : 0.95;
    ringMat.emissiveIntensity = firing ? 1.6 : 0.9;

    // --- sway / bob / recoil composite ----------------------------------------------
    bobPhase += dt * (5 + moveSpeed * 1.1);
    const ampTarget = onGround ? Math.min(1, moveSpeed / 6) * 0.008 : 0.0015;
    bobAmp += (ampTarget - bobAmp) * Math.min(1, dt * 8);
    const bobX = Math.sin(bobPhase) * bobAmp;
    const bobY = -Math.abs(Math.cos(bobPhase)) * bobAmp * 1.1;
    const swayX = Math.sin(t * 0.9) * 0.0016;
    const swayY = Math.sin(t * 1.5) * 0.0026;   // slow breathe
    const floatY = onGround ? 0 : Math.sin(t * 2.6) * 0.004 + 0.004;
    const jx = (Math.sin(t * 53.1) * 0.6 + Math.sin(t * 31.7) * 0.4) * vibe;
    const jy = (Math.sin(t * 47.7 + 1.1) * 0.6 + Math.sin(t * 61.3) * 0.4) * vibe;

    rig.position.set(
      swayX + bobX + jx,
      swayY + bobY + floatY + jy - swapDip,
      kick * 0.032
    );
    rig.rotation.set(
      kick * 0.07 + Math.sin(t * 0.7) * 0.006 + (firing && mode !== 'bolt' ? Math.sin(t * 43) * 0.004 : 0),
      Math.sin(t * 0.55 + 1.7) * 0.006 - bobX * 0.35,
      Math.sin(t * 0.8 + 0.6) * 0.008 + kick * 0.02
    );
  }

  /**
   * World position of the emitter tip (beam/bolt origin).
   * @param {THREE.Vector3} out written in place
   * @returns {THREE.Vector3} out
   */
  function muzzleWorld(out) {
    return muzzle.getWorldPosition(out);
  }

  /** @param {boolean} v show/hide the whole tool */
  function setVisible(v) { group.visible = !!v; }

  function dispose() {
    group.removeFromParent();
    for (const r of resources) r.dispose?.();
    resources.clear();
  }

  return { group, update, muzzleWorld, setVisible, dispose };
}
