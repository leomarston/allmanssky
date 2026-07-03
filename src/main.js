// AllMansSky entry point: bootstraps the engine, universe, UI, and runs the
// state machine (menu → space ⇄ surface).
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { input } from './core/input.js';
import { events } from './core/events.js';
import { hashString } from './core/rng.js';
import { Galaxy, GALAXY_SEED_DEFAULT } from './universe/galaxy.js';
import { GameState } from './gameplay/state.js';
import { QuestSystem } from './gameplay/quests.js';
import { SpaceState } from './states/spacestate.js';
import { SurfaceState } from './states/surfacestate.js';
import { HUD } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import * as notifications from './ui/notifications.js';
import { InventoryUI } from './ui/inventoryui.js';
import { TradeUI } from './ui/tradeui.js';
import { GalaxyMap } from './ui/mapui.js';
import { QuestUI } from './ui/questui.js';
import { BuildUI } from './ui/buildui.js';
import { audio } from './audio/audio.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.uiRoot = document.getElementById('ui-root');
    this.engine = new Engine(this.canvas);
    input.attach(this.canvas);

    // fade overlay for transitions
    this.fadeEl = document.createElement('div');
    this.fadeEl.style.cssText =
      'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .4s;z-index:90;';
    this.uiRoot.appendChild(this.fadeEl);

    this.hud = new HUD(this.uiRoot);
    this.screens = new Screens(this.uiRoot);
    notifications.init?.(this.uiRoot);

    this.state = null;       // active state object
    this.paused = false;
    this._dead = false;

    // first user gesture unlocks audio
    const unlock = () => { audio.init(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    // pointer lock MUST be requested synchronously inside the gesture handler:
    // Safari and Firefox reject requests made later in the frame (e.g. from the
    // render loop), which left the mouse uncaptured on those browsers.
    this.canvas.addEventListener('mousedown', () => {
      if (this.state && !this.paused && !input.pointerLocked && !this.ui?.anyOpen?.()) {
        input.requestPointerLock();
      }
    });

    // visible prompt while the game runs without mouse capture
    this.lockHint = document.createElement('div');
    this.lockHint.textContent = 'CLICK TO TAKE CONTROL';
    this.lockHint.style.cssText = [
      'position:absolute', 'left:50%', 'top:64%', 'transform:translateX(-50%)',
      'padding:10px 26px', 'border:1px solid rgba(125,232,255,.55)',
      'background:rgba(8,20,28,.72)', 'color:#7de8ff', 'letter-spacing:.28em',
      'font-size:12px', 'font-family:var(--ui-font,system-ui)',
      'pointer-events:none', 'z-index:30', 'display:none',
      'animation:ams-pulse 1.6s ease-in-out infinite',
      'backdrop-filter:blur(6px)',
    ].join(';');
    this.uiRoot.appendChild(this.lockHint);
  }

  /** cross-state context handed to states */
  get ctx() {
    return {
      engine: this.engine,
      galaxy: this.galaxy,
      gameState: this.gameState,
      hud: this.hud,
      screens: this.screens,
      ui: this.ui,
      fade: (s, color) => this.fade(s, color),
      switchState: (name, params) => this.switchState(name, params),
    };
  }

  async fade(seconds = 1, color = '#000000') {
    this.fadeEl.style.background = color;
    this.fadeEl.style.transition = `opacity ${seconds * 0.45}s`;
    this.fadeEl.style.opacity = '1';
    await new Promise((r) => setTimeout(r, seconds * 450));
    // fade back out shortly after the new state settles
    setTimeout(() => { this.fadeEl.style.opacity = '0'; }, 350);
  }

  bindWorld(gameState) {
    this.gameState = gameState;
    this.galaxy = new Galaxy(gameState.galaxySeed);
    if (!this.gameState.currentSystemId) {
      this.gameState.currentSystemId = this.galaxy.startingSystemId();
    }
    this.ui = {
      inventory: new InventoryUI(gameState),
      trade: new TradeUI(gameState),
      map: new GalaxyMap(this.galaxy, gameState),
      quest: new QuestUI(gameState),
      build: new BuildUI(gameState),
      anyOpen: () =>
        !!(this.ui.inventory.isOpen || this.ui.trade.isOpen || this.ui.map.isOpen
          || this.ui.quest.isOpen || this.screens.isOpen),
    };
    this.quests = new QuestSystem(gameState, this.galaxy);
    this.quests.init?.();

    events.on('player:death', () => this._onDeath());
    events.on('audio:play', (name, opts) => audio.sfx(name, opts));
  }

  async switchState(name, params = {}) {
    const old = this.state;
    old?.exit?.();
    const next = name === 'space' ? new SpaceState(this.ctx) : new SurfaceState(this.ctx);
    this.state = next;
    await next.enter(params);
    this.engine.setScene(next.scene, next.camera, name === 'space'
      ? { bloomStrength: 0.65, bloomRadius: 0.55, bloomThreshold: 0.8 }
      : { bloomStrength: 0.4, bloomRadius: 0.5, bloomThreshold: 0.85 });
    events.emit('state:change', name, old?.name);
  }

  async _onDeath() {
    if (this._dead) return;
    this._dead = true;
    input.exitPointerLock();
    audio.sfx('death');
    await this.screens.dead?.();
    const gs = this.gameState;
    gs.health = gs.healthMax;
    gs.shield = gs.shieldMax;
    gs.oxygen = gs.oxygenMax;
    gs.energy = gs.energyMax;
    gs.ship.hull = gs.ship.hullMax;
    this._dead = false;
    // respawn at ship / in space near start of system
    if (gs.location.mode === 'surface') {
      await this.switchState('surface', { systemId: gs.currentSystemId, planetIndex: gs.location.planetIndex, landingPos: gs.location.landingPos });
    } else {
      gs.location.pos = null;
      await this.switchState('space', { systemId: gs.currentSystemId });
    }
  }

  async start() {
    const q = new URLSearchParams(location.search);
    const debugState = q.get('state');

    if (debugState) {
      // headless/debug boot: skip menu, deterministic world
      const seed = Number(q.get('seed') ?? GALAXY_SEED_DEFAULT);
      this.bindWorld(new GameState(seed));
      if (q.get('system')) this.gameState.currentSystemId = q.get('system');
      if (debugState === 'surface') {
        const planetIndex = Number(q.get('planet') ?? -1);
        const sys = this.galaxy.getSystem(this.gameState.currentSystemId);
        let idx = planetIndex;
        if (q.get('biome')) {
          idx = sys.planets.findIndex((p) => p.biome === q.get('biome'));
        }
        if (idx < 0) idx = 0;
        await this.switchState('surface', {
          systemId: this.gameState.currentSystemId,
          planetIndex: idx,
          landingPos: { x: 0, z: 0 },
        });
      } else {
        await this.switchState('space', { systemId: this.gameState.currentSystemId, mode: 'start' });
      }
    } else {
      await this._menuFlow();
    }

    this._loop();
    window.__AMS__ = { ready: true, game: this };
  }

  async _menuFlow() {
    const choice = await this.screens.mainMenu({ hasSave: GameState.hasSave() });
    audio.init();
    if (choice?.action === 'continue') {
      const loaded = GameState.load();
      if (loaded) {
        this.bindWorld(loaded);
        if (loaded.location.mode === 'surface') {
          await this.switchState('surface', {
            systemId: loaded.currentSystemId,
            planetIndex: loaded.location.planetIndex,
            landingPos: loaded.location.landingPos ?? { x: 0, z: 0 },
            restorePos: true,
          });
        } else {
          await this.switchState('space', { systemId: loaded.currentSystemId });
        }
        return;
      }
    }
    // new voyage
    const seed = choice?.seed ? hashString(String(choice.seed)) : GALAXY_SEED_DEFAULT;
    GameState.clearSave();
    this.bindWorld(new GameState(seed));
    await this.switchState('space', { systemId: this.gameState.currentSystemId, mode: 'start' });
    events.emit('notify', { text: 'THE VESPER SIGNAL CALLS. Fly close to a planet and press G to land.', tone: 'info' });
  }

  async _pause() {
    if (this.paused || !this.state) return;
    this.paused = true;
    input.exitPointerLock();
    const result = await this.screens.pause?.();
    if (result === 'save-menu' || result?.action === 'save-menu') {
      this.gameState.save();
      location.reload();
      return;
    }
    this.paused = false;
  }

  _loop() {
    const frame = () => {
      requestAnimationFrame(frame);
      const dt = this.engine.tick();
      this.lockHint.style.display =
        this.state && !this.paused && !input.pointerLocked && !this.ui?.anyOpen?.()
          ? 'block' : 'none';
      if (this.state && !this.paused) {
        if (input.actionPressed('escape')) {
          if (this.ui.inventory.isOpen) this.ui.inventory.close();
          else if (this.ui.trade.isOpen) this.ui.trade.close();
          else if (this.ui.map.isOpen) this.ui.map.close();
          else if (this.ui.quest.isOpen) this.ui.quest.close();
          else if (!this.screens.isOpen) this._pause();
        }
        if (input.actionPressed('inventory') && !this.screens.isOpen) this.ui.inventory.toggle();
        this.state.update(dt);
      }
      this.engine.render();
      input.endFrame();
    };
    frame();
  }
}

const game = new Game();
game.start().catch((err) => {
  console.error('boot failed', err);
  document.body.innerHTML = `<pre style="color:#ff5470;padding:40px;font-size:14px;">AllMansSky failed to start:\n${err.stack ?? err}</pre>`;
});
