// Full-screen overlay screens: main menu, pause, settings, death.
// Promise-based, keyboard navigable (arrows/tab + enter, Esc where sensible),
// holographic glass theme. Owns its DOM under #ui-root.
import { el, iconSVG } from './widgets.js';
import { RNG } from '../core/rng.js';
import { AMS_VERSION } from '../core/version.js';

const SETTINGS_KEY = 'ams-settings';
const SETTINGS_DEFAULTS = { volume: 0.8, sensitivity: 1.0, bloom: true };

/** lazily-loaded audio module — guarded so the UI works without it */
let _audioP = null;
function sfx(name) {
  if (!_audioP) _audioP = import('../audio/audio.js').then((m) => m.audio).catch(() => null);
  _audioP.then((a) => { try { a?.sfx?.(name); } catch { /* no audio yet */ } });
}

/** read persisted settings (merged over defaults) */
function loadSettings() {
  try { return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...SETTINGS_DEFAULTS }; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

/** seeded decorative starfield drawn onto a 2D canvas behind menu screens */
function paintMenuStars(canvas) {
  const w = (canvas.width = canvas.clientWidth || innerWidth);
  const h = (canvas.height = canvas.clientHeight || innerHeight);
  const g = canvas.getContext('2d');
  const rng = new RNG(0xA0BE11A); // fixed seed: same sky every boot
  // nebula washes
  for (let i = 0; i < 7; i++) {
    const x = rng.range(0, w), y = rng.range(0, h * 0.85);
    const r = rng.range(h * 0.28, h * 0.65);
    const hue = rng.pick([190, 200, 262, 300, 210]);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `hsla(${hue}, 80%, 60%, ${rng.range(0.08, 0.16)})`);
    grad.addColorStop(1, 'transparent');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // stars
  for (let i = 0; i < 420; i++) {
    const x = rng.range(0, w), y = rng.range(0, h);
    const s = rng.next();
    const rad = s > 0.97 ? 1.6 : s > 0.8 ? 1.0 : 0.6;
    g.fillStyle = `rgba(${200 + rng.int(0, 55)}, ${220 + rng.int(0, 35)}, 255, ${rng.range(0.25, 0.95)})`;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
    if (s > 0.97) { // halo on the bright few
      const grad = g.createRadialGradient(x, y, 0, x, y, 7);
      grad.addColorStop(0, 'rgba(160, 230, 255, 0.35)');
      grad.addColorStop(1, 'transparent');
      g.fillStyle = grad;
      g.fillRect(x - 7, y - 7, 14, 14);
    }
  }
  // planet limb along the bottom — dark disc with a cyan atmosphere rim
  const cx = w * 0.5, cy = h + h * 1.28, cr = h * 1.5;
  const atmo = g.createRadialGradient(cx, cy, cr * 0.985, cx, cy, cr * 1.05);
  atmo.addColorStop(0, 'rgba(125, 232, 255, 0.30)');
  atmo.addColorStop(0.45, 'rgba(90, 170, 220, 0.10)');
  atmo.addColorStop(1, 'transparent');
  g.fillStyle = atmo;
  g.fillRect(0, h * 0.5, w, h * 0.5);
  const disc = g.createRadialGradient(cx, cy, cr * 0.9, cx, cy, cr);
  disc.addColorStop(0, 'rgba(1, 4, 8, 1)');
  disc.addColorStop(0.96, 'rgba(3, 12, 20, 1)');
  disc.addColorStop(1, 'rgba(30, 80, 110, 0.9)');
  g.fillStyle = disc;
  g.beginPath();
  g.arc(cx, cy, cr, 0, Math.PI * 2);
  g.fill();
}

/**
 * Full-screen overlay manager. All methods return promises that resolve when
 * the player makes a choice; only one overlay chain is open at a time.
 */
export class Screens {
  /** @param {HTMLElement} uiRoot the #ui-root overlay element */
  constructor(uiRoot) {
    this.uiRoot = uiRoot;
    this._stack = [];
  }

  /** true while any screen overlay is visible */
  get isOpen() { return this._stack.length > 0; }

  /**
   * Title screen. Resolves {action:'continue'} | {action:'new', seed?:string}.
   * @param {{hasSave?: boolean}} [opts]
   * @returns {Promise<{action: string, seed?: string}>}
   */
  mainMenu(opts = {}) {
    return new Promise((resolve) => {
      const ov = this._overlay('');
      const stars = el('canvas', '', ov);
      stars.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      paintMenuStars(stars);
      el('div', 'ams-scanlines', ov);

      const title = el('div', 'ams-title', ov);
      title.textContent = 'ALLMANSSKY';
      const sub = el('div', 'ams-subtitle', ov);
      sub.textContent = 'the Aurelia Reach awaits';

      const menu = el('div', 'ams-menu-buttons', ov);
      const done = (result) => { this._close(ov); resolve(result); };

      // opts.saves: [{slot, systemId, lumens, warps, mode, savedAt} | null] ×3
      const saves = opts.saves ?? [];
      const slotLabel = (s, n) => {
        if (!s) return `Slot ${n} — empty`;
        const when = s.savedAt ? new Date(s.savedAt).toLocaleDateString() : '—';
        return `Slot ${n} — ${s.warps} warps · ${s.lumens}⌾ · ${when}`;
      };

      const buildRoot = () => {
        menu.textContent = '';
        if (opts.hasSave) {
          this._button(menu, 'Continue', () => done({ action: 'continue' }));
          this._button(menu, 'Load Voyage', () => buildLoad());
        }
        this._button(menu, 'New Voyage', () => buildSeed());
        this._button(menu, 'Settings', async () => { await this.settings(); this._focusFirst(menu); });
        this._focusFirst(menu);
      };

      const buildLoad = () => {
        menu.textContent = '';
        saves.forEach((s, i) => {
          const b = this._button(menu, slotLabel(s, i + 1), () => {
            if (s) { sfx('confirm'); done({ action: 'load', slot: i + 1 }); }
            else sfx('deny');
          });
          if (!b) return;
        });
        this._button(menu, 'Back', () => buildRoot());
        this._focusFirst(menu);
      };

      const buildSeed = () => {
        menu.textContent = '';
        const input = el('input', 'ams-input', menu);
        input.type = 'text';
        input.maxLength = 40;
        input.placeholder = 'universe seed — blank for fate';
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') buildSlotPick(input.value.trim() || undefined);
          e.stopPropagation();
        });
        this._button(menu, 'Launch', () => buildSlotPick(input.value.trim() || undefined));
        this._button(menu, 'Back', () => buildRoot());
        input.focus();
      };

      const buildSlotPick = (seed) => {
        menu.textContent = '';
        const note = el('div', 'ams-overlay-sub', menu);
        note.textContent = 'choose a save slot';
        saves.forEach((s, i) => {
          this._button(menu, s ? `${slotLabel(s, i + 1)} · OVERWRITE` : `Slot ${i + 1} — empty`,
            () => { sfx('confirm'); done({ action: 'new', seed, slot: i + 1 }); });
        });
        this._button(menu, 'Back', () => buildSeed());
        this._focusFirst(menu);
      };

      const foot = el('div', 'ams-menu-foot', ov);
      foot.textContent = `a wayfarer woke to the vesper signal · ${AMS_VERSION}`;

      buildRoot();
      this._bindKeys(ov, menu, null);
    });
  }

  /**
   * Pause overlay. Resolves {action:'resume'} | {action:'save-menu'}.
   * @returns {Promise<{action: string}>}
   */
  pause() {
    return new Promise((resolve) => {
      const ov = this._overlay('ams-overlay--dim');
      el('div', 'ams-scanlines', ov);
      const t = el('div', 'ams-overlay-title', ov);
      t.textContent = 'PAUSED';
      const s = el('div', 'ams-overlay-sub', ov);
      s.textContent = 'the reach holds its breath';
      const menu = el('div', 'ams-menu-buttons', ov);
      const done = (action) => { this._close(ov); resolve({ action }); };
      this._button(menu, 'Resume', () => done('resume'));
      this._button(menu, 'Settings', async () => { await this.settings(); this._focusFirst(menu); });
      this._button(menu, 'Save & Menu', () => done('save-menu'), 'ams-btn--danger');
      this._focusFirst(menu);
      this._bindKeys(ov, menu, () => done('resume'));
    });
  }

  /**
   * Settings overlay: volume, mouse sensitivity, bloom toggle. Persists to
   * localStorage('ams-settings') and resolves the chosen values.
   * @returns {Promise<{volume: number, sensitivity: number, bloom: boolean}>}
   */
  settings() {
    return new Promise((resolve) => {
      const st = loadSettings();
      const ov = this._overlay('ams-overlay--dim');
      el('div', 'ams-scanlines', ov);
      const t = el('div', 'ams-overlay-title', ov);
      t.textContent = 'SETTINGS';

      const panel = el('div', 'ams-panel', ov);
      panel.style.cssText = 'margin-top:30px;padding:18px 26px;width:420px;max-width:92vw;';

      const apply = () => {
        saveSettings(st);
        sfx('click');
        _audioP?.then((a) => { try { a?.setMuted?.(st.volume <= 0.001); } catch { /* ignore */ } });
      };

      const slider = (label, key, min, max) => {
        const row = el('div', 'ams-settings-row', panel);
        const lab = el('div', 'ams-label', row);
        lab.textContent = label;
        const holder = el('div', '', row);
        const r = el('input', 'ams-range', holder);
        r.type = 'range';
        r.min = min; r.max = max; r.step = 0.05;
        r.value = st[key];
        const fill = () => r.style.setProperty('--fill', `${((r.value - min) / (max - min)) * 100}%`);
        fill();
        r.addEventListener('input', () => { st[key] = Number(r.value); fill(); apply(); });
      };
      slider('Volume', 'volume', 0, 1);
      slider('Mouse Sensitivity', 'sensitivity', 0.2, 3);

      const row = el('div', 'ams-settings-row', panel);
      const lab = el('div', 'ams-label', row);
      lab.textContent = 'Bloom';
      const holder = el('div', '', row);
      const tog = el('div', `ams-toggle${st.bloom ? ' on' : ''}`, holder);
      tog.addEventListener('click', () => {
        st.bloom = !st.bloom;
        tog.classList.toggle('on', st.bloom);
        apply();
      });

      const menu = el('div', 'ams-menu-buttons', ov);
      menu.style.marginTop = '26px';
      const done = () => { apply(); this._close(ov); resolve({ ...st }); };
      this._button(menu, 'Done', done);
      this._focusFirst(menu);
      this._bindKeys(ov, menu, done);
    });
  }

  /**
   * Death screen — sombre; resolves when the player chooses to respawn.
   * @returns {Promise<void>}
   */
  dead() {
    return new Promise((resolve) => {
      const ov = this._overlay('ams-overlay--dead');
      el('div', 'ams-scanlines', ov);
      const t = el('div', 'ams-overlay-title', ov);
      t.textContent = 'SIGNAL LOST';
      t.style.color = '#ffd9e0';
      t.style.textShadow = '0 0 18px rgba(255,84,112,.55)';
      const s = el('div', 'ams-overlay-sub', ov);
      s.textContent = 'your light scatters — but the vesper signal endures';
      const menu = el('div', 'ams-menu-buttons', ov);
      const done = () => { this._close(ov); resolve(); };
      this._button(menu, 'Return to the Light', done);
      this._focusFirst(menu);
      this._bindKeys(ov, menu, null); // Esc cannot skip death
    });
  }

  // -- internals -------------------------------------------------------------

  _overlay(extraCls) {
    const ov = el('div', `ams-overlay ${extraCls || ''}`, this.uiRoot);
    this._stack.push(ov);
    return ov;
  }

  _close(ov) {
    if (ov.__amsClosed) return;
    ov.__amsClosed = true;
    ov.__amsUnbind?.();
    ov.remove();
    const i = this._stack.indexOf(ov);
    if (i >= 0) this._stack.splice(i, 1);
  }

  _button(parent, label, onClick, extraCls = '') {
    const b = el('button', `ams-btn ${extraCls}`, parent);
    const span = el('span', '', b);
    span.textContent = label;
    b.addEventListener('mouseenter', () => sfx('hover'));
    b.addEventListener('click', () => { sfx('click'); onClick(); });
    return b;
  }

  _focusFirst(menu) {
    menu.querySelector('.ams-btn, .ams-input')?.focus();
  }

  /** arrow/tab cycling + Enter activate + optional Esc cancel, per overlay */
  _bindKeys(ov, menu, onEscape) {
    const handler = (e) => {
      if (this._stack[this._stack.length - 1] !== ov) return; // top-most only
      if (e.key === 'Escape') {
        if (onEscape) { e.preventDefault(); e.stopPropagation(); onEscape(); }
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) return;
      const items = [...menu.querySelectorAll('.ams-btn:not([disabled]), .ams-input')];
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'Enter') {
        if (document.activeElement?.classList?.contains('ams-btn')) {
          e.preventDefault();
          document.activeElement.click();
        }
        return;
      }
      e.preventDefault();
      const dir = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
      const next = items[(idx + dir + items.length) % items.length] || items[0];
      next.focus();
      sfx('hover');
    };
    window.addEventListener('keydown', handler, true);
    ov.__amsUnbind = () => window.removeEventListener('keydown', handler, true);
  }
}
