// Meridian trade terminal: commodities, services (repair/refuel/void cells),
// and Arcforge/ship upgrade tracks.
// CONTRACT: new TradeUI(gameState) → .open(system) .close() .isOpen
import { ITEMS, UPGRADES } from '../gameplay/items.js';
import { priceOf, sellPriceOf, stationStock, economyOf, classify, tradeRoutesFrom } from '../gameplay/trading.js';
import { FACTIONS } from '../universe/lore.js';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

export class TradeUI {
  constructor(gs, galaxy = null) {
    this.gs = gs;
    this.galaxy = galaxy;
    this.root = null;
    this.tab = 'commodities';
  }

  get isOpen() { return !!this.root; }

  open(system) {
    if (this.root) return;
    this.system = system;
    this._stock = stationStock(system);
    this._econ = economyOf(system);
    const tierPips = Array.from({ length: 3 }, (_, i) =>
      `<span style="display:inline-block;width:9px;height:9px;margin-left:3px;border:1px solid var(--ui-amber);background:${i < this._econ.tier ? 'var(--ui-amber)' : 'transparent'};"></span>`).join('');
    audio.sfx('dock');
    const r = document.createElement('div');
    r.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,6,10,.62);backdrop-filter:blur(5px);z-index:40;';
    r.innerHTML = `
      <div class="ams-panel" style="width:min(880px,92vw);max-height:84vh;display:flex;flex-direction:column;padding:0;overflow:hidden;">
        <div class="ams-scanlines"></div>
        <div style="padding:20px 26px 14px;border-bottom:1px solid rgba(255,180,84,.25);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="ams-label" style="color:var(--ui-amber);">MERIDIAN COMBINE · TRADE TERMINAL</div>
            <div class="ams-label" style="color:var(--ui-amber);">${this._econ.label.toUpperCase()} ECONOMY ${tierPips}</div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
            <div style="font-size:19px;letter-spacing:.08em;">${system.name.toUpperCase()}</div>
            <div class="ams-value" style="color:var(--ui-amber);">⌾ <b id="tr-lum"></b> LUMENS</div>
          </div>
          <div style="font-size:11px;color:var(--ui-dim);margin-top:3px;">${this._econ.blurb}</div>
        </div>
        <div style="display:flex;gap:2px;padding:10px 26px 0;">
          ${['commodities', 'routes', 'services', 'upgrades'].map((t) => `
            <button data-tab="${t}" class="tr-tab" style="background:none;border:none;border-bottom:2px solid transparent;color:var(--ui-dim);padding:8px 16px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.18em;text-transform:uppercase;">${t}</button>`).join('')}
        </div>
        <div id="tr-body" style="padding:16px 26px 22px;overflow:auto;flex:1;"></div>
        <div style="padding:10px 26px;border-top:1px solid rgba(125,232,255,.14);font-size:10px;color:var(--ui-dim);letter-spacing:.12em;">ESC — UNDOCK</div>
      </div>`;
    document.getElementById('ui-root').appendChild(r);
    this.root = r;
    r.querySelectorAll('.tr-tab').forEach((b) => {
      b.onclick = () => { this.tab = b.dataset.tab; audio.sfx('click'); this._render(); };
    });
    this._render();
  }

  _row(html) {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 10px;border:1px solid rgba(125,232,255,.14);margin-bottom:5px;background:rgba(6,14,20,.5);';
    d.innerHTML = html;
    return d;
  }

  /** small EXPORT (cheap) / IMPORT (pays well) chip for a commodity */
  _tag(itemId) {
    const k = classify(itemId, this.system);
    if (k === 'export') return '<span style="font-size:9px;letter-spacing:.1em;color:var(--ui-green);border:1px solid rgba(125,255,180,.4);padding:1px 4px;margin-left:4px;">▼ EXPORT</span>';
    if (k === 'import') return '<span style="font-size:9px;letter-spacing:.1em;color:var(--ui-amber);border:1px solid rgba(255,180,84,.4);padding:1px 4px;margin-left:4px;">▲ IMPORT</span>';
    return '';
  }

  _btn(label, ok, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `background:${ok ? 'rgba(255,180,84,.14)' : 'transparent'};border:1px solid ${ok ? 'var(--ui-amber)' : '#3a4a55'};color:${ok ? 'var(--ui-amber)' : '#57707e'};padding:5px 13px;cursor:${ok ? 'pointer' : 'default'};font-family:inherit;font-size:11px;letter-spacing:.1em;white-space:nowrap;`;
    if (ok) b.onclick = () => { fn(); audio.sfx('confirm'); this._render(); };
    else b.onclick = () => audio.sfx('deny');
    return b;
  }

  _render() {
    if (!this.root) return;
    const gs = this.gs;
    this.root.querySelector('#tr-lum').textContent = gs.lumens;
    this.root.querySelectorAll('.tr-tab').forEach((b) => {
      const on = b.dataset.tab === this.tab;
      b.style.color = on ? 'var(--ui-amber)' : 'var(--ui-dim)';
      b.style.borderBottomColor = on ? 'var(--ui-amber)' : 'transparent';
    });
    const body = this.root.querySelector('#tr-body');
    body.innerHTML = '';

    if (this.tab === 'commodities') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:22px;';
      const buyCol = document.createElement('div');
      buyCol.innerHTML = '<div class="ams-label" style="margin-bottom:8px;color:var(--ui-cyan);">STATION SELLS</div>';
      for (const s of this._stock) {
        const it = ITEMS[s.id];
        const row = this._row(`
          <div><span style="color:${it.color};">◆</span> ${it.name} ${this._tag(s.id)}
            <div style="font-size:10px;color:var(--ui-dim);">${it.desc}</div></div>`);
        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;gap:5px;';
        for (const q of [1, 5]) {
          controls.appendChild(this._btn(`×${q} · ${s.price * q}⌾`, gs.lumens >= s.price * q,
            () => { gs.addLumens(-s.price * q); gs.addItem(s.id, q); }));
        }
        row.appendChild(controls);
        buyCol.appendChild(row);
      }
      const sellCol = document.createElement('div');
      sellCol.innerHTML = '<div class="ams-label" style="margin-bottom:8px;color:var(--ui-cyan);">YOUR CARGO</div>';
      if (!gs.inventory.length) sellCol.innerHTML += '<div style="color:var(--ui-dim);font-size:12px;">empty hold</div>';
      for (const s of [...gs.inventory]) {
        const it = ITEMS[s.id];
        const unit = sellPriceOf(s.id, this.system);
        const row = this._row(`
          <div><span style="color:${it.color};">◆</span> ${it.name} ${this._tag(s.id)}
            <span class="ams-value" style="color:var(--ui-dim);">×${s.qty}</span></div>`);
        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;gap:5px;';
        controls.appendChild(this._btn(`×1 · ${unit}⌾`, true, () => { gs.removeItem(s.id, 1); gs.addLumens(unit); }));
        controls.appendChild(this._btn(`ALL · ${unit * s.qty}⌾`, true, () => { gs.removeItem(s.id, s.qty); gs.addLumens(unit * s.qty); }));
        row.appendChild(controls);
        sellCol.appendChild(row);
      }
      wrap.append(buyCol, sellCol);
      body.appendChild(wrap);
    }

    if (this.tab === 'routes') {
      const routes = this.galaxy ? tradeRoutesFrom(this.system, this.galaxy) : [];
      if (!routes.length) {
        body.innerHTML = '<div style="color:var(--ui-dim);font-size:12px;padding:8px;">No profitable runs from this market within scan range. Warp somewhere with a different economy and check again.</div>';
      } else {
        body.innerHTML = '<div class="ams-label" style="margin-bottom:10px;color:var(--ui-cyan);">SUGGESTED RUNS — buy here, sell there</div>';
        for (const rt of routes) {
          const it = ITEMS[rt.itemId];
          const row = this._row(`
            <div><span style="color:${it.color};">◆</span> <b>${it.name}</b>
              <div style="font-size:11px;color:var(--ui-dim);margin-top:2px;">
                buy here ⌾${rt.buyHere} → sell at <span style="color:var(--ui-ink);">${rt.systemName}</span> ⌾${rt.sellThere}
                <span style="color:var(--ui-green);margin-left:6px;">+${rt.marginPct}%</span></div></div>`);
          row.appendChild(this._btn('LOCK TARGET', true, () => {
            this.gs.quests.vesperTarget = rt.systemId;
            events.emit('notify', { text: `ROUTE TARGET LOCKED — ${rt.systemName}`, tone: 'info' });
          }));
          body.appendChild(row);
        }
      }
    }

    if (this.tab === 'services') {
      const hullDmg = this.gs.ship.hullMax - this.gs.ship.hull;
      const repairCost = Math.ceil(hullDmg * 6);
      const fuelMissing = 1 - this.gs.ship.fuel;
      const fuelCost = Math.ceil(fuelMissing * 250);
      const services = [
        {
          name: 'Hull Repair', desc: hullDmg > 0 ? `${Math.round(hullDmg)} points of scoring and stress fractures` : 'Hull integrity nominal',
          cost: repairCost, ok: hullDmg > 0 && gs.lumens >= repairCost,
          fn: () => { gs.addLumens(-repairCost); gs.ship.hull = gs.ship.hullMax; gs.ship.shield = gs.ship.shieldMax; },
        },
        {
          name: 'Refuel (Pyrene)', desc: fuelMissing > 0.01 ? 'Launch tanks topped to full' : 'Tanks full',
          cost: fuelCost, ok: fuelMissing > 0.01 && gs.lumens >= fuelCost,
          fn: () => { gs.addLumens(-fuelCost); gs.ship.fuel = 1; },
        },
        {
          name: 'Void Cell', desc: 'One charge of folded distance. Warp fuel.',
          cost: 400, ok: gs.lumens >= 400,
          fn: () => { gs.addLumens(-400); gs.ship.warpCells += 1; },
        },
        {
          name: 'Suit Recharge', desc: 'Oxygen, suit power, and shields restored',
          cost: 60, ok: gs.lumens >= 60,
          fn: () => { gs.addLumens(-60); gs.oxygen = gs.oxygenMax; gs.energy = gs.energyMax; gs.shield = gs.shieldMax; },
        },
      ];
      for (const s of services) {
        const row = this._row(`<div>${s.name}<div style="font-size:10px;color:var(--ui-dim);">${s.desc}</div></div>`);
        row.appendChild(this._btn(`${s.cost}⌾`, s.ok, s.fn));
        body.appendChild(row);
      }
    }

    if (this.tab === 'upgrades') {
      const DESC = {
        shipSpeed: 'Vector coils raise cruise and boost velocity 30% per level',
        shipShield: 'Aegis lattice adds +30 ship shield per level',
        shipCargo: 'Hold extender adds 8 exosuit cargo slots per level',
        toolMine: 'Focus crystals speed the mining beam 50% per level',
        toolBolt: 'Arc chamber raises bolt caster fire rate 35% per level',
        suitEnergy: 'Dawn battery adds +40 suit power per level',
      };
      for (const [track, def] of Object.entries(UPGRADES)) {
        const lvl = gs.upgrades[track] ?? 0;
        const maxed = lvl >= def.max;
        const pips = Array.from({ length: def.max }, (_, i) =>
          `<span style="display:inline-block;width:16px;height:5px;margin-right:3px;background:${i < lvl ? 'var(--ui-cyan)' : '#1c313d'};"></span>`).join('');
        const row = this._row(`
          <div>${def.name} <span style="margin-left:8px;">${pips}</span>
            <div style="font-size:10px;color:var(--ui-dim);">${DESC[track] ?? ''}</div></div>`);
        if (maxed) {
          const done = document.createElement('span');
          done.textContent = 'MAX';
          done.style.cssText = 'color:var(--ui-green);font-size:11px;letter-spacing:.2em;';
          row.appendChild(done);
        } else {
          const next = lvl + 1;
          const cost = def.cost(next);
          const lum = def.lumens(next);
          const okItems = gs.hasItems(cost);
          const ok = okItems && gs.lumens >= lum;
          const costStr = cost.map((c) => `${c.qty} ${ITEMS[c.id].name}`).join(' + ');
          row.appendChild(this._btn(`${costStr} + ${lum}⌾`, ok, () => {
            gs.removeItems(cost);
            gs.addLumens(-lum);
            gs.upgrades[track] = next;
            if (track === 'shipShield') { gs.ship.shieldMax = 60 + next * 30; gs.ship.shield = gs.ship.shieldMax; }
            if (track === 'suitEnergy') { gs.energyMax = 100 + next * 40; gs.energy = gs.energyMax; }
            events.emit('notify', { text: `${def.name} — LEVEL ${next}`, tone: 'good' });
            audio.sfx('craft');
            gs.save();
          }));
        }
        body.appendChild(row);
      }
    }
  }

  close() {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    audio.sfx('click');
  }
}
