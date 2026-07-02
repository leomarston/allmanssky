// Surface state: on-planet gameplay — streamed terrain, sky/day-cycle, flora,
// fauna, props, on-foot controller, mining/scanning/combat/survival seams,
// ship boarding and takeoff.
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
import { PropManager } from './surfaceprops.js';
import { Survival } from '../gameplay/survival.js';
import { GroundMining } from '../gameplay/mining.js';
import { Scanner } from '../gameplay/scanner.js';
import { GroundCombat } from '../gameplay/combat.js';
import { BaseBuilder } from '../gameplay/basebuilding.js';
import { audio } from '../audio/audio.js';

const BOARD_RANGE = 6;

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

    // parked ship
    const lp = gs.location.landingPos;
    const shipBuild = buildShip(gs.ship.seed, gs.ship.class);
    this.shipObj = shipBuild;
    const shipY = this.field.height(lp.x, lp.z);
    shipBuild.group.position.set(lp.x, shipY + 1.2, lp.z);
    const n = this.field.normal(lp.x, lp.z);
    shipBuild.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    this.scene.add(shipBuild.group);

    // player spawns beside the ship (or restored save position)
    this.player = new PlayerController(this.camera, this.field, this.def.gravity);
    if (params.restorePos && gs.location.pos) {
      this.player.position.fromArray(gs.location.pos);
      this.player.velocity.set(0, 0, 0);
    } else {
      this.player.teleport(lp.x + 6, lp.z + 4);
    }
    this.player.jetpack = gs.jetpack ?? 1;

    // gameplay systems (fan-out #2 owners)
    this.survival = new Survival(gs);
    this.mining = new GroundMining(this.scene, this.effects, gs, this);
    this.scanner = new Scanner(gs);
    this.combat = new GroundCombat(this.scene, this.effects, gs, this);
    this.builder = new BaseBuilder(this.scene, this.field, gs, this.systemId, this.planetIndex);

    // day cycle: deterministic phase per planet, advances in real time
    this.timeOfDay = ((this.def.seed % 1000) / 1000 + 0.28) % 1;
    const todOverride = new URLSearchParams(location.search).get('tod');
    if (todOverride != null) this.timeOfDay = Number(todOverride); // debug/test hook
    this._elapsed = 0;
    this._landedFresh = params.landingPos != null;

    ctx.hud.setMode('foot');
    audio.setScene('surface', { biome: this.def.biome, danger: 0 });
    if (this._landedFresh) {
      this.effects.landingDust?.(shipBuild.group.position.clone());
      audio.sfx('land');
    }
    // first-visit discovery
    if (gs.discover('planets', this.def.id, this.def.name, 220)) gs.stats.planetsVisited += 1;
    events.emit('notify', {
      text: `${this.def.name.toUpperCase()} — ${this.def.biome} world · ${this.def.gravity.toFixed(1)}g`,
      tone: 'info',
    });
  }

  update(dt) {
    const { ctx } = this;
    const gs = ctx.gameState;
    this._elapsed += dt;

    // day/night
    this.timeOfDay = (this.timeOfDay + dt / this.def.dayLength) % 1;
    const sunElev = Math.sin(this.timeOfDay * Math.PI * 2);
    this.sky.update(dt, sunElev, this.camera.position);

    const uiOpen = ctx.ui.anyOpen?.() ?? false;
    this.player.enabled = !uiOpen;
    this.player.update(dt);
    gs.jetpack = this.player.jetpack;
    gs.stats.distanceOnFoot += this.player.speed * dt;

    this.terrain.update(dt, this.player.position);
    this.flora.update(dt, this.player.position);
    this.creatures.update(dt, this.player.position);
    this.props.update(this.player.position);
    this.effects.update(dt);

    this.survival.update(dt, {
      planetDef: this.def,
      isNight: sunElev < -0.08,
      inShip: false,
      moving: this.player.speed > 0.5,
      sprinting: input.action('sprint') && this.player.speed > 7,
    });
    if (!uiOpen) {
      this.mining.update(dt, this.camera, this);
      this.combat.update(dt, this.camera, this.player);
      this.builder.update(dt, this.camera, this.player);
      if (input.actionPressed('scan')) this.scanner.scan(this);
      if (input.actionPressed('swapWeapon')) {
        gs.tool.mode = gs.tool.mode === 'mine' ? 'bolt' : 'mine';
        audio.sfx('click');
        events.emit('notify', { text: `ARCFORGE MODE: ${gs.tool.mode === 'mine' ? 'MINING BEAM' : 'BOLT CASTER'}`, tone: 'info' });
      }
      this._interactions();
    }
    this._hud(dt, sunElev);
  }

  _interactions() {
    const { ctx } = this;
    const gs = ctx.gameState;
    const ppos = this.player.position;
    let label = null;

    // board ship
    if (ppos.distanceTo(this.shipObj.group.position) < BOARD_RANGE) {
      label = gs.ship.fuel >= 0.15 ? 'F — BOARD SHIP & LAUNCH' : 'SHIP NEEDS PYRENE FUEL (refuel in inventory)';
      if (gs.ship.fuel >= 0.15 && input.actionPressed('interact')) return this._takeoff();
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
      if (gs.quests.vesperDepth < 15) gs.quests.vesperDepth += 0;
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

  async _takeoff() {
    const { ctx } = this;
    const gs = ctx.gameState;
    gs.ship.fuel = Math.max(0, gs.ship.fuel - 0.15);
    audio.sfx('takeoff');
    this._leaving = true;
    this.effects.landingDust?.(this.shipObj.group.position.clone());
    await ctx.fade(1.0, '#dfeeff');
    gs.location.pos = null;
    gs.save();
    ctx.switchState('space', {
      systemId: this.systemId,
      mode: 'takeoff',
      planetIndex: this.planetIndex,
    });
  }

  _hud(dt, sunElev) {
    const { ctx } = this;
    const gs = ctx.gameState;
    const hazards = [];
    if (this.def.hazard.heat > 0.25 && sunElev > 0) hazards.push('temp');
    if (this.def.hazard.cold > 0.25 && (sunElev <= 0 || this.def.hazard.cold > 0.6)) hazards.push('temp');
    if (this.def.hazard.toxic > 0.25) hazards.push('tox');
    if (this.def.hazard.rad > 0.25) hazards.push('rad');

    ctx.hud.update(dt, {
      health: gs.health / gs.healthMax,
      shield: gs.shield / gs.shieldMax,
      oxygen: gs.oxygen / gs.oxygenMax,
      energy: gs.energy / gs.energyMax,
      jetpack: this.player.jetpack,
      lumens: gs.lumens,
      speed: Math.round(this.player.speed * 3.6),
      altitude: Math.round(this.player.position.y - this.field.height(this.player.position.x, this.player.position.z)),
      fuel: gs.ship.fuel,
      warpCharges: gs.ship.warpCells,
      hazardIcons: hazards,
      compassDeg: THREE.MathUtils.radToDeg(this.player.yaw),
      target: null,
      reticle: this._interactLabel ? 'interact' : 'dot',
      interactLabel: this._interactLabel,
      locationLine: `${this.def.name.toUpperCase()} · ${this.def.weather !== 'clear' ? this.def.weather.toUpperCase() : this.def.biome.toUpperCase()}`,
      toolMode: gs.tool.mode,
    });
  }

  exit() {
    const gs = this.ctx.gameState;
    if (!this._leaving) {
      gs.location.pos = this.player.position.toArray();
      gs.location.mode = 'surface';
    }
    this.terrain?.dispose?.();
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
