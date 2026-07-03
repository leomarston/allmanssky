# Volume 10 — NPCs, Factions, Language, Story & AI

**Document status:** Domain volume 10 of 18 in the AllMansSky → No Man's Sky parity report.
**Subject version:** AllMansSky `v1.0` (22,886 lines of JavaScript, zero external art/audio assets).
**Primary source modules examined:** `src/gameplay/npcs.js`, `src/gameplay/language.js`, `src/gameplay/quests.js`, `src/ui/missionboard.js`, `src/ui/questui.js`, `src/universe/lore.js`, `src/render/stationinterior.js`, `src/render/knowledgestone.js`, `src/states/hangarstate.js`, `src/states/surfacestate.js`.
**Benchmark:** No Man's Sky as shipped through its full update history (Foundation → Worlds Part II / Echoes and beyond).

---

## 10.1 What No Man's Sky does

### 10.1.1 The sapient races

NMS populates its galaxy with a small, deliberately-authored cast of sapient species, each with a distinct silhouette, rig, animation set, voice/vocal-synthesis timbre, written language, and culture. This is the backbone of every social system in the game:

| Race | Archetype | Culture / personality | Interaction flavor |
|---|---|---|---|
| **Gek** | Merchant | Mercantile, food-obsessed, status-anxious, quick to flatter or threaten depending on standing | Trade-skewed dialogue, haggling, gifts of food/curiosities |
| **Korvax** | Scientist / synthetic | Cold, precise, obsessed with the Atlas and "convergence," speaks in probabilities | Lore-heavy dialogue, technology and Atlas-mythology threads |
| **Vy'keen** | Warrior | Tribal honor code, blunt, respects strength and directness | Combat-flavored dialogue, "roar"/aggressive choice branches, weapon gifts |
| **Traveller** | Wanderer | Rare, cryptic, wears an exosuit like the player, speaks only in the alien **-null-** language | Mystery-thread NPCs tied to the player's own identity; graves and encounters rather than settlements |
| **Autophage** | Machine-folk (added in *Echoes*) | Beings who preserve the dead by "writing them down" into mechanical bodies; culture built around memory and continuity after death | A distinct questline culture with its own tech, ships, and vocabulary |
| **Sentinels** | Mechanical enforcers | Not conversational NPCs but a scaling AI hierarchy (drones → quads → mechs → capital ships) with an evolving "corruption"/Purge narrative | Escalating hostility state machine, not dialogue |
| **The Atlas / entities** | Cosmic | The simulation's substrate; encountered through Atlas Interfaces and the -null- thread | Binary philosophical choices at story climaxes |

Every race NPC is built from an **authored rig with authored face/head geometry, a bespoke idle/talk animation set, and a per-race vocal synthesis bank** (procedurally sequenced phonemes, not recorded voice lines) layered on top of **procedurally recombined clothing/accessory variants**. The "unlimited NPC variety" NMS is known for is variety *within* a fixed, authored per-race template — not variety *between* templates, which are hand-built.

### 10.1.2 The language system

Each living race has its own written/spoken language (Gek, Korvax, Vy'keen; Travellers and high lore speak **-null-**). Vocabulary is learned incrementally and persists account-wide:

- **Monoliths** — large stone structures dedicated to one race. Interacting presents a short riddle/lore quiz; a correct answer teaches a word (and grants a title/relic); a wrong answer still often teaches the word but with a rebuke.
- **Plaques / damaged machinery / signal scanners** — smaller wall-mounted or ground objects that reveal a word directly, no quiz.
- **NPC dialogue option** — trading-post and settlement NPCs offer a "teach me a word" branch, usually costing units or an item.
- **Word/alphabet discoveries** — rarer finds that reveal recognition of a whole grammatical category rather than a single word.

Until a word is known, in-fiction text renders the untranslated word in the race's alien glyph font; once learned, every future occurrence of that word — in dialogue, plaques, mission text — renders in English. A guide/catalogue page tracks % vocabulary known per race. This gradual "the world gets more legible as you learn" mechanic is one of NMS's most distinctive narrative-systems ideas.

### 10.1.3 Station / settlement / anomaly NPC types

- **Space stations**: wandering race NPCs (flavor barks + "teach a word" + gift dialogue), a **Mission Agent** (procedural mission board), a **Trade Terminal**, a **Cartographer** (buys/sells star charts), a **blueprint/technology vendor**, and — at Outlaw stations — black-market variants with unique dialogue and illegal-goods trading.
- **Settlements**: an appointable **Overseer** (recruited via a short questline, then governs the settlement's policy choices), specialist NPCs (scientist, weapons technician, armourer/architect) each recruitable to a player base via their own mini-questline, after which they take up permanent residence and offer ongoing services/dialogue.
- **The Space Anomaly** (the game's social/multiplayer hub): **Nada** (Korvax) and **Polo** (Gek) are persistent narrator-companions who frame the Artemis Path story; a row of **Guild Envoy**-style desks post the Nexus's regenerating community mission board (combat / mining / base-building / trade / exploration categories); the **Quicksilver Synthesis Companion** vendor sells cosmetics for the Quicksilver currency earned from Nexus missions and expeditions; technicians repair/upgrade the multitool and exosuit.

### 10.1.4 Dialogue

NMS dialogue is a short branching-choice tree per interaction: 2–4 options per node, gated by conditions (known vocabulary — unknown-language options are shown but produce worse/uncertain outcomes; standing/reputation; carried items or units; prior choices in the same conversation or earlier ones). Typical outcome types: standing gain/loss with the race or faction, units, blueprints, ancient relics/curiosities, a learned word, an item request/trade, or unlocking a follow-up interaction. Tone choices (aggressive / generous / neutral-ish) recolor both the immediate reward and the NPC's future disposition. Once a one-time conversation resolves, the game does not replay it identically — the NPC falls back to an idle bark, which is the game's way of marking a completed, consequential interaction.

### 10.1.5 The primary story

The story is presented as a set of **selectable, largely-linear guided-mission chains** in the Quest log rather than one monolithic script, converging on shared mythic set pieces:

- **Awakenings** — the original resurrection prologue and Atlas Path introduction (accept or refuse the Atlas's guidance at the outset — a flavor-affecting binary choice).
- **Artemis Path** — a scripted, comms-relay-driven narrative following the AI **Artemis** through a sequence of milestone missions to a climactic revelation about the nature of the simulation.
- **Apollo** — a companion thread in which the player finds and can permanently recruit a synthetic entity, **Apollo**, as a base companion with ongoing dialogue.
- **-null-** — the Traveller-identity mystery, seeded by encounters and graves written entirely in the untranslatable -null- glyph language, tied to the theme that the player may themselves be one of many parallel Travellers.
- **The Atlas Path** — an optional pilgrimage: collect ten Atlas Interfaces scattered across the galaxy to reach the galactic core, culminating in a binary choice (embrace / refuse the Atlas) that colors the ending text and can trigger **The Loop** — a soft rebirth into a new galaxy that preserves meta-progression while resetting the local save context.
- **Purfound** and **16** — deeper, rarer lore fragments; **16** in particular is the central figure of the **Autophage** questline added in the *Echoes* update, a preserved identity whose story is about memory surviving death.
- **Echoes** (2023) — the update that introduced the Autophage race, their tech/ships, and the 16 narrative, alongside a new hostile Sentinel escalation.

Structurally: each thread is a graph of quest-log entries, mostly linear per-thread, occasionally forking on a binary choice, with node text and NPC dialogue drawing on the language/standing systems above. All threads eventually gesture at the same cosmology (the Atlas, the simulated galaxy, the cycle of resets).

### 10.1.6 Secondary arcs

- **Base Computer Archives / Awakenings tie-ins** — narrative text unlocked as you expand a base, told through your Base Computer's own "voice."
- **The Purge** — a Sentinel-corruption crisis chain on a chosen planet; completing it unlocks Sentinel-themed multitool/starship technology.
- **Base specialist questlines** — short fetch/dialogue chains to recruit an Overseer, Scientist, Weapons Technician, and Armourer/architect to a base or settlement, each ending in a permanent, dialogue-bearing NPC resident.
- **Autophage / Sentinel questlines** — the *Echoes*-era Autophage storyline (aid/understand the machine-folk culture) and evolving Sentinel-hierarchy encounters that escalate independently of the main story.

### 10.1.7 Procedural missions

The station **Mission Agent** and the Anomaly's **Nexus** board regenerate procedural missions in recognizable categories: reconnaissance/scan, cargo delivery/courier, combat/bounty, salvage of crashed-freighter cargo, passenger-guidance missions, and (at the Nexus) community mission categories spanning combat, mining, base-building, trade, and exploration with reward currencies scaled to difficulty (units, nanites, salvaged tech, Quicksilver). Repeated completion at a station's Mission Agent builds toward a **rank ladder** (colloquially "Guild missions") that unlocks harder/better-paying tiers and a milestone capstone reward.

### 10.1.8 NPC & creature AI generally

Station/settlement NPCs follow simple scripted waypoint routines with idle/talk animation blending and line-of-sight-triggered "notice the player" turns. Creature AI runs graze/flee/predator/pack states with fear and aggression thresholds, herd cohesion, and diurnal/weather-linked schedules. Sentinel AI is a genuine escalation state machine (patrol → detect → alert → drone/quad/walker/mech/corvette/mothership response tiers, "wanted level" style). Pirate/NPC ship AI patrols trade lanes, flies in loose formation, engages in dogfighting behaviors, and can trigger distress-call and freighter-battle set-piece events.

### 10.1.9 Lore artifacts

- **Monoliths** — race-specific, riddle/quiz interaction, teach a word + grant a relic/title.
- **Plaques** — small, single-paragraph lore texts, no puzzle.
- **Alien ruins** — small structures housing plaques and dig-site "curiosity"/ancient-bone caches, sometimes minigame-locked.
- **Traveller graves** — rare glowing markers written in -null-, tied to the Traveller mystery, occasionally granting exosuit/ship cosmetics.
- **Crashed ships / damaged machinery / signal scanners** — salvage and beacon-reveal props, largely dialogue-free.

---

## 10.2 What we have (cite source)

AllMansSky implements a genuinely working slice of this stack — a single race/faction-flavored crowd, one constructed language, a linear main-story chain, a real reputation ladder, and a 7-kind procedural mission board — but every one of these is a single, un-forked instance of the pattern NMS repeats five times.

**Wandering NPCs — one universal figure, faction-tinted.** `NPCCrowd` (`src/gameplay/npcs.js:103-236`) spawns 4–6 low-poly humanoids per hangar, built by the single `buildFigure()` factory (`npcs.js:35-101`): a capsule torso, sphere head, capsule limbs, palette-varied by `rng.range()` skin hue/suit tint and a ±8% uniform scale (`npcs.js:54`). There is exactly **one body plan reused across all five factions** (`meridian`/`chorale`/`sunward`/`ashen`/`none`); differentiation is entirely cosmetic (suit color from `FACTIONS[faction].colorHex`, a role string drawn from a per-faction `ROLES` table, `npcs.js:14-20`). Each NPC carries one line, chosen 50/50 between the faction's `GREETINGS` pool and a generic `ASIDES` pool (`npcs.js:134`), shown once per approach via `HangarState._talk()` (`src/states/hangarstate.js:147-155`) as a 5.5-second speech-bubble DOM overlay with **no reply options, no memory, no consequence** — it is a bark, not a conversation. Movement is real and good: waypoint wander with idle pauses, face-the-player-within-3m turning, and a genuine two-phase walk cycle driving leg/arm rotation and a bob (`npcs.js:156-224`).

**Language — one constructed language, one dictionary, one teaching method.** `Language` (`src/gameplay/language.js`) wraps a single hardcoded 96-word **Luminel** lexicon (`LEXICON`, `language.js:10-35`) — this is the extinct precursor civilization's language, not a per-faction living-culture language; all four living factions (Meridian, Chorale, Sunward, Ashen) share zero linguistic identity of their own. `learnRandom()` (`language.js:48-61`) teaches the *next unlearned word in a fixed RNG-seeded order* (seeded by `galaxySeed` + count known, `language.js:55`) — the player never chooses which word to learn, and there is exactly **one teaching source**: touching a `knowledgestone.js` prop calls it once and sets a `taught` flag (`surfacestate.js:530-535`). `gloss(text)` (`language.js:72-91`) is the real, working payoff: it walks an English string, substitutes any word with a known Luminel translation into the alien form wrapped in a `.lum-unknown` span, and reveals it in English once learned — **this is applied only to procedurally generated ruin lore** (`surfacestate.js:520`, `this.language.gloss(lore.text)`), not to the Vesper main-story beats (`quests.js` emits `lore:show` with raw English text, `quests.js:350`), not to NPC barks, and not to mission-board text — so the deepest story content is always fully legible regardless of vocabulary, undercutting the "world gets more readable" promise everywhere except planetside ruins.

**Factions & reputation — 3 of 4 factions are systemically live.** `FACTIONS` in `lore.js:67-88` defines four powers (Meridian Combine, Choir of Glass, Sunward Kin, Ashen Fleet) each with a `blurb` (a real seed of personality — "Contracts, credits, customs seals — and ledgers that outlive everyone who signs them") and a `colorHex`, but **no structured trait/likes/dislikes/dialogue-tone data** beyond that prose blurb and the static `GREETINGS` pool (`lore.js:106-140`, 4–5 lines per faction). `QuestSystem` (`src/gameplay/quests.js`) tracks reputation for exactly `{ meridian, chorale, sunward }` (`quests.js:185`); `repTier()` (`quests.js:98-104`) maps a scalar to a 5-tier ladder (DRIFTER 0 → ASSOCIATE 50 → PARTNER 150 → ENVOY 400 → LUMINARY 1000) granting a 0–12% trade discount (`REP_TIERS`, `quests.js:89-95`) via `discountFor()` (`quests.js:262`). **The Ashen Fleet has no reputation track and no board missions** — `BOARD_TEMPLATES` (`quests.js:107-142`) only tags `faction: 'meridian'|'chorale'|'sunward'`; Ashen exists purely as a hostile-encounter flavor (the `combat:pirateKilled` event target). Standing's only mechanical effect is the linear trade discount — no unlocked dialogue, missions, or gifts per tier.

**Missions — 7 board kinds + 5 untied side-contract kinds, both deterministic and event-driven, but flat.** `BOARD_TEMPLATES` (`quests.js:107-142`) implements exactly the "7-kind mission board" scope: prospect/haulage, cartograph (scan creatures), pilgrimage (commune with a ruin), purge (kill Wardens), bounty (kill Ashen raiders), courier (deliver held cargo), survey (scout a neighbor system) — each a `make(rng, ctx)` closure producing title/desc/event-filter/need/reward. `boardMissionsFor(system, gs, galaxy)` (`quests.js:145-168`) deterministically rolls 4–6 offers per system, reseeded by completed-mission count (`hash32(hashString(system.id), done, 0x804d)`, `quests.js:147`) — same system + same completion count ⇒ same offers, a good determinism property. Rewards scale by a flat `n × itemValue × multiplier` formula with **no difficulty tier, no distance/danger multiplier, no time limit, and no failure state** — accepting is free, abandoning is free (`abandonBoard`, `quests.js:275-280`), and there is no negotiation: missions are picked from a terminal-style list UI (`src/ui/missionboard.js`), not offered/negotiated through an NPC. A separate, un-tied `CONTRACT_TEMPLATES` (`quests.js:24-83`, 5 kinds) auto-refills a rolling 3-slot personal contract log independent of any board or faction.

**Main story — one linear 6-beat chain, zero branches.** `VESPER_BEATS` (`quests.js:14-21`) is a fixed array of 6 lore beats (depth 1/3/5/8/12/16) unlocked purely by an incrementing `vesperDepth` counter that ticks on every `warp:end` event (`quests.js:190-192, 343-356`) — **no player choice ever alters which beat fires, its text, or its reward**; `_checkBeats()` fires at most one beat per warp and shows it via the same `lore:show` modal as ruin communion. There is no second thread, no binary choice node, no divergent ending, no rebirth loop — the entire "primary story" scope named in this volume's brief (Artemis/Apollo/-null-/Atlas Path scale) is represented by this single always-forward beat counter.

**Station architecture — one hall archetype.** `buildHangar()` (`src/render/stationinterior.js:375-940`) is an excellent, richly detailed procedural interior (deck plating, catwalks, bay-mouth starfield, 3 holographic terminal alcoves for `trade`/`shipyard`/`missions`) but is **the only interior type** — there is no settlement, no Anomaly-equivalent social hub, no outlaw/black-market variant with different NPC rosters or dialogue tone.

**Lore artifacts — one prop family.** `createKnowledgeStone()` (`src/render/knowledgestone.js:47-109`) is a single procedural monolith type: a tapered stone slab with a seeded canvas-drawn glyph face, teaching exactly one word on touch (`prop.taught`, one-shot, no quiz/riddle interaction). Planetside "ruins" communed via `_commune()` (`surfacestate.js:515-528`) use the same generic `ruinLore()` generator (`lore.js:280-299`, a combinatorial 2-sentence templated grammar over six word banks) for every ruin regardless of location or faction — there is no plaque/monolith/grave type distinction, only "stone" (teaches a word) and "ruin" (shows glossed lore + chance of an item).

**Dialogue UI substrate exists and is reusable.** `QuestUI.showLore()` (`src/ui/questui.js:58-80`) already renders a full-screen modal with title/body/CONTINUE button pattern shared by both ruin communion and Vesper beats — a serviceable chassis to extend into a multi-choice dialogue box, but today it is **strictly single-node**: one text block, one button, no branching.

---

## 10.3 The gap

| # | Gap | Severity | Description | Effort |
|---|---|:--:|---|--:|
| 1 | Sapient race identity | **[Structural]** | One generic humanoid template reused across 5 factions with only palette/text swaps; no distinct biology, culture data, or behavior per faction | 2–3 wk |
| 2 | Procedural face/silhouette variety | **[Structural]** *(zero-asset capped)* | Same capsule-torso/sphere-head rig at every station; no per-race silhouette differentiation at all | 2–4 wk (procedural) / +art if bent |
| 3 | Branching dialogue with choices & consequences | **[Structural]** | `_talk()` shows one static line for 5.5s; no reply options, no state, no memory | 3–4 wk |
| 4 | Multi-race language dictionaries | **[Feature]/[Structural]** | One shared 96-word Luminel lexicon (an extinct precursor tongue); the four *living* factions have no language of their own | 2 wk code + 1.5–2 wk writing |
| 5 | Language learn-source diversity | **[Feature]** | Only one teaching source (touch-a-stone, sequential order); no quiz/riddle monoliths, no NPC "teach me a word," no per-item plaque micro-lore | 1.5–2 wk |
| 6 | Station/settlement/Anomaly NPC-type variety | **[Structural]** | One hall archetype with generic wandering crew; no Nexus-equivalent hub, no guild envoys, no recruitable base specialists, no outlaw variant | 3–5 wk |
| 7 | Primary story at Artemis/Atlas Path scale | **[Structural]** | 6 fixed beats gated only by a warp-depth counter; zero choices, zero branches, zero endings | 3 wk code + 4–6 wk writing |
| 8 | Secondary arcs (base specialists, Purge-like, Autophage-like) | **[Feature]/[Structural]** | None exist; only flavorless procedural side contracts | 2–3 wk code + 2–3 wk writing |
| 9 | Procedural mission depth (difficulty/distance/time-limit/failure/chaining) | **[Feature]** | 7 kinds exist (good breadth) but flat reward math, no scaling axis, no expiry, no chains, no negotiation | 2 wk |
| 10 | Faction/race standing depth | **[Feature]** | 3 of 4 factions tracked; single linear trade-discount payoff; no unlocked dialogue/missions/gifts per tier | 1.5 wk |
| 11 | Ashen Fleet systemic absence | **[Feature]** | 4th faction defined in lore only; no reputation track, no board missions, combat-only | 0.5 wk (decision + wiring) |
| 12 | NPC/creature general AI depth | **[Feature]/[Structural]** | Waypoint wander + face-on-approach only; no schedules, needs, reactions to reputation/crimes, or group behavior | 3–4 wk |
| 13 | Lore-artifact type variety (monolith/plaque/ruin/grave) | **[Feature]** | One prop family (`knowledgestone`) + one generic "ruin"; no visual/interaction differentiation by artifact type | 1.5–2 wk |
| 14 | Gloss/translation coverage completeness | **[Cosmetic]/[Feature]** | `gloss()` works well but is applied only to planetside ruin text — not to Vesper beats, NPC dialogue, or mission text | 0.5–1 wk |
| 15 | Character animation depth (zero-asset ceiling) | **[Engine]/[Cosmetic]** | 2-phase primitive walk cycle only; no gesture/idle variety, no facial animation (faces are blank spheres), no voice/lip-sync | Bounded by asset rule — see 10.6 |

---

## 10.4 Target design

The guiding principle: **one dialogue-graph interpreter should power NPC conversations, monolith quizzes, and main-story choice beats** — do not build three bespoke branching systems. Everything below is additive to existing modules; nothing in `npcs.js`'s wander/animation code, `quests.js`'s event-driven contract tracking, or `stationinterior.js`'s hall geometry needs to be thrown away.

### 10.4.1 Race data model

```js
// src/universe/races.js — NEW
export const RACES = {
  meridian: {
    id: 'meridian', archetype: 'merchant', displayName: 'Meridian Combine',
    silhouette: 'broker',              // → maps to a buildRaceFigure() variant
    palette: { skinHue: [0.03, 0.09], suitBase: '#ffb454' },
    personality: { greed: 0.75, curiosity: 0.25, aggression: 0.15, formality: 0.85 },
    giftLikes: ['ferrox', 'carbyne', 'luminelshard'],
    giftDislikes: ['voidsalt'],
    lexiconId: 'ledgerspeak',
    dialogueBankId: 'meridian',
  },
  chorale:  { id: 'chorale',  archetype: 'scientist', silhouette: 'archivist', ... lexiconId: 'glasstongue', dialogueBankId: 'chorale' },
  sunward:  { id: 'sunward',  archetype: 'warrior',   silhouette: 'hullborn',  ... lexiconId: 'kinhold',     dialogueBankId: 'sunward' },
  ashen:    { id: 'ashen',    archetype: 'raider',     silhouette: 'enforcer', ... lexiconId: 'ashcant',     dialogueBankId: 'ashen'  },
  none:     { id: 'none',    archetype: 'wanderer',   silhouette: 'drifter',   ... lexiconId: null,          dialogueBankId: 'generic' },
};
```

This is a direct extension of the existing `FACTIONS` object in `lore.js` (`blurb`/`colorHex` become `personality`/`palette`), not a replacement — `FACTIONS` stays as the UI-facing name/color/blurb source, `RACES` adds the structured gameplay data.

### 10.4.2 Procedural face/silhouette generator — and the zero-asset confrontation

**The honest constraint:** NMS's five races each ship an authored 3D head/face rig with authored bone-driven expressions and per-race vocal synthesis. AllMansSky's zero-external-asset rule means we cannot import a Gek head mesh — `buildFigure()` (`npcs.js:35-101`) will always be *procedural primitives assembled at runtime*, and no amount of clever geometry code makes a `SphereGeometry` read as "alien species" the way an authored silhouette does. This is not a gap that more engineering time closes; it is a ceiling.

Two options, presented honestly:

- **Option A — hold the zero-asset line, ship stylized procedural silhouettes.** Extend `buildFigure()` into `buildRaceFigure(rng, raceDef)` with per-archetype geometry branches that exaggerate a *silhouette*, not a face: `merchant` gets a wider, lower head and a stooped spine curve (Gek-coded without copying Gek); `scientist` gets a faceted icosahedron head with an emissive core light instead of a face (Korvax-coded, and conveniently solves "no facial animation" by having no face); `warrior` gets angular pauldron geometry and a jutting jaw silhouette; `wanderer` gets a full enclosing visor (a single emissive plane) hiding the head entirely. This is achievable **today**, with the existing primitive-mesh + canvas-texture toolkit, and is the recommended default.
- **Option B — bend the rule for a minimal authored face/feature kit.** A small kit (10–20 low-poly parts: 3 head shapes, 4 eye styles, 3 mouth/mandible styles per race archetype, each simple enough to hand-model in under an hour, inlined as JS geometry data — vertex/index arrays — rather than a loaded binary asset, preserving "no external asset *files*, no build step" even while conceding "no authored geometry whatsoever") crosses the "recognizable specific alien" threshold NMS clears. This is a genuine product decision, not an engineering one — recommend raising it explicitly rather than deciding it silently, consistent with Volume 16's framing that the zero-asset rule must bend *somewhere* and character legibility is one of the strongest candidates.

```js
// src/render/racefigures.js — NEW, split out of npcs.js buildFigure()
export function buildRaceFigure(rng, raceDef, suitColor) {
  switch (raceDef.archetype) {
    case 'merchant':  return buildBrokerFigure(rng, suitColor);   // wide low head, stooped torso
    case 'scientist': return buildArchivistFigure(rng, suitColor); // faceted head, emissive core, no face
    case 'warrior':   return buildHullbornFigure(rng, suitColor);  // angular pauldrons, jutting jaw silhouette
    case 'raider':    return buildEnforcerFigure(rng, suitColor);  // masked, asymmetric plating
    default:          return buildFigure(rng, suitColor);          // existing generic fallback — unchanged
  }
}
```

`NPCCrowd` (`npcs.js:129`) swaps its one `buildFigure(rng.fork('fig'+i), factionColor)` call for `buildRaceFigure(rng.fork('fig'+i), RACES[faction], factionColor)` — a one-line integration point.

### 10.4.3 Dialogue graph schema

```js
// a dialogue graph: Map<nodeId, DialogueNode>
{
  entry: (ctx) => 'intro',          // returns the starting node id, condition-aware
  nodes: {
    intro: {
      speakerRace: 'meridian',
      text: (ctx) => `Manifest and credit line, ${ctx.player.name} — in that order.`,
      choices: [
        { id: 'ask_missions', label: 'Any work going?',
          effects: [{ type: 'gotoNode', node: 'missions' }] },
        { id: 'ask_language', label: 'Teach me a word. (200 ⌾)',
          condition: (ctx) => ctx.lumens >= 200 && ctx.language.fraction(ctx.race.lexiconId) < 1,
          effects: [
            { type: 'spendLumens', amount: 200 },
            { type: 'learnWord', dictionary: ctx.race.lexiconId },
            { type: 'gotoNode', node: 'taught' },
          ] },
        { id: 'insult', label: '[Aggressive] Your prices are theft.',
          effects: [
            { type: 'repDelta', faction: 'meridian', amount: -8 },
            { type: 'gotoNode', node: 'insulted' },
          ] },
        { id: 'leave', label: '[End conversation]', effects: [{ type: 'end' }] },
      ],
    },
    insulted: { text: () => 'The Combine remembers ledgers, not apologies.',
      choices: [{ id: 'leave', label: '[Leave]', effects: [{ type: 'end' }] }] },
    // ...
  },
}
```

Runner + effect registry (reusable by NPC talk, monolith quizzes, and story beats alike):

```js
// src/gameplay/dialogue.js — NEW
export class DialogueRunner {
  constructor(gs, language, quests, graphs) { this.gs = gs; this.language = language; this.quests = quests; this.graphs = graphs; this.state = null; }

  start(npc, graphId) {
    const graph = this.graphs[graphId];
    const ctx = this._ctx(npc);
    this.state = { npc, graphId, nodeId: graph.entry(ctx) };
    events.emit('dialogue:node', { graphId, nodeId: this.state.nodeId }); // headless-testable hook
    return this.present();
  }

  present() {
    if (!this.state) return null;
    const node = this.graphs[this.state.graphId].nodes[this.state.nodeId];
    const ctx = this._ctx(this.state.npc);
    const text = typeof node.text === 'function' ? node.text(ctx) : node.text;
    const choices = node.choices.filter((c) => !c.condition || c.condition(ctx));
    return { text: this.language.glossFor(text, RACES[this.state.npc.faction]?.lexiconId), choices };
  }

  choose(choiceId) {
    const node = this.graphs[this.state.graphId].nodes[this.state.nodeId];
    const choice = node.choices.find((c) => c.id === choiceId);
    for (const eff of choice.effects) this._apply(eff);
    events.emit('dialogue:choice', { choiceId, effects: choice.effects });
    return this.present();
  }

  _ctx(npc) {
    return { player: this.gs, lumens: this.gs.lumens, race: RACES[npc.faction],
      rep: this.gs.quests.reputation, language: this.language,
      flags: (this.gs.dialogueFlags ??= {}), npc };
  }

  _apply(eff) {
    switch (eff.type) {
      case 'gotoNode':    this.state.nodeId = eff.node; break;
      case 'end':          events.emit('dialogue:node', { graphId: null, nodeId: null }); this.state = null; break;
      case 'repDelta':     this.gs.quests.reputation[eff.faction] = (this.gs.quests.reputation[eff.faction] ?? 0) + eff.amount; break;
      case 'spendLumens':  this.gs.addLumens(-eff.amount); break;
      case 'addItem':      this.gs.addItem(eff.id, eff.qty); break;
      case 'learnWord':    this.language.learnFrom(eff.dictionary); break;
      case 'setFlag':      this.gs.dialogueFlags[eff.flag] = true; break;
      case 'questStart':   this.quests.startNamed(eff.questId); break;
      default: break;
    }
  }
}
```

The dialogue UI reuses `QuestUI.showLore()`'s modal chrome (`ui/questui.js:58-80`) but renders `node.choices` as numbered buttons carrying `data-choice-id` attributes (mirroring `missionboard.js`'s `data-tab` pattern, `ui/missionboard.js:37-38`) — this is what makes criterion 1 in §10.7 headlessly clickable.

### 10.4.4 Expanded language dictionary data model

```js
// src/gameplay/language.js — extend, don't replace
export const DICTIONARIES = {
  luminel:     { name: 'Luminel',     speakers: [],           words: LEXICON },        // existing 96 words, unchanged
  ledgerspeak: { name: 'Ledgerspeak', speakers: ['meridian'], words: [ /* ~40 commerce-flavored pairs */ ] },
  glasstongue: { name: 'Glass-tongue',speakers: ['chorale'],  words: [ /* ~40 liturgical pairs */ ] },
  kinhold:     { name: 'Kinhold',     speakers: ['sunward'],  words: [ /* ~40 craft/kin pairs */ ] },
  ashcant:     { name: 'Ashcant',     speakers: ['ashen'],    words: [ /* ~30 blunt/threat pairs */ ] },
};

export class Language {
  constructor(gs) { this.gs = gs; gs.language ??= { known: {} }; /* known: { [dictId]: string[] } — was a flat array */ }

  knownIn(dictId) { return new Set(this.gs.language.known[dictId] ?? []); }

  /** teacher-directed (monolith/NPC) OR random-next (existing stone behavior, dictId='luminel') */
  learnFrom(dictId, word = null) {
    const known = this.knownIn(dictId);
    const pool = DICTIONARIES[dictId].words.filter(([lum]) => !known.has(lum));
    if (!pool.length) return null;
    const [lum, en] = word ? pool.find(([l]) => l === word) : pickDeterministic(pool, this.gs, dictId);
    (this.gs.language.known[dictId] ??= []).push(lum);
    events.emit('notify', { text: `${DICTIONARIES[dictId].name.toUpperCase()} WORD LEARNED — '${lum.toUpperCase()}' means "${en}"`, tone: 'good' });
    return { luminel: lum, english: en, dictId };
  }

  fraction(dictId) { const d = DICTIONARIES[dictId]; return this.knownIn(dictId).size / d.words.length; }

  /** dictId-aware version of the existing gloss() — same substitution algorithm, scoped dictionary */
  glossFor(text, dictId) { /* identical logic to language.js:72-91, parameterized by DICTIONARIES[dictId] */ }
}
```

Save-schema migration note: `gs.language.known` moves from `string[]` (flat) to `{ [dictId]: string[] }`. A one-time migration on load (`known.luminel = oldArray; delete legacy shape`) keeps existing saves valid — the same discipline other volumes' save-schema sections call for.

**New learn-source table:**

| Source | New/existing | Behavior |
|---|---|---|
| Knowledge stone (touch) | existing (`knowledgestone.js`) | unchanged: one-shot, sequential, Luminel only |
| Monolith (quiz) | **new** `render/monolith.js` | presents a `DialogueRunner` node with a lore riddle choice; correct → `learnFrom(dictId)` + relic item; wrong → retry with a hint choice |
| Plaque | **new** `render/plaque.js` | single-paragraph micro-lore via `glossFor()`, teaches nothing — pure atmosphere, cheap to add in volume |
| NPC "teach me a word" | dialogue-graph choice (§10.4.3) | costs lumens/items, race-appropriate dictionary |
| Alphabet stone | **new**, rare | reveals a whole `THINGS`/`WE_DID`-style grammatical bank at once (flavor-only shortcut) |

### 10.4.5 Main-story framework beyond the 6-beat chain

Keep `VESPER_BEATS` exactly as-is (it is a good spine) and wrap it in a `STORY_ARCS` registry that adds parallel, reputation-gated branch arcs sharing the dialogue-effect engine:

```js
// src/gameplay/quests.js — extend
export const STORY_ARCS = {
  vesper: { requires: () => true, beats: VESPER_BEATS },   // unchanged spine
  choir_silence: {
    requires: (gs) => gs.quests.reputation.chorale >= 150,
    beats: [
      { id: 'cs1', title: 'The Choir Asks', text: '...',
        choice: { // same shape as a dialogue node's choices — same interpreter
          prompt: 'The Choir wants the Ashen raid on Vessport silenced with words, not weapons.',
          options: [
            { label: 'Broker peace (Chorale +30, Sunward -10)', effects: [{ type: 'repDelta', faction: 'chorale', amount: 30 }, { type: 'repDelta', faction: 'sunward', amount: -10 }, { type: 'setFlag', flag: 'cs_peace' }] },
            { label: 'Tell the Kin to burn them out (Sunward +30, Chorale -10)', effects: [{ type: 'repDelta', faction: 'sunward', amount: 30 }, { type: 'repDelta', faction: 'chorale', amount: -10 }, { type: 'setFlag', flag: 'cs_burn' }] },
          ],
        } },
      // 3-5 more beats, gated on gs.dialogueFlags.cs_peace / cs_burn to diverge closing text
    ],
  },
  kin_reckoning: { requires: (gs) => gs.quests.reputation.sunward >= 150, beats: [ /* ... */ ] },
};
```

A binary story choice reuses the *same* `effects`/`condition` shape as a dialogue-node choice (§10.4.3) — one interpreter, three call sites (NPC talk, monolith quiz, story beat). This is the single most important architectural decision in this volume: it keeps the eventual content bill (§10.6) additive rather than multiplicative.

### 10.4.6 Procedural mission generator (v2 template model)

```js
// generalized mission template
{
  id, kind, faction, giverNpcId,
  title, desc,                       // desc becomes NPC-voiced flavor pulled from a per-kind/per-faction bank
  difficulty: 1-5,                   // derived from rep tier + ship class at roll time
  need, have, event, filterId, filterKind, target,
  reward: { lumens, items, rep, unlocksMissionId: null },
  expiresAtWarp: number | null,      // null = no expiry (matches current behavior)
  chain: { next: 'templateId', afterCompletions: 1 } | null,
}

function rollMission(tpl, rng, ctx) {
  const difficulty = clamp(1 + Math.floor(repTier(ctx.rep[tpl.faction]).tierIndex * 0.6), 1, 5);
  const distanceMult = 1 + 0.15 * (ctx.hopsFromHome ?? 0);
  const m = tpl.make(rng, ctx, difficulty);
  m.reward.lumens = Math.round(m.reward.lumens * distanceMult * (1 + 0.08 * (difficulty - 1)));
  m.difficulty = difficulty;
  return m;
}
```

Guild-rank ladder: extend `repTier()` (`quests.js:98-104`) so each tier also unlocks a mission `difficulty` ceiling and the **LUMINARY** tier grants a one-time capstone reward (unique cosmetic/ship part id) per faction — mirroring NMS's Mission-Agent rank ladder without inventing a new currency.

### 10.4.7 Module/file plan

| File | Change |
|---|---|
| `src/universe/races.js` | **new** — `RACES` table, personality/gift/silhouette/lexicon data |
| `src/gameplay/dialogue.js` | **new** — `DialogueRunner`, effect registry |
| `src/content/dialogue/{meridian,chorale,sunward,ashen}.js` | **new** — per-race graph banks (broker/archivist/hullborn/enforcer roles) |
| `src/ui/dialogueui.js` | **new** — choice-list overlay, `data-choice-id`-tagged buttons, built on `questui.js`'s modal chrome |
| `src/gameplay/language.js` | **modify** — multi-dictionary `DICTIONARIES`, `learnFrom(dictId)`, `glossFor(text, dictId)`; migrate `gs.language.known` shape |
| `src/render/racefigures.js` | **new** — `buildRaceFigure()`, split from `npcs.js:buildFigure()` |
| `src/gameplay/npcs.js` | **modify** — `NPCCrowd` assigns `npc.dialogueGraphId`, opens `DialogueRunner` on interact instead of a static line; wander/animation code untouched |
| `src/gameplay/quests.js` | **modify** — `STORY_ARCS` wraps `VESPER_BEATS`; `MissionGenerator` class replaces flat `BOARD_TEMPLATES` iteration; explicit decision + wiring for Ashen (reputation track + raid-themed board kind, or documented combat-only exclusion) |
| `src/render/monolith.js`, `src/render/plaque.js`, `src/render/travellergrave.js` | **new** — lore-artifact prop family alongside existing `knowledgestone.js` |
| `src/render/stationinterior.js` | **modify** — add a settlement/anomaly hall variant (minimum: a distinct "guild envoy" desk interactable) |
| `src/ui/questui.js` | **modify** — extend the lore modal to optionally host a monolith quiz via `DialogueRunner` |

---

## 10.5 Phases

1. **Dialogue engine + UI (foundation, no new content).** Ship `DialogueRunner`, `dialogueui.js`, wire exactly one test NPC through it end-to-end. Existing `NPCCrowd`/`_talk()` behavior remains the fallback for any NPC without a graph.
2. **Race data + language expansion.** `RACES` table, `DICTIONARIES` (4 new ~40-word per-faction dictionaries), `learnFrom`/`glossFor`; migrate `knowledgestone.js` to pick a dictionary by the nearest station's faction instead of always Luminel.
3. **Race silhouettes (Option A, procedural).** `buildRaceFigure()` archetype branches; ship before any authored-asset decision is made.
4. **Dialogue content.** Author per-faction dialogue banks (broker/archivist/hullborn/enforcer) with teach/gift/insult/mission branches; the Mission Agent role becomes a dialogue-negotiated offer rather than a bare terminal list (the terminal UI becomes the mission *log*, not the *offer*).
5. **Story arcs.** Wrap `VESPER_BEATS` in `STORY_ARCS`; ship 2 branch arcs (`choir_silence`, `kin_reckoning`) each with one binary choice node and divergent closing beats.
6. **Mission generator v2.** Difficulty/distance scaling, expiry, chaining, guild-rank capstone rewards; resolve the Ashen decision.
7. **Lore-artifact variety.** Monolith quiz prop, plaque prop, rare Traveller-grave-equivalent prop.
8. **Authored face kit (optional, gated on a product decision — Option B).** Only if the zero-asset rule is explicitly relaxed; otherwise Phase 3's stylized silhouettes remain the shipped ceiling.

Phases 1–3 are prerequisites for 4–7; phases 4–7 are independent of each other and can run in parallel across a small team.

---

## 10.6 Effort & risk

| Phase | Engineering | Narrative writing | Notes |
|---|--:|--:|---|
| 1. Dialogue engine + UI | 2 wk | — | Pure plumbing; reuses `questui.js` chrome |
| 2. Race data + lexicons | 1.5 wk | 1.5 wk | 4 dictionaries × ~40 words + 4 race personality write-ups |
| 3. Stylized race silhouettes | 2 wk | — | Procedural "art-by-code"; genuinely fiddly, budget contingency |
| 4. Dialogue content | 2 wk | 4–6 wk | **The real bottleneck.** Dozens of nodes × 4 factions × role variety; content volume, not code, drives this line |
| 5. Story arcs (2 branches) | 1.5 wk | 3 wk | Beat text + one meaningfully divergent choice per arc |
| 6. Mission generator v2 | 2 wk | — | Scaling math, expiry, chaining, capstones |
| 7. Lore-artifact variety | 1.5 wk | 1 wk | New prop types + quiz riddle bank |
| 8. Authored face kit (optional) | 0.5 wk (integration) | — | **Not** an engineer-week line — external 3D-art time, ~1–2 modeler-weeks for ~15–20 low-poly parts, or a generative-3D tool pass |
| **Total (Phases 1–7, core scope)** | **~12.5 wk** | **~9.5–11.5 wk** | ≈ 5–6 calendar months at 1 engineer + 1 writer in parallel; compressible with a second engineer on Phases 3/6/7 |

**Key risks:**

- **Content debt is the dominant risk, not code.** The dialogue-graph engine (Phase 1) is a week of solid engineering; *filling* it with dozens of consequential, race-voiced branches (Phase 4) is where the real cost lives — treat writing as a tracked, staffed workstream, not a byproduct of engineering time.
- **The zero-asset silhouette ceiling is real and should be named, not hidden.** Stylized procedural geometry (Option A) differentiates races by *shape language* only; it will never read as "this is specifically a Gek" the way an authored head does. If "races the player can visually identify at a glance, the way NMS players instantly recognize a Gek merchant" is a hard requirement, Option B (a small authored kit) is the only path — this should be an explicit, named product decision, not something the engineering plan quietly assumes away. This finding is consistent with — and should be read alongside — Volume 16's broader recommendation on where the zero-asset rule must bend.
- **Determinism must be preserved.** Every new roll (mission difficulty, dialogue-quiz answer randomization, alphabet-stone selection) must go through the existing `RNG(seed)` pattern (`core/rng.js`), never `Math.random()`, to keep same-seed reproducibility — the one exception already in the codebase, `npc.wait` re-roll in `npcs.js:175` (`Math.random()`), is flagged there as "harmless non-determinism" for a cosmetic idle timer and should not be treated as precedent for anything reward- or story-bearing.
- **Save-schema growth needs versioned migration.** `gs.language.known` (array → per-dictionary map), `gs.dialogueFlags` (new), and `gs.quests.storyArcs` (new) are all additive but require a load-time migration guard, matching the discipline the rest of the codebase already applies to `gs.quests` field initialization (`quests.js:178-186`, the `??=` pattern).
- **Design for headless testability from the start.** `data-choice-id` attributes on dialogue buttons and `data-tab` on mission-board tabs (already present, `missionboard.js:37-38`) are what make Playwright-driven acceptance testing possible — bake this convention into `dialogueui.js` from Phase 1, not retrofitted later.

---

## 10.7 Acceptance criteria (headless-verifiable)

1. **A dialogue choice branches & applies effects.** Boot to `HangarState`, approach a `meridian`-faction NPC, call `DialogueRunner.start(npc, 'meridian')`, then `.choose('insult')`. Assert: `gs.quests.reputation.meridian` decreased by exactly the configured delta (−8); the emitted `dialogue:node` event's `nodeId` changed to `'insulted'`; a second `.choose('leave')` sets `DialogueRunner.state` to `null` and emits `dialogue:node` with `nodeId: null`.

2. **Learning a word reveals it in later text.** Take a fixed lore string containing a word present in `DICTIONARIES.ledgerspeak`. Call `language.glossFor(text, 'ledgerspeak')` before learning — assert the output contains a `<span class="lum-unknown">` wrapping the alien form. Call `language.learnFrom('ledgerspeak', <that word>)`. Call `glossFor()` again on the *same* text — assert the span is gone and the English word appears in plain text. Repeat for a second, unrelated lore string never seen before — assert the same learned word is *also* revealed there (proving the effect is vocabulary-state-driven, not text-instance-cached).

3. **A generated mission completes & grants standing.** Call `boardMissionsFor(system, gs, galaxy)` (or `MissionGenerator.roll(...)` post-refactor) with a fixed seed, extract a `courier` mission. `quests.acceptBoard(m)`. Satisfy its `need` via `gs.addItem(m.filterId, m.need)`. Call `quests.claimCourier(m)`. Assert: `gs.quests.reputation[m.faction]` increased by exactly `m.reward.rep`; `gs.lumens` increased by `m.reward.lumens`; the mission id is removed from `gs.quests.board` and present in `gs.quests.completedBoard`; the same seed run twice from a fresh `gameState` produces byte-identical mission offers (determinism regression guard).

4. **A story-arc binary choice persists across save/load.** Force `gs.quests.reputation.chorale = 200`, trigger `STORY_ARCS.choir_silence`'s first beat, choose the "broker peace" option. Assert `gs.dialogueFlags.cs_peace === true` and `cs_burn` is unset. Serialize `gameState` to JSON and reconstruct a fresh `gameState` from it (the project's existing save round-trip path); assert the flag survives and that re-presenting the same beat node does *not* re-offer the already-resolved choice (idempotent on replay, matching NMS's "conversation doesn't repeat" convention).

5. **Race dialogue banks are genuinely distinct, not palette-swapped copies.** Assert `content/dialogue/meridian.js`'s graph node text templates reference `race.lexiconId === 'ledgerspeak'` and `content/dialogue/sunward.js`'s reference `'kinhold'` — a regression guard against accidentally wiring every faction to the same generic bank, the exact failure mode this volume documents in the *current* build (§10.2).

6. **Zero-asset silhouette differentiation is visually real, not just data-real.** Headless render `buildRaceFigure(rng, RACES.meridian, color)` and `buildRaceFigure(rng, RACES.sunward, color)` at the same seed/scale; assert their bounding-box aspect ratios and vertex-position hashes differ beyond palette (a coarse but effective guard that Option A's "shape language" differentiation didn't silently degrade back into `buildFigure()`'s single universal rig).
