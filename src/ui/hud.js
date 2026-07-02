// In-game heads-up display: vitals cluster, compass strip, lumens counter,
// context line, flight readouts and reticle. Pure DOM overlay — reads a
// snapshot each frame and touches the DOM only when values change.
import { el, statBar, iconSVG } from './widgets.js';

const PX_PER_DEG = 2.1;           // compass strip scale
const HAZARDS = ['temp', 'rad', 'tox'];

/** cached textContent setter — avoids layout churn on unchanged values */
function setText(node, s) {
  if (node.__amsText !== s) { node.__amsText = s; node.textContent = s; }
}

/** format 0..1 as percent, else round */
function fmt(v) {
  if (v == null) return '—';
  return v <= 1.001 ? `${Math.round(v * 100)}%` : `${Math.round(v)}`;
}

/**
 * Game HUD. Owns a DOM subtree under `uiRoot`; never captures pointer events.
 * Modes gate which clusters are visible ('foot' | 'ship' | 'space' | 'hidden').
 */
export class HUD {
  /** @param {HTMLElement} uiRoot the #ui-root overlay element */
  constructor(uiRoot) {
    this.root = el('div', 'ams-hud mode-hidden', uiRoot);
    this.root.dataset.reticle = 'dot';
    this.mode = 'hidden';
    this._last = {};

    this._buildVitals();
    this._buildCompass();
    this._buildTopRight();
    this._buildContext();
    this._buildReadouts();
    this._buildReticle();
  }

  _buildVitals() {
    const v = el('div', 'hud-cluster hud-vitals ams-panel', this.root);
    this._vitalsEl = v;
    this.healthBar = statBar('Health', '--ui-green');
    this.shieldBar = statBar('Shield', '--ui-cyan');
    this.hullBar = statBar('Hull', '--ui-amber');
    this.hullBar.root.classList.add('hud-ship-only');
    this.hullBar.root.style.flexDirection = 'column';
    v.append(this.healthBar.root, this.shieldBar.root, this.hullBar.root);

    const minis = el('div', 'hud-minis hud-foot-only', v);
    this._minis = {};
    for (const [key, icon, color] of [
      ['oxygen', 'o2', '--ui-cyan'],
      ['energy', 'energy', '--ui-amber'],
      ['jetpack', 'jetpack', '--ui-violet'],
    ]) {
      const row = el('div', 'ams-minibar', minis);
      row.appendChild(iconSVG(icon));
      const bar = statBar('', color);
      bar.root.querySelector('.ams-bar-head').style.display = 'none';
      row.appendChild(bar.root);
      this._minis[key] = { row, bar };
    }

    const haz = el('div', 'hud-hazards', v);
    this._hazEls = {};
    for (const h of HAZARDS) {
      const d = el('div', 'hud-hazard', haz);
      d.appendChild(iconSVG(h));
      this._hazEls[h] = d;
    }
  }

  _buildCompass() {
    const c = el('div', 'hud-cluster hud-compass', this.root);
    const win = el('div', 'compass-window', c);
    this._compassWin = win;
    const strip = el('div', 'compass-strip', win);
    this._strip = strip;
    // three 360° copies so any heading has ticks on both sides
    const CARDS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -360; d < 720; d += 15) {
      const norm = ((d % 360) + 360) % 360;
      const x = (d + 360) * PX_PER_DEG;
      if (CARDS[norm] !== undefined && norm % 45 === 0) {
        const card = el('div', `compass-card${norm % 90 ? ' minor' : ''}`, strip);
        card.textContent = CARDS[norm];
        card.style.left = `${x}px`;
        if (norm % 90 === 0) continue; // cardinal letters replace the tick
      }
      const t = el('div', `compass-tick${norm % 45 === 0 ? ' mid' : ''}`, strip);
      t.style.left = `${x}px`;
    }
    el('div', 'compass-center', win);
    this._targetMarker = el('div', 'compass-target', win);
    this._targetMarker.style.display = 'none';
    this._degEl = el('div', 'compass-deg ams-value', c);
    this._targetLine = el('div', 'hud-target-line', c);
  }

  _buildTopRight() {
    const tr = el('div', 'hud-cluster hud-topright', this.root);
    const lum = el('div', 'hud-lumens ams-panel', tr);
    lum.appendChild(iconSVG('lumens'));
    const col = el('div', '', lum);
    this._lumensEl = el('div', 'ams-value', col);
    const lab = el('div', 'ams-label', col);
    lab.textContent = 'Lumens';
    this._topRight = tr;
  }

  _buildContext() {
    const c = el('div', 'hud-cluster hud-context', this.root);
    this._locEl = el('div', 'hud-location ams-panel', c);
    this._ctxSub = el('div', 'hud-context-sub', c);
    this._contextEl = c;
  }

  _buildReadouts() {
    const r = el('div', 'hud-cluster hud-readouts ams-panel', this.root);
    this._readoutsEl = r;
    this._readouts = {};
    for (const [key, icon, label, unit] of [
      ['speed', 'speed', 'Speed', 'M/S'],
      ['altitude', 'altitude', 'Alt', 'M'],
      ['fuel', 'fuel', 'Fuel', ''],
      ['warp', 'warp', 'Warp', 'CELLS'],
    ]) {
      const row = el('div', 'hud-readout', r);
      row.appendChild(iconSVG(icon));
      const lab = el('div', 'ams-label', row);
      lab.textContent = label;
      const val = el('div', 'ams-value', row);
      if (unit) {
        const u = el('span', 'unit', row);
        u.textContent = unit;
      }
      this._readouts[key] = { row, val };
    }
  }

  _buildReticle() {
    const wrap = el('div', 'hud-reticle', this.root);
    el('div', 'ret ret-dot', wrap);
    el('div', 'ret ret-interact', wrap);
    const ship = el('div', 'ret ret-ship', wrap);
    el('div', 'ring', ship);
    for (const d of ['n', 's', 'e', 'w']) el('div', `tick ${d}`, ship);
    el('div', 'core', ship);
    this._interactEl = el('div', 'hud-interact ams-panel', this.root);
    this._interactEl.style.display = 'none';
  }

  /**
   * Switch visible clusters. Re-triggers the slide-in animation on the
   * clusters that just appeared.
   * @param {'foot'|'ship'|'space'|'hidden'} mode
   */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.root.className = `ams-hud mode-${mode}`;
    if (mode === 'hidden') return;
    this.root.dataset.reticle = mode === 'foot' ? 'dot' : 'ship';
    for (const cl of this.root.querySelectorAll('.hud-cluster')) {
      cl.classList.remove('hud-anim');
      void cl.offsetWidth; // restart animation
      cl.classList.add('hud-anim');
    }
  }

  /**
   * Per-frame refresh. Cheap: every DOM write is gated on value change.
   * @param {number} dt seconds
   * @param {object} s snapshot — { health, shield, hull?, oxygen, energy,
   *   jetpack, lumens, speed, altitude?, fuel, warpCharges, hazardIcons,
   *   compassDeg, target?, reticle, interactLabel?, locationLine?, toolMode? }
   */
  update(dt, s) {
    if (this.mode === 'hidden' || !s) return;
    const L = this._last;

    this.healthBar.set(s.health ?? 1);
    this.shieldBar.set(s.shield ?? 1);
    if (s.hull != null) this.hullBar.set(s.hull);
    for (const key of ['oxygen', 'energy', 'jetpack']) {
      const m = this._minis[key];
      const v = s[key] ?? 1;
      m.bar.set(v, '');
      const low = v < 0.25;
      if (m.__low !== low) { m.__low = low; m.row.classList.toggle('is-low', low); }
    }

    // hazards
    const hz = s.hazardIcons || [];
    const hzKey = hz.join(',');
    if (L.hzKey !== hzKey) {
      L.hzKey = hzKey;
      for (const h of HAZARDS) this._hazEls[h].classList.toggle('active', hz.includes(h));
    }

    // compass: transform every frame (cheap), readout text gated
    const deg = ((s.compassDeg ?? 0) % 360 + 360) % 360;
    const winW = this._compassWin.clientWidth || 360;
    this._strip.style.transform = `translateX(${winW / 2 - (deg + 360) * PX_PER_DEG}px)`;
    setText(this._degEl, `${String(Math.round(deg)).padStart(3, '0')}°`);

    // target marker + line
    const t = s.target;
    if (t && t.bearingDeg != null) {
      let diff = ((t.bearingDeg - deg) % 360 + 360) % 360;
      if (diff > 180) diff -= 360;
      const max = winW / 2 - 14;
      const x = Math.max(-max, Math.min(max, diff * PX_PER_DEG));
      this._targetMarker.style.display = '';
      this._targetMarker.style.left = `calc(50% + ${x}px)`;
      this._targetMarker.style.opacity = Math.abs(diff * PX_PER_DEG) > max ? 0.45 : 1;
    } else if (this._targetMarker.style.display !== 'none') {
      this._targetMarker.style.display = 'none';
    }
    setText(this._targetLine, t ? `◆ ${t.name}${t.dist != null ? ` — ${t.dist >= 1000 ? (t.dist / 1000).toFixed(1) + ' km' : Math.round(t.dist) + ' m'}` : ''}` : '');

    setText(this._lumensEl, `⌾ ${Math.round(s.lumens ?? 0).toLocaleString('en-US')}`);

    // context (bottom-left)
    const loc = s.locationLine || '';
    setText(this._locEl, loc);
    this._locEl.style.display = loc ? '' : 'none';
    setText(this._ctxSub, s.toolMode ? `ARCFORGE · ${String(s.toolMode).toUpperCase()}` : '');

    // readouts (bottom-right): hide rows with no data
    this._setReadout('speed', s.speed != null ? `${Math.round(s.speed)}` : null);
    this._setReadout('altitude', s.altitude != null ? `${Math.round(s.altitude)}` : null);
    this._setReadout('fuel', s.fuel != null ? fmt(s.fuel) : null);
    this._setReadout('warp', s.warpCharges != null ? `${s.warpCharges}` : null);

    // reticle + interact label
    const ret = s.reticle || (this.mode === 'foot' ? 'dot' : 'ship');
    if (L.ret !== ret) { L.ret = ret; this.root.dataset.reticle = ret; }
    const il = s.interactLabel || '';
    if (L.interact !== il) {
      L.interact = il;
      setText(this._interactEl, il);
      this._interactEl.style.display = il ? '' : 'none';
    }
  }

  _setReadout(key, text) {
    const r = this._readouts[key];
    const show = text != null;
    if (r.__show !== show) { r.__show = show; r.row.style.display = show ? '' : 'none'; }
    if (show) setText(r.val, text);
  }

  /** Remove the HUD subtree. */
  dispose() {
    this.root.remove();
  }
}
