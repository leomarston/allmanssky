// Inventory + crafting overlay — STUB pending fan-out #2 (full grid UI with
// icons, drag, tabs). CONTRACT:
//   new InventoryUI(gameState) → .open() .close() .toggle() .isOpen
//   Consumables usable (stimgel/aegiscell/oxylite/pyrene refuel), crafting
//   from RECIPES, all mutations through gameState methods.
import { ITEMS, RECIPES } from '../gameplay/items.js';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

export class InventoryUI {
  constructor(gs) {
    this.gs = gs;
    this.root = null;
  }

  get isOpen() { return !!this.root; }
  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    if (this.root) return;
    audio.sfx('click');
    const r = document.createElement('div');
    r.className = 'ams-overlay';
    r.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,6,10,.55);backdrop-filter:blur(4px);z-index:40;';
    r.innerHTML = `<div class="ams-panel" style="min-width:640px;max-width:820px;max-height:80vh;overflow:auto;background:rgba(8,20,28,.85);border:1px solid #7de8ff55;padding:24px;color:#cfeeff;font-family:system-ui;">
      <h2 style="color:#7de8ff;letter-spacing:.14em;margin-bottom:12px;">EXOSUIT INVENTORY</h2>
      <div id="inv-items" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px;"></div>
      <h3 style="color:#ffb454;letter-spacing:.12em;margin-bottom:8px;">FABRICATE</h3>
      <div id="inv-craft" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div style="margin-top:14px;opacity:.7;font-size:12px;">TAB / ESC — close</div>
    </div>`;
    document.getElementById('ui-root').appendChild(r);
    this.root = r;
    this._render();
    this._onInv = () => this._render();
    events.on('inventory:changed', this._onInv);
  }

  _render() {
    if (!this.root) return;
    const gs = this.gs;
    const items = this.root.querySelector('#inv-items');
    items.innerHTML = gs.inventory.length ? '' : '<div style="opacity:.5">empty hold</div>';
    for (const s of gs.inventory) {
      const it = ITEMS[s.id];
      const d = document.createElement('div');
      d.style.cssText = `border:1px solid ${it.color}66;padding:8px;border-radius:3px;cursor:pointer;`;
      d.innerHTML = `<div style="color:${it.color};font-weight:600;">${it.name}</div><div style="font-size:12px;opacity:.8;">×${s.qty}</div>`;
      d.title = it.desc + (it.category === 'consumable' ? ' (click to use)' : s.id === 'oxylite' ? ' (click: +25 O2)' : s.id === 'pyrene' ? ' (click: refuel ship)' : '');
      d.onclick = () => this._use(s.id);
      items.appendChild(d);
    }
    const craft = this.root.querySelector('#inv-craft');
    craft.innerHTML = '';
    for (const r of RECIPES) {
      const ok = gs.hasItems(r.ins);
      const b = document.createElement('button');
      b.style.cssText = `text-align:left;background:${ok ? '#12303f' : '#0a161d'};border:1px solid ${ok ? '#7de8ff88' : '#345'};color:${ok ? '#cfeeff' : '#678'};padding:7px 10px;cursor:${ok ? 'pointer' : 'default'};border-radius:3px;font-family:inherit;`;
      b.textContent = `${ITEMS[r.out].name} ×${r.qty}  ⟵  ${r.ins.map((i) => `${i.qty} ${ITEMS[i.id].name}`).join(' + ')}`;
      if (ok) b.onclick = () => {
        if (gs.removeItems(r.ins)) {
          gs.addItem(r.out, r.qty);
          audio.sfx('craft');
          events.emit('notify', { text: `FABRICATED ${ITEMS[r.out].name} ×${r.qty}`, tone: 'good' });
        }
      };
      craft.appendChild(b);
    }
  }

  _use(id) {
    const gs = this.gs;
    if (id === 'stimgel' && gs.removeItem(id, 1)) {
      gs.health = Math.min(gs.healthMax, gs.health + 50); audio.sfx('confirm');
    } else if (id === 'aegiscell' && gs.removeItem(id, 1)) {
      gs.shield = gs.shieldMax; audio.sfx('confirm');
    } else if (id === 'oxylite' && gs.removeItem(id, 1)) {
      gs.oxygen = Math.min(gs.oxygenMax, gs.oxygen + 25); audio.sfx('confirm');
    } else if (id === 'pyrene' && gs.countItem('pyrene') >= 5 && gs.ship.fuel < 1) {
      gs.removeItem('pyrene', 5);
      gs.ship.fuel = Math.min(1, gs.ship.fuel + 0.34);
      audio.sfx('confirm');
      events.emit('notify', { text: 'SHIP REFUELED (+34%)', tone: 'good' });
    }
  }

  close() {
    if (!this.root) return;
    events.off('inventory:changed', this._onInv);
    this.root.remove();
    this.root = null;
    audio.sfx('click');
  }
}
