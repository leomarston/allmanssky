// Input singleton: keyboard state, mouse deltas under pointer lock, wheel,
// and a semantic action map so gameplay reads intents, not key codes.

const KEYMAP = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  up: ['Space'], down: ['ControlLeft', 'KeyC'],
  boost: ['ShiftLeft'], rollLeft: ['KeyQ'], rollRight: ['KeyE'],
  interact: ['KeyF'], jump: ['Space'], sprint: ['ShiftLeft'],
  inventory: ['Tab', 'KeyI'], map: ['KeyM'], build: ['KeyB'],
  scan: ['KeyV'], photo: ['KeyP'], land: ['KeyG'], warp: ['KeyJ'],
  torch: ['KeyT'], escape: ['Escape'], swapWeapon: ['KeyR'],
};

class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();      // keys that went down this frame
    this.released = new Set();     // keys that went up this frame
    this.mouseDX = 0; this.mouseDY = 0;
    this.wheelDelta = 0;
    this.mouseDown = [false, false, false];
    this.mouseClicked = [false, false, false];
    this.pointerLocked = false;
    this.enabled = true;
    this._el = null;
  }

  attach(el) {
    this._el = el;
    window.addEventListener('keydown', (e) => {
      // keep browser shortcuts/scrolling from stealing game keys
      if (['Tab', 'Space', 'ControlLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
      this.mouseClicked[e.button] = true;
      this._dragLook = true; // canvas-originated press → drag steers
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown[e.button] = false;
      if (!this.mouseDown.some(Boolean)) this._dragLook = false;
    });
    window.addEventListener('mousemove', (e) => {
      // pointer lock is the primary path; drag-look is the guaranteed fallback
      // so the game stays steerable even where lock is denied or unavailable
      if (this.pointerLocked || this._dragLook) {
        // movementX is undefined on unlocked moves in some engines — fall back
        // to screen-coordinate deltas
        const mx = e.movementX ?? (this._lastSX == null ? 0 : e.screenX - this._lastSX);
        const my = e.movementY ?? (this._lastSY == null ? 0 : e.screenY - this._lastSY);
        this.mouseDX += mx;
        this.mouseDY += my;
      }
      this._lastSX = e.screenX;
      this._lastSY = e.screenY;
    });
    window.addEventListener('wheel', (e) => { this.wheelDelta += Math.sign(e.deltaY); }, { passive: true });
    const syncLock = () => {
      const locked = document.pointerLockElement ?? document.webkitPointerLockElement ?? document.mozPointerLockElement;
      this.pointerLocked = locked === el;
    };
    document.addEventListener('pointerlockchange', syncLock);
    document.addEventListener('webkitpointerlockchange', syncLock);
    document.addEventListener('mozpointerlockchange', syncLock);
  }

  requestPointerLock() {
    const el = this._el;
    if (!el || this.pointerLocked) return;
    // Safari/older engines expose prefixed variants; the call may also return a
    // promise that rejects (e.g. relock cooldown after Esc) — swallow it.
    const req = el.requestPointerLock || el.webkitRequestPointerLock || el.mozRequestPointerLock;
    try { req?.call(el)?.catch?.(() => {}); } catch { /* denied — user clicks again */ }
  }
  exitPointerLock() {
    if (this.pointerLocked) {
      const exit = document.exitPointerLock || document.webkitExitPointerLock || document.mozExitPointerLock;
      try { exit?.call(document); } catch { /* already unlocked */ }
    }
  }

  /** true when mouse-look is live — pointer lock OR the drag-look fallback */
  get aiming() { return this.pointerLocked || !!this._dragLook; }

  /** arrow-key look axis, -1..1 — keyboard steering that needs no mouse at all */
  get lookX() { return (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0); }
  get lookY() { return (this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0); }

  /** is a semantic action currently held */
  action(name) {
    if (!this.enabled) return false;
    const codes = KEYMAP[name];
    if (!codes) return false;
    return codes.some((c) => this.keys.has(c));
  }
  /** did a semantic action begin this frame */
  actionPressed(name) {
    if (!this.enabled) return false;
    const codes = KEYMAP[name];
    if (!codes) return false;
    return codes.some((c) => this.pressed.has(c));
  }
  keyPressed(code) { return this.enabled && this.pressed.has(code); }

  /** consume per-frame deltas; call once at end of each frame */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseClicked[0] = this.mouseClicked[1] = this.mouseClicked[2] = false;
    this.mouseDX = 0; this.mouseDY = 0;
    this.wheelDelta = 0;
  }
}

export const input = new Input();
