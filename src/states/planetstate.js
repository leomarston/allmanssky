// Planet state (DEBUG / ISOLATED) — the REAL seamless spherical planet, playable.
//
// Reached ONLY via ?state=planet. Constructs a PlanetSphere (the verified
// cube-sphere LOD world in src/render/planetsphere.js) and flies you from orbit
// down to a walk on the round surface as ONE continuous experience — no fade,
// no cut. Nothing here touches SpaceState / SurfaceState or the live flow; the
// only wiring outside this file is an additive ?state=planet branch in main.js.
//
// FLOATING ORIGIN (precision):
//   PlanetSphere.update(dt, camWorldPos) rebases its root to
//   (planetCenter - camWorldPos), so the render camera always sits AT the world
//   origin and everything it sees is small-magnitude — float32 holds at
//   planetary scale. We therefore track the player's true position as
//   `playerUniPos` (a "universe" Vector3, measured from the planet centre at the
//   origin) which can be tens of thousands of units, feed THAT to planet.update
//   every frame, and keep the THREE camera pinned to (0,0,0) — only its
//   orientation changes.
//
// TWO MODES, one seam:
//   'ship' — sphere-aware arcade flight. Pitch/yaw/roll + throttle steer a
//            quaternion; gentle gravity pulls toward planet centre; a soft
//            self-levelling torque keeps "up" near the local radial so the
//            horizon reads right. Descend continuously; PlanetSphere refines LOD.
//   'foot' — sphere character controller. "up" = radial dir = normalize(pos);
//            gravity along -up; WASD move tangent to the sphere on a basis built
//            from up + heading; jump; every frame re-project the eye to
//            heightAt(dir)+EYE so you stay glued to terrain as it refines.
//
//   F disembarks ship→foot near the ground (no fade). G takes off foot→ship.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { buildShip } from '../render/shipmesh.js';
import { PlanetSphere, BIOMES, pickBiome } from '../render/planetsphere.js';
import { PlanetScatter } from '../render/planetscatter.js';
import { PlanetFauna } from '../render/planetfauna.js';
import { PlanetResources } from '../render/planetresources.js';
import { EffectsSystem } from '../render/effects.js';
import { createSkyEnvironment } from '../render/environment.js';
import { itemColor, ITEMS } from '../gameplay/items.js';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

// --- feel constants (borrowed from the flat controllers where sensible) ------
const EYE_HEIGHT = 1.7;             // player.js
const WALK_SPEED = 5.2;             // player.js
const SPRINT_MULT = 1.65;           // player.js
const JUMP_SPEED = 6.5;             // ~player.js JUMP_SPEED
const FOOT_GRAVITY = 12.0;          // radial m/s^2 — snappy but grounded
const AIR_CONTROL = 0.28;           // ~player.js
const LOOK_SENS = 0.0023;           // player.js sensitivity

const SHIP_MAX_SPEED = 340;         // units/s — brisk enough to descend from orbit
const SHIP_BOOST = 3.0;
const SHIP_PITCH = 1.6, SHIP_YAW = 1.1, SHIP_ROLL = 2.2;   // shipcontrol.js rates
const SHIP_GRAVITY = 6.0;           // gentle radial pull
const SHIP_BANK_RATE = 1.5;         // self-level "up" toward radial (per sec)
const SHIP_SENS = 0.0016;           // shipcontrol.js steering sens

const MIN_CLEARANCE = 3.5;          // ship never dips below terrain + this
const LAND_MAX_AGL = 120;           // F disembark allowed under this AGL
const DISEMBARK_MAX_SPEED = 70;     // ...and under this speed
const PLANET_RADIUS = 4000;
const PLANET_SEED_DEFAULT = 20260704;   // parity with test/pages/planet.html

const SUN_DIR = new THREE.Vector3(0.55, 0.42, 0.72).normalize();
const SHIP_OFFSET = new THREE.Vector3(0, -1.1, -4.0);   // chase view, camera at origin

export class PlanetState {
  constructor(ctx) {
    this.ctx = ctx;
    this.name = 'planet';
    this.mode = 'ship';                 // 'ship' | 'foot'

    // --- universe-frame bookkeeping (all measured from planet centre = origin)
    this.playerUniPos = new THREE.Vector3();   // eye/craft position, may be huge
    this.shipVel = new THREE.Vector3();        // universe-space m/s (ship mode)
    this.shipQuat = new THREE.Quaternion();    // ship orientation
    this.shipAngVel = new THREE.Vector3();     // pitch/yaw/roll rates
    this.throttle = 0;
    this.boost = false;

    this.footVel = new THREE.Vector3();        // universe-space m/s (foot mode)
    this.footFwd = new THREE.Vector3(0, 0, -1);// persistent tangent heading
    this.pitch = 0;
    this.onGround = false;

    this._interactLabel = null;

    // --- scratch (no per-frame allocation in the hot loop) --------------------
    this._dir = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._vTan = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._axisX = new THREE.Vector3();
    this._axisY = new THREE.Vector3();
    this._axisZ = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._m = new THREE.Matrix4();
    this._lookPt = new THREE.Vector3();
    this._sUp = new THREE.Vector3();      // radial up handed to PlanetScatter

    // --- harvest mining scratch/state ----------------------------------------
    this._mineBeam = null;
    this._mineTick = 0;
    this._aim = new THREE.Vector3();       // camera aim direction (world)
    this._mineFrom = new THREE.Vector3();  // beam emitter tip
    this._mineTo = new THREE.Vector3();    // beam endpoint (node middle)
  }

  async enter(params = {}) {
    const { ctx } = this;
    const seed = (params.seed ?? PLANET_SEED_DEFAULT) >>> 0;

    // Biome: an explicit key (?biome=desert / params.biome), else picked
    // deterministically from the seed. Drives the planet AND the scene lighting.
    const biome = (typeof params.biome === 'string' && BIOMES[params.biome])
      ? BIOMES[params.biome] : pickBiome(seed);
    this.biome = biome;
    const L = biome.light;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(biome.atmosphere.thin ? 0x000000 : 0x01030a);
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4e5);
    this.scene.add(this.camera);

    // lighting: a directional key + low hemispheric bounce, both biome-tinted.
    // The heavy lifting is the sky IBL below (scene.environment) which supplies
    // real hemispheric irradiance so shadow-side faces read as lit, not black.
    const sun = new THREE.DirectionalLight(L.sunColor, L.sunIntensity);
    sun.position.copy(SUN_DIR).multiplyScalar(1e5);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiInt));
    this._sun = sun;

    // image-based lighting: a PMREM environment baked ONCE from the biome's sky.
    this.env = createSkyEnvironment(ctx.engine.renderer, {
      zenith: L.envZenith, horizon: L.envHorizon, ground: L.envGround,
      sunDir: SUN_DIR, sunColor: biome.atmosphere.sunColor, sunIntensity: 3.0, haze: 0.35,
    });
    this.env.apply(this.scene, L.envIntensity);

    // aerial perspective: exponential fog in the biome's tint, altitude-gated per
    // frame in update(). Near-vacuum (barren) worlds get much thinner fog.
    this._fogBase = new THREE.Color(L.fog);
    this._fogThin = biome.atmosphere.thin ? 0.32 : 1.0;
    this.scene.fog = new THREE.FogExp2(L.fog, 0.0);
    ctx.engine.setExposure(1.1);

    this._buildStars();

    // the real planet (same biome descriptor so light + world agree). No
    // seaLevel override — PlanetSphere derives it from the biome (no-sea worlds
    // park it below the terrain floor so nothing reads as underwater).
    this.planet = new PlanetSphere(this.scene, {
      seed, radius: PLANET_RADIUS, biome,
    });
    this.planet.setSunDirection(SUN_DIR);
    this.planet.setPlanetCenter(new THREE.Vector3(0, 0, 0));

    // streamed ground cover (grass/plants/rocks) glued to the round surface in
    // the same floating-origin frame as the planet — makes walking feel alive.
    this.scatter = new PlanetScatter(this.scene, this.planet, {
      seed, sunDir: SUN_DIR, density: 1, biome: this.biome,
    });

    // wandering creatures glued to the round surface in the same floating-origin
    // frame — they stream in / recycle as you walk and make the world feel alive.
    this.fauna = new PlanetFauna(this.scene, this.planet, { seed, biome: this.biome });

    // pooled VFX (mining beam + sparks) and the harvestable resource layer —
    // both glued to the round surface in the same floating-origin frame.
    this.effects = new EffectsSystem(this.scene);
    this.resources = new PlanetResources(this.scene, this.planet, {
      seed, sunDir: SUN_DIR, density: 1, biome: this.biome,
    });

    // ship visual (camera-relative; stays near origin for precision)
    const gs = ctx.gameState;
    this.shipObj = buildShip(gs?.ship?.seed ?? seed, gs?.ship?.class ?? 'swift');
    this.scene.add(this.shipObj.group);

    // --- start in orbit, looking down at the round world ----------------------
    // A sun-lit, non-polar direction reads best (terminator + colour).
    const startDir = new THREE.Vector3(0.38, 0.26, 0.90).normalize();
    const groundR = this.planet.heightAt(startDir);
    this.playerUniPos.copy(startDir).multiplyScalar(groundR + PLANET_RADIUS * 2.2);
    // nose toward planet centre, tipped a touch toward the tangent so the curved
    // limb sits in frame; "up" = local radial so the self-leveller has nothing
    // to fight on the very first frame.
    this._up.copy(startDir);
    this._tmp.set(0, 1, 0).cross(startDir).normalize();      // a horizontal tangent
    this._fwd.copy(startDir).multiplyScalar(-0.86).addScaledVector(this._tmp, 0.14).normalize();
    this._orientShip(this._fwd, this._up);
    this.throttle = 0;
    this.shipVel.set(0, 0, 0);

    this._buildHint();
    ctx.hud?.setMode('ship');

    // prime one LOD pass so the first rendered frame is already a built planet
    this.planet.update(1 / 60, this.playerUniPos);
    this._syncShipCamera();
  }

  // ---- helpers ---------------------------------------------------------------

  /** Orient this.shipQuat to look along `fwd` with `up` (both ~unit). */
  _orientShip(fwd, up) {
    this._axisZ.copy(fwd).negate();                           // local +Z = -forward
    this._axisX.crossVectors(up, this._axisZ).normalize();
    this._axisY.crossVectors(this._axisZ, this._axisX).normalize();
    this._m.makeBasis(this._axisX, this._axisY, this._axisZ);
    this.shipQuat.setFromRotationMatrix(this._m);
  }

  /** any unit tangent at radial `dir` (into out) — for a stable fallback heading */
  _anyTangent(dir, out) {
    out.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.9) out.set(1, 0, 0);
    out.addScaledVector(dir, -out.dot(dir)).normalize();
    return out;
  }

  /** universe altitude of the eye/craft above local terrain (AGL) */
  get agl() {
    return this.playerUniPos.length() - this.planet.heightAt(this.playerUniPos);
  }

  get speed() {
    return this.mode === 'ship' ? this.shipVel.length() : this.footVel.length();
  }

  _uiOpen() { return this.ctx.ui?.anyOpen?.() ?? false; }

  // ---- public transitions (also driven by the headless check) ---------------

  /** Place the craft at a given AGL along the current radial (test/descent aid),
   *  levelled into a horizon-facing pose so the descent reads correctly. */
  placeAtAGL(agl) {
    this._dir.copy(this.playerUniPos).normalize();
    const groundR = this.planet.heightAt(this._dir);
    this.playerUniPos.copy(this._dir).multiplyScalar(groundR + agl);
    this.shipVel.set(0, 0, 0);
    // aim the nose along the horizon (current heading flattened into the tangent)
    this._fwd.set(0, 0, -1).applyQuaternion(this.shipQuat);
    this._fwd.addScaledVector(this._dir, -this._fwd.dot(this._dir));
    if (this._fwd.lengthSq() < 1e-6) this._anyTangent(this._dir, this._fwd);
    this._orientShip(this._fwd.normalize(), this._dir);
  }

  /** Seamless ship→foot: no fade. Snap the eye to eye-height above terrain. */
  disembark() {
    this._dir.copy(this.playerUniPos).normalize();
    // heading = ship forward flattened into the tangent plane
    this._fwd.set(0, 0, -1).applyQuaternion(this.shipQuat);
    this._fwd.addScaledVector(this._dir, -this._fwd.dot(this._dir));
    if (this._fwd.lengthSq() < 1e-6) this._anyTangent(this._dir, this._fwd);
    this.footFwd.copy(this._fwd).normalize();
    this.pitch = 0;

    const groundR = this.planet.heightAt(this._dir);
    this.playerUniPos.copy(this._dir).multiplyScalar(groundR + EYE_HEIGHT);
    this.footVel.set(0, 0, 0);
    this.onGround = true;

    this.mode = 'foot';
    this.shipObj.group.visible = false;
    this.ctx.hud?.setMode('foot');
  }

  /** Seamless foot→ship: re-mount and climb. */
  takeOff() {
    this._dir.copy(this.playerUniPos).normalize();
    // nose = current heading tilted up toward the radial
    this._fwd.copy(this.footFwd).addScaledVector(this._dir, 0.6).normalize();
    this._orientShip(this._fwd, this._dir);
    const groundR = this.planet.heightAt(this._dir);
    const startR = groundR + Math.max(this.agl, MIN_CLEARANCE + 6);
    this.playerUniPos.copy(this._dir).multiplyScalar(startR);
    this.shipVel.copy(this._dir).multiplyScalar(28);   // initial climb
    this.throttle = 0.5;

    this.mode = 'ship';
    this.shipObj.group.visible = true;
    this.ctx.hud?.setMode('ship');
  }

  // ---- per-frame -------------------------------------------------------------

  update(dt) {
    // 1) floating-origin rebase + LOD, centred on the player's universe position
    this.planet.update(dt, this.playerUniPos);

    if (this.mode === 'ship') this._updateShip(dt);
    else this._updateFoot(dt);

    // ground cover follows the (now-updated) player position in both modes, so
    // it streams in as you fly low and stays glued while you walk.
    this._sUp.copy(this.playerUniPos).normalize();
    this.scatter?.update(dt, this.playerUniPos, this._sUp);
    this.fauna?.update(dt, this.playerUniPos, this._sUp);
    this.resources?.update(dt, this.playerUniPos, this._sUp);
    this.effects?.update(dt);

    // aerial perspective: gate fog by altitude (orbit stays crisp; near the
    // ground distant terrain dissolves into the sky) and tint it to the sky
    // horizon at the current sun elevation — the SAME palette the atmosphere
    // shell uses, so the terrain→sky seam stays invisible.
    // fade stars out in daylight (the sky dome takes over) and back in as we
    // climb to orbit, where the sky dome fades to space.
    if (this.stars) this.stars.material.opacity = 1 - this.planet.groundAmt;

    const fog = this.scene.fog;
    if (fog) {
      const nearGround = Math.max(0, Math.min(1, 1 - this.agl / 1800));
      fog.density = nearGround * 0.00042 * this._fogThin;
      // biome fog tint, dimmed on the night side (near-vacuum worlds barely fog).
      const sunUp = SUN_DIR.dot(this._sUp);
      const day = Math.max(0, Math.min(1, (sunUp + 0.25) / 0.37));
      fog.color.copy(this._fogBase).multiplyScalar(0.25 + 0.75 * day);
    }

    this._hud(dt);
  }

  _updateShip(dt) {
    const enabled = !this._uiOpen();
    this._dir.copy(this.playerUniPos).normalize();

    if (enabled) {
      // steering: mouse + arrows + A/D banked yaw (mirrors shipcontrol.js)
      const keyYaw = (input.action('left') ? 1 : 0) - (input.action('right') ? 1 : 0);
      const s = SHIP_SENS;
      const tPitch = THREE.MathUtils.clamp(
        -input.mouseDY * s * 60 - input.lookY * SHIP_PITCH * 0.75, -SHIP_PITCH, SHIP_PITCH);
      const tYaw = THREE.MathUtils.clamp(
        -input.mouseDX * s * 60 + (keyYaw - input.lookX) * SHIP_YAW * 0.85, -SHIP_YAW, SHIP_YAW);
      let tRoll = 0;
      if (input.action('rollLeft')) tRoll += SHIP_ROLL;
      if (input.action('rollRight')) tRoll -= SHIP_ROLL;
      tRoll += tYaw * 0.8;                        // auto-bank into turns

      const t = 1 - Math.exp(-8 * dt);
      this.shipAngVel.x += (tPitch - this.shipAngVel.x) * t;
      this.shipAngVel.y += (tYaw - this.shipAngVel.y) * t;
      this.shipAngVel.z += (tRoll - this.shipAngVel.z) * t;

      this._e.set(this.shipAngVel.x * dt, this.shipAngVel.y * dt, this.shipAngVel.z * dt, 'XYZ');
      this._q.setFromEuler(this._e);
      this.shipQuat.multiply(this._q);            // local-frame rotation

      if (input.action('forward')) this.throttle = Math.min(1, this.throttle + dt * 0.8);
      if (input.action('back')) this.throttle = Math.max(0, this.throttle - dt * 1.2);
      this.boost = input.action('boost') && this.throttle > 0.4;
    } else {
      this.throttle *= Math.max(0, 1 - dt * 2);
      this.boost = false;
    }

    // gentle self-levelling: rotate "up" toward the local radial so the horizon
    // stays sane and a disembark lands upright (world-frame correction).
    this._up.set(0, 1, 0).applyQuaternion(this.shipQuat);
    this._tmp.crossVectors(this._up, this._dir);
    const sn = this._tmp.length();
    if (sn > 1e-5) {
      const ang = Math.atan2(sn, this._up.dot(this._dir)) * Math.min(1, SHIP_BANK_RATE * dt);
      this._q.setFromAxisAngle(this._tmp.multiplyScalar(1 / sn), ang);
      this.shipQuat.premultiply(this._q);
    }

    // velocity chases the nose; add strafe + gravity
    this._fwd.set(0, 0, -1).applyQuaternion(this.shipQuat);
    const spd = this.throttle * SHIP_MAX_SPEED * (this.boost ? SHIP_BOOST : 1);
    this._wish.copy(this._fwd).multiplyScalar(spd);
    if (enabled) {
      const upAmt = (input.action('up') ? 1 : 0) - (input.action('down') ? 1 : 0);
      if (upAmt) {
        this._tmp.set(0, 1, 0).applyQuaternion(this.shipQuat);
        this._wish.addScaledVector(this._tmp, upAmt * SHIP_MAX_SPEED * 0.25);
      }
    }
    const vt = 1 - Math.exp(-(this.boost ? 1.6 : 2.6) * dt);
    this.shipVel.lerp(this._wish, vt);
    this.shipVel.addScaledVector(this._dir, -SHIP_GRAVITY * dt);   // radial gravity
    this.playerUniPos.addScaledVector(this.shipVel, dt);

    // hard floor: never pass through the terrain
    const groundR = this.planet.heightAt(this.playerUniPos);
    const r = this.playerUniPos.length();
    if (r < groundR + MIN_CLEARANCE) {
      this.playerUniPos.copy(this._dir).multiplyScalar(groundR + MIN_CLEARANCE);
      const vr = this.shipVel.dot(this._dir);
      if (vr < 0) this.shipVel.addScaledVector(this._dir, -vr);   // kill inward vel
    }

    this._syncShipCamera();

    // seamless disembark prompt
    this._interactLabel = null;
    if (enabled) {
      const agl = this.agl;
      if (agl < LAND_MAX_AGL && this.speed < DISEMBARK_MAX_SPEED) {
        this._interactLabel = 'F — DISEMBARK';
        if (input.actionPressed('interact')) this.disembark();
      } else if (agl < LAND_MAX_AGL) {
        this._interactLabel = 'SLOW DOWN TO DISEMBARK';
      }
    }
  }

  _syncShipCamera() {
    // camera pinned to the world origin (floating origin) — orientation only.
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.copy(this.shipQuat);
    // ship model sits just ahead/below in camera-relative space.
    this.shipObj.group.position.copy(SHIP_OFFSET).applyQuaternion(this.shipQuat);
    this.shipObj.group.quaternion.copy(this.shipQuat);
  }

  _updateFoot(dt) {
    const enabled = !this._uiOpen();
    this._up.copy(this.playerUniPos).normalize();               // radial "up"

    // look
    if (enabled) {
      const yawDelta = input.mouseDX * LOOK_SENS + input.lookX * 2.1 * dt;
      this._q.setFromAxisAngle(this._up, -yawDelta);
      this.footFwd.applyQuaternion(this._q);
      this.pitch -= input.mouseDY * LOOK_SENS + input.lookY * 1.6 * dt;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    }

    // re-project heading into the current tangent plane (sphere is round: the
    // tangent basis turns under you as you walk), then build a right vector.
    this.footFwd.addScaledVector(this._up, -this.footFwd.dot(this._up));
    if (this.footFwd.lengthSq() < 1e-8) this._anyTangent(this._up, this.footFwd);
    this.footFwd.normalize();
    this._right.crossVectors(this.footFwd, this._up).normalize();

    // wish direction from WASD, in the tangent plane
    let fx = 0, fz = 0;
    if (enabled) {
      if (input.action('forward')) fz += 1;
      if (input.action('back')) fz -= 1;
      if (input.action('right')) fx += 1;
      if (input.action('left')) fx -= 1;
    }
    this._wish.set(0, 0, 0)
      .addScaledVector(this.footFwd, fz)
      .addScaledVector(this._right, fx);
    const wl = this._wish.length();
    if (wl > 1e-4) this._wish.multiplyScalar(1 / wl);

    const sprinting = enabled && input.action('sprint') && fz > 0;
    const targetSpeed = (wl > 1e-4 ? WALK_SPEED : 0) * (sprinting ? SPRINT_MULT : 1);

    // decompose velocity into radial + tangential relative to the CURRENT up
    let vRad = this.footVel.dot(this._up);
    this._vTan.copy(this.footVel).addScaledVector(this._up, -vRad);

    if (this.onGround) {
      const t = 1 - Math.exp(-8.5 * dt);
      this._tmp.copy(this._wish).multiplyScalar(targetSpeed);   // target tangential vel
      this._vTan.lerp(this._tmp, t);
      if (enabled && input.actionPressed('jump')) { vRad = JUMP_SPEED; this.onGround = false; }
    } else {
      this._vTan.addScaledVector(this._wish, targetSpeed * AIR_CONTROL * dt * 6);
    }
    vRad -= FOOT_GRAVITY * dt;                                   // radial gravity
    this.footVel.copy(this._vTan).addScaledVector(this._up, vRad);

    this.playerUniPos.addScaledVector(this.footVel, dt);

    // glue to the surface: re-project the eye to heightAt(dir)+EYE each frame
    this._dir.copy(this.playerUniPos).normalize();
    const groundR = this.planet.heightAt(this._dir);
    const targetR = groundR + EYE_HEIGHT;
    const curR = this.playerUniPos.length();
    if (curR <= targetR + 1e-4) {
      this.playerUniPos.copy(this._dir).multiplyScalar(targetR);
      const vr = this.footVel.dot(this._dir);
      if (vr < 0) this.footVel.addScaledVector(this._dir, -vr);  // stop falling
      this.onGround = true;
    } else if (curR > targetR + 0.05) {
      this.onGround = false;
    }

    // camera: at origin, up = radial, look along heading pitched by this.pitch.
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this._lookPt.copy(this.footFwd).multiplyScalar(cp).addScaledVector(this._up, sp);
    this.camera.position.set(0, 0, 0);
    this.camera.up.copy(this._up);
    this.camera.lookAt(this._lookPt);

    // take-off prompt (default; the mining block below may override the label
    // while aimed at a node, but take-off via G must still work every frame).
    this._interactLabel = 'G — TAKE OFF';

    // --- harvest mining -------------------------------------------------------
    // aim = the camera look direction (camera sits at the origin, so _lookPt is
    // already the world-space aim). Query the resource layer along it.
    const gs = this.ctx.gameState;
    this._aim.copy(this._lookPt).normalize();
    const node = this.resources?.pickAlongAim(this.playerUniPos, this._aim, 26, 0.965);
    if (node) {
      this._interactLabel = 'HOLD LMB — MINE ' + (ITEMS[node.itemId]?.name ?? 'DEPOSIT').toUpperCase();
    }

    const firing = !!gs && !this._uiOpen() && input.mouseDown[0] && input.aiming && !!node;
    if (firing) {
      const colHex = itemColor(node.itemId);
      const to = this.resources.nodeEndPos(node, this.playerUniPos, this._mineTo);
      // beam emitter tip: just ahead of the eye, nudged down toward the hip.
      this._mineFrom.copy(this._aim).multiplyScalar(1.2).addScaledVector(this._up, -0.25);
      if (!this._mineBeam) {
        this._mineBeam = this.effects.miningBeam(this._mineFrom, to, colHex);
        audio.sfx('mine');
      } else {
        this._mineBeam.set(this._mineFrom, to);
      }
      this._mineTick += dt;
      if (this._mineTick >= 0.55) {
        this._mineTick = 0;
        this.effects.sparks(to, this._up, colHex);
        audio.sfx('mineHit');
        const qty = 1 + Math.floor(Math.random() * 2);
        const added = gs.addItem(node.itemId, qty);
        if (added > 0) {
          events.emit('notify', { text: `+${added} ${ITEMS[node.itemId].name}`, tone: 'good' });
          events.emit('resource:mined', { id: node.itemId, amount: added });
        }
        const res = this.resources.harvest(node, 1);
        if (res.depleted) audio.sfx('collect');
      }
    } else if (this._mineBeam) {
      this._mineBeam.off();
      this._mineBeam = null;
      this._mineTick = 0;
    }

    if (enabled && input.actionPressed('land')) this.takeOff();
  }

  _hud(dt) {
    const { ctx } = this;
    const gs = ctx.gameState;
    const inShip = this.mode === 'ship';
    // heading around the local up for the compass strip
    const headDeg = THREE.MathUtils.radToDeg(Math.atan2(this.footFwd.x, this.footFwd.z));
    ctx.hud?.update(dt, {
      health: gs ? gs.health / gs.healthMax : 1,
      shield: gs ? gs.shield / gs.shieldMax : 1,
      hull: gs ? gs.ship.hull / gs.ship.hullMax : 1,
      oxygen: gs ? gs.oxygen / gs.oxygenMax : 1,
      energy: gs ? gs.energy / gs.energyMax : 1,
      jetpack: 1,
      lumens: gs?.lumens ?? 0,
      speed: Math.round(inShip ? this.speed : this.speed * 3.6),
      altitude: Math.round(this.agl),
      fuel: gs?.ship?.fuel ?? 1,
      hazardIcons: [],
      compassDeg: headDeg,
      reticle: inShip ? 'ship' : (this._interactLabel ? 'interact' : 'dot'),
      interactLabel: this._interactLabel,
      locationLine: `SEAMLESS WORLD · ${inShip ? 'FLIGHT' : 'ON FOOT'}`,
    });
  }

  // ---- scene bits ------------------------------------------------------------

  _buildStars() {
    const N = 1600, p = new Float32Array(N * 3);
    let s = 987654321 >>> 0;
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d)) >>> 0) / 4294967296);
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = 1.2e5;
      const sr = Math.sqrt(1 - u * u);
      p[i * 3] = Math.cos(a) * sr * r; p[i * 3 + 1] = u * r; p[i * 3 + 2] = Math.sin(a) * sr * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size: 260, sizeAttenuation: true, transparent: true, depthWrite: false });
    this.stars = new THREE.Points(g, m);
    this.stars.frustumCulled = false;      // it's centred on the camera (origin)
    this.scene.add(this.stars);
  }

  _buildHint() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'left:50%', 'top:12px', 'transform:translateX(-50%)',
      'padding:6px 16px', 'font:11px/1.5 var(--ui-font,system-ui)',
      'letter-spacing:.14em', 'color:#7de8ff', 'background:rgba(8,20,28,.6)',
      'border:1px solid rgba(125,232,255,.35)', 'pointer-events:none', 'z-index:20',
      'text-align:center',
    ].join(';');
    el.innerHTML = 'SEAMLESS PLANET · W throttle · mouse steer · Q/E roll · '
      + '<b>F</b> disembark near ground · <b>G</b> take off · Space jump';
    document.getElementById('ui-root').appendChild(el);
    this._hintEl = el;
  }

  exit() {
    this._hintEl?.remove();
    this.ctx.hud?.setMode('hidden');
    this._mineBeam?.off?.();
    this.resources?.dispose();
    this.effects?.dispose?.();
    this.fauna?.dispose();
    this.scatter?.dispose();
    this.planet?.dispose();
    this.env?.dispose();
    this.ctx.engine.setExposure(1.0);          // restore global exposure on leave
    this.shipObj?.dispose?.();
    if (this.stars) { this.stars.geometry.dispose(); this.stars.material.dispose(); }
    this.scene = null;
  }
}
