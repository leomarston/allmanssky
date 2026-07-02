// Exosuit interface — cargo hold, Arcforge fabricator, and Wayfarer dossier.
// CONTRACT (unchanged): new InventoryUI(gameState) → .open() .close() .toggle()
// .isOpen — Tab/Esc are handled by the main loop, which calls .close()/.toggle().
// Consumables keep their behaviors: stimgel +50 health, aegiscell full shield,
// oxylite +25 O2, pyrene ×5 → ship fuel +34%. Crafting goes through gameState
// (hasItems / removeItems / addItem) from RECIPES.
import { ITEMS, RECIPES, UPGRADES } from '../gameplay/items.js';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

// ---------------------------------------------------------------------------
// Procedural item icons — one offscreen canvas per item id (+size), cached in
// a module-level Map and blitted into fresh canvases for each DOM placement.
// Shape language by category: element→faceted crystal, precious→cut gem,
// compound→circuit ingot, consumable→vial, exotic→orb, artifact→star shard.
// ---------------------------------------------------------------------------
const ICON_CACHE = new Map();

const A = (hex, a) => hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function tracePoly(g, pts) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

/** faint fill + double glow stroke of a closed polygon */
function glowPoly(g, pts, color, u, lw) {
  tracePoly(g, pts);
  g.shadowColor = color;
  g.shadowBlur = u * 0.5;
  g.fillStyle = A(color, 0.15);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.stroke();
  g.stroke();
  g.shadowBlur = 0;
}

function facet(g, color, lw, segs) {
  g.strokeStyle = A(color, 0.5);
  g.lineWidth = lw * 0.55;
  g.beginPath();
  for (const [[x0, y0], [x1, y1]] of segs) { g.moveTo(x0, y0); g.lineTo(x1, y1); }
  g.stroke();
}

function drawCrystal(g, u, color, lw) {
  const P = [[0, -1.02], [0.5, -0.4], [0.4, 0.6], [0, 1.0], [-0.4, 0.6], [-0.5, -0.4]]
    .map(([x, y]) => [x * u, y * u]);
  glowPoly(g, P, color, u, lw);
  facet(g, color, lw, [[P[0], P[3]], [P[0], P[2]], [P[0], P[4]]]);
}

function drawGem(g, u, color, lw) {
  const P = [[-0.55, -0.55], [0.55, -0.55], [0.85, -0.1], [0, 0.9], [-0.85, -0.1]]
    .map(([x, y]) => [x * u, y * u]);
  glowPoly(g, P, color, u, lw);
  const gl = [[-0.85, -0.1], [0.85, -0.1]].map(([x, y]) => [x * u, y * u]);
  const m0 = [-0.28 * u, -0.1 * u];
  const m1 = [0.28 * u, -0.1 * u];
  facet(g, color, lw, [
    [gl[0], gl[1]],
    [P[0], m0], [P[1], m1],
    [m0, P[3]], [m1, P[3]],
  ]);
}

function drawCompound(g, u, color, lw) {
  g.beginPath();
  g.roundRect(-0.72 * u, -0.5 * u, 1.44 * u, 1.0 * u, 0.09 * u);
  g.shadowColor = color;
  g.shadowBlur = u * 0.45;
  g.fillStyle = A(color, 0.12);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.stroke();
  g.stroke();
  g.shadowBlur = 0;
  // circuit traces + pads
  g.strokeStyle = A(color, 0.65);
  g.lineWidth = lw * 0.55;
  g.beginPath();
  g.moveTo(-0.72 * u, -0.24 * u); g.lineTo(-0.2 * u, -0.24 * u); g.lineTo(-0.2 * u, 0.02 * u);
  g.moveTo(0.72 * u, 0.24 * u); g.lineTo(0.22 * u, 0.24 * u); g.lineTo(0.22 * u, -0.02 * u);
  g.moveTo(-0.72 * u, 0.26 * u); g.lineTo(-0.44 * u, 0.26 * u);
  g.moveTo(0.72 * u, -0.26 * u); g.lineTo(0.44 * u, -0.26 * u);
  g.stroke();
  g.fillStyle = color;
  for (const [x, y] of [[-0.2, 0.06], [0.22, -0.06], [-0.44, 0.26], [0.44, -0.26]]) {
    g.beginPath(); g.arc(x * u, y * u, 0.055 * u, 0, Math.PI * 2); g.fill();
  }
  // core die
  g.strokeStyle = color;
  g.lineWidth = lw * 0.7;
  g.strokeRect(-0.1 * u, -0.1 * u, 0.2 * u, 0.2 * u);
}

function drawVial(g, u, color, lw) {
  const w = 0.26 * u, top = -0.9 * u, by = 0.5 * u;
  const tube = () => {
    g.beginPath();
    g.moveTo(-w, top); g.lineTo(-w, by);
    g.arc(0, by, w, Math.PI, 0, true);
    g.lineTo(w, top);
  };
  // liquid
  g.beginPath();
  g.moveTo(-w, 0); g.lineTo(-w, by);
  g.arc(0, by, w, Math.PI, 0, true);
  g.lineTo(w, 0);
  g.closePath();
  g.fillStyle = A(color, 0.42);
  g.shadowColor = color;
  g.shadowBlur = u * 0.4;
  g.fill();
  g.shadowBlur = 0;
  // meniscus
  g.strokeStyle = A(color, 0.95);
  g.lineWidth = lw * 0.6;
  g.beginPath(); g.moveTo(-w, 0); g.lineTo(w, 0); g.stroke();
  // glass
  tube();
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.shadowColor = color;
  g.shadowBlur = u * 0.4;
  g.stroke();
  g.shadowBlur = 0;
  // lip
  g.beginPath(); g.moveTo(-0.38 * u, top); g.lineTo(0.38 * u, top);
  g.lineWidth = lw * 0.9; g.stroke();
  // bubbles
  g.strokeStyle = A(color, 0.7);
  g.lineWidth = lw * 0.45;
  for (const [x, y, r] of [[-0.08, 0.3, 0.05], [0.09, 0.15, 0.035]]) {
    g.beginPath(); g.arc(x * u, y * u, r * u, 0, Math.PI * 2); g.stroke();
  }
}

function drawOrb(g, u, color, lw) {
  const grad = g.createRadialGradient(-0.22 * u, -0.26 * u, 0.05 * u, 0, 0, 0.8 * u);
  grad.addColorStop(0, A(color, 0.5));
  grad.addColorStop(0.55, A(color, 0.14));
  grad.addColorStop(1, A(color, 0.03));
  g.beginPath(); g.arc(0, 0, 0.78 * u, 0, Math.PI * 2);
  g.fillStyle = grad; g.fill();
  g.shadowColor = color; g.shadowBlur = u * 0.5;
  g.strokeStyle = color; g.lineWidth = lw;
  g.stroke(); g.stroke();
  g.shadowBlur = 0;
  // inner partial ring
  g.strokeStyle = A(color, 0.7);
  g.lineWidth = lw * 0.55;
  g.beginPath(); g.arc(0, 0, 0.48 * u, -2.2, 1.1); g.stroke();
  // core
  g.fillStyle = color;
  g.shadowColor = color; g.shadowBlur = u * 0.45;
  g.beginPath(); g.arc(0, 0, 0.16 * u, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
}

function drawShard(g, u, color, lw) {
  const P = [
    [0, -1.02], [0.18, -0.18], [0.8, 0], [0.18, 0.18],
    [0, 1.02], [-0.18, 0.18], [-0.8, 0], [-0.18, -0.18],
  ].map(([x, y]) => [x * u, y * u]);
  glowPoly(g, P, color, u, lw);
  g.fillStyle = color;
  g.beginPath(); g.arc(0, 0, 0.09 * u, 0, Math.PI * 2); g.fill();
  // sparkle
  g.strokeStyle = A(color, 0.8);
  g.lineWidth = lw * 0.5;
  g.beginPath();
  g.moveTo(0.52 * u, -0.64 * u); g.lineTo(0.52 * u, -0.4 * u);
  g.moveTo(0.4 * u, -0.52 * u); g.lineTo(0.64 * u, -0.52 * u);
  g.stroke();
}

const CATEGORY_DRAW = {
  element: drawCrystal,
  precious: drawGem,
  compound: drawCompound,
  consumable: drawVial,
  exotic: drawOrb,
  artifact: drawShard,
};

function iconCanvas(id, size) {
  const key = `${id}@${size}`;
  const hit = ICON_CACHE.get(key);
  if (hit) return hit;
  const it = ITEMS[id] ?? { color: '#9adcff', category: 'element' };
  const c = document.createElement('canvas');
  const px = size * 2; // 2x for crisp rendering
  c.width = px; c.height = px;
  const g = c.getContext('2d');
  g.translate(px / 2, px / 2);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (it.category === 'element' || it.category === 'precious') {
    g.rotate(((hashId(id) % 9) - 4) * 0.045); // per-id tilt so kin differ
  }
  const u = px * 0.36;
  const lw = Math.max(1.6, px * 0.042);
  (CATEGORY_DRAW[it.category] ?? drawCrystal)(g, u, it.color, lw);
  ICON_CACHE.set(key, c);
  return c;
}

/** blit the cached icon into a fresh display canvas (one per DOM placement) */
function iconEl(id, size) {
  const src = iconCanvas(id, size);
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.style.cssText = `width:${size}px;height:${size}px;display:block;pointer-events:none;`;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// Consumable metadata (behaviors identical to the previous implementation).
// ---------------------------------------------------------------------------
const USE_INFO = {
  stimgel: { label: 'INJECT · +50 INTEGRITY', ready: () => true },
  aegiscell: { label: 'PRIME · AEGIS FIELD FULL', ready: () => true },
  oxylite: { label: 'CRUSH · +25 OXYGEN', ready: () => true },
  pyrene: {
    label: 'FEED TANKS · ×5 → FUEL +34%',
    ready: (gs) => gs.countItem('pyrene') >= 5 && gs.ship.fuel < 1,
    hint: (gs) => (gs.ship.fuel >= 1 ? 'Launch tanks already full.' : 'Requires ×5 Pyrene.'),
  },
};

const TABS = [
  { id: 'cargo', label: 'CARGO HOLD', key: '1' },
  { id: 'fabricate', label: 'FABRICATE', key: '2' },
  { id: 'status', label: 'WAYFARER', key: '3' },
];

const SHIP_CLASS = {
  swift: 'SWIFT-CLASS · EXPLORER', talon: 'TALON-CLASS · FIGHTER',
  dray: 'DRAY-CLASS · HAULER', prospect: 'PROSPECT-CLASS · MINER',
  vanta: 'VANTA-CLASS · EXOTIC',
};

function el(css, html = '') {
  const d = document.createElement('div');
  if (css) d.style.cssText = css;
  if (html) d.innerHTML = html;
  return d;
}

function barHTML(label, val, max, color, unit = '') {
  const pct = max > 0 ? Math.max(0, Math.min(1, val / max)) : 0;
  return `<div class="ams-bar${pct < 0.25 ? ' is-low' : ''}" style="color:${color};">
    <div class="ams-bar-head"><span class="ams-label">${label}</span>
      <span class="ams-bar-value">${Math.round(val)}${unit} / ${Math.round(max)}${unit}</span></div>
    <div class="ams-bar-track"><div class="ams-bar-fill" style="width:${(pct * 100).toFixed(1)}%;"></div></div>
  </div>`;
}

// ---------------------------------------------------------------------------

export class InventoryUI {
  constructor(gs) {
    this.gs = gs;
    this.root = null;
    this.tab = 'cargo';
    this._hoverId = null;
    this._invDirty = false;
  }

  get isOpen() { return !!this.root; }
  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    if (this.root) return;
    audio.sfx('click');
    this.tab = 'cargo';
    const r = el(
      'position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;'
      + 'background:radial-gradient(120% 100% at 50% 0%, rgba(10,26,36,.5), rgba(2,7,12,.78));'
      + 'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:ams-flicker-in .35s ease-out;'
    );
    r.innerHTML = `
      <div class="ams-panel" style="width:min(1060px,94vw);height:min(680px,92vh);display:flex;flex-direction:column;padding:0;overflow:hidden;">
        <div class="ams-scanlines"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end;padding:18px 26px 12px;border-bottom:1px solid rgba(125,232,255,.16);">
          <div>
            <div class="ams-label" style="color:var(--ui-cyan);">AURELIA REACH · WAYFARER INTERFACE</div>
            <div style="font-size:23px;font-weight:200;letter-spacing:.32em;color:#eafbff;text-shadow:0 0 16px rgba(125,232,255,.5);margin-top:2px;">EXOSUIT</div>
          </div>
          <div style="display:flex;gap:28px;align-items:baseline;padding-bottom:2px;">
            <div><span class="ams-label">HOLD&nbsp;&nbsp;</span><span class="ams-value" id="inv-slots" style="font-size:15px;color:#eafbff;"></span></div>
            <div><span class="ams-label" style="color:var(--ui-amber);">LUMENS&nbsp;&nbsp;</span><span class="ams-value" id="inv-lumens" style="font-size:16px;color:#ffe9cf;text-shadow:0 0 10px rgba(255,180,84,.45);"></span></div>
          </div>
        </div>
        <div id="inv-tabs" style="display:flex;gap:2px;padding:8px 26px 0;border-bottom:1px solid rgba(125,232,255,.1);">
          ${TABS.map((t) => `
            <button data-tab="${t.id}" class="inv-tab" style="background:none;border:none;border-bottom:2px solid transparent;color:var(--ui-dim);padding:9px 18px 10px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.2em;text-transform:uppercase;">
              <span style="opacity:.55;font-size:9px;">${t.key}</span>&nbsp; ${t.label}</button>`).join('')}
        </div>
        <div id="inv-body" style="flex:1;display:flex;overflow:hidden;min-height:0;"></div>
        <div style="padding:9px 26px;border-top:1px solid rgba(125,232,255,.12);font-size:9px;letter-spacing:.18em;color:var(--ui-dim);text-transform:uppercase;display:flex;justify-content:space-between;">
          <span>1 / 2 / 3 — consoles · click — use · shift+click — jettison ×10</span>
          <span>TAB / ESC — seal suit</span>
        </div>
      </div>`;
    document.getElementById('ui-root').appendChild(r);
    this.root = r;

    r.querySelectorAll('.inv-tab').forEach((b) => {
      b.onclick = () => this._switchTab(b.dataset.tab);
      b.onmouseenter = () => audio.sfx('hover', { volume: 0.3 });
    });

    this._onInv = () => {
      if (this._invDirty) return;
      this._invDirty = true;
      requestAnimationFrame(() => {
        this._invDirty = false;
        if (this.root) this._renderBody();
      });
    };
    events.on('inventory:changed', this._onInv);

    this._onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'Digit1' || e.code === 'Numpad1') this._switchTab('cargo');
      else if (e.code === 'Digit2' || e.code === 'Numpad2') this._switchTab('fabricate');
      else if (e.code === 'Digit3' || e.code === 'Numpad3') this._switchTab('status');
    };
    window.addEventListener('keydown', this._onKey);

    this._renderBody();
  }

  close() {
    if (!this.root) return;
    events.off('inventory:changed', this._onInv);
    window.removeEventListener('keydown', this._onKey);
    this.root.remove();
    this.root = null;
    this._hoverId = null;
    audio.sfx('click');
  }

  _switchTab(tab) {
    if (!this.root || tab === this.tab) return;
    this.tab = tab;
    audio.sfx('click');
    this._renderBody();
  }

  // ---- rendering (full rebuild only on open / tab switch / inventory:changed)

  _renderBody() {
    if (!this.root) return;
    const gs = this.gs;
    this.root.querySelector('#inv-slots').textContent = `${gs.usedSlots()} / ${gs.maxSlots}`;
    this.root.querySelector('#inv-lumens').textContent = `⌾ ${gs.lumens}`;
    this.root.querySelectorAll('.inv-tab').forEach((b) => {
      const on = b.dataset.tab === this.tab;
      b.style.color = on ? 'var(--ui-cyan)' : 'var(--ui-dim)';
      b.style.borderBottomColor = on ? 'var(--ui-cyan)' : 'transparent';
      b.style.textShadow = on ? '0 0 10px rgba(125,232,255,.55)' : 'none';
    });
    const body = this.root.querySelector('#inv-body');
    body.innerHTML = '';
    if (this.tab === 'cargo') this._renderCargo(body);
    else if (this.tab === 'fabricate') this._renderFabricate(body);
    else this._renderStatus(body);
  }

  // ---- CARGO ----------------------------------------------------------------

  _renderCargo(body) {
    const gs = this.gs;
    const left = el('flex:1;overflow:auto;padding:16px 18px 20px 26px;');
    left.appendChild(el('', '<div class="ams-label" style="color:var(--ui-cyan);">CARGO MANIFEST · MATTER CANISTERS</div>'));
    const grid = el('display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:12px;');
    for (let i = 0; i < gs.maxSlots; i++) {
      const slot = gs.inventory[i];
      grid.appendChild(slot ? this._slotCell(slot) : el(
        'aspect-ratio:1;border:1px dashed rgba(125,232,255,.1);border-radius:2px;background:rgba(6,14,20,.3);'
      ));
    }
    left.appendChild(grid);

    const detail = el('width:300px;flex:none;border-left:1px solid rgba(125,232,255,.14);padding:18px 22px;overflow:auto;background:rgba(4,10,16,.35);');
    detail.id = 'inv-detail';
    body.append(left, detail);
    this._renderDetail(this._hoverId && gs.countItem(this._hoverId) > 0 ? this._hoverId : null);
  }

  _slotCell(slot) {
    const it = ITEMS[slot.id];
    const cell = el(
      `position:relative;aspect-ratio:1;display:flex;align-items:center;justify-content:center;cursor:pointer;`
      + `background:linear-gradient(180deg, rgba(10,22,30,.9), rgba(6,14,20,.7));`
      + `border:1px solid ${A(it.color, 0.27)};border-radius:2px;transition:border-color .12s, box-shadow .12s;`
    );
    cell.dataset.slotId = slot.id;
    cell.appendChild(iconEl(slot.id, 52));
    cell.appendChild(el(`position:absolute;top:3px;left:6px;font-size:8px;letter-spacing:.08em;color:${A(it.color, 0.65)};pointer-events:none;`, it.symbol));
    cell.appendChild(el(
      'position:absolute;bottom:2px;right:6px;font-size:10px;color:#dff4ff;text-shadow:0 1px 3px #000;font-variant-numeric:tabular-nums;pointer-events:none;',
      `${slot.qty}`
    ));
    cell.addEventListener('mouseenter', () => {
      this._hoverId = slot.id;
      audio.sfx('hover', { volume: 0.35 });
      cell.style.borderColor = it.color;
      cell.style.boxShadow = `0 0 12px ${A(it.color, 0.33)}, inset 0 0 12px ${A(it.color, 0.13)}`;
      this._renderDetail(slot.id);
    });
    cell.addEventListener('mouseleave', () => {
      cell.style.borderColor = A(it.color, 0.27);
      cell.style.boxShadow = 'none';
    });
    cell.onclick = (e) => { e.shiftKey ? this._discard(slot.id) : this._use(slot.id); };
    return cell;
  }

  _renderDetail(id) {
    const box = this.root?.querySelector('#inv-detail');
    if (!box) return;
    if (!id || !ITEMS[id]) {
      box.innerHTML = `
        <div class="ams-label" style="margin-top:6px;">MANIFEST QUERY</div>
        <div style="margin-top:14px;font-size:12px;color:var(--ui-dim);line-height:1.7;">
          Pass a glove over a canister to read its manifest.<br><br>
          CLICK — use consumable<br>SHIFT + CLICK — jettison ×10</div>`;
      return;
    }
    const gs = this.gs;
    const it = ITEMS[id];
    box.innerHTML = `
      <div style="display:flex;justify-content:center;padding:10px 0 6px;"></div>
      <div style="text-align:center;font-size:17px;letter-spacing:.14em;color:${it.color};text-shadow:0 0 14px ${A(it.color, 0.4)};text-transform:uppercase;">${it.name}</div>
      <div class="ams-label" style="text-align:center;margin-top:5px;">${it.symbol} · ${it.category}</div>
      <div style="margin-top:14px;font-size:12px;color:#b9d9e8;line-height:1.6;font-style:italic;">${it.desc}</div>
      <div style="margin-top:14px;border-top:1px solid rgba(125,232,255,.14);">
        ${[
          ['UNIT VALUE', `⌾ ${it.value}`],
          ['STACK RATING', `${it.stack}`],
          ['CARRIED', `×${gs.countItem(id)}`],
        ].map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(125,232,255,.08);">
          <span class="ams-label">${k}</span><span class="ams-value" style="font-size:12px;color:#eafbff;">${v}</span></div>`).join('')}
      </div>`;
    box.firstElementChild.appendChild(iconEl(id, 84));

    const use = USE_INFO[id];
    if (use) {
      const ready = use.ready(gs);
      const b = document.createElement('button');
      b.className = 'ams-btn';
      b.style.cssText = 'min-width:0;width:100%;margin-top:16px;padding:10px 8px;font-size:10px;letter-spacing:.16em;';
      b.innerHTML = `<span>${use.label}</span>`;
      if (ready) {
        b.onclick = () => this._use(id);
        b.onmouseenter = () => audio.sfx('hover', { volume: 0.3 });
      } else {
        b.disabled = true;
        box.appendChild(el(
          'margin-top:16px;font-size:10px;color:var(--ui-amber);letter-spacing:.1em;text-align:center;',
          typeof use.hint === 'function' ? use.hint(gs) : (use.hint ?? '')
        ));
      }
      box.appendChild(b);
    }
  }

  // ---- FABRICATE --------------------------------------------------------------

  _renderFabricate(body) {
    const gs = this.gs;
    const wrap = el('flex:1;overflow:auto;padding:16px 26px 22px;');
    wrap.innerHTML = `
      <div class="ams-label" style="color:var(--ui-amber);">ARCFORGE · MOLECULAR FABRICATOR</div>
      <div style="font-size:11px;color:var(--ui-dim);margin-top:4px;">Feed it raw matter. The forge remembers every pattern the Luminel left behind.</div>`;
    const grid = el('display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;');
    for (const r of RECIPES) grid.appendChild(this._recipeCard(r));
    wrap.appendChild(grid);
    body.appendChild(wrap);
  }

  _recipeCard(recipe) {
    const gs = this.gs;
    const out = ITEMS[recipe.out];
    const ok1 = gs.hasItems(recipe.ins);
    const ok5 = gs.hasItems(recipe.ins.map(({ id, qty }) => ({ id, qty: qty * 5 })));

    const card = el(
      `border:1px solid ${ok1 ? 'rgba(125,232,255,.3)' : 'rgba(125,232,255,.12)'};`
      + `background:${ok1 ? 'rgba(10,26,36,.6)' : 'rgba(6,14,20,.45)'};padding:12px 14px 11px;border-radius:2px;`
      + 'display:flex;flex-direction:column;gap:9px;'
    );
    const head = el('display:flex;gap:12px;align-items:flex-start;');
    const ic = el(`flex:none;padding:2px;border:1px solid ${A(out.color, 0.25)};background:rgba(4,10,16,.6);opacity:${ok1 ? 1 : 0.55};`);
    ic.appendChild(iconEl(recipe.out, 40));
    head.appendChild(ic);
    head.appendChild(el('min-width:0;', `
      <div style="font-size:13px;letter-spacing:.1em;color:${ok1 ? out.color : A(out.color, 0.55)};text-transform:uppercase;">
        ${out.name}${recipe.qty > 1 ? ` <span style="color:var(--ui-dim);">×${recipe.qty}</span>` : ''}</div>
      <div style="font-size:10px;color:var(--ui-dim);line-height:1.45;margin-top:3px;font-style:italic;">${out.desc}</div>`));
    card.appendChild(head);

    const chips = el('display:flex;flex-wrap:wrap;gap:5px;');
    chips.innerHTML = recipe.ins.map(({ id, qty }) => {
      const have = gs.countItem(id);
      const enough = have >= qty;
      const it = ITEMS[id];
      return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border:1px solid ${A(it.color, enough ? 0.5 : 0.16)};background:rgba(4,10,16,.6);font-size:10px;letter-spacing:.05em;">
        <span class="ams-value" style="color:${enough ? 'var(--ui-green)' : 'var(--ui-red)'};">${have}/${qty}</span>
        <span style="color:${A(it.color, enough ? 1 : 0.45)};">${it.name}</span></span>`;
    }).join('');
    card.appendChild(chips);

    const row = el('display:flex;gap:6px;justify-content:flex-end;margin-top:auto;');
    row.appendChild(this._miniBtn('CRAFT', ok1, () => this._craft(recipe, 1)));
    row.appendChild(this._miniBtn('×5', ok5, () => this._craft(recipe, 5)));
    card.appendChild(row);
    return card;
  }

  _miniBtn(label, ok, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `background:${ok ? 'rgba(125,232,255,.12)' : 'transparent'};`
      + `border:1px solid ${ok ? 'var(--ui-cyan)' : '#2c3f4a'};color:${ok ? 'var(--ui-cyan)' : '#4e6672'};`
      + `padding:6px 15px;cursor:${ok ? 'pointer' : 'default'};font-family:inherit;font-size:10px;letter-spacing:.18em;text-transform:uppercase;`;
    if (ok) {
      b.onclick = fn;
      b.onmouseenter = () => audio.sfx('hover', { volume: 0.3 });
    } else {
      b.onclick = () => audio.sfx('deny');
    }
    return b;
  }

  // ---- STATUS -------------------------------------------------------------------

  _renderStatus(body) {
    const gs = this.gs;
    const wrap = el('flex:1;overflow:auto;padding:18px 26px 22px;display:grid;grid-template-columns:1fr 1fr;gap:0 32px;align-content:start;');

    // -- left: vitals + augments
    const left = el('display:flex;flex-direction:column;gap:20px;');
    left.appendChild(el('', `
      <div class="ams-label" style="color:var(--ui-cyan);margin-bottom:12px;">WAYFARER DOSSIER · LIFE SYSTEMS</div>
      <div style="display:flex;flex-direction:column;gap:11px;">
        ${barHTML('INTEGRITY', gs.health, gs.healthMax, '#7dffb4')}
        ${barHTML('AEGIS FIELD', gs.shield, gs.shieldMax, '#7de8ff')}
        ${barHTML('OXYGEN RESERVE', gs.oxygen, gs.oxygenMax, '#b8e6ff')}
        ${barHTML('SUIT POWER', gs.energy, gs.energyMax, '#ffb454')}
      </div>`));
    const augs = el('', '<div class="ams-label" style="color:var(--ui-cyan);margin-bottom:8px;">AUGMENT TRACKS</div>');
    for (const [track, def] of Object.entries(UPGRADES)) {
      const lvl = gs.upgrades[track] ?? 0;
      const pips = Array.from({ length: def.max }, (_, i) =>
        `<span style="display:inline-block;width:17px;height:5px;margin-left:3px;background:${i < lvl ? 'var(--ui-cyan)' : '#1c313d'};${i < lvl ? 'box-shadow:0 0 6px rgba(125,232,255,.6);' : ''}"></span>`).join('');
      augs.appendChild(el(
        'display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(125,232,255,.08);',
        `<span style="font-size:12px;color:#cfeeff;letter-spacing:.06em;">${def.name}</span>
         <span style="display:flex;align-items:center;"><span class="ams-label" style="font-size:8px;margin-right:6px;">${lvl >= def.max ? 'MAX' : `LV ${lvl}`}</span>${pips}</span>`
      ));
    }
    left.appendChild(augs);

    // -- right: ship + voyage ledger + discoveries
    const right = el('display:flex;flex-direction:column;gap:18px;');
    const ship = gs.ship;
    right.appendChild(el(
      'border:1px solid rgba(125,232,255,.2);background:rgba(6,14,20,.5);padding:14px 16px 15px;',
      `<div class="ams-label">REGISTERED VESSEL</div>
       <div style="font-size:17px;letter-spacing:.16em;margin-top:4px;color:#eafbff;text-transform:uppercase;text-shadow:0 0 12px rgba(125,232,255,.35);">${ship.name}</div>
       <div style="font-size:9px;color:var(--ui-dim);letter-spacing:.22em;margin-top:3px;">${SHIP_CLASS[ship.class] ?? ship.class.toUpperCase()} · SUNWARD KIN HULL</div>
       <div style="display:flex;flex-direction:column;gap:9px;margin-top:13px;">
         ${barHTML('HULL', ship.hull, ship.hullMax, '#d6f2ff')}
         ${barHTML('LAUNCH FUEL', ship.fuel * 100, 100, '#ffd04a', '%')}
       </div>
       <div style="display:flex;justify-content:space-between;align-items:center;margin-top:11px;">
         <span class="ams-label">VOID CELLS</span>
         <span style="color:#b58cff;font-size:13px;letter-spacing:.24em;text-shadow:0 0 8px rgba(181,140,255,.7);">${ship.warpCells > 0 ? '◈'.repeat(Math.min(ship.warpCells, 8)) : '—'}<span class="ams-value" style="color:var(--ui-dim);font-size:10px;margin-left:7px;">×${ship.warpCells}</span></span>
       </div>`
    ));
    const km = (gs.stats.distanceOnFoot / 1000).toFixed(1);
    right.appendChild(el('', `
      <div class="ams-label" style="color:var(--ui-cyan);margin-bottom:6px;">VOYAGE LEDGER</div>
      ${[
        ['WARP JUMPS', gs.stats.warps],
        ['WORLDS TROD', gs.stats.planetsVisited],
        ['FAUNA SCANNED', gs.stats.creaturesScanned],
        ['DISTANCE ON FOOT', `${km} KM`],
      ].map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(125,232,255,.08);">
        <span class="ams-label">${k}</span><span class="ams-value" style="font-size:12px;color:#eafbff;">${v}</span></div>`).join('')}`));
    const disc = gs.discoveries;
    right.appendChild(el('', `
      <div class="ams-label" style="color:var(--ui-amber);margin-bottom:8px;">UPLOADED DISCOVERIES</div>
      <div style="display:flex;gap:6px;">
        ${[
          ['SYSTEMS', 'systems'], ['WORLDS', 'planets'], ['FAUNA', 'creatures'],
          ['FLORA', 'flora'], ['RUINS', 'ruins'],
        ].map(([label, kind]) => `
          <div style="flex:1;text-align:center;border:1px solid rgba(255,180,84,.2);background:rgba(10,16,10,.0);padding:9px 2px 7px;background:rgba(6,14,20,.5);">
            <div class="ams-value" style="font-size:17px;color:#ffe9cf;text-shadow:0 0 8px rgba(255,180,84,.4);">${Object.keys(disc[kind] ?? {}).length}</div>
            <div class="ams-label" style="font-size:7px;margin-top:3px;">${label}</div>
          </div>`).join('')}
      </div>`));

    wrap.append(left, right);
    body.appendChild(wrap);
  }

  // ---- actions ---------------------------------------------------------------

  /** consumable behaviors — identical mutations to the original implementation */
  _use(id) {
    const gs = this.gs;
    if (id === 'stimgel') {
      if (gs.removeItem(id, 1)) {
        gs.health = Math.min(gs.healthMax, gs.health + 50);
        audio.sfx('confirm');
        events.emit('notify', { text: 'STIM GEL — INTEGRITY +50', tone: 'good' });
      }
    } else if (id === 'aegiscell') {
      if (gs.removeItem(id, 1)) {
        gs.shield = gs.shieldMax;
        audio.sfx('confirm');
        events.emit('notify', { text: 'AEGIS FIELD RESTORED', tone: 'good' });
      }
    } else if (id === 'oxylite') {
      if (gs.removeItem(id, 1)) {
        gs.oxygen = Math.min(gs.oxygenMax, gs.oxygen + 25);
        audio.sfx('confirm');
        events.emit('notify', { text: 'OXYLITE CRUSHED — OXYGEN +25', tone: 'good' });
      }
    } else if (id === 'pyrene') {
      if (gs.countItem('pyrene') >= 5 && gs.ship.fuel < 1) {
        gs.removeItem('pyrene', 5);
        gs.ship.fuel = Math.min(1, gs.ship.fuel + 0.34);
        audio.sfx('confirm');
        events.emit('notify', { text: 'SHIP REFUELED (+34%)', tone: 'good' });
      } else {
        audio.sfx('deny');
      }
    }
  }

  _discard(id) {
    const gs = this.gs;
    const n = Math.min(10, gs.countItem(id));
    if (n > 0 && gs.removeItem(id, n)) {
      audio.sfx('click');
      events.emit('notify', { text: `JETTISONED ${ITEMS[id].name} ×${n}`, tone: 'warn' });
    }
  }

  _craft(recipe, times = 1) {
    const gs = this.gs;
    const ins = times === 1 ? recipe.ins : recipe.ins.map(({ id, qty }) => ({ id, qty: qty * times }));
    if (!gs.hasItems(ins)) { audio.sfx('deny'); return; }
    if (!gs.removeItems(ins)) return;
    gs.addItem(recipe.out, recipe.qty * times);
    audio.sfx('craft');
    events.emit('notify', { text: `ARCFORGE — FABRICATED ${ITEMS[recipe.out].name} ×${recipe.qty * times}`, tone: 'good' });
  }
}
