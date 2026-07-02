// Galaxy map overlay — STUB pending fan-out #2 (full 3D star map). CONTRACT:
//   new GalaxyMap(galaxy, gameState) → .open() .close() .toggle() .isOpen
//   Selecting a system sets gameState.quests.vesperTarget (J-warp destination).
import { audio } from '../audio/audio.js';
import { events } from '../core/events.js';

export class GalaxyMap {
  constructor(galaxy, gs) { this.galaxy = galaxy; this.gs = gs; this.root = null; }
  get isOpen() { return !!this.root; }
  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    if (this.root) return;
    audio.sfx('scan');
    const neighbors = this.galaxy.neighborsOf(this.gs.currentSystemId, 3).slice(0, 14);
    const current = this.galaxy.getSystem(this.gs.currentSystemId);
    const r = document.createElement('div');
    r.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,4,12,.78);backdrop-filter:blur(6px);z-index:40;';
    const rows = neighbors.map((n) => {
      const visited = this.gs.visitedSystems.includes(n.id);
      const vesper = this.gs.quests.vesperTarget === n.id;
      return `<button data-id="${n.id}" style="display:block;width:100%;text-align:left;margin:3px 0;background:#0b1626;border:1px solid ${vesper ? '#ffb454' : '#7de8ff44'};color:#cfeeff;padding:8px 12px;cursor:pointer;font-family:inherit;">
        <span style="color:${n.starColorHex ?? '#fff'};">●</span> ${n.name}
        <span style="opacity:.6">· ${n.starClass}-class</span>
        ${visited ? '<span style="color:#7dffb4;font-size:11px;"> VISITED</span>' : ''}
        ${vesper ? '<span style="color:#ffb454;font-size:11px;"> ⟡ VESPER SIGNAL</span>' : ''}
      </button>`;
    }).join('');
    r.innerHTML = `<div style="min-width:560px;max-height:80vh;overflow:auto;background:rgba(6,12,24,.92);border:1px solid #7de8ff55;padding:24px;color:#cfeeff;font-family:system-ui;">
      <h2 style="color:#7de8ff;letter-spacing:.14em;">LOCAL STAR CHART</h2>
      <div style="opacity:.75;margin:4px 0 12px;">${current.name} — select a destination, then J to warp (needs Void Cell)</div>
      ${rows}
      <div style="margin-top:12px;opacity:.7;font-size:12px;">M / ESC — close</div>
    </div>`;
    document.getElementById('ui-root').appendChild(r);
    r.querySelectorAll('button[data-id]').forEach((b) => {
      b.onclick = () => {
        this.gs.quests.vesperTarget = b.dataset.id;
        audio.sfx('confirm');
        events.emit('notify', { text: 'WARP TARGET LOCKED', tone: 'info' });
        this.close();
      };
    });
    this.root = r;
  }

  close() { this.root?.remove(); this.root = null; }
}
