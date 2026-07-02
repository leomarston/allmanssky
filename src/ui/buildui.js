// Build-mode piece bar: passive bottom strip shown while BaseBuilder is
// active. Listens to 'build:mode' events; never captures gameplay input.
// CONTRACT: new BuildUI(gameState) → .open() .close() .isOpen (always false —
// build mode is not a modal; movement continues).
import { events } from '../core/events.js';
import { PIECES } from '../gameplay/basebuilding.js';
import { ITEMS } from '../gameplay/items.js';

export class BuildUI {
  constructor(gs) {
    this.gs = gs;
    this.bar = document.createElement('div');
    this.bar.style.cssText = [
      'position:absolute', 'left:50%', 'bottom:26px', 'transform:translateX(-50%)',
      'display:none', 'gap:8px', 'pointer-events:none', 'z-index:20',
    ].join(';');
    document.getElementById('ui-root')?.appendChild(this.bar);

    events.on('build:mode', (active, builder) => {
      this.bar.style.display = active ? 'flex' : 'none';
      if (active) this._render(builder);
    });
    events.on('inventory:changed', () => {
      if (this.bar.style.display !== 'none' && this._builder) this._render(this._builder);
    });
  }

  get isOpen() { return false; }
  open() {}
  close() {}

  _render(builder) {
    this._builder = builder;
    this.bar.innerHTML = PIECES.map((p, i) => {
      const afford = this.gs.hasItems(p.cost.map(([id, qty]) => ({ id, qty })));
      const selected = builder.sel === i;
      const costStr = p.cost.map(([id, qty]) => `${qty} ${ITEMS[id]?.symbol ?? id}`).join(' · ');
      return `<div style="
        min-width:86px;text-align:center;padding:7px 9px;
        background:rgba(6,16,22,${selected ? '.9' : '.6'});
        border:1px solid ${selected ? 'var(--ui-cyan,#7de8ff)' : 'rgba(125,232,255,.25)'};
        ${selected ? 'box-shadow:0 0 14px rgba(125,232,255,.3);' : ''}
        backdrop-filter:blur(4px);">
        <div style="font-size:10px;color:var(--ui-dim,#7fa3b4);letter-spacing:.1em;">${i + 1}</div>
        <div style="font-size:11px;color:${afford ? 'var(--ui-ink,#d6f2ff)' : 'var(--ui-red,#ff5470)'};letter-spacing:.05em;margin:2px 0;">${p.name.toUpperCase()}</div>
        <div style="font-size:9px;color:${afford ? 'var(--ui-dim,#7fa3b4)' : 'var(--ui-red,#ff5470)'};">${costStr}</div>
      </div>`;
    }).join('')
    + `<div style="align-self:center;margin-left:10px;font-size:10px;color:var(--ui-dim,#7fa3b4);letter-spacing:.1em;">
        LMB PLACE · RMB RECLAIM · R ROTATE · B EXIT</div>`;
  }
}
