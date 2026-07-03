// Combat: Luminel custodian machines ("Wardens") police planets and punish
// over-mining; the Ashen Fleet raids star systems. Both sides use the pooled
// bolt/explosion VFX from EffectsSystem.
//
// GroundCombat runs an NMS-sentinel-style WANTED LEVEL (this.wanted, 0..5):
// sustained mining on watched worlds calls in scouts; destroying a Warden
// raises the level; every rise telegraphs a reinforcement wave for 6-10 s
// ('REINFORCEMENTS INBOUND'). Waves grow with level — scouts, then a shielded
// Aegis, a fast Lancer, and at level 5 THE COLOSSUS, a 4 m twin-legged walker.
// Breaking line-of-sight and staying >160 m from every Warden runs a 12 s
// evade timer that drops the level back to 0 (units power down and fly off).
//
// CONTRACT (states depend on these exact shapes):
//   new GroundCombat(scene, effects, gameState, surfaceState)
//     .update(dt, camera, player)  .onMined(position)  .dispose()
//   new SpaceCombat(scene, effects, gameState, system, shipCtl)
//     .update(dt, camera)  .dispose()
//
// Events out:
//   'combat:wanted'       { level, evading01 }  on every change + each frame
//                         while the evade timer runs (integrator: HUD chip)
//   'combat:wardenKilled' { type }              type: scout|aegis|lancer|colossus
import * as THREE from 'three';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { RNG, hash32 } from '../core/rng.js';
import { buildShip } from '../render/shipmesh.js';
import { audio } from '../audio/audio.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

// ---------------------------------------------------------------- Wardens ---

const WARDEN_BOLT_SPEED = 55;
const PLAYER_BOLT_SPEED = 90;

const MAX_UNITS = 9;          // hard cap on simultaneously active machines
const EVADE_TIME = 12;        // seconds hidden+far to clear the wanted level
const EVADE_DIST = 160;       // metres — inside this you are always "in contact"
const LOS_MAX_DIST = 300;     // beyond this even clear line-of-sight loses you

// Colossus rig dimensions (root-local metres)
const COL_L1 = 1.5;           // thigh length
const COL_L2 = 1.35;          // shin length
const COL_HIP_Y = 2.5;        // hip joint height above the feet plane
const COL_TORSO_Y = 3.12;     // torso group height
const COL_HIP_LX = 0.95;      // hip sideways offset
const COL_STRIDE = 1.15;      // foot drift before a step triggers
const COL_STEP_T = 0.36;      // seconds per stomp

/** Per-type tuning. radius2 = squared hit radius for the player's bolts. */
const UNIT = {
  scout: {
    hp: 5, hover: 2.6, orbit: 18, tangent: 10, speed: 8.5,
    fireMin: 1.7, fireMax: 2.6, volley: 3, dmg: 9, boltSpeed: WARDEN_BOLT_SPEED,
    color: '#ff4a3c', range: 60, radius2: 1.35, boom: 0.9,
  },
  aegis: {
    hp: 5, hover: 2.9, orbit: 14, tangent: 8, speed: 7,
    fireMin: 2.0, fireMax: 3.0, volley: 2, dmg: 9, boltSpeed: WARDEN_BOLT_SPEED,
    color: '#ff7a2d', range: 60, radius2: 1.7, boom: 1.15, shieldHits: 3,
  },
  lancer: {
    hp: 5, hover: 3.4, orbit: 24, tangent: 16, speed: 13,
    fireMin: 1.25, fireMax: 1.9, volley: 1, dmg: 7, boltSpeed: 70,
    color: '#ff3c6e', range: 80, radius2: 1.5, boom: 1.0, twin: true,
  },
  colossus: {
    hp: 24, hover: 0, fireMin: 4.5, fireMax: 6.5, tele: 1.1, volley: 3,
    dmg: 16, boltSpeed: 42, color: '#ff2418', range: 90, radius2: 5.5,
    boom: 2.8, walkSpeed: 2.4, turnRate: 1.1, holdRange: 22,
  },
};

// --- shared geometry/material caches (module-level; survive planet changes,
// never disposed — every unit reuses these, so spawns are allocation-light) ---

const _geoCache = new Map();
function geo(key, make) {
  let g = _geoCache.get(key);
  if (!g) { g = make(); _geoCache.set(key, g); }
  return g;
}
const _matCache = new Map();
function mat(key, make) {
  let m = _matCache.get(key);
  if (!m) { m = make(); _matCache.set(key, m); }
  return m;
}
function stdMat(key, color, rough, metal) {
  return mat(key, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
}
/** Unit box helper: one shared BoxGeometry, per-mesh scale. */
function box(parent, material, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Scout: floating custodian drone — dark octahedral core, ring shards, HDR eye. */
function buildScout(rng) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(geo('scoutCore', () => new THREE.OctahedronGeometry(0.55, 0)),
    stdMat('hull', 0x2a2f38, 0.4, 0.85));
  core.castShadow = true;
  g.add(core);

  const ring = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const arc = new THREE.Mesh(geo('scoutArc', () => new THREE.TorusGeometry(0.95, 0.07, 5, 10, Math.PI * 0.5)),
      stdMat('trim', 0x555f6e, 0.5, 0.8));
    arc.rotation.z = (i / 3) * Math.PI * 2 + rng.next();
    arc.castShadow = true;
    ring.add(arc);
  }
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  const eye = new THREE.Mesh(geo('eyeS', () => new THREE.SphereGeometry(0.16, 10, 10)),
    mat('scoutEye', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.2, 4.0) })));
  eye.position.set(0, 0, 0.52);
  g.add(eye);

  return { group: g, ring, eye, owned: [] };
}

/** Aegis: shielded enforcer — hex-column core, twin hex collars, blink shield. */
function buildAegis(rng) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(geo('aegisCore', () => new THREE.CylinderGeometry(0.48, 0.48, 0.8, 6)),
    stdMat('aegisHull', 0x27313c, 0.42, 0.85));
  core.castShadow = true;
  g.add(core);
  const capG = geo('aegisCap', () => new THREE.CylinderGeometry(0.46, 0.16, 0.34, 6));
  const capT = new THREE.Mesh(capG, stdMat('trim', 0x555f6e, 0.5, 0.8));
  capT.position.y = 0.57;
  const capB = new THREE.Mesh(capG, stdMat('trim', 0x555f6e, 0.5, 0.8));
  capB.rotation.x = Math.PI;
  capB.position.y = -0.57;
  capT.castShadow = capB.castShadow = true;
  g.add(capT, capB);

  const ring = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const collar = new THREE.Mesh(geo('aegisCollar', () => new THREE.TorusGeometry(0.92, 0.075, 4, 6)),
      stdMat('aegisTrim', 0x4a6b8a, 0.45, 0.8));
    collar.rotation.z = rng.next() + i * 0.52;
    collar.castShadow = true;
    ring.add(collar);
  }
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  const eye = new THREE.Mesh(geo('eyeS', () => new THREE.SphereGeometry(0.16, 10, 10)),
    mat('aegisEye', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 2.2, 0.6) })));
  eye.position.set(0, 0, 0.56);
  g.add(eye);

  // hex shield: translucent faceted sphere + wireframe cage, blinked on hit
  const shieldGeo = geo('shield', () => new THREE.IcosahedronGeometry(1.22, 1));
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const shield = new THREE.Mesh(shieldGeo, shieldMat);
  const shieldWireMat = new THREE.MeshBasicMaterial({
    color: 0x9fe8ff, wireframe: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const shieldWire = new THREE.Mesh(shieldGeo, shieldWireMat);
  shield.visible = shieldWire.visible = false;
  g.add(shield, shieldWire);

  return { group: g, ring, eye, shield, shieldWire, shieldMat, shieldWireMat, owned: [shieldMat, shieldWireMat] };
}

/** Lancer: fast strafing dart — stretched core, swept blades, twin gun prongs. */
function buildLancer(rng) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(geo('lancerCore', () => {
    const c = new THREE.OctahedronGeometry(0.5, 0);
    c.scale(0.55, 0.55, 1.9);
    return c;
  }), stdMat('lancerHull', 0x33262e, 0.4, 0.85));
  core.castShadow = true;
  g.add(core);

  const trim = stdMat('trim', 0x555f6e, 0.5, 0.8);
  const dark = stdMat('dark', 0x171b22, 0.55, 0.7);
  for (const s of [-1, 1]) {
    const blade = box(g, trim, 1.25, 0.05, 0.42, s * 0.72, 0.02, 0.12);
    blade.rotation.z = s * 0.38;
    blade.rotation.y = -s * 0.32;
    box(g, dark, 0.08, 0.08, 0.9, s * 0.4, -0.1, 0.5); // gun prongs
  }
  const fin = box(g, trim, 0.05, 0.5, 0.44, 0, 0.26, -0.72);
  fin.rotation.x = -0.25;

  const eye = new THREE.Mesh(geo('eyeL', () => new THREE.SphereGeometry(0.13, 10, 10)),
    mat('lancerEye', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 0.8, 1.4) })));
  eye.position.set(0, 0, 1.0);
  g.add(eye);

  return { group: g, ring: null, eye, owned: [], seed: rng.next() };
}

/** THE COLOSSUS: 4 m walker — boxy torso, two articulated reverse-knee legs
 *  with terrain-stick stomping gait, head turret with one big red eye. */
function buildColossus(rng) {
  const g = new THREE.Group();
  const hull = stdMat('colHull', 0x2a303a, 0.42, 0.85);
  const trim = stdMat('colTrim', 0x4d5866, 0.5, 0.78);
  const dark = stdMat('dark', 0x171b22, 0.55, 0.7);
  const glowRed = mat('colGlow', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 0.22, 0.16) }));

  const torso = new THREE.Group();
  torso.position.y = COL_TORSO_Y;
  g.add(torso);
  box(torso, hull, 2.05, 1.2, 1.5, 0, 0.3, 0);                 // main mass
  const glacis = box(torso, trim, 1.75, 0.75, 0.55, 0, 0.42, 0.82);
  glacis.rotation.x = -0.42;                                    // sloped front plate
  box(torso, dark, 1.35, 0.4, 1.75, 0, 0.98, -0.02);            // top spine housing
  box(torso, trim, 0.6, 0.3, 0.5, 0, 1.22, -0.55);              // rear stack
  box(torso, glowRed, 0.55, 0.06, 0.06, 0, 0.72, 1.0);          // warning strip
  box(torso, dark, 1.6, 0.62, 1.0, 0, -0.45, 0);                // hip block
  for (const s of [-1, 1]) {
    box(torso, trim, 0.42, 0.55, 1.2, s * 1.22, 0.28, 0);       // shoulder pods
    box(torso, glowRed, 0.1, 0.08, 0.08, s * 1.22, 0.28, 0.62); // pod lights
  }

  const head = new THREE.Group();
  head.position.set(0, 1.3, 0.6);
  torso.add(head);
  box(head, hull, 1.1, 0.58, 0.9, 0, 0, 0);
  box(head, trim, 1.3, 0.18, 0.6, 0, 0.34, 0.14);               // brow
  for (const s of [-1, 1]) box(head, dark, 0.18, 0.18, 0.62, s * 0.7, -0.08, 0.14); // cheek guns
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.32, 0.26) });
  const eye = new THREE.Mesh(geo('colEye', () => new THREE.SphereGeometry(0.23, 12, 12)), eyeMat);
  eye.position.set(0, 0, 0.48);
  head.add(eye);
  const socket = new THREE.Mesh(geo('colSocket', () => new THREE.TorusGeometry(0.31, 0.06, 6, 14)), dark);
  socket.position.set(0, 0, 0.46);
  head.add(socket);

  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * COL_HIP_LX, COL_HIP_Y - COL_TORSO_Y, 0);
    torso.add(hip);
    box(hip, trim, 0.72, 0.72, 0.9, side * 0.12, 0.16, 0);      // hip armor
    const thigh = new THREE.Group();
    hip.add(thigh);
    box(thigh, hull, 0.52, COL_L1, 0.66, 0, -COL_L1 / 2, 0);
    box(thigh, glowRed, 0.08, COL_L1 * 0.5, 0.08, side * 0.31, -COL_L1 / 2, 0.3); // piston glow
    const knee = new THREE.Group();
    knee.position.y = -COL_L1;
    thigh.add(knee);
    box(knee, dark, 0.38, COL_L2, 0.48, 0, -COL_L2 / 2, 0);
    box(knee, trim, 0.5, 0.42, 0.66, 0, -0.05, -0.12);          // knee cap (rear)
    const foot = new THREE.Group();
    foot.position.y = -COL_L2;
    knee.add(foot);
    box(foot, trim, 0.78, 0.24, 1.2, 0, -0.11, 0.12);
    box(foot, dark, 0.84, 0.14, 0.4, 0, -0.16, 0.72);           // toe
    legs.push({
      side, hip, thigh, knee, foot,
      planted: new THREE.Vector3(), pos: new THREE.Vector3(), swing: null, other: null,
    });
  }
  legs[0].other = legs[1];
  legs[1].other = legs[0];

  return { group: g, torso, head, eye, eyeMat, legs, ring: null, owned: [eyeMat] };
}

const BUILDERS = { scout: buildScout, aegis: buildAegis, lancer: buildLancer, colossus: buildColossus };

export class GroundCombat {
  constructor(scene, effects, gs, surface) {
    this.scene = scene;
    this.effects = effects;
    this.gs = gs;
    this.surface = surface;
    this.wardens = [];
    this.playerBolts = [];   // { handle, prev }
    this.hostileBolts = [];  // { handle, damage }
    this._fireCd = 0;
    this._spawnTimer = 12;
    this._heat = 0;
    this._warnedHostile = false;
    this._t = 0;
    this._spawnSeq = 0;

    // WANTED LEVEL state
    this.wanted = 0;
    this._evade = 0;          // seconds spent out of contact
    this._incoming = null;    // { t } — pending reinforcement telegraph
    this._lastSeen = new THREE.Vector3();

    const def = surface.def;
    // machine presence follows mineral wealth: crystal worlds are watched
    this.activity = Math.min(1, (def.crystalDensity ?? 0) * 0.9
      + (def.hasRuins ? 0.25 : 0) + (def.hazard?.rad ?? 0) * 0.3 + 0.15);
    this.cap = Math.round(1 + this.activity * 3);
    this.rng = new RNG(hash32(def.seed ?? 1, 0x77a2d));

    this._onMinedEvt = () => this.onMined(surface.player?.position);
    events.on('resource:mined', this._onMinedEvt);
    this._onDeathEvt = () => {
      this._heat = 0;
      if (this.wanted > 0) this._setWanted(0);
    };
    events.on('player:death', this._onDeathEvt);
  }

  /** mining heat — Wardens investigate, then the wanted system escalates */
  onMined(position) {
    // aggressive worlds accumulate heat faster; dead worlds barely react
    this._heat = Math.min(9, this._heat + 0.45 + this.activity * 0.75);
    if (this._heat >= 5 && this.wanted === 0 && this.activity >= 0.28) {
      this._raiseWanted();
    }
    if (!position) return;
    for (const w of this.wardens) {
      if (w.state === 'dead' || w.state === 'leaving') continue;
      const d = w.obj.group.position.distanceTo(position);
      if (d < 140 && w.state === 'patrol') {
        w.state = 'alert';
        w.target.copy(position);
        w.stateT = 0;
      } else if (d < 60 && this._heat >= 5 && w.state !== 'hostile') {
        this._goHostile(w);
      }
    }
  }

  // ---- wanted level ---------------------------------------------------------

  /** +1 wanted (max 5). At max, keeps waves coming instead. */
  _raiseWanted() {
    if (this.wanted >= 5) {
      if (!this._incoming) {
        this._incoming = { t: this.rng.range(6, 10) };
        events.emit('notify', { text: 'REINFORCEMENTS INBOUND', tone: 'danger' });
        audio.sfx('deny');
      }
      return;
    }
    this._setWanted(this.wanted + 1);
  }

  _setWanted(level) {
    level = Math.max(0, Math.min(5, level | 0));
    if (level === this.wanted) return;
    const rising = level > this.wanted;
    this.wanted = level;
    this._evade = 0;
    events.emit('combat:wanted', { level, evading01: 0 });
    if (rising) {
      this._incoming = { t: this.rng.range(6, 10) };
      events.emit('notify', { text: `REINFORCEMENTS INBOUND — WANTED ${'◆'.repeat(level)}`, tone: 'danger' });
      audio.sfx('deny');
      for (const w of this.wardens) {
        if (w.state !== 'dead' && w.state !== 'leaving' && w.state !== 'hostile') this._goHostile(w, true);
      }
    } else if (level === 0) {
      this._incoming = null;
      this._heat = 0;
      this._warnedHostile = false;
      for (const w of this.wardens) {
        if (w.state !== 'dead' && w.state !== 'leaving') this._powerDown(w);
      }
    }
  }

  _updateWanted(dt, player) {
    if (this._incoming) {
      this._incoming.t -= dt;
      if (this._incoming.t <= 0) {
        this._incoming = null;
        this._spawnWave(this.wanted);
      }
    }
    if (this.wanted === 0) return;

    // contact: any active Warden within 160 m, or with clear line-of-sight
    let contact = false;
    for (const w of this.wardens) {
      if (w.state === 'dead' || w.state === 'leaving') continue;
      const p = w.obj.group.position;
      const d = p.distanceTo(player.position);
      if (d < EVADE_DIST || (d < LOS_MAX_DIST && this._losClear(p, player.position))) {
        contact = true;
        break;
      }
    }
    if (contact) {
      this._lastSeen.copy(player.position);
      if (this._evade > 0) {
        this._evade = 0;
        events.emit('combat:wanted', { level: this.wanted, evading01: 0 });
      }
    } else {
      this._evade += dt;
      events.emit('combat:wanted', {
        level: this.wanted,
        evading01: Math.min(1, this._evade / EVADE_TIME),
      });
      if (this._evade >= EVADE_TIME) {
        events.emit('notify', { text: 'WARDEN PROTOCOL STAND-DOWN — heat cleared', tone: 'good' });
        this._setWanted(0);
      }
    }
  }

  /** terrain-sampled line-of-sight between a warden and the player */
  _losClear(a, b) {
    const f = this.surface.field;
    const ay = a.y + 0.4, by = b.y + 1.5;
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const y = ay + (by - ay) * t;
      if (f.height(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) > y) return false;
    }
    return true;
  }

  // ---- spawning ---------------------------------------------------------------

  _aliveCount() {
    let n = 0;
    for (const w of this.wardens) if (w.state !== 'dead') n++;
    return n;
  }

  /** Wave composition per level, scaled by planet activity. */
  _spawnWave(level) {
    if (level <= 0) return;
    const rng = this.rng;
    const c = this._lastSeen;
    const comp = [];
    let scouts = level >= 2 ? 2 : 1;
    if (this.activity > 0.72 && level >= 2) scouts += 1;   // policed worlds pile on
    if (this.activity < 0.42 && scouts > 1) scouts -= 1;   // quiet worlds respond thin
    for (let i = 0; i < scouts; i++) comp.push('scout');
    if (level >= 3) comp.push('aegis');
    if (level >= 4) comp.push('lancer');
    if (level >= 5 && !this.wardens.some((w) => w.type === 'colossus' && w.state !== 'dead')) {
      comp.push('colossus');
    }
    for (const type of comp) {
      const a = rng.next() * Math.PI * 2;
      const d = type === 'colossus' ? rng.range(55, 80) : rng.range(42, 70);
      const u = this._spawnUnit(type, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, 'hostile', type !== 'colossus');
      if (u && type === 'colossus') {
        events.emit('notify', { text: 'SEISMIC CONTACT — THE COLOSSUS HAS DEPLOYED', tone: 'danger' });
        audio.sfx('deny');
        this.effects.landingDust(u.obj.group.position.clone());
      }
    }
  }

  _spawnUnit(type, x, z, state = 'patrol', dropIn = false) {
    if (this._aliveCount() >= MAX_UNITS) return null;
    const rng = this.rng.fork(`u${this._spawnSeq++}`);
    const P = UNIT[type];
    const obj = BUILDERS[type](rng);
    const groundY = this.surface.field.height(x, z);
    const y = type === 'colossus' ? groundY : groundY + P.hover + (dropIn ? 24 : 0);
    obj.group.position.set(x, y, z);
    this.scene.add(obj.group);
    const w = {
      type, p: P, obj, hp: P.hp, state, stateT: 0,
      target: new THREE.Vector3(x, y, z),
      fireT: rng.range(P.fireMin, P.fireMax), volley: 0, shotT: 0,
      bobPhase: rng.next() * 6.28,
      shieldHits: P.shieldHits ?? 0, shieldFlash: 0,
      strafeDir: rng.chance(0.5) ? 1 : -1, strafeT: rng.range(2.5, 5),
      flinch: 0, telegraphed: false, gaitD: 0,
    };
    if (type === 'colossus') this._initLegs(w);
    this.wardens.push(w);
    return w;
  }

  // ---- frame update -------------------------------------------------------------

  update(dt, camera, player) {
    const gs = this.gs;
    this._t += dt;
    this._heat = Math.max(0, this._heat - dt * 0.12);
    this._fireCd -= dt;
    if (!this._seenInit) {
      this._seenInit = true;
      this._lastSeen.copy(player.position);
    }

    // ambient patrol population (waves own the sky once the level rises)
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0) {
      this._spawnTimer = 24;
      if (this.wanted === 0 && this._aliveCount() < this.cap
        && this.rng.chance(0.35 + this.activity * 0.4)) {
        const a = this.rng.next() * Math.PI * 2;
        const d = this.rng.range(55, 95);
        this._spawnUnit('scout', player.position.x + Math.cos(a) * d, player.position.z + Math.sin(a) * d);
      }
    }

    // player bolt fire (Arcforge bolt caster; suppressed while build mode owns LMB)
    if (gs.tool.mode === 'bolt' && !this.suppressFire
      && input.mouseDown[0] && input.aiming && this._fireCd <= 0) {
      this._fireCd = 0.24 / (1 + (gs.upgrades.toolBolt ?? 0) * 0.35);
      const dir = camera.getWorldDirection(_v1.set(0, 0, 0)).clone();
      dir.x += (Math.random() - 0.5) * 0.012;
      dir.y += (Math.random() - 0.5) * 0.012;
      dir.normalize();
      const from = this.surface?.arcforge
        ? this.surface.arcforge.muzzleWorld(new THREE.Vector3()).addScaledVector(dir, 0.4)
        : camera.position.clone().addScaledVector(dir, 0.9).add(_v2.set(0, -0.3, 0));
      const handle = this.effects.laserBolt(from, dir, PLAYER_BOLT_SPEED, '#6fffd0');
      this.playerBolts.push({ handle, prev: from.clone() });
      audio.sfx('laser');
    }

    // player bolts vs wardens (swept sphere against per-type hit centers)
    for (let i = this.playerBolts.length - 1; i >= 0; i--) {
      const b = this.playerBolts[i];
      if (!b.handle.alive) { this.playerBolts.splice(i, 1); continue; }
      for (const w of this.wardens) {
        if (w.state === 'dead' || w.state === 'leaving') continue;
        const center = this._aimPoint(w, _v4);
        const r2 = (w.type === 'aegis' && w.shieldHits > 0) ? 2.6 : w.p.radius2;
        const seg = _v1.copy(b.handle.position).sub(b.prev);
        const toW = _v2.copy(center).sub(b.prev);
        const t = THREE.MathUtils.clamp(toW.dot(seg) / Math.max(seg.lengthSq(), 1e-6), 0, 1);
        const closest = _v3.copy(b.prev).addScaledVector(seg, t);
        if (closest.distanceToSquared(center) < r2) {
          b.handle.alive = false;
          this.playerBolts.splice(i, 1);
          this._hitWarden(w, closest);
          break;
        }
      }
      if (b.handle.alive) b.prev.copy(b.handle.position);
    }

    // hostile bolts vs player
    for (let i = this.hostileBolts.length - 1; i >= 0; i--) {
      const b = this.hostileBolts[i];
      if (!b.handle.alive) { this.hostileBolts.splice(i, 1); continue; }
      const eye = _v1.copy(player.position); eye.y += 1.2;
      if (b.handle.position.distanceToSquared(eye) < 2.3) {
        b.handle.alive = false;
        this.hostileBolts.splice(i, 1);
        this.surface.survival.applyDamage(b.damage, 'laser');
      }
    }

    // unit behavior
    for (const w of this.wardens) {
      if (w.state === 'dead') continue;
      w.stateT += dt;
      if (w.state === 'leaving') this._updateLeaving(w, dt);
      else if (w.type === 'colossus') this._updateColossus(w, dt, player);
      else this._updateDrone(w, dt, player);
    }
    // compact the roster so dead entries never accumulate
    for (let i = this.wardens.length - 1; i >= 0; i--) {
      if (this.wardens[i].state === 'dead') this.wardens.splice(i, 1);
    }

    this._updateWanted(dt, player);
  }

  /** world-space hit/aim center for a unit */
  _aimPoint(w, out) {
    out.copy(w.obj.group.position);
    if (w.type === 'colossus') out.y += 3.0;
    return out;
  }

  // ---- drones (scout / aegis / lancer) -----------------------------------------

  _updateDrone(w, dt, player) {
    const g = w.obj.group;
    const P = w.p;
    if (w.obj.ring) w.obj.ring.rotation.z += dt * (w.state === 'hostile' ? 3.2 : 0.8);
    const groundY = this.surface.field.height(g.position.x, g.position.z);
    let hoverY = groundY + P.hover + Math.sin(this._t * 1.1 + w.bobPhase) * 0.25;
    if (P.twin) hoverY += Math.sin(this._t * 2.7 + w.bobPhase) * 1.3; // lancer weave
    const dPlayer = g.position.distanceTo(player.position);

    // aegis shield shimmer + hit-blink decay
    if (w.obj.shieldMat) {
      w.shieldFlash = Math.max(0, w.shieldFlash - dt * 2.4);
      const base = w.shieldHits > 0 ? 0.05 : 0;
      w.obj.shieldMat.opacity = base + w.shieldFlash * 0.42;
      w.obj.shieldWireMat.opacity = base * 1.7 + w.shieldFlash * 0.9;
      const on = w.obj.shieldMat.opacity > 0.004;
      w.obj.shield.visible = on;
      w.obj.shieldWire.visible = on;
      w.obj.shield.rotation.y += dt * 0.7;
      w.obj.shieldWire.rotation.y = w.obj.shield.rotation.y;
    }

    if (w.state === 'patrol') {
      if (w.stateT > 7 || g.position.distanceTo(w.target) < 3) {
        w.stateT = 0;
        const a = this.rng.next() * Math.PI * 2;
        w.target.set(g.position.x + Math.cos(a) * 30, 0, g.position.z + Math.sin(a) * 30);
      }
      this._moveToward(w, w.target, 5, hoverY, dt);
      if (dPlayer > 400) this._despawn(w);
    } else if (w.state === 'alert') {
      this._moveToward(w, w.target, 9, hoverY, dt);
      g.lookAt(player.position.x, g.position.y, player.position.z);
      if (w.stateT > 12) { w.state = 'patrol'; w.stateT = 0; }
      if (this._heat >= 5 && dPlayer < 70) this._goHostile(w);
    } else if (w.state === 'hostile') {
      // strafe-orbit the player (or their last known position when evaded)
      const focus = dPlayer < 150 ? player.position : this._lastSeen;
      w.strafeT -= dt;
      if (w.strafeT <= 0) {
        w.strafeT = this.rng.range(2.5, 5);
        if (P.twin) w.strafeDir *= -1; // lancers cut back hard
      }
      const orbit = _v1.copy(g.position).sub(focus);
      orbit.y = 0;
      const r = Math.max(orbit.length(), 0.001);
      const tangent = _v2.set(-orbit.z / r, 0, orbit.x / r).multiplyScalar(w.strafeDir);
      const radial = (r - P.orbit) / P.orbit;
      _v3.copy(focus)
        .addScaledVector(orbit, Math.max(0.2, 1 - radial * 0.5) / r * P.orbit)
        .addScaledVector(tangent, P.tangent);
      this._moveToward(w, _v3, P.speed, hoverY + 1.2, dt);
      g.lookAt(player.position.x, player.position.y + 1.4, player.position.z);

      // telegraphed volleys
      w.fireT -= dt;
      const tele = w.fireT < 0.45 && w.fireT > 0;
      w.obj.eye.scale.setScalar(tele ? 1.9 : 1);
      if (w.fireT <= 0) {
        w.volley = P.volley;
        w.fireT = this.rng.range(P.fireMin, P.fireMax);
      }
      if (w.volley > 0 && w.fireT < P.fireMin - 0.25 && dPlayer < P.range) {
        w.volley -= 1;
        this._fireDroneBolt(w, player);
      }
      if (this.wanted === 0 && dPlayer > 120) { w.state = 'alert'; w.stateT = 0; }
    }
  }

  _fireDroneBolt(w, player) {
    const g = w.obj.group;
    const P = w.p;
    const from = g.localToWorld(_v1.set(0, 0, 0.6));
    if (P.twin) {
      // Lancer: aimed twin-bolts with target lead
      const right = _v2.set(1, 0, 0).applyQuaternion(g.quaternion);
      for (const s of [-1, 1]) {
        const src = _v3.copy(from).addScaledVector(right, s * 0.42);
        const aim = _v4.copy(player.position);
        aim.y += 1.2;
        if (player.velocity) aim.addScaledVector(player.velocity, src.distanceTo(aim) / P.boltSpeed);
        aim.x += (Math.random() - 0.5) * 1.2;
        aim.z += (Math.random() - 0.5) * 1.2;
        const dir = _v5.copy(aim).sub(src).normalize();
        const handle = this.effects.laserBolt(src, dir, P.boltSpeed, P.color);
        this.hostileBolts.push({ handle, damage: P.dmg });
      }
    } else {
      const aim = _v2.copy(player.position);
      aim.y += 1.1;
      aim.x += (Math.random() - 0.5) * 2.2;
      aim.z += (Math.random() - 0.5) * 2.2;
      const dir = aim.sub(from).normalize();
      const handle = this.effects.laserBolt(from, dir, P.boltSpeed, P.color);
      this.hostileBolts.push({ handle, damage: P.dmg });
    }
    audio.sfx('laser', { volume: 0.5 });
  }

  // ---- THE COLOSSUS ---------------------------------------------------------------

  _initLegs(w) {
    for (const leg of w.obj.legs) {
      this._footHome(w, leg, _v1);
      leg.planted.set(_v1.x, this.surface.field.height(_v1.x, _v1.z), _v1.z);
      leg.pos.copy(leg.planted);
      leg.swing = null;
    }
    this._solveLeg(w, w.obj.legs[0]);
    this._solveLeg(w, w.obj.legs[1]);
  }

  /** rest position for a foot in world space (y unset) */
  _footHome(w, leg, out) {
    const g = w.obj.group;
    const c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);
    const lx = leg.side * COL_HIP_LX, lz = 0.18;
    out.set(g.position.x + c * lx + s * lz, 0, g.position.z - s * lx + c * lz);
    return out;
  }

  _updateColossus(w, dt, player) {
    const g = w.obj.group;
    const P = w.p;
    const dPlayer = g.position.distanceTo(player.position);
    const focus = dPlayer < 220 ? player.position : this._lastSeen;

    // ponderous turn toward the target
    const dx = focus.x - g.position.x, dz = focus.z - g.position.z;
    const wantYaw = Math.atan2(dx, dz);
    let dYaw = wantYaw - g.rotation.y;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    const turn = THREE.MathUtils.clamp(dYaw, -P.turnRate * dt, P.turnRate * dt);
    g.rotation.y += turn;

    // slow stomping approach; holds range instead of trampling the player
    const dFlat = Math.hypot(dx, dz);
    let walk = 0;
    if (dFlat > P.holdRange && Math.abs(dYaw) < 1.2) {
      walk = P.walkSpeed;
      g.position.x += Math.sin(g.rotation.y) * walk * dt;
      g.position.z += Math.cos(g.rotation.y) * walk * dt;
    }
    w.gaitD += (walk + Math.abs(turn) * 3) * dt;

    this._updateLegs(w, dt, walk, dPlayer);

    // torso mass rides the gait; flinches when shot
    w.flinch = Math.max(0, w.flinch - dt * 2.5);
    const torso = w.obj.torso;
    torso.position.y = COL_TORSO_Y + Math.sin(w.gaitD * 2.4) * 0.05;
    torso.rotation.z = Math.sin(w.gaitD * 1.2) * 0.045;
    torso.rotation.x = 0.04 + w.flinch * 0.05 * Math.sin(this._t * 30);

    // head turret tracks the player
    _v1.copy(player.position);
    _v1.y += 1.2;
    w.obj.head.lookAt(_v1);

    // heavy telegraphed triple-volley
    w.fireT -= dt;
    const eye = w.obj.eye;
    if (w.fireT < P.tele && w.fireT > 0) {
      const k = 1 - w.fireT / P.tele;
      eye.scale.setScalar(1 + k * 0.9 + Math.sin(this._t * 26) * 0.12 * k);
      w.obj.eyeMat.color.setRGB(2.6 + k * 2.2, 0.32 + k * 0.3, 0.26);
      if (!w.telegraphed) {
        w.telegraphed = true;
        if (dPlayer < 110) audio.sfx('deny', { volume: 0.4 });
      }
    } else {
      eye.scale.setScalar(1);
      w.obj.eyeMat.color.setRGB(2.6, 0.32, 0.26);
    }
    if (w.fireT <= 0) {
      w.volley = P.volley;
      w.shotT = 0;
      w.fireT = this.rng.range(P.fireMin, P.fireMax);
      w.telegraphed = false;
    }
    if (w.volley > 0) {
      if (dPlayer > P.range) { w.volley = 0; return; }
      w.shotT -= dt;
      if (w.shotT <= 0) {
        w.shotT = 0.3;
        w.volley -= 1;
        this._fireColossusBolt(w, player);
      }
    }
  }

  _updateLegs(w, dt, walk, dPlayer) {
    const g = w.obj.group;
    const field = this.surface.field;
    const fwdX = Math.sin(g.rotation.y), fwdZ = Math.cos(g.rotation.y);
    for (const leg of w.obj.legs) {
      this._footHome(w, leg, _v4);
      if (!leg.swing) {
        const off = Math.hypot(_v4.x - leg.planted.x, _v4.z - leg.planted.z);
        if (off > COL_STRIDE && !leg.other.swing) {
          const lead = walk > 0 ? 0.65 : 0.1; // overstep when marching
          leg.swing = {
            t: 0, fx: leg.planted.x, fz: leg.planted.z,
            tx: _v4.x + fwdX * lead, tz: _v4.z + fwdZ * lead,
          };
        }
      }
      if (leg.swing) {
        const sw = leg.swing;
        sw.t += dt / COL_STEP_T;
        const k = Math.min(1, sw.t);
        const e = k * k * (3 - 2 * k);
        const x = sw.fx + (sw.tx - sw.fx) * e, z = sw.fz + (sw.tz - sw.fz) * e;
        leg.pos.set(x, field.height(x, z) + Math.sin(k * Math.PI) * 0.55, z);
        if (k >= 1) {
          leg.planted.set(sw.tx, field.height(sw.tx, sw.tz), sw.tz);
          leg.pos.copy(leg.planted);
          leg.swing = null;
          // stomp: dust ring + distant thud
          if (dPlayer < 90) this.effects.landingDust(leg.pos);
          if (dPlayer < 60) audio.sfx('land', { volume: 0.22 });
        }
      } else {
        leg.pos.copy(leg.planted);
      }
    }
    // the hull rides the feet — terrain-stick without ever floating
    const feetY = (w.obj.legs[0].pos.y + w.obj.legs[1].pos.y) / 2;
    g.position.y += (feetY - g.position.y) * Math.min(1, dt * 6);

    for (const leg of w.obj.legs) this._solveLeg(w, leg);
  }

  /** analytic 2-bone IK (reverse-knee) in the walker's sagittal plane */
  _solveLeg(w, leg) {
    const g = w.obj.group;
    const c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);
    const wx = leg.pos.x - g.position.x;
    const wz = leg.pos.z - g.position.z;
    const lz = s * wx + c * wz;                     // root-local forward offset
    const ankleY = (leg.pos.y - g.position.y) + 0.22;
    const hipY = COL_HIP_Y + (w.obj.torso.position.y - COL_TORSO_Y);
    const dz = lz;
    const dy = ankleY - hipY;
    const d = THREE.MathUtils.clamp(Math.hypot(dz, dy), 0.5, COL_L1 + COL_L2 - 0.02);
    const phi = Math.atan2(-dz, -dy);
    const cosA = THREE.MathUtils.clamp((COL_L1 * COL_L1 + d * d - COL_L2 * COL_L2) / (2 * COL_L1 * d), -1, 1);
    const cosB = THREE.MathUtils.clamp((COL_L2 * COL_L2 + d * d - COL_L1 * COL_L1) / (2 * COL_L2 * d), -1, 1);
    const a1 = phi + Math.acos(cosA);               // thigh — knee kicked back
    const a2 = phi - Math.acos(cosB);               // shin absolute angle
    leg.thigh.rotation.x = a1;
    leg.knee.rotation.x = a2 - a1;
    leg.foot.rotation.x = -a2;                      // keep the foot level
  }

  _fireColossusBolt(w, player) {
    const P = w.p;
    w.obj.eye.getWorldPosition(_v1);
    const aim = _v2.copy(player.position);
    aim.y += 1.0;
    if (player.velocity) aim.addScaledVector(player.velocity, _v1.distanceTo(aim) / P.boltSpeed * 0.7);
    aim.x += (Math.random() - 0.5) * 1.6;
    aim.z += (Math.random() - 0.5) * 1.6;
    const dir = _v3.copy(aim).sub(_v1).normalize();
    // heavy shot: damage bolt flanked by two visual bolts — reads as one thick bolt
    const handle = this.effects.laserBolt(_v1, dir, P.boltSpeed, P.color);
    this.hostileBolts.push({ handle, damage: P.dmg });
    const right = _v4.set(dir.z, 0, -dir.x).normalize();
    for (const s of [-0.18, 0.18]) {
      _v5.copy(_v1).addScaledVector(right, s);
      const h2 = this.effects.laserBolt(_v5, dir, P.boltSpeed, '#ff5a30');
      this.hostileBolts.push({ handle: h2, damage: 0 });
    }
    audio.sfx('laser', { volume: 0.8 });
  }

  // ---- shared unit plumbing --------------------------------------------------------

  _moveToward(w, target, speed, hoverY, dt) {
    const g = w.obj.group.position;
    _v1.set(target.x - g.x, 0, target.z - g.z);
    const d = _v1.length();
    if (d > 0.5) g.addScaledVector(_v1.normalize(), Math.min(speed, d) * dt);
    g.y += (hoverY - g.y) * Math.min(1, dt * 3);
  }

  _goHostile(w, quiet = false) {
    w.state = 'hostile';
    w.stateT = 0;
    if (!this._warnedHostile && !quiet) {
      this._warnedHostile = true;
      events.emit('notify', { text: 'WARDEN PROTOCOL ESCALATION — weapons free', tone: 'danger' });
      audio.sfx('deny');
    }
  }

  _hitWarden(w, at) {
    // Aegis shield eats the first hits — visible hex-shield blink, no damage
    if (w.type === 'aegis' && w.shieldHits > 0) {
      w.shieldHits -= 1;
      w.shieldFlash = 1;
      this.effects.sparks(at ?? w.obj.group.position, _v1.set(0, 1, 0), '#8fd8ff');
      audio.sfx('boltHit', { volume: 0.7 });
      if (w.state !== 'hostile') this._goHostile(w);
      return;
    }
    w.hp -= 1;
    w.flinch = 1;
    this.effects.sparks(this._aimPoint(w, _v2), _v1.set(0, 1, 0), '#7de8ff');
    audio.sfx('boltHit');
    if (w.state !== 'hostile') this._goHostile(w);
    if (w.hp <= 0) this._killUnit(w);
  }

  _killUnit(w) {
    const center = this._aimPoint(w, _v1).clone();
    this.effects.explosion(center, w.p.boom, w.type === 'colossus' ? '#ff9448' : '#7de8ff');
    audio.sfx('explosion');
    if (w.type === 'colossus') {
      this.effects.explosion(w.obj.group.position.clone(), 1.4, '#ffb454');
      const drops = 8 + Math.floor(Math.random() * 5); // 8..12
      this.gs.addItem('nebulite', drops);
      this.gs.addItem('luminelshard', 1);
      events.emit('notify', { text: `COLOSSUS DOWN — +${drops} Nebulite`, tone: 'good' });
      events.emit('notify', { text: 'Salvaged its Luminel Shard core.', tone: 'info' });
    } else {
      const drops = 2 + Math.floor(Math.random() * 3);
      this.gs.addItem('nebulite', drops);
      events.emit('notify', { text: `WARDEN DOWN — +${drops} Nebulite`, tone: 'good' });
      if (Math.random() < 0.06) {
        this.gs.addItem('luminelshard', 1);
        events.emit('notify', { text: 'It was carrying a Luminel Shard.', tone: 'info' });
      }
    }
    events.emit('combat:wardenKilled', { type: w.type });
    this._removeUnit(w);
    this._raiseWanted();
  }

  /** stand-down: stop fighting, rise, despawn */
  _powerDown(w) {
    w.state = 'leaving';
    w.stateT = 0;
    w.volley = 0;
    if (w.obj.eye) w.obj.eye.scale.setScalar(1);
    if (w.obj.shield) w.obj.shield.visible = w.obj.shieldWire.visible = false;
  }

  _updateLeaving(w, dt) {
    const g = w.obj.group;
    g.position.y += dt * (3 + w.stateT * 4);
    if (w.obj.ring) w.obj.ring.rotation.z += dt * 0.5;
    if (w.obj.eye) w.obj.eye.scale.setScalar(Math.max(0.25, 1 - w.stateT * 0.35));
    if (w.type === 'colossus') {
      // legs relax straight as it lifts away
      const k = 1 - Math.min(1, dt * 2);
      for (const leg of w.obj.legs) {
        leg.thigh.rotation.x *= k;
        leg.knee.rotation.x *= k;
        leg.foot.rotation.x *= k;
      }
    }
    if (w.stateT > 3.5) this._removeUnit(w);
  }

  _removeUnit(w) {
    w.state = 'dead';
    this.scene.remove(w.obj.group);
    for (const m of w.obj.owned) m.dispose();
  }

  _despawn(w) {
    this._removeUnit(w);
  }

  dispose() {
    events.off('resource:mined', this._onMinedEvt);
    events.off('player:death', this._onDeathEvt);
    for (const w of this.wardens) {
      this.scene.remove(w.obj.group);
      for (const m of w.obj.owned ?? []) m.dispose();
    }
    this.wardens.length = 0;
  }
}

// ------------------------------------------------------------ Ashen Fleet ---

const PIRATE_BOLT_SPEED = 260;
const SHIP_BOLT_SPEED = 420;

export class SpaceCombat {
  constructor(scene, effects, gs, system, shipCtl) {
    this.scene = scene;
    this.effects = effects;
    this.gs = gs;
    this.system = system;
    this.shipCtl = shipCtl;
    this.pirates = [];
    this.playerBolts = [];
    this.hostileBolts = [];
    this.rng = new RNG(hash32(system.seed ?? 1, 0xa5e17));
    this._fireCd = 0;
    this._waveTimer = 40 + this.rng.range(0, 30);  // grace period
    this.cap = Math.max(1, Math.round(1 + (system.pirateThreat ?? 0) * 2));
  }

  get hasHostiles() { return this.pirates.some((p) => p.hp > 0); }

  _spawnWave() {
    const n = this.rng.int(1, this.cap);
    for (let i = 0; i < n; i++) {
      const built = buildShip(hash32(this.system.seed, 900 + this.pirates.length), 'talon');
      // ashen livery: scorch the hull toward ember-red
      built.group.traverse((o) => {
        if (o.isMesh && o.material?.color && !o.material.emissive) o.material = o.material.clone();
        if (o.isMesh && o.material?.color && o.material.emissive !== undefined) {
          o.material = o.material.clone();
          o.material.color.lerp(new THREE.Color(0x8c2a22), 0.55);
        }
      });
      const a = this.rng.next() * Math.PI * 2;
      const pos = this.shipCtl.position.clone().add(
        _v1.set(Math.cos(a) * 700, this.rng.range(-120, 160), Math.sin(a) * 700));
      built.group.position.copy(pos);
      this.scene.add(built.group);
      const trail = this.effects.engineTrail(built.group, '#ff5a3c');
      trail.setLevel?.(0.7);
      this.pirates.push({
        built, trail, hp: 6, state: 'approach', stateT: 0,
        fireT: 1, peel: new THREE.Vector3(),
      });
    }
    events.emit('notify', { text: `ASHEN FLEET RAIDERS INBOUND ×${n}`, tone: 'danger' });
    audio.sfx('deny');
  }

  update(dt, camera) {
    const gs = this.gs;
    this._fireCd -= dt;

    // wave spawning
    if ((this.system.pirateThreat ?? 0) > 0.12) {
      this._waveTimer -= dt;
      if (this._waveTimer <= 0) {
        this._waveTimer = this.rng.range(90, 160);
        if (!this.hasHostiles) this._spawnWave();
      }
    }

    // player fire: LMB fires nose bolts with soft aim assist
    if (input.mouseDown[0] && input.aiming && this._fireCd <= 0 && this.hasHostiles) {
      this._fireCd = 0.22;
      const fwd = this.shipCtl.forward.clone();
      let dir = fwd;
      let best = null, bestDot = Math.cos(THREE.MathUtils.degToRad(10));
      for (const p of this.pirates) {
        if (p.hp <= 0) continue;
        _v1.copy(p.built.group.position).sub(this.shipCtl.position);
        const dist = _v1.length();
        const d = _v1.normalize().dot(fwd);
        if (d > bestDot) { bestDot = d; best = { p, dist }; }
      }
      if (best) {
        // lead the target
        const lead = best.p.built.group.position.clone()
          .addScaledVector(best.p.vel ?? _v2.set(0, 0, 0), best.dist / SHIP_BOLT_SPEED);
        dir = lead.sub(this.shipCtl.position).normalize();
      }
      const from = this.shipCtl.position.clone().addScaledVector(this.shipCtl.forward, 3.2);
      const handle = this.effects.laserBolt(from, dir, SHIP_BOLT_SPEED, '#7de8ff');
      this.playerBolts.push({ handle, prev: from.clone() });
      audio.sfx('laser');
    }

    // player bolts vs pirates
    for (let i = this.playerBolts.length - 1; i >= 0; i--) {
      const b = this.playerBolts[i];
      if (!b.handle.alive) { this.playerBolts.splice(i, 1); continue; }
      for (const p of this.pirates) {
        if (p.hp <= 0) continue;
        const seg = _v1.copy(b.handle.position).sub(b.prev);
        const toP = _v2.copy(p.built.group.position).sub(b.prev);
        const t = THREE.MathUtils.clamp(toP.dot(seg) / Math.max(seg.lengthSq(), 1e-6), 0, 1);
        if (_v3.copy(b.prev).addScaledVector(seg, t)
          .distanceToSquared(p.built.group.position) < 14) {
          b.handle.alive = false;
          this.playerBolts.splice(i, 1);
          this._hitPirate(p);
          break;
        }
      }
      if (b.handle.alive) b.prev.copy(b.handle.position);
    }

    // hostile bolts vs player ship
    for (let i = this.hostileBolts.length - 1; i >= 0; i--) {
      const b = this.hostileBolts[i];
      if (!b.handle.alive) { this.hostileBolts.splice(i, 1); continue; }
      if (b.handle.position.distanceToSquared(this.shipCtl.position) < 20) {
        b.handle.alive = false;
        this.hostileBolts.splice(i, 1);
        this._damagePlayer(8);
      }
    }

    // pirate AI
    for (const p of this.pirates) {
      if (p.hp <= 0) continue;
      p.stateT += dt;
      const g = p.built.group;
      const toPlayer = _v1.copy(this.shipCtl.position).sub(g.position);
      const dist = toPlayer.length();
      toPlayer.normalize();

      let want = toPlayer, speed = 62;
      if (p.state === 'approach') {
        if (dist < 240) { p.state = 'attack'; p.stateT = 0; }
      } else if (p.state === 'attack') {
        speed = 74;
        p.fireT -= dt;
        const fwd = g.getWorldDirection(_v2).negate();
        if (p.fireT <= 0 && fwd.dot(toPlayer) > 0.94 && dist < 320) {
          p.fireT = 0.55;
          const from = g.position.clone().addScaledVector(fwd, 3);
          const aim = this.shipCtl.position.clone()
            .addScaledVector(this.shipCtl.velocity, dist / PIRATE_BOLT_SPEED);
          aim.x += (Math.random() - 0.5) * 6;
          aim.y += (Math.random() - 0.5) * 6;
          const handle = this.effects.laserBolt(from, aim.sub(from).normalize(), PIRATE_BOLT_SPEED, '#ff5a3c');
          this.hostileBolts.push({ handle });
          audio.sfx('laser', { volume: 0.45 });
        }
        if (dist < 70) {
          p.state = 'peel';
          p.stateT = 0;
          p.peel.copy(g.position).addScaledVector(_v2.set(
            this.rng.range(-1, 1), this.rng.range(-0.4, 0.7), this.rng.range(-1, 1)).normalize(), 380);
        }
      } else if (p.state === 'peel') {
        want = _v2.copy(p.peel).sub(g.position).normalize();
        speed = 85;
        if (p.stateT > 4.5 || g.position.distanceTo(p.peel) < 60) { p.state = 'approach'; p.stateT = 0; }
      }

      // steer: slerp the nose toward the desired direction, fly forward
      _q1.setFromUnitVectors(_v3.set(0, 0, -1), want);
      g.quaternion.slerp(_q1, Math.min(1, dt * 1.6));
      const fwd = g.getWorldDirection(_v3).negate();
      p.vel = p.vel ?? new THREE.Vector3();
      p.vel.copy(fwd).multiplyScalar(speed);
      g.position.addScaledVector(p.vel, dt);
    }
  }

  _damagePlayer(amount) {
    const gs = this.gs;
    const sAbs = Math.min(gs.ship.shield, amount);
    gs.ship.shield -= sAbs;
    const through = amount - sAbs;
    if (through > 0) {
      gs.ship.hull = Math.max(0, gs.ship.hull - through);
      const frac = gs.ship.hull / gs.ship.hullMax;
      if (frac <= 0.5 && !this._warn50) { this._warn50 = true; events.emit('notify', { text: 'HULL 50% — disengage or fight', tone: 'warn' }); }
      if (frac <= 0.25 && !this._warn25) { this._warn25 = true; events.emit('notify', { text: 'HULL CRITICAL', tone: 'danger' }); }
      if (gs.ship.hull <= 0) {
        this.effects.explosion(this.shipCtl.position.clone(), 2.2, '#ffb454');
        audio.sfx('explosion');
        events.emit('player:death');
        return;
      }
    }
    this.shipCtl.shake(0.8);
    audio.sfx('boltHit');
  }

  _hitPirate(p) {
    p.hp -= 1;
    this.effects.sparks(p.built.group.position.clone(), _v1.set(0, 1, 0), '#ffb454');
    audio.sfx('boltHit');
    if (p.hp <= 0) {
      this.effects.explosion(p.built.group.position.clone(), 1.6, '#ff8a3c');
      audio.sfx('explosion');
      p.trail?.dispose?.();
      this.scene.remove(p.built.group);
      const bounty = 150 + Math.floor(Math.random() * 150);
      this.gs.addLumens(bounty);
      events.emit('notify', { text: `RAIDER DESTROYED — +${bounty} ⌾`, tone: 'good' });
      events.emit('combat:pirateKilled');
      if (Math.random() < 0.4) {
        this.gs.addItem('nebulite', 2);
        events.emit('notify', { text: '+2 Nebulite salvaged', tone: 'good' });
      }
      if (!this.hasHostiles) {
        events.emit('notify', { text: 'THREAT CLEARED', tone: 'info' });
      }
    }
  }

  dispose() {
    for (const p of this.pirates) {
      p.trail?.dispose?.();
      this.scene.remove(p.built.group);
    }
    this.pirates.length = 0;
  }
}
