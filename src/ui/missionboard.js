// Mission board terminal: accept faction contracts for lumens and standing.
// CONTRACT: new MissionBoard(gameState, galaxy, questSystem) → .open(system) .close() .isOpen
import { ITEMS } from '../gameplay/items.js';
import { boardMissionsFor, repTier } from '../gameplay/quests.js';
import { FACTIONS } from '../universe/lore.js';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

const FACTION_COLOR = { meridian: '#ffb454', chorale: '#7de8ff', sunward: '#7dffb4' };

export class MissionBoard {
  constructor(gs, galaxy, quests) {
    this.gs = gs;
    this.galaxy = galaxy;
    this.quests = quests;
    this.root = null;
    this.tab = 'available';
  }

  get isOpen() { return !!this.root; }

  open(system) {
    if (this.root) return;
    this.system = system;
    this._offers = boardMissionsFor(system, this.gs, this.galaxy);
    audio.sfx('dock');
    const r = document.createElement('div');
    r.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,6,10,.62);backdrop-filter:blur(5px);z-index:40;';
    r.innerHTML = `
      <div class="ams-panel" style="width:min(860px,92vw);max-height:84vh;display:flex;flex-direction:column;padding:0;overflow:hidden;">
        <div class="ams-scanlines"></div>
        <div style="padding:20px 26px 12px;border-bottom:1px solid rgba(125,232,255,.2);">
          <div class="ams-label" style="color:var(--ui-cyan);">MISSION BOARD · ${system.name.toUpperCase()}</div>
          <div id="mb-standings" style="display:flex;gap:22px;margin-top:10px;"></div>
        </div>
        <div style="display:flex;gap:2px;padding:10px 26px 0;">
          ${['available', 'active'].map((t) => `
            <button data-tab="${t}" class="mb-tab" style="background:none;border:none;border-bottom:2px solid transparent;color:var(--ui-dim);padding:8px 16px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.18em;text-transform:uppercase;">${t}</button>`).join('')}
        </div>
        <div id="mb-body" style="padding:14px 26px 22px;overflow:auto;flex:1;"></div>
        <div style="padding:10px 26px;border-top:1px solid rgba(125,232,255,.14);font-size:10px;color:var(--ui-dim);letter-spacing:.12em;">ESC — LEAVE BOARD</div>
      </div>`;
    document.getElementById('ui-root').appendChild(r);
    this.root = r;
    r.querySelectorAll('.mb-tab').forEach((b) => {
      b.onclick = () => { this.tab = b.dataset.tab; audio.sfx('click'); this._render(); };
    });
    this._render();
  }

  _card(m, actions) {
    const col = FACTION_COLOR[m.faction] ?? '#7de8ff';
    const fac = FACTIONS[m.faction]?.name ?? m.faction;
    const repPips = '◆'.repeat(Math.max(1, Math.round((m.reward?.rep ?? 0) / 8)));
    const prog = m.accepted && m.need > 1 ? ` <span style="color:var(--ui-dim);">${m.have ?? 0}/${m.need}</span>` : '';
    const d = document.createElement('div');
    d.style.cssText = `border:1px solid ${col}44;border-left:3px solid ${col};margin-bottom:8px;padding:10px 12px;background:rgba(6,14,20,.5);`;
    d.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div style="flex:1;">
          <div style="font-size:9px;letter-spacing:.16em;color:${col};text-transform:uppercase;">${fac}</div>
          <div style="font-size:14px;margin:2px 0;">${m.title}${prog}</div>
          <div style="font-size:11px;color:var(--ui-dim);">${m.desc}</div>
          <div style="font-size:11px;margin-top:4px;">
            <span style="color:var(--ui-amber);">+${m.reward?.lumens ?? 0} ⌾</span>
            <span style="color:${col};margin-left:8px;">+${m.reward?.rep ?? 0} standing ${repPips}</span>
            ${(m.reward?.items ?? []).map(([id, q]) => `<span style="color:${ITEMS[id]?.color};margin-left:8px;">+${q} ${ITEMS[id]?.name}</span>`).join('')}
          </div>
        </div>
        <div class="mb-actions" style="display:flex;flex-direction:column;gap:5px;"></div>
      </div>`;
    const box = d.querySelector('.mb-actions');
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      const ok = a.ok !== false;
      b.style.cssText = `background:${ok ? `${col}22` : 'transparent'};border:1px solid ${ok ? col : '#3a4a55'};color:${ok ? col : '#57707e'};padding:5px 13px;cursor:${ok ? 'pointer' : 'default'};font-family:inherit;font-size:10px;letter-spacing:.1em;white-space:nowrap;`;
      if (ok) b.onclick = () => { a.fn(); this._render(); };
      else b.onclick = () => audio.sfx('deny');
      box.appendChild(b);
    }
    return d;
  }

  _render() {
    if (!this.root) return;
    const gs = this.gs;
    // standings header
    const st = this.root.querySelector('#mb-standings');
    st.innerHTML = ['meridian', 'chorale', 'sunward'].map((f) => {
      const v = gs.quests.reputation?.[f] ?? 0;
      const t = repTier(v);
      const col = FACTION_COLOR[f];
      const toNext = t.next ? `${v}/${t.next.at}` : 'MAX';
      return `<div>
        <div style="font-size:9px;letter-spacing:.14em;color:${col};text-transform:uppercase;">${FACTIONS[f]?.name ?? f}</div>
        <div style="font-size:12px;color:var(--ui-ink);">${t.name} <span style="color:var(--ui-dim);font-size:10px;">${toNext}</span></div>
      </div>`;
    }).join('');

    this.root.querySelectorAll('.mb-tab').forEach((b) => {
      const on = b.dataset.tab === this.tab;
      b.style.color = on ? 'var(--ui-cyan)' : 'var(--ui-dim)';
      b.style.borderBottomColor = on ? 'var(--ui-cyan)' : 'transparent';
    });
    const body = this.root.querySelector('#mb-body');
    body.innerHTML = '';

    if (this.tab === 'available') {
      const active = gs.quests.board ?? [];
      const takeable = this._offers.filter((o) => !active.some((a) => a.id === o.id));
      if (!takeable.length) { body.innerHTML = '<div style="color:var(--ui-dim);font-size:12px;">All postings on this board are taken. Complete or abandon active work.</div>'; return; }
      for (const m of takeable) {
        body.appendChild(this._card(m, [{
          label: 'ACCEPT', ok: (active.length < 3),
          fn: () => this.quests.acceptBoard(m),
        }]));
      }
    } else {
      const active = gs.quests.board ?? [];
      if (!active.length) { body.innerHTML = '<div style="color:var(--ui-dim);font-size:12px;">No active missions. Accept postings from the Available tab.</div>'; return; }
      for (const m of active) {
        const actions = [{ label: 'ABANDON', fn: () => this.quests.abandonBoard(m) }];
        if (m.kind === 'courier') {
          const can = gs.countItem(m.filterId) >= m.need;
          actions.unshift({ label: can ? 'DELIVER' : `NEED ${m.need}`, ok: can, fn: () => this.quests.claimCourier(m) });
        }
        body.appendChild(this._card(m, actions));
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
