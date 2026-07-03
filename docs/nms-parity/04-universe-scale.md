# Volume 4 — Universe Scale, Galaxy & Meta-progression

## Scope and headline verdict

No Man's Sky's universe is a **64-bit addressable coordinate space** — roughly 18.4 quintillion planets across 256 galaxies — that is never stored, only *resolved*: any valid address deterministically reproduces the same star, the same planets, the same terrain, forever, from the same procedural seed. AllMansSky already believes in that idea. `src/universe/galaxy.js` generates stars lazily from a sector hash and caches them; `src/universe/starsystem.js` derives a full system from a 32-bit seed; nothing about a system is ever written to disk except the player's own edits. That is the right foundation, and it is why this volume's verdict differs from Volumes 2–3: **this is not an engine-gated problem.** There is no spherical-planet rebuild, no voxel field, no floating-origin camera required to close most of this gap. It is a data-model and math problem — an address scheme, a glyph codec, a gating table, a map that scales — layered on top of generation code that already does the hard part (deterministic derivation) correctly. What is missing is *scope* (one galaxy instead of 256), *structure* (no global address, no portal network, no galactic center) and *teeth* (warp costs a fuel item, never a capability check). All three are tractable in a few engineer-weeks each, which is why this volume's overall effort estimate — corroborated bottom-up in §6 — lands in the same 2–3 engineer-month band Volume 0 flagged for it up front.

---

## 1) What NMS does

**The address space.** No Man's Sky's universe is conceptually a fixed 3-D voxel lattice of galactic coordinates; a given `(X, Y, Z)` voxel deterministically contains at most one star system, and a system's planets/moons are addressed by a small index within it. Combined with a galaxy selector, the full space is documented by the community as roughly **18,446,744,073,709,551,616 possible planets** — i.e., an address space on the order of 2^64 — of which only a minute fraction are ever actually visited by any player. Nothing about an unvisited planet exists anywhere until an address resolves it: terrain, biome, flora and fauna tables, resources, weather, and the sky are all *pure functions of the address plus the game's global seed*. This is the mechanism, not a marketing claim: it is why the "18 quintillion planets" figure is defensible at all — storage was never the bottleneck, generation determinism was.

**256 galaxies as a stack.** The address space is partitioned into **256 galaxies**, each with its own name (Euclid, Hilbert, Calypso, Hesperius, Eissentam, and so on through the full list revealed via the ending sequence), its own visual "grade" (nebula palette, nebula density, nastier hazards deeper in the stack), and its own copy of the coordinate lattice reseeded by galaxy index. Galaxies are traversed **in a fixed order**, one direction only, via the game's core narrative loop (see "pilgrimage" below) — you cannot warp sideways from galaxy 12 to galaxy 200; you *progress* the stack by reaching each galaxy's center and choosing to continue.

**Galaxy shape.** Viewed on the galaxy map, a galaxy is a dense, roughly logarithmic-spiral disc: a bright core, two-to-several spiral arms of denser star population, and a diffuse, sparser rim. Traveling far enough outward — past the point where the game's simulation budget for "interesting" systems tails off — puts the player in **the Fade**, a low-density, largely featureless boundary region with minimal points of interest, functionally the game's way of admitting the address space is larger than the content budget; the Fade is not a hard wall, it is a *density* gradient, same mechanism as the populated core, just tuned toward near-empty. Between the extremes, regions vary in population density and "interestingness" (some pockets are rich in stations/outposts, others are near-empty voids), which the galaxy map visualizes as bright vs. dark map regions.

**Star systems.** Each system has: a **star color class** — Yellow, Red, Green, and Blue are the four gameplay-gating colors (plus generation-only spectral flavor like white dwarfs/neutron stars/dead stars that layer additional hazard or reward text on top); an **economy type and wealth tier** (from failed/impoverished through wealthy, e.g. mining, trading, manufacturing, high/mid/low wealth) that sets prices and available goods; a **conflict level** (low/medium/high) that governs pirate ambush frequency and system-chatter tone; a **dominant race** among the three NPC species (Gek, Korvax, Vy'keen) or no dominant race (or, rarely, first-spawn Traveller/Atlas systems), which flavors the space station's architecture, NPC dialogue, and available race-specific tech/blueprints at that station; and **1–6 orbital bodies** (planets and moons together), each independently seeded with its own biome, weather, resources, and sentinel aggression.

**Portal glyph addressing.** A fixed physical **Portal** structure exists on the surface of most planets. Its interface is a ring of **16 glyph symbols** (functionally a base-16/hex alphabet rendered as sigils rather than digits). A **12-glyph address** dials any known coordinate: by the community-reverse-engineered structure, glyph 1 selects the **planet/moon index** within the target system, and the remaining 11 glyphs encode the target **system's galactic voxel coordinate** (a vertical/Y component across several glyphs, then the two horizontal/planar components), *within the current galaxy* — portals do not carry a galaxy digit; the portal network is scoped per-galaxy, matching the fact that jumping galaxies is gated behind the center pilgrimage, not the portal network. Dialing a full address and stepping through instantly relocates the player (on foot, without their ship) to that exact planet, anywhere reachable in the current galaxy, bypassing ship travel and hyperdrive-class gating entirely — the portal network's whole value proposition is that it ignores the hyperdrive gate.

**Hyperdrive star-class gating.** The base hyperdrive can only chart a course into **Yellow-family** (and unclassified/default) star systems. Reaching **Red** systems requires a hyperdrive upgrade fueled by **Cadmium**; **Green** requires an upgrade fueled by **Emeril**; **Blue** requires an upgrade fueled by **Indium**. Each is a separate installable technology (not merely "more fuel of the same kind") — without the matching upgrade, the galaxy map **will not let you set a course** into a system of that color at all, full stop, no matter how much of the wrong fuel is in the tank. This is real, teeth-having progression gating baked into the map UI itself, not a suggestion.

**Black-hole shortcuts.** Flying a starship directly into a system's black hole triggers an automatic warp that advances the player a substantial, semi-random distance **toward the galactic core**, entirely free of hyperdrive fuel — at the cost of moderate hull/system damage (and, in early game versions, a chance of inventory corruption, later patched away as a purely punitive-but-safe mechanic). It is deliberately double-edged: a free, large jump toward the center, paid for in risk rather than resources.

**The galactic-center pilgrimage.** From the start of a save, the galaxy map displays a **distance-to-center** readout (in a light-year-equivalent unit) that visibly decreases with each warp made in the core's general direction. The early game's main story thread (guided by NPC dialogue — historically Explorer archetype guidance, later generalized across all four starting missions) explicitly points the player at the core and frames every subsequent warp as one step of a pilgrimage. Reaching extreme proximity to the center triggers a final sequence — historically framed through the **Atlas path** (an alternate, lore-heavy route offered by Atlas Interfaces found in derelict Atlas stations, which can shortcut or reflavor the ending) — culminating in a choice: continue into the core (which **resets the galaxy**, advancing the player to the *next* galaxy in the 256-stack, retaining ship/inventory/base-blueprint progress but starting that galaxy's map and discoveries fresh) or decline and remain. This loop is the game's only hard "meta-progression tier": there is no other axis on which the player's *save* advances through discrete stages besides "which galaxy am I in."

**Waypoints & target-system pathfinding.** The galaxy map supports **locking a waypoint** on any visible system (your own marker, or a shared "signal booster" marker from another player's discovery), and — because a single hyperdrive jump only reaches a limited range — **charts a path across several warps** toward a distant waypoint, visually drawing the intermediate hops and letting the player warp leg-by-leg (or, with sufficiently upgraded hyperdrive range, fewer, longer legs) toward it. The map also supports filtering/searching for specific system or economy types en route.

**Discovery naming & the upload registry.** The first player to scan a system, planet, or lifeform can **rename it** (subject to a profanity/format filter) and **upload the discovery** to Hello Games' shared servers via the in-game Discoveries/Catalogue app; subsequent visitors see "Discovered by [name]" and the player-chosen names, with milestone rewards (nanites, trophies) for cumulative discovery counts. This is the game's lightweight, persistent multiplayer-adjacent layer even in fully offline play (uploads queue and sync when a connection is available).

**Region naming.** Independent of star system names, the galaxy is overlaid with a coarser, fixed **region grid** — each region has its own procedurally generated name, and crossing a region boundary in flight surfaces a "You have entered [Region Name]" HUD toast, giving the universe a sense of *administrative geography* one layer up from individual systems.

---

## 2) What AllMansSky has today

Source of truth: `src/universe/galaxy.js` (seeding, sector cache, neighbor queries), `src/universe/starsystem.js` (per-system generation), `src/core/rng.js` (determinism primitives), `src/ui/mapui.js` (the galaxy map UI), `src/universe/lore.js` (naming), `src/states/spacestate.js` (`_tryWarp`), `src/gameplay/trading.js` (economy), `src/gameplay/spacelife.js` (anomaly behavior), `src/gameplay/quests.js` (`_retarget`).

**One galaxy, one seed, a live neighbor bubble.** `Galaxy` (`galaxy.js:32-180`) is constructed with a single `seed` (default `GALAXY_SEED_DEFAULT = 1337`, `galaxy.js:9`) and generates stars **lazily per sector**: `starsInSector(sx,sy,sz)` (`galaxy.js:60-95`) hashes `(seed, sx, sy, sz)` through `hash32` into an `RNG`, rolls a Poisson-ish star count (0–4) from `_expectedCount` (`galaxy.js:44-54`), and forks a child RNG per star for its class, name, position, and color. Results are cached in a `Map` capped at `MAX_SECTOR_CACHE = 8192` sectors with naive first-key eviction (`galaxy.js:90-93`) — a genuine LRU-adjacent cache, not unlimited memory growth. This is architecturally identical in spirit to NMS's voxel-lattice-resolves-a-system model — the sector *is* the coordinate, the RNG fork *is* the deterministic-address-to-content function — but the *scope* is a single galaxy with a genuinely finite population: `_expectedCount` decays to zero past `DISC_RADIUS * 1.15` (69 sectors), and the module's own header comment states the design target plainly: **"~10^7 reachable stars in a thin spiral disc"** (`galaxy.js:28`). Ten million is a real number, not infinite-in-principle, and it is roughly 12 orders of magnitude short of 18.4 quintillion.

**Galaxy shape is genuinely present, just undifferentiated.** `_expectedCount(sx,sy,sz)` (`galaxy.js:44-54`) combines a radial Gaussian-plus-exponential falloff, a **two-armed spiral density term** (`0.5 + 0.5*cos(2θ - r*0.3 - armPhase)`, with `armPhase` itself hashed per-seed at construction so "each galaxy seed twists its spiral arms differently," `galaxy.js:40`), and a vertical Gaussian disc-thickness term that thickens toward the core (bulge). This is a real, if simple, spiral-disc density model — credit where due, this is more than cosmetic dressing. What's missing is everything *on top* of density: there is no discrete region grid (only continuous sector coordinates), no explicit "Fade" concept (density just asymptotes to zero, unlabeled, unvisualized), and no way for the player to ever see the shape at any scale larger than the ~4-sector bubble the map renders (see below) — the spiral is real in the math and invisible in the game.

**Star classes, economy, faction, and "conflict" all exist — but as three unconnected systems.** `STAR_CLASSES` (`starsystem.js:16-25`) defines eight real spectral classes (`M,K,G,F,A,B,O,exotic`) each with weight/colors/temp/radius/lum — richer than NMS's four gameplay colors, closer to real astronomy, but with a critical difference: **NMS's colors are a gameplay gate; ours are cosmetic only** (see the gap table, row 7). Separately, `economyOf(system)` (`trading.js:54-68`) deterministically rolls one of six economy types (`subsistence, mining, agrarian, industrial, technological, commercial`) and a 1–3 wealth tier from the system's own seed, nudged by faction (chorale → technological, sunward → agrarian/mining). Separately again, `rollFaction(rng, edge01)` (`starsystem.js:28-41`) assigns one of four lore factions (`meridian, chorale, sunward, ashen`, `lore.js:67-88`) weighted by `edge01` — the system's normalized distance from the galactic origin (`starsystem.js:75-77`, `clamp01(hypot(x,z)/60)`) — so the raider faction Ashen Fleet genuinely does dominate the rim, a nice touch mirroring NMS's danger-increases-toward-the-Fade feel. A `pirateThreat` scalar (`starsystem.js:125-127`) plays the role of "conflict level," built from `edge01` plus a faction bonus. All three axes are real and deterministic — but `GalaxyMap._renderCard` (`mapui.js:678-707`) only ever surfaces **STATUS, STAR CLASS, FACTION, DISTANCE, PLANETS, and biome tags**; economy and `pirateThreat` are computed everywhere else in the codebase but never shown on the one screen a player would look at to plan a trip.

**Planets, no moons.** `rollPlanetCount` (`starsystem.js:44-51`) rolls 1–6 flat planets per system with no parent/child moon relationship — NMS's "1–6 bodies, some of which are moons of others" becomes "1–6 independent planets" here. A 35%-chance asteroid belt (`starsystem.js:94-100`) and a faction-tinted station (`starsystem.js:104-113`) round out system contents.

**No address, no portals, no glyphs.** There is no numeric or symbolic identifier for a system beyond the internal `starId` string `'sx:sy:sz:i'` (`galaxy.js:29-30, 61-62`) — which is *already*, structurally, most of a coordinate address (three signed integers plus a slot index) — but it is never exposed to the player, never encoded as a shareable code, and has no galaxy-index dimension at all. `Grep` across `src/` for `portal|glyph` returns only unrelated hits (station interior geometry, waypoint HUD icons, a knowledge-stone prop) — the concept does not exist.

**Warp has a fuel cost and zero capability gating.** `SpaceState._tryWarp` (`spacestate.js:349-385`) is the entirety of interstellar travel: it checks `gs.ship.warpCells >= 1` (a craftable `voidcell` item, `items.js:22,34`, "One charge of folded distance"), picks a target — the quest-set `vesperTarget` if reachable, else the nearest unvisited neighbor within `neighborsOf(id, 3)`, else the nearest neighbor period (`spacestate.js:357-359`) — decrements one Void Cell, and switches state. **At no point is the target's `starClass`, economy, or anything else consulted.** A player with a single crafted Void Cell can warp into a `B`-class or `exotic`-class system on their very first jump if RNG happens to place one in range. This is the single largest mechanical gap in this volume: NMS's star-class hyperdrive gate is a headline progression mechanic; ours does not exist in any form.

**Black holes and wormholes are visual set-pieces with a one-shot reward, not a travel mechanic.** `SpaceLife._buildAnomaly` (`spacelife.js:63-156`) constructs a black-hole accretion-disc mesh, a wormhole portal mesh, or a derelict-ship mesh from `system.anomaly.kind` (rolled 8% per system, `starsystem.js:115-123`: 50% derelict, 30% wormhole, 20% blackhole). Proximity to *any* of the three triggers a single `gs.discover('ruins', 'anomaly:'+id, 'Gravimetric Survey', 500)` reward (`spacelife.js:194-200`); derelicts additionally support a salvage interaction (`spacelife.js:213-230`). **Nothing about flying into a black hole moves the player anywhere.** It is exactly what the brief's global context called it: set dressing.

**The galaxy map is a local bubble viewer, not a galaxy overview.** `GalaxyMap` (`mapui.js:141-795`) is a genuinely well-built holographic 3-D scene (its own `WebGLRenderer`, sprite-based stars, procedural glow/ring/grid canvas textures, drag-orbit camera, sonar pulse rings, projected DOM labels) — but its data model is `galaxy.neighborsOf(currentId, SCAN_SECTORS=4)` capped at `MAX_STARS = 64` (`mapui.js:16-17, 211-246`). There is no zoomed-out mode, no view of the galaxy beyond a ~4-sector radius, no way to see the spiral shape `_expectedCount` actually computes, and consequently **no filters** (economy/conflict/race/discovered) because there is no larger data set to filter. Selecting a star sets `gs.quests.vesperTarget` (`mapui.js:665-674`) — a single system, always reachable via one `_tryWarp` call; there is no multi-hop route concept.

**Waypoints are in-world HUD markers, not a galaxy pathfinder.** `WaypointLayer` (`waypoints.js:106-272`) projects up to `MAX_MARKERS = 24` pooled DOM pins for nearby points of interest (ruins, beacons, creatures, landing pads) through the active 3-D camera each frame, with distance-based fade and edge-clamped arrows. It is a per-scene HUD component, unrelated to galaxy-scale travel planning; the name overlaps NMS's "waypoint" vocabulary but the feature is different in kind.

**Discovery tracking is a flat local reward log, not a naming/upload registry.** `gs.discoveries` (referenced throughout `spacelife.js`, `quests.js`) stores keyed boolean-ish flags (e.g. `ruins['anomaly:'+systemId]`) purely to gate one-time lumens rewards. There is no player-chosen renaming of anything, no "first discovered by," and — correctly, since the game is single-player with no backend — no upload registry; this is an honest architectural absence rather than a bug.

**No region naming layer.** `lore.js` generates system, planet, station, NPC, ship, and creature names (all pure functions of a forked `RNG`, `lore.js:151-228`) but nothing at region/zone granularity independent of individual systems.

**The determinism core is the one place this volume has nothing to add.** `hash32` (`rng.js:5-19`, a 32-bit xxhash-style integer mixer accepting any number of integer args), `hashString` (FNV-1a, `rng.js:22-29`), `mulberry32` (`rng.js:32-40`), and the `RNG` class's `.fork(label)` (`rng.js:64`, hashes the parent seed with a label into a fresh independent child stream) together form a genuinely solid, NMS-comparable "address → deterministic content" primitive layer. `SimplexNoise` (`noise.js:14-154`) is seeded the same way and used identically elsewhere (terrain, planet shading). Every extension proposed in §4 is built *on top of* this layer unchanged — it needs no rework, only one more axis of input (a galaxy index) threaded through it.

---

## 3) The gap

| # | NMS feature | AllMansSky today | Severity | Effort |
|---|---|---|:--:|:--:|
| 1 | ~18.4 quintillion (2^64) addressable planets, never stored | Live neighbor-bubble generation from a sector hash; own code comments the *design target* as "~10^7 reachable stars" (`galaxy.js:28`) — finite by ~12 orders of magnitude, and no numeric/symbolic address exists at all | **Structural** | M — `address.js`, ~1 wk |
| 2 | 256 galaxies, traversed as a stack | One galaxy ("Aurelia Reach"), one fixed seed (`GALAXY_SEED_DEFAULT`, `galaxy.js:9`) | **Structural** | M — registry module, ~1 wk |
| 3 | Spiral shape, regions, the Fade edge | Real 2-arm spiral + radial/vertical falloff (`_expectedCount`, `galaxy.js:44-54`) — present in the math, invisible in the UI, no discrete region grid, no labeled Fade | **Cosmetic→Feature** | S — region grid + map overview, ~3–4 d |
| 4 | Star color / economy / conflict / dominant race shown together per system | All three axes exist as separate deterministic systems (`STAR_CLASSES`, `economyOf`, `rollFaction`/`pirateThreat`) but are never unified on one screen (`mapui.js` card omits economy & conflict entirely) | **Feature** | S — card + filter UI, ~2–3 d |
| 5 | 1–6 bodies incl. moons (parent/child) | 1–6 flat independent planets (`rollPlanetCount`, `starsystem.js:44-51`), no moon hierarchy | **Feature** | M — data model + orbit UI, ~1 wk |
| 6 | 16-glyph, 12-glyph portal address network | No portal object, no glyph alphabet, no address concept anywhere in `src/` | **Structural** | L — `portal.js` + UI, ~2 wk |
| 7 | Hyperdrive gating with real teeth (Red/Green/Blue require Cadmium/Emeril/Indium drives) | **None.** `_tryWarp` (`spacestate.js:349-385`) checks only `warpCells >= 1`; target `starClass` is never consulted | **Structural** | M — `hyperdrive.js` + wiring, ~1.5 wk (ties to Vol. 7 tech tree) |
| 8 | Black-hole shortcut: free jump toward center, costs hull | Visual set-piece; proximity grants one `Gravimetric Survey` reward and nothing else (`spacelife.js:63-132, 194-200`) | **Feature** | M — travel hook, ~1 wk |
| 9 | Distance-to-center readout + pilgrimage narrative | No concept of a galactic "center" surfaced anywhere; `edge01` (`starsystem.js:75-77`) computes it internally but only for faction/pirate flavor, never shown | **Structural** | M — `Galaxy.distanceToCenter` + HUD, ~1 wk |
| 10 | Reaching the core resets/advances to the next galaxy (256-stack) | No galaxy reset of any kind; one galaxy forever | **Structural** | M — `pilgrimage.js` + save schema, ~1 wk (design sign-off risk) |
| 11 | Galaxy map: full-galaxy overview with zoom levels | `GalaxyMap` renders only `neighborsOf(id, 4)`, capped at 64 stars (`mapui.js:15-17`); no zoom-out mode exists | **Structural** | L — overview render mode, ~2.5 wk (perf risk at scale) |
| 12 | Map filters: economy / conflict / race / discovered | None — no filter UI exists because there is no larger data set to filter against | **Feature** | S–M — folds into #11, ~1 wk |
| 13 | Multi-hop waypoint pathfinding across the map | `WaypointLayer` (`waypoints.js`) is an in-world POI HUD, not a route planner; `vesperTarget`/`_tryWarp` only ever resolve a single direct neighbor (`spacestate.js:358-359`) | **Feature** | M — A* route planner, ~1.5 wk |
| 14 | Discovery renaming + server-backed upload registry | `gs.discoveries` is a flat local reward-flag log (`spacelife.js:67, 194-230`); no renaming, no "first discovered by," no upload (correctly absent — single-player, no backend) | **Feature** (local) / **Engine-adjacent** (server) | S local, ~1 wk; server upload deferred to Vol. 13 |
| 15 | Region naming, independent of system names | `lore.js` names systems/planets/stations/NPCs/ships/creatures but nothing at region granularity | **Cosmetic→Feature** | S — `regionName()` + HUD toast, ~2–3 d |
| 16 | Deterministic seed→content derivation core | **Present and solid**: `hash32`, `hashString`, `mulberry32`, `RNG.fork` (`rng.js`) — genuinely NMS-comparable in architecture, needs no rework, only one more threaded axis | — (credit) | none |

**Reading the table:** rows 1, 2, 6, 7, 9, 10, 11 are the structural spine — an address scheme, a galaxy registry, a portal codec, a gating table, a center concept, a reset flow, and a map that can render more than 64 stars. None of them require touching rendering fidelity, the state-machine architecture, or anything in Volumes 1–3. Row 16 is the reason: the hardest part of "NMS-scale universe" — deterministic, storage-free generation from a seed — is already solved here at small scale. Volume 4's entire job is *widening the input space* to that already-correct machinery, not replacing it.

---

## 4) Target design

### 4.1 Design principles

1. **Extend, don't replace.** `hash32`, `RNG.fork`, `starsInSector`, `generateSystem` stay exactly as they are; every new piece takes a `galaxyIndex` (or a resolved `Galaxy` instance) as an additional parameter and otherwise reuses existing derivation.
2. **The address is the only state.** No system, planet, or galaxy is ever persisted beyond the player's own edits (visited flag, renamed label, dig deltas). Anything else must be re-derivable from `(rootSeed, address)` alone, at any time, by any code path (save file, glyph input, portal prop, map click).
3. **Two generation tiers.** *Fine* generation (today's `generateSystem`, one star at a time) stays exact and expensive. A new *coarse* tier (`regionDigest`) approximates aggregate stats (dominant economy/faction, density) for thousands of systems at once, cheaply, for the galaxy-overview map — accepting statistical rather than literal accuracy at that zoom level, the same trade NMS itself makes (the map is a simplification, not a live query of every system).

### 4.2 The address model

A **universe address** is a 64-bit value (`BigInt` in JS — `Number` loses precision past 2^53, and this format needs the full width):

| Bits (MSB→LSB) | Width | Field | Range / notes |
|---|:--:|---|---|
| 63–56 | 8 | `galaxyIndex` | 0–255, matches the 256-galaxy stack |
| 55–40 | 16 | `sectorX` (signed, bias +32768) | disc-plane axis; current `DISC_RADIUS=60` needs ~7 bits, 16 leaves headroom for denser galaxies later in the stack |
| 39–24 | 16 | `sectorZ` (signed, bias +32768) | disc-plane axis, same rationale |
| 23–16 | 8 | `sectorY` (signed, bias +128) | thin vertical/bulge axis — 8 bits is already generous given `scaleH` tops out around 3.5 |
| 15–12 | 4 | `starSlot` (2 bits, 0–3) + `checksum` (2 bits) | `starSlot` matches `starsInSector`'s hard cap of 4; checksum is a parity fold over the other 44 bits, cheap typo-guard |
| 11–8 | 4 | `planetIndex` | 0 = the star/dock itself, 1–6 = today's planets, 7–15 reserved for future moons |
| 7–0 | 8 | `formatVersion` | lets the layout evolve without breaking old shared addresses |

The low 48 bits (`sectorX..planetIndex`) are exactly the **portal glyph payload** — a portal address never carries `galaxyIndex` or `formatVersion`, mirroring NMS (portals are scoped to the current galaxy). This means glyph encode/decode is just "extract/replace the middle 48 bits," and a full 64-bit address is trivially built by prepending the current galaxy's index and appending a version byte.

```js
// src/universe/address.js
const W = { planet: 4n, sx: 16n, sz: 16n, sy: 8n, slot: 2n, chk: 2n };
const PAYLOAD_BITS = 48n; // planet+sx+sz+sy+slot+chk

function bias(v, bits)  { return BigInt(v) + (1n << (bits - 1n)); }
function unbias(u, bits) { return Number(u - (1n << (bits - 1n))); }

function checksum(payloadNo44Bits /* BigInt, 44 bits before chk is appended */) {
  // 2-bit fold: XOR all 4-bit nibbles, take low 2 bits — catches single
  // mistyped glyph with high probability; not cryptographic, just a guard
  let x = 0n, p = payloadNo44Bits;
  while (p > 0n) { x ^= (p & 0xFn); p >>= 4n; }
  return x & 0b11n;
}

export function packPayload({ sx, sy, sz, starSlot, planetIndex }) {
  let p = BigInt(planetIndex & 0xF);
  p = (p << W.sx) | bias(sx, W.sx);
  p = (p << W.sz) | bias(sz, W.sz);
  p = (p << W.sy) | bias(sy, W.sy);
  p = (p << W.slot) | BigInt(starSlot & 0b11);
  return (p << W.chk) | checksum(p);              // 48-bit BigInt
}

export function unpackPayload(payload) {
  let p = payload;
  const chk = p & 0b11n; p >>= W.chk;
  const expected = checksum(p);
  const starSlot = Number(p & 0b11n); p >>= W.slot;
  const sy = unbias(p & ((1n << W.sy) - 1n), W.sy); p >>= W.sy;
  const sz = unbias(p & ((1n << W.sz) - 1n), W.sz); p >>= W.sz;
  const sx = unbias(p & ((1n << W.sx) - 1n), W.sx); p >>= W.sx;
  const planetIndex = Number(p & 0xFn);
  if (chk !== expected) throw new Error('address checksum mismatch');
  return { sx, sy, sz, starSlot, planetIndex };
}

export function packAddress({ galaxyIndex, ...rest }, version = 1) {
  const payload = packPayload(rest);
  return (BigInt(galaxyIndex & 0xFF) << 56n) | (payload << 8n) | BigInt(version & 0xFF);
}

export function unpackAddress(address) {
  const galaxyIndex = Number((address >> 56n) & 0xFFn);
  const version = Number(address & 0xFFn);
  const payload = (address >> 8n) & ((1n << PAYLOAD_BITS) - 1n);
  return { galaxyIndex, version, ...unpackPayload(payload) };
}
```

### 4.3 Seed → system derivation (no storage, ever)

```js
// src/universe/resolve.js
import { hash32 } from '../core/rng.js';
import { Galaxy } from './galaxy.js';
import { unpackAddress } from './address.js';

const galaxyCache = new Map(); // galaxyIndex -> Galaxy (in-memory only, never serialized)

export function galaxySeedForIndex(rootSeed, galaxyIndex) {
  return hash32(rootSeed, galaxyIndex, 0x6a1a);
}

export function galaxyForIndex(rootSeed, galaxyIndex) {
  let g = galaxyCache.get(galaxyIndex);
  if (!g) {
    g = new Galaxy(galaxySeedForIndex(rootSeed, galaxyIndex), galaxyIndex);
    galaxyCache.set(galaxyIndex, g);
  }
  return g;
}

/** The single entry point every address consumer (portal, glyph UI, map
 *  click, save load) calls. Pure function of (rootSeed, address). */
export function resolveAddress(rootSeed, address) {
  const { galaxyIndex, sx, sy, sz, starSlot, planetIndex } = unpackAddress(address);
  const galaxy = galaxyForIndex(rootSeed, galaxyIndex);
  const starId = `${sx}:${sy}:${sz}:${starSlot}`;
  const system = galaxy.getSystem(starId);          // null if that sector-slot is empty — a valid, "uninhabited" address, same as NMS's rare dead addresses
  const planet = system && planetIndex > 0 ? (system.planets[planetIndex - 1] ?? null) : null;
  return { galaxyIndex, galaxy, starId, system, planetIndex, planet };
}
```

Note the address deliberately reuses the *exact* `'sx:sy:sz:i'` string `galaxy.js` already produces internally (`galaxy.js:29-30, 61-62, 98-105`) — resolving an address is only a thin, ~15-line wrapper around code that already exists and is already tested by virtue of running the whole game today.

### 4.4 Glyph codec and the portal object

Sixteen sigils (reuse the game's holographic-glyph visual language already established by `waypoints.js`'s SVG icon set, `waypoints.js:28-45`, for a consistent Choir-of-Glass aesthetic) map 1:1 to hex nibbles:

```js
// src/universe/glyphs.js
export const GLYPH_SYMBOLS = ['᛫','⟐','⟑','⟒','⟓','⟔','⟕','⟖','⟗','⟘','⟙','⟚','⟛','⟜','⟝','⟞']; // placeholder set; swap for final art

export function payloadToGlyphs(payload48 /* BigInt */) {
  let p = payload48, out = '';
  for (let i = 0; i < 12; i++) { out = GLYPH_SYMBOLS[Number(p & 0xFn)] + out; p >>= 4n; }
  return out;
}

export function glyphsToPayload(str) {
  if (str.length !== 12) throw new Error('portal address must be 12 glyphs');
  let p = 0n;
  for (const ch of str) {
    const v = GLYPH_SYMBOLS.indexOf(ch);
    if (v < 0) throw new Error(`unknown glyph: ${ch}`);
    p = (p << 4n) | BigInt(v);
  }
  return p; // unpackPayload() will throw on bad checksum
}
```

```js
// src/universe/portal.js
import { packAddress, unpackAddress } from './address.js';
import { payloadToGlyphs, glyphsToPayload } from './glyphs.js';
import { resolveAddress } from './resolve.js';

export class Portal {
  constructor(address /* BigInt */) { this.address = address; }

  /** 12-glyph string for display/UI input, current-galaxy-scoped (matches NMS). */
  get glyphs() {
    const payload = this.address & ((1n << 48n) - 1n) << 8n; // strip galaxy+version bytes
    return payloadToGlyphs(payload >> 8n);
  }

  static fromGlyphs(glyphStr, galaxyIndex) {
    const payload = glyphsToPayload(glyphStr);
    return new Portal(packAddress({ galaxyIndex, ...unpackAddressPayloadFields(payload) }));
  }

  resolve(rootSeed) { return resolveAddress(rootSeed, this.address); }
}
```

Each generated system gets its *own* portal, seeded exactly like `belt`/`station`/`anomaly` today (`starsystem.js:94-123`) — a `rng.chance(...)` roll placing a `Portal` prop on one planet, whose `address` is simply `packAddress({ galaxyIndex, sx, sy, sz, starSlot, planetIndex: thatPlanetIndex })`, i.e. **the portal's own coordinates**. This is what makes round-tripping trivial to verify (§7): dial the glyphs printed on a portal, and `resolve()` must return the system the portal is standing in.

### 4.5 Star-class hyperdrive gating (real teeth, tied to Volume 7)

```js
// src/gameplay/hyperdrive.js
export const HYPERDRIVE_TIERS = [
  { id: 'base',      name: 'Base Hyperdrive',   classes: ['M','K','G','F','A'] },
  { id: 'ember',     name: 'Ember Core',         classes: ['B'],      reqs: [['emberite', 5], ['voidcell', 2]] },
  { id: 'voidglass', name: 'Voidglass Core',     classes: ['O'],      reqs: [['voidglass', 5], ['voidcell', 4]] },
  { id: 'luminel',   name: 'Luminel Resonator',  classes: ['exotic'], reqs: [['luminelshard', 3], ['voidcell', 8]] },
];
const ORDER = HYPERDRIVE_TIERS.map(t => t.id);

export function reachableClasses(tierId) {
  const idx = Math.max(0, ORDER.indexOf(tierId));
  return HYPERDRIVE_TIERS.slice(0, idx + 1).flatMap(t => t.classes);
}
export function canReach(starClass, tierId) { return reachableClasses(tierId).includes(starClass); }
export function tierRequiredFor(starClass) {
  return HYPERDRIVE_TIERS.find(t => t.classes.includes(starClass))?.id ?? 'base';
}
```

`SpaceState._tryWarp` (`spacestate.js:349-385`) gains one check, inserted right after target selection and before `warpCells` is spent:

```js
if (!canReach(target.starClass, gs.ship.hyperdriveTier)) {
  const need = HYPERDRIVE_TIERS.find(t => t.id === tierRequiredFor(target.starClass));
  events.emit('notify', {
    text: `HYPERDRIVE INSUFFICIENT — ${target.starClass}-CLASS REQUIRES ${need.name.toUpperCase()}`,
    tone: 'warn',
  });
  audio.sfx('deny');
  return;
}
```

`gs.ship.hyperdriveTier` (new save field, default `'base'`) is upgraded through Volume 7's ship-tech UI (`shipyardui.js`) consuming the `reqs` item list above — this volume only specifies the gate and the data table; Volume 7 owns the purchase/install flow.

### 4.6 Galaxy map: bubble → full-galaxy overview, with filters

`GalaxyMap` keeps its existing bubble mode (`mapui.js:211-246`) unchanged and gains a second data path for zoomed-out viewing, driven by a cheap **coarse digest** rather than full `generateSystem` calls (which would be far too expensive to run for every system in a 10⁷-star galaxy on every map open):

```js
// src/universe/galaxy.js additions
const REGION_SECTORS = 8; // one overview point per 8×8×8 sector block

regionDigest(rx, ry, rz) {
  const rng = new RNG(hash32(this.seed, rx, ry, rz, 0xd161));
  const cx = rx * REGION_SECTORS + REGION_SECTORS / 2, cz = rz * REGION_SECTORS + REGION_SECTORS / 2;
  const edge01 = clamp01(Math.hypot(cx, cz) / (DISC_RADIUS));
  return {
    dominantFaction: rollFaction(rng.fork('f'), edge01),   // same fn `starsystem.js` already exports
    dominantEconomy: rng.pick(ECON_KEYS_FOR_DIGEST),        // weighted pick, mirrors economyOf's table
    avgConflict: clamp01(rng.range(0.05, 0.3) + edge01 * 0.45),
    density: this._expectedCount(cx, ry * REGION_SECTORS, cz), // reuses the existing spiral density fn
  };
}

distanceToCenter(starId) {
  const [sx, , sz] = starId.split(':').map(Number);
  return Math.hypot(sx, sz); // sectors from the galactic origin
}
```

The overview render mode samples one `regionDigest` per on-screen region cell (a few hundred points even at full-galaxy zoom, versus the ~10⁷ underlying stars — cheap), instances them as tinted points colored by `dominantFaction`/`dominantEconomy`, and lets the player click a region to **drill down** into the existing bubble view centered on that region's nearest generated star. Filter toggles (economy/conflict/race/discovered) are pure client-side predicates over the same digest array — no new generation cost, no new determinism risk, because `regionDigest` is itself deterministic in `(seed, rx, ry, rz)`.

### 4.7 Black holes, center distance, and the pilgrimage/rebirth loop

```js
// src/gameplay/pilgrimage.js
import { events } from '../core/events.js';

export const CORE_RADIUS_SECTORS = 3;

export function jumpBlackHole(gs, galaxy, fromId) {
  const candidates = galaxy.neighborsOf(fromId, 6)
    .filter(n => galaxy.distanceToCenter(n.id) < galaxy.distanceToCenter(fromId))
    .sort((a, b) => galaxy.distanceToCenter(a.id) - galaxy.distanceToCenter(b.id));
  const target = candidates[0];
  if (!target) return null;                 // already at the core; nothing closer in range
  gs.ship.hull = Math.max(1, gs.ship.hull - gs.ship.hullMax * 0.22); // cost is damage, not fuel
  return target;                              // no warpCells spent — mirrors NMS's free-but-risky shortcut
}

export function checkPilgrimage(gs, galaxy, currentStarId) {
  const d = galaxy.distanceToCenter(currentStarId);
  gs.coreDistance = d;                        // HUD-readable every frame
  if (d <= CORE_RADIUS_SECTORS && !gs.quests.coreReachedAt) {
    gs.quests.coreReachedAt = Date.now();
    events.emit('core:reached', { galaxyIndex: gs.galaxyIndex, distance: d }); // fires once, not per-frame
  }
}

export function rebirth(gs, rootSeed, galaxyForIndexFn) {
  gs.galaxyIndex = (gs.galaxyIndex + 1) % 256;
  const nextGalaxy = galaxyForIndexFn(rootSeed, gs.galaxyIndex);
  gs.currentSystemId = nextGalaxy.startingSystemId();
  gs.visitedSystems = [];
  gs.discoveries.systems = {};
  gs.quests.coreReachedAt = null;
  // ship, exosuit, multitool, inventory, and currency carry over unmodified — matches NMS precedent
  gs.save();
  return nextGalaxy;
}
```

`checkPilgrimage` runs once per warp (hooked into `_tryWarp`'s post-arrival path, `spacestate.js:379-384`), giving the HUD a live `coreDistance` readout for free. The black-hole anomaly gains an interact prompt in `SpaceLife` (`spacelife.js:194` region) that calls `jumpBlackHole` instead of only granting the one-shot survey reward it grants today — the survey reward stays (first-approach flavor), the *travel* behavior is new.

### 4.8 Waypoint route planning (multi-hop, bounded A*)

```js
// src/universe/routing.js
const WARP_RANGE_SECTORS = 3; // matches _tryWarp's existing neighborsOf(id, 3)

function heuristic(galaxy, aId, bId) {
  const a = galaxy._stubById(aId).pos, b = galaxy._stubById(bId).pos;
  return a.distanceTo(b) / WARP_RANGE_SECTORS; // admissible: never overestimates hop count
}

export function planRoute(galaxy, fromId, toId, maxHops = 24) {
  const open = [{ id: fromId, g: 0, f: heuristic(galaxy, fromId, toId), path: [fromId] }];
  const bestG = new Map([[fromId, 0]]);
  while (open.length) {
    open.sort((a, b) => a.f - b.f);            // small bubbles → array + sort is fine; swap for a heap if profiling says otherwise
    const node = open.shift();
    if (node.id === toId) return node.path;
    if (node.path.length > maxHops) continue;
    for (const nb of galaxy.neighborsOf(node.id, WARP_RANGE_SECTORS)) {
      const g = node.g + 1;                    // 1 hop == 1 Void Cell
      if (bestG.has(nb.id) && bestG.get(nb.id) <= g) continue;
      bestG.set(nb.id, g);
      open.push({ id: nb.id, g, f: g + heuristic(galaxy, nb.id, toId), path: [...node.path, nb.id] });
    }
  }
  return null; // unreachable within the hop budget
}
```

The galaxy map draws the returned path as a chain of amber links (reusing the existing `mkLines`/`LineSegments` machinery, `mapui.js:448-458`) and annotates it with hop count and Void Cell cost; `_tryWarp` accepts an optional route so the player can advance it leg-by-leg exactly as NMS does.

### 4.9 Discovery registry and region naming

`gs.discoveries` gains `systems: {}` and `planets: {}` maps keyed by address string, each entry `{ firstVisitedAt, label }` where `label` defaults to the procedural name and can be overwritten by the player through a small rename UI on the map's system dossier card. This is explicitly **local-only** in this volume — a shared upload registry needs a backend and is Volume 13's (Multiplayer & Networking) responsibility; this volume only makes the *data model* upload-ready (stable address key, timestamp, label) so Volume 13 has something to sync later without a schema migration.

```js
// src/universe/lore.js addition
const REGION_A = ['Verge', 'Hollow', 'Drift', 'Choir', 'Ember', 'Fold', 'Wound', 'Reach'];
const REGION_B = ['Span', 'Marches', 'Expanse', 'Belt', 'Approach', 'Deep'];
export function regionName(rng) {
  return `The ${rng.pick(REGION_A)} ${rng.pick(REGION_B)}`;
}
```

`regionName(new RNG(hash32(galaxySeed, rx, ry, rz, 0x4e6e)))` names the same `REGION_SECTORS`-sized cells `regionDigest` already buckets systems into (§4.6), so the naming layer and the map-overview layer share one region grid instead of inventing two. A HUD toast fires from the existing `events` bus when `floor(sx/REGION_SECTORS)` (etc.) changes between two successive positions.

### 4.10 Module/file plan

| Module | Status | Responsibility |
|---|---|---|
| `src/universe/address.js` | **new** | pack/unpack 64-bit address, bias/checksum helpers |
| `src/universe/glyphs.js` | **new** | 16-symbol alphabet, glyph string ⇄ 48-bit payload |
| `src/universe/portal.js` | **new** | `Portal` class, glyph round-trip, per-system portal placement hook |
| `src/universe/resolve.js` | **new** | `galaxyForIndex`, `resolveAddress` — the single seed→content entry point |
| `src/universe/galaxy.js` | **modify** | add `galaxyIndex` to ctor, `distanceToCenter`, `regionDigest`, `startingSystemId` unchanged |
| `src/universe/galaxyregistry.js` | **new** | `galaxySeedForIndex`, `galaxyName(index)` (256-entry lazy table) |
| `src/gameplay/hyperdrive.js` | **new** | `HYPERDRIVE_TIERS`, `canReach`, `tierRequiredFor` |
| `src/gameplay/pilgrimage.js` | **new** | `jumpBlackHole`, `checkPilgrimage`, `rebirth` |
| `src/universe/routing.js` | **new** | `planRoute` (bounded A*) |
| `src/universe/lore.js` | **modify** | add `regionName`, `galaxyName` generators |
| `src/ui/mapui.js` | **modify** | overview render mode, filter toggles, route line rendering, economy/conflict card rows, glyph input/output panel |
| `src/states/spacestate.js` | **modify** | `_tryWarp` gains the `canReach` check and optional route-leg advance |
| `src/gameplay/state.js` | **modify** | `gameState.galaxyIndex`, `.ship.hyperdriveTier`, `.coreDistance`, `.discoveries.systems/planets` |

---

## 5) Implementation phases

- **Phase 0 — Address core.** `address.js`, `glyphs.js`; property-based round-trip tests (pack/unpack, glyph encode/decode, checksum rejection). No UI, no gameplay hook — pure math, ships independently and unblocks everything else.
- **Phase 1 — Multi-galaxy registry.** `galaxyregistry.js`, `Galaxy` ctor takes `galaxyIndex`, `resolve.js`'s `galaxyForIndex` cache. Verify: two different indices produce visibly different spiral arms/star populations from the same root seed.
- **Phase 2 — Hyperdrive gating.** `hyperdrive.js`, wire into `_tryWarp`. Stub `gs.ship.hyperdriveTier` progression with a debug console setter until Volume 7's shipyard UI lands; the gate itself must work end-to-end before the purchase flow exists.
- **Phase 3 — Portal network.** `portal.js`, extend `generateSystem` to place one portal per system (same probability-roll pattern as `belt`/`station`/`anomaly`), add a glyph dial-pad UI panel (type or read 12 glyphs), wire `Portal.resolve` into a teleport action.
- **Phase 4 — Galaxy map overview + filters.** `regionDigest` in `galaxy.js`, new render path in `mapui.js`, economy/conflict/race/discovered filter toggles, drill-down from overview into the existing bubble view. Highest perf risk in this volume — budget profiling time.
- **Phase 5 — Black holes, center distance, pilgrimage/rebirth.** `pilgrimage.js`, HUD `coreDistance` readout, black-hole interact-prompt rewire, `core:reached` event + choice UI, `rebirth` save-schema change. Needs design sign-off on carry-over rules (what survives a galaxy reset) before implementation, flagged as the phase's main risk.
- **Phase 6 — Waypoint route planning.** `routing.js`, map route-line rendering, leg-by-leg `_tryWarp` integration.
- **Phase 7 — Discovery registry + region naming.** `gs.discoveries.systems/planets`, rename UI on the dossier card, `regionName`/`galaxyName` in `lore.js`, region-crossing HUD toast.

---

## 6) Effort & risk

| Phase | Engineer-weeks | Key risk | Engine-gated? |
|---|:--:|---|:--:|
| 0 — Address core | 1.0 | None (pure math) | No |
| 1 — Multi-galaxy registry | 1.0 | Memory: capping `galaxyCache` size if players hop galaxies repeatedly | No |
| 2 — Hyperdrive gating | 1.5 | Needs a stub tech field until Volume 7's UI exists; low technical risk | No |
| 3 — Portal network | 2.0 | Placing portals without colliding with existing station/anomaly placement rolls; glyph-input UX polish | No |
| 4 — Galaxy map overview | 2.5 | **Highest risk phase**: rendering/filtering at full-galaxy scale must stay frame-cheap; `regionDigest` sampling density needs tuning | No |
| 5 — Black holes / pilgrimage / rebirth | 2.0 | Design decision on rebirth carry-over rules; save-schema migration for existing saves | No |
| 6 — Waypoint routing | 1.5 | Bounded A* must degrade gracefully (return "unreachable" rather than hang) for disconnected bubbles | No |
| 7 — Discovery registry + region naming | 1.0 | None; smallest, most isolated phase | No |
| **Total** | **~11.5 wks** | | **Not engine-gated anywhere** |

Roughly **11.5 engineer-weeks** (~2.7 engineer-months for one engineer, or ~6 calendar weeks for two engineers splitting independent phases — 0/1/7 have no interdependencies and can run in parallel with 2–6). This corroborates, bottom-up, the **~2–3 engineer-month** estimate Volume 0 gave this exact gap top-down (`00-executive-summary.md`, §0.5: *"Closing it is mostly a data-model and math problem... tractable and not engine-gated, ~2–3 months"*). Every phase in the table above reads "No" in the engine-gated column — this is the report's clearest example of a large, headline-scale gap (18 quintillion planets, 256 galaxies, a whole hyperdrive-gating progression system) that is genuinely cheap relative to Volumes 2/3, precisely because the deterministic-generation foundation (`rng.js`, `galaxy.js`, `starsystem.js`) was already built correctly.

---

## 7) Acceptance criteria

All headless (Node or Playwright + SwiftShader, no manual play required):

1. **Determinism.** Two independently constructed `Galaxy` instances with the same `(seed, galaxyIndex)` return identical `starsInSector` and `getSystem` results for 1,000 randomly sampled sector/star-slot combinations.
2. **Address round-trip.** For 10,000 randomly generated field tuples, `unpackAddress(packAddress(x))` returns fields identical to `x`; `glyphsToPayload(payloadToGlyphs(p))` round-trips likewise.
3. **Checksum guard.** Mutating exactly one character of a valid 12-glyph string causes `glyphsToPayload`/`unpackPayload` to throw (not silently resolve to a different, valid-looking system) in ≥99% of single-character mutations (2-bit checksum has an expected ~25% blind-spot rate per single nibble error by design — assert the test measures and reports the true rate, not a false 100% claim).
4. **Portal round-trip.** For 200 randomly chosen generated systems with a portal, `Portal.fromGlyphs(portal.glyphs, galaxyIndex).resolve(rootSeed).system.id === originalSystem.id`, and the resolved `planetIndex` matches the portal's placement planet.
5. **Hyperdrive gating blocks.** With `gs.ship.hyperdriveTier = 'base'` and a mocked/found neighbor of `starClass === 'B'`, calling the warp path leaves `warpCells` unchanged, emits a `notify` event with `tone:'warn'`, and does not call `ctx.switchState`. Setting `hyperdriveTier = 'voidglass'` against the same target then succeeds (`switchState('space', ...)` called, `warpCells` decremented by exactly 1).
6. **Center distance decreases via black hole.** From a fixed non-core start, repeated `jumpBlackHole` calls produce a strictly non-increasing `galaxy.distanceToCenter(currentStarId)` sequence across at least 5 consecutive jumps (or terminate early only when no closer neighbor exists in range).
7. **Pilgrimage fires once.** Placing `currentStarId` at `distanceToCenter <= CORE_RADIUS_SECTORS` and calling `checkPilgrimage` on 10 consecutive frames emits exactly one `core:reached` event, not ten.
8. **Rebirth preserves inventory, resets discovery.** After `rebirth(gs, ...)`: `gs.galaxyIndex` increments mod 256; `gs.currentSystemId` equals the new galaxy's `startingSystemId()`; `gs.inventory`/`gs.ship`/`gs.lumens` are byte-for-byte unchanged; `gs.visitedSystems` and `gs.discoveries.systems` are empty.
9. **Route planning finds multi-hop paths.** For a target system 3+ bubbles away (i.e., absent from a single `neighborsOf(from, 3)` call), `planRoute` returns a path where every consecutive pair is mutually present in each other's `neighborsOf(id, WARP_RANGE_SECTORS)`, terminating at the requested target, within the configured `maxHops`.
10. **Map filters are correct set operations, not visual guesses.** Given a fixed `(seed, galaxyIndex)`, filtering the overview by `economy === 'technological'` yields a region set exactly equal to `{ r | regionDigest(r).dominantEconomy === 'technological' }` computed independently in the test — a DOM/state assertion on the filtered list, not a pixel comparison.
