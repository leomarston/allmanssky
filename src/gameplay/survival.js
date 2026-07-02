// Survival system: suit vitals vs planetary hazards.
// CONTRACT (states depend on this):
//   new Survival(gameState)
//   .update(dt, { planetDef, isNight, inShip, moving, sprinting })
//   .applyDamage(amount, type)   type: 'impact'|'laser'|'hazard'|'suffocation'
import { events } from '../core/events.js';

const O2_DRAIN = 100 / 210;        // full tank ≈ 3.5 min in vacuum
const SHIELD_REGEN = 8;
const SHIELD_DELAY = 4;

export class Survival {
  constructor(gs) {
    this.gs = gs;
    this._sinceHit = 99;
    this._hazardTick = 0;
  }

  update(dt, ctx) {
    const gs = this.gs;
    const def = ctx.planetDef;
    this._sinceHit += dt;

    // oxygen: thin atmospheres breathe poorly, vacuum not at all
    const breathable = def ? Math.min(1, def.atmosphere.density * 1.6) * (def.hazard.toxic > 0.6 ? 0.3 : 1) : 0;
    const o2Rate = O2_DRAIN * (1 - breathable) * (ctx.sprinting ? 1.6 : 1);
    if (!ctx.inShip && o2Rate > 0.01) {
      gs.oxygen = Math.max(0, gs.oxygen - o2Rate * dt);
      if (gs.oxygen <= 0) this._damageOverTime(6 * dt, 'suffocation');
      else if (gs.oxygen < 20 && this._warnGate('o2', 12)) {
        events.emit('notify', { text: 'OXYGEN LOW — refine Oxylite', tone: 'danger' });
        events.emit('audio:play', 'notify');
      }
    } else {
      gs.oxygen = Math.min(gs.oxygenMax, gs.oxygen + 6 * dt);
    }

    // hazard protection drains suit energy; empty energy → health drain.
    // storms multiply exposure — shelter or suffer.
    if (def && !ctx.inShip) {
      const heat = ctx.isNight ? 0 : def.hazard.heat;
      const cold = ctx.isNight ? Math.max(def.hazard.cold, def.hazard.cold > 0 ? 0.15 : 0) : def.hazard.cold * 0.5;
      const storm = 1 + (ctx.storm ?? 0) * 1.6;
      const hazard = Math.max(heat, cold, def.hazard.toxic, def.hazard.rad) * storm;
      if (hazard > 0.2) {
        gs.energy = Math.max(0, gs.energy - hazard * 2.4 * dt);
        if (gs.energy <= 0) this._damageOverTime(hazard * 5 * dt, 'hazard');
        else if (gs.energy < 25 && this._warnGate('energy', 14)) {
          events.emit('notify', { text: 'SUIT POWER LOW — hazard protection failing', tone: 'warn' });
        }
      } else {
        gs.energy = Math.min(gs.energyMax, gs.energy + 1.5 * dt);
      }
    }

    // shield regen after a quiet spell
    if (this._sinceHit > SHIELD_DELAY && gs.shield < gs.shieldMax) {
      gs.shield = Math.min(gs.shieldMax, gs.shield + SHIELD_REGEN * dt);
    }
  }

  applyDamage(amount, type = 'impact') {
    const gs = this.gs;
    this._sinceHit = 0;
    const absorbed = Math.min(gs.shield, amount);
    gs.shield -= absorbed;
    const through = amount - absorbed;
    if (through > 0) {
      gs.health = Math.max(0, gs.health - through);
      events.emit('player:damage', { amount: through, type });
      events.emit('audio:play', 'hurt');
      if (gs.health <= 0) events.emit('player:death');
    }
  }

  _damageOverTime(amount, type) {
    const gs = this.gs;
    gs.health = Math.max(0, gs.health - amount);
    this._hazardTick += amount;
    if (this._hazardTick > 4) {
      this._hazardTick = 0;
      events.emit('player:damage', { amount: 4, type });
      events.emit('audio:play', 'hurt');
    }
    if (gs.health <= 0) events.emit('player:death');
  }

  _warnGate(key, interval) {
    this._gates ??= {};
    const now = performance.now() / 1000;
    if (!this._gates[key] || now - this._gates[key] > interval) {
      this._gates[key] = now;
      return true;
    }
    return false;
  }
}
