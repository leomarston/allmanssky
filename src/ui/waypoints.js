// Waypoint layer: persistent on-screen POI markers fed by the scanner (and
// any quest system). A pooled set of DOM nodes is projected through the
// active camera each frame — glyph per kind, label + live distance, alpha
// and scale falloff with range, and offscreen markers clamped to the screen
// edge as arrows pointing outward. Pure UI: owns only its DOM subtree,
// reads nothing but the camera + marker list it is handed.
//
// CONTRACT:
//   const wp = new WaypointLayer(uiRoot);
//   wp.update(camera, markers)  // markers: [{ id, worldPos:{x,y,z}|Vector3,
//                               //   kind, label, sublabel?, color? }]
//   wp.clear(); wp.dispose();
import * as THREE from 'three';

const MAX_MARKERS = 24;         // pooled DOM nodes — hard cap per frame
const FADE_NEAR = 120;          // full opacity inside this range (m)
const FADE_FAR = 600;           // faint by here
const HIDE_DIST = 800;          // culled beyond this
const EDGE_MARGIN = 36;         // px inset for edge-clamped arrows

const CYAN = '#7de8ff';
const AMBER = '#ffb454';
/** story/lore kinds render amber; everything else defaults cyan */
const STORY_KINDS = new Set(['ruin', 'beacon', 'custom']);

const SW = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
/** inline SVG glyphs, 24×24, currentColor, holographic line style */
const GLYPHS = {
  // crystal deposit — faceted diamond
  node: `<svg viewBox="0 0 24 24"><path d="M12 2.6 19 12l-7 9.4L5 12Z" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 2.6v18.8M5 12h14" ${SW} stroke-width=".7" stroke-opacity=".75"/></svg>`,
  // Luminel ruin — rune arch
  ruin: `<svg viewBox="0 0 24 24" ${SW} stroke-width="1.5"><path d="M5.6 21V10.4C5.6 6.2 8.4 3.8 12 3.8s6.4 2.4 6.4 6.6V21"/><path d="M3.4 21h17.2" stroke-opacity=".8"/><path d="M12 8.3v7M9.4 10.6h5.2" stroke-width="1.2"/></svg>`,
  // beacon — obelisk with light
  beacon: `<svg viewBox="0 0 24 24" ${SW}><path d="M9.6 20.5 10.7 6.4 12 3.2l1.3 3.2 1.1 14.1Z" fill="currentColor" fill-opacity=".14" stroke-width="1.4"/><path d="M6.8 20.5h10.4" stroke-width="1.4"/><path d="M12 3.2V1.2M7.8 5 6.4 3.6M16.2 5l1.4-1.4" stroke-width="1.1" stroke-opacity=".9"/></svg>`,
  // outpost — habitat shell
  outpost: `<svg viewBox="0 0 24 24" ${SW} stroke-width="1.5"><path d="M4.5 11.6 12 5.2l7.5 6.4v8.9h-15Z" fill="currentColor" fill-opacity=".1"/><path d="M10 20.5v-4.8h4v4.8"/><path d="M12 5.2V2.8"/></svg>`,
  // crashed ship — broken wing out of the ground
  crash: `<svg viewBox="0 0 24 24" ${SW}><path d="M2.8 20.6h18.4" stroke-width="1.2" stroke-opacity=".65"/><path d="M6.6 20.6 15.6 5.4l3.2 4.2-7 11Z" fill="currentColor" fill-opacity=".12" stroke-width="1.4"/><path d="m13.7 9.7-2.3 2.5 2.7 1.5-2.3 2.7" stroke-width="1.1"/></svg>`,
  // landing pad — ringed target
  pad: `<svg viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="8.2" stroke-width="1.5"/><circle cx="12" cy="12" r="3" fill="currentColor" fill-opacity=".18" stroke-width="1.1"/><path d="M12 1.6v2.6M12 19.8v2.6M1.6 12h2.6M19.8 12h2.6" stroke-width="1.2"/></svg>`,
  // fauna — paw print
  creature: `<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="15.7" rx="4.7" ry="3.9" fill-opacity=".85"/><circle cx="6" cy="10.6" r="2" fill-opacity=".9"/><circle cx="12" cy="8.2" r="2.1" fill-opacity=".9"/><circle cx="18" cy="10.6" r="2" fill-opacity=".9"/></svg>`,
  // custom / quest — four-point star
  custom: `<svg viewBox="0 0 24 24"><path d="M12 2.8 14 10l7.2 2L14 14 12 21.2 10 14 2.8 12 10 10Z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
};
const ARROW_SVG = `<svg viewBox="0 0 24 24" ${SW} stroke-width="2.6"><path d="m8 4 9 8-9 8"/></svg>`;

const STYLE_ID = 'ams-waypoints-style';
const CSS = `
.ams-wp-layer { position: absolute; inset: 0; overflow: hidden; z-index: 9;
  font-family: var(--ui-font, 'Segoe UI', system-ui, sans-serif); }
.ams-wp { position: absolute; left: 0; top: 0; display: flex; flex-direction: column;
  align-items: center; transform-origin: 0 0; will-change: transform, opacity;
  color: ${CYAN}; white-space: nowrap; }
.ams-wp .wp-pin { position: relative; width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center; }
.ams-wp .wp-pin > svg { width: 20px; height: 20px; display: block;
  filter: drop-shadow(0 0 5px currentColor); }
.ams-wp .wp-pin::before, .ams-wp .wp-pin::after {
  content: ''; position: absolute; width: 7px; height: 7px; opacity: .55; }
.ams-wp .wp-pin::before { left: 0; top: 0;
  border-left: 1px solid currentColor; border-top: 1px solid currentColor; }
.ams-wp .wp-pin::after { right: 0; bottom: 0;
  border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; }
.ams-wp .wp-text { display: flex; flex-direction: column; align-items: center;
  margin-top: 2px; text-align: center; }
.ams-wp .wp-label { font-size: 10px; font-weight: 600; letter-spacing: .18em;
  text-transform: uppercase; color: var(--ui-ink, #d6f2ff);
  text-shadow: 0 0 4px rgba(3, 12, 18, .95), 0 1px 3px rgba(3, 12, 18, .9), 0 0 12px rgba(125, 232, 255, .28); }
.ams-wp .wp-sub { margin-top: 1px; font-size: 8px; letter-spacing: .24em;
  text-transform: uppercase; color: var(--ui-dim, #7fa3b4);
  text-shadow: 0 1px 3px rgba(3, 12, 18, .9); }
.ams-wp .wp-dist { margin-top: 2px; font-size: 10px; letter-spacing: .16em;
  font-variant-numeric: tabular-nums; color: currentColor; opacity: .95;
  text-shadow: 0 0 4px rgba(3, 12, 18, .95), 0 1px 3px rgba(3, 12, 18, .9); }
.ams-wp .wp-arrow { position: absolute; left: 50%; top: 50%; width: 0; height: 0; display: none; }
.ams-wp .wp-arrow > svg { position: absolute; left: 11px; top: -7px; width: 14px; height: 14px;
  filter: drop-shadow(0 0 4px currentColor); }
.ams-wp.is-edge .wp-text { display: none; }
.ams-wp.is-edge .wp-pin { width: 24px; height: 24px; }
.ams-wp.is-edge .wp-pin > svg { width: 13px; height: 13px; }
.ams-wp.is-edge .wp-arrow { display: block; }
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** '142 M' under 1 km, '1.2 KM' beyond */
function fmtDist(d) {
  return d < 1000 ? `${Math.round(d)} M` : `${(d / 1000).toFixed(1)} KM`;
}

const _v = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _cam = new THREE.Vector3();

/**
 * Pooled DOM waypoint markers projected through the game camera.
 * All writes are cached so a stable frame costs only transform updates.
 */
export class WaypointLayer {
  /** @param {HTMLElement} uiRoot the #ui-root overlay element */
  constructor(uiRoot) {
    injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'ams-wp-layer';
    // #ui-root > * gets pointer-events:auto from the theme — never trap clicks
    this.root.style.pointerEvents = 'none';
    uiRoot.appendChild(this.root);
    this._pool = [];
    this._sorted = [];
  }

  _entry(i) {
    let e = this._pool[i];
    if (e) return e;
    const root = document.createElement('div');
    root.className = 'ams-wp';
    root.style.display = 'none';
    const pin = document.createElement('div');
    pin.className = 'wp-pin';
    const arrow = document.createElement('div');
    arrow.className = 'wp-arrow';
    arrow.innerHTML = ARROW_SVG;
    pin.appendChild(arrow);
    const text = document.createElement('div');
    text.className = 'wp-text';
    const label = document.createElement('div');
    label.className = 'wp-label';
    const sub = document.createElement('div');
    sub.className = 'wp-sub';
    const dist = document.createElement('div');
    dist.className = 'wp-dist';
    text.append(label, sub, dist);
    root.append(pin, text);
    this.root.appendChild(root);
    e = {
      root, pin, arrow, label, sub, dist,
      // caches — every DOM write below is gated on these
      shown: false, kind: null, color: null, labelText: null, subText: null,
      distText: null, edge: null, transform: null, opacity: null, arrowRot: null,
      glyphHost: null,
    };
    // glyph lives in its own span so the arrow node survives innerHTML swaps
    e.glyphHost = document.createElement('span');
    e.glyphHost.style.display = 'contents';
    pin.insertBefore(e.glyphHost, arrow);
    this._pool[i] = e;
    return e;
  }

  /**
   * Project and render the marker list for this frame.
   * @param {THREE.Camera} camera active scene camera
   * @param {Array<{id:string, worldPos:{x:number,y:number,z:number},
   *   kind:string, label:string, sublabel?:string, color?:string}>} markers
   */
  update(camera, markers) {
    const list = Array.isArray(markers) ? markers : [];
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const halfW = w / 2, halfH = h / 2;

    camera.updateMatrixWorld();
    _inv.copy(camera.matrixWorld).invert();
    _cam.setFromMatrixPosition(camera.matrixWorld);

    // nearest markers win the pool slots
    const sorted = this._sorted;
    sorted.length = 0;
    for (const m of list) {
      const p = m?.worldPos;
      if (!p) continue;
      const dx = p.x - _cam.x, dy = p.y - _cam.y, dz = p.z - _cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > HIDE_DIST) continue;
      sorted.push([d, m]);
    }
    sorted.sort((a, b) => a[0] - b[0]);
    const n = Math.min(MAX_MARKERS, sorted.length);

    for (let i = 0; i < n; i++) {
      const [dist, m] = sorted[i];
      const e = this._entry(i);
      const p = m.worldPos;

      // camera-space → NDC (Vector3.applyMatrix4 does the perspective divide)
      _v.set(p.x, p.y, p.z).applyMatrix4(_inv);
      const behind = _v.z >= -0.01;
      _v.applyMatrix4(camera.projectionMatrix);
      let nx = _v.x, ny = _v.y;
      if (behind) { nx = -nx; ny = -ny; } // divide by negative w flipped the sign

      const onscreen = !behind && nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1;
      let x, y, edge = !onscreen;
      if (onscreen) {
        x = (nx * 0.5 + 0.5) * w;
        y = (-ny * 0.5 + 0.5) * h;
      } else {
        // clamp the direction from screen center onto the margin rectangle
        let px = nx * halfW, py = -ny * halfH;
        const len = Math.hypot(px, py) || 1;
        px /= len; py /= len;
        const kx = Math.abs(px) > 1e-6 ? (halfW - EDGE_MARGIN) / Math.abs(px) : Infinity;
        const ky = Math.abs(py) > 1e-6 ? (halfH - EDGE_MARGIN) / Math.abs(py) : Infinity;
        const k = Math.min(kx, ky);
        x = halfW + px * k;
        y = halfH + py * k;
        const rot = Math.atan2(py, px);
        const rotQ = Math.round(rot * 100) / 100;
        if (e.arrowRot !== rotQ) { e.arrowRot = rotQ; e.arrow.style.transform = `rotate(${rotQ}rad)`; }
      }

      // distance falloff: full <120 m, faint by 600 m, gone past 800 m
      let alpha;
      if (dist <= FADE_NEAR) alpha = 1;
      else if (dist <= FADE_FAR) alpha = 1 - ((dist - FADE_NEAR) / (FADE_FAR - FADE_NEAR)) * 0.6;
      else alpha = 0.4 * (1 - (dist - FADE_FAR) / (HIDE_DIST - FADE_FAR));
      if (edge) alpha = Math.max(0.3, alpha * 0.9);
      const scale = (edge ? 0.9 : 1) * Math.min(1.04, Math.max(0.72, 1.06 - dist * 0.00042));

      // gated writes -----------------------------------------------------
      if (!e.shown) { e.shown = true; e.root.style.display = ''; }
      if (e.edge !== edge) { e.edge = edge; e.root.classList.toggle('is-edge', edge); }
      if (e.kind !== m.kind) {
        e.kind = m.kind;
        e.glyphHost.innerHTML = GLYPHS[m.kind] ?? GLYPHS.custom;
      }
      const color = m.color || (STORY_KINDS.has(m.kind) ? AMBER : CYAN);
      if (e.color !== color) { e.color = color; e.root.style.color = color; }
      if (e.labelText !== m.label) { e.labelText = m.label; e.label.textContent = m.label ?? ''; }
      const sub = m.sublabel ?? '';
      if (e.subText !== sub) {
        e.subText = sub;
        e.sub.textContent = sub;
        e.sub.style.display = sub ? '' : 'none';
      }
      const distText = edge ? '' : fmtDist(dist);
      if (e.distText !== distText) { e.distText = distText; e.dist.textContent = distText; }

      const tf = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${scale.toFixed(3)}) translate(-50%,-50%)`;
      if (e.transform !== tf) { e.transform = tf; e.root.style.transform = tf; }
      const op = Math.round(alpha * 100) / 100;
      if (e.opacity !== op) { e.opacity = op; e.root.style.opacity = op; }
    }

    // park unused pool nodes
    for (let i = n; i < this._pool.length; i++) {
      const e = this._pool[i];
      if (e.shown) { e.shown = false; e.root.style.display = 'none'; }
    }
  }

  /** Hide every marker (pool is kept for reuse). */
  clear() {
    for (const e of this._pool) {
      if (e.shown) { e.shown = false; e.root.style.display = 'none'; }
    }
  }

  /** Remove the DOM subtree and drop the pool. */
  dispose() {
    this.root.remove();
    this._pool.length = 0;
    this._sorted.length = 0;
  }
}
