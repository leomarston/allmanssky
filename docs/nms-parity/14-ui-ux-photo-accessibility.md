# Volume 14 — UI/UX, Photo Mode & Accessibility

**Score: 4/10 — our relatively strongest domain, and still a shallow one.** AllMansSky's DOM-overlay HUD is genuinely clean: legible, low-jank (every write is change-gated), thematically consistent, and covers the moment-to-moment vitals loop well. What it does not have is *depth*: No Man's Sky's UI is not just a HUD, it is an entire secondary game — a browsable discovery encyclopedia, an aim-and-tag scanning ritual, a radial action system, a multi-grid inventory with slot adjacency, a galaxy map with five distinct analytical overlays, and an accessibility settings surface with dozens of independent toggles. We have a HUD, a map, an inventory, and a free-fly photo mode. Everything past the first layer — the *systems* that turn UI into a second gameplay loop — is thin or absent. This volume inventories every screen, names the gap feature-by-feature, and specifies the target data models and module plan to close it.

---

## 1. What No Man's Sky does

### 1.1 HUD
A persistent heads-up layer that changes composition by context (on-foot / ship cockpit / space):
- **Compass strip** along the top: 360° heading ticks, cardinal letters, and live **pings** for every known POI within range — beacons, crashed ships, points of interest, and the current quest objective — each with a distance readout and an icon that changes as you approach.
- **Health / shield / hazard-protection triple gauge** (on foot): life support, shield, hazard shielding, each independently drainable and rechargeable, plus a **life-support (oxygen) meter** on airless worlds.
- **Ship cockpit instruments**: shield strength, hull integrity, pulse-drive/launch-thruster charge, pirate/Sentinel wanted stars, and a full **radar/proximity ring** for nearby ships, asteroids and cargo.
- **Environmental readouts**: ambient temperature, storm countdown timers, radiation/toxicity/extreme-cold/extreme-heat icons with numeric severity, and a **hazard-protection drain rate** so the player can plan retreat.
- **Scanner pulse UI**: a expanding ring visual synced to the aim-scan (see 1.2) with a distinct "ping" chime per discovery tier (common/uncommon/rare/exotic — with color and audio cue scaled to rarity).
- **Reticle** that changes shape per tool/context (mining beam, weapon, terrain manipulator, building placement ghost with valid/invalid color).

### 1.2 The Analysis Visor (scanner mode)
Holding the scan button opens an aim-based visor overlay: a HUD tint change, a widening scan cone, and **live tagging** of anything the reticle crosses — flora, fauna, minerals, or POIs get a floating name-plate with a fill-progress ring. Holding on a target for its scan duration:
1. Reveals its provisional name/species classification and a stat card (temperament, diet, resource value for flora/minerals).
2. **Adds it to the local Discovery Catalog** for that planet.
3. Offers **rename** (first discoverer names the species) and **waypoint pinning** (marks it on the compass/map so the player can walk back to it).
4. Grants currency (Units) scaled to rarity, with a "New Discovery" banner and — once per **save-file-wide first discovery** — a larger "First Discovery" fanfare and bonus payout.
Minerals/resources get an additional "highlight through terrain" pass so ore veins glow through rock at close range while the visor is active.

### 1.3 The Quick Menu
A **radial pie menu** (hold a dedicated button) with 8–12 configurable slices: summon ship, summon exocraft (roster-dependent), multitool mode swap (mining/combat/scan beam), build menu shortcut, torch toggle, terrain manipulator toggle (dig/flatten/fill), emote wheel (sub-menu), quick-use consumable, and a jetpack-recharge action on some platforms. It is a **modal but non-blocking** overlay: time nearly freezes, mouse/stick angle selects a slice, release commits.

### 1.4 Inventory management
Multiple **independent grids**, each with its own slot count and stacking rules: General (consumables/curiosities, small stacks), Cargo (raw resources, large stacks, ship-hold-only), Technology (exosuit/ship/multitool upgrade modules, non-stacking, occupy a **slot-grid with adjacency bonuses** — same-type modules touching increase effect). Items can be **drag-and-dropped** between grids, between exosuit/ship/freighter/multitool inventories, discarded, or repaired (broken tech shows a static-hazard icon until fixed). Hovering a tech module shows a **comparison tooltip** against the currently installed one. Installing tech is a drag-onto-slot action that immediately reflows the adjacency-bonus overlay.

### 1.5 Discovery pages
A drill-down catalog: **Galaxy → System → Planet → Catalog tab**. The planet page shows: name, biome/weather table (day/night temperature range, storm frequency, resource abundance), a **fauna roster** (each genus with silhouette, discovered/undiscovered count, per-species cards once tagged), a **flora roster**, a **minerals/resources list**, and a **completion percentage** for that planet (species tagged ÷ total genus roster generated for that world). A system-level rollup shows planets-explored / total, and a save-wide "Discoveries" tally feeds the player's overall explorer profile. Every entry can be **uploaded** to the (in-fiction) network for a Units/Nanite payout, with a distinct "already discovered by another traveller" outcome that pays less.

### 1.6 Galaxy map modes
A free-flying 3D starfield with **five analytical filter modes**: Normal (plain starfield), **Path to Center** (draws the pilgrimage arc toward galactic center with hop-count and black-hole shortcuts highlighted), **Economy** (recolors systems by wealth tier — poor/low/medium/high/opulent), **Conflict** (recolors by security level — low/medium/high, useful for Sentinel/pirate risk assessment), and **Settlement/Racial** overlays in later updates (color by owning race, or by "has a base/settlement"). Selecting a system shows its dossier (race, economy, conflict, dominant life, discovered %) and lets the player **set a waypoint** and **plot a multi-jump course**; a distance/jumps-remaining readout persists in the HUD until arrival.

### 1.7 Mission log & Nexus board
A **Log** screen lists main-story missions, side missions, guide/tutorial entries and milestones, each with objective text and progress. Space stations and the Space Anomaly host a **Nexus mission board**: rotating community missions with visible participation counts and tiered rewards, separate from the story log.

### 1.8 Photo mode
Free camera decoupled from the player/ship with: position + orbit controls, FOV slider, **depth of field** (focal distance + aperture/bokeh amount), a bank of **color-grade filters/LUTs**, **time-of-day** slider (independent of the live clock), cloud/atmosphere density controls, player/creature **pose** selection, hide-HUD, aspect-ratio/border overlays, film grain, and vignette — all exposed as sliders in a persistent bottom bar, with instant PNG capture.

### 1.9 Accessibility & settings
A genuinely deep matrix: **colorblind modes** (protanopia/deuteranopia/tritanopia palette remaps applied to HUD and markers), **HUD/subtitle text size** scaling, subtitle background opacity, **motion blur / camera shake / head-bob** independent toggles, **auto-run**, damage-flash reduction, full **button remapping** for keyboard/mouse and gamepad (per-action rebind with conflict detection), **difficulty presets** (Normal / Survival / Permadeath / Creative) each expanding into two dozen **individual sliders** (damage taken, hazard drain rate, resource scarcity, fall damage, fuel use, death consequences, currency loss), and **network text size** for multiplayer chat.

---

## 2. What we have today

| Screen | Module | What actually exists |
|---|---|---|
| HUD | `src/ui/hud.js` — class `HUD` | `_buildVitals()` builds health/shield/hull `statBar`s + a foot-only `oxygen/energy/jetpack` mini-bar row + three static hazard icons (`temp`/`rad`/`tox`, `HAZARDS` array) toggled on/off by `update(dt, s)`. `_buildCompass()` draws a tri-repeated tick strip (`PX_PER_DEG = 2.1`) with a single `_targetMarker`/`_targetLine` — **one** bearing target, driven by `s.target = {bearingDeg, name, dist}`. `_buildReadouts()` shows speed/altitude/fuel/warp only (ship/space mode). `_buildReticle()` swaps `dataset.reticle` between `'dot'`/`'ship'` and shows/hides `_interactEl` for F-prompts. `setMode('foot'|'ship'|'space'|'hidden')` swaps visible clusters. No cockpit radar ring, no per-POI ping list (only one target slot), no storm/temperature countdown, no scanner-pulse HUD tint. |
| Scanning | `src/gameplay/scanner.js` — class `Scanner` | `scan(surface)` on `V` (6 s cooldown, `COOLDOWN`) spawns an expanding ground ring (`_spawnRing`/`_updateRing`, `PULSE_RADIUS = 350`), then after `COLLECT_DELAY = 900 ms` runs `_collect()`: a **passive radius sweep**, nearest-first, of `surface.props.all` within `POI_RANGE = 400 m` (`describeProp()` labels node/ruin/beacon/outpost/crash/pad) plus the single nearest creature within `CREATURE_RANGE = 120 m` via `surface.creatures.scanNearest()`. Results become `this._markers` (`MARKER_TTL = 300 s`), consumed by `WaypointLayer`. Creature/flora finds call `gs.discover(kind, key, name, value)`. There is **no aim/reticle tagging** — the player never selects an individual object; the whole radius auto-resolves. |
| Discovery data | `src/gameplay/state.js` — `GameState.discover()` | `this.discoveries = { systems:{}, planets:{}, creatures:{}, flora:{}, ruins:{} }`; `discover(kind, key, name, value)` writes `book[key] = { name, at: currentSystemId }` once, pays Lumens, emits `'discovery:new'`. That is the **entire** data model: no stats, no biome/weather snapshot, no per-planet roster, no completion %, no rename, no "first discovery" tier. |
| Waypoints | `src/ui/waypoints.js` — class `WaypointLayer` | Pooled (`MAX_MARKERS = 24`) DOM markers, one draw call per marker, projected via camera matrix each frame; per-kind SVG glyph (`GLYPHS`), distance-based fade (`FADE_NEAR/FADE_FAR/HIDE_DIST`), and edge-clamped arrows for off-screen markers (`is-edge` class). Solid piece of engineering — but its **only** data source is `scanner.markers` (`surfacestate.js:264`); no quest system ever feeds it a persistent objective marker, and `hud.js`'s own single compass target is hard-set to `null` on foot (`surfacestate.js:579`). |
| Notifications | `src/ui/notifications.js` | `toast()` (event `notify`) and `discovery()` banner queue (event `discovery:new`) — a faithful visual analog of NMS's "New Discovery" banner, but the banner is **not clickable**; it does not open a catalog page because no catalog page exists. |
| Inventory | `src/ui/inventoryui.js` — class `InventoryUI` | Three tabs (`TABS`): **Cargo** (`_renderCargo` — one flat `gs.inventory[]` grid sized to `gs.maxSlots`, click-to-use / shift-click-to-jettison-×10, no drag-and-drop, no separate general/tech/cargo split), **Fabricate** (`_renderFabricate`/`_recipeCard` — a static recipe list against `RECIPES`, craft ×1/×5 buttons, not a slot-based crafting grid), **Wayfarer/Status** (`_renderStatus` — vitals bars, `UPGRADES` pip tracks with **no adjacency bonus concept**, ship card, voyage ledger, and a **discoveries tally row that shows only counts** (`Object.keys(disc[kind]).length`) — clicking a tally does nothing; there is no drill-down). Procedural canvas icons (`iconCanvas`/`CATEGORY_DRAW`) are a nice touch but orthogonal to the structural gap. |
| Galaxy map | `src/ui/mapui.js` — class `GalaxyMap` | Its own mini WebGL scene (`_buildScene`), `neighborsOf(id, SCAN_SECTORS=4)` capped at `MAX_STARS=64`, drag-orbit + wheel-zoom camera, hover/click picking (`_pickAt`), and a system dossier card (`_renderCard`: star class, faction, distance, planet count, biome chips). Selecting a star sets **one single field**, `gs.quests.vesperTarget` — there is no filter-mode concept at all (no economy/conflict/path-to-center recoloring), no multi-hop route planning, and no persistent "jumps remaining" HUD readout. |
| Mission log / board | `src/ui/questui.js` (`QuestUI`), `src/ui/missionboard.js` (`MissionBoard`) | `QuestUI` is a lore modal (`showLore`, event `lore:show`) plus a **passive** pinned tracker (`_renderTracker`) showing `gs.quests.active` (story contracts) and `gs.quests.board` (accepted missions) with no/have bars — there is no screen you *open* to review a full log. `MissionBoard.open(system)` is a single station-local board with `available`/`active` tabs and faction standing header — this is the closest analog to the Nexus board, but it is per-station, not a rotating galaxy-wide community board. |
| Build UI | `src/ui/buildui.js` — class `BuildUI` | A **passive bottom hotbar** (`_render`) driven by `'build:mode'` events — numbered piece chips, no radial, `isOpen` is hard-coded `false` (movement never pauses). |
| Photo mode | `src/ui/photomode.js` — class `PhotoMode` | `open()` clones the live camera into a free `THREE.PerspectiveCamera`, hides HUD (`hud.setMode('hidden')`) and game UI (`uiRoot.classList.add('ams-photo-hide')`), then drives WASD/QE fly (`update(dt)`) and drag-look (`_onMove`). `_buildBar()` exposes exactly **four** sliders: Fly Speed, FOV, Exposure, Bloom (conditionally), plus a Capture button (`capture()` → `canvas.toBlob` PNG download with a shutter-flash div). `H` toggles the bar's own visibility. No DoF, no filters/LUTs, no time-of-day, no pose, no cloud/atmosphere control, no aspect-ratio guides. |
| Menus/settings | `src/ui/screens.js` — class `Screens` | `mainMenu()`, `pause()`, `settings()`, `dead()` — all promise-based, keyboard-navigable overlays (`_bindKeys`) with a persisted `localStorage['ams-settings']`. `settings()` exposes exactly **three** controls: Volume, Mouse Sensitivity, Bloom toggle (`SETTINGS_DEFAULTS = { volume, sensitivity, bloom }`). No colorblind mode, no text size, no subtitles, no motion/head-bob toggle, no difficulty preset, no input remap screen. |
| Input | `src/core/input.js` | `KEYMAP` is a **hardcoded** object (`forward/back/interact/scan/photo/land/warp/...` → fixed `KeyCode` arrays). There is no remap storage, no conflict detection, no gamepad axis mapping, no UI to change it. |
| Widgets/theme | `src/ui/widgets.js`, `src/ui/style.css` | `el()`, `statBar()`, `iconSVG()` — small reusable primitives; all color driven by five CSS custom properties (`--ui-cyan/amber/red/green/violet` in `:root`, `style.css:7-12`). This is actually a **strong foundation** for a colorblind system (see §4.6) — the palette is already centralized, just never remapped. |

---

## 3. The gap

| # | Area | NMS | AllMansSky | Severity | Effort |
|---|---|---|---|---|:--:|
| 1 | Analysis-visor tagging | Aim-and-hold reticle tagging of individual creature/plant/mineral/POI, per-target name-plate + progress ring | Passive radius auto-sweep on a 6 s cooldown (`Scanner._collect`); no aim, no per-target confirm, no highlight-through-terrain | **[Structural]** | 3.5 wk |
| 2 | Discovery catalog data model | Full stat cards (temperament/diet/weight/resource value), weather table, per-planet roster, completion % | `discoveries[kind][key] = {name, at}` — three fields, no stats, no roster, no % | **[Structural]** | 3 wk |
| 3 | Discovery catalog UI (drill-down pages) | Galaxy→System→Planet→Catalog browsing, species cards, upload flow | Tally counts only in `InventoryUI._renderStatus`; zero drill-down | **[Structural]** | 3 wk |
| 4 | Species/discovery rename | First discoverer names species, persists galaxy-wide | Not present — `discover()` takes a generated `name` only | **[Feature]** | 0.5 wk |
| 5 | Galaxy map filter modes | Normal / Path-to-Center / Economy / Conflict / Settlement recoloring | One rendering mode; no filter concept in `GalaxyMap` at all | **[Feature]** | 2.5 wk |
| 6 | Galaxy map multi-hop routing | Plot a course through several systems, jumps-remaining HUD readout | Single-field `vesperTarget`; one hop, no route, no persistent readout | **[Feature]** | 1.5 wk |
| 7 | Radial quick-menu | 8–12 slice radial: summon, exocraft, tool mode, torch, emotes, terrain tool | None — every action is a flat hardcoded hotkey in `KEYMAP` (`torch: KeyT`, `vehicle: KeyN`, etc.) | **[Feature]** | 2 wk |
| 8 | Inventory grid separation | General / Cargo / Technology as independent grids with different stack rules | One flat `gs.inventory[]` array rendered as a single grid (`_renderCargo`) | **[Structural]** | 2.5 wk |
| 9 | Drag-and-drop + comparison tooltip | Drag items between grids/ships; hover-compare tech modules | Click-to-use / shift-click-discard only; no drag; `UPGRADES` pips have no comparison state | **[Feature]** | 2 wk |
| 10 | Install-tech slot-grid + adjacency | Slot-grid placement, same-type adjacency bonus recompute | `UPGRADES` is a flat per-track level counter (pips), no grid, no adjacency (feeds Volume 7) | **[Structural]** | 3 wk (shared w/ Vol 7) |
| 11 | Compass POI pings / persistent objective marker | Every known POI pings continuously with live distance; quest objective always shown | `HUD` supports exactly one `s.target`; `surfacestate.js` hard-sets it `null` — no on-foot objective ping at all | **[Feature]** | 1 wk |
| 12 | Mission Log screen | Openable full log: main/side/milestone missions with objective text | Passive pinned tracker only (`QuestUI._renderTracker`); no openable log screen | **[Feature]** | 1 wk |
| 13 | Nexus community board | Galaxy-wide rotating community missions, separate from per-station board | `MissionBoard` is per-station only, no rotation/community layer | **[Feature]** | 1.5 wk |
| 14 | Photo mode: depth of field | Focal distance + bokeh slider | Not present (post pipeline has no DoF pass at all — cross-refs Volume 1) | **[Feature]**/**[Engine]** | 1.5 wk |
| 15 | Photo mode: color filters/LUTs | Bank of grade presets | Only raw Exposure/Bloom sliders | **[Cosmetic]** | 1 wk |
| 16 | Photo mode: time-of-day, pose, cloud/atmosphere | Independent sliders | None of the three exist | **[Feature]** | 2 wk |
| 17 | Colorblind modes | 3 presets remapped across HUD + markers | Zero — theme is static CSS vars, never remapped | **[Structural]** | 1.5 wk |
| 18 | Text size / subtitle background / subtitles | Independent scaling + bg opacity + subtitle track | None — no subtitle system exists at all (audio has no dialogue lines to caption yet) | **[Feature]** | 1.5 wk |
| 19 | Motion/head-bob/shake/auto-run toggles | Independent toggles | None present in `Screens.settings()` | **[Feature]** | 1 wk |
| 20 | Input remapping | Full KBM/gamepad rebind UI with conflict detection | `KEYMAP` hardcoded in `core/input.js`, no UI, no persistence | **[Structural]** | 2.5 wk |
| 21 | Difficulty presets + custom sliders | Normal/Survival/Permadeath/Creative + ~24 sliders | No difficulty concept anywhere in `GameState` | **[Structural]** | 2 wk (cross-refs Volume 11) |
| 22 | Settings breadth | Dozens of independent controls | `settings()` exposes 3: volume, sensitivity, bloom | **[Structural]** | *(rolled into 17–21)* |

**Total itemized effort: ~34 engineer-weeks** (see §6 for phased rollup and shared-dependency discount).

---

## 4. Target design

### 4.1 Discovery catalog data model

Replace the three-field `discoveries` book with a typed catalog keyed by a stable discovery id (`systemId:planetIndex:kind:slug`):

```js
// src/gameplay/discovery.js
/** @typedef {{
 *   id: string,                // 'sysA1B2:2:fauna:skitterling'
 *   kind: 'fauna'|'flora'|'mineral'|'poi'|'planet'|'system',
 *   systemId: string, planetIndex: number|null,
 *   genus: string,              // stable procedural family key (re-tag safe)
 *   name: string,               // generated, overwritable via rename()
 *   renamedBy: string|null,
 *   stats: object,              // kind-specific: fauna {temperament,diet,size,value}
 *                                //   mineral {value,abundance} poi {faction,threat}
 *   biomeSnapshot: { biome:string, weather:string, tempC:number },
 *   discoveredAt: number,       // Date.now()
 *   firstOfSave: boolean,       // save-wide first-discovery bonus already paid?
 *   uploaded: boolean,
 *   value: number,
 * }} DiscoveryEntry */

export class DiscoveryCatalog {
  constructor() { this.entries = new Map(); this.planetRosters = new Map(); }

  /** Called once per generated planet (surfacestate.enter) to fix the total
   *  roster size so completion % is stable regardless of scan order. */
  registerPlanetRoster(planetId, { faunaGenera, floraGenera, mineralTypes, poiCount }) {
    this.planetRosters.set(planetId, { faunaGenera, floraGenera, mineralTypes, poiCount });
  }

  add(entry) { /* idempotent by id; returns {isNew, isFirstOfSave} */ }
  rename(id, newName) { /* sets renamedBy + name */ }
  completion(planetId) {
    const roster = this.planetRosters.get(planetId);
    const found = [...this.entries.values()].filter((e) => e.planetId === planetId);
    const total = roster.faunaGenera + roster.floraGenera + roster.mineralTypes + roster.poiCount;
    return total ? found.length / total : 0;
  }
}
```

`GameState` keeps a `DiscoveryCatalog` instance instead of the flat `discoveries` object; `discover()` becomes a thin adapter that also builds a `DiscoveryEntry` so existing Lumens-payout call sites (`scanner.js`) do not need to change shape, only import.

### 4.2 Visor-tag flow (aim-based scanning)

Replace `Scanner._collect`'s auto-sweep with an aim-confirm loop layered *on top of* the existing pulse (keep the pulse for ambient POI discovery; add aim-tagging for the "NMS-authentic" ritual):

```js
// src/gameplay/visor.js
class AnalysisVisor {
  constructor(gs, catalog) { this.gs = gs; this.catalog = catalog; this.holdT = 0; this.target = null; }

  /** called every frame while the scan button is held */
  update(dt, camera, taggables) {
    const hit = raycastNearestTaggable(camera, taggables, MAX_TAG_RANGE);
    if (hit !== this.target) { this.target = hit; this.holdT = 0; }
    if (!hit) return null;
    this.holdT += dt;
    const pct = Math.min(1, this.holdT / hit.scanDuration);
    if (pct >= 1 && !hit.tagged) {
      hit.tagged = true;
      const entry = buildEntry(hit);                       // genus/stats/biomeSnapshot
      const { isNew, isFirstOfSave } = this.catalog.add(entry);
      if (isNew) {
        this.gs.addLumens(entry.value * (isFirstOfSave ? 3 : 1));
        events.emit('discovery:new', { kind: entry.kind, name: entry.name,
          value: entry.value, first: isFirstOfSave, catalogId: entry.id });
        events.emit('waypoint:pin', { worldPos: hit.position, kind: entry.kind, label: entry.name });
      }
    }
    return { target: hit, pct };                            // HUD reads this for the name-plate ring
  }
}
```

`HUD` gains a `_buildVisorPlate()` cluster (name text + SVG progress ring, hidden unless `update()` returns a target) — reuses the existing `statBar`-style change-gating pattern already established in `hud.js`.

### 4.3 Galaxy map filter modes

```js
// mapui.js — extend GalaxyMap
const FILTERS = {
  normal:  { recolor: (rec) => rec.stub.starColorHex },
  economy: { recolor: (rec) => ECONOMY_COLOR[systemInfo(rec).economyTier] },
  conflict:{ recolor: (rec) => CONFLICT_COLOR[systemInfo(rec).conflictLevel] },
  pathToCenter: { recolor: (rec) => onPilgrimageArc(rec) ? '#ffd98c' : DIM_GRAY,
                  overlay: (scene) => drawArcPolyline(scene, pilgrimagePath(currentId)) },
};

setFilterMode(mode) {
  this._filterMode = mode;
  for (const rec of this._records) {
    const c = new THREE.Color(FILTERS[mode].recolor(rec));
    rec.sprite.material.color.copy(c);
  }
  this._legend.render(mode);       // swaps the bottom-left legend chips per mode
}
```
A new tab strip (`ECON / CONFLICT / PATH / NORMAL`) sits in the map header (`_buildDom`) beside the existing close button, driven by number keys `1–4` for parity with the inventory tab pattern already used in `inventoryui.js`.

### 4.4 Radial quick-menu

```js
// src/ui/quickmenu.js
const SLICES = [
  { id: 'summonShip', icon: 'ship', label: 'SUMMON SHIP', action: (ctx) => ctx.summonShip() },
  { id: 'exocraft',   icon: 'rover', label: 'SUMMON ROVER', action: (ctx) => ctx.summonExocraft() },
  { id: 'toolMode',   icon: 'tool', label: 'TOOL MODE', action: (ctx) => ctx.cycleToolMode() },
  { id: 'torch',      icon: 'torch', label: 'TORCH', action: (ctx) => ctx.toggleTorch() },
  { id: 'terrain',    icon: 'terrain', label: 'TERRAIN TOOL', action: (ctx) => ctx.toggleTerrainMode() },
  { id: 'build',      icon: 'build', label: 'BUILD MENU', action: (ctx) => ctx.openBuild() },
  { id: 'emote',      icon: 'emote', label: 'EMOTE', action: (ctx) => ctx.openEmoteSub() },
];

class QuickMenu {
  open() { this._t0 = performance.now(); this.root.style.display = 'flex'; /* time-scale hook */ }
  _angleFor(i) { return (i / SLICES.length) * Math.PI * 2 - Math.PI / 2; }
  _pick(mouseAngle) {
    const step = (Math.PI * 2) / SLICES.length;
    return SLICES[Math.round(mouseAngle / step) % SLICES.length];
  }
  close(commit) { if (commit) commit.action(this.ctx); this.root.style.display = 'none'; }
}
```
Bound to a new `quickmenu` action in `KEYMAP` (hold `G`... but `G` is taken by `land`; use `CapsLock` or a dedicated `KeyQ`-free binding — resolve during remap-table design in §4.6). `main.js`'s `_loop()` gains the same `ui.anyOpen()` gating pattern already used for inventory/map.

### 4.5 Inventory: three grids + install-tech UI

```js
// gameplay/state.js — replace flat `inventory` array with three typed grids
this.inventory = {
  general:    new Grid(GENERAL_SLOTS),   // consumables/curiosities, stack≤up to ITEMS[id].stack
  cargo:      new Grid(CARGO_SLOTS),     // raw resources, large stacks
  technology: new SlotGridGraph(TECH_ROWS, TECH_COLS), // non-stacking, adjacency-aware
};
```
`SlotGridGraph` (feeds Volume 7's ship/exosuit slot-grid target directly — same class is reused there) exposes `place(item, x, y)`, `adjacencyBonus(x, y)`, and `remove(x, y)`; `InventoryUI` renders it as a 2D board instead of `UPGRADES` pips, with drag handlers (`dragstart`/`dragover`/`drop` on each cell) replacing the current click-only model. A hover comparison tooltip diffs `item.stats` against the currently-installed module at the target slot.

### 4.6 Accessibility settings schema

```js
// src/ui/accessibility.js
const A11Y_DEFAULTS = {
  colorblindMode: 'none',            // 'none'|'protanopia'|'deuteranopia'|'tritanopia'
  textScale: 1.0,                    // 0.85–1.5, applied as rem multiplier on #ui-root
  subtitleBgOpacity: 0.6,
  subtitlesEnabled: true,
  motionBlur: true, cameraShake: true, headBob: true,
  autoRun: false, reduceFlash: false,
  difficulty: 'normal',              // 'normal'|'survival'|'permadeath'|'custom'
  custom: { hazardDrainMult: 1, fallDamageMult: 1, resourceScarcityMult: 1, fuelUseMult: 1, deathPenalty: 'dropInventory' },
  keybinds: {},                      // overrides layered onto core/input.js KEYMAP
};

const COLORBLIND_PALETTES = {
  protanopia:   { '--ui-red': '#c7a600', '--ui-green': '#4d9bff', '--ui-amber': '#ffcf3d' },
  deuteranopia: { '--ui-red': '#c7a600', '--ui-green': '#3f8fdb', '--ui-amber': '#ffd166' },
  tritanopia:   { '--ui-cyan': '#ff8fb4', '--ui-amber': '#ffb454' /* least affected */ },
};

function applyA11y(settings) {
  const root = document.documentElement;
  root.style.fontSize = `${16 * settings.textScale}px`;
  root.dataset.colorblind = settings.colorblindMode;
  const pal = COLORBLIND_PALETTES[settings.colorblindMode] ?? {};
  for (const [k, v] of Object.entries(pal)) root.style.setProperty(k, v);
  else-branch: /* 'none' clears overrides by removing inline var */
}
```
Because the theme already centralizes every semantic color into five `:root` custom properties (`src/ui/style.css:7-12`), a colorblind mode is a **pure CSS-variable override** — no per-component rewrite needed. `Screens.settings()` gains four new panels (Display/Accessibility/Controls/Difficulty) reusing the existing `slider()`/toggle patterns already built for Volume/Sensitivity/Bloom.

Input remap layers a `keybinds` override object over the static `KEYMAP` in `core/input.js`: `actionPressed(name)` resolves `settings.keybinds[name] ?? KEYMAP[name]`, with a rebind-capture UI (`press any key…` prompt) and simple conflict detection (warn if the code is already bound to another action).

### 4.7 Photo mode: filters, DoF, time-of-day

- **LUT/filter bank**: cheapest correct implementation without an engine change is a `ShaderPass` added to the existing `engine.composer` chain (already present for bloom — Volume 1 confirms a `composer`/`bloomPass` exist) applying a 3D-LUT-as-2D-strip texture sampled in-shader; ship 6–8 procedurally generated LUTs (matrix color-grades — no external assets, consistent with the zero-asset rule) selectable via thumbnail swatches in the photo bar.
- **DoF**: a simple circle-of-confusion post pass keyed off scene depth (already renderable since three.js writes depth) — gated as `[Engine-adjacent]` because it depends on Volume 1's post-pipeline maturity, but implementable standalone in `photomode.js` without touching gameplay rendering.
- **Time-of-day slider**: photo mode already owns its own camera; extend it to also own a **cloned copy** of the sun/sky uniforms so scrubbing doesn't affect the live game clock, restored on `close()` exactly like `_savedExposure`/`_savedBloom` today.
- **Pose**: requires a small fixed set of authored idle poses for the player mesh (crosses into Volume 16's "authored asset" carve-out) — out of scope for a pure-procedural pass; flag as **[Feature, asset-dependent]**.

### 4.8 Module/file plan

| File | Status | Purpose |
|---|---|---|
| `src/gameplay/discovery.js` | **new** | `DiscoveryCatalog`, `DiscoveryEntry`, roster/completion math |
| `src/gameplay/visor.js` | **new** | Aim-tag raycast + hold-to-confirm state machine |
| `src/ui/discoveryui.js` | **new** | Galaxy→System→Planet→Catalog drill-down screens |
| `src/ui/quickmenu.js` | **new** | Radial quick-menu |
| `src/ui/accessibility.js` | **new** | Settings schema, colorblind palette application, remap capture |
| `src/ui/hud.js` | **modify** | Multi-POI compass pings, visor name-plate cluster, persistent quest-objective target |
| `src/ui/mapui.js` | **modify** | Filter-mode tab strip, multi-hop route plotting, `setFilterMode()` |
| `src/ui/inventoryui.js` | **modify** | Three-grid layout, drag-and-drop, tech slot-grid + comparison tooltip |
| `src/ui/photomode.js` | **modify** | LUT swatch bar, DoF slider, time-of-day clone, aspect guides |
| `src/ui/screens.js` | **modify** | New Display/Accessibility/Controls/Difficulty settings panels |
| `src/ui/questui.js` | **modify** | Add an openable full Log screen alongside the existing passive tracker |
| `src/ui/missionboard.js` | **modify** | Add a galaxy-wide rotating "Nexus" tab distinct from per-station board |
| `src/gameplay/state.js` | **modify** | Replace flat `discoveries` with `DiscoveryCatalog`; add `settings`/`a11y` block |
| `src/core/input.js` | **modify** | Layer `keybinds` override over `KEYMAP`; export `setKeybind()` |

---

## 5. Phases

| Phase | Scope | Depends on |
|---|---|---|
| **1 — Data foundation** | `DiscoveryCatalog`, roster registration on planet-gen, `discover()` adapter, save/load migration | — |
| **2 — Visor + catalog UI** | `AnalysisVisor` aim-tag loop, HUD name-plate cluster, `discoveryui.js` drill-down screens, rename flow | Phase 1 |
| **3 — Map filters + routing** | `setFilterMode()`, economy/conflict data on `StarSystem`, multi-hop route plot + jumps-remaining HUD | — (parallel to 1–2) |
| **4 — Inventory restructure** | Three-grid split, drag-and-drop, `SlotGridGraph` + adjacency (shared build with Volume 7) | — (parallel) |
| **5 — Quick menu + build hookup** | `quickmenu.js`, rebind `KEYMAP`, wire summon/torch/terrain-tool/emote actions | Phase 4 (tool-mode cycling reads inventory state) |
| **6 — Accessibility matrix** | `accessibility.js`, four new settings panels, colorblind CSS-var swap, text scale, input remap UI | — (parallel) |
| **7 — Photo mode depth** | LUT shader pass, DoF pass, time-of-day clone, aspect guides | Volume 1 post-pipeline maturity for DoF only |
| **8 — Log + Nexus board** | Openable mission log screen, rotating community board | — (parallel, low risk) |

Phases 3, 4, 6, 8 have no hard dependency on 1–2 and can run concurrently with a second engineer; phase 7's DoF sub-item is the only true cross-volume blocker.

---

## 6. Effort & risk

| Phase | Engineer-weeks | Key risk |
|---|:--:|---|
| 1 — Data foundation | 3 | Save-migration for existing `discoveries` blobs must not orphan old saves |
| 2 — Visor + catalog UI | 6 | Raycast-based tagging must stay perf-cheap against dozens of props/creatures per frame |
| 3 — Map filters + routing | 4 | Economy/conflict tiers must be generated deterministically per system (extends `universe/starsystem.js`, Volume 4 territory) |
| 4 — Inventory restructure | 5 | `SlotGridGraph` is shared with Volume 7's ship/exosuit target — scope creep risk if built in isolation |
| 5 — Quick menu | 2 | Time-scale-on-open needs care not to desync physics/audio (reuse pause-adjacent patterns from `Screens.pause()`) |
| 6 — Accessibility matrix | 4 | Input remap conflict detection is fiddly; colorblind palettes need real contrast validation, not eyeballing |
| 7 — Photo mode depth | 3 (LUT+ToD) + 2 (DoF, engine-adjacent) | DoF quality is capped by WebGL2 depth-buffer precision until Volume 1's pipeline lands |
| 8 — Log + Nexus board | 2 | Low risk, mostly UI plumbing over existing `quests.js` data |
| **Total** | **~29 engineer-weeks (~7 engineer-months)** | — |

This is a **[Feature]/[Structural]-dominated** volume with almost no `[Engine]` blockers — the single exception (DoF quality) is soft-blocked, not hard-blocked, and can ship at reduced fidelity immediately. That makes UI/UX one of the best experience-per-effort investments in the whole report: no other volume converts ~7 engineer-months into this much visible, testable parity gain.

---

## 7. Acceptance criteria

All must be verifiable headless (Playwright + SwiftShader, per the project's existing test harness), driven through `window.__AMS__.game` the way `main.js` already exposes it for debug boots.

1. **Scanning tags a resource and adds a catalog entry.** Boot with `?state=surface`, hold the scan action aimed at a known prop for `hit.scanDuration`; assert `game.gameState.discoveries.entries` (or `DiscoveryCatalog.entries`) gains exactly one new entry with the correct `kind`/`genus`, and that `events` fired exactly one `discovery:new`.
2. **A galaxy-map filter recolors systems.** Open the map, call `map.setFilterMode('economy')`, and read back `rec.sprite.material.color.getHexString()` for at least two systems with known differing economy tiers — assert the hex values differ from `setFilterMode('normal')`'s output and match `ECONOMY_COLOR[tier]`.
3. **A colorblind toggle changes the palette.** Call `applyA11y({ ...defaults, colorblindMode: 'deuteranopia' })`, then read `getComputedStyle(document.documentElement).getPropertyValue('--ui-green')` — assert it differs from the default `#7dffb4` and matches `COLORBLIND_PALETTES.deuteranopia['--ui-green']`.
4. **Discovery completion % is stable and correct.** For a planet with a registered roster of `N` taggable entries, tag `k` of them and assert `catalog.completion(planetId) === k / N` regardless of scan order.
5. **Radial quick-menu commits the correct action.** Open the quick menu, simulate a pointer angle matching slice index 2 (`torch`), release, and assert the corresponding `ctx.toggleTorch()` mutation occurred (torch state flipped) and no other slice's action fired.
6. **Inventory grids are independently typed.** Assert `gameState.inventory.technology` rejects a `cargo`-category item (`place()` returns `false`) and that `gameState.inventory.cargo.maxStack` differs from `general.maxStack` per `ITEMS[id].stack`.
7. **Photo-mode LUT applies a shader uniform.** Open photo mode, select LUT index 3, and assert `engine.composer.passes` contains the LUT pass with `uniforms.uLutIndex.value === 3`; `capture()` still produces a non-empty PNG blob.
8. **Input remap persists and resolves.** Call `setKeybind('scan', 'KeyZ')`, reload settings from `localStorage`, and assert `input.actionPressed('scan')` now responds to `KeyZ` and no longer to the old `KeyV` binding.
9. **Compass shows a persistent on-foot objective ping.** With an active quest that has a world-position objective, assert `hud._targetLine.textContent` is non-empty while on foot (regressing the current hard-coded `target: null` in `surfacestate.js`).

Passing all nine is the bar for calling this volume's Phase 1–6 scope "done"; Phase 7 (photo-mode DoF) and Phase 8 (Nexus board) are acceptance-tested separately since they're lower-risk, lower-priority adds.
