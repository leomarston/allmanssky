# Volume 7 — Ships, Multitools, Exocraft & Exosuit

Scope: starship acquisition/customization, the handheld multitool, land/sea exocraft, and the exosuit/inventory model that underpins all of them. Source cited throughout is the actual AllMansSky tree (~22,900 lines, WebGL2 + three.js@0.160, zero external assets — every mesh, texture and icon is generated at runtime from a seed).

---

## 1. What No Man's Sky does

### 1.1 Starships

NMS ships are drawn from **five standard archetypes** plus **three special hull families**, each with a class letter (**C → B → A → S**) that multiplies its stat roll. Archetype sets a *bias* — which stats roll high — not a hard cap; a Hauler *can* roll good shields, it just won't roll good maneuverability.

| Archetype | Stat bias | Notable trait | Source |
|---|---|---|---|
| Fighter | Damage, maneuverability | Most weapon hardpoints; small cargo | Purchase / crash / freighter |
| Explorer | Hyperdrive range, scan range | Best warp-per-jump distance | Purchase / crash / freighter |
| Hauler | Cargo (general + tech slot count) | Largest inventory of any archetype | Purchase / crash / freighter |
| Shuttle | Nothing (flat, low rolls across the board) | Cheapest, weakest; default starter silhouette family | Purchase / starting ship |
| Exotic | Balanced-high across all stats | Unique one-off silhouettes, no two alike | Purchase (rare, high-tier stations) |
| Solar | Hyperdrive fed by starlight, no launch fuel needed near stars | Distinct sail/wing silhouette, Photon Cannon tech | Expedition reward, purchase |
| Living Ship | Organic tech tree, grows instead of installing modules | Obtained as an egg/larva, "grown" via quest (*Awakenings*) | Quest chain only |
| Sentinel Interceptor | Unique interceptor-only tech (Positron Ejector, Aeration Membrane) | Angular chrome hull, obtained by destroying a Sentinel capital ship | Quest chain only |

Grade multiplies the *roll ceiling* for hull, shield, hyperdrive range and damage — a C-class Hauler and an S-class Hauler share a hardpoint/slot-count budget for their archetype, but the S-class rolls closer to the top of every stat's range (~+30-50% over C, non-linear per stat).

**Procedural generation.** Ship *visuals* are not free-form procedural meshes — NMS recombines a large **authored part kit** (fuselage segments, wing sets, cockpit canopies, engine nacelles, decals) per archetype, then applies a **seeded color palette** (2-3 tones + trim) and randomizes part *selection and scale* within archetype-appropriate bounds. Two ships of the same archetype/seed-bucket can look related but never identical; the variety ceiling is the authored library, not the algorithm.

**Inventory.** Every ship (and multitool, exosuit, freighter) uses the same **slot-grid** primitive: a rectangular grid of slots split into **General** (raw cargo, stacks trade goods/resources) and **Technology** (installed upgrade modules) tabs, with slot *count* scaling by archetype and by an upgrade path (crashed-ship slot expansion, purchasable slots). Technology modules occupy 1+ contiguous cells and carry a **rarity/type color** (yellow=weapon, blue=hyperdrive, green=shield, cyan=scanner, etc.).

**Adjacency bonus.** Installing two or more tech modules of the *same upgrade family* (e.g. two Photon Cannon upgrades) so their cells **share an edge** (not just a corner) grants each a cumulative output bonus — colloquially "the adjacency bonus." It's visualized as a colored glow that brightens/link-lines when the grid is arranged correctly, and it typically adds several percentage points of stat per adjacent same-color neighbor, stacking with the module's own rarity tier.

**Supercharged slots.** A ship (and exosuit, and multitool) has a fixed number of **pre-placed supercharged cells** (visually distinct hex outline) baked into that specific hull instance at spawn — usually 2-4, sometimes clustered, sometimes scattered. Any tech module placed *in* a supercharged cell gets a large fixed multiplier (~+34-49%) regardless of adjacency. Because supercharged cell *positions* are fixed per hull, players farm/reroll hulls (or repair crashed ships) hunting for favorable supercharged clustering as much as they hunt for S-class grade.

**Acquisition.**
- **Buy** at a station or trade-post shipyard: a rotating stock of N offers, price scaling with archetype + grade.
- **Claim a crashed ship**: found via signal scanners on planet surfaces, heavily damaged (broken slots, mostly non-functional inventory), free to claim but requires a multi-stage resource repair (~3 tiers of Ferrite/Carbon/etc.) to fly; a common S-class-hunting strategy because crash sites reroll archetype/class/slot layout independent of price.
- **Freighter hangar**: capital-ship freighters carry a bay of frigate-scale ships you can fly for free once you own the freighter.
- **The Anomaly (Exotic dealer)**: a rotating Exotic-archetype-only shipyard, currency Quicksilver, not lumens/units.
- **Scrapping**: deconstructing an unwanted ship at a shipyard converts its modules into partial nanite/unit refund instead of losing them outright.
- **S-class hunting**: since class is rolled at generation, players repeatedly reroll crashed-ship or shipyard-offer seeds (in-fiction: keep discovering new sites) until an S-class of the desired archetype with good supercharged placement appears.

**Stats tracked**: hull/shield HP, damage (weapon DPS), hyperdrive jump range (ly), maneuverability (turn rate), warp cell consumption per jump, launch-fuel consumption.

### 1.2 Multitools

Multitools come in **types** — Pistol (compact sidearm silhouette), Rifle (standard alloy long-arm), Experimental (curved, non-standard geometry), Alien (organic bio-mechanical), Sentinel (angular chrome, sentinel-drop only), Atlantid (Autophage/crashed-sentinel questline only) — each type gating which authored part kit it draws from, independent of the **class** letter (C→S) that scales its stat ceiling exactly like ships. Multitools carry their own **slot grid** (smaller than a ship's) with the same **General/Technology** split, **adjacency bonus**, and **supercharged slots**.

Installable technology spans mining/combat/utility:

| Tech | Function |
|---|---|
| Mining Beam | Primary resource-extraction beam, upgradeable damage/heat |
| Analysis Visor | Scans flora/fauna/minerals/points of interest for currency + database entries |
| Terrain Manipulator | Sculpts/flattens terrain in a radius; separate from combat |
| Scanner | Passive resource/points-of-interest pulse and radius |
| Boltcaster | Semi-auto kinetic sidearm-tier weapon |
| Pulse Spitter | Rapid-fire automatic weapon |
| Scatter Blaster | Shotgun-pattern close-range weapon |
| Blaze Javelin | Charged sniper weapon |
| Neutron Cannon | Heavy slow-fire high-damage weapon |
| Plasma Launcher | Explosive/splash weapon |
| Personal Forcefield | Player shield module, reduces incoming damage |

Acquisition mirrors ships: buy from a multitool dealer (station kiosk or the Anomaly), find at crash-site multitool caches (partially broken, cheap to repair/claim), or receive as unique quest rewards (Sentinel and Atlantid types are quest-gated, not purchasable).

### 1.3 Exocraft

A full **roster** of summonable vehicles, each with its own three-slot exocraft tech tree (boost, mining laser/cannon, scanner) shared across the family:

| Exocraft | Role |
|---|---|
| Roamer | Starter 4-wheel all-terrain buggy |
| Nomad | Light, fast hover-assisted speedster |
| Colossus | Heavy mobile base — carries its own storage, doubles as a mobile Exocraft Summoning Station |
| Pilgrim | Two-wheeled hoverbike, fastest single-passenger craft |
| Minotaur | Bipedal walker mech; pilotable directly *or* set to AI companion mode where it follows and fights automatically |
| Nautilon | Submarine; only exocraft capable of sustained underwater travel, has its own sonar/scan and mining-laser variant tuned for underwater nodes |

Every exocraft is unlocked by crafting/buying its blueprint once, then building an **Exocraft Summoning Station** at a base; after that it can be **summoned anywhere on that planet** (not just near the base) via the quick menu — a deliberate "we own this, not just this landing pad" convenience. Planetary **exocraft races** (checkpoint circuits against AI racers) are a discrete activity built on the same summon+drive loop.

### 1.4 Exosuit

The exosuit is the player's own slot grid: **General / Technology / Cargo** tabs (Cargo added later as a third pool distinct from General), starting small and expanded two ways — **drop pods** found in the world (each grants exactly one free extra General or Cargo slot, one-time, then that pod is spent) and **purchasable slots** at the Anomaly's appearance/inventory vendor (escalating currency cost per additional slot). Installed suit tech covers health (extra max HP nodes), hazard protection (radiation/toxic/cold/heat resist, each a separate module family), life support (oxygen tank capacity/regen), movement (sprint speed, jetpack fuel capacity, jetpack thrust/efficiency, underwater/jump/roll modules), plus utility (translator, scan-range boosters, etc.) — all placed in the same slot-grid-with-adjacency-and-supercharged system as ships and multitools.

---

## 2. What we have

AllMansSky implements a **fixed-track upgrade model wrapped around a real multi-class procedural ship system** — more ship variety than the brief's "one ship" framing suggested, but none of the slot-grid/adjacency/supercharged machinery, and only one exocraft.

### 2.1 Ships

`src/render/shipmesh.js` procedurally builds **five ship classes** — `swift`, `talon`, `dray`, `prospect`, `vanta` — each with a dedicated assembler function (`buildSwift`, `buildTalon`, `buildDray`, `buildProspect`, `buildVanta`, dispatched via `CLASS_BUILDERS` in `buildShip(seed, shipClass)`). `SHIP_CLASS_INFO` in `src/gameplay/shipmarket.js` maps these onto NMS-style **roles**: Swift=Explorer, Talon=Fighter, Dray=Hauler, Prospect=Miner, Vanta=Exotic. Each assembler is a distinct hand-authored kitbash procedure (different fuselage section counts, wing planforms, greebles — e.g. `buildDray` adds slung cargo-pod rails and triple engines, `buildProspect` adds saddle tanks and forward drill arms, `buildVanta` is deliberately *asymmetric*, one grand blade wing and a bare canard), built from a shared `ShipKit` toolkit (`fuselage()`, `wingPair()`, `canopy()`, `engine()`, `fin()`, `skid()`, `antenna()`, `greebles()`) — this **is** a real "procedural assembly from a part kit" system, just with far fewer authored recipes (5) than NMS's per-archetype libraries. Hull paint is a from-scratch canvas texture (`makePaintTexture`) with seeded panel lines, stripes, decals and wear, picked from one of 4 palette "schemes." `src/render/cockpit.js` gives each class its own first-person cockpit flavor (`CLASS_STYLES`: pillar width, lean, greeble count, pipes, overhead brace) tinted to match.

`src/gameplay/shipmarket.js` implements a real **grade ladder**: `GRADES = ['C','B','A','S']`, `CLASS_BASE` holds per-class baseline stats (price, hullMax, shieldMax, maxSpeedMult, agility, boostMult, cargoBonus), and `GRADE_STAT_MULT`/`GRADE_PRICE_MULT` scale them (S ≈ 1.35× stats, 4.0× price). `rollGrade`/`rollClass` are tier-weighted (station tier 0-1 pushes odds toward A/S and unlocks Vanta), so **higher-tier locations sell better ships** — a real echo of NMS's "better stations sell better ships." `offersFor(locationKey, count)` produces a **deterministic offer list per location** (`hashString(locationKey)` seeds it — same station always sells the same 4 hulls). `tradeInValue()` credits 30% of the currently-flown ship's equivalent price; `applyShipPurchase()` performs a **wholesale swap**: `gs.ship` is fully replaced (new class/seed/name/hull/shield at full), only `fuel` fraction and `warpCells` carry over. `src/ui/shipyardui.js` renders this as a hangar of 4 live-rotating 3D-thumbnail cards with comparative stat bars against the currently-flown hull, grade badges, and a buy button gated on `afford`.

### 2.2 Rover exocraft

`src/gameplay/rover.js` (`RoverController`) + `src/render/exocraft.js` (`buildRover`) implement exactly **one** exocraft type — a 4-wheel buggy. It is unlocked once (`gs.exocraft.unlocked`, purchased as "Exocraft Geobay" for 2,500 lumens in `src/ui/tradeui.js`) and then **summonable anywhere** via `summon(nearPos, facing)` — this one mechanic is a faithful, if singular, parity hit for NMS's Exocraft Summoning Station convenience. Handling is arcade (speed/accel/brake/steer constants, four independently-sprung wheel contacts averaged for suspension, terrain-normal banking, a hard water stop, a max-climb slope cutoff). Headlights are real `THREE.SpotLight`s toggled with `T`. There is no tech tree (no boost/mining-laser/scanner/cannon modules), no second vehicle, no submarine, no mech, and no races.

### 2.3 Multitool

`src/render/arcforge.js` (`createArcforge`) is **one** first-person multitool — "the Arcforge" — with **three swappable emitter-head modes**, `ARCFORGE_MODES = ['mine', 'bolt', 'dig']`, each with its own geometry variant (focusing-crystal prongs / twin accelerator rails / wide scoop) and glow color (amber/cyan/green), and a 0.15 s twirl animation on mode swap. Functionally this already maps cleanly onto three real NMS multitool techs:

| Arcforge mode | NMS tech equivalent | Implemented in |
|---|---|---|
| `mine` | Mining Beam | `src/gameplay/mining.js` `GroundMining.update()` |
| `bolt` | Boltcaster | `src/gameplay/combat.js` `GroundCombat.update()` (fires on `gs.tool.mode==='bolt'`) |
| `dig` | Terrain Manipulator | `src/gameplay/mining.js` `GroundMining._updateDig()` — carves real heightfield bowls via `surface.field.addDig()` |

Two flat upgrade tracks scale it: `toolMine` (`+0.5×` beam speed per level, `Focus Crystals`) and `toolBolt` (`+35%` fire rate per level, `Arc Chamber`), both max level 3, defined in `UPGRADES` (`src/gameplay/items.js`) and purchased with crafted materials + lumens via `src/ui/tradeui.js`. There is only ever **one multitool** — no types, no classes, no acquisition variety, no Analysis Visor, Scanner, Pulse Spitter, Scatter Blaster, Blaze Javelin, Neutron Cannon, Plasma Launcher, or Personal Forcefield tech.

### 2.4 Exosuit / inventory

`src/gameplay/state.js` (`GameState`) models the exosuit as a **flat stacking array**, not a slot grid: `this.inventory = []` — `[{id, qty}]`, one entry per item type, capped by `maxSlots = BASE_SLOTS(24) + upgrades.shipCargo*8 + (ship.stats?.cargoBonus ?? 0)`. `addItem`/`removeItem`/`countItem` operate on this array; the UI (`src/ui/inventoryui.js`) renders it as a uniform icon grid (`CARGO HOLD` tab) with no tab split for tech vs. general vs. ship-cargo-vs-suit-cargo — **there is one inventory pool for the whole game**, shared by the ship's `cargoBonus` and the `shipCargo` upgrade track alike (the upgrade's own tooltip in `tradeui.js` even says "adds 8 **exosuit** cargo slots," confirming ship and suit cargo are the same pool in code, not two).

Vitals (`healthMax/health`, `shieldMax/shield`, `oxygenMax/oxygen`, `energyMax/energy` as the sole "hazard protection" stat, `jetpack` 0..1) live directly on `GameState` and are driven by `src/gameplay/survival.js` (`Survival.update`) — oxygen drains by atmosphere density, hazard (`heat/cold/toxic/rad`, whichever is highest) drains `energy` then `health`, shield regens after 4 s without a hit. There is exactly **one** suit augment track, `suitEnergy` ("Dawn Battery," `+40` max energy per level, max level 3) — no separate radiation/toxic/cold/heat modules, no life-support-capacity upgrade, no jetpack-fuel-capacity or sprint-speed upgrade, no translator, no scan-range booster. `src/gameplay/player.js` implements jetpack fuel/regen and movement directly against fixed constants that upgrades never touch.

### 2.5 What's absent entirely

No crashed-ship discovery/claim/repair flow, no freighter (hence no freighter hangar bay), no Anomaly/Exotic dealer, no scrapping-for-refund, no multitool types/classes/dealer, no Nomad/Colossus/Pilgrim/Minotaur/Nautilon, no exocraft tech tree or races, no drop pods, no slot grid anywhere in the codebase, no adjacency bonus, no supercharged slots. `Grep` for `adjacency|supercharged|slot.?grid` across `src/` returns zero hits.

---

## 3. The gap

| # | Area | NMS | AllMansSky | Severity | Effort (eng-wk) |
|---|---|---|---|---|---|
| 1 | Ship archetype variety | 5 standard + 3 special (8 total), each with its own authored part library | 5 classes, one shared part-kit toolkit, one assembler each | Feature | 3 |
| 2 | Ship grade system | C/B/A/S multiplies stat ceiling, independent roll per hull | C/B/A/S multiplies a flat per-class baseline — deterministic, not per-instance-random | Cosmetic | 0.5 (already close) |
| 3 | Ship acquisition — shipyard buy | Stock rotates, price by archetype × grade | Implemented (`offersFor`, deterministic per station) | — (parity) | 0 |
| 4 | Ship acquisition — crashed ships | Find via signal, free claim, tiered resource repair, rerolls layout | Absent | Structural | 4 |
| 5 | Ship acquisition — freighter hangar | Own a freighter, fly its frigate bay ships free | No freighter system at all | Structural | 8 (freighter is its own volume-scale feature) |
| 6 | Ship acquisition — Anomaly/Exotic dealer | Rotating Exotic-only stock, alt currency | No Anomaly hub exists | Structural | 5 |
| 7 | Ship acquisition — scrapping | Deconstruct unwanted ship for partial refund | `tradeInValue()` gives 30% credit on purchase only, no standalone scrap action | Feature | 0.5 |
| 8 | Ship inventory — slot grid | Grid, General/Tech tabs, per-class slot counts | Flat stacking array (`gs.inventory`), single pool for suit+ship | Structural | 3 (shared with §14) |
| 9 | Ship inventory — adjacency bonus | Same-family modules adjacent → stacking % bonus | No slots exist to be adjacent | Structural | 2 (shared with §15) |
| 10 | Ship inventory — supercharged slots | 2-4 fixed hex cells per hull instance, large multiplier | Absent | Structural | 1.5 |
| 11 | Ship stats — hyperdrive range | ly-per-jump stat, tech-modified | `warpCells` is a binary consumable (1 jump = 1 cell), no range/distance stat | Feature | 1.5 |
| 12 | Ship cockpit/procedural variety | Large authored kit per archetype | Real per-class cockpit (`cockpit.js` `CLASS_STYLES`) — good coverage already | — (parity, small gap) | 0.5 |
| 13 | Multitool types/classes | 6 types × C-S classes, dealer + crash + quest acquisition | One multitool, one mesh, no class letter | Structural | 5 |
| 14 | Multitool tech variety | 11 named techs (weapons, visor, forcefield, scanner...) | 3 modes (mine/bolt/dig) mapping cleanly to 3 of the 11 | Feature | 4 (adds 8 more techs + slotting) |
| 15 | Multitool slot grid + adjacency/supercharged | Full grid system, shared code with ship/suit | Two flat numeric upgrade tracks (`toolMine`,`toolBolt`) | Structural | shared with §8/§9 |
| 16 | Exocraft roster | 6 vehicles (buggy/speedster/mobile-base/bike/mech/submarine) | 1 vehicle (buggy-equivalent "rover") | Structural | 10 (≈2/craft incl. Minotaur mech rig + Nautilon underwater nav) |
| 17 | Exocraft tech tree | Boost/mining-laser/scanner/cannon per craft, slotted | None — fixed handling constants only | Feature | 2 |
| 18 | Exocraft summon-anywhere | Exocraft Summoning Station, per-planet unlock | Implemented (`gs.exocraft.unlocked`, `RoverController.summon`) | — (parity) | 0 |
| 19 | Exocraft races | Checkpoint circuits, AI racers | Absent | Feature | 3 |
| 20 | Exosuit slot grid | General/Tech/Cargo split, adjacency, supercharged | Flat array, one pool, no split | Structural | shared with §8 |
| 21 | Exosuit expansion | Drop pods (one-time) + purchasable slots (escalating cost) | `shipCargo` upgrade track (+8 slots/level, max 3, flat cost) doubles as ship *and* suit cargo | Feature | 2 |
| 22 | Exosuit hazard protection | 4 separate modules (rad/toxic/cold/heat), each independently leveled | One `suitEnergy` track raises the shared "energy" pool that all hazards drain | Structural | 3 |
| 23 | Exosuit life support / movement modules | Oxygen capacity, jetpack capacity/thrust, sprint speed, roll/underwater modules | Fixed constants in `player.js`/`survival.js`, no upgrade path | Feature | 2.5 |
| 24 | Combat mech (Minotaur analogue) | Pilotable bipedal exocraft + AI companion mode | `Colossus` in `combat.js` is a hostile-only NPC walker, never pilotable | Feature | 3 (reuse Colossus rig as base) |
| 25 | Submarine (Nautilon analogue) | Full underwater exocraft, sonar/scan variant | No underwater vehicle; rover explicitly refuses water (`NOT AMPHIBIOUS`) | Structural | 4 |

**Totals**: ~25 engineer-weeks structural, ~20 engineer-weeks feature/cosmetic — see §6 for a phased rollup (some rows share implementation cost, counted once).

---

## 4. Target design

### 4.1 Unified `SlotGrid` — shared by ship / multitool / exosuit / exocraft / (future) freighter

One primitive, four owners. Every equippable thing gets a `SlotGrid` instance; the grid shape (rows × cols) and supercharged-cell positions are baked in at generation time from the owner's class/archetype and a seed.

```js
// src/gameplay/slotgrid.js  (new)

/** @typedef {'general'|'tech'} SlotTab */
/** @typedef {'weapon'|'shield'|'hyperdrive'|'scanner'|'mining'|'life-support'|
 *   'movement'|'hazard'|'utility'} TechFamily

/**
 * One grid cell.
 * @typedef {{
 *   tab: SlotTab,
 *   row: number, col: number,
 *   supercharged: boolean,
 *   occupant: null | {
 *     techId: string,         // e.g. 'photon-cannon-2'
 *     family: TechFamily,     // groups for adjacency
 *     tier: 'sigma'|'tau'|'theta',  // rarity — flat power multiplier
 *     rootRow: number, rootCol: number,  // multi-cell modules share a root
 *     shape: [number,number][],          // cell offsets from root
 *   }
 * }} SlotCell
 */

export class SlotGrid {
  /**
   * @param {number} rows
   * @param {number} cols
   * @param {{row:number,col:number}[]} superchargedCells  fixed per hull instance
   * @param {number} generalCols   how many leading columns are General (rest are Tech)
   */
  constructor(rows, cols, superchargedCells, generalCols) {
    this.rows = rows; this.cols = cols;
    this.cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      this.cells.push({
        tab: c < generalCols ? 'general' : 'tech',
        row: r, col: c,
        supercharged: superchargedCells.some((s) => s.row === r && s.col === c),
        occupant: null,
      });
    }
  }

  cellAt(r, c) { return this.cells.find((x) => x.row === r && x.col === c) ?? null; }

  /** true if every cell of `shape` rooted at (r,c) is in-grid, tech-tab, and empty */
  canPlace(r, c, shape) {
    return shape.every(([dr, dc]) => {
      const cell = this.cellAt(r + dr, c + dc);
      return cell && cell.tab === 'tech' && !cell.occupant;
    });
  }

  place(r, c, shape, techId, family, tier) {
    if (!this.canPlace(r, c, shape)) return false;
    for (const [dr, dc] of shape) {
      this.cellAt(r + dr, c + dc).occupant = { techId, family, tier, rootRow: r, rootCol: c, shape };
    }
    return true;
  }

  remove(r, c) {
    const root = this.cellAt(r, c)?.occupant;
    if (!root) return false;
    for (const [dr, dc] of root.shape) this.cellAt(root.rootRow + dr, root.rootCol + dc).occupant = null;
    return true;
  }
}
```

### 4.2 Adjacency-bonus algorithm

Bonus is computed **per module**, not per grid, so it can be queried live for tooltips ("this module: +12% from adjacency"). Two cells are adjacent if they share an *edge* (4-connected), not a corner. A module's neighbor count is the number of **distinct other modules** of the same `family` touching *any* of its own cells.

```js
const TIER_MULT = { sigma: 1.0, tau: 1.25, theta: 1.5 };
const ADJACENCY_STEP = 0.06;     // +6% per same-family adjacent module
const ADJACENCY_CAP = 4;         // diminishing returns past 4 neighbors
const SUPERCHARGE_MULT = 1.40;   // flat multiplier if the module's root cell is supercharged

/**
 * @param {SlotGrid} grid
 * @param {{row:number,col:number}} root  the module's root cell
 * @returns {number} total output multiplier for that module (baseline 1.0)
 */
function moduleMultiplier(grid, root) {
  const cell = grid.cellAt(root.row, root.col);
  const mod = cell.occupant;
  if (!mod) return 1.0;

  // 1. rarity tier
  let mult = TIER_MULT[mod.tier] ?? 1.0;

  // 2. adjacency: BFS the module's own footprint's 4-neighbors, collect
  //    distinct occupant module instances of the same family
  const seen = new Set([`${mod.rootRow},${mod.rootCol}`]);
  let neighborCount = 0;
  for (const [dr, dc] of mod.shape) {
    const r = mod.rootRow + dr, c = mod.rootCol + dc;
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const n = grid.cellAt(nr, nc);
      if (!n?.occupant || n.occupant.family !== mod.family) continue;
      const key = `${n.occupant.rootRow},${n.occupant.rootCol}`;
      if (seen.has(key)) continue;      // already counted (own cell or already-found module)
      seen.add(key);
      neighborCount++;
    }
  }
  mult *= 1 + ADJACENCY_STEP * Math.min(neighborCount, ADJACENCY_CAP);

  // 3. supercharged slot — flat multiplier on the root cell only
  if (cell.supercharged) mult *= SUPERCHARGE_MULT;

  return mult;
}

/** Sum of a family's contribution across the whole grid — what stat code reads. */
function familyOutput(grid, family, perModuleBase) {
  const roots = new Set();
  for (const cell of grid.cells) {
    if (cell.occupant?.family === family) roots.add(`${cell.occupant.rootRow},${cell.occupant.rootCol}`);
  }
  let total = 0;
  for (const key of roots) {
    const [row, col] = key.split(',').map(Number);
    total += perModuleBase * moduleMultiplier(grid, { row, col });
  }
  return total;
}
```

This is deliberately family-scoped rather than global: a Shield module never boosts a Weapon module's adjacency count, matching NMS's same-color-only rule. Diminishing returns (`ADJACENCY_CAP`) prevent one 8-in-a-row chain from trivializing balance while still rewarding deliberate layout play — the whole point of the minigame.

### 4.3 Ship/multitool/exocraft data model

```js
/** @typedef {{
 *   ownerKind: 'ship'|'multitool'|'exocraft'|'exosuit',
 *   archetype: string,        // 'talon' | 'rifle' | 'minotaur' | ...
 *   grade: 'C'|'B'|'A'|'S',
 *   seed: number,             // drives both visuals AND grid layout
 *   partKit: {                // procedural assembly recipe, resolved at build time
 *     fuselageId: string, wingsetId: string, canopyId: string,
 *     engineId: string, decalId: string, paletteId: string,
 *   },
 *   grid: SlotGrid,
 *   baseline: { hullMax:number, shieldMax:number, damage:number,
 *     hyperdriveRangeLy:number, maneuver:number, cargo:number },
 * }} EquippableRecord
 */
```

`grid` layout (rows/cols/supercharged positions/generalCols) is derived **deterministically from `seed`** the same way `buildShip(seed, cls)` already derives hull geometry — reuse `RNG`/`hash32`/`hashString` from `src/core/rng.js` so a crashed-ship claim and a shipyard offer for the *same seed* always produce the *same* grid, letting players compare hulls before committing repair resources.

### 4.4 Procedural ship-part assembly plan (+ authored-parts caveat)

Extend the existing `ShipKit` pattern rather than replace it — it already proves out lofted fuselages, extruded wings, and canvas paint entirely from code:

1. **Per-archetype part registries.** Each of the 8 target archetypes (5 existing classes + Solar, Living Ship, Sentinel Interceptor as new ones) gets 3-4 alternative `fuselageSections` presets, 2-3 `wingPlanform` presets, and 2 `canopy` presets, selected by `rng.pick()` inside the class assembler — mechanically identical to today's single hard-coded preset per class, just parameterized into small arrays. This directly grows visual variety within a class without new render primitives.
2. **New archetype assemblers**: `buildSolar` (broad sail-like fixed "wings" doubling as an energy collector, no separate fuel-tank geometry), `buildLiving` (organic — swap `loftGeometry`'s superellipse exponent for low-n rounded blobs, bioluminescent canvas paint instead of panel-line paint), `buildSentinel` (angular chrome — reuse the Warden/Colossus material palette already built for `combat.js` so the Interceptor visually *reads* as sentinel tech for free).
3. **Caveat (own it, don't hide it):** NMS's variety ceiling comes from a large *authored* mesh library (hundreds of hand-modeled parts) recombined proceduraly; ours must come from a much smaller set of *parametric* generators. This volume's plan closes maybe 40% of the perceptual gap — more class/archetype coverage, more palette schemes, per-archetype part presets — but will never match NMS's raw part-count variety without an asset pipeline this project's zero-external-assets rule forecloses. Treat "procedural" here as "parametric," not "infinite."

### 4.5 Module / file plan

| File | Status | Responsibility |
|---|---|---|
| `src/gameplay/slotgrid.js` | new | `SlotGrid` class, `moduleMultiplier`, `familyOutput` (§4.1-4.2) |
| `src/gameplay/techcatalog.js` | new | Tech module registry: id, family, tier options, shape, base stat, which owner kinds can host it |
| `src/gameplay/shipmarket.js` | extend | `generateOffer` gains `grid` (built from seed), archetype list extends to 8, `applyShipPurchase` copies the grid in |
| `src/gameplay/crashedships.js` | new | Surface POI: damaged ship record, `repairStage(gs, site)`, `claim(gs, site)` |
| `src/gameplay/multitool.js` | new | Multitool record model (type/class/grid), replaces `gs.tool = {mode}` |
| `src/render/multitoolmesh.js` | extend `arcforge.js` | Parameterize by `type` the way `shipmesh.js` is parameterized by `cls`; keep the 3 existing modes as 3 of the ~11 techs |
| `src/gameplay/exocraft.js` | new | Roster registry (`roamer|nomad|colossus|pilgrim|minotaur|nautilon`), per-craft tech grid + summon rules (water/gravity gating) |
| `src/render/exocraft.js` | extend | `buildRover` → `buildExocraft(seed, kind)`, new builders for Nomad/Colossus/Pilgrim/Nautilon; Minotaur reuses `combat.js`'s Colossus leg-IK rig with a pilot seat added |
| `src/gameplay/state.js` | extend | Replace flat `inventory[]` with `{general: SlotGrid, tech: SlotGrid, cargo: SlotGrid}` on `GameState`, `ship`, and `tool`; migration shim reads old saves into slot 0..N of the new General grid |
| `src/ui/slotgridui.js` | new | Shared drag/drop grid renderer used by inventory, shipyard "your ship" panel, and a new multitool/exocraft loadout screen |
| `src/gameplay/freighter.js` | new (later phase) | Out of scope for this volume's Phase 1-3, stubbed for Phase 4 |

---

## 5. Phases

| Phase | Deliverable | Depends on |
|---|---|---|
| 1 — Grid foundation | `SlotGrid`, adjacency algorithm, `techcatalog.js`, migrate `GameState.inventory` to General/Tech/Cargo grids with a save-migration shim; `slotgridui.js` drag/drop renderer | none |
| 2 — Ship depth | Per-instance seeded grid on ship offers + owned ship; crashed-ship POIs + repair flow; scrapping action; hyperdrive-range stat; Solar/Living Ship/Sentinel Interceptor archetypes | Phase 1 |
| 3 — Multitool depth | Multitool type/class model, dealer stock, 8 additional techs (Analysis Visor, Scanner, Pulse Spitter, Scatter Blaster, Blaze Javelin, Neutron Cannon, Plasma Launcher, Personal Forcefield) slotted into the grid | Phase 1 |
| 4 — Exocraft roster | Nomad, Colossus (mobile base+geobay), Pilgrim, Nautilon (underwater nav + amphibious terrain rules), Minotaur (pilotable, reuses Colossus IK rig + AI-follow mode); per-craft tech grids; races | Phase 1 (grid), reuses `combat.js` Colossus geometry |
| 5 — Exosuit depth | Split hazard protection into 4 modules, life-support/movement modules, drop-pod one-time slot pickups, escalating-cost purchasable slots | Phase 1 |
| 6 — Freighter (stretch) | Freighter ownership, hangar bay ships, Anomaly/Exotic dealer | Phases 2-3 |

---

## 6. Effort & risk (engineer-weeks)

| Workstream | Eng-weeks | Risk |
|---|---|---|
| SlotGrid + adjacency + supercharged core (§4.1-4.2) | 3 | Low — pure data/logic, well-specified, unit-testable in isolation |
| Save migration (flat inventory → grids) | 1.5 | Medium — must not silently drop items from existing saves; needs a golden-save regression test |
| Ship: crashed-ship discovery/repair/claim | 4 | Medium — needs new surface POI type + multi-stage UI, but reuses existing signal-scanner/POI plumbing |
| Ship: 3 new archetypes (Solar/Living/Sentinel) + per-archetype part presets | 5 | Medium — art-direction-heavy, easy to scope-creep; cap at 2-3 presets/slot as planned |
| Ship: scrapping, hyperdrive-range stat | 1.5 | Low |
| Multitool: type/class model + dealer + grid | 5 | Medium — touches `arcforge.js` render code, `combat.js`/`mining.js` firing logic, and `state.js` schema simultaneously |
| Multitool: 8 new techs (visor/scanner/4 weapons/launcher/forcefield) | 4 | Medium — each weapon needs its own feel pass in `combat.js`, not just a data entry |
| Exocraft: Nomad, Pilgrim (land) | 3 | Low — same rig class as existing `RoverController` |
| Exocraft: Colossus (mobile base + geobay) | 2.5 | Medium — mobile summoning-station semantics are new |
| Exocraft: Nautilon (submarine, amphibious terrain rules) | 4 | High — needs real underwater navigation/buoyancy against `field.seaY`, currently a hard stop |
| Exocraft: Minotaur (pilotable mech + AI mode) | 3 | High — first-person mech piloting + a genuinely new AI-follow-and-fight state machine (Colossus IK reduces but doesn't remove this) |
| Exocraft races | 3 | Low — checkpoint/timer system, no new rendering |
| Exosuit: hazard-module split, life-support/movement upgrades | 3 | Low — mostly `survival.js`/`player.js` constant refactors gated by new tech slots |
| Exosuit: drop pods, escalating slot purchase | 2 | Low |
| Freighter + Anomaly (stretch, Phase 6) | 13 | High — effectively a new hub location, hangar-bay ship roster, second currency; explicitly out of scope for Phases 1-5 |
| **Total (Phases 1-5, excl. freighter)** | **~44.5 eng-wk** | |
| **Total incl. freighter stretch** | **~57.5 eng-wk** | |

Largest individual risks: the **Nautilon** (the terrain/water system currently treats water as an impassable wall for exocraft — `RoverController` literally zeroes speed and posts "THE EXOCRAFT IS NOT AMPHIBIOUS" — so underwater nav is new physics, not a reskin) and the **Minotaur's AI-companion mode** (no existing "friendly autonomous combatant" state machine; closest analogue is the hostile `Colossus` AI in `combat.js`, which would need to be forked and re-targeted rather than reused wholesale).

---

## 7. Acceptance criteria (headless, no renderer required)

All three exercise `SlotGrid`/game-state logic directly — none require the WebGL canvas, matching the project's existing headless-testable gameplay modules (`shipmarket.js`, `mining.js` math, etc.).

**A. Adjacency bonus — install two same-family modules edge-adjacent and prove the stacked bonus.**

```js
import { SlotGrid } from '../src/gameplay/slotgrid.js';
import { moduleMultiplier, familyOutput } from '../src/gameplay/slotgrid.js';

const grid = new SlotGrid(4, 6, [{ row: 0, col: 5 }], 2); // 1 supercharged cell, cols 0-1 general
grid.place(1, 2, [[0, 0]], 'photon-cannon-1', 'weapon', 'sigma');
const isolated = familyOutput(grid, 'weapon', 100);        // baseline, no neighbor

grid.place(1, 3, [[0, 0]], 'photon-cannon-2', 'weapon', 'sigma'); // adjacent (shares edge w/ col 2)
const adjacent = familyOutput(grid, 'weapon', 100);

assert(adjacent > isolated * 2, 'two adjacent same-family modules must beat the sum of two isolated ones');
// isolated: 100 (module 1 alone). After adding an edge-adjacent sigma module:
// each module now has 1 neighbor → ×(1 + 0.06) each → 2 × 106 = 212 > 2 × 100
assert(Math.abs(adjacent - 212) < 1e-6, `expected 212, got ${adjacent}`);

// corner-only placement must NOT count
const grid2 = new SlotGrid(4, 6, [], 2);
grid2.place(1, 2, [[0, 0]], 'a', 'weapon', 'sigma');
grid2.place(2, 3, [[0, 0]], 'b', 'weapon', 'sigma'); // diagonal, not edge-adjacent
assert(familyOutput(grid2, 'weapon', 100) === 200, 'diagonal neighbors must not grant adjacency bonus');
```

**B. Claim + repair a crashed ship.**

```js
import { GameState } from '../src/gameplay/state.js';
import { spawnCrashSite, repairStage, claim } from '../src/gameplay/crashedships.js';

const gs = new GameState(42);
const site = spawnCrashSite(gs.rng('crash-test'), { class: 'talon', grade: 'A' });
assert(site.stagesTotal === 3 && site.stagesDone === 0);

// cannot fly it yet
assert(claim(gs, site) === false, 'claim must fail before all repair stages complete');

for (let i = 0; i < site.stagesTotal; i++) {
  gs.addItem(site.stageCost(i).id, site.stageCost(i).qty);
  assert(repairStage(gs, site) === true, `stage ${i} should consume resources and advance`);
}
assert(site.stagesDone === site.stagesTotal);

const claimed = claim(gs, site);
assert(claimed === true);
assert(gs.ship.class === 'talon' && gs.ship.stats.grade === 'A');
assert(gs.ship.grid instanceof Object && gs.ship.grid.cells.length > 0, 'claimed hull carries a real slot grid');
```

**C. Summon each exocraft.**

```js
import { GameState } from '../src/gameplay/state.js';
import { ExocraftRoster } from '../src/gameplay/exocraft.js';

const KINDS = ['roamer', 'nomad', 'colossus', 'pilgrim', 'minotaur', 'nautilon'];
const gs = new GameState(7);
const roster = new ExocraftRoster(gs);

for (const kind of KINDS) {
  roster.unlock(kind); // simulate geobay purchase for each
  const pos = { x: 0, y: 0, z: 0 };
  const ok = roster.summon(kind, pos, 0, { seaNear: kind === 'nautilon' }); // only Nautilon requires water nearby
  assert(ok === true, `${kind} must summon successfully once unlocked`);
  assert(roster.active(kind).deployed === true);
}

// land-only craft must refuse deployment directly onto water
const { RoverController } = await import('../src/gameplay/rover.js');
// (kept as regression: existing amphibious refusal must still hold for non-Nautilon kinds)
assert(roster.summon('roamer', { x: 0, y: 0, z: 0 }, 0, { seaNear: true, forceWater: true }) === false);

// Nautilon, uniquely, must succeed *in* water
assert(roster.summon('nautilon', { x: 0, y: -5, z: 0 }, 0, { forceWater: true }) === true);
```

Each block is a plain Node-runnable assertion set (no DOM/WebGL), consistent with how `shipmarket.js`'s deterministic offer generation is already tested today — the new systems should stay unit-testable the same way.
