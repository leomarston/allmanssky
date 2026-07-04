// Capital fleet set-piece: one hero CAPITAL FREIGHTER (hero-scale, a few km out)
// with a small ESCORT WING of fighters flying slow patrol around it. Present in
// a deterministic ~45% of systems (always if the system has a station). Built to
// read as ENORMOUS from a distance and to hold up on approach — long spined hull
// of stacked boxes/greebles, bridge tower, cargo spines, a lit hangar recess,
// long rows of tiny emissive window lights (canvas emissive map), big HDR engine
// glows that feed bloom, and blinking red/green running beacons.
//
// CONTRACT: new CapitalFleet(scene, system, space, opts)
//   .update(dt, shipPos)   .dispose()
// Mirrors the SpaceLife lifecycle: owns all its objects, frees every
// geometry/material/texture, no per-frame allocation in update().
import * as THREE from 'three';
import { RNG, hash32 } from '../core/rng.js';
import { events } from '../core/events.js';
import { buildShip } from './shipmesh.js';
import { FACTIONS, greeting, shipName } from '../universe/lore.js';
import { audio } from '../audio/audio.js';

// scratch — reused every frame, never allocated in update()
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _FWD = new THREE.Vector3(0, 0, -1);

// ---- tunables -------------------------------------------------------------
const FLEET_CHANCE = 0.45;      // fraction of station-less systems that host a fleet
const BARK_RANGE = 620;         // one-time faction comm bark when the player closes in
const HAIL_TONE = 'info';

/** Colored css string from a THREE.Color (canvas fills). */
function cssColor(c, a = 1) {
  const r = Math.round(THREE.MathUtils.clamp(c.r, 0, 1) * 255);
  const g = Math.round(THREE.MathUtils.clamp(c.g, 0, 1) * 255);
  const b = Math.round(THREE.MathUtils.clamp(c.b, 0, 1) * 255);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Hull albedo + window emissive maps for the freighter, drawn once.
 * Canvas wide axis (u) runs along the hull length on the long side faces.
 */
function makeFreighterMaps(rng, trimHex) {
  const W = 1024, H = 256;
  // --- albedo: plated metal with a couple of faction trim bands -----------
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#787f8a';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)';
    ctx.fillRect(rng.range(0, W), rng.range(0, H), rng.range(30, 140), rng.range(14, 60));
  }
  ctx.strokeStyle = 'rgba(10,12,16,0.4)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const y = (i + 0.5) * (H / 8);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const x = (i + 0.5) * (W / 40);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  ctx.fillStyle = trimHex;              // faction trim stripes running the length
  ctx.fillRect(0, H * 0.12, W, 7);
  ctx.fillRect(0, H * 0.85, W, 7);

  // --- emissive: long rows of tiny warm/cyan window lights ----------------
  const e = document.createElement('canvas');
  e.width = W; e.height = H;
  const ectx = e.getContext('2d');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  const rows = 6;
  for (let row = 0; row < rows; row++) {
    const y = H * (0.14 + row * (0.72 / (rows - 1)));
    for (let x = 8; x < W - 8; x += 12) {
      if (!rng.chance(0.66)) continue;            // some windows are dark
      const warm = rng.chance(0.82);
      ectx.fillStyle = warm ? 'rgba(255,214,150,1)' : 'rgba(150,220,255,1)';
      ectx.fillRect(x, y, rng.chance(0.12) ? 11 : 6, 8); // occasional wide viewport
    }
  }
  // a few dim continuous deck strips for scale between the window rows
  for (let s = 0; s < 3; s++) {
    ectx.fillStyle = 'rgba(120,150,180,0.35)';
    ectx.fillRect(0, H * (0.3 + s * 0.22), W, 2);
  }

  const hullMap = new THREE.CanvasTexture(c);
  hullMap.colorSpace = THREE.SRGBColorSpace;
  hullMap.wrapS = hullMap.wrapT = THREE.RepeatWrapping;
  hullMap.anisotropy = 4;
  const winMap = new THREE.CanvasTexture(e);
  winMap.colorSpace = THREE.SRGBColorSpace;
  winMap.wrapS = winMap.wrapT = THREE.RepeatWrapping;
  return { hullMap, winMap };
}

export class CapitalFleet {
  /**
   * @param {THREE.Scene} scene
   * @param {object} system  star system (seed, station, faction)
   * @param {object} space   SpaceState — for space.effects.engineTrail
   * @param {object} [opts]
   */
  constructor(scene, system, space, opts = {}) {
    this.scene = scene;
    this.system = system;
    this.space = space;
    this.opts = opts;
    this.escorts = [];
    this.beacons = [];
    this._res = new Set();
    this._t = 0;
    this._barked = false;
    this._active = false;

    this.rng = new RNG(hash32(system?.seed ?? 1, 0xca9f));
    // present in ~45% of systems, always when a station anchors the system
    const present = !!system?.station || this.rng.next() < FLEET_CHANCE;
    if (!present) return;
    this._active = true;

    // faction: station colors, else the system's power, else a trade clan
    const sysFac = system?.faction && system.faction !== 'none' ? system.faction : null;
    this.faction = system?.station?.faction ?? sysFac ?? this.rng.pick(['meridian', 'sunward', 'meridian']);
    this.trimHex = FACTIONS[this.faction]?.colorHex ?? '#9ab8c8';
    this.name = shipName(this.rng.fork('name'));

    this.group = new THREE.Group();
    this.group.name = `capital:${this.faction}`;
    this._buildFreighter();
    this._buildEscorts();

    // park it well away from the origin/spawn, a few km out at an angle
    const ang = this.rng.range(0, Math.PI * 2);
    const dist = this.rng.range(2600, 3600);
    this._baseY = this.rng.range(140, 460) * (this.rng.chance(0.5) ? 1 : -0.6);
    this.group.position.set(Math.cos(ang) * dist, this._baseY, Math.sin(ang) * dist);
    this._baseRotY = this.rng.range(0, Math.PI * 2);
    this.group.rotation.set(this.rng.range(-0.05, 0.05), this._baseRotY, this.rng.range(-0.04, 0.04));
    this._yawRate = this.rng.range(0.004, 0.012) * (this.rng.chance(0.5) ? 1 : -1);
    this.scene.add(this.group);
  }

  /** Shared-geometry box helper (unit box scaled) — cheap + tidy disposal. */
  _box(w, h, d, x, y, z, mat, parent) {
    const m = new THREE.Mesh(this._unitBox, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = false;
    (parent ?? this.group).add(m);
    return m;
  }

  _buildFreighter() {
    const rng = this.rng;
    const trim = new THREE.Color(this.trimHex);

    // -- shared geometry (scaled per-mesh) + materials ----------------------
    this._unitBox = new THREE.BoxGeometry(1, 1, 1);
    const engBodyGeo = new THREE.CylinderGeometry(1, 0.86, 1, 16); engBodyGeo.rotateX(Math.PI / 2);
    const discGeo = new THREE.CircleGeometry(1, 24);
    const rimGeo = new THREE.TorusGeometry(1, 0.12, 8, 22);
    const sphGeo = new THREE.SphereGeometry(1, 10, 8);
    for (const gtry of [this._unitBox, engBodyGeo, discGeo, rimGeo, sphGeo]) this._res.add(gtry);

    const { hullMap, winMap } = makeFreighterMaps(rng.fork('maps'), this.trimHex);
    this._res.add(hullMap); this._res.add(winMap);

    const hullMat = new THREE.MeshStandardMaterial({   // windowed main body
      map: hullMap, emissiveMap: winMap,
      emissive: 0xffffff, emissiveIntensity: 1.9,
      metalness: 0.55, roughness: 0.55,
    });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.6, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x20252c, metalness: 0.85, roughness: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({ color: trim, metalness: 0.55, roughness: 0.45 });
    const trimGlowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: trim.clone(), emissiveIntensity: 2.2 });
    const bayGlowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.82, 0.55), emissiveIntensity: 2.6 });
    const bridgeGlowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.55, 0.85, 1.15), emissiveIntensity: 2.0 });
    this._engineMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0x8fbcff), emissiveIntensity: 3.4 });
    for (const m of [hullMat, plateMat, darkMat, trimMat, trimGlowMat, bayGlowMat, bridgeGlowMat, this._engineMat]) this._res.add(m);

    // -- proportions --------------------------------------------------------
    const L = rng.range(280, 430);       // hull length (hero-scale)
    this.length = L;
    const half = L / 2;
    const W = L * rng.range(0.11, 0.14); // beam
    const H = L * rng.range(0.09, 0.12); // depth
    const mainD = L * 0.70;

    // -- core hull (windowed) + dorsal ridge + ventral keel -----------------
    this._box(W, H, mainD, 0, 0, 0, hullMat);
    this._box(W * 0.52, H * 0.75, mainD * 0.82, 0, H * 0.6, -mainD * 0.02, hullMat); // dorsal superstructure
    this._box(W * 0.42, H * 0.45, mainD * 0.9, 0, -H * 0.55, 0, plateMat);           // ventral keel
    // long faction trim rails along the shoulders
    for (const sx of [1, -1]) {
      this._box(W * 0.06, H * 0.1, mainD * 0.98, sx * W * 0.5, H * 0.28, 0, trimGlowMat);
    }

    // -- tapered prow -------------------------------------------------------
    this._box(W * 0.82, H * 0.82, half * 0.16, 0, -H * 0.02, -half * 0.78, plateMat);
    this._box(W * 0.56, H * 0.6, half * 0.14, 0, -H * 0.05, -half * 0.9, plateMat);
    this._box(W * 0.3, H * 0.4, half * 0.1, 0, -H * 0.08, -half * 0.98, darkMat);

    // -- bridge tower (forward-dorsal), lit viewport band -------------------
    const bx = -mainD * 0.3;
    this._box(W * 0.4, H * 1.1, mainD * 0.13, 0, H * 1.0, bx, hullMat);
    this._box(W * 0.46, H * 0.16, mainD * 0.14, 0, H * 1.4, bx - mainD * 0.005, bridgeGlowMat); // bridge glass
    this._box(W * 0.5, H * 0.12, mainD * 0.16, 0, H * 1.55, bx, trimMat);                       // cap
    // sensor mast + strobe on top of the bridge
    this._box(W * 0.03, H * 0.5, W * 0.03, 0, H * 1.9, bx, darkMat);

    // -- cargo spines: container racks slung along both flanks --------------
    const nCont = rng.int(5, 8);
    const contLen = (mainD * 0.86) / nCont;
    for (const sx of [1, -1]) {
      this._box(W * 0.06, H * 0.16, mainD * 0.9, sx * W * 0.62, -H * 0.05, 0, darkMat); // rail
      for (let i = 0; i < nCont; i++) {
        const z = -mainD * 0.43 + (i + 0.5) * contLen;
        const cm = i % 3 === 0 ? trimMat : plateMat;
        this._box(W * 0.2, H * 0.5, contLen * 0.82, sx * W * 0.66, -H * 0.05, z, cm);
      }
    }

    // -- hangar bay recess (starboard, mid-aft): lit interior + trim frame --
    const hz = mainD * 0.12, hh = H * 0.34, hd = mainD * 0.2, hx = W * 0.5;
    this._box(W * 0.16, hh, hd, hx + W * 0.02, 0, hz, darkMat);                 // dark pocket
    this._box(0.5, hh * 0.82, hd * 0.82, hx + W * 0.1, 0, hz, bayGlowMat);      // interior glow plane
    // trim frame around the mouth
    this._box(W * 0.02, hh * 0.08, hd + W * 0.06, hx + W * 0.14, hh * 0.5, hz, trimMat);
    this._box(W * 0.02, hh * 0.08, hd + W * 0.06, hx + W * 0.14, -hh * 0.5, hz, trimMat);

    // -- stern engine block + 3-4 big HDR nozzles ---------------------------
    const ez = half * 0.86;
    this._box(W * 1.04, H * 1.06, half * 0.28, 0, 0, ez, darkMat);
    const nEng = rng.int(3, 4);
    const er = H * (nEng === 4 ? 0.24 : 0.28);
    this.engineGlows = [];
    for (let i = 0; i < nEng; i++) {
      const gx = (i - (nEng - 1) / 2) * (W * 0.9 / Math.max(1, nEng - 1)) * (nEng > 1 ? 1 : 0);
      const gz = half * 0.98;
      const body = new THREE.Mesh(engBodyGeo, darkMat);
      body.scale.set(er * 1.15, er * 1.15, half * 0.3);
      body.position.set(gx, 0, ez);
      body.castShadow = body.receiveShadow = false;
      this.group.add(body);
      const disc = new THREE.Mesh(discGeo, this._engineMat);
      disc.scale.set(er, er, 1);
      disc.position.set(gx, 0, gz);
      this.group.add(disc);
      const rim = new THREE.Mesh(rimGeo, this._engineMat);
      rim.scale.set(er * 1.05, er * 1.05, er * 1.05);
      rim.position.set(gx, 0, gz);
      this.group.add(rim);
      this.engineGlows.push(disc, rim);
    }

    // -- greebles for silhouette texture on the spine -----------------------
    const nG = rng.int(22, 36);
    for (let i = 0; i < nG; i++) {
      const top = rng.chance(0.6);
      const gz = rng.range(-mainD * 0.42, mainD * 0.42);
      this._box(
        rng.range(W * 0.05, W * 0.16), rng.range(H * 0.06, H * 0.18), rng.range(mainD * 0.02, mainD * 0.06),
        rng.range(-W * 0.28, W * 0.28), (top ? 1 : -1) * H * rng.range(0.42, 0.62), gz, darkMat,
      );
    }

    // -- blinking running beacons (port red / starboard green / white) ------
    const mkBeacon = (x, y, z, colorHex, speed, peak = 4.6) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(colorHex), emissiveIntensity: 0 });
      this._res.add(mat);
      const m = new THREE.Mesh(sphGeo, mat);
      m.scale.setScalar(H * 0.09);
      m.position.set(x, y, z);
      this.group.add(m);
      this.beacons.push({ mat, phase: rng.range(0, Math.PI * 2), speed, peak });
    };
    mkBeacon(-W * 0.66, H * 0.05, 0, 0xff3344, 1.4);            // port — red
    mkBeacon(W * 0.66, H * 0.05, 0, 0x44ff66, 1.4);             // starboard — green
    mkBeacon(0, -H * 0.08, -half * 0.99, 0xffffff, 2.4, 6);     // bow strobe
    mkBeacon(0, H * 1.95, bx, 0xffffff, 2.1, 6);               // bridge mast strobe
    mkBeacon(0, H * 0.62, ez, 0xffaa44, 1.7);                  // stern beacon
  }

  _buildEscorts() {
    const rng = this.rng;
    const n = rng.int(3, 6);
    const half = this.length / 2;
    for (let i = 0; i < n; i++) {
      const cls = rng.pick(['swift', 'talon', 'swift']);
      const built = buildShip(hash32(this.system?.seed ?? 1, 0x51c0 + i), cls);
      built.group.scale.setScalar(rng.range(3, 4.5));
      // set the escorts' engines to a steady patrol glow
      for (const gl of built.engineGlows) gl.material.emissiveIntensity = 1.2;
      this.scene.add(built.group);
      const trail = this.space?.effects?.engineTrail?.(built.group, '#bcdcff') ?? null;
      trail?.setLevel?.(0.45);
      this.escorts.push({
        built, trail,
        ang: (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3),
        omega: rng.range(0.05, 0.11) * (rng.chance(0.5) ? 1 : -1),
        radius: half * rng.range(0.95, 1.5),
        height: rng.range(-half * 0.28, half * 0.34),
        bobAmp: rng.range(6, 16),
        bobFreq: rng.range(0.3, 0.7),
        bobPhase: rng.range(0, Math.PI * 2),
      });
    }
  }

  update(dt, shipPos) {
    if (!this._active) return;
    this._t += dt;

    // slow drift + rotation — the hull turns almost imperceptibly and bobs
    this.group.rotation.y = this._baseRotY + this._t * this._yawRate;
    this.group.position.y = this._baseY + Math.sin(this._t * 0.12) * 9;

    // engine glow breathes; beacons blink on their own phases
    this._engineMat.emissiveIntensity = 3.2 + Math.sin(this._t * 1.1) * 0.5;
    for (const b of this.beacons) {
      const s = Math.sin(this._t * b.speed + b.phase);
      b.mat.emissiveIntensity = Math.max(0, s) ** 8 * b.peak;
    }

    // escorts patrol slow circuits around the freighter, noses to their travel
    const c = this.group.position;
    for (const e of this.escorts) {
      e.ang += e.omega * dt;
      const px = c.x + Math.cos(e.ang) * e.radius;
      const pz = c.z + Math.sin(e.ang) * e.radius;
      const py = c.y + e.height + Math.sin(this._t * e.bobFreq + e.bobPhase) * e.bobAmp;
      const g = e.built.group;
      _v1.set(px, py, pz);
      _v2.subVectors(_v1, g.position);
      g.position.copy(_v1);
      if (_v2.lengthSq() > 1e-4) {
        _q1.setFromUnitVectors(_FWD, _v2.normalize());
        g.quaternion.slerp(_q1, Math.min(1, dt * 1.5));
      }
    }

    // one-time faction comm bark on approach (SpaceLife-style)
    if (!this._barked && shipPos && shipPos.distanceTo(c) < BARK_RANGE) {
      this._barked = true;
      const f = FACTIONS[this.faction] ? this.faction : 'meridian';
      events.emit('notify', {
        text: `[${this.name} · capital escort] — ${greeting(this.rng.fork('bark'), f)}`,
        tone: HAIL_TONE,
      });
      audio.sfx?.('notify');
    }
  }

  dispose() {
    if (!this._active) return;
    for (const e of this.escorts) {
      e.trail?.dispose?.();
      e.built.dispose?.();
      this.scene.remove(e.built.group);
    }
    this.escorts.length = 0;
    this.beacons.length = 0;
    if (this.group) this.scene.remove(this.group);
    for (const r of this._res) r.dispose?.();
    this._res.clear();
  }
}
