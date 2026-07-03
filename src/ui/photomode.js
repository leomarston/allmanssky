// Photo mode: freeze the world, fly a free camera, tune the shot, capture a
// PNG. Drives its own input directly (not the game input singleton) so nothing
// leaks to gameplay. The main loop calls renderFrame() instead of
// engine.render() while isOpen, and skips state.update().
import * as THREE from 'three';
import { audio } from '../audio/audio.js';

const STYLE_ID = 'ams-photo-style';

export class PhotoMode {
  /** @param {object} game the Game instance: { engine, state, ui, hud, uiRoot } */
  constructor(game) {
    this.game = game;
    this.root = null;
    this.cam = null;
    this._keys = new Set();
    this._dragging = false;
    this._speed = 14;
    this._injectStyle();
    // bound handlers (added/removed on open/close)
    this._onKey = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onDown = (e) => { if (e.button === 0 && !e.target.closest('.ams-photo-bar')) this._dragging = true; };
    this._onUp = () => { this._dragging = false; };
    this._onMove = (e) => {
      if (!this._dragging || !this.cam) return;
      this._yaw -= e.movementX * 0.0022;
      this._pitch = Math.max(-1.55, Math.min(1.55, this._pitch - e.movementY * 0.0022));
    };
  }

  get isOpen() { return !!this.root; }
  toggle() { this.isOpen ? this.close() : this.open(); }

  _injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #ui-root.ams-photo-hide > *:not(.ams-photo-bar):not(.ams-photo-flash) { visibility: hidden; }
      .ams-photo-bar { position:absolute; left:50%; bottom:22px; transform:translateX(-50%);
        display:flex; gap:18px; align-items:center; padding:12px 22px;
        background:rgba(6,14,20,.82); border:1px solid rgba(125,232,255,.35);
        backdrop-filter:blur(9px); z-index:70; font-family:var(--ui-font,system-ui);
        color:var(--ui-ink,#d6f2ff); transition:opacity .3s; }
      .ams-photo-bar.hidden { opacity:0; pointer-events:none; }
      .ams-photo-bar label { display:flex; flex-direction:column; gap:3px; font-size:9px;
        letter-spacing:.16em; color:var(--ui-dim,#7fa3b4); text-transform:uppercase; }
      .ams-photo-bar input[type=range] { width:96px; accent-color:var(--ui-cyan,#7de8ff); }
      .ams-photo-cap { background:rgba(125,232,255,.14); border:1px solid var(--ui-cyan,#7de8ff);
        color:var(--ui-cyan,#7de8ff); padding:9px 20px; cursor:pointer; letter-spacing:.2em;
        font-size:11px; font-family:inherit; }
      .ams-photo-cap:hover { background:rgba(125,232,255,.28); color:#04141c; }
      .ams-photo-hint { position:absolute; top:20px; left:50%; transform:translateX(-50%);
        z-index:70; font-size:10px; letter-spacing:.2em; color:rgba(214,242,255,.7);
        font-family:var(--ui-font,system-ui); text-transform:uppercase; pointer-events:none; }
      .ams-photo-flash { position:absolute; inset:0; background:#fff; opacity:0; z-index:80;
        pointer-events:none; }`;
    document.head.appendChild(s);
  }

  open() {
    if (this.root) return;
    const { engine, state, hud, uiRoot } = this.game;
    if (!state?.camera) return;

    // clone the live camera pose into a free-fly camera
    const src = state.camera;
    this.cam = new THREE.PerspectiveCamera(src.fov, src.aspect, src.near, src.far);
    this.cam.position.copy(src.position);
    const e = new THREE.Euler().setFromQuaternion(src.quaternion, 'YXZ');
    this._yaw = e.y; this._pitch = e.x; this._roll = 0;
    this._applyCam();

    // capture render settings to restore later
    this._savedExposure = engine.renderer.toneMappingExposure;
    this._savedBloom = engine.bloomPass ? engine.bloomPass.strength : null;
    this._origPassCam = engine.composer?.passes?.[0]?.camera ?? null;

    // hide the HUD + all game UI except our own bar
    this._prevHudMode = hud?.mode ?? null;
    hud?.setMode?.('hidden');
    uiRoot.classList.add('ams-photo-hide');

    this._buildBar();
    audio.sfx?.('scan');

    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    window.addEventListener('mousemove', this._onMove);
  }

  _buildBar() {
    const { uiRoot } = this.game;
    const hint = document.createElement('div');
    hint.className = 'ams-photo-hint';
    hint.textContent = 'PHOTO MODE — WASD/QE FLY · DRAG LOOK · H HIDE UI · P/ESC EXIT';
    uiRoot.appendChild(hint);
    this._hint = hint;

    const bar = document.createElement('div');
    bar.className = 'ams-photo-bar';
    const slider = (label, min, max, step, val, fn) => {
      const l = document.createElement('label');
      l.textContent = label;
      const i = document.createElement('input');
      i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val;
      i.oninput = () => fn(parseFloat(i.value));
      l.appendChild(i);
      bar.appendChild(l);
      return i;
    };
    slider('Fly Speed', 1, 60, 1, this._speed, (v) => { this._speed = v; });
    slider('FOV', 30, 110, 1, this.cam.fov, (v) => { this.cam.fov = v; this.cam.updateProjectionMatrix(); });
    slider('Exposure', 0.4, 2.2, 0.05, this._savedExposure, (v) => this.game.engine.setExposure(v));
    if (this._savedBloom != null) {
      slider('Bloom', 0, 1.5, 0.05, this._savedBloom, (v) => { this.game.engine.bloomPass.strength = v; });
    }
    const cap = document.createElement('button');
    cap.className = 'ams-photo-cap';
    cap.textContent = 'CAPTURE';
    cap.onclick = () => this.capture();
    bar.appendChild(cap);
    uiRoot.appendChild(bar);
    this.root = bar;

    const flash = document.createElement('div');
    flash.className = 'ams-photo-flash';
    uiRoot.appendChild(flash);
    this._flash = flash;
  }

  _key(e, down) {
    const c = e.code;
    if (down) {
      if (c === 'KeyH') { this.root?.classList.toggle('hidden'); return; }
      // P / Escape handled by the main loop; ignore here
    }
    if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'KeyC'].includes(c)) {
      if (down) this._keys.add(c); else this._keys.delete(c);
      e.preventDefault();
    }
  }

  _applyCam() {
    this.cam.quaternion.setFromEuler(new THREE.Euler(this._pitch, this._yaw, this._roll, 'YXZ'));
  }

  /** advance the free camera; called each frame while open (before render) */
  update(dt) {
    if (!this.cam) return;
    const k = this._keys;
    const boost = k.has('ShiftLeft') ? 3 : 1;
    const v = this._speed * boost * dt;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0);
    if (k.has('KeyW')) this.cam.position.addScaledVector(fwd, v);
    if (k.has('KeyS')) this.cam.position.addScaledVector(fwd, -v);
    if (k.has('KeyD')) this.cam.position.addScaledVector(right, v);
    if (k.has('KeyA')) this.cam.position.addScaledVector(right, -v);
    if (k.has('Space') || k.has('KeyQ')) this.cam.position.addScaledVector(up, v);
    if (k.has('KeyC') || k.has('KeyE')) this.cam.position.addScaledVector(up, -v);
    this._applyCam();
  }

  /** render the frozen world through the free camera (main loop uses this) */
  renderFrame() {
    const { engine } = this.game;
    if (engine.composer?.passes?.[0]) engine.composer.passes[0].camera = this.cam;
    engine.render();
  }

  capture() {
    const { engine } = this.game;
    this.renderFrame();
    const canvas = engine.renderer.domElement;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `allmanssky-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
    // shutter flash
    if (this._flash) {
      this._flash.style.transition = 'none';
      this._flash.style.opacity = '0.85';
      requestAnimationFrame(() => {
        this._flash.style.transition = 'opacity .5s';
        this._flash.style.opacity = '0';
      });
    }
    audio.sfx?.('scanDone');
  }

  close() {
    if (!this.root) return;
    const { engine, hud, uiRoot } = this.game;
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mouseup', this._onUp);
    window.removeEventListener('mousemove', this._onMove);
    // restore render settings + composer camera
    engine.setExposure(this._savedExposure);
    if (this._savedBloom != null && engine.bloomPass) engine.bloomPass.strength = this._savedBloom;
    if (engine.composer?.passes?.[0]) {
      engine.composer.passes[0].camera = this._origPassCam ?? this.game.state?.camera ?? this.cam;
    }
    hud?.setMode?.(this._prevHudMode ?? 'hidden');
    uiRoot.classList.remove('ams-photo-hide');
    this.root.remove();
    this._hint?.remove();
    this._flash?.remove();
    this.root = this._hint = this._flash = this.cam = null;
    this._keys.clear();
    this._dragging = false;
    audio.sfx?.('click');
  }
}
