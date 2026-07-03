# AllMansSky → No Man's Sky Parity Report
## Volume 0 — Executive Summary, Methodology & Parity Scorecard

**Document status:** Master framing document for the multi-volume parity report.
**Subject version:** AllMansSky `v1.0` (22,886 lines of JavaScript across 74 modules, zero external art/audio assets, browser-native WebGL2 + three.js, no build step).
**Benchmark:** No Man's Sky (Hello Games), as shipped through its full update history (Foundation → Worlds Part II and beyond): a native C++ engine with a bespoke procedural pipeline, ~18.4 quintillion planets, seamless planetary-scale rendering, voxel terrain, unbounded procedural flora/fauna, base building, multiplayer, and a decade of live content.

---

## 0.1 Why this report exists

The user's directive was unambiguous: *"this game has many, many things missing compared to no mans sky… the graphic level is not even near, the planet count, the universe size, the chunk system and the unlimited species or planet system, the round planets system, the asteroids, enemy ships, graphics, AI, anything. All the things are missing. Now I want you to write a huge huge detailed report about what we have missing, and what we need to do to make this the exact same level of no mans sky in all terms, no exception."*

That is the correct read of where we are. AllMansSky v1.0 is a **vertical-slice tribute** to No Man's Sky: it reproduces the *silhouette* of the experience — fly a ship, warp between seeded systems, dive into an atmosphere, walk a planet on foot, mine, scan life, trade, take missions, build, disembark into a walkable station — but almost every system is a **scaled-down theatrical stand-in** for the real thing rather than the real thing. It is an impressive amount of game for 22k lines of asset-free browser JavaScript. It is not within an order of magnitude of No Man's Sky on any axis that matters: engine architecture, world scale, rendering fidelity, procedural depth, or AI.

This report does two things, exhaustively, across 18 volumes:

1. **Names every gap** between AllMansSky and No Man's Sky, system by system, at the level of individual features and sub-features — not "creatures are simpler" but "no genus/species trait inheritance, no predation/feeding/taming/breeding/egg-companion loop, no air/water/underground rosters, no per-creature economy value, no discovery-upload registry."
2. **Specifies how to close each gap** — target data structures, algorithms, shader techniques, module-level file plans, phase ordering, effort estimates in engineer-weeks, and acceptance criteria for verifying parity.

It is written to be actionable by an engineering team, not to flatter the current build.

---

## 0.2 The one fact that governs everything: the engine is the gate

No Man's Sky is, at its core, **one continuous 64-bit floating-origin universe** rendered by a custom engine. A planet is a real sphere ~2–5 km in radius (gameplay-scaled) made of voxel-derived terrain, streamed as an LOD quadtree over a cube-sphere, with the camera transitioning from orbit to ground **without a single cut**. Every other headline feature — seamless space↔surface, circumnavigation, caves you can dig, planets visible in a neighbor's sky, ring shadows on the ground, asteroids you fly through, freighters warping in above you — is a *consequence* of that architecture.

AllMansSky is the opposite. It is a **state machine of disconnected theatrical scenes** (`src/main.js` → `SpaceState` ⇄ `SurfaceState`, plus `HangarState`):

- In space, a planet is a **display sphere** — a textured ball (`src/render/planetmesh.js`) you approach; you never actually land *on* the sphere.
- "Landing" is a **masked scene swap**: `src/states/spacestate.js` plays a scripted atmospheric-entry flight while a fade hides the transition to `src/states/surfacestate.js`, which is an **infinite flat heightfield** `y = f(x, z)` (`src/universe/terrainfield.js`) with a fog horizon. There is no correspondence between the planet you saw from space and the ground you walk. The planet is not round underfoot. You cannot circumnavigate. Nothing from the system (moons, other planets, rings) appears in the surface sky except decorative `src/render/skybodies.js` billboards.
- The universe is a **procedural neighbor-bubble** (`src/universe/galaxy.js`): systems are seeded on demand around you, which is genuinely NMS-like in spirit, but there is no galactic center, no 256-galaxy stack, no portal network, no star-class warp gating with teeth, and black holes/anomalies are set dressing.

**Therefore the single most important conclusion of this report, stated up front:** you cannot reach No Man's Sky parity by incrementally improving the current modules. The seamless-spherical-planet engine rebuild (Volume 2) and the voxel terrain system (Volume 3) are **gating dependencies** for a large fraction of everything else. Roughly 40% of the remaining feature gap is blocked behind that rebuild. The roadmap in Volume 17 is therefore sequenced around it: **engine first, systems second, content and live-ops third.** Attempting graphics parity (Volume 1) or fauna parity (Volume 5) on top of the flat-heightfield theater is building on sand — some of it is wasted the moment the sphere lands.

A second cross-cutting truth: **AllMansSky's "zero external assets, all-procedural, runs in a browser tab with no build step" constraint is a genuine engineering achievement and a strategic straitjacket.** No Man's Sky ships gigabytes of hand-authored art (meshes, textures, animations, audio stems) that seed and constrain its procedural generation — the "unlimited" creatures are recombinations of *authored* parts; the music is *authored* stems recombined by a generative system. Matching NMS fidelity while refusing all authored assets is not just hard, it is in several places (character animation, music, creature silhouette quality) effectively impossible at parity. Volume 16 confronts this directly and recommends where the no-asset rule must bend (a small authored art/audio pipeline, still procedurally recombined) versus where it can hold (terrain, materials, VFX, most geometry). Reaching "the exact same level, no exception" requires abandoning the purity constraint in a controlled way.

---

## 0.3 Methodology

Each domain volume follows the same seven-part template so the report reads as one system:

1. **What No Man's Sky does** — an exhaustive enumeration of the subsystem as shipped, including how it is understood to work technically (generation algorithms, data model, runtime behavior). Feature-complete, update-history-aware.
2. **What AllMansSky has today** — grounded in the actual source (every claim cites a real module/function under `src/`). No credit for things that only look right in a screenshot.
3. **The gap** — itemized, each line severity-rated **[Cosmetic] / [Feature] / [Structural] / [Engine]** and effort-tagged.
4. **Target design for parity** — concrete: data structures, algorithms, pseudocode, GLSL/JS sketches, the module/file plan under `src/`.
5. **Implementation phases** — dependency-ordered task checklists.
6. **Effort & risk** — estimates in engineer-weeks, key technical risks, and whether the item is blocked by the engine rebuild.
7. **Acceptance criteria** — how we would headless-verify that parity was actually reached (this project tests via Playwright + SwiftShader; every feature must be provable, not asserted).

**Severity legend used throughout:**

| Tag | Meaning | Typical remedy |
|---|---|---|
| **[Cosmetic]** | Looks/feels off; no new architecture | Shader/material/tuning work |
| **[Feature]** | A whole mechanic is absent but fits current architecture | New module + UI + tests |
| **[Structural]** | Needs new data models / cross-system plumbing | Multi-module refactor |
| **[Engine]** | Blocked behind the spherical/voxel/floating-origin rebuild | Engine work first |

---

## 0.4 The Parity Scorecard

Each domain scored **0–10** against "the exact same level as No Man's Sky." 0 = absent; 5 = a recognizable stand-in with the core loop but far below fidelity/scale; 8 = feature-complete but below AAA polish; 10 = at parity. These scores are deliberately harsh — the brief is parity, not "a good browser game."

| # | Domain | Score | One-line gap | Gated by engine? |
|---|---|:--:|---|:--:|
| 1 | **Graphics & Rendering** | **2 / 10** | Stylized low-poly + basic bloom/ACES; no PBR pipeline, GI, TAA, volumetric clouds/atmosphere, water reflections, temporal upscaling, foliage density, or planetary-scale rendering | Partly |
| 2 | **Spherical Planets & Seamless Transition** | **1 / 10** | Display sphere in space + infinite flat heightfield on surface, joined by a masked fade; no round planets, no circumnavigation, no continuity | **Engine** |
| 3 | **Voxel Terrain & Manipulation** | **1 / 10** | Heightfield `y=f(x,z)`; a shallow "dig" crater layer only; no caves, overhangs, arches, or true terrain edit | **Engine** |
| 4 | **Universe Scale, Galaxy & Meta** | **3 / 10** | Deterministic neighbor-bubble of systems; no 18-quintillion addressable space, no 256 galaxies, no portals/glyphs, no core pilgrimage, star-gating is soft | Partly |
| 5 | **Flora, Fauna & Unlimited Life** | **2 / 10** | ~6 creature body plans, wander/flee AI, one-shot scan; no genus/species inheritance, ecology, predation, feeding, taming, riding, breeding, companions, or discovery registry | Partly |
| 6 | **Space Flight, Combat & Enemy AI** | **2 / 10** | Arcade flight + one Warden escalation + one pirate pattern; no dogfighting AI, pirate/Sentinel interceptor waves, freighter/capital battles, asteroid fields, or wingmen | No |
| 7 | **Ships, Multitools, Exocraft, Exosuit** | **3 / 10** | Fixed ship, class upgrades, one rover; no ship classes/archetypes/acquisition, no slot-grid + adjacency + supercharged tech, no multitool variety, no exocraft roster/submarine/mech, thin exosuit | Partly |
| 8 | **Base Building & Settlements** | **3 / 10** | Snap-place props + power-ish machines; no full part catalog, wiring/logic, freighter bases, settlements, NPC workers, or deep persistence | Partly |
| 9 | **Economy, Crafting, Refining, Progression** | **3 / 10** | 6 economy types + routes + refiner; one currency, flat recipes, no nanites/quicksilver, no cooking, no crafting tree depth, no galactic market | No |
| 10 | **NPCs, Factions, Language, Story & AI** | **3 / 10** | Walkable stations + wandering crew + language gloss + 3-faction rep + mission board + 6-beat story; no branching dialogue, no 5 authored races, no Atlas/Artemis-scale arc, thin AI | Partly |
| 11 | **Weather, Hazards, Survival & Modes** | **3 / 10** | Hazard/oxygen drain + storms + biome hazards; no full survival resource web, temperature model, extreme sentinel storms, or the game-mode matrix (creative/survival/permadeath/custom) | No |
| 12 | **Audio & Generative Music** | **3 / 10** | WebAudio synth SFX + generative pad score; no authored-stem generative system, no creature vocal synthesis depth, thin spatialization/mix | No |
| 13 | **Multiplayer & Networking** | **0 / 10** | Single-player only; no co-op, Nexus, discovery sync, anomaly hub, or servers | No |
| 14 | **UI/UX, Photo Mode & Accessibility** | **4 / 10** | Clean HUD, galaxy map, free-fly photo mode; no discovery/catalog UX depth, quick-menu, or accessibility matrix | No |
| 15 | **Expeditions, Live Content & Endgame** | **1 / 10** | Milestone-ish quest chain; no seasonal expeditions, community events, rewards economy, or endgame loops | No |
| 16 | **Content Pipeline, Determinism & Asset Budget** | **3 / 10** | Excellent deterministic RNG/noise core; but "no external assets" caps achievable fidelity vs NMS's authored-part pipeline | Cross-cutting |

**Unweighted mean: ~2.3 / 10.** Weighted toward the user's stated priority (graphics) and the headline gaps (round planets, scale, unlimited life, AI, enemy ships), the honest composite is **"early, ambitious prototype at roughly 15–20% of No Man's Sky's realized scope, and a much smaller fraction of its fidelity."**

This is not a criticism of the work done — it is the measure of how large No Man's Sky actually is. NMS represents on the order of **hundreds of engineer-years** across a decade. The remainder of this report estimates what closing the gap costs.

---

## 0.5 The five headline gaps the user named, in one paragraph each

**"The round planets system."** *(Volume 2, [Engine], the master dependency.)* This is the flagship. NMS planets are real streamed spheres with a floating origin; ours is a display ball plus a flat infinite plane. Fixing it is a from-scratch planetary engine: cube-sphere LOD quadtree, 64-bit/floating-origin camera math, chunk streaming, and a rewrite of how space and surface states relate (they must merge into one continuum). Everything about horizons, circumnavigation, "planets in the sky," ring shadows, and seamless orbit-to-ground depends on this. Estimated **9–15 engineer-months** for a solid version.

**"The chunk system … unlimited species or planet system."** *(Volumes 2, 3, 5, 16.)* NMS streams terrain and props in chunks around a floating origin and assembles "unlimited" creatures/plants/ships/buildings from authored parts under seed control. We have neither chunk streaming nor a part-library generator; our "procedural" content is small hand-tuned families. Reaching "unlimited" means (a) a chunk streamer over the sphere and (b) a **procedural part-assembly pipeline** with a real (small, authored) part library — the point where the zero-asset rule must bend.

**"Universe size / planet count."** *(Volume 4.)* NMS is a 64-bit addressable space of ~18.4×10¹⁸ planets across 256 galaxies with portal coordinates. Ours is an unbounded-in-principle but shallow neighbor bubble with no addressing scheme, no galaxy stack, no portals. Closing it is mostly a *data-model and math* problem (a 64-bit coordinate/seed scheme, galaxy map at scale, portal glyph addressing) — tractable and **not** engine-gated, ~2–3 months.

**"Asteroids, enemy ships, AI."** *(Volume 6.)* NMS space is alive: asteroid fields you mine and weave through, pirate waves, Sentinel interceptors, freighter/capital fleets with escorts, dogfighting AI, wingmen, distress calls. We have a single Warden escalation and one pirate pattern with rudimentary steering. This is **not** engine-gated and is one of the highest experience-per-effort wins available: a proper flocking/steering AI, asteroid instancing, and encounter director, ~2–4 months.

**"Graphics — the graphic level is not even near."** *(Volume 1, the user's #1 priority.)* NMS uses a full PBR deferred/clustered pipeline: physically based materials, screen-space and baked GI, TAA + temporal upscaling, volumetric atmosphere and clouds, planetary aerial perspective, water with reflection/refraction/caustics, dense instanced foliage, rich particle/weather VFX, and a graded HDR post chain. We have flat-shaded/low-poly geometry, canvas-generated textures, one bloom pass, ACES tonemap, and simple fog. Much of graphics parity can proceed in parallel with the engine rebuild, but the highest-value items (aerial perspective, terrain materials, foliage density, clouds) only fully pay off once terrain is spherical/voxel. The browser/WebGL2 ceiling is also real — Volume 1 discusses a WebGPU migration as the realistic path to AAA fidelity.

---

## 0.6 How to read this report

- **Read Volume 17 (Roadmap) second, right after this summary** — it sequences all the work, resolves cross-volume dependencies, and gives the phased plan, team model, and honest feasibility verdict. The domain volumes are the detailed backing for it.
- Volumes are independent deep-dives; each is self-contained and can be handed to a feature team.
- Every "current state" claim is traceable to `src/`. Where a volume says something is missing, it means *missing in code*, not merely rough.
- Effort numbers are **engineer-weeks/months for a competent gameplay/graphics engineer**, exclusive of art/audio authoring (called out separately in Volume 16). They are planning-grade, not quotes.

---

## 0.7 Volume index

| Vol | Title | Primary source modules examined |
|---|---|---|
| 0 | Executive Summary, Methodology & Parity Scorecard *(this doc)* | — |
| 1 | Graphics & Rendering | `core/engine.js`, `render/*` |
| 2 | Spherical Planets & Seamless Space↔Surface | `render/planetmesh.js`, `universe/terrainfield.js`, `states/*` |
| 3 | Voxel Terrain & Manipulation | `universe/terrainfield.js`, `render/terrain.js`, `gameplay/mining.js` |
| 4 | Universe Scale, Galaxy & Meta-progression | `universe/galaxy.js`, `universe/starsystem.js`, `ui/mapui.js` |
| 5 | Flora, Fauna & Unlimited Procedural Life | `gameplay/creatures.js`, `render/creature.js`, `render/flora.js`, `gameplay/scanner.js` |
| 6 | Space Flight, Combat & Enemy AI | `gameplay/shipcontrol.js`, `gameplay/combat.js`, `gameplay/spacelife.js` |
| 7 | Ships, Multitools, Exocraft & Exosuit | `render/shipmesh.js`, `gameplay/shipmarket.js`, `gameplay/rover.js`, `gameplay/state.js` |
| 8 | Base Building & Settlements | `gameplay/basebuilding.js`, `ui/buildui.js`, `gameplay/machines.js` |
| 9 | Economy, Crafting, Refining & Progression | `gameplay/trading.js`, `gameplay/items.js`, `ui/refinerui.js`, `gameplay/mining.js` |
| 10 | NPCs, Factions, Language, Story & AI | `gameplay/npcs.js`, `gameplay/language.js`, `gameplay/quests.js`, `universe/lore.js` |
| 11 | Weather, Hazards, Survival & Game Modes | `gameplay/survival.js`, `render/weather.js`, `universe/biomes.js` |
| 12 | Audio & Generative Music | `audio/audio.js`, `audio/music.js` |
| 13 | Multiplayer & Networking | `server.mjs`, `core/events.js`, `gameplay/state.js` |
| 14 | UI/UX, Photo Mode & Accessibility | `ui/*`, `main.js` |
| 15 | Expeditions, Live Content & Endgame | `gameplay/quests.js`, `gameplay/state.js` |
| 16 | Content Pipeline, Determinism & Asset Budget | `core/rng.js`, `core/noise.js`, cross-cutting |
| 17 | Engineering Roadmap, Phasing, Effort & Verdict | synthesis of all volumes |

---

*Continue to [Volume 17 — Roadmap](./17-roadmap.md) for the sequenced plan, or read the domain volumes in order.*
