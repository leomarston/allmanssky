// Sunward Kin shipwright hangar — full-screen holographic ship-select overlay.
// Live 3D thumbnails of every offered hull (one shared WebGL renderer blitted
// into a 2D canvas per card), grade badges, stat bars compared against the
// ship you fly, trade-in credit, and the buy flow.
// CONTRACT: new ShipyardUI(gameState) → .open(locationKey, opts={title}) .close() .isOpen
import * as THREE from 'three';
import { buildShip } from '../render/shipmesh.js';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';
import { FACTIONS } from '../universe/lore.js';
import {
  SHIP_CLASS_INFO, offersFor, applyShipPurchase, tradeInValue, currentShipStats,
} from '../gameplay/shipmarket.js';

const THUMB_W = 320, THUMB_H = 190;
const CAM_DIR = new THREE.Vector3(0.62, 0.34, 0.71).normalize();

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** Inject the shipyard stylesheet once (theme vars from src/ui/style.css). */
function ensureStyles() {
  if (document.getElementById('ams-shipyard-css')) return;
  const st = document.createElement('style');
  st.id = 'ams-shipyard-css';
  st.textContent = `
.sy-overlay { justify-content: flex-start; padding: 22px clamp(14px, 3.4vw, 44px) 14px; z-index: 70; }
.sy-frame { width: min(1280px, 100%); margin: 0 auto; height: 100%; display: flex; flex-direction: column; gap: 13px; }
.sy-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
.sy-kicker { color: var(--ui-amber); }
.sy-title { margin-top: 5px; font-size: 27px; font-weight: 200; letter-spacing: .3em; color: #eafbff; text-transform: uppercase; text-shadow: 0 0 18px rgba(125,232,255,.55); }
.sy-sub { margin-top: 6px; max-width: 660px; font-size: 10px; letter-spacing: .16em; color: var(--ui-dim); text-transform: uppercase; }
.sy-lumens { display: flex; align-items: baseline; gap: 8px; padding: 10px 18px; font-size: 17px; font-weight: 300; color: #ffe9cf; text-shadow: 0 0 10px rgba(255,180,84,.45); }
.sy-lumens .mark { color: var(--ui-amber); }
.sy-offers { flex: 1 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 13px; align-items: stretch; }
@media (max-width: 1000px) { .sy-offers { grid-template-columns: repeat(2, 1fr); } }
.sy-card { display: flex; flex-direction: column; gap: 7px; padding: 9px 11px 11px; animation: ams-slide-up .5s ease-out backwards; }
.sy-card[data-grade="S"] { border-color: rgba(255,215,106,.45); box-shadow: 0 0 26px rgba(255,190,80,.14), inset 0 0 24px rgba(255,215,106,.05); }
.sy-card[data-grade="A"] { border-color: rgba(125,232,255,.5); }
.sy-thumb-wrap { position: relative; border: 1px solid rgba(125,232,255,.16); background: radial-gradient(130% 110% at 50% 0%, rgba(22,52,70,.55), rgba(2,7,12,.92)); }
.sy-thumb { display: block; width: 100%; height: auto; }
.sy-grade { position: absolute; top: 7px; right: 7px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; border: 1px solid currentColor; background: rgba(3,9,14,.78); }
.sy-grade[data-grade="S"] { color: #ffd76a; box-shadow: 0 0 14px rgba(255,215,106,.6), inset 0 0 8px rgba(255,215,106,.25); }
.sy-grade[data-grade="A"] { color: var(--ui-cyan); box-shadow: 0 0 10px rgba(125,232,255,.45); }
.sy-grade[data-grade="B"] { color: #eafbff; }
.sy-grade[data-grade="C"] { color: var(--ui-dim); }
.sy-class { position: absolute; left: 8px; bottom: 6px; color: var(--ui-cyan); text-shadow: 0 1px 5px rgba(0,0,0,.9); }
.sy-name { font-size: 14px; letter-spacing: .05em; color: #f4fcff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sy-blurb { font-size: 9.5px; line-height: 1.4; min-height: 27px; color: var(--ui-dim); letter-spacing: .04em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sy-stats { display: flex; flex-direction: column; gap: 5px; margin-top: 1px; }
.sy-stat { display: grid; grid-template-columns: 42px 1fr 36px; align-items: center; gap: 7px; font-size: 9px; }
.sy-stat .lab { color: var(--ui-dim); letter-spacing: .14em; }
.sy-stat .track { position: relative; height: 5px; background: rgba(6,14,20,.9); border: 1px solid rgba(125,232,255,.15); }
.sy-stat .fill { position: absolute; top: 0; bottom: 0; left: 0; background: currentColor; box-shadow: 0 0 7px currentColor; }
.sy-stat .ref { position: absolute; top: -2px; bottom: -2px; width: 1px; background: rgba(234,251,255,.8); box-shadow: 0 0 4px rgba(125,232,255,.9); }
.sy-stat .delta { text-align: right; font-variant-numeric: tabular-nums; letter-spacing: .04em; }
.sy-price { display: flex; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 6px; font-size: 9.5px; letter-spacing: .08em; color: var(--ui-dim); text-transform: uppercase; }
.sy-price b { color: var(--ui-amber); font-weight: 600; }
.sy-price b.good { color: var(--ui-green); }
.sy-buy { min-width: 0; width: 100%; padding: 9px 8px; font-size: 11px; letter-spacing: .16em; }
.sy-owned { padding: 9px 8px; text-align: center; font-size: 11px; letter-spacing: .22em; color: var(--ui-green); border: 1px solid rgba(125,255,180,.35); text-transform: uppercase; }
.sy-current { display: flex; align-items: center; gap: 18px; padding: 11px 16px; }
.sy-cur-thumb { flex: none; width: 208px; border: 1px solid rgba(125,232,255,.16); background: radial-gradient(130% 110% at 50% 0%, rgba(22,52,70,.5), rgba(2,7,12,.92)); }
.sy-cur-thumb canvas { display: block; width: 100%; height: auto; }
.sy-cur-id { flex: 0 1 250px; min-width: 170px; }
.sy-cur-id .sy-name { font-size: 16px; margin-top: 4px; }
.sy-cur-class { margin-top: 5px; display: flex; align-items: center; gap: 8px; font-size: 10px; letter-spacing: .16em; color: var(--ui-cyan); text-transform: uppercase; }
.sy-cur-class .sy-grade { position: static; width: 20px; height: 20px; font-size: 11px; }
.sy-cur-stats { flex: 1; display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.sy-cur-stat .ams-label { font-size: 9px; }
.sy-cur-stat .val { margin-top: 4px; font-size: 15px; font-weight: 300; color: #eafbff; font-variant-numeric: tabular-nums; }
.sy-cur-trade { flex: none; text-align: right; }
.sy-cur-trade .val { margin-top: 4px; font-size: 17px; font-weight: 300; color: var(--ui-green); text-shadow: 0 0 10px rgba(125,255,180,.35); }
.sy-cur-trade .note { margin-top: 3px; font-size: 8px; letter-spacing: .18em; color: var(--ui-dim); text-transform: uppercase; }
.sy-foot { flex: none; text-align: center; font-size: 9px; letter-spacing: .28em; color: rgba(127,163,180,.6); text-transform: uppercase; padding-bottom: 2px; }
`;
  document.head.appendChild(st);
}

export class ShipyardUI {
  /** @param {import('../gameplay/state.js').GameState} gs */
  constructor(gs) {
    this.gs = gs;
    this.root = null;
    this.offers = [];
    /** true once every hangar thumbnail has drawn at least one frame */
    this.thumbnailsReady = false;
    this._thumbs = [];
    this._renderer = null;
    this._raf = 0;
    this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
    this._frame = (now) => {
      if (!this.root) return;
      const t = now * 0.001;
      for (const th of this._thumbs) this._renderThumb(th, t);
      if (this._thumbs.length) this.thumbnailsReady = true;
      this._raf = requestAnimationFrame(this._frame);
    };
  }

  get isOpen() { return !!this.root; }

  /**
   * Open the hangar for a location. Same key → same deterministic offers.
   * @param {string} locationKey e.g. station id or 'outpost:<planet>:<cell>'
   * @param {{title?: string, count?: number}} [opts]
   */
  open(locationKey, opts = {}) {
    if (this.root) return;
    this.locationKey = locationKey;
    this.offers = offersFor(locationKey, opts.count ?? 4);
    ensureStyles();
    audio.sfx('dock');
    const r = document.createElement('div');
    r.className = 'ams-overlay sy-overlay';
    r.innerHTML = `
      <div class="ams-scanlines"></div>
      <div class="sy-frame">
        <header class="sy-head">
          <div>
            <div class="ams-label sy-kicker">SUNWARD KIN · HULL EXCHANGE</div>
            <div class="sy-title">${esc(opts.title || 'Shipwright Hangar')}</div>
            <div class="sy-sub">${esc(FACTIONS.sunward?.blurb ?? 'Every hull has a name, and every name is owed a story.')}</div>
          </div>
          <div class="ams-panel sy-lumens"><span class="mark">⌾</span><b id="sy-lum"></b><span class="ams-label">lumens</span></div>
        </header>
        <main class="sy-offers" id="sy-offers"></main>
        <section class="ams-panel sy-current" id="sy-current"></section>
        <footer class="sy-foot">ESC — LEAVE HANGAR</footer>
      </div>`;
    document.getElementById('ui-root').appendChild(r);
    this.root = r;
    this._initGL();
    this._render();
    window.addEventListener('keydown', this._onKey);
    this._raf = requestAnimationFrame(this._frame);
  }

  close() {
    if (!this.root) return;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKey);
    this._disposeThumbs();
    this._envTex?.dispose(); this._envTex = null;
    this._renderer?.dispose(); this._renderer = null;
    this._scene = null; this._camera = null;
    this.root.remove();
    this.root = null;
    this.thumbnailsReady = false;
    audio.sfx('click');
  }

  /* ------------------------------------------------------------- 3D thumbs */

  /** Shared offscreen renderer + hangar lighting rig + studio reflections. */
  _initGL() {
    const rend = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    rend.setSize(THUMB_W, THUMB_H, false);
    rend.outputColorSpace = THREE.SRGBColorSpace;
    rend.toneMapping = THREE.ACESFilmicToneMapping;
    rend.toneMappingExposure = 1.28;
    this._renderer = rend;

    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(new THREE.Color(1.0, 0.92, 0.8), 5.2);
    key.position.set(5, 8, 8);
    const rim = new THREE.DirectionalLight(new THREE.Color(0.45, 0.8, 1.0), 3.8);
    rim.position.set(-7, 3, -9);
    const kicker = new THREE.DirectionalLight(new THREE.Color(1.0, 0.55, 0.3), 1.8);
    kicker.position.set(8, 2, -5);
    const under = new THREE.DirectionalLight(new THREE.Color(0.45, 0.55, 0.7), 1.1);
    under.position.set(0, -6, 4);
    scene.add(key, rim, kicker, under, new THREE.HemisphereLight(0x33445a, 0x0a0910, 0.9));
    this._scene = scene;
    this._camera = new THREE.PerspectiveCamera(38, THUMB_W / THUMB_H, 0.01, 200);

    // one-time studio environment so metallic paint reads (no external assets)
    const envScene = new THREE.Scene();
    const trash = [];
    const panel = (color, w, h, set) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      set(m);
      envScene.add(m);
      trash.push(geo, mat);
    };
    panel(new THREE.Color(0.9, 0.88, 0.8), 20, 20, (m) => { m.position.y = 8; m.rotation.x = Math.PI / 2; });
    panel(new THREE.Color(0.7, 0.45, 0.28), 10, 14, (m) => { m.position.set(9, 2, -4); m.rotation.y = -Math.PI / 2.4; });
    panel(new THREE.Color(0.2, 0.42, 0.62), 12, 12, (m) => { m.position.set(-9, 1, 3); m.rotation.y = Math.PI / 2.6; });
    const shellGeo = new THREE.SphereGeometry(30, 16, 12);
    const shellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.03, 0.045), side: THREE.BackSide });
    envScene.add(new THREE.Mesh(shellGeo, shellMat));
    trash.push(shellGeo, shellMat);
    const pmrem = new THREE.PMREMGenerator(rend);
    this._envTex = pmrem.fromScene(envScene, 0.12).texture;
    pmrem.dispose();
    for (const x of trash) x.dispose();
    scene.environment = this._envTex;
  }

  /** Build a ship + holo pedestal and bind it to a card canvas. */
  _addThumb(canvas, seed, cls, yaw) {
    const build = buildShip(seed, cls);
    for (const g of build.engineGlows) g.material.emissiveIntensity = 4.2;
    const holder = new THREE.Group();
    holder.add(build.group);
    const box = new THREE.Box3().setFromObject(build.group);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fitR = sphere.center.length() + sphere.radius; // safe under y-rotation
    const extras = [];
    const mkDisc = (geo, opacity) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0x7de8ff, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = box.min.y - 0.06;
      holder.add(m);
      extras.push(geo, mat);
    };
    mkDisc(new THREE.RingGeometry(sphere.radius * 0.9, sphere.radius * 0.97, 48), 0.55);
    mkDisc(new THREE.RingGeometry(sphere.radius * 0.42, sphere.radius * 0.44, 40), 0.28);
    mkDisc(new THREE.CircleGeometry(sphere.radius * 0.9, 48), 0.08);
    // ships are wide and flat — fit against the horizontal frustum, not the
    // (much tighter) vertical one, so hulls fill the card
    const vHalf = THREE.MathUtils.degToRad(this._camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * (THUMB_W / THUMB_H));
    this._thumbs.push({
      build, holder, extras,
      canvas, ctx: canvas.getContext('2d'),
      yaw, lookY: sphere.center.y * 0.55,
      dist: (fitR * 0.94) / Math.sin(hHalf),
    });
  }

  _renderThumb(th, t) {
    th.build.group.rotation.y = th.yaw + t * 0.35;
    this._scene.add(th.holder);
    const cam = this._camera;
    cam.position.set(CAM_DIR.x * th.dist, CAM_DIR.y * th.dist + th.lookY, CAM_DIR.z * th.dist);
    cam.lookAt(0, th.lookY, 0);
    this._renderer.render(this._scene, cam);
    th.ctx.clearRect(0, 0, th.canvas.width, th.canvas.height);
    th.ctx.drawImage(this._renderer.domElement, 0, 0);
    this._scene.remove(th.holder);
  }

  _disposeThumbs() {
    for (const th of this._thumbs) {
      th.build.dispose();
      for (const x of th.extras) x.dispose();
    }
    this._thumbs = [];
    this.thumbnailsReady = false;
  }

  /* ------------------------------------------------------------------ DOM */

  /** (Re)build offer cards + the YOUR SHIP panel. Called again after a buy. */
  _render() {
    if (!this.root) return;
    this._disposeThumbs();
    const gs = this.gs;
    const cur = currentShipStats(gs.ship);
    const credit = tradeInValue(gs.ship);
    this.root.querySelector('#sy-lum').textContent = fmt(gs.lumens ?? 0);

    const offersEl = this.root.querySelector('#sy-offers');
    offersEl.innerHTML = '';
    this.offers.forEach((offer, i) => {
      offersEl.appendChild(this._card(offer, cur, credit, i));
    });
    this._currentPanel(cur, credit);
  }

  /** One hangar offer card with live thumbnail + comparison bars. */
  _card(offer, cur, credit, i) {
    const gs = this.gs;
    const info = SHIP_CLASS_INFO[offer.class] ?? SHIP_CLASS_INFO.swift;
    const s = offer.stats;
    const owned = gs.ship?.seed === offer.seed && gs.ship?.class === offer.class;
    const net = Math.max(0, offer.price - credit);
    const afford = (gs.lumens ?? 0) >= net;

    const card = document.createElement('div');
    card.className = 'ams-panel sy-card';
    card.dataset.grade = s.grade;
    card.style.animationDelay = `${i * 0.06}s`;
    card.innerHTML = `
      <div class="sy-thumb-wrap">
        <canvas class="sy-thumb" width="${THUMB_W}" height="${THUMB_H}"></canvas>
        <span class="sy-grade" data-grade="${s.grade}">${s.grade}</span>
        <span class="ams-label sy-class">${esc(info.label)} · ${esc(info.role)}</span>
      </div>
      <div class="sy-name" title="${esc(offer.name)}">${esc(offer.name)}</div>
      <div class="sy-blurb">${esc(info.blurb)}</div>
      <div class="sy-stats">
        ${this._statRow('SPEED', s.maxSpeedMult, cur.maxSpeedMult, 'pct')}
        ${this._statRow('HULL', s.hullMax, cur.hullMax, 'flat')}
        ${this._statRow('SHIELD', s.shieldMax, cur.shieldMax, 'flat')}
        ${this._statRow('CARGO', s.cargoBonus, cur.cargoBonus, 'flat')}
        ${this._statRow('AGILITY', s.agility, cur.agility, 'pct')}
      </div>
      <div class="sy-price">
        <span>PRICE <b>⌾ ${fmt(offer.price)}</b></span>
        <span>TRADE-IN <b class="good">−⌾ ${fmt(credit)}</b></span>
      </div>`;

    if (owned) {
      const tag = document.createElement('div');
      tag.className = 'sy-owned';
      tag.textContent = 'IN SERVICE';
      card.appendChild(tag);
    } else {
      const btn = document.createElement('button');
      btn.className = 'ams-btn sy-buy';
      btn.innerHTML = `<span>BUY — ⌾ ${fmt(net)}</span>`;
      if (!afford) btn.disabled = true;
      btn.onclick = () => {
        if (!applyShipPurchase(gs, offer)) { audio.sfx('deny'); return; }
        audio.sfx('confirm');
        events.emit('notify', { text: `SHIP TRANSFERRED — ${offer.name.toUpperCase()}`, tone: 'good' });
        this._render();
      };
      card.appendChild(btn);
    }

    this._addThumb(card.querySelector('canvas'), offer.seed, offer.class, 2.45 + i * 0.16);
    return card;
  }

  /** Comparative stat bar: fill = offer, tick = your ship; green better, red worse. */
  _statRow(label, value, curValue, kind) {
    const lim = Math.max(value, curValue, 1e-6) * 1.18;
    const better = value > curValue * 1.01;
    const worse = value < curValue * 0.99;
    const color = better ? 'var(--ui-green)' : worse ? 'var(--ui-red)' : 'var(--ui-cyan)';
    let delta;
    if (!better && !worse) delta = '—';
    else if (kind === 'pct') {
      delta = curValue > 1e-6
        ? `${value >= curValue ? '+' : ''}${Math.round(((value - curValue) / curValue) * 100)}%`
        : `+${Math.round(value * 100)}%`;
    } else delta = `${value >= curValue ? '+' : ''}${Math.round(value - curValue)}`;
    return `
      <div class="sy-stat">
        <span class="lab">${label}</span>
        <span class="track">
          <span class="fill" style="width:${Math.round((value / lim) * 100)}%;color:${color};"></span>
          <span class="ref" style="left:${Math.round((curValue / lim) * 100)}%;"></span>
        </span>
        <span class="delta" style="color:${color};">${delta}</span>
      </div>`;
  }

  /** Bottom strip: the ship you fly now, its stats, and its trade-in value. */
  _currentPanel(cur, credit) {
    const gs = this.gs;
    const info = SHIP_CLASS_INFO[cur.class] ?? SHIP_CLASS_INFO.swift;
    const el = this.root.querySelector('#sy-current');
    el.innerHTML = `
      <div class="sy-cur-thumb"><canvas width="${THUMB_W}" height="${THUMB_H}"></canvas></div>
      <div class="sy-cur-id">
        <div class="ams-label" style="color:var(--ui-amber);">YOUR SHIP</div>
        <div class="sy-name" title="${esc(gs.ship?.name ?? '')}">${esc(gs.ship?.name ?? 'Unnamed Hull')}</div>
        <div class="sy-cur-class">${esc(info.label)} · ${esc(info.role)}
          <span class="sy-grade" data-grade="${cur.grade}">${cur.grade}</span></div>
      </div>
      <div class="sy-cur-stats">
        ${[['SPEED', `${cur.maxSpeedMult.toFixed(2)}×`], ['HULL', fmt(cur.hullMax)],
    ['SHIELD', fmt(cur.shieldMax)], ['CARGO', `+${cur.cargoBonus}`],
    ['AGILITY', `${cur.agility.toFixed(2)}×`]]
    .map(([l, v]) => `<div class="sy-cur-stat"><div class="ams-label">${l}</div><div class="val">${v}</div></div>`).join('')}
      </div>
      <div class="sy-cur-trade">
        <div class="ams-label">TRADE-IN VALUE</div>
        <div class="val">⌾ ${fmt(credit)}</div>
        <div class="note">credited against any hull</div>
      </div>`;
    this._addThumb(el.querySelector('canvas'), gs.ship?.seed ?? 1, cur.class, 2.6);
  }
}
