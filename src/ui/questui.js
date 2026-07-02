// Quest log + lore reader — STUB pending fan-out #2. CONTRACT:
//   new QuestUI(gameState) → .isOpen; listens 'lore:show' events and displays
//   Luminel fragments in a modal.
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

export class QuestUI {
  constructor(gs) {
    this.gs = gs;
    this.root = null;
    events.on('lore:show', (lore) => this.showLore(lore));
  }
  get isOpen() { return !!this.root; }

  showLore(lore) {
    this.root?.remove();
    const r = document.createElement('div');
    r.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,4,10,.7);backdrop-filter:blur(5px);z-index:45;';
    r.innerHTML = `<div style="max-width:560px;background:rgba(10,14,26,.94);border:1px solid #ffffff44;padding:34px 40px;color:#e8ecff;font-family:Georgia,serif;text-align:center;">
      <div style="letter-spacing:.3em;color:#7de8ff;font-family:system-ui;font-size:12px;margin-bottom:14px;">LUMINEL FRAGMENT</div>
      <h2 style="font-weight:400;margin-bottom:16px;">${lore.title}</h2>
      <p style="line-height:1.7;opacity:.9;font-style:italic;">${lore.text}</p>
      <button id="lore-close" style="margin-top:22px;background:none;border:1px solid #7de8ff66;color:#7de8ff;padding:8px 26px;cursor:pointer;letter-spacing:.2em;font-family:system-ui;">CONTINUE</button>
    </div>`;
    document.getElementById('ui-root').appendChild(r);
    r.querySelector('#lore-close').onclick = () => { this.close(); audio.sfx('click'); };
    this.root = r;
  }

  close() { this.root?.remove(); this.root = null; }
}
