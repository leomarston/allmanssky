// Surface state: on-planet gameplay — streamed terrain, sky/day-cycle, flora,
// fauna, props, and a full flight loop: atmospheric entry, low flight over
// terrain, auto-landing on the skids, boarding/exiting, and climbing back out
// of the atmosphere into space.
//
// Modes: 'ship' (flying) · 'auto' (scripted landing/takeoff) · 'seated'
// (grounded, in cockpit) · 'foot' (walking).
import * as THREE from 'three';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { TerrainField } from '../universe/terrainfield.js';
import { TerrainRenderer } from '../render/terrain.js';
import { SkyDome } from '../render/sky.js';
import { FloraSystem } from '../render/flora.js';
import { CreatureSystem } from '../gameplay/creatures.js';
import { EffectsSystem } from '../render/effects.js';
import { buildShip } from '../render/shipmesh.js';
import { PlayerController } from '../gameplay/player.js';
import { ShipController } from '../gameplay/shipcontrol.js';
import { PropManager } from './surfaceprops.js';
import { Survival } from '../gameplay/survival.js';
import { GroundMining } from '../gameplay/mining.js';
import { Scanner } from '../gameplay/scanner.js';
import { GroundCombat } from '../gameplay/combat.js';
import { BaseBuilder } from '../gameplay/basebuilding.js';
import { WeatherSystem } from '../render/weather.js';
import { audio } from '../audio/audio.js';

const BOARD_RANGE = 6;
const ENTRY_ALT = 420;         // AGL at atmospheric entry
const EXIT_ALT = 470;          // climb past this to leave for space
const LAND_MAX_AGL = 80;       // must be lower than this for G to land
const HOVER_ALT = 22;          // takeoff hover height
const MIN_CLEARANCE = 3.2;     // flight floor above terrain

export class SurfaceState {
  constructor(ctx) {
    this.ctx = ctx;
    this.name = 'surface';
  }

  async enter(params = {}) {
    const { ctx } = this;
    const gs = ctx.gameState;
    this.systemId = params.systemId ?? gs.currentSystemId;
    this.system = ctx.galaxy.getSystem(this.systemId);
    this.planetIndex = params.planetIndex ?? gs.location.planetIndex ?? 0;
    this.def = this.system.planets[this.planetIndex];
    gs.location = {
      mode: 'surface',
      planetIndex: this.planetIndex,
      pos: gs.location?.pos ?? null,
      landingPos: params.landingPos ?? gs.location?.landingPos ?? { x: 0, z: 0 },
    };

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 24000);

    this.field = new TerrainField(this.def);
    this.sky = new SkyDome(this.scene, this.def);
    if (this.sky.light) this.scene.add(this.sky.light);
    if (this.sky.ambient) this.scene.add(this.sky.ambient);
    this.terrain = new TerrainRenderer(this.scene, this.def, this.field);
    this.flora = new FloraSystem(this.scene, this.def, this.field);
    this.creatures = new CreatureSystem(this.scene, this.def, this.field);
    this.props = new PropManager(this.scene, this.def, this.field);
    this.effects = new EffectsSystem(this.scene);
    this.weather = new WeatherSystem(this.scene, this.def, this.def.seed);

    // ship — parked or inbound depending on how we arrived
    const lp = gs.location.landingPos;
    const shipBuild = buildShip(gs.ship.seed, gs.ship.class);
    this.shipObj = shipBuild;
    this.scene.add(shipBuild.group);
    this.shipCtl = new ShipController(shipBuild.group, {
      maxSpeed: 62 * (1 + gs.upgrades.shipSpeed * 0.2),
      agility: 1.05,
      boostMult: 1.8,
    });
    this.shipCtl.camOffset.set(0, 2.6, 10.5);
    this.trail = this.effects.engineTrail?.(shipBuild.group, '#7de8ff') ?? null;

    this.player = new PlayerController(this.camera, this.field, this.def.gravity);
    this.player.jetpack = gs.jetpack ?? 1;
    this.auto = null;

    if (params.arrive === 'entry') {
      // NMS-style: you enter the atmosphere still flying — pick your spot
      this.mode = 'ship';
      const groundY = this.field.height(lp.x, lp.z);
      shipBuild.group.position.set(lp.x, groundY + ENTRY_ALT, lp.z);
      shipBuild.group.rotation.set(-0.22, Math.atan2(-lp.x, -lp.z), 0); // nose gently down, toward origin
      this.shipCtl.velocity.copy(this.shipCtl.forward).multiplyScalar(46);
      this.shipCtl.throttle = 0.55;
      this.shipCtl.shake(0.9);
      events.emit('notify', { text: 'ATMOSPHERIC ENTRY — fly low and press G to land', tone: 'info' });
      audio.sfx('takeoff', { volume: 0.6 });
    } else {
      // parked on the ground (fresh landing site, save restore, respawn)
      this.mode = 'foot';
      this._parkShipAt(lp.x, lp.z);
      if (params.restorePos && gs.location.pos) {
        this.player.position.fromArray(gs.location.pos);
        this.player.velocity.set(0, 0, 0);
      } else {
        this.player.teleport(lp.x + 6, lp.z + 4);
      }
    }

    // gameplay systems (on-foot)
    this.survival = new Survival(gs);
    this.mining = new GroundMining(this.scene, this.effects, gs, this);
    this.scanner = new Scanner(gs);
    this.combat = new GroundCombat(this.scene, this.effects, gs, this);
    this.builder = new BaseBuilder(this.scene, this.field, gs, this.systemId, this.planetIndex);

    // suit headlamp (T)
    this.torch = new THREE.SpotLight(0xf2ecd8, 0, 60, 0.52, 0.45, 1.2);
    this.torch.visible = false;
    this.scene.add(this.torch, this.torch.target);

    // day cycle: deterministic phase per planet, advances in real time
    this.timeOfDay = ((this.def.seed % 1000) / 1000 + 0.28) % 1;
    const todOverride = new URLSearchParams(location.search).get('tod');
    if (todOverride != null) this.timeOfDay = Number(todOverride); // debug/test hook
    this._elapsed = 0;

    ctx.hud.setMode(this.mode === 'foot' ? 'foot' : 'ship');
    audio.setScene('surface', { biome: this.def.biome, danger: 0 });
    if (gs.discover('planets', this.def.id, this.def.name, 220)) gs.stats.planetsVisited += 1;
    events.emit('notify', {
      text: `${this.def.name.toUpperCase()} — ${this.def.biome} world · ${this.def.gravity.toFixed(1)}g`,
      tone: 'info',
    });
  }

  /** settle the ship visual onto its skids at (x, z) */
  _parkShipAt(x, z) {
    const g = this.shipObj.group;
    const y = this.field.height(x, z);
    g.position.set(x, y + 1.2, z);
    const yaw = g.rotation.y;
    g.rotation.set(0, yaw, 0);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.field.normal(x, z));
    g.rotateY(yaw);
    this.shipCtl.velocity.set(0, 0, 0);
    this.shipCtl.throttle = 0;
    this.ctx.gameState.location.landingPos = { x, z };
  }

  get shipAGL() {
    const p = this.shipObj.group.position;
    return p.y - this.field.height(p.x, p.z);
  }

  // ---- mode transitions ------------------------------------------------------

  _boardShip() {
    const gs = this.ctx.gameState;
    gs.ship.fuel = Math.max(0, gs.ship.fuel - 0.08);
    this.mode = 'auto';
    const from = this.shipObj.group.position.clone();
    this.auto = { kind: 'rise', start: performance.now(), dur: 1.5, from, to: from.clone().setY(from.y + HOVER_ALT) };
    this.effects.landingDust?.(from.clone());
    audio.sfx('takeoff');
    this.ctx.hud.setMode('ship');
    input.exitPointerLock?.call?.(input); // keep lock actually — no, keep it
  }

  _exitShip() {
    this.mode = 'foot';
    const g = this.shipObj.group.position;
    this.player.teleport(g.x + 5, g.z + 3);
    this.player.jetpack = this.ctx.gameState.jetpack ?? 1;
    this.ctx.hud.setMode('foot');
    audio.sfx('land', { volume: 0.5 });
    this.ctx.gameState.save();
  }

  _requestLanding() {
    const g = this.shipObj.group.position;
    const groundY = this.field.height(g.x, g.z);
    if (Number.isFinite(this.field.seaY) && groundY < this.field.seaY) {
      events.emit('notify', { text: 'CANNOT LAND ON WATER — find dry ground', tone: 'warn' });
      audio.sfx('deny');
      return;
    }
    this.mode = 'auto';
    this.auto = {
      kind: 'land', start: performance.now(),
      dur: Math.max(0.9, Math.min(3.2, (g.y - groundY - 1.2) / 14)),
      from: g.clone(),
      to: new THREE.Vector3(g.x, groundY + 1.2, g.z),
    };
    this.shipCtl.throttle = 0;
    audio.sfx('land', { volume: 0.7 });
  }

  async _exitAtmosphere() {
    if (this._leaving) return;
    this._leaving = true;
    const gs = this.ctx.gameState;
    events.emit('notify', { text: 'LEAVING ATMOSPHERE', tone: 'info' });
    audio.sfx('takeoff');
    this.shipCtl.shake(1.0);
    await this.ctx.fade(0.9, '#dfeeff');
    gs.location.pos = null;
    gs.save();
    this.ctx.switchState('space', {
      systemId: this.systemId,
      mode: 'takeoff',
      planetIndex: this.planetIndex,
    });
  }

  // ---- frame update ------------------------------------------------------------

  update(dt) {
    const { ctx } = this;
    const gs = ctx.gameState;
    this._elapsed += dt;

    this.timeOfDay = (this.timeOfDay + dt / this.def.dayLength) % 1;
    const sunElev = Math.sin(this.timeOfDay * Math.PI * 2);
    this.sky.update(dt, sunElev, this.camera.position);
    // thin the fog with altitude so the ground reads from the air
    if (this.scene.fog && this.mode !== 'foot') {
      const agl = Math.max(0, this.shipAGL);
      this.scene.fog.density *= THREE.MathUtils.clamp(1 - (agl / 650) * 0.65, 0.32, 1);
    }

    const uiOpen = ctx.ui.anyOpen?.() ?? false;
    const inShip = this.mode !== 'foot';

    // world streaming follows the ship in flight (look-ahead so terrain is
    // there before you are), the player on foot
    const focus = inShip
      ? this.shipObj.group.position.clone().addScaledVector(this.shipCtl.forward, 130)
      : this.player.position;
    this.terrain.update(dt, focus);
    this.flora.update(dt, focus);
    this.creatures.update(dt, inShip ? this.shipObj.group.position : this.player.position);
    this.props.update(focus);
    this.effects.update(dt);
    this.weather.update(dt, inShip ? this.shipObj.group.position : this.player.position, sunElev);

    if (this.mode === 'foot') this._updateFoot(dt, uiOpen, sunElev);
    else if (this.mode === 'ship') this._updateFlight(dt, uiOpen);
    else if (this.mode === 'auto') this._updateAuto(dt);
    else if (this.mode === 'seated') this._updateSeated(dt, uiOpen);

    this.survival.update(dt, {
      planetDef: this.def,
      isNight: sunElev < -0.08,
      inShip,
      moving: !inShip && this.player.speed > 0.5,
      sprinting: !inShip && input.action('sprint') && this.player.speed > 6,
      storm: inShip ? 0 : this.weather.intensity,
    });

    this._hud(dt, sunElev);
  }

  _updateFoot(dt, uiOpen, sunElev) {
    const gs = this.ctx.gameState;
    this.player.enabled = !uiOpen;
    this.player.update(dt);
    gs.jetpack = this.player.jetpack;
    gs.stats.distanceOnFoot += this.player.speed * dt;
    audio.engine(0);
    this.trail?.setLevel?.(0);

    if (this.torch.visible) {
      this.torch.position.copy(this.camera.position);
      this.camera.getWorldDirection(this.torch.target.position)
        .multiplyScalar(30).add(this.camera.position);
    }

    if (uiOpen) return;
    this.builder.update(dt, this.camera, this.player);
    if (!this.builder.active) this.mining.update(dt, this.camera, this);
    this.combat.suppressFire = this.builder.active;
    this.combat.update(dt, this.camera, this.player);

    if (input.actionPressed('torch')) {
      this.torch.visible = !this.torch.visible;
      this.torch.intensity = this.torch.visible ? 160 : 0;
      audio.sfx('click');
    }
    if (input.actionPressed('scan')) this.scanner.scan(this);
    if (input.actionPressed('swapWeapon') && !this.builder.active) {
      gs.tool.mode = gs.tool.mode === 'mine' ? 'bolt' : 'mine';
      audio.sfx('click');
      events.emit('notify', { text: `ARCFORGE MODE: ${gs.tool.mode === 'mine' ? 'MINING BEAM' : 'BOLT CASTER'}`, tone: 'info' });
    }
    this._interactions();
  }

  _updateFlight(dt, uiOpen) {
    const gs = this.ctx.gameState;
    this.shipCtl.enabled = !uiOpen;
    this.shipCtl.update(dt, this.camera);

    // hard floor above terrain (and the sea) — the planet always wins
    const g = this.shipObj.group.position;
    const groundHere = this.field.height(g.x, g.z);
    const floor = (Number.isFinite(this.field.seaY)
      ? Math.max(groundHere, this.field.seaY) : groundHere) + MIN_CLEARANCE;
    if (g.y < floor) {
      g.y = floor;
      if (this.shipCtl.velocity.y < 0) this.shipCtl.velocity.y = 0;
    }

    audio.engine(0.25 + this.shipCtl.throttle * (this.shipCtl.boost ? 0.75 : 0.5));
    this.trail?.setLevel?.(0.2 + this.shipCtl.throttle * 0.8);

    // keep the player (and its systems) with the ship
    this.player.position.copy(g);

    const agl = this.shipAGL;
    if (agl > EXIT_ALT) { this._exitAtmosphere(); return; }

    this._interactLabel = null;
    if (!uiOpen) {
      if (agl < LAND_MAX_AGL) {
        this._interactLabel = 'G — LAND HERE';
        if (input.actionPressed('land')) return this._requestLanding();
      } else if (agl > EXIT_ALT * 0.72) {
        this._interactLabel = 'KEEP CLIMBING TO LEAVE ATMOSPHERE';
      }
    }
  }

  _updateAuto(dt) {
    const a = this.auto;
    if (!a) { this.mode = 'ship'; return; }
    // wall-clock, not game-dt: the touch-down should take the same seconds on
    // a slow machine as a fast one
    const k = Math.min(1, (performance.now() - a.start) / (a.dur * 1000));
    const e = k * k * (3 - 2 * k); // smoothstep
    const g = this.shipObj.group;
    g.position.lerpVectors(a.from, a.to, e);
    this.shipCtl.update(0.0001, this.camera); // keep the chase camera live
    this.shipCtl.enabled = false;
    this.player.position.copy(g.position);
    audio.engine(a.kind === 'rise' ? 0.7 : 0.35);
    this.trail?.setLevel?.(a.kind === 'rise' ? 0.8 : 0.3);

    if (k >= 1) {
      if (a.kind === 'land') {
        this._parkShipAt(a.to.x, a.to.z);
        this.effects.landingDust?.(a.to.clone());
        audio.sfx('land');
        this.mode = 'seated';
        this.ctx.gameState.save();
      } else {
        // level off: shed the parked slope-tilt so you fly out flat, not
        // nose-up into the haze
        const yaw = new THREE.Euler().setFromQuaternion(this.shipObj.group.quaternion, 'YXZ').y;
        this.shipObj.group.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
        this.mode = 'ship';
        this.shipCtl.enabled = true;
        this.shipCtl.throttle = 0.25;
      }
      this.auto = null;
    }
  }

  _updateSeated(dt, uiOpen) {
    audio.engine(0.08);
    this.trail?.setLevel?.(0);
    this.shipCtl.update(0.0001, this.camera);
    this.shipCtl.enabled = false;
    this.player.position.copy(this.shipObj.group.position);
    this._interactLabel = 'F — DISEMBARK · G — TAKE OFF';
    if (uiOpen) return;
    if (input.actionPressed('interact')) return this._exitShip();
    if (input.actionPressed('land') || input.action('forward')) {
      const gs = this.ctx.gameState;
      if (gs.ship.fuel < 0.08) {
        events.emit('notify', { text: 'SHIP NEEDS PYRENE FUEL (refuel in inventory)', tone: 'warn' });
        audio.sfx('deny');
        return;
      }
      this._boardShip();
    }
  }

  _interactions() {
    const { ctx } = this;
    const gs = ctx.gameState;
    const ppos = this.player.position;
    let label = null;

    if (ppos.distanceTo(this.shipObj.group.position) < BOARD_RANGE) {
      label = gs.ship.fuel >= 0.08 ? 'F — BOARD SHIP' : 'SHIP NEEDS PYRENE FUEL (refuel in inventory)';
      if (gs.ship.fuel >= 0.08 && input.actionPressed('interact')) return this._boardShip();
    } else {
      const prop = this.props.nearest(ppos, 5);
      if (prop) {
        if (prop.kind === 'ruin' || prop.kind === 'beacon') {
          label = `F — COMMUNE WITH ${prop.kind === 'ruin' ? 'LUMINEL RUIN' : 'BEACON'}`;
          if (input.actionPressed('interact')) this._commune(prop);
        } else if (prop.kind === 'crash' && !prop.salvaged) {
          label = 'F — SALVAGE WRECK';
          if (input.actionPressed('interact')) this._salvage(prop);
        } else if (prop.kind === 'outpost') {
          label = 'F — TRADE AT OUTPOST';
          if (input.actionPressed('interact')) ctx.ui.trade?.open?.(this.system);
        }
      }
    }
    this._interactLabel = label;
  }

  _commune(prop) {
    const gs = this.ctx.gameState;
    audio.sfx('discovery');
    const lore = prop.lore ?? { title: 'Silent Stone', text: 'The glyphs have faded beyond reading.' };
    events.emit('lore:show', lore);
    const key = `${this.def.id}:${Math.round(prop.position.x)}:${Math.round(prop.position.z)}`;
    if (gs.discover('ruins', key, lore.title, 180)) {
      if (Math.random() < 0.35) {
        gs.addItem('luminelshard', 1);
        events.emit('notify', { text: '+1 Luminel Shard', tone: 'good' });
      }
    }
  }

  _salvage(prop) {
    const gs = this.ctx.gameState;
    prop.salvaged = true;
    audio.sfx('collect');
    const drops = [['ferrox', 12], ['weavecircuit', 2], ['pyrene', 6]];
    for (const [id, qty] of drops) gs.addItem(id, qty);
    events.emit('notify', { text: 'SALVAGED: 12 Ferrox · 2 Weave Circuits · 6 Pyrene', tone: 'good' });
    this.effects.sparks?.(prop.position.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, 1, 0));
  }

  _hud(dt, sunElev) {
    const { ctx } = this;
    const gs = ctx.gameState;
    const inShip = this.mode !== 'foot';
    const hazards = [];
    if (this.def.hazard.heat > 0.25 && sunElev > 0) hazards.push('temp');
    if (this.def.hazard.cold > 0.25 && (sunElev <= 0 || this.def.hazard.cold > 0.6)) hazards.push('temp');
    if (this.def.hazard.toxic > 0.25) hazards.push('tox');
    if (this.def.hazard.rad > 0.25) hazards.push('rad');

    const yaw = inShip
      ? Math.atan2(this.shipCtl.forward.x, this.shipCtl.forward.z)
      : this.player.yaw;

    ctx.hud.update(dt, {
      health: gs.health / gs.healthMax,
      shield: inShip ? gs.ship.shield / gs.ship.shieldMax : gs.shield / gs.shieldMax,
      hull: gs.ship.hull / gs.ship.hullMax,
      oxygen: gs.oxygen / gs.oxygenMax,
      energy: gs.energy / gs.energyMax,
      jetpack: this.player.jetpack,
      lumens: gs.lumens,
      speed: Math.round(inShip ? this.shipCtl.speed : this.player.speed * 3.6),
      altitude: Math.round(inShip
        ? this.shipAGL
        : this.player.position.y - this.field.height(this.player.position.x, this.player.position.z)),
      fuel: gs.ship.fuel,
      warpCharges: gs.ship.warpCells,
      hazardIcons: inShip ? [] : hazards,
      compassDeg: THREE.MathUtils.radToDeg(yaw),
      target: null,
      reticle: inShip ? 'ship' : (this._interactLabel ? 'interact' : 'dot'),
      interactLabel: this._interactLabel,
      locationLine: `${this.def.name.toUpperCase()} · ${this.def.weather !== 'clear' ? this.def.weather.toUpperCase() : this.def.biome.toUpperCase()}`,
      toolMode: gs.tool.mode,
    });
  }

  exit() {
    const gs = this.ctx.gameState;
    if (!this._leaving) {
      // persist as landed at (or under) the ship; on-foot position kept
      if (this.mode === 'foot') gs.location.pos = this.player.position.toArray();
      else {
        const g = this.shipObj.group.position;
        gs.location.landingPos = { x: g.x, z: g.z };
        gs.location.pos = null;
      }
      gs.location.mode = 'surface';
    }
    this.trail?.dispose?.();
    this.terrain?.dispose?.();
    this.weather?.dispose?.();
    this.sky?.dispose?.();
    this.flora?.dispose?.();
    this.creatures?.dispose?.();
    this.props?.dispose?.();
    this.effects?.dispose?.();
    this.mining?.dispose?.();
    this.combat?.dispose?.();
    this.builder?.dispose?.();
    this.scene = null;
  }
}
