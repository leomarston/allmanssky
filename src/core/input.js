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
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      // keep browser shortcuts from stealing game keys
      if (['Tab', 'Space', 'ControlLeft'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
      this.mouseClicked[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => { this.mouseDown[e.button] = false; });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener('wheel', (e) => { this.wheelDelta += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === el;
    });
  }

  requestPointerLock() {
    if (this._el && !this.pointerLocked) this._el.requestPointerLock?.();
  }
  exitPointerLock() {
    if (this.pointerLocked) document.exitPointerLock?.();
  }

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
