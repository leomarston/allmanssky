// Galaxy map overlay — holographic 3D local star chart. CONTRACT:
//   new GalaxyMap(galaxy, gameState) → .open() .close() .toggle() .isOpen
//   Selecting a system sets gameState.quests.vesperTarget (J-warp destination).
// Owns its own small WebGLRenderer + RAF loop (never touches the game engine);
// close() cancels the loop and disposes every GL resource it created.
import * as THREE from 'three';
import { audio } from '../audio/audio.js';
import { events } from '../core/events.js';
import { FACTIONS } from '../universe/lore.js';
import { STAR_CLASSES } from '../universe/starsystem.js';

const CYAN = 0x7de8ff;
const AMBER = 0xffb454;
const GREEN = 0x7dffb4;
const MAP_RADIUS = 11;       // scene units the neighbor bubble is scaled into
const SCAN_SECTORS = 4;      // galaxy.neighborsOf radius
const MAX_STARS = 64;        // clarity cap — nearest first (neighborsOf sorts)
const MAX_LINKS = 22;        // center→neighbor route lines: nearest systems only
const Y_FLATTEN = 0.55;      // compress vertical spread so the disc reads well
const CLASS_SCALE = {
  M: 0.62, K: 0.68, G: 0.76, F: 0.82, A: 0.9, B: 1.02, O: 1.18, exotic: 0.95,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function sfx(name) { try { audio.sfx(name); } catch { /* audio not ready */ } }

/** StarStub for an 'sx:sy:sz:i' id via the public sector API (null-safe). */
function stubForId(galaxy, id) {
  try {
    const [sx, sy, sz, i] = String(id).split(':').map(Number);
    if ([sx, sy, sz, i].some(Number.isNaN)) return null;
    return galaxy.starsInSector(sx, sy, sz)[i] ?? null;
  } catch { return null; }
}

/* ---- procedural sprite textures (canvas → CanvasTexture) ------------------ */

/** Star glow: hot white core + wide halo; tint via sprite material color. */
function makeGlowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.09, 'rgba(255,255,255,0.94)');
  grad.addColorStop(0.24, 'rgba(255,255,255,0.4)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Thin glowing circle outline — hover/selection reticle. */
function makeRingTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const h = size / 2;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = size * 0.028;
  g.shadowColor = 'rgba(255,255,255,0.9)';
  g.shadowBlur = size * 0.07;
  g.beginPath();
  g.arc(h, h, size * 0.4, 0, Math.PI * 2);
  g.stroke();
  // four tick marks
  g.lineWidth = size * 0.02;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.beginPath();
    g.moveTo(h + Math.cos(a) * size * 0.44, h + Math.sin(a) * size * 0.44);
    g.lineTo(h + Math.cos(a) * size * 0.5, h + Math.sin(a) * size * 0.5);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Small soft dot — grid-plane feet under each star. */
function makeDotTexture(size = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Polar graticule disc: soft radial fill, concentric rings, faint spokes. */
function makeGridTexture(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const h = size / 2;
  const maxR = size * 0.485;
  const grad = g.createRadialGradient(h, h, 0, h, h, maxR);
  grad.addColorStop(0, 'rgba(96,196,236,0.22)');
  grad.addColorStop(0.5, 'rgba(64,150,200,0.08)');
  grad.addColorStop(1, 'rgba(40,120,180,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(h, h, maxR, 0, Math.PI * 2);
  g.fill();
  for (let i = 1; i <= 10; i++) {
    const r = (maxR * i) / 10;
    const a = (i % 2 ? 0.05 : 0.09) * (1.35 - i / 12);
    g.strokeStyle = `rgba(125,232,255,${a.toFixed(3)})`;
    g.lineWidth = i % 2 ? 1 : 1.7;
    g.beginPath();
    g.arc(h, h, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = 'rgba(125,232,255,0.05)';
  g.lineWidth = 1;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(h + Math.cos(a) * maxR * 0.05, h + Math.sin(a) * maxR * 0.05);
    g.lineTo(h + Math.cos(a) * maxR, h + Math.sin(a) * maxR);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* --------------------------------------------------------------------------- */

export class GalaxyMap {
  constructor(galaxy, gs) {
    this.galaxy = galaxy;
    this.gs = gs;
    this.root = null;
    this._sysCache = new Map(); // starId → StarSystem|null (lazy, fault-tolerant)
  }

  get isOpen() { return !!this.root; }
  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    if (this.root) return;
    sfx('scan');
    try { document.exitPointerLock?.(); } catch { /* not locked */ }
    this._buildData();
    this._buildDom();
    this._buildScene();
    this._bindEvents();
    this._renderCard(this._currentRec);
    this._lastT = performance.now();
    this._elapsed = 0;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this._frame();
    };
    this._raf = requestAnimationFrame(loop);
  }

  close() {
    if (!this.root) return;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('resize', this._onResize);
    sfx('click');
    this._scene?.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
      else m?.dispose?.();
    });
    for (const t of this._textures ?? []) t?.dispose?.();
    try {
      this._renderer?.dispose();
      this._renderer?.forceContextLoss?.();
    } catch { /* context already gone */ }
    this.root.remove();
    this.root = null;
    this._renderer = this._scene = this._camera = this._canvas = null;
    this._records = this._starPos = this._hoverRec = this._cardRec = null;
    this._labels = this._textures = this._vesper = this._pulseRings = null;
    this._pickables = this._currentRec = this._drag = null;
  }

  /* ---- data ---------------------------------------------------------------- */

  _isVisited(id) {
    const v = this.gs.visitedSystems;
    if (Array.isArray(v)) return v.includes(id);
    return !!v?.has?.(id);
  }

  _systemInfo(id) {
    if (this._sysCache.has(id)) return this._sysCache.get(id);
    let sys = null;
    try { sys = this.galaxy.getSystem(id); } catch { sys = null; }
    this._sysCache.set(id, sys);
    return sys;
  }

  _buildData() {
    const id = this.gs.currentSystemId;
    const stub = stubForId(this.galaxy, id);
    const sys = this._systemInfo(id);
    this._currentName = sys?.name ?? stub?.name ?? 'UNKNOWN SYSTEM';
    this._currentRec = {
      stub: stub ?? { id, name: this._currentName, starClass: sys?.star?.class ?? 'G', starColorHex: sys?.star?.colorHex ?? '#ffe3a3' },
      pos: new THREE.Vector3(),
      dist: 0,
      visited: true,
      isCurrent: true,
      base: 0.9,
    };

    let neighbors = [];
    try { neighbors = this.galaxy.neighborsOf(id, SCAN_SECTORS) ?? []; } catch { neighbors = []; }
    neighbors = neighbors.slice(0, MAX_STARS);
    const origin = stub?.pos ?? new THREE.Vector3();
    let maxD = 0.0001;
    let maxFit = 0.0001;
    this._records = neighbors.map((n) => {
      const rel = n.pos.clone().sub(origin);
      const dist = rel.length(); // true sector distance (card + line fade)
      rel.y *= Y_FLATTEN;
      maxD = Math.max(maxD, dist);
      maxFit = Math.max(maxFit, rel.length());
      return { stub: n, rel, dist, visited: this._isVisited(n.id) };
    });
    this._maxDist = maxD;
    const k = MAP_RADIUS / maxFit;
    this._starPos = new Map([[id, this._currentRec.pos]]);
    for (const r of this._records) {
      r.pos = r.rel.multiplyScalar(k);
      this._starPos.set(r.stub.id, r.pos);
    }
  }

  /* ---- DOM ------------------------------------------------------------------ */

  _buildDom() {
    const r = document.createElement('div');
    r.className = 'ams-map3d';
    r.style.cssText = [
      'position:absolute', 'inset:0', 'z-index:40',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:12px',
      'background:radial-gradient(120% 85% at 50% 10%, rgba(12,34,48,.5), transparent 55%),'
        + 'radial-gradient(130% 110% at 50% 110%, rgba(4,10,24,.92), transparent 72%),rgba(2,5,10,.88)',
      'backdrop-filter:blur(7px)', '-webkit-backdrop-filter:blur(7px)',
      'animation:ams-flicker-in .4s ease-out',
    ].join(';');

    // header --------------------------------------------------------------
    const head = document.createElement('div');
    head.style.cssText = 'width:72vw;display:flex;align-items:flex-end;justify-content:space-between;gap:18px;';
    const hLeft = document.createElement('div');
    hLeft.innerHTML = `
      <div class="ams-label" style="color:var(--ui-amber);letter-spacing:.34em;">AURELIA REACH — NAVIGATION ARRAY</div>
      <div style="margin-top:4px;font-size:23px;font-weight:200;letter-spacing:.4em;color:#eafbff;
        text-shadow:0 0 14px rgba(125,232,255,.7),0 0 44px rgba(125,232,255,.3);">LOCAL STAR CHART</div>`;
    const hRight = document.createElement('div');
    hRight.style.cssText = 'display:flex;align-items:center;gap:16px;';
    hRight.innerHTML = `
      <div style="text-align:right;">
        <div class="ams-label">CURRENT SYSTEM</div>
        <div style="font-size:13px;letter-spacing:.22em;color:var(--ui-cyan);text-shadow:0 0 10px rgba(125,232,255,.5);text-transform:uppercase;">${this._currentName}</div>
      </div>`;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close star chart [M]';
    closeBtn.style.cssText = 'width:32px;height:32px;background:rgba(8,20,28,.6);border:1px solid var(--ui-panel-border);'
      + 'color:var(--ui-cyan);font-size:13px;cursor:pointer;transition:box-shadow .18s,border-color .18s;';
    closeBtn.onmouseenter = () => { closeBtn.style.borderColor = 'var(--ui-cyan)'; closeBtn.style.boxShadow = '0 0 14px rgba(125,232,255,.35)'; };
    closeBtn.onmouseleave = () => { closeBtn.style.borderColor = ''; closeBtn.style.boxShadow = ''; };
    closeBtn.onclick = () => this.close();
    hRight.appendChild(closeBtn);
    head.append(hLeft, hRight);

    // viewport --------------------------------------------------------------
    const vp = document.createElement('div');
    vp.className = 'ams-panel';
    vp.style.cssText = 'position:relative;width:72vw;height:72vh;overflow:hidden;'
      + 'background:radial-gradient(95% 95% at 50% 40%, rgba(9,24,36,.9), rgba(2,5,10,.96));';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:grab;touch-action:none;';
    const scan = document.createElement('div');
    scan.className = 'ams-scanlines';
    const labelLayer = document.createElement('div');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';

    const counter = document.createElement('div');
    counter.style.cssText = 'position:absolute;top:12px;left:14px;pointer-events:none;';
    counter.innerHTML = `
      <div class="ams-label" style="color:var(--ui-cyan);">SYSTEMS IN RANGE · ${this._records.length}</div>
      <div class="ams-label" style="margin-top:3px;">SCAN RADIUS · ${SCAN_SECTORS} SECTORS</div>`;

    const legend = document.createElement('div');
    legend.style.cssText = 'position:absolute;left:14px;bottom:12px;pointer-events:none;display:flex;gap:20px;';
    legend.innerHTML = [
      ['#7de8ff', '●', 'CURRENT'],
      ['#ffd98c', '●', 'UNCHARTED'],
      ['#7dffb4', '●', 'VISITED'],
      ['#ffb454', '◆', 'WARP TARGET'],
    ].map(([col, dot, txt]) => `<span class="ams-label"><span style="color:${col};text-shadow:0 0 6px ${col};">${dot}</span> ${txt}</span>`).join('');

    const card = document.createElement('div');
    card.className = 'ams-panel';
    card.style.cssText = 'position:absolute;top:14px;right:14px;width:238px;padding:12px 14px 14px;pointer-events:none;'
      + 'background:rgba(6,16,24,.82);';

    vp.append(canvas, scan, labelLayer, counter, legend, card);

    // footer hints --------------------------------------------------------------
    const foot = document.createElement('div');
    foot.style.cssText = 'width:72vw;text-align:center;padding:7px 0 2px;font-size:10px;letter-spacing:.2em;'
      + 'text-transform:uppercase;color:var(--ui-dim);border-top:1px solid rgba(125,232,255,.14);';
    const key = (k) => `<span style="color:var(--ui-cyan);">${k}</span>`;
    foot.innerHTML = `${key('DRAG')} rotate · ${key('SCROLL')} zoom · ${key('CLICK')} lock warp target · `
      + `${key('J')} warp (1 Void Cell) · ${key('M / ESC')} close`;

    r.append(head, vp, foot);
    (document.getElementById('ui-root') ?? document.body).appendChild(r);
    this.root = r;
    this._viewport = vp;
    this._canvas = canvas;
    this._labelLayer = labelLayer;
    this._card = card;
  }

  _makeLabel(color, opts = {}) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;display:none;'
      + `font-size:${opts.size ?? 10}px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;`
      + `color:${color};text-shadow:0 0 8px ${color};`
      + (opts.pulse ? 'animation:ams-pulse 1.6s ease-in-out infinite;' : '');
    this._labelLayer.appendChild(el);
    return el;
  }

  /* ---- scene ------------------------------------------------------------------ */

  _buildScene() {
    const canvas = this._canvas;
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.setSize(w, h, false);
    this._renderer.setClearColor(0x000000, 0);
    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 400);
    this._yaw = 0.6;
    this._pitch = 0.52;
    this._zoom = 1;
    this._ray = new THREE.Raycaster();
    this._v3 = new THREE.Vector3();

    const glowTex = makeGlowTexture();
    const ringTex = makeRingTexture();
    const dotTex = makeDotTexture();
    const gridTex = makeGridTexture();
    this._textures = [glowTex, ringTex, dotTex, gridTex];

    const cyan = new THREE.Color(CYAN);

    // grid disc -----------------------------------------------------------
    const gridSize = MAP_RADIUS * 2.7;
    const grid = new THREE.Mesh(
      new THREE.PlaneGeometry(gridSize, gridSize),
      new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    grid.rotation.x = -Math.PI / 2;
    grid.renderOrder = 0;
    this._scene.add(grid);

    // 3 explicit depth rings (shared unit-circle geometry, scaled)
    const circlePts = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      circlePts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const circleGeo = new THREE.BufferGeometry().setFromPoints(circlePts);
    [[0.42, 0.34], [0.78, 0.22], [1.16, 0.13]].forEach(([f, op]) => {
      const ring = new THREE.LineLoop(circleGeo, new THREE.LineBasicMaterial({
        color: CYAN, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      ring.scale.setScalar(f * MAP_RADIUS);
      ring.renderOrder = 1;
      this._scene.add(ring);
    });

    // background star dust (seeded LCG — stable screenshots) ----------------
    {
      let s = 0x9e3779b9;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const n = 260;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const th = rnd() * Math.PI * 2;
        const ph = Math.acos(rnd() * 2 - 1);
        const rr = 70 + rnd() * 60;
        pos[i * 3] = rr * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = rr * Math.cos(ph);
        pos[i * 3 + 2] = rr * Math.sin(ph) * Math.sin(th);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const dust = new THREE.Points(geo, new THREE.PointsMaterial({
        map: dotTex, color: 0x9fd0e8, size: 2.2, sizeAttenuation: false,
        transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      dust.renderOrder = 0;
      this._scene.add(dust);
    }

    // connection lines (nearest few) + drop stems + plane feet ---------------
    if (this._records.length) {
      const n = this._records.length;
      const linked = this._records.slice(0, MAX_LINKS); // sorted nearest-first
      const linePos = new Float32Array(linked.length * 6);
      const lineCol = new Float32Array(linked.length * 6);
      const stemPos = new Float32Array(n * 6);
      const stemCol = new Float32Array(n * 6);
      const feetPos = new Float32Array(n * 3);
      linked.forEach((rec, i) => {
        const p = rec.pos;
        const fade = 1 - 0.75 * (rec.dist / this._maxDist);
        const c = cyan.clone().multiplyScalar(0.16 + 0.5 * fade);
        linePos.set([0, 0, 0, p.x, p.y, p.z], i * 6);
        lineCol.set([c.r * 0.2, c.g * 0.2, c.b * 0.2, c.r, c.g, c.b], i * 6);
      });
      this._records.forEach((rec, i) => {
        const p = rec.pos;
        const tint = new THREE.Color(rec.stub.starColorHex || '#ffffff');
        stemPos.set([p.x, p.y, p.z, p.x, 0, p.z], i * 6);
        stemCol.set([tint.r * 0.24, tint.g * 0.24, tint.b * 0.24, tint.r * 0.03, tint.g * 0.03, tint.b * 0.03], i * 6);
        feetPos.set([p.x, 0, p.z], i * 3);
      });
      const mkLines = (pos, col) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
          vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        l.renderOrder = 2;
        return l;
      };
      this._scene.add(mkLines(linePos, lineCol), mkLines(stemPos, stemCol));
      const feetGeo = new THREE.BufferGeometry();
      feetGeo.setAttribute('position', new THREE.BufferAttribute(feetPos, 3));
      const feet = new THREE.Points(feetGeo, new THREE.PointsMaterial({
        map: dotTex, color: CYAN, size: 5, sizeAttenuation: false,
        transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      feet.renderOrder = 2;
      this._scene.add(feet);
    }

    // neighbor stars ---------------------------------------------------------
    this._pickables = [];
    for (const rec of this._records) {
      const color = new THREE.Color(rec.stub.starColorHex || '#ffffff');
      if (rec.visited) color.lerp(new THREE.Color(GREEN), 0.55).multiplyScalar(0.72);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      rec.base = (CLASS_SCALE[rec.stub.starClass] ?? 0.72) * (rec.visited ? 0.85 : 1);
      sprite.scale.set(rec.base, rec.base, 1);
      sprite.position.copy(rec.pos);
      sprite.renderOrder = 3;
      sprite.userData.rec = rec;
      rec.sprite = sprite;
      this._scene.add(sprite);
      this._pickables.push(sprite);
    }

    // current system: white core + cyan halo + pulsing rings ------------------
    {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: CYAN, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      halo.scale.set(3.1, 3.1, 1);
      halo.renderOrder = 3;
      const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      core.scale.set(1.05, 1.05, 1);
      core.renderOrder = 4;
      core.userData.rec = this._currentRec;
      this._currentRec.sprite = core;
      this._currentRec.base = 1.05;
      this._scene.add(halo, core);
      this._pickables.push(core);

      const ringGeo = new THREE.RingGeometry(0.92, 1.0, 64);
      const mkRing = () => {
        const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
          color: CYAN, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
          depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 4;
        this._scene.add(m);
        return m;
      };
      this._pulseRings = [{ mesh: mkRing(), phase: 0 }, { mesh: mkRing(), phase: 0.5 }];
      const still = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: CYAN, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      still.rotation.x = -Math.PI / 2;
      still.scale.setScalar(0.62);
      still.renderOrder = 4;
      this._scene.add(still);
    }

    // hover reticle -----------------------------------------------------------
    this._hoverRing = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ringTex, color: CYAN, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this._hoverRing.visible = false;
    this._hoverRing.renderOrder = 5;
    this._scene.add(this._hoverRing);

    // vesper target marker: pulsing amber diamond + glow -----------------------
    this._vesper = new THREE.Group();
    const dia = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.62)),
      new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    dia.renderOrder = 5;
    const vGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: AMBER, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    vGlow.scale.set(2.0, 2.0, 1);
    vGlow.renderOrder = 4;
    this._vesper.add(dia, vGlow);
    this._vesper.visible = false;
    this._vesperDia = dia;
    this._scene.add(this._vesper);

    // projected DOM labels ------------------------------------------------------
    this._labels = {
      current: this._makeLabel('var(--ui-cyan)'),
      vesper: this._makeLabel('var(--ui-amber)', { pulse: true }),
      hover: this._makeLabel('#eafbff', { size: 11 }),
    };
    this._labels.current.textContent = `${this._currentName} · YOU ARE HERE`;
    this._labels.vesper.textContent = '⟡ VESPER SIGNAL';
  }

  /* ---- input ------------------------------------------------------------------- */

  _bindEvents() {
    const canvas = this._canvas;
    this._drag = null;
    this._hoverRec = null;

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      this._drag = { x: e.clientX, y: e.clientY, moved: 0 };
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this._drag) {
        const dx = e.clientX - this._drag.x;
        const dy = e.clientY - this._drag.y;
        this._drag.moved += Math.abs(dx) + Math.abs(dy);
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
        this._yaw -= dx * 0.0055;
        this._pitch = clamp(this._pitch + dy * 0.005, -1.05, 1.45);
      } else {
        this._setHover(this._pickAt(e.clientX, e.clientY));
      }
    });
    const endDrag = (e) => {
      if (!this._drag) return;
      const wasClick = this._drag.moved < 5;
      this._drag = null;
      canvas.style.cursor = this._hoverRec ? 'pointer' : 'grab';
      if (wasClick) this._select(this._pickAt(e.clientX, e.clientY));
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', () => { this._drag = null; canvas.style.cursor = 'grab'; });
    canvas.addEventListener('pointerleave', () => { if (!this._drag) this._setHover(null); });

    // wheel zoom — swallowed so the game's input singleton never sees it
    this._viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._zoom = clamp(this._zoom * (e.deltaY > 0 ? 0.9 : 1.111), 0.5, 2.5);
    }, { passive: false });

    // M / Esc close — capture phase + stopPropagation so the game loop's
    // actionPressed('map'/'escape') never fires (no reopen, no pause).
    this._onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyM' || e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    window.addEventListener('keydown', this._onKey, true);

    this._onResize = () => {
      if (!this._renderer || !this._canvas) return;
      const w = Math.max(1, this._canvas.clientWidth);
      const h = Math.max(1, this._canvas.clientHeight);
      this._renderer.setSize(w, h, false);
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);
  }

  /** Raycast the star sprites; falls back to nearest-projected within 16 px. */
  _pickAt(clientX, clientY) {
    if (!this._canvas) return null;
    const rect = this._canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    this._ray.setFromCamera(
      { x: (px / rect.width) * 2 - 1, y: -(py / rect.height) * 2 + 1 },
      this._camera,
    );
    const hits = this._ray.intersectObjects(this._pickables, false);
    if (hits.length) return hits[0].object.userData.rec;
    // forgiving screen-space fallback
    let best = null;
    let bestD = 16;
    for (const s of this._pickables) {
      const v = this._v3.copy(s.position).project(this._camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) { bestD = d; best = s.userData.rec; }
    }
    return best;
  }

  _setHover(rec) {
    if (rec === this._hoverRec) return;
    this._hoverRec = rec;
    if (this._canvas) this._canvas.style.cursor = rec ? 'pointer' : 'grab';
    if (rec) {
      sfx('hover');
      this._renderCard(rec);
    }
  }

  _select(rec) {
    if (!rec || rec.isCurrent) return;
    this.gs.quests.vesperTarget = rec.stub.id;
    sfx('confirm');
    events.emit('notify', {
      text: `WARP TARGET LOCKED — ${String(rec.stub.name).toUpperCase()}`,
      tone: 'info',
    });
    this._renderCard(rec); // refresh status row → WARP TARGET
  }

  /* ---- info card ------------------------------------------------------------------ */

  _renderCard(rec) {
    if (!this._card || !rec) return;
    this._cardRec = rec;
    const stub = rec.stub;
    const sys = this._systemInfo(stub.id);
    const clsName = STAR_CLASSES[stub.starClass]?.name ?? 'Unknown';
    const isTarget = this.gs.quests?.vesperTarget === stub.id;
    const [statusTxt, statusCol] = rec.isCurrent ? ['CURRENT SYSTEM', 'var(--ui-cyan)']
      : isTarget ? ['⟡ WARP TARGET', 'var(--ui-amber)']
        : rec.visited ? ['VISITED', 'var(--ui-green)'] : ['UNCHARTED', 'var(--ui-dim)'];
    const faction = sys ? (FACTIONS[sys.faction]?.name ?? 'Unclaimed') : '—';
    const biomes = sys ? [...new Set(sys.planets.map((p) => p.biome))] : [];
    const row = (k, v, col) => `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:6px;">
      <span class="ams-label">${k}</span>
      <span style="font-size:11px;letter-spacing:.08em;text-align:right;color:${col ?? 'var(--ui-ink)'};">${v}</span></div>`;
    this._card.innerHTML = `
      <div class="ams-label" style="color:var(--ui-amber);">SYSTEM DOSSIER</div>
      <div style="margin-top:5px;display:flex;align-items:center;gap:8px;">
        <span style="color:${stub.starColorHex ?? '#fff'};text-shadow:0 0 8px ${stub.starColorHex ?? '#fff'};font-size:13px;">●</span>
        <span style="font-size:14px;font-weight:300;letter-spacing:.16em;color:#eafbff;text-transform:uppercase;
          text-shadow:0 0 10px rgba(125,232,255,.4);">${stub.name}</span>
      </div>
      <div style="height:1px;background:rgba(125,232,255,.18);margin:9px 0 3px;"></div>
      ${row('STATUS', statusTxt, statusCol)}
      ${row('STAR CLASS', `${stub.starClass} · ${clsName}`)}
      ${row('FACTION', faction)}
      ${row('DISTANCE', rec.isCurrent ? '—' : `${rec.dist.toFixed(2)} <span style="color:var(--ui-dim);font-size:9px;">SECTORS</span>`)}
      ${row('PLANETS', sys ? sys.planets.length : 'NO TELEMETRY')}
      ${biomes.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;">${biomes.map((b) => `<span style="border:1px solid rgba(125,232,255,.28);padding:1px 6px;font-size:9px;letter-spacing:.14em;color:var(--ui-dim);text-transform:uppercase;">${b}</span>`).join('')}</div>` : ''}`;
  }

  /* ---- per-frame ------------------------------------------------------------------- */

  _placeLabel(el, worldPos, dyPx) {
    const v = this._v3.copy(worldPos).project(this._camera);
    const w = this._canvas.clientWidth;
    const h = this._canvas.clientHeight;
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h + dyPx;
    if (v.z > 1 || x < -60 || x > w + 60 || y < -30 || y > h + 30) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.left = `${x.toFixed(1)}px`;
    el.style.top = `${y.toFixed(1)}px`;
  }

  _frame() {
    if (!this._renderer) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._lastT) / 1000);
    this._lastT = now;
    this._elapsed += dt;
    const t = this._elapsed;

    // slow idle rotation (pauses while dragging or inspecting)
    if (!this._drag && !this._hoverRec) this._yaw += dt * 0.07;
    const dist = 19 / this._zoom;
    const cp = Math.cos(this._pitch);
    this._camera.position.set(
      dist * cp * Math.sin(this._yaw),
      dist * Math.sin(this._pitch),
      dist * cp * Math.cos(this._yaw),
    );
    this._camera.lookAt(0, 0, 0);

    // sonar pulse rings around the current system
    for (const pr of this._pulseRings) {
      const k = (t * 0.42 + pr.phase) % 1;
      pr.mesh.scale.setScalar(0.6 + k * 2.6);
      pr.mesh.material.opacity = 0.5 * (1 - k);
    }

    // hover/selection sprite scaling (smoothed)
    const vesperId = this.gs.quests?.vesperTarget;
    const ease = 1 - Math.exp(-dt * 14);
    const scaleTo = (rec) => {
      const target = rec === this._hoverRec ? rec.base * 1.55
        : rec.stub.id === vesperId ? rec.base * 1.3 : rec.base;
      const s = rec.sprite.scale.x + (target - rec.sprite.scale.x) * ease;
      rec.sprite.scale.set(s, s, 1);
    };
    for (const rec of this._records) scaleTo(rec);

    // hover reticle
    if (this._hoverRec) {
      this._hoverRing.visible = true;
      this._hoverRing.position.copy(this._hoverRec.pos);
      const rs = this._hoverRec.base * (2.5 + 0.22 * Math.sin(t * 5));
      this._hoverRing.scale.set(rs, rs, 1);
      this._hoverRing.material.rotation = t * 0.8;
      this._placeLabel(this._labels.hover, this._hoverRec.pos, -26 - this._hoverRec.base * 12);
      this._labels.hover.textContent = String(this._hoverRec.stub.name).toUpperCase();
    } else {
      this._hoverRing.visible = false;
      this._labels.hover.style.display = 'none';
    }

    // vesper marker follows gameState each frame (target can change externally)
    const vPos = vesperId != null ? this._starPos.get(vesperId) : null;
    if (vPos) {
      this._vesper.visible = true;
      this._vesper.position.copy(vPos);
      this._vesper.rotation.y = t * 1.2;
      const vs = 1 + 0.16 * Math.sin(t * 4.2);
      this._vesperDia.scale.setScalar(vs);
      this._vesperDia.material.opacity = 0.75 + 0.25 * Math.sin(t * 4.2);
      this._placeLabel(this._labels.vesper, vPos, 36);
    } else {
      this._vesper.visible = false;
      this._labels.vesper.style.display = 'none';
    }
    this._placeLabel(this._labels.current, this._currentRec.pos, 24);

    this._renderer.render(this._scene, this._camera);
  }
}
