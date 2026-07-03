// Hangar state: the walkable station interior you disembark into after docking.
// Reuses the on-foot PlayerController (with a flat-floor height adapter), mounts
// the procedural hangar hall + NPC crowd, and lets you walk to holographic
// terminals (TRADE / SHIPYARD / MISSIONS), chat with the crew, or board your
// parked ship to launch back into space.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { hashString } from '../core/rng.js';
import { PlayerController } from '../gameplay/player.js';
import { buildHangar } from '../render/stationinterior.js';
import { NPCCrowd } from '../gameplay/npcs.js';
import { buildShip } from '../render/shipmesh.js';
import { audio } from '../audio/audio.js';

const TERMINAL_RADIUS = 3.4;
const BOARD_RADIUS = 5.0;

export class HangarState {
  constructor(ctx) {
    this.ctx = ctx;
    this.name = 'hangar';
    this.scene = null;
    this.camera = null;
    this._leaving = false;
  }

  async enter(params = {}) {
    const { ctx } = this;
    const gs = ctx.gameState;
    this.systemId = params.systemId ?? gs.currentSystemId;
    this.system = ctx.galaxy.getSystem(this.systemId);
    this.faction = params.faction ?? this.system.station?.faction ?? 'none';
    this.stationName = params.stationName ?? this.system.station?.name ?? 'STATION';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03060a);
    this.scene.fog = new THREE.Fog(0x05080c, 34, 150);
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 3000);

    const seed = hashString(`${this.systemId}:hangar`);
    this.hangar = buildHangar(seed, this.faction);
    this.scene.add(this.hangar.group);

    // flat-floor height authority for the shared foot controller
    const hangar = this.hangar;
    this.field = {
      seaY: NaN,
      height: (x, z) => { const y = hangar.floorY(x, z); return y == null ? 0 : y; },
      normal: () => new THREE.Vector3(0, 1, 0),
    };

    this.player = new PlayerController(this.camera, this.field, 0.85);
    const sp = hangar.spawnPoint;
    this.player.teleport(sp.x, sp.z, 0.02);
    this.player.yaw = Math.PI * 0.82;   // face down-hall toward the pad and mouth
    this.player.pitch = -0.05;

    // your ship, parked on the pad
    this.shipObj = buildShip(gs.ship.seed, gs.ship.class);
    this.shipObj.group.position.copy(hangar.shipPad).add(new THREE.Vector3(0, 0.4, 0));
    this.shipObj.group.rotation.y = Math.PI;   // nose toward the bay mouth (+z)
    this.shipObj.group.scale.setScalar(0.55);
    this.scene.add(this.shipObj.group);

    // crew
    this.crowd = new NPCCrowd(this.scene, this.hangar, seed, this.faction);

    // dialogue speech panel (DOM overlay)
    this._speech = document.createElement('div');
    this._speech.style.cssText = [
      'position:absolute', 'left:50%', 'bottom:19%', 'transform:translateX(-50%)',
      'max-width:min(560px,80vw)', 'padding:14px 22px', 'display:none',
      'background:rgba(6,14,20,.82)', 'border:1px solid rgba(125,232,255,.4)',
      'backdrop-filter:blur(6px)', 'color:#e8f4ff', 'z-index:20',
      'font-family:var(--ui-font,system-ui)', 'pointer-events:none',
      'box-shadow:0 0 40px rgba(125,232,255,.1)',
    ].join(';');
    document.getElementById('ui-root').appendChild(this._speech);
    this._speechT = 0;

    ctx.hud.setMode('foot');
    audio.setScene('surface', { danger: 0 });
    events.emit('notify', { text: `${this.stationName} — you step onto the deck`, tone: 'info' });
    gs.location.mode = 'space';   // saving from here resumes docked in space
    this._interactLabel = null;
  }

  update(dt) {
    const { ctx } = this;
    const uiOpen = ctx.ui.anyOpen?.();

    this.player.enabled = !uiOpen && !this._leaving;
    this.player.update(dt);
    this._clampToBounds();

    this.hangar.update?.(dt);
    this.crowd.update(dt, this.player.position);

    if (!uiOpen && !this._leaving) this._interactions();
    if (this._speechT > 0) {
      this._speechT -= dt;
      if (this._speechT <= 0) this._speech.style.display = 'none';
    }
    this._hud(dt);
  }

  /** keep the walker inside the hall footprint (soft walls) */
  _clampToBounds() {
    const b = this.hangar.bounds;
    const p = this.player.position;
    if (p.x < b.minX) { p.x = b.minX; this.player.velocity.x = Math.max(0, this.player.velocity.x); }
    if (p.x > b.maxX) { p.x = b.maxX; this.player.velocity.x = Math.min(0, this.player.velocity.x); }
    if (p.z < b.minZ) { p.z = b.minZ; this.player.velocity.z = Math.max(0, this.player.velocity.z); }
    if (p.z > b.maxZ) { p.z = b.maxZ; this.player.velocity.z = Math.min(0, this.player.velocity.z); }
  }

  _interactions() {
    const { ctx } = this;
    const p = this.player.position;
    // gather the nearest actionable within reach: terminals, ship, crew
    let best = null, bestD = Infinity;
    const consider = (pos, radius, label, act) => {
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      if (d < radius && d < bestD) { bestD = d; best = { label, act }; }
    };
    for (const it of this.hangar.interactables) {
      consider(it.position, TERMINAL_RADIUS, `F — ${it.label} TERMINAL`, () => this._openTerminal(it.kind));
    }
    consider(this.shipObj.group.position, BOARD_RADIUS, 'F — BOARD SHIP & LAUNCH', () => this._leave());
    for (const t of this.crowd.talkables) {
      consider(t.position, t.radius, `F — SPEAK WITH ${t.npc.name.toUpperCase()}`, () => this._talk(t.npc));
    }

    this._interactLabel = best?.label ?? null;
    if (best && input.actionPressed('interact')) best.act();
  }

  _openTerminal(kind) {
    const { ctx } = this;
    audio.sfx('click');
    if (kind === 'trade') ctx.ui.trade?.open?.(this.system);
    else if (kind === 'shipyard') ctx.ui.shipyard?.open?.(`station:${this.systemId}`, { title: this.stationName });
    else if (kind === 'missions') ctx.ui.missions?.open?.(this.system);
  }

  _talk(npc) {
    audio.sfx('hover');
    this._speech.innerHTML = `
      <div style="font-size:10px;letter-spacing:.2em;color:var(--ui-cyan,#7de8ff);text-transform:uppercase;">
        ${npc.name} <span style="color:var(--ui-dim,#7fa3b4);">· ${npc.role}</span></div>
      <div style="margin-top:7px;font-size:15px;line-height:1.5;font-style:italic;">“${npc.line}”</div>`;
    this._speech.style.display = 'block';
    this._speechT = 5.5;
  }

  async _leave() {
    if (this._leaving) return;
    this._leaving = true;
    this.player.enabled = false;
    input.exitPointerLock();
    audio.sfx('takeoff', { volume: 0.6 });
    await this.ctx.fade(0.9, '#04121c');
    this.ctx.switchState('space', { systemId: this.systemId });
  }

  _hud(dt) {
    const { ctx } = this;
    const gs = ctx.gameState;
    ctx.hud.update(dt, {
      health: gs.health / gs.healthMax,
      shield: gs.ship.shield / gs.ship.shieldMax,
      hull: gs.ship.hull / gs.ship.hullMax,
      oxygen: 1,
      energy: gs.energy / gs.energyMax,
      jetpack: this.player.jetpack,
      lumens: gs.lumens,
      speed: Math.round(this.player.speed * 3.6),
      fuel: gs.ship.fuel,
      warpCharges: gs.ship.warpCells,
      hazardIcons: [],
      compassDeg: THREE.MathUtils.radToDeg(this.player.yaw),
      target: null,
      reticle: 'dot',
      interactLabel: this._interactLabel,
      locationLine: `${this.stationName.toUpperCase()} · INTERIOR`,
    });
  }

  exit() {
    this._speech?.remove();
    this.crowd?.dispose();
    this.hangar?.dispose();
    this.shipObj?.dispose?.();
    this.scene = null;
  }
}
