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
import { HangarState } from './states/hangarstate.js';
import { HUD } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import * as notifications from './ui/notifications.js';
import { InventoryUI } from './ui/inventoryui.js';
import { TradeUI } from './ui/tradeui.js';
import { GalaxyMap } from './ui/mapui.js';
import { QuestUI } from './ui/questui.js';
import { BuildUI } from './ui/buildui.js';
import { ShipyardUI } from './ui/shipyardui.js';
import { MissionBoard } from './ui/missionboard.js';
import { PhotoMode } from './ui/photomode.js';
import { audio } from './audio/audio.js';
import { AMS_VERSION, AMS_VERSION_NOTE } from './core/version.js';

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
    this.photo = new PhotoMode(this);

    // first user gesture unlocks audio
    const unlock = () => { audio.init(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    // pointer lock MUST be requested synchronously inside the gesture handler:
    // Safari and Firefox reject requests made later in the frame (e.g. from the
    // render loop). Listen at window level so no overlay between the cursor and
    // the canvas can silently starve the request — skip only genuine UI clicks.
    window.addEventListener('mousedown', (e) => {
      if (!this.state || this.paused || input.pointerLocked) return;
      if (this.ui?.anyOpen?.()) return;
      if (e.target.closest?.('button, input, select, textarea, a, [data-interactive]')) return;
      input.requestPointerLock();
    });

    // visible prompt while the game runs without mouse capture — a real button
    // so its own mousedown is a guaranteed direct gesture for pointer lock,
    // regardless of what sits over the canvas
    this.lockHint = document.createElement('button');
    this.lockHint.innerHTML = 'CLICK TO TAKE CONTROL<br><span style="font-size:9px;letter-spacing:.18em;opacity:.7;">drag with the mouse held down to steer · arrow keys also turn</span>';
    this.lockHint.style.cssText = [
      'position:absolute', 'left:50%', 'top:64%', 'transform:translateX(-50%)',
      'padding:12px 28px', 'border:1px solid rgba(125,232,255,.55)',
      'background:rgba(8,20,28,.78)', 'color:#7de8ff', 'letter-spacing:.28em',
      'font-size:12px', 'font-family:var(--ui-font,system-ui)', 'line-height:1.7',
      'cursor:pointer', 'z-index:30', 'display:none',
      'animation:ams-pulse 1.6s ease-in-out infinite',
      'backdrop-filter:blur(6px)',
    ].join(';');
    this.lockHint.addEventListener('mousedown', (e) => {
      e.preventDefault();
      input.requestPointerLock();
    });
    this.uiRoot.appendChild(this.lockHint);

    // build stamp — verifies which deployment a browser is actually running
    const ver = document.createElement('div');
    ver.textContent = `${AMS_VERSION} · ${AMS_VERSION_NOTE}`;
    ver.style.cssText = 'position:absolute;right:8px;bottom:6px;font-size:9px;letter-spacing:.12em;color:rgba(127,163,180,.5);pointer-events:none;z-index:100;font-family:var(--ui-font,system-ui);';
    this.uiRoot.appendChild(ver);
    console.log(`AllMansSky ${AMS_VERSION} — ${AMS_VERSION_NOTE}`);
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
    // quests first — the mission board UI holds a reference to it
    this.quests = new QuestSystem(gameState, this.galaxy);
    this.ui = {
      inventory: new InventoryUI(gameState),
      trade: new TradeUI(gameState, this.galaxy),
      map: new GalaxyMap(this.galaxy, gameState),
      quest: new QuestUI(gameState),
      build: new BuildUI(gameState),
      shipyard: new ShipyardUI(gameState),
      missions: new MissionBoard(gameState, this.galaxy, this.quests),
      anyOpen: () =>
        !!(this.ui.inventory.isOpen || this.ui.trade.isOpen || this.ui.map.isOpen
          || this.ui.quest.isOpen || this.ui.shipyard.isOpen || this.ui.missions.isOpen
          || this.screens.isOpen),
    };

    // Warden wanted level — pips under the compass, evade timer sweep
    this._wantedChip ??= (() => {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;left:50%;top:64px;transform:translateX(-50%);display:none;align-items:center;gap:5px;padding:5px 12px;background:rgba(28,8,10,.72);border:1px solid rgba(255,84,60,.55);backdrop-filter:blur(4px);z-index:15;';
      this.uiRoot.appendChild(el);
      return el;
    })();
    events.on('combat:wanted', ({ level, evading01 }) => {
      if (!level) { this._wantedChip.style.display = 'none'; return; }
      this._wantedChip.style.display = 'flex';
      this._wantedChip.innerHTML =
        `<span style="font-size:9px;letter-spacing:.22em;color:#ff5a3c;">WARDEN ALERT</span>`
        + Array.from({ length: 5 }, (_, i) =>
          `<span style="width:12px;height:5px;background:${i < level ? '#ff5a3c' : '#3a1418'};display:inline-block;"></span>`).join('')
        + (evading01 > 0 ? `<span style="font-size:9px;color:#7fa3b4;margin-left:6px;">EVADING ${Math.round(evading01 * 100)}%</span>` : '');
    });
    this.quests.init?.();

    events.on('player:death', () => this._onDeath());
    events.on('audio:play', (name, opts) => audio.sfx(name, opts));
  }

  async switchState(name, params = {}) {
    const old = this.state;
    old?.exit?.();
    const next = name === 'space' ? new SpaceState(this.ctx)
      : name === 'hangar' ? new HangarState(this.ctx)
        : new SurfaceState(this.ctx);
    this.state = next;
    await next.enter(params);
    const bloom = name === 'space'
      ? { bloomStrength: 0.65, bloomRadius: 0.55, bloomThreshold: 0.8 }
      : name === 'hangar'
        ? { bloomStrength: 0.55, bloomRadius: 0.58, bloomThreshold: 0.84 }
        : { bloomStrength: 0.4, bloomRadius: 0.5, bloomThreshold: 0.85 };
    // AO is verified clean in the interior (small depth range); the outdoor and
    // space scenes use logarithmicDepthBuffer over a huge range, which GTAO's
    // depth prepass mishandles (horizon artifacts) — gated off pending a
    // log-depth-aware surface AO. See task: surface AO.
    this.engine.setScene(next.scene, next.camera, {
      ...bloom, aoScene: name, aoEnabled: name === 'hangar', godrayEnabled: name === 'surface',
    });
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
      } else if (debugState === 'hangar') {
        const sys = this.galaxy.getSystem(this.gameState.currentSystemId);
        await this.switchState('hangar', {
          systemId: this.gameState.currentSystemId,
          faction: sys.station?.faction ?? 'meridian',
          stationName: sys.station?.name ?? 'Test Anchorage',
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
    const choice = await this.screens.mainMenu({
      hasSave: GameState.hasSave(),
      saves: GameState.listSaves(),
    });
    audio.init();
    if (choice?.action === 'continue' || choice?.action === 'load') {
      const loaded = GameState.load(choice.action === 'load' ? choice.slot : null);
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
    const slot = choice?.slot ?? 1;
    GameState.clearSave(slot);
    const fresh = new GameState(seed);
    fresh.slot = slot;
    this.bindWorld(fresh);
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

      // photo mode freezes the world and renders through a free camera
      if (this.photo.isOpen) {
        if (input.actionPressed('photo') || input.actionPressed('escape')) {
          this.photo.close();          // consume the frame so P doesn't re-open below
          this.engine.render();
          input.endFrame();
          return;
        }
        this.photo.update(dt);
        this.photo.renderFrame();
        input.endFrame();
        return;
      }

      this.lockHint.style.display =
        this.state && !this.paused && !input.aiming && !this.ui?.anyOpen?.() && !this.photo.isOpen
          ? 'block' : 'none';
      if (this.state && !this.paused) {
        if (input.actionPressed('escape')) {
          if (this.ui.inventory.isOpen) this.ui.inventory.close();
          else if (this.ui.trade.isOpen) this.ui.trade.close();
          else if (this.ui.map.isOpen) this.ui.map.close();
          else if (this.ui.quest.isOpen) this.ui.quest.close();
          else if (this.ui.shipyard.isOpen) this.ui.shipyard.close();
          else if (this.ui.missions.isOpen) this.ui.missions.close();
          else if (!this.screens.isOpen) this._pause();
        }
        if (input.actionPressed('photo') && !this.screens.isOpen && !this.ui.anyOpen()) {
          input.exitPointerLock();
          this.photo.open();
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
