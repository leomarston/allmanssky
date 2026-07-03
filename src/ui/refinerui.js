// Machine terminal: holographic panel for base refiners (element
// transmutation jobs) and bio planters (plant / growth / harvest).
// CONTRACT: new RefinerUI(gameState) → .open(rec) .close() .isOpen
// rec is the live base-piece record (gameplay/machines.js persists job /
// output / crop directly on it).
import { ITEMS, itemName } from '../gameplay/items.js';
import {
  REFINER_RECIPES, CROPS, DEFAULT_CROP,
  refinerProgress, settleRefiner, planterProgress,
} from '../gameplay/machines.js';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class RefinerUI {
  constructor(gs) {
    this.gs = gs;
    this.root = null;
    this.rec = null;
    this._timer = null;
    this._phase = '';
  }

  get isOpen() { return !!this.root; }

  open(rec) {
    if (this.root) this.close();
    this.rec = rec;
    audio.sfx('dock');
    const planter = rec.kind === 'planter';
    const accent = planter ? 'var(--ui-green)' : 'var(--ui-amber)';
    const r = document.createElement('div');
    r.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,6,10,.5);backdrop-filter:blur(4px);z-index:40;';
    r.innerHTML = `
      <div class="ams-panel" style="width:min(600px,92vw);max-height:82vh;display:flex;flex-direction:column;padding:0;overflow:hidden;">
        <div class="ams-scanlines"></div>
        <div style="padding:18px 24px 13px;border-bottom:1px solid ${planter ? 'rgba(125,255,180,.25)' : 'rgba(255,180,84,.25)'};">
          <div class="ams-label" style="color:${accent};">${planter ? 'HYDROPONIC BAY · BIO PLANTER' : 'TRANSMUTATION FURNACE · REFINER'}</div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
            <div style="font-size:18px;letter-spacing:.1em;">${planter ? 'BIO PLANTER' : 'ELEMENT REFINER'}</div>
            <div id="rf-status" class="ams-label" style="color:${accent};"></div>
          </div>
          <div style="font-size:11px;color:var(--ui-dim);margin-top:3px;">${planter
            ? 'Soil, water, patience. The tray does the rest.'
            : 'Slow heat rewrites what the fabricator cannot.'}</div>
        </div>
        <div id="rf-body" style="padding:16px 24px 20px;overflow:auto;flex:1;"></div>
        <div style="padding:9px 24px;border-top:1px solid rgba(125,232,255,.14);font-size:10px;color:var(--ui-dim);letter-spacing:.12em;">ESC — CLOSE</div>
      </div>`;
    (document.getElementById('ui-root') ?? document.body).appendChild(r);
    this.root = r;
    this._esc = (e) => { if (e.code === 'Escape') this.close(); };
    window.addEventListener('keydown', this._esc);
    this._invOff = events.on('inventory:changed', () => { if (this.root) this._render(); });
    this._render();
    this._timer = setInterval(() => this._tick(), 250);
  }

  close() {
    if (!this.root) return;
    clearInterval(this._timer);
    this._timer = null;
    window.removeEventListener('keydown', this._esc);
    this._invOff?.();
    this._invOff = null;
    this.root.remove();
    this.root = null;
    this.rec = null;
    audio.sfx('click');
  }

  // ---- shared bits ---------------------------------------------------------

  _chip(id, qty) {
    const it = ITEMS[id];
    const have = this.gs.countItem(id) >= qty;
    return `<span title="${it?.name ?? id} (have ${this.gs.countItem(id)})" style="
      display:inline-flex;align-items:center;gap:5px;padding:3px 9px;margin:2px 3px 2px 0;
      border:1px solid ${have ? 'rgba(125,232,255,.28)' : 'rgba(255,84,112,.55)'};
      background:rgba(6,14,20,.6);font-size:11px;letter-spacing:.06em;
      color:${have ? 'var(--ui-ink)' : 'var(--ui-red)'};white-space:nowrap;">
      <span style="color:${it?.color ?? '#9adcff'};">◆</span>${qty} ${it?.symbol ?? id}</span>`;
  }

  _outChip(id, qty) {
    const it = ITEMS[id];
    return `<span title="${it?.name ?? id}" style="
      display:inline-flex;align-items:center;gap:5px;padding:3px 9px;
      border:1px solid ${it?.color ?? '#9adcff'}44;background:rgba(6,14,20,.6);
      font-size:11px;letter-spacing:.06em;color:${it?.color ?? '#9adcff'};white-space:nowrap;">
      <span>◆</span>${qty} ${it?.symbol ?? id}</span>`;
  }

  _btn(label, ok, fn, color = 'var(--ui-amber)') {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `background:${ok ? 'rgba(125,232,255,.08)' : 'transparent'};
      border:1px solid ${ok ? color : '#3a4a55'};color:${ok ? color : '#57707e'};
      padding:6px 15px;cursor:${ok ? 'pointer' : 'default'};font-family:inherit;
      font-size:11px;font-weight:600;letter-spacing:.14em;white-space:nowrap;`;
    b.onclick = ok ? fn : () => audio.sfx('deny');
    return b;
  }

  _bar(frac, color, countdown) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="ams-bar" style="margin-top:9px;">
        <div class="ams-bar-track" style="height:9px;">
          <div class="ams-bar-fill" id="rf-fill" style="color:${color};width:${(frac * 100).toFixed(1)}%;"></div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:5px;">
        <span class="ams-label">PROGRESS</span>
        <span id="rf-count" class="ams-value" style="font-size:12px;color:${color};">${countdown}</span>
      </div>`;
    return wrap;
  }

  _row(html) {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid rgba(125,232,255,.14);margin-bottom:5px;background:rgba(6,14,20,.5);';
    d.innerHTML = html;
    return d;
  }

  _phaseKey() {
    const rec = this.rec;
    if (!rec) return '';
    if (rec.kind === 'planter') {
      const p = planterProgress(rec);
      return p ? `grow:${p.ready ? 'ready' : 'run'}` : 'empty';
    }
    return `job:${rec.job ? rec.job.recipeIdx : 'none'}:${rec.output ? `${rec.output.id}×${rec.output.qty}` : 'none'}`;
  }

  _tick() {
    const rec = this.rec;
    if (!rec || !this.root) return;
    if (rec.kind === 'refiner') settleRefiner(rec);
    const key = this._phaseKey();
    if (key !== this._phase) { this._render(); return; }
    // no state change — just advance the live bar/countdown
    const p = rec.kind === 'planter' ? planterProgress(rec) : refinerProgress(rec);
    if (!p) return;
    const fill = this.root.querySelector('#rf-fill');
    const count = this.root.querySelector('#rf-count');
    if (fill) fill.style.width = `${(p.frac * 100).toFixed(1)}%`;
    if (count) count.textContent = `${fmtTime(p.remainMs)} REMAINING`;
  }

  // ---- render --------------------------------------------------------------

  _render() {
    if (!this.root || !this.rec) return;
    this._phase = this._phaseKey();
    const body = this.root.querySelector('#rf-body');
    body.innerHTML = '';
    if (this.rec.kind === 'planter') this._renderPlanter(body);
    else this._renderRefiner(body);
  }

  _renderRefiner(body) {
    const { gs, rec } = this;
    const status = this.root.querySelector('#rf-status');
    const p = refinerProgress(rec);
    status.textContent = p ? 'FURNACE LIT' : (rec.output ? 'OUTPUT READY' : 'STANDING BY');

    if (p) {
      const sec = document.createElement('div');
      sec.style.cssText = 'padding:12px 14px;border:1px solid rgba(255,180,84,.35);background:rgba(30,16,4,.35);margin-bottom:14px;';
      sec.innerHTML = `
        <div class="ams-label" style="color:var(--ui-amber);">TRANSMUTATION IN PROGRESS</div>
        <div style="margin-top:7px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span>${p.recipe.ins.map(({ id, qty }) => this._outChip(id, qty)).join('')}</span>
          <span style="color:var(--ui-amber);">→</span>
          ${this._outChip(p.recipe.out.id, p.recipe.out.qty)}
        </div>`;
      sec.appendChild(this._bar(p.frac, 'var(--ui-amber)', `${fmtTime(p.remainMs)} REMAINING`));
      body.appendChild(sec);
    }

    if (rec.output) {
      const row = this._row(`
        <div style="display:flex;align-items:center;gap:9px;">
          <span class="ams-label" style="color:var(--ui-green);">OUTPUT HOPPER</span>
          ${this._outChip(rec.output.id, rec.output.qty)}
          <span style="font-size:11px;color:var(--ui-dim);">${itemName(rec.output.id)}</span>
        </div>`);
      row.appendChild(this._btn('COLLECT', true, () => this._collect(), 'var(--ui-green)'));
      body.appendChild(row);
      body.appendChild(Object.assign(document.createElement('div'), { style: 'height:9px;' }));
    }

    const head = document.createElement('div');
    head.className = 'ams-label';
    head.style.cssText = 'margin:2px 0 8px;color:var(--ui-cyan);';
    head.textContent = 'TRANSMUTATION RECIPES';
    body.appendChild(head);

    REFINER_RECIPES.forEach((r, i) => {
      const canQueue = !rec.job && (!rec.output || rec.output.id === r.out.id);
      const afford = gs.hasItems(r.ins);
      const row = this._row(`
        <div>
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
            <span>${r.ins.map(({ id, qty }) => this._chip(id, qty)).join('')}</span>
            <span style="color:var(--ui-dim);">→</span>
            ${this._outChip(r.out.id, r.out.qty)}
          </div>
          <div style="font-size:10px;color:var(--ui-dim);margin-top:3px;letter-spacing:.08em;">
            ${itemName(r.out.id).toUpperCase()} · ${r.time}S BURN</div>
        </div>`);
      row.appendChild(this._btn('START', canQueue && afford, () => this._start(i)));
      body.appendChild(row);
    });
  }

  _renderPlanter(body) {
    const { gs, rec } = this;
    const status = this.root.querySelector('#rf-status');
    const p = planterProgress(rec);
    status.textContent = p ? (p.ready ? 'READY TO HARVEST' : 'GROWING') : 'TRAY EMPTY';

    if (!p) {
      // v1: one crop — the table supports more
      for (const [id, def] of Object.entries(CROPS)) {
        const afford = gs.hasItems(def.seed);
        const row = this._row(`
          <div>
            <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
              <span>${def.seed.map(({ id: sid, qty }) => this._chip(sid, qty)).join('')}</span>
              <span style="color:var(--ui-dim);">→</span>
              ${this._outChip(id, `${def.yield[0]}-${def.yield[1]}`)}
            </div>
            <div style="font-size:10px;color:var(--ui-dim);margin-top:3px;letter-spacing:.08em;">
              ${def.name.toUpperCase()} · ${def.growTime}S GROWTH</div>
          </div>`);
        row.appendChild(this._btn('PLANT', afford, () => this._plant(id), 'var(--ui-green)'));
        body.appendChild(row);
      }
      return;
    }

    const def = p.def;
    const stage = p.ready ? 'MATURE' : (p.frac < 0.34 ? 'GERMINATING' : p.frac < 0.67 ? 'SPROUTING' : 'FLOWERING');
    const sec = document.createElement('div');
    sec.style.cssText = `padding:12px 14px;border:1px solid ${p.ready ? 'rgba(125,255,180,.5)' : 'rgba(125,255,180,.25)'};background:rgba(6,24,12,.3);`;
    sec.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <div class="ams-label" style="color:var(--ui-green);">${def.name.toUpperCase()} · ${stage}</div>
        ${this._outChip(p.id, `${def.yield[0]}-${def.yield[1]}`)}
      </div>`;
    sec.appendChild(this._bar(p.frac, 'var(--ui-green)',
      p.ready ? 'GROWTH COMPLETE' : `${fmtTime(p.remainMs)} REMAINING`));
    body.appendChild(sec);

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;justify-content:flex-end;margin-top:12px;';
    foot.appendChild(this._btn('HARVEST', p.ready, () => this._harvest(), 'var(--ui-green)'));
    body.appendChild(foot);
  }

  // ---- actions --------------------------------------------------------------

  _start(recipeIdx) {
    const { gs, rec } = this;
    const r = REFINER_RECIPES[recipeIdx];
    if (!r || rec.job || !gs.removeItems(r.ins)) { audio.sfx('deny'); return; }
    rec.job = { recipeIdx, started: Date.now(), qtyRuns: 1, doneRuns: 0 };
    audio.sfx('craft');
    gs.save();
    this._render();
  }

  _collect() {
    const { gs, rec } = this;
    const out = rec.output;
    if (!out) return;
    const added = gs.addItem(out.id, out.qty);
    if (added <= 0) { audio.sfx('deny'); return; } // cargo full — hopper keeps it
    out.qty -= added;
    if (out.qty <= 0) rec.output = null;
    audio.sfx('collect');
    events.emit('notify', { text: `+${added} ${itemName(out.id)}`, tone: 'good' });
    gs.save();
    this._render();
  }

  _plant(cropId = DEFAULT_CROP) {
    const { gs, rec } = this;
    const def = CROPS[cropId];
    if (!def || rec.crop || !gs.removeItems(def.seed)) { audio.sfx('deny'); return; }
    rec.crop = { id: cropId, planted: Date.now(), growTime: def.growTime };
    audio.sfx('craft');
    events.emit('notify', { text: `${def.name} planted`, tone: 'info' });
    gs.save();
    this._render();
  }

  _harvest() {
    const { gs, rec } = this;
    const p = planterProgress(rec);
    if (!p?.ready) { audio.sfx('deny'); return; }
    const def = p.def;
    const qty = def.yield[0] + Math.floor(Math.random() * (def.yield[1] - def.yield[0] + 1));
    const added = gs.addItem(p.id, qty);
    if (added <= 0) { audio.sfx('deny'); return; } // cargo full — crop stays
    rec.crop = null;
    audio.sfx('collect');
    events.emit('notify', { text: `+${added} ${itemName(p.id)} harvested`, tone: 'good' });
    gs.save();
    this._render();
  }
}
