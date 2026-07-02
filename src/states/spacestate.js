// Space state: star system scene — sun, planets, station, asteroid belt,
// ship flight, landing approach, docking, warp jumps.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { hashString, RNG } from '../core/rng.js';
import { createStarfield } from '../render/starfield.js';
import { createNebulaField } from '../render/nebula.js';
import { createSun } from '../render/sun.js';
import { createPlanetVisual } from '../render/planetmesh.js';
import { buildShip, buildStation } from '../render/shipmesh.js';
import { EffectsSystem } from '../render/effects.js';
import { ShipController } from '../gameplay/shipcontrol.js';
import { SpaceCombat } from '../gameplay/combat.js';
import { SpaceMining } from '../gameplay/mining.js';
import { audio } from '../audio/audio.js';

const LAND_RANGE = 1.75;      // multiples of planet display radius
const DOCK_RANGE = 42;

export class SpaceState {
  constructor(ctx) {
    this.ctx = ctx;
    this.name = 'space';
    this.scene = null;
    this.camera = null;
  }

  async enter(params = {}) {
    const { ctx } = this;
    const gs = ctx.gameState;
    this.systemId = params.systemId ?? gs.currentSystemId;
    gs.currentSystemId = this.systemId;
    if (!gs.visitedSystems.includes(this.systemId)) gs.visitedSystems.push(this.systemId);
    this.system = ctx.galaxy.getSystem(this.systemId);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 2e6);

    const envSeed = hashString(this.systemId);
    this.starfield = createStarfield(envSeed);
    this.scene.add(this.starfield.object3d);
    this.nebula = createNebulaField(envSeed);
    this.scene.add(this.nebula.object3d);

    this.sun = createSun(this.system.star);
    this.scene.add(this.sun.object3d);
    if (this.sun.light) this.scene.add(this.sun.light);
    this.scene.add(new THREE.AmbientLight(0x18202c, 0.6));

    // planets on display orbits (sorted by generated orbitRadius, respaced for play)
    this.planets = [];
    const sorted = [...this.system.planets].sort((a, b) => a.orbitRadius - b.orbitRadius);
    sorted.forEach((def, i) => {
      const visual = createPlanetVisual(def);
      const orbit = 800 + i * 720 + (def.orbitPhase % 1) * 140;
      const angle = def.orbitPhase * Math.PI * 2;
      visual.group.position.set(Math.cos(angle) * orbit, Math.sin(angle * 3.1) * orbit * 0.06, Math.sin(angle) * orbit);
      this.scene.add(visual.group);
      this.planets.push({ def, visual, index: this.system.planets.indexOf(def) });
    });

    // station
    this.station = null;
    if (this.system.station) {
      const st = buildStation(this.system.seed, this.system.station.faction);
      const a = this.system.station.angle;
      st.group.position.set(Math.cos(a) * 560, 40, Math.sin(a) * 560);
      this.scene.add(st.group);
      this.station = st;
    }

    this._buildBelt();

    // player ship
    const shipBuild = buildShip(gs.ship.seed, gs.ship.class);
    this.shipObj = shipBuild;
    this.scene.add(shipBuild.group);
    this.shipCtl = new ShipController(shipBuild.group, {
      maxSpeed: 55 * (1 + gs.upgrades.shipSpeed * 0.3),
      agility: 1,
    });
    this._placeShip(params);

    this.effects = new EffectsSystem(this.scene);
    this.trail = this.effects.engineTrail?.(shipBuild.group, '#7de8ff') ?? null;
    this.combat = new SpaceCombat(this.scene, this.effects, gs, this.system, this.shipCtl);
    this.mining = new SpaceMining(this.scene, this.effects, gs, this);

    ctx.hud.setMode('space');
    audio.setScene('space', { danger: this.system.pirateThreat });
    events.emit('notify', { text: `${this.system.name} — ${this.system.star.class}-class star`, tone: 'info' });

    // first-visit system discovery
    gs.discover('systems', this.systemId, this.system.name, 120);
    this._elapsed = 0;
    this._warping = false;
  }

  _placeShip(params) {
    const g = this.shipCtl.ship;
    if (params.mode === 'takeoff' && this.planets.length) {
      const p = this.planets.find((x) => x.index === params.planetIndex) ?? this.planets[0];
      const pos = p.visual.group.position;
      g.position.copy(pos).add(new THREE.Vector3(0, p.def.radius * 1.9, p.def.radius * 0.6));
      g.lookAt(pos.clone().add(new THREE.Vector3(0, 4000, 0)));
      this.shipCtl.velocity.set(0, 18, 0);
      this.shipCtl.throttle = 0.35;
    } else if (params.mode === 'warp') {
      g.position.set(-3800, 260, 900);
      g.lookAt(0, 0, 0);
      this.shipCtl.velocity.copy(this.shipCtl.forward).multiplyScalar(40);
      this.shipCtl.throttle = 0.6;
    } else if (this.ctx.gameState.location.pos) {
      g.position.fromArray(this.ctx.gameState.location.pos);
      this.shipCtl.throttle = 0.2;
    } else if (this.planets.length) {
      const p = this.planets[0];
      g.position.copy(p.visual.group.position).add(new THREE.Vector3(p.def.radius * 3.5, p.def.radius * 0.8, p.def.radius * 2));
      g.lookAt(p.visual.group.position);
      this.shipCtl.throttle = 0.15;
    }
  }

  _buildBelt() {
    this.asteroids = [];
    if (!this.system.belt) return;
    const rng = new RNG(this.system.seed ^ 0xa57e);
    const count = Math.floor(140 + this.system.belt.density * 220);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    // lumpy displacement
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = 1 + (rng.next() - 0.5) * 0.55;
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a7f72, roughness: 0.95, metalness: 0.1 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const beltR = 1900 + rng.next() * 500, width = 260;
    for (let i = 0; i < count; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = beltR + rng.gaussian(0, width * 0.4);
      const y = rng.gaussian(0, 40);
      const s = 2 + rng.next() * rng.next() * 9;
      e.set(rng.next() * 6.28, rng.next() * 6.28, rng.next() * 6.28);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, new THREE.Vector3(s, s, s));
      inst.setMatrixAt(i, m);
      this.asteroids.push({
        index: i,
        position: new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
        radius: s * 1.2,
        itemId: rng.chance(0.18) ? 'voidsalt' : rng.chance(0.4) ? 'silica' : 'ferrox',
        hp: 3, alive: true,
      });
    }
    inst.instanceMatrix.needsUpdate = true;
    this.beltMesh = inst;
    this.scene.add(inst);
  }

  /** hide a destroyed asteroid (mining reward handled by SpaceMining) */
  destroyAsteroid(a) {
    if (!a.alive) return;
    a.alive = false;
    const m = new THREE.Matrix4().compose(a.position, new THREE.Quaternion(), new THREE.Vector3(0.001, 0.001, 0.001));
    this.beltMesh.setMatrixAt(a.index, m);
    this.beltMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    const { ctx } = this;
    const gs = ctx.gameState;
    this._elapsed += dt;

    this.shipCtl.update(dt, this.camera);
    this.starfield.update?.(dt);
    this.nebula.update?.(dt);
    this.sun.update?.(dt, this.camera.position);
    this.station?.update?.(dt);

    for (const p of this.planets) {
      const sunDir = p.visual.group.position.clone().negate().normalize();
      p.visual.update?.(dt, this.camera.position, sunDir);
    }
    this.effects.update(dt);
    this.trail?.setLevel?.(this.shipCtl.throttle * (this.shipCtl.boost ? 1 : 0.6));
    audio.engine(this.shipCtl.throttle * (this.shipCtl.boost ? 1 : 0.7));
    this.combat.update(dt, this.camera);
    this.mining.update(dt, this.camera);

    if (!this._warping) this._interactions(dt);
    this._hud(dt);
  }

  _nearestPlanet() {
    let best = null, bestD = Infinity;
    for (const p of this.planets) {
      const d = this.shipCtl.position.distanceTo(p.visual.group.position) - p.def.radius;
      if (d < bestD) { bestD = d; best = p; }
    }
    return { planet: best, dist: bestD };
  }

  _interactions(dt) {
    const { ctx } = this;
    const gs = ctx.gameState;
    const { planet, dist } = this._nearestPlanet();
    this._near = { planet, dist };

    let interact = null;
    if (planet && dist < planet.def.radius * LAND_RANGE) {
      interact = `G — ENTER ATMOSPHERE OF ${planet.def.name.toUpperCase()}`;
      if (input.actionPressed('land')) return this._land(planet);
    }
    if (this.station) {
      const dockWorld = this.station.dockPos
        ? this.station.group.localToWorld(this.station.dockPos.clone())
        : this.station.group.position;
      if (this.shipCtl.position.distanceTo(dockWorld) < DOCK_RANGE) {
        interact = 'F — DOCK AT STATION';
        if (input.actionPressed('interact')) {
          audio.sfx('dock');
          ctx.ui.trade?.open?.(this.system);
        }
      }
    }
    this._interactLabel = interact;

    if (input.actionPressed('warp')) this._tryWarp();
    if (input.actionPressed('map')) ctx.ui.map?.open?.();
  }

  async _land(p) {
    const { ctx } = this;
    this._warping = true;
    this.shipCtl.enabled = false;
    audio.sfx('takeoff');
    this.shipCtl.shake(1.2);
    await ctx.fade(1.1, '#e8f4ff');
    // approach azimuth picks the landing site so different approaches land apart
    const rel = this.shipCtl.position.clone().sub(p.visual.group.position);
    const az = Math.atan2(rel.z, rel.x);
    ctx.gameState.location.pos = null;
    ctx.switchState('surface', {
      systemId: this.systemId,
      planetIndex: p.index,
      landingPos: { x: Math.cos(az) * 380, z: Math.sin(az) * 380 },
    });
  }

  async _tryWarp() {
    const { ctx } = this;
    const gs = ctx.gameState;
    if (gs.ship.warpCells < 1) {
      events.emit('notify', { text: 'NO VOID CELLS — craft one (2 Voidsalt + Lumin Glass)', tone: 'warn' });
      audio.sfx('deny');
      return;
    }
    const neighbors = ctx.galaxy.neighborsOf(this.systemId, 3);
    const target = (gs.quests.vesperTarget && neighbors.find((n) => n.id === gs.quests.vesperTarget))
      || neighbors.find((n) => !gs.visitedSystems.includes(n.id)) || neighbors[0];
    if (!target) { events.emit('notify', { text: 'NO REACHABLE SYSTEMS', tone: 'warn' }); return; }

    gs.ship.warpCells -= 1;
    gs.stats.warps += 1;
    this._warping = true;
    this.shipCtl.enabled = false;
    events.emit('warp:begin', target);
    audio.sfx('warp');
    const tunnel = this.effects.warpTunnel?.(this.camera);
    const start = this._elapsed;
    await new Promise((resolve) => {
      const step = () => {
        const t = Math.min(1, (this._elapsed - start) / 1.6);
        tunnel?.setLevel?.(t);
        this.shipCtl.shake(t * 0.6);
        if (t >= 1) resolve(); else requestAnimationFrame(step);
      };
      step();
    });
    await ctx.fade(0.5, '#ffffff');
    tunnel?.dispose?.();
    gs.location.pos = null;
    gs.save();
    events.emit('warp:end', target.id);
    ctx.switchState('space', { systemId: target.id, mode: 'warp' });
  }

  _hud(dt) {
    const { ctx } = this;
    const gs = ctx.gameState;
    const near = this._near ?? {};
    ctx.hud.update(dt, {
      health: gs.health / gs.healthMax,
      shield: gs.ship.shield / gs.ship.shieldMax,
      hull: gs.ship.hull / gs.ship.hullMax,
      oxygen: gs.oxygen / gs.oxygenMax,
      energy: gs.energy / gs.energyMax,
      jetpack: 1,
      lumens: gs.lumens,
      speed: Math.round(this.shipCtl.speed * 10),
      fuel: gs.ship.fuel,
      warpCharges: gs.ship.warpCells,
      hazardIcons: [],
      compassDeg: THREE.MathUtils.radToDeg(Math.atan2(this.shipCtl.forward.x, this.shipCtl.forward.z)),
      target: near.planet && near.dist < 3000
        ? { name: near.planet.def.name, dist: Math.round(near.dist) }
        : null,
      reticle: 'ship',
      interactLabel: this._interactLabel,
      locationLine: `${this.system.name} SYSTEM`,
    });
  }

  exit() {
    // persist ship position for save continuity
    const gs = this.ctx.gameState;
    if (!this._warping) gs.location.pos = this.shipCtl.position.toArray();
    gs.location.mode = 'space';
    this.trail?.dispose?.();
    this.effects?.dispose?.();
    this.mining?.dispose?.();
    this.combat?.dispose?.();
    for (const p of this.planets) p.visual.dispose?.();
    this.starfield?.object3d && this.scene.remove(this.starfield.object3d);
    this.scene = null;
  }
}
