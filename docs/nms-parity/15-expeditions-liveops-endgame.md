# Volume 15 — Expeditions, Live Content & Endgame

**Volume status:** Domain deep-dive, part of the 18-volume AllMansSky → No Man's Sky parity report. See Volume 0 for methodology, the severity legend, and the cross-volume scorecard (this domain scores **1/10** — "milestone-ish quest chain; no seasonal expeditions, community events, rewards economy, or endgame loops").
**Primary sources read (cited throughout):** `src/gameplay/quests.js` (373 lines — VESPER_BEATS, CONTRACT_TEMPLATES, BOARD_TEMPLATES, `repTier`, `QuestSystem`), `src/gameplay/state.js` (185 lines — `GameState`, 3-slot localStorage persistence), `src/universe/galaxy.js` (180 lines — `Galaxy`, `startingSystemId()`).
**Secondary sources:** `src/ui/missionboard.js`, `src/ui/questui.js`, `src/universe/lore.js` (`FACTIONS`), `src/gameplay/items.js` (currency/economy — single currency, "lumens"), `src/gameplay/shipmarket.js` (C→B→A→S ship-grade rolls — directly relevant to the S-class endgame loop), `server.mjs` (100-line static file server; confirms zero backend/networking logic exists), `test/mission-check.mjs` (the headless Playwright pattern this volume's acceptance criteria follow).
**Cross-references used below:** Vol 6 (Space Flight, Combat & Enemy AI), Vol 7 (Ships, Multitools, Exocraft & Exosuit), Vol 8 (Base Building & Settlements), Vol 9 (Economy, Crafting, Refining & Progression), Vol 10 (NPCs, Factions, Language, Story & AI), Vol 11 (Weather, Hazards, Survival & Game Modes), Vol 13 (Multiplayer & Networking).

---

## 15.1 What No Man's Sky does

No Man's Sky's post-launch identity is built almost entirely on **live content cadence**, not the base 2016 game. This section enumerates the machinery, exhaustively, as a checklist for what "live content and endgame" means at AAA-live-service scale.

### 15.1.1 Expeditions

Introduced with **Beyond**-era infrastructure and formalized in **Expeditions** (2021) as a first-class mode alongside Normal/Survival/Permadeath/Creative:

- **Shared fixed-seed starts.** Every player who launches a given Expedition spawns in the *same* starting system, on the *same* starting planet, with the *same* starting ship/multitool/inventory (frequently a deliberately stripped-down loadout — no ship, minimal resources — to reset the power curve). The galaxy seed and starting coordinates are baked into the Expedition definition, not derived from the player's normal save.
- **Multi-phase milestone journeys.** Each Expedition (Pioneers, Beachhead, Cartographers, Emergence, Exobiology, Blighted, Polestar, Voyagers, Leviathan, Utopia, The Cursed, Singularity, Liquidators, Cataclysm, Cursed II, Cascade, Cinder, Cursed III, Adrift, Distant Worlds, ...) is a chain of ~10-13 **phases**, each with 1-4 **milestones** (reach a system, build a specific base part, refine N of an element, kill a Sentinel, scan 10 species, fly through 5 rings, survive a storm). Phases gate sequentially — later phases are hidden or greyed until earlier ones complete.
- **Exclusive rewards.** Every phase and the finale grant unique, expedition-locked cosmetics: ship skins/frames, multitool skins, exosuit skins, jetpack trails, base-building decoration parts, a companion (a creature egg/pet exclusive to that expedition), and sometimes a whole distinct ship or multitool archetype (e.g. the Void Egg living ship, the Utopia Speeder). These items **cannot** be obtained any other way once the expedition's live window closes, except via re-runs (below).
- **Redemption into main saves.** On completing (or partially completing) an Expedition, the player collects a "Rewards" item at the finale that, when opened back in a normal save, unlocks every reward they earned account-wide, across all normal/survival/permadeath saves on that platform account. This is the core mechanic this volume must reproduce: **progress happens in an isolated save context; rewards persist independently of any single save slot.**
- **Rendezvous points.** Certain milestones require multiple players to be present in the same instanced system simultaneously (a "gathering" beacon), turning a nominally single-player game into a soft-multiplayer event for that window.
- **Leaderboards / community goals.** Some expeditions (Leviathan, Utopia) track a live *aggregate* community metric (total distance travelled, total Sentinels destroyed, total bases built) with tiered community rewards unlocked as thresholds are crossed — server-side aggregation across all players, visible in a live UI panel.
- **Expedition re-runs.** Past expeditions are periodically reopened (with adjusted seeds/milestones) so players who missed the live window can still earn (most of) the rewards, usually at an accelerated pace.

### 15.1.2 Community Research / Quicksilver / the Nexus

- **The Nexus** is a hub area at the Space Anomaly (a portable station) offering **daily and weekly missions** — short, scripted objective sets ("scan 3 creatures," "extract records from a Sentinel Pillar," "kill 2 pirates") refreshed on a real-world timer.
- Completing Nexus missions pays **Quicksilver**, a dedicated currency (distinct from Units/credits and Nanites) that exists *only* to buy cosmetics.
- The **Quicksilver Synthesis Companions vendor** (an NPC at the Anomaly) sells rotating cosmetic goods — ship skins, multitool skins, exosuit customization, emotes, poses, banners, decorations — for Quicksilver, on its own rotation independent of expeditions.
- **Community Research** (introduced 2020) is a separate periodic event layer: community-wide contribution goals (e.g. "the community must scan N creatures collectively") that unlock a free reward for everyone when hit, run in short 1-2 week windows several times a year.

### 15.1.3 Twitch Drops

Hello Games periodically partners with Twitch streamers; watching qualifying streams for a set duration grants linked accounts a Twitch Drop — almost always a cosmetic (ship skin, pet, base part) redeemable via the in-game "Options → Redeem" or automatically on next login. This is a marketing/community-engagement channel layered on top of the reward-grant plumbing described above — it proves the reward system is decoupled from "did you play the mission," since a drop can be granted from an external event entirely.

### 15.1.4 The anniversary/update cadence

No Man's Sky has shipped **free, dated major updates continuously since 2016** — no paid DLC, ever. Roughly (non-exhaustive, illustrative of cadence and scope):

| Era | Representative updates | What they added |
|---|---|---|
| 2016-2017 | Foundation, Pathfinder, Atlas Rises | Base building, vehicles, story overhaul |
| 2018 | NEXT | Multiplayer, third-person, freighters, fleet command |
| 2019 | Abyss, Visions, Beyond | Underwater biomes, VR, social hub (the Anomaly) |
| 2020 | Synthesis, Living Ship, Exo Mech, Crossplay, Desolation, Origins | Derelict freighters, living ships, mechs, cross-platform play, procedural planet overhaul |
| 2021 | Next Generation, Companions, Emergence, Prisms, Frontiers | Next-gen console ports, pet taming, settlements, expeditions v1 |
| 2022 | Sentinel, Outlaws, Leviathan, Endurance, Waypoint | Sentinel AI overhaul, freighter frigate/fleet depth |
| 2023 | Fractal, Interceptor, Singularity, Echoes | Autophage race/questline, cross-save |
| 2024 | Orbital, Omega, Adrift, Worlds Part I | Capital ship customization, cross-saga missions |
| 2025 | Worlds Part II and beyond | Continued planetary-tech and rendering overhauls |

Each is a **whole free content system**, not a patch — this cadence, sustained for a decade, *is* the reason NMS is considered a live-service benchmark despite being a single-player-first game. The mechanism that makes this possible: a stable core loop + a data-driven mission/reward layer that new content plugs into without re-architecting the base game.

### 15.1.5 Endgame loops

Once the ~15-20 hour main story (Artemis/Atlas Path) is done, NMS's actual longevity comes from a set of **parallel, replayable endgame loops**:

- **S-class hunting & re-rolling.** Ships, multitools, and freighters roll a grade (C/B/A/S) and a randomized supercharged-slot layout on acquisition. "Save-scumming" a system's ship/multitool dealer (reload, re-roll, repeat) to land an S-class with favorable supercharged slot placement is one of the single most-played endgame loops.
- **Base megaprojects.** No hard size cap on base part count (soft frame-rate limits); community-famous builds run into the tens of thousands of parts. This is a pure sandbox/creative endgame loop with no completion state.
- **Capital-freighter fleets & frigate expeditions.** Own a freighter, recruit up to 6 (now more) frigates by class (combat/trade/exploration/support), send them on timed **frigate expeditions** (fire-and-forget missions with a success-probability roll influenced by frigate stats), manage fleet composition, and fight **capital-ship battles** (pirate dreadnought raids on your freighter).
- **Derelict freighter dungeons.** A distress-signal-triggered, fully proc-genned combat/puzzle dungeon aboard a drifting derelict freighter: sealed doors requiring puzzle terminals, biological horror enemies, escalating hazard, and loot (freighter blueprint upgrades) at the end. High risk/reward, repeatable, distinct seed per instance.
- **The Living Ship questline & Starbirth.** A dedicated storyline (grow an egg through a farming/interaction loop into a living ship) that ends with **Starbirth** — a unique ship-acquisition path parallel to buying one at a dealer.
- **Exocraft racing.** Community/procedural race tracks for the Nomad, Roamer, Pilgrim, Colossus, and (via mods/community events) informal leaderboard racing; official "Rocket Boost Test" style trial content exists as a warm-up minigame.
- **Fishing (Aquarius, 2024).** A dedicated fishing minigame with rods, bait, a catch/reel-tension loop, a fish-species catalog per planet/biome (freshwater vs. ocean vs. exotic), tournament-style leaderboards, and cosmetic/trophy rewards.
- **Settlements management.** Claim a settlement, assign a manager NPC, choose weekly policy decisions from a small dialogue tree, manage population happiness/production, and defend against raids — an idle/light-sim loop layered on the base-building system.
- **The Autophage, Sentinel, and Staff questlines.** Three distinct late-game story arcs (each with its own NPC, mechanic, and reward chain): the Autophage (memory-fragment story, unique ship), the Sentinel line (Sentinel-tech questline unlocking Sentinel-themed gear), and the Space Station "Staff" quests (recurring station NPC errands).
- **The Atlas Path ending → galaxy rebirth / NG+.** Completing the Atlas storyline triggers a **galaxy reset**: a new seed, a "you are reborn" narrative beat, most inventory/ship/base progress optionally carried forward (soft NG+), and access to a new galaxy in the 256-galaxy stack. Repeatable — the endgame's "prestige" loop.
- **Collection/completion metagames.** Zoology 100%-scan completion per planet (with an in-HUD counter and reward), the Discoveries app tracking every system/planet/species/mineral you've named, and Guild rank progression (a numeric "Explorer/Trader/Fighter" rank track with milestone rewards) all give long-tail "collect them all" goals independent of any single story or expedition.

---

## 15.2 What we have

AllMansSky's closest analog to any of this is `src/gameplay/quests.js`, which implements two unrelated systems under one file:

**1. The Vesper Signal main chain — a *linear, non-shared* milestone journey.** `VESPER_BEATS` (lines 14-21) is a hardcoded array of 6 beats keyed by `warpDepth` (1, 3, 5, 8, 12, 16). `QuestSystem._checkBeats()` (lines 343-356) fires one beat per warp, in order, granting a fixed lumens/item reward and a lore modal via `events.emit('lore:show', ...)`. `QuestSystem._retarget()` (lines 358-368) recomputes `gs.quests.vesperTarget` after every warp — the "furthest unvisited neighbor" heuristic — so the chain always points somewhere new, but it is **per-save, not shared**: two players (or two save slots) starting the same `galaxySeed` will *not* get the same Vesper path, because `_retarget()` depends on `this.gs.currentSystemId` and `this.gs.visitedSystems`, both live playthrough state, not a fixed expedition seed.

**2. Procedural side contracts and faction board missions — a Nexus-shaped hole, not a Nexus.** `CONTRACT_TEMPLATES` (5 kinds: prospect/cartograph/pilgrimage/purge/bounty, lines 24-83) auto-refill up to `MAX_ACTIVE = 3` via `QuestSystem._refill()` (lines 323-341), seeded by `hash32(hashString(currentSystemId), completed.length, active.length)` — deterministic per save state, not per real-world day. `BOARD_TEMPLATES` (7 kinds, adds courier/survey, lines 107-142) populate a per-system mission board via `boardMissionsFor(system, gs, galaxy)` (lines 145-168), capped at `MAX_BOARD = 3` (`acceptBoard`, lines 264-273). Rewards are `lumens` (the single in-game currency; see `src/gameplay/items.js`, no Quicksilver/Nanites-equivalent second currency exists) plus item stacks, and board missions additionally pay **reputation** toward one of three tradeable factions (`meridian`/`chorale`/`sunward` — `FACTIONS` in `src/universe/lore.js`; the fourth faction, `ashen`, are raiders with no rep track). `repTier()` (lines 89-104) maps standing to 5 named tiers (DRIFTER → LUMINARY) that unlock a trade discount (0-12%) — this is the *only* persistent unlockable-by-play system in the codebase, and it is a discount, not a cosmetic.

**3. What is structurally absent, confirmed by search — not merely thin:**
- No file or symbol anywhere under `src/` matches `expedition`, `quicksilver`, `nexus`, or `anomaly` (grepped; zero hits).
- `src/gameplay/state.js` has exactly one currency field (`this.lumens`, line 27) and no cosmetics/unlockables data structure — no `unlockedSkins`, no `cosmetics`, no `flags`.
- Persistence (`GameState.save()`/`.load()`, lines 108-179) is **slot-scoped only**: `localStorage.setItem(SLOT_KEY(this.slot), JSON.stringify(this))` serializes the *entire* `GameState` instance into one of 3 keys (`SAVE_SLOTS = 3`, line 9). There is no account-wide/cross-slot storage key at all — nothing analogous to NMS's "Rewards" item that unlocks account-wide regardless of which save opened it.
- `src/universe/galaxy.js` *does* give us a genuinely reusable primitive: `Galaxy.startingSystemId()` (lines 154-179) performs a deterministic outward shell-search from a fixed `START_ANCHOR` sector for the first G/K star with a lush planet, memoized on `this._startId`. **Same `seed` (constructor arg, default `GALAXY_SEED_DEFAULT = 1337`) always produces the same starting system** — this is precisely the "shared fixed-seed start" primitive NMS expeditions need, already present and correct, just never used for anything but the player's own new-game start.
- `src/gameplay/shipmarket.js` independently rolls ship **grade** C/B/A/S (`GRADES`, line 47; `rollGrade()`, lines 76-85, weighted 1.2%→5.5% S-class by station tier) — a real primitive for the "S-class hunting" endgame loop, but it is a shop-browsing roll with no re-roll ritual, no supercharged-slot concept, and (Vol 7 territory) no player-triggered "reset and try again" loop.
- `server.mjs` (100 lines) is confirmed to be a **static file server only** — gzip, MIME types, cache headers. Zero routes, zero database, zero session state. Every NMS mechanic that requires a server (rendezvous points, community goals, leaderboards, cross-account Quicksilver-vendor rotation) has **no backend to attach to** today; this is Volume 13's gap, inherited here.
- No derelict-dungeon system, no living-ship questline, no exocraft racing mode, no fishing/water volume (Vol 11 territory), no settlements (Vol 8 territory — `gs.bases` exists but has no manager NPC, no policy loop, no raids), no Autophage/Sentinel/Staff-analog questlines beyond the single Vesper chain, and no "ending" state at all — `vesperDepth` simply keeps incrementing forever past the last beat (depth 16) with no terminal event, no galaxy reset, no NG+.

---

## 15.3 The gap

| # | NMS feature | AllMansSky today | Severity | Effort | Cross-ref |
|---|---|---|---|:--:|---|
| 1 | Expedition mode w/ shared fixed-seed start | `Galaxy.startingSystemId()` is deterministic per seed but never decoupled from the player's own save seed; no expedition mode exists | [Structural] | 3-4 wk | — |
| 2 | Multi-phase milestone-journey definitions (data-driven) | `VESPER_BEATS` is a single hardcoded linear array, not phases/milestones, not reusable for new content | [Structural] | 2-3 wk | Vol 10 (story tooling) |
| 3 | Exclusive cosmetic/companion/ship/base-part rewards | No cosmetics system anywhere; rewards are lumens + stackable items only | [Structural] | 4-6 wk | Vol 7 (ship skins), Vol 8 (base parts), Vol 5 (companions) |
| 4 | Cross-save reward redemption ("Rewards" item → account-wide unlock) | `GameState.save()` writes one slot only; zero account-wide storage key exists | [Structural] | 1-2 wk | — |
| 5 | Rendezvous points (co-present players) | No multiplayer; `server.mjs` has zero session/presence routes | [Engine]/[Structural] | Blocked | Vol 13 |
| 6 | Leaderboards / community goals with server aggregation | No backend at all | [Structural] | Blocked (server) + 1 wk (client) | Vol 13 |
| 7 | Expedition re-runs | N/A — no expeditions exist yet | [Feature] | 0.5 wk (once #1 exists) | — |
| 8 | Nexus daily/weekly missions on a real-world timer | `_refill()` is savestate-seeded, not date-seeded; no daily/weekly cadence anywhere | [Feature] | 1-2 wk | — |
| 9 | Quicksilver (dedicated cosmetics currency) | Single currency (`lumens`) doubles as trade money and quest reward; no cosmetic-only currency | [Structural] | 0.5 wk (data model) | Vol 9 |
| 10 | Cosmetics vendor at a social hub (Anomaly) | No social hub exists; no cosmetics catalog to sell | [Structural] | 2-3 wk | Vol 10 (hub location), Vol 13 (if multiplayer hub) |
| 11 | Twitch Drops / external reward injection | No external-reward ingestion path; reward grant is 100% in-process (`gs.addLumens`/`gs.addItem`) | [Feature] | 1 wk (once vault exists) | Vol 13 (auth) |
| 12 | Anniversary/major-update cadence (whole new systems, dated, free) | Single `version = 1` save schema; no content-pack versioning, no update-drop tooling | [Structural] | 1-2 wk tooling + ongoing | Vol 17 (roadmap) |
| 13 | S-class ship/tool hunting & deliberate re-roll loop | `shipmarket.js` rolls C/B/A/S grade already (station-tier weighted); no re-roll ritual, no supercharged slots, no multitool equivalent | [Feature] | 1-2 wk | Vol 7 |
| 14 | Base megaprojects (soft-unbounded part counts, community showcase) | `gs.bases` exists (Vol 8) but has no part-count telemetry, no showcase/sharing hook | [Feature] | 0.5 wk (this volume's slice) | Vol 8 |
| 15 | Capital-freighter fleets & frigate expeditions/missions | No freighter entity, no frigate roster, no fire-and-forget mission-with-probability-roll system | [Structural] | 3-4 wk | Vol 6, Vol 7 |
| 16 | Derelict freighter dungeons | No derelict/POI dungeon generator; no puzzle-terminal/sealed-door primitive | [Structural] | 4-6 wk | Vol 2/3 (interior geometry), Vol 6 (combat encounters) |
| 17 | Living Ship questline & Starbirth | No living-ship entity type, no egg-growth loop | [Structural] | 3-5 wk | Vol 7, Vol 10 |
| 18 | Exocraft racing (tracks, timing, leaderboards) | `gameplay/rover.js` gives one exocraft with no track/timer/leaderboard system | [Feature] | 1-2 wk (local) + Vol 13 for leaderboards | Vol 7, Vol 13 |
| 19 | Fishing (Aquarius): rods, bait, catch loop, species catalog, tournaments | No water volume/body-of-water simulation; no fishing verbs at all | [Structural] | Blocked on Vol 11 water | Vol 11 |
| 20 | Settlements management (manager NPC, policy loop, raids) | No settlement entity; `gs.bases` has no NPC-manager or weekly-decision loop | [Structural] | 3-4 wk | Vol 8, Vol 10 |
| 21 | Autophage / Sentinel / Staff questlines | Only one story chain (Vesper); no secondary questline framework to plug new arcs into | [Feature] | 2-3 wk per arc (once framework exists) | Vol 10 |
| 22 | Atlas Path ending → galaxy rebirth / NG+ | `vesperDepth` has no terminal state; beats stop firing after depth 16 with no ending event | [Structural] | 1-2 wk | Vol 4 (galaxy seed rotation), Vol 10 |
| 23 | Collection/completion metagames (zoology 100%, discovery milestones, guild rank) | `gs.discoveries` records raw entries (Vol 5/4 territory) but no completion-percentage UI, no milestone-reward ladder, no guild-rank track | [Feature] | 1-2 wk | Vol 5, Vol 4 |
| 24 | Reputation/standing as the *only* persistent unlockable | `repTier()` exists and works (5 tiers, discount only) — closest thing to a "guild rank" today | [Cosmetic]-adjacent (works, just shallow) | 0.5 wk to extend into cosmetic unlocks | — |

**Reading the table:** almost nothing here is [Engine]-blocked — this is the one domain in the whole report where AllMansSky's flat/display-sphere architecture (Vol 2/3) is *not* the gating dependency. The real blockers are (a) **no backend** (`server.mjs` is static-only — Vol 13), (b) **no cosmetics data model** (nothing to reward with), and (c) several endgame loops depend on entities that other volumes haven't built yet (freighters, water, living ships, settlements-with-NPCs). This volume's job is therefore to build the **framework** — expedition definitions, cross-save reward grants, a repeatable-mission generator, a content-pack structure — that can absorb those entities as the other volumes deliver them, rather than to hand-build every endgame loop's simulation from scratch here.

---

## 15.4 Target design

### 15.4.1 Design pillars

1. **Data-driven, not hardcoded.** `VESPER_BEATS`-style arrays don't scale to a live-content cadence. Expeditions, phases, milestones, and Nexus mission templates must be plain-data modules loadable/swappable without touching `QuestSystem`-equivalent engine code.
2. **Reward grants are cross-save from day one.** The account-wide "vault" is cheap to build now (it's `localStorage`, no server needed) and every later feature (Twitch Drops, community goals) plugs into the same grant function.
3. **Determinism is already solved — reuse it.** `hash32`/`hashString`/`RNG` (`src/core/rng.js`) and `Galaxy.startingSystemId()`'s shell-search pattern are the exact primitives NMS's "same seed → same start" guarantee needs. No new randomness infrastructure required.
4. **Networked features (rendezvous, live leaderboards) are stubbed local-first**, with an explicit seam for Volume 13 to swap in a real backend later, so this volume's work is not wasted while waiting on the server.

### 15.4.2 Expedition definition schema

```js
// data/expeditions/def-schema.md (documented shape; actual defs are .js modules
// exporting one object each, e.g. data/expeditions/2026-01-firstlight.js)
ExpeditionDef = {
  id: string,                 // stable slug, e.g. 'exp-firstlight'
  version: 1,
  title: string,
  season: string,             // '2026.1' — content-pack tag, see 15.4.9
  window: { startsAt: ISODate|null, endsAt: ISODate|null }, // null,null = evergreen re-run
  seed: {
    galaxySeed: number,       // hash32(hashString(id), hashString(season), 0xe5ed)
    startSystemOverride: string|null, // rarely set; else Galaxy(seed).startingSystemId()
  },
  loadout: {                  // applied instead of GameState defaults on start()
    strip: boolean,           // true = zero out normal upgrades/inventory
    lumens: number,
    inventory: [[itemId, qty], ...],
    ship: { class: string, hullMax: number, shieldMax: number, fuel: number },
  },
  phases: [
    {
      id: string,             // 'p1'
      title: string,
      milestones: [
        { id: string, kind: 'event', event: string, filterId?: string,
          filterKind?: string, need: number, desc: string },
      ],
      reward: {
        flags: [string, ...],   // vault flag ids, e.g. 'exp-firstlight:ship-skin-nova'
        items: [[itemId, qty], ...],
        lumens: number,
        prisms: number,          // see 15.4.6
      },
    },
    // ... 8-12 phases typical
  ],
  communityGoal: {              // optional; see 15.4.7
    id: string, metric: string, target: number,
    reward: { flags: [string, ...] },
  } | null,
};
```

This is a direct structural analog to `VESPER_BEATS` + `CONTRACT_TEMPLATES`' `event`/`filterId`/`need` shape (quests.js lines 33-34, 45, 55, 66, 78) — milestones reuse the *exact same event-driven progress model* already proven by `QuestSystem._progress()` (quests.js lines 227-244). No new event-matching engine is needed, only a phase wrapper around it.

### 15.4.3 Fixed-seed shared start

```js
// src/gameplay/expeditions.js
import { hash32, hashString } from '../core/rng.js';
import { Galaxy } from '../universe/galaxy.js';

export function expeditionGalaxySeed(def) {
  return hash32(hashString(def.id), hashString(def.season), 0xe5ed);
}

/** Builds the frozen starting context for an expedition run. Same def ⇒
 *  same galaxy ⇒ same starting system, every time, for every player —
 *  reusing Galaxy.startingSystemId()'s deterministic shell-search verbatim. */
export function expeditionStart(def) {
  const seed = def.seed?.galaxySeed ?? expeditionGalaxySeed(def);
  const galaxy = new Galaxy(seed);
  const startId = def.seed?.startSystemOverride ?? galaxy.startingSystemId();
  return { galaxy, startId, seed };
}
```

`galaxy.startingSystemId()` (`src/universe/galaxy.js:154-179`) already guarantees "same `seed` argument ⇒ same returned starId" — that is its entire contract today for new-game starts. `expeditionGalaxySeed()` merely derives a *different* seed namespace (hashing `id` + `season` instead of taking the player's `galaxySeed`), so an expedition's start is reproducible independent of, and isolated from, the player's own save.

### 15.4.4 ExpeditionSystem (mirrors the `QuestSystem` contract)

```js
// src/gameplay/expeditions.js (cont.)
import { events } from '../core/events.js';
import { grantVaultFlag, applyVaultUnlocks } from './rewardvault.js';

export class ExpeditionSystem {
  constructor(gs, galaxy) { this.gs = gs; this.galaxy = galaxy; this._offs = []; this._def = null; }

  init() {
    this.gs.expeditions ??= { activeId: null, phaseIndex: 0, milestoneProgress: {}, completedPhases: [] };
    this._offs.push(events.on('warp:end', () => this._progress('warp:end', () => 1)));
    this._offs.push(events.on('resource:mined', (p) => this._progress('resource:mined', p)));
    this._offs.push(events.on('discovery:new', (p) => this._progress('discovery:new', p)));
    // ... same event surface QuestSystem already listens to (quests.js:190-211)
  }

  /** Starts a fresh, isolated expedition run: NOT the player's main save slot. */
  start(def) {
    this._def = def;
    const { galaxy, startId } = expeditionStart(def);
    this.galaxy = galaxy;
    this.gs.currentSystemId = startId;
    this.gs.expeditions = { activeId: def.id, phaseIndex: 0, milestoneProgress: {}, completedPhases: [] };
    if (def.loadout?.strip) this.gs.resetToLoadout(def.loadout); // new GameState method
  }

  _currentPhase() { return this._def?.phases[this.gs.expeditions.phaseIndex] ?? null; }

  _progress(eventName, payload) {
    const phase = this._currentPhase();
    if (!phase) return;
    let allDone = true;
    for (const m of phase.milestones) {
      if (m.event !== eventName) { if (!this._isDone(m)) allDone = false; continue; }
      const have = (this.gs.expeditions.milestoneProgress[m.id] ?? 0) + (payload?.amount ?? 1);
      this.gs.expeditions.milestoneProgress[m.id] = Math.min(m.need, have);
      if (have < m.need) allDone = false;
    }
    if (allDone) this._completePhase(phase);
  }

  _completePhase(phase) {
    for (const flag of phase.reward?.flags ?? []) grantVaultFlag(flag);
    if (phase.reward?.lumens) this.gs.addLumens(phase.reward.lumens);
    for (const [id, qty] of phase.reward?.items ?? []) this.gs.addItem(id, qty);
    this.gs.expeditions.completedPhases.push(phase.id);
    this.gs.expeditions.phaseIndex += 1;
    events.emit('expedition:phase', { phaseId: phase.id, def: this._def.id });
    if (this.gs.expeditions.phaseIndex >= this._def.phases.length) {
      events.emit('expedition:complete', { def: this._def.id });
    }
  }

  dispose() { for (const off of this._offs) off?.(); }
}
```

This is a direct structural cousin of `QuestSystem` (compare `_progress`/`_complete`/event-subscription pattern at quests.js:190-259) — same event bus, same "iterate active trackables, increment, check threshold, fire reward" shape, wrapped in a phase index instead of a flat active-list.

### 15.4.5 Cross-save reward-grant model (the "vault")

The single most important structural gap (#4 in the table) is that `GameState.save()` only ever writes `SLOT_KEY(this.slot)` (state.js:108-115). The vault is a **fourth, slot-independent** localStorage key:

```js
// src/gameplay/rewardvault.js
const VAULT_KEY = 'ams-vault-v1';   // account-wide; not touched by save/load-slot logic

export function loadVault() {
  try { return JSON.parse(localStorage.getItem(VAULT_KEY)) ?? { flags: {}, prisms: 0 }; }
  catch { return { flags: {}, prisms: 0 }; }
}

/** Idempotent: granting an already-held flag is a no-op, returns false. */
export function grantVaultFlag(flag) {
  const v = loadVault();
  if (v.flags[flag]) return false;
  v.flags[flag] = { grantedAt: Date.now() };
  localStorage.setItem(VAULT_KEY, JSON.stringify(v));
  events.emit('vault:updated', { flag });
  return true;
}

export function grantPrisms(n) {
  const v = loadVault();
  v.prisms = (v.prisms ?? 0) + n;
  localStorage.setItem(VAULT_KEY, JSON.stringify(v));
  return v.prisms;
}

/** Called once after GameState.load(slot) — syncs cosmetic unlocks into the
 *  live slot without ever persisting them INTO the slot's own JSON, so a
 *  reward earned via any slot (or an Expedition run, or a future Twitch
 *  Drop) is visible from every slot, mirroring NMS's account-wide unlock. */
export function applyVaultUnlocks(gs) {
  const v = loadVault();
  gs.unlockedCosmetics = Object.keys(v.flags);
  gs.prisms = v.prisms ?? 0;
}
```

Wiring: `GameState.load()` (state.js:166-179) gains one call — `applyVaultUnlocks(gs)` — right before `return gs;`. `GameState.save()` is untouched: the vault is deliberately **never** serialized inside `JSON.stringify(this)`, so it survives slot deletion (`clearSave`, state.js:181) and is shared by all 3 slots. This is the minimal correct model for "expedition rewards redeem into your main saves": completing an expedition phase calls `grantVaultFlag`, and the very next `GameState.load()` of *any* slot sees it.

### 15.4.6 Nexus-style repeatable-mission generator + cosmetic currency

A new currency, **prisms**, is cosmetics-only (never usable at the trading post — cf. Vol 9), stored in the vault (not per-slot `lumens`), matching Quicksilver's account-wide, cosmetics-only nature.

```js
// src/gameplay/nexusmissions.js
import { RNG, hash32 } from '../core/rng.js';

const DAY_MS = 86_400_000;
const NEXUS_TEMPLATES = [ /* same {kind, make(rng, ctx)} shape as CONTRACT_TEMPLATES,
                              quests.js:24-83, but reward.prisms instead of reward.lumens */ ];

/** Deterministic daily slate: every player sees the SAME 3 missions on the
 *  same UTC day, refreshing at midnight — the real-world-timer cadence NMS's
 *  Nexus has and quests.js's save-seeded _refill() (quests.js:323-341) does not. */
export function nexusMissionsFor(now = Date.now()) {
  const dayIndex = Math.floor(now / DAY_MS);
  const rng = new RNG(hash32(dayIndex, 0x9e57));
  const out = [];
  const pool = [...NEXUS_TEMPLATES];
  let guard = 0;
  while (out.length < 3 && guard++ < 20 && pool.length) {
    const tpl = rng.pick(pool);
    const m = tpl.make(rng.fork(`n${out.length}${guard}`));
    if (!m || out.some((o) => o.title === m.title)) continue;
    m.id = `nexus:${dayIndex}:${out.length}`;
    m.expiresAt = (dayIndex + 1) * DAY_MS;
    m.reward.prisms ??= 40;
    out.push(m);
  }
  return out;
}

/** Weekly community-goal template rotation: bucket 7 days together. */
export function weeklyGoalFor(now = Date.now()) {
  const weekIndex = Math.floor(now / (DAY_MS * 7));
  const rng = new RNG(hash32(weekIndex, 0x9e58));
  return { id: `week-${weekIndex}`, metric: rng.pick(['warps', 'wardenKills', 'discoveries']), target: rng.int(50, 200) };
}
```

The **cosmetics vendor** (Vol 10 hub territory) is then just a read of `loadVault().prisms` against a rotating catalog keyed the same way (`hash32(weekIndex, 0x9e59)` picks 4-6 items from a cosmetic-id pool) — no new persistence mechanism, reuses the vault.

### 15.4.7 Rendezvous / community-goal hook (local stub, Vol 13 seam)

```js
// src/gameplay/expeditions.js (cont.) — LOCAL-ONLY today; server.mjs has zero
// routes (confirmed), so this is an honest stub, not a fake feature.
export function bumpCommunityGoal(goalId, amount = 1) {
  const key = `ams-goal-${goalId}`;
  const v = Number(localStorage.getItem(key) ?? 0) + amount;
  localStorage.setItem(key, String(v));
  events.emit('community:progress', { goalId, value: v });
  return v;
  // Volume 13 swap-in: POST /api/goal/:id/bump to server.mjs (needs a real
  // route + a datastore, neither of which exist yet) and poll GET
  // /api/goal/:id for the aggregate instead of reading local-only state.
  // The call SITE (this function) does not change — only its body does.
}
```

Rendezvous points (co-present players in one instance) are explicitly **not** buildable until Volume 13 ships a session/presence layer; this volume defines only the milestone type (`kind: 'rendezvous'`) so expedition *definitions* can reference it once the backend exists, without another schema migration.

### 15.4.8 Endgame loop set (matched to what we can build now)

| Loop | Design note | Depends on |
|---|---|---|
| **S-class re-roll** | Add a `rerollAtShipyard(offer, cost)` to `shipmarket.js` that re-invokes `rollGrade`/`rollClass` (shipmarket.js:76-103) against a fresh `RNG` fork, charging escalating lumens per attempt — turns the existing weighted roll into a deliberate ritual | Vol 7 |
| **Derelict dungeons** | New `POIType: 'derelict'` spawned like a station but interior-only; sealed-door state machine keyed by puzzle-terminal solves, seeded per-instance via `hash32(systemId, 'derelict')`; loot table grants vault flags + items | Vol 2/3 (interior geo), Vol 6 (encounters) |
| **Frigate missions** | Deferred-resolution missions (no live simulation needed): `sendFrigate(frigate, missionDef)` rolls success at `t = 0` using frigate stats, schedules a `setTimeout`/real-time-delta check, resolves on next load if time has elapsed — EVE-style "log off, come back later" pattern | Vol 6, Vol 7 (freighter/frigate entities absent) |
| **Racing** | Reuse `gameplay/rover.js` positions; a `RaceTrack` def (checkpoint array + par time) computed deterministically per system; local leaderboard in vault (`vault.races[trackId] = bestTimeMs`); networked leaderboard is a Vol 13 seam identical to 15.4.7 | Vol 7 |
| **Collection metagames** | `gs.discoveries` (state.js:43) already records `{systems, planets, creatures, flora, ruins}`; add a `completionPct(kind)` reader and a milestone ladder (25/50/75/100%) that calls `grantVaultFlag` — no new data model, just thresholds over existing data | Vol 4, Vol 5 |

### 15.4.9 Update-cadence / content-pack structure

```
data/
  expeditions/
    2026-01-firstlight.js      // exports one ExpeditionDef
    2026-02-warden-hunt.js
  content-packs.js             // registry: [{ id, season, addedAt, expeditions:[...], nexusTemplates:[...] }]
```

```js
// data/content-packs.js
export const CONTENT_PACKS = [
  { id: 'launch', season: '2026.0', addedAt: '2026-07-01', expeditions: [], nexusTemplateIds: ['base'] },
  { id: 'firstlight', season: '2026.1', addedAt: '2026-08-01', expeditions: ['exp-firstlight'], nexusTemplateIds: ['base', 'wardens'] },
];
```

A content pack is pure data + module registration — no engine change required to ship one, mirroring how NMS updates plug new missions/rewards into a stable core loop. `GameState.version` (state.js:14) stays as the *save-schema* version; a separate `CONTENT_VERSION` constant (bumped per pack) is stamped into `gs.expeditions` so old saves can detect "you're missing pack X" without a schema migration.

### 15.4.10 Module/file plan

| File | New/modified | Purpose |
|---|---|---|
| `src/gameplay/expeditions.js` | new | `ExpeditionSystem`, `expeditionStart`, `expeditionGalaxySeed`, `bumpCommunityGoal` |
| `src/gameplay/rewardvault.js` | new | `loadVault`, `grantVaultFlag`, `grantPrisms`, `applyVaultUnlocks` |
| `src/gameplay/nexusmissions.js` | new | `nexusMissionsFor`, `weeklyGoalFor`, `NEXUS_TEMPLATES` |
| `src/gameplay/state.js` | modified | add `resetToLoadout(loadout)`; call `applyVaultUnlocks(gs)` in `load()` |
| `src/gameplay/shipmarket.js` | modified (Vol 7 owns) | add `rerollAtShipyard` |
| `src/ui/expeditionui.js` | new | phase tracker HUD (mirrors `ui/questui.js` tracker pattern, lines 26-40) |
| `src/ui/nexusui.js` | new | daily/weekly mission panel + prisms cosmetics vendor (mirrors `ui/missionboard.js` panel pattern) |
| `data/expeditions/*.js` | new | expedition definitions (content-data, not engine code) |
| `data/content-packs.js` | new | pack registry |
| `test/expedition-check.mjs` | new | headless acceptance tests, see 15.7 |

---

## 15.5 Phases

| Phase | Scope | Depends on |
|---|---|---|
| **P0 — Vault & schema groundwork** | `rewardvault.js`, `GameState.resetToLoadout()`, vault wiring into `load()`; expedition/nexus-mission schemas documented; zero UI | none |
| **P1 — Expedition MVP** | `ExpeditionSystem`, `expeditionStart`/`expeditionGalaxySeed`, one hand-authored expedition def (3-4 phases), `expeditionui.js` tracker, launch/redeem flow | P0 |
| **P2 — Nexus loop + prisms** | `nexusmissions.js`, `nexusui.js`, cosmetics catalog rotation, prisms currency in vault | P0 |
| **P3 — Endgame loop set** | S-class re-roll (Vol 7 coordination), collection-metagame ladder, local racing leaderboard, frigate-mission stub (deferred-resolution only, no freighter sim) | P0, Vol 7 partial |
| **P4 — Community goals & rendezvous (networked)** | Swap `bumpCommunityGoal`'s local stub for real server routes; rendezvous milestone type activated | **Blocked on Volume 13** |
| **P5 — Content-pack cadence** | `content-packs.js` registry, `CONTENT_VERSION` staleness check, second/third expedition defs authored, re-run scheduling | P1, P2 |

---

## 15.6 Effort & risk

| Component | Engineer-weeks | Risk |
|---|:--:|---|
| Vault + cross-save grant model (P0) | 1.5 | Low — pure localStorage, no new architecture |
| ExpeditionSystem + fixed-seed start (P1) | 3 | Low-Med — reuses `Galaxy`/`QuestSystem` patterns directly |
| Expedition UI (tracker, launch/redeem flow) | 1.5 | Low |
| Nexus daily/weekly generator + UI | 2 | Low — direct `boardMissionsFor` cousin |
| Prisms currency + cosmetics vendor rotation | 1.5 | Med — cosmetics *content* (skins/decorations) has to exist to sell; blocked on Vol 7/8 art |
| S-class re-roll ritual | 1 | Low (Vol 7-owned integration point) |
| Collection-metagame ladder | 1 | Low |
| Local racing leaderboard | 1.5 | Low |
| Derelict-dungeon skeleton | 4-5 | High — needs interior POI geometry (Vol 2/3) not yet designed |
| Frigate-mission deferred-resolution stub | 2 | Med — believable without a real freighter entity (Vol 7), but feels thin until one exists |
| Community goals / rendezvous (networked) | 2 (client) + **blocked** (server) | High — fully gated on Volume 13 shipping a backend |
| Content-pack registry + tooling | 1 | Low |
| **Total (excl. derelict dungeons & networked features)** | **~16 engineer-weeks (~4 months, 1 engineer)** | |
| **Total incl. derelict dungeons, excl. blocked networked work** | **~21-22 engineer-weeks** | |

**Ongoing live-ops content cost (post-launch, matching NMS's cadence at a sane fraction of scale):** authoring one new Expedition definition (8-12 phases, cosmetic reward set, testing) runs **1-2 engineer/designer-weeks per expedition**, independent of the framework build above. A sustainable cadence of one expedition per quarter + weekly Nexus template refreshes is roughly **0.5 designer-week/month steady-state** once the framework (P0-P2) exists, plus **cosmetic-asset authoring time** (Vol 16 territory — this project's zero-external-asset rule means "cosmetics" must be proceduraly recombined, e.g. palette/decal swaps on existing meshes, not hand-modeled skins, which caps variety versus NMS's authored-art pipeline).

**Key risks:**
1. **Cosmetics have no visual substrate yet.** Vol 7/8's ship/base meshes need a skin/material-variant system before "reward a ship skin" means anything renderable — this volume can define the *reward plumbing* but not the *rendered payoff* alone.
2. **Everything server-shaped (P4) is fully blocked** on Volume 13, which today is a 0/10 — `server.mjs` has no routes. Do not schedule rendezvous/live-leaderboard work before Vol 13's backend exists.
3. **Endgame loops referencing absent entities** (frigates/freighters, living ships, water/fishing, settlement NPCs) can only be built as thin stubs here; their *simulations* belong to Vols 6/7/8/10/11 and this volume should not duplicate that work.

---

## 15.7 Acceptance criteria

Following this project's existing headless-Playwright convention (`test/mission-check.mjs`, which drives `window.__AMS__.game` directly — see e.g. its `acceptBoard`/`claimCourier` assertions), a new `test/expedition-check.mjs` must prove, without any human in the loop:

**1. Fixed-seed reproducibility — an expedition seed produces the same start.**
```js
// two independent Galaxy instances built from the SAME expedition def must
// agree on starting system id, star class, and starting planet biome.
const def = { id: 'exp-firstlight', season: '2026.1' };
const a = expeditionStart(def);
const b = expeditionStart(def);
assert(a.startId === b.startId);
assert(a.galaxy.getSystem(a.startId).planets[0].biome === b.galaxy.getSystem(b.startId).planets[0].biome);
// AND: a different `season` string must (with overwhelming probability) diverge —
// proves the seed is actually derived from the def, not hardcoded.
const c = expeditionStart({ id: 'exp-firstlight', season: '2026.2' });
assert(c.startId !== a.startId || c.galaxy.seed !== a.galaxy.seed);
```

**2. Milestone completion grants a reward flag persisted to a slot.**
```js
// test/expedition-check.mjs — Playwright, mirrors mission-check.mjs structure
await page.evaluate(() => {
  const g = window.__AMS__.game;
  g.expeditions.start(TEST_DEF);                 // isolated run, not the player's normal save
  window.__AMS__.events.emit('warp:end', g.gameState.currentSystemId); // satisfies m1
  window.__AMS__.events.emit('discovery:new', { kind: 'planets' });    // satisfies m2 → completes phase p1
});
const result = await page.evaluate(() => {
  const vaultRaw = localStorage.getItem('ams-vault-v1');
  return { vault: JSON.parse(vaultRaw), phaseIndex: window.__AMS__.game.gameState.expeditions.phaseIndex };
});
assert(result.phaseIndex === 1);                                  // advanced past p1
assert(result.vault.flags['exp-firstlight:banner']);              // reward flag present in the ACCOUNT vault

// Now prove cross-save redemption: load a DIFFERENT, unrelated slot and
// confirm the unlock is visible there too — this is the whole point of #4
// in the gap table.
await page.evaluate(() => {
  const gs2 = GameState.load(2);         // a slot that never touched the expedition
  applyVaultUnlocks(gs2);
});
const gs2Cosmetics = await page.evaluate(() => window.__AMS__.testLoadSlot2().unlockedCosmetics);
assert(gs2Cosmetics.includes('exp-firstlight:banner'));
```

**3. Idempotency.** Re-emitting the same milestone events after a phase is already complete must not double-grant (`grantVaultFlag` returns `false` on repeat) and must not advance `phaseIndex` past `def.phases.length`.

**4. Nexus determinism.** `nexusMissionsFor(T)` called twice with the same `T` (or any two timestamps in the same UTC day) returns byte-identical mission arrays; called with `T` and `T + DAY_MS` returns a different set (allowing pool exhaustion collisions) with `guard` never exceeding its cap (no infinite loop, same defensive pattern as `_refill()`'s `guard++ < 10`, quests.js:328).

**5. No engine dependency.** All of the above must pass with `?state=` debug boot (per `quests.js`'s own convention at line 215 for suppressing the lore-modal timer in tests) and without any WebGL rendering asserted — expedition/vault/nexus logic is pure state, provable in a DOM-less or SwiftShader-headless run identical to the existing `test/*.mjs` harness.

Passing all five is the bar for "the expedition framework works," independent of whether any cosmetic content, derelict dungeon, or networked rendezvous exists yet — exactly mirroring how this report separates *framework* acceptance (this volume) from *content* and *backend* acceptance (Vol 17 roadmap, Vol 13).
