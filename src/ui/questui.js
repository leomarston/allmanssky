// Quest UI: Luminel lore modal (listens 'lore:show') + a passive contract
// tracker pinned under the vitals cluster.
// CONTRACT: new QuestUI(gameState) → .isOpen ; events-driven.
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

export class QuestUI {
  constructor(gs) {
    this.gs = gs;
    this.root = null;
    events.on('lore:show', (lore) => this.showLore(lore));

    // passive tracker
    this.tracker = document.createElement('div');
    this.tracker.style.cssText = [
      'position:absolute', 'left:18px', 'top:212px', 'width:250px',
      'display:flex', 'flex-direction:column', 'gap:5px',
      'pointer-events:none', 'z-index:5',
    ].join(';');
    document.getElementById('ui-root')?.appendChild(this.tracker);
    this._renderTracker();
    events.on('quest:updated', () => this._renderTracker());
    events.on('state:change', () => this._renderTracker());
  }

  get isOpen() { return !!this.root; }

  _renderTracker() {
    const active = this.gs?.quests?.active ?? [];
    this.tracker.innerHTML = active.length
      ? `<div class="ams-label" style="opacity:.75;margin-bottom:2px;">CONTRACTS</div>`
        + active.map((c) => `
          <div style="background:rgba(6,16,22,.55);border-left:2px solid var(--ui-cyan,#7de8ff);padding:5px 9px;backdrop-filter:blur(3px);">
            <div style="font-size:11px;letter-spacing:.06em;color:var(--ui-ink,#d6f2ff);">${c.title}</div>
            <div style="font-size:10px;color:var(--ui-dim,#7fa3b4);margin-top:1px;">
              ${c.have ?? 0} / ${c.need}
              <span style="display:inline-block;width:70px;height:3px;background:#0a1a22;margin-left:6px;vertical-align:middle;">
                <span style="display:block;height:100%;width:${Math.round(100 * (c.have ?? 0) / c.need)}%;background:var(--ui-cyan,#7de8ff);"></span>
              </span>
            </div>
          </div>`).join('')
      : '';
  }

  showLore(lore) {
    this.root?.remove();
    const r = document.createElement('div');
    r.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,4,10,.72);backdrop-filter:blur(6px);z-index:45;animation:ams-flicker-in .5s;';
    r.innerHTML = `<div style="max-width:580px;background:rgba(10,14,26,.94);border:1px solid rgba(255,255,255,.28);padding:38px 46px;color:#e8ecff;font-family:Georgia,'Times New Roman',serif;text-align:center;box-shadow:0 0 60px rgba(125,232,255,.12);">
      <div style="letter-spacing:.34em;color:#7de8ff;font-family:var(--ui-font,system-ui);font-size:11px;margin-bottom:16px;">◈ LUMINEL TRANSMISSION ◈</div>
      <h2 style="font-weight:400;margin-bottom:18px;font-size:24px;">${lore.title}</h2>
      <p style="line-height:1.75;opacity:.92;font-style:italic;font-size:15px;">${lore.text}</p>
      <button id="lore-close" style="margin-top:26px;background:none;border:1px solid rgba(125,232,255,.4);color:#7de8ff;padding:9px 30px;cursor:pointer;letter-spacing:.22em;font-family:var(--ui-font,system-ui);font-size:11px;">CONTINUE</button>
    </div>`;
    document.getElementById('ui-root').appendChild(r);
    const close = () => { this.close(); audio.sfx('click'); };
    r.querySelector('#lore-close').onclick = close;
    r.addEventListener('click', (e) => { if (e.target === r) close(); });
    this.root = r;
  }

  close() { this.root?.remove(); this.root = null; }
}
