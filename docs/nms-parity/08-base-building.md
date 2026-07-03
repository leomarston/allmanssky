# Volume 8 — Base Building & Settlements

**Scope:** part catalog & unlock, snapping/socket placement, power grid & logic, farming/production, freighter bases, settlements, NPC base specialists, base persistence/sharing.
**Current scorecard (Volume 0):** **3 / 10** — "Snap-place props + power-ish machines; no full part catalog, wiring/logic, freighter bases, settlements, NPC workers, or deep persistence."
**Primary source files:** `src/gameplay/basebuilding.js`, `src/ui/buildui.js`, `src/gameplay/machines.js`, `src/render/props.js`, `src/states/surfaceprops.js`, `src/gameplay/state.js`, `src/universe/terrainfield.js`.

---

## 1. What No Man's Sky does

NMS base building is one of the deepest systems in the game — a full construction toolkit layered on an electrical-engineering puzzle layer, tied to a persistence and social-sharing pipeline. It breaks into eight sub-systems.

### 1.1 The base computer & claim

A **Base Computer** is the root object of every base: place it, and it defines a **claim radius** (a translucent boundary sphere/cylinder shown while building) inside which every other part must sit. The computer is also the "identity" of the base — it holds the base's custom name, its save/load anchor, and its slot in the player's base list. A player may own several bases simultaneously (the cap has grown across updates, effectively dozens with the freighter and multiple planetary bases), each independently claimed, named, and switchable. Bases can be **abandoned** (deleting the computer wipes the claim and frees the parts for salvage/decay) or **re-claimed** by another player if abandoned on a multiplayer-visible planet.

### 1.2 The part catalog

The catalog is **hundreds of parts** organized by structural material set and function:

- **Structural sets** (each a parallel geometry family so a base can commit to one visual language): Wood (Wooden Refuge cabin set), Metal/Habitat (the default sci-fi set), Concrete, and Alloy/Exotic add-on sets from expeditions/seasons. Within each set: **floors** (square, half, triangular infill), **walls** (straight, corner, angled, half-height), **roofs** (flat, angled, pyramid, curved), **doors** (arch, sliding, cylindrical airlock, blast door), **windows** (square, round, floor-to-ceiling glass), **stairs**, **ramps**, **catwalks/walkways**, **pillars/foundations**, and **corner/junction** pieces that make the socket graph close cleanly in 3D.
- **Prefab rooms**: pre-built cuboid rooms, cylindrical rooms, all-glass cuboid/dome rooms (for underwater or vista bases), and large/small **landing pads**, each a single placeable "room" object that still exposes sockets on its faces so structural parts can be extended from it.
- **Technology**: portable refiner and large (wired) refiner, mineral/gas **extractors** placed directly on resource deposits and connected by **pipes**, **storage containers** (small and large, stackable item slots), **teleporter** (links every base + space station in the teleport network), **appearance modifier** (character customization terminal), **save beacon**/base computer respawn point, **Galactic Trade Terminal** (remote market access), **Supply Depot** (shared community storage on multiplayer bases), and NPC **recruitment terminals**.
- **Decoration**: furniture (tables, chairs, beds, cabinets, shelving), **lighting** (wall sconces, floor lamps, pendant lights, neon strip lights, all separately colorable), **posters/plaques/trophies/holograms**, **plants** (purely decorative potted flora), rugs, statues, and themed cosmetic sets unlocked from seasonal expeditions.
- **Farming**: **hydroponic trays** (indoor, plant any collected flora/fungal sample for a timed yield), outdoor **planter boxes**, and **biodomes** (large glass-domed structures with their own interior climate, used to grow exotic/atmosphere-restricted flora anywhere).
- **Power**: the full electrical-puzzle kit — **solar panels** (daylight-only output, angle/exposure independent), **biofuel reactors** (consume a stored organic fuel like Mordite/Fungal Mould at a burn rate for steady output), **electromagnetic generators** (free, strong output but only when placed on a **paleo-electric/geothermal hotspot** discovered via the analysis visor), **batteries**/solid-state batteries (store surplus, discharge on deficit), **wires** (freeform, click-drag cables with adjustable color/coiling), **switches** and **buttons** (manual on/off or momentary), **proximity/pressure sensors**, **logic gates** (AND, OR, NOT — chain any inputs into a boolean output that gates a switch or wire), **timers** (periodic on/off cycling), and **inverters**. These compose into real automation: motion-triggered lighting, timed door sequences, silo-fed refineries that only run when charged, and player-built puzzle contraptions.
- **Production chains**: extractors feed silos, silos feed (wired) refiners, refiners feed storage, all optionally power-gated — a genuine small factory-automation loop layered on top of base building.

### 1.3 Placement mechanics

Parts **snap** to a socket graph by default — each part exposes typed connection points (floor edges, wall tops, corner joints, ceiling grids) and the game highlights valid targets as you aim; rotation cycles through the snap orientations. A **Precision/Free Placement** toggle disables snapping entirely, enabling full 6-DoF placement (any rotation, sub-grid position, height offset) for organic, non-grid builds — at the cost of doing your own alignment and eating more of the collision/part budget. **Symmetry mode** mirrors placement across a configurable axis so both sides of a build go up in one pass. Collision detection blocks overlapping solid geometry (with generous tolerance in free placement). A **Terrain Manipulator** mode (shared with the mining/terrain-edit tool) lets players **flatten, raise, or lower** ground within a radius specifically to level a build site before laying foundations — necessary because NMS terrain is a real deformable voxel field, not a fixed heightmap.

### 1.4 Unlocks

New parts are gated behind **blueprints**: some are free/known from the start (basic structural set), others are purchased with **Salvaged Data** at Blueprint Analysis Visor terminals or Construction Research Stations, some are rewarded by completing an NPC specialist's quest line, and some are found as physical blueprint items in derelict buildings, ruins, or crashed freighters. Recipes (cost in resources) are attached per part.

### 1.5 Freighter bases

A owned **freighter** has an enormous customizable **interior** using the same part catalog plus freighter-exclusive rooms (bridge, hangar bay walkways, cargo rooms), a landing **hangar** where the player's starships and fighters dock, and a **fleet management** screen: frigates are recruited, upgraded, and sent on procedurally generated **expeditions** (risk/reward timed missions resolved off-screen) that return resources, damage/loss risk, and frigate XP.

### 1.6 Settlements (Frontiers update)

Players can claim an NPC **settlement**: a pre-existing village with a population count, a named Overseer NPC, and a set of functional buildings (habitation, production, amenity categories). The player periodically receives **policy/dispute pop-ups** — binary or ternary choices (e.g., "raise taxes" vs "subsidize housing") that move **population**, **happiness**, and **productivity** meters and the settlement's treasury. The player **funds construction/upgrades** of settlement buildings from a menu (each has tiers, a Unit cost, and a build timer), which raises productivity/population caps over time. **Sentinel raids** periodically attack the settlement and must be defended or the settlement's stats take damage. The settlement can be visited, decorated to a degree, and produces a small periodic resource/credit income once developed.

### 1.7 NPC base specialists

Six recruitable specialists — **Farmer**, **Scientist**, **Armourer** (Weapons), **Technician**, plus faction-specific variants — are each found via a short quest line (usually: find them stranded/derelict or referred by a race-specific NPC, complete a fetch/defend/dialogue quest, offer them a room). Once recruited, each specialist occupies a **dedicated room type** in the player's base, sells that specialist's blueprint tier (farming tech, scientific/tech modules, weapon upgrades, refiner tech) for Nanites, and delivers ongoing flavor dialogue. This is the base-building system's main hook into Volume 10 (NPCs, Factions, Language, Story & AI).

### 1.8 Persistence, upload & visiting

Every base auto-saves to the player's save file and to the cloud; a base can be **uploaded** to the community feed (Base Building Contest entries, PlayStation/Steam featured bases), browsed by other players via a **Discoveries/Bases** menu, and **visited** by teleporting directly to someone else's build (read-only, in the base owner's absence, in multiplayer sessions the owner can be present). Each base has a hard **part-count budget** (historically ~3,000–4,000 parts) enforced client-side for performance.

---

## 2. What we have (cite source)

AllMansSky has a single, self-contained base-building module with no power concept and no persistence infrastructure beyond the flat game-state blob.

**Catalog — `src/gameplay/basebuilding.js`.** `PIECES` (lines 22–32) is a fixed array of **9 kinds**, capped at 9 because the hotbar binds them to keys 1–9 (`buildPiece`, `_ensureGhost`, `BuildUI._render`): `foundation`, `wall`, `door`, `roof`, `light`, `storage`, `refiner`, `planter`, `pad`. A tenth, `window`, exists only as `LEGACY_PIECES` (line 35–37) — reachable by old saves via `_materialize`/removal but no longer placeable. There is exactly **one material palette** (`mats()`, lines 41–51: `_matAlloy`/`_matDark`/`_matGlass`/`_matStrip`) shared by every piece — no wood/concrete/alloy sets, no color/paint choice, no prefab rooms, no decoration catalog beyond the single cosmetic `light` mast (a `PointLight` capped at `this._lightCount >= 4`, line 216). `buildPiece()` (54–191) procedurally assembles each kind from primitive `THREE.BoxGeometry`/`CylinderGeometry` calls — genuinely well-crafted low-poly kit-bashing, but it is 9 silhouettes, not hundreds.

**Placement — `BaseBuilder` class (193–387).** Grid snap is a flat constant `GRID = 4` (line 17): `foundation`/`roof`/`pad` round to the nearest 4 m cell (`_snap`, 255–258); `wall`/`door`/`window` search `this.placed` for the nearest `foundation` piece within 7 m and snap to whichever local axis (x or z) has the larger offset, forcing `rotY` to `0` or `π/2` (259–281); `roof` additionally stacks directly above a foundation at a hardcoded `+3.32 m` (283–291). This is a **hardcoded adjacency heuristic**, not a socket graph — there is no per-part socket list, no socket-type compatibility, no rotation cycling through valid orientations, and no way for a modder/future part to declare how it mates with neighbors. There is **no collision system**: pieces can be placed overlapping; the only gate is the snap heuristic returning `true`/`false` for wall-class parts (`_ghostOk`, 322–327) and `gs.hasItems(cost)`. There is **no Precision/Free-Placement toggle** and **no symmetry tool**. Rotation is a single Y-axis increment (`swapWeapon` action, line 312) — no per-part socket-driven rotation. Ground placement samples `this.field.height(point.x, point.z)` directly (line 320) with no leveling: because the surface is `y = f(x, z)` (`src/universe/terrainfield.js`), a foundation on sloped ground sits tilted-into or floating-above the terrain with no undercarriage/skirting compensation.

**No base computer / claim radius.** A base record is created implicitly on first placement, keyed only by `systemId` + `planetIndex` (line 209, 339–342): `this.base = gs.bases.find((b) => b.systemId === systemId && b.planetIndex === planetIndex)`. There is exactly **one base slot per planet** with no explicit computer object, no claim boundary, no custom naming, and no UI for browsing/switching between multiple bases (`gs.bases` is an unbounded array in principle, but nothing ever lists it).

**No unlock/blueprint gating.** All 9 pieces are available from the first frame of build mode; the only gate is the flat `cost` array checked via `gs.hasItems`/`gs.removeItems` (`src/gameplay/state.js`, lines 85–90). There is no blueprint currency, no analysis terminal, no specialist-granted unlock.

**"Power-ish" machines — `src/gameplay/machines.js`.** This is the one place the report can credit real simulation depth: `REFINER_RECIPES` (20–27) and `CROPS` (30–36, currently exposing only `chlorophane` via `DEFAULT_CROP`) drive `refinerProgress()`/`settleRefiner()`/`planterProgress()` (75–120), which are **wall-clock timers** (`Date.now()` deltas stored directly on the persisted `rec`, so jobs advance even while the game is closed). `MachineRunner.update()` (180–222) advances every registered machine each frame and drives purely cosmetic animation (ember flicker, crop-stage swap). Crucially: **nothing in this file, or anywhere in the codebase, models electrical power.** A `grep` for `power|wire|solar|battery|socket` across `basebuilding.js` and `machines.js` returns zero hits outside the word "snapping" in a comment. The `light` piece's `PointLight` is unconditionally on when built and has no producer/consumer relationship to anything; the refiner runs its timer regardless of whether any "power" piece exists nearby. This is why Volume 0 calls it "power-ish": the *verb* (machines doing timed work) exists, the *noun* (a power grid) does not.

**World dressing, not base parts — `src/render/props.js` / `src/states/surfaceprops.js`.** `createOutpost()` (props.js, 228–294) draws a cosmetic solar panel on a pole and light strips as part of a **procedurally generated NPC outpost prop** — visually suggestive of NMS power aesthetics, but it is baked geometry with no simulation, spawned by `PropManager._spawnCell()` (surfaceprops.js, 47–101) on a coarse 256 m macro-cell grid, entirely disconnected from `BaseBuilder`. Resource nodes (`createResourceNode`) are minable world objects, not placeable extractors.

**Persistence — `src/gameplay/state.js`.** `gs.bases` (line 45) is `[{systemId, planetIndex, pieces:[{kind,x,y,z,rotY}]}]`, embedded directly inside the single JSON blob written per save slot by `GameState.save()` (108–115, `localStorage.setItem(SLOT_KEY(this.slot), JSON.stringify(this))`). There is no base ID, no name, no versioned piece schema, no separate export/upload format, and no way to browse or visit a base without physically being in that system/planet state (`BaseBuilder` constructor, 209–213, rebuilds meshes only when instantiated by `SurfaceState`). Reclaiming a piece (`RMB`, 358–376) refunds half its listed cost; there is no decay, no part budget, and no abandon/re-claim flow.

**No freighter, no settlements, no NPC specialists.** A repo-wide search for `freighter|settlement|specialist|overseer` matches only unrelated hits in `planetmesh.js`/`machines.js` (`specialist` appears nowhere; the only "settlement"-adjacent concept is the flat prop-spawned `outpost`, which is scenery, not a base). `src/gameplay/npcs.js` implements a wandering **hangar crowd** (`NPCCrowd`, faction-flavored roles like `Broker`/`Archivist`/`Deckhand`) with idle dialogue only — no recruit-to-base flow, no dedicated specialist rooms, no blueprint-selling terminals.

---

## 3. The gap

| # | Feature | NMS | AllMansSky today | Severity | Effort |
|---|---|---|---|---|---|
| 1 | Base computer + claim radius | Root object, named base, claim boundary, multi-base list | Implicit base keyed by `systemId+planetIndex`, one per planet, no computer entity | **[Structural]** | 1.5 wk |
| 2 | Part catalog breadth | Hundreds of parts across 4+ structural sets + prefab rooms | 9 kinds, 1 material palette, hotbar-capped at 9 (`PIECES`) | **[Structural]** | 4–6 wk (data + geometry) |
| 3 | Socket-based snapping | Typed sockets per part, orientation cycling, mate validation | Hardcoded nearest-foundation heuristic (`_snap`) | **[Structural]** | 2 wk |
| 4 | Free placement / precision mode | Toggleable 6-DoF placement | Snap-or-reject only, single Y rotation | **[Feature]** | 0.5 wk |
| 5 | Symmetry/mirror tool | Axis-mirrored placement | Absent | **[Feature]** | 0.5 wk |
| 6 | Collision detection | Solid-part overlap blocked | None — pieces can overlap freely | **[Structural]** | 1 wk |
| 7 | Terrain leveling for foundations | Manipulator flattens ground under a build | No leveling tool; `addDig()` is a mining crater only, never invoked by `BaseBuilder` | **[Engine]** (needs Vol 2/3 terrain) | blocked |
| 8 | Decoration catalog | Furniture, lighting, posters, plants (dozens) | One cosmetic `light` mast, capped at 4 concurrent lights | **[Feature]** | 2 wk |
| 9 | Storage containers | Multi-slot, stackable, large/small tiers | `storage` piece exists but has no inventory UI/slots (decorative crate) | **[Structural]** | 1.5 wk |
| 10 | Teleporter / save beacon / trade terminal / appearance modifier | Full tech-part roster | None of these exist as base parts | **[Feature]** | 3 wk |
| 11 | Farming — hydroponic trays, planters, biodomes | Many plantable species, indoor/outdoor/climate variants | 1 planter kind, 1 crop id (`DEFAULT_CROP = 'chlorophane'`) | **[Feature]** | 2 wk |
| 12 | Power: solar, biofuel, EM generator, battery | 4 producer types with day/fuel/hotspot rules | **Zero** — no producer concept anywhere | **[Structural]** | 3 wk |
| 13 | Wires + freeform routing | Click-drag cable placement, visual routing | Absent | **[Structural]** | 1.5 wk |
| 14 | Switches, buttons, sensors, timers | Manual + automated triggers | Absent | **[Feature]** | 1.5 wk |
| 15 | Logic gates (AND/OR/NOT) | Full boolean automation layer | Absent | **[Structural]** | 2 wk |
| 16 | Power-gated production | Refiners/extractors only run when powered | Refiner/planter run on pure wall-clock timers, ignore power entirely (`machines.js`) | **[Structural]** | 1 wk (after #12–13) |
| 17 | Blueprint unlock system | Salvaged Data economy, analysis terminals, specialist-granted unlocks | All 9 pieces available for resources only, from game start | **[Feature]** | 2 wk |
| 18 | Freighter bases | Full interior catalog + hangar + fleet expeditions | No freighter class/state exists at all | **[Structural]**/**[Feature]** | 5–7 wk (partly gated on Volume 7 ship system) |
| 19 | Settlements sim | Population/happiness/productivity, policy events, funded upgrades, sentinel raids | Absent; outposts are static scenery props (`createOutpost`) | **[Structural]** | 4–5 wk |
| 20 | NPC base specialists | 4+ recruitable roles, quest-gated, dedicated rooms, blueprint sales | `NPCCrowd` wandering flavor NPCs only, no recruit/room/blueprint hook | **[Structural]** (ties to Vol 10) | 3 wk |
| 21 | Base persistence schema | Named, ID'd, versioned, exportable per base | Anonymous array entry inside the monolithic `gs` JSON blob | **[Structural]** | 1.5 wk |
| 22 | Base upload / community browse / visit | Cloud upload, Discoveries browser, teleport-to-visit | Single-player `localStorage` only, no export | **[Feature]** (needs Vol 13 multiplayer for full parity) | 2 wk local export + N/A remote |
| 23 | Part budget / decay / abandon | ~3–4k part cap, decay on neglect, abandon/re-claim | Unbounded pieces array, no decay, no abandon flow | **[Cosmetic]/[Feature]** | 0.5 wk |

---

## 4. Target design

The redesign has four independent layers that should be built in this order because each is a dependency of the next: **(a)** a part/socket data model replacing `PIECES`, **(b)** a power graph solver, **(c)** a base save schema that stores parts as transform deltas from a base anchor, **(d)** the settlements/specialist/freighter systems built on top of (a)–(c).

### 4.1 Part & socket data model

Replace the flat `PIECES` array (`basebuilding.js` 22–32) with a data-driven catalog. Each part is pure data; `buildPiece()`'s procedural mesh builders become one factory per part **id**, keyed off this table instead of a switch on `kind`.

```js
// src/gameplay/parts/catalog.js
const PartDef = {
  id: 'metal_wall_straight',       // stable id, persisted in saves
  set: 'metal',                    // 'wood' | 'metal' | 'concrete' | 'alloy' | 'glass'
  category: 'structure',           // 'structure' | 'room' | 'tech' | 'decoration' | 'farming' | 'power'
  footprint: { w: 1, d: 1, h: 1 }, // grid cells (1 cell = GRID meters, default 4)
  cost: [['ferrox', 3], ['carbyne', 1]],
  unlock: { kind: 'free' },        // 'free' | { kind:'blueprint', id, cost:[[cur,qty]] } | { kind:'specialist', npc }
  sockets: [                       // local-space connection points (part-local, pre-rotation)
    { id: 'edge_n', type: 'wall_edge', pos: [0, 0, 0.5], normal: [0, 0, 1] },
    { id: 'edge_s', type: 'wall_edge', pos: [0, 0, -0.5], normal: [0, 0, -1] },
    { id: 'top',    type: 'wall_top',  pos: [0, 1, 0],   normal: [0, 1, 0] },
  ],
  collision: { kind: 'box', size: [4, 3, 0.24] }, // AABB in local space, rotated at placement
  power: null,                     // see 4.2 — non-null only for power-role parts
  build: (opts) => THREE.Group,    // procedural mesh factory (today's buildPiece logic, split per id)
};
```

**Socket compatibility table** (`src/gameplay/parts/sockets.js`) defines which socket *types* may mate:

```js
const MATES = {
  foundation_edge: ['wall_edge', 'stair_base'],
  wall_edge:       ['wall_edge', 'door_edge', 'window_edge', 'corner_edge'],
  wall_top:        ['roof_base', 'wall_edge_upper'],
  floor_grid:      ['floor_grid', 'foundation_edge'],
};

function findSnapTarget(candidatePart, aimPoint, placedIndex, maxDist = 1.5) {
  // placedIndex: spatial hash of {partUid, worldSocketTransform} built once per
  // frame from all placed parts' sockets (world = part.transform * socket.local)
  let best = null, bestD = maxDist;
  for (const mySocket of candidatePart.sockets) {
    for (const target of placedIndex.query(aimPoint, maxDist)) {
      if (!MATES[target.type]?.includes(mySocket.type)) continue;
      const d = target.worldPos.distanceTo(aimPoint);
      if (d < bestD) { bestD = d; best = { mySocket, target }; }
    }
  }
  if (!best) return null;
  // solve the rigid transform that maps mySocket -> target, opposing normals
  return solveSocketAlignment(candidatePart, best.mySocket, best.target);
}
```

This is a strict generalization of today's `_snap()`: instead of hand-picking "nearest foundation" and hardcoding wall/roof offsets, every part declares its own sockets once, and the resolver is generic. **Free-placement mode** is simply `findSnapTarget` short-circuited (skip straight to `aimPoint` with free rotation/height nudge from input); **symmetry mode** wraps placement in a mirror transform around a stored axis and issues two placement calls per click. **Collision** becomes a broad-phase spatial hash of placed AABBs (reuse the socket spatial index's cell grid) rejecting a placement whose rotated `collision.box` overlaps an existing box beyond a tolerance, except in free-placement where tolerance is relaxed.

**Terrain-edit dependency (flag):** footing/skirting logic and any "flatten ground under foundation" tool needs a per-point editable height sample that persists edits at build resolution — on the current `y = f(x, z)` analytic heightfield (`terrainfield.js`) this can only be approximated with the existing crater-style `addDig()` (a smooth subtractive bowl, capped at 400 edits/planet, `_digAt`), which cannot *flatten to a plane* or raise ground, only carve bowls. A true "Terrain Manipulator: flatten" tool requires either (a) a per-region height-offset raster with additive/planar edits layered into `TerrainField.height()`, which is a stopgap, or (b) the voxel/spherical terrain rewrite (Volume 3 / Volume 2) where a real edit buffer exists. **Recommendation: ship the part/socket/power systems against the current heightfield with a lightweight "auto-footing" (each foundation part samples 4 corner heights and generates a skirt/undercroft mesh to hide the gap, matching NMS's small-slope tolerance) rather than blocking on terrain leveling; revisit true flatten-terrain once Volume 3 lands.**

### 4.2 Power graph & solver

Power-role parts carry a `power` block on their `PartDef`:

```js
power: {
  role: 'producer' | 'consumer' | 'storage' | 'relay' | 'logic',
  watts: 50,                 // producer: nominal output; consumer: nominal draw
  rule: null | 'daylight' | 'hotspot' | 'fueled',
  fuel: null | { itemId: 'mordite', wattsPerUnit: 400, burnRate: 5 },
  capacityWh: null,          // storage only
}
```

**Base power graph** is built per base from placed parts + wires: nodes = every part with a non-null `power` block, plus every logic element (switch/sensor/timer/gate); edges = wire records connecting two socket-adjacent power ports, unioned into **networks** (connected components) via union-find, exactly like NMS's per-base grid (wires only connect within one base; there is no cross-base grid).

```js
// src/gameplay/power/graph.js — solvePowerGraph(base, simClock, dt)
function solvePowerGraph(base, simClock, dt) {
  const nets = unionFindNetworks(base.wires, base.powerNodes);  // Map<netId, Node[]>
  for (const [netId, nodes] of nets) {
    // 1) evaluate logic layer first — gates/timers/sensors resolve booleans
    //    that gate specific consumer/producer edges this tick
    const signals = evalLogicLayer(nodes.filter(n => n.role === 'logic' || n.role === 'relay'), simClock);

    // 2) sum instantaneous production for this network
    let supply = 0;
    for (const p of nodes.filter(n => n.role === 'producer')) {
      if (signals.disabled?.has(p.uid)) continue;
      if (p.rule === 'daylight') supply += p.watts * sunFactor(simClock, base.latitude);
      else if (p.rule === 'hotspot') supply += p.hotspot ? p.watts : 0;
      else if (p.rule === 'fueled') supply += drawFuel(p, dt) ? p.watts : 0;
      else supply += p.watts;
    }

    // 3) sum demand, respecting switches/relays that gate individual consumers
    const consumers = nodes.filter(n => n.role === 'consumer' && !signals.disabled?.has(n.uid));
    let demand = consumers.reduce((s, c) => s + c.watts, 0);

    // 4) balance: direct supply -> demand, surplus charges batteries,
    //    deficit discharges batteries, remaining deficit brownouts consumers
    //    in ascending priority order (decoration first, life-support last)
    let deficit = demand - supply;
    const batteries = nodes.filter(n => n.role === 'storage').sort((a, b) => b.chargeWh - a.chargeWh);
    if (deficit < 0) {
      let surplusWh = -deficit * dt / 3600;
      for (const b of batteries) { surplusWh = chargeBattery(b, surplusWh); }
    } else if (deficit > 0) {
      let neededWh = deficit * dt / 3600;
      for (const b of batteries) { neededWh = dischargeBattery(b, neededWh); }
      deficit = neededWh * 3600 / dt; // remaining unmet, in watts
    }
    const powered = new Set();
    const sorted = consumers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    let budget = Math.max(0, demand - deficit);
    for (const c of sorted) {
      if (budget >= c.watts) { budget -= c.watts; powered.add(c.uid); }
    }
    for (const c of consumers) c.mesh?.setPowered?.(powered.has(c.uid));
    net.poweredSet = powered; // consumed by MachineRunner to gate refiners/extractors
  }
}
```

`evalLogicLayer` walks switches/sensors/timers as boolean-signal sources and gates/relays as combinators (`AND`/`OR`/`NOT` on named input signal IDs), producing a `disabled` set of node uids for this tick — a direct generalization of NMS's logic-gate puzzles. `MachineRunner._updateRefiner`/`_updatePlanter` (`machines.js`) gain one new precondition: a refiner/extractor with a `power` block only calls `settleRefiner`/advances its job while its uid is in `net.poweredSet` (machines without a power link, or in bases with no power system engaged, keep today's always-on behavior for backward compatibility with existing saves).

### 4.3 Base save schema (parts as seed+transform deltas)

Today's `gs.bases` entries (`state.js:45`) store absolute world `x,y,z,rotY` per piece with no base identity. The replacement schema anchors every part to a **base origin** (the Base Computer's transform) and stores only the local delta plus enough state to reconstruct — no mesh data, ever:

```js
// gs.basesV2: BaseRecord[]
{
  id: 'base_9f3a1c',                 // stable uid, independent of world position
  name: 'Ferrox Ridge Outpost',
  systemId, planetIndex,
  anchor: { pos: [x, y, z], rotY: 0 },   // Base Computer transform; all parts are local to this
  claimRadius: 150,
  parts: [
    { uid: 'p1', partId: 'metal_foundation', local: { pos: [0,0,0], rotY: 0 }, paint: 'default' },
    { uid: 'p2', partId: 'metal_wall_straight', local: { pos: [0,0,2], rotY: 1.5708 }, paint: 'default' },
    { uid: 'p3', partId: 'refiner_wired', local: { pos: [4,0,0], rotY: 0 },
      state: { job: { recipeIdx: 0, started: 1735900000000, qtyRuns: 4, doneRuns: 2 }, output: null } },
  ],
  wires: [ { uid: 'w1', kind: 'power', from: ['p4','out'], to: ['p3','in'] } ],
  logic: [ { uid: 'l1', kind: 'AND', inputs: ['sw1','sensor1'], gates: ['w2'] } ],
  storage: { p5: [{ id: 'ferrox', qty: 40 }] },
  version: 2,
  builtAt: 1735800000000,
  lastVisited: 1735900000000,
}
```

Storing `local` transforms relative to `anchor` (rather than absolute world coordinates as today) is the load-bearing change: it makes a base **relocatable/exportable** (share the record without world coordinates leaking a specific save's galaxy seed context beyond `systemId`), and — importantly for the terrain-rework dependency — it means once Volume 2/3 lands and world coordinates become floating-origin/spherical, only `anchor` needs re-projecting onto the new spherical surface; every part's local delta is untouched. `GameState.save()`/`load()` (`state.js` 108–179) need no structural change — `basesV2` is just another field on the serialized `gs` object — but a one-time migration function should lift legacy `gs.bases` entries (`{systemId, planetIndex, pieces:[{kind,x,y,z,rotY}]}}`) into `basesV2` by synthesizing an `anchor` from the centroid of existing pieces and remapping `kind` → a matching `partId` in the new catalog, so existing saves are not wiped.

### 4.4 Module/file plan

| Module | Responsibility |
|---|---|
| `src/gameplay/parts/catalog.js` | `PartDef` registry (structure/room/tech/decoration/farming/power), replaces `PIECES` |
| `src/gameplay/parts/sockets.js` | Socket type-compatibility table, `findSnapTarget`, collision AABB test |
| `src/gameplay/basebuilding.js` | Refactored `BaseBuilder`: catalog-driven ghost/placement, claim-radius check against `base.anchor`, free-placement + symmetry modes |
| `src/gameplay/power/graph.js` | `PowerGraph`, `solvePowerGraph()`, network union-find, battery charge/discharge |
| `src/gameplay/power/logic.js` | Switch/sensor/timer/gate evaluation (`evalLogicLayer`) |
| `src/gameplay/power/wires.js` | Wire placement tool (freeform polyline), wire→network indexing |
| `src/gameplay/farming.js` | Hydroponic tray / planter / biodome crop tables, extends today's `CROPS`/`planterProgress` |
| `src/gameplay/blueprints.js` | Unlock registry, Salvaged Data currency, analysis-terminal UI hook |
| `src/gameplay/basespecialists.js` | Specialist recruit state machine, room-assignment, blueprint-selling terminal (ties into `src/gameplay/quests.js`, Volume 10) |
| `src/gameplay/settlements.js` | Settlement sim: population/happiness/productivity ticks, policy event generator |
| `src/ui/settlementui.js` | Policy/dispute pop-ups, building funding menu |
| `src/gameplay/freighter.js` + `src/states/freighterstate.js` | Freighter interior state (reuses `parts/catalog.js` + a freighter-only part subset), hangar docking, fleet-expedition resolver |
| `src/ui/buildui.js` | Extended catalog browser: category tabs, per-part unlock/afford state, symmetry/free-placement toggles (today's file only renders 9 fixed slots) |
| `src/gameplay/state.js` | `gs.basesV2` schema + `migrateLegacyBases()` |

---

## 5. Phases

1. **Catalog & socket core** — `parts/catalog.js`, `parts/sockets.js`, port the 9 existing `buildPiece()` bodies to per-id factories, replace `_snap()` with `findSnapTarget()`, add collision AABB rejection. No new content yet — this is a refactor that must not regress existing saves (migration function ships in the same phase).
2. **Content: structure sets + decoration** — author 3 more structural sets (wood/concrete/alloy reskins of the existing geometry kit plus new silhouettes: corner wall, stairs, ramp, catwalk), prefab room, and a first decoration pass (5–8 furniture/lighting pieces). Free-placement + symmetry toggles land here.
3. **Power MVP** — `power/graph.js`, `power/wires.js`; ship exactly 4 power parts (solar panel, battery, wire, powered light) end to end, replacing the always-on `light` piece. This phase's own acceptance bar is the "solar → battery → light" chain in §7.
4. **Logic & production gating** — `power/logic.js` (switch, sensor, timer, AND/OR/NOT gate); wire the refiner/extractor precondition into `machines.js` so jobs require `net.poweredSet`.
5. **Farming expansion + blueprint unlocks** — multi-crop hydroponics/biodomes (`farming.js`), `blueprints.js` unlock gate replacing flat resource-only costs for tier-2+ parts.
6. **Base identity & schema v2** — Base Computer part, claim radius enforcement, `gs.basesV2`, multi-base browser UI, migration of legacy saves.
7. **NPC specialists** — `basespecialists.js` + quest hooks into Volume 10's `quests.js`/`npcs.js`; each specialist unlocks a room type + blueprint tier.
8. **Settlements sim** — `settlements.js` + `settlementui.js`: claim, population/happiness/productivity ticks, policy events, funded building upgrades, sentinel-raid hook into Volume 6's encounter director.
9. **Freighter bases** — gated on a freighter ship class existing at all (Volume 7); interior reuses the Phase 1–2 catalog, adds hangar docking and a fleet-expedition resolver.
10. **Terrain leveling / true flatten tool** *(stretch, Engine-gated)* — revisit once Volume 2/3 lands; until then, ship the "auto-footing" stopgap described in §4.1.

---

## 6. Effort & risk (engineer-weeks)

| Area | Engineer-weeks | Risk |
|---|---|---|
| Catalog/socket core refactor (Phase 1) | 2.5 | Medium — must not break existing saves; needs the migration path day one |
| Content authoring: 3 structure sets + decoration (Phase 2) | 3.5 | Low — mechanical extension of proven `buildPiece()` pattern |
| Power graph + wires MVP (Phase 3) | 3 | Medium — solver correctness (network partitioning, battery balance) needs unit tests independent of rendering |
| Logic layer + production gating (Phase 4) | 2.5 | Medium — boolean-signal evaluation order (cycles in gate graphs) needs a defined tie-break rule |
| Farming expansion + blueprints (Phase 5) | 3 | Low |
| Base identity/claim/schema v2 + multi-base UI (Phase 6) | 2.5 | Medium — migration correctness for existing player saves is the main hazard |
| NPC specialists (Phase 7) | 3 | Medium — depends on Volume 10 quest infrastructure existing/being extended concurrently |
| Settlements sim (Phase 8) | 4.5 | High — biggest net-new system (population/economy tick loop, policy content, raid integration); easy to scope-creep |
| Freighter bases (Phase 9) | 5–7 | High — **blocked** until a freighter ship class/state exists (Volume 7 dependency); interior/hangar/fleet is otherwise a re-skin of Phases 1–2 + a new expedition-resolution sim |
| Terrain leveling / true flatten (Phase 10) | — | **Blocked** on Volume 2 (spherical planets) / Volume 3 (voxel terrain) engine rebuild; only a stopgap ("auto-footing" skirts) is buildable against the current `y=f(x,z)` heightfield described in §4.1 |
| **Total (Phases 1–8, buildable now)** | **~24.5 wk** | — |
| **Total incl. Freighter (Phase 9)** | **~29.5–31.5 wk** | Freighter portion carries Volume 7 dependency risk |

**Terrain dependency called out explicitly, per the brief:** every placement/snap number above assumes the current flat heightfield with the auto-footing stopgap. True "flatten ground for a foundation," ground-conforming footings without skirt meshes, and any base built on non-flat/voxel-edited terrain are **not** included in these estimates and should be re-scoped once Volume 2 (spherical planets) and Volume 3 (voxel terrain) land — building the full socket/power/settlements stack now is still the right call, since none of it needs to be re-architected when terrain changes underneath it (only `BaseRecord.anchor` re-projection and the footing mesh generator change).

---

## 7. Acceptance criteria (headless, Playwright + SwiftShader)

1. **Snapping.** Script: instantiate `BaseBuilder`, place a `metal_foundation` at a fixed point, then place a `metal_wall_straight` aimed at the foundation's `edge_n` socket. Assert (a) the wall's resolved world transform matches the foundation's `edge_n` socket transform within 1 cm / 0.5°, (b) `findSnapTarget` returns non-null only for compatible socket types (aim a `roof` piece at a bare floor socket and assert `null`), and (c) placing a second wall overlapping the first's collision AABB is rejected.
2. **Power chain.** Build a base with one `solar_panel`, one `battery`, one `wire`-connected `powered_light`, no other network members. Drive `simClock` through a synthetic day/night cycle at accelerated `dt`. Assert: (a) during full daylight with `battery` at max charge, `net.poweredSet.has(light.uid) === true` and the light mesh's emissive intensity is nonzero; (b) at the instant `simClock` crosses into night with the battery pre-charged to a known `chargeWh`, the light stays powered by discharge until the battery's charge is exhausted (assert charge decreases monotonically and the light stays on exactly until `chargeWh <= 0`); (c) once the battery is depleted and it is still night, `net.poweredSet.has(light.uid) === false` and the light mesh reports `powered:false`. Repeat with the wire disconnected and assert the light is never powered regardless of sun/battery state (proves the graph, not just the producer, gates the consumer).
3. **Logic gating.** Wire a `switch` and a `powered_light` through an `AND` gate with a second dummy `sensor` input forced `true`/`false` in test fixtures. Assert the light is powered only when both inputs are `true`, and that toggling the switch mid-tick flips `poweredSet` on the next `solvePowerGraph` call without requiring a rebuild of the network.
4. **Production gating.** Place a `refiner_wired` with no power connection and start a job; assert `settleRefiner` never advances `doneRuns` regardless of elapsed wall-clock time. Connect it to a powered network; assert runs advance at the recipe's normal rate.
5. **Persistence round-trip.** Build a base of ≥10 parts spanning structure/power/decoration categories plus one wire and one logic gate, call `gs.save()`, discard the in-memory `BaseBuilder`/`PowerGraph`, call `GameState.load(slot)`, reconstruct `BaseBuilder` for the same `systemId`/`planetIndex`. Assert: (a) part count, `partId`s, and local transforms are byte-identical to pre-save state; (b) the wire and logic-gate records are reconstructed and `solvePowerGraph` on the reloaded base produces the same `poweredSet` as before save (given the same simulated clock); (c) a refiner job's `doneRuns`/`started` fields survive the round trip and continue advancing based on `Date.now()` deltas exactly as `machines.js` does today.
6. **Legacy migration.** Load a fixture save containing the *old* `gs.bases` schema (`{systemId, planetIndex, pieces:[{kind,x,y,z,rotY}]}}`, no `basesV2`); assert `migrateLegacyBases()` produces a `basesV2` entry with a synthesized `anchor`, one `parts[]` entry per legacy piece mapped to a valid `partId`, and that `BaseBuilder` materializes visually equivalent geometry (same kind, same world position within 1 cm) to what the pre-migration code would have rendered.

---

*Continue to [Volume 9 — Economy, Crafting, Refining & Progression](./09-economy-crafting.md) or [Volume 10 — NPCs, Factions, Language, Story & AI](./10-npcs-factions.md) for the specialist quest-line dependency, or back to [Volume 0 — Executive Summary](./00-executive-summary.md).*
