// Station/outpost trade overlay — STUB pending fan-out #2 (full terminal with
// upgrades tab). CONTRACT: new TradeUI(gameState) → .open(system) .close() .isOpen
import { ITEMS } from '../gameplay/items.js';
import { priceOf, stationStock } from '../gameplay/trading.js';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

export class TradeUI {
  constructor(gs) { this.gs = gs; this.root = null; }
  get isOpen() { return !!this.root; }

  open(system) {
    if (this.root) return;
    this.system = system;
    const r = document.createElement('div');
    r.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,6,10,.6);backdrop-filter:blur(4px);z-index:40;';
    r.innerHTML = `<div style="min-width:700px;max-height:80vh;overflow:auto;background:rgba(12,18,14,.9);border:1px solid #ffb45455;padding:24px;color:#ffe8c8;font-family:system-ui;">
      <h2 style="color:#ffb454;letter-spacing:.14em;">MERIDIAN TRADE TERMINAL</h2>
      <div style="opacity:.75;margin:4px 0 14px;">${system.name} · your Lumens: <b id="tr-lum"></b> ⌾</div>
      <div style="display:flex;gap:26px;">
        <div style="flex:1"><h3 style="color:#7de8ff;">STATION SELLS</h3><div id="tr-buy"></div></div>
        <div style="flex:1"><h3 style="color:#7de8ff;">YOUR CARGO (sell)</h3><div id="tr-sell"></div></div>
      </div>
      <div style="margin-top:14px;opacity:.7;font-size:12px;">ESC — leave terminal</div>
    </div>`;
    document.getElementById('ui-root').appendChild(r);
    this.root = r;
    this._render();
  }

  _render() {
    if (!this.root) return;
    const gs = this.gs;
    this.root.querySelector('#tr-lum').textContent = gs.lumens;
    const row = (label, price, ok, fn) => {
      const b = document.createElement('button');
      b.style.cssText = `display:block;width:100%;text-align:left;margin:3px 0;background:${ok ? '#20301a' : '#141a10'};border:1px solid ${ok ? '#ffb45466' : '#443'};color:${ok ? '#ffe8c8' : '#887'};padding:6px 9px;cursor:${ok ? 'pointer' : 'default'};font-family:inherit;`;
      b.textContent = `${label} — ${price} ⌾`;
      if (ok) b.onclick = () => { fn(); audio.sfx('confirm'); this._render(); };
      return b;
    };
    const buy = this.root.querySelector('#tr-buy'); buy.innerHTML = '';
    for (const s of stationStock(this.system)) {
      buy.appendChild(row(`${ITEMS[s.id].name} ×5`, s.price * 5, gs.lumens >= s.price * 5,
        () => { gs.addLumens(-s.price * 5); gs.addItem(s.id, 5); }));
    }
    const sell = this.root.querySelector('#tr-sell'); sell.innerHTML = '';
    for (const s of [...gs.inventory]) {
      const p = Math.round(priceOf(s.id, this.system) * 0.72);
      sell.appendChild(row(`${ITEMS[s.id].name} ×${s.qty}`, p * s.qty, true,
        () => { gs.addLumens(p * s.qty); gs.removeItem(s.id, s.qty); }));
    }
  }

  close() { this.root?.remove(); this.root = null; }
}
