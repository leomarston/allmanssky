// Base-building piece picker — STUB pending fan-out #2. CONTRACT:
//   new BuildUI(gameState) → .open() .close() .isOpen ; shows piece bar while
//   BaseBuilder is in build mode; selection via number keys.
export class BuildUI {
  constructor(gs) { this.gs = gs; this.root = null; }
  get isOpen() { return false; } // bar is passive; never blocks gameplay
  open() {}
  close() {}
}
