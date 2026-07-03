# Volume 5 — Flora, Fauna & Unlimited Procedural Life

**Scope:** everything the player scans, is chased by, feeds, rides, hatches, or picks. Source examined: `src/gameplay/creatures.js` (367 lines — population + AI), `src/render/creature.js` (826 lines — procedural mesh assembler), `src/render/flora.js` (765 lines — instanced vegetation), `src/gameplay/scanner.js` (210 lines — scan/catalog), `src/universe/biomes.js` (531 lines — per-biome density/roster bias), `src/gameplay/state.js` (discovery ledger). Executive-summary score: **2/10**. This volume explains why, and specifies the target system.

The headline finding, stated up front because it disciplines everything that follows: **AllMansSky has zero authored art, and No Man's Sky's "unlimited species" is not procedural generation from nothing — it is procedural *recombination* of a finite, hand-authored library of skeletons and body parts.** Our zero-asset rule is the reason our creatures read as "cute low-poly toys" rather than "alien animals": every silhouette is built live from primitive capsules/spheres/cones assembled by a JS function, with no skeleton, no skinning, and no part library to draw from. Section 5.4 confronts this directly and recommends where the rule must bend.

---

## 5.1 What No Man's Sky does

### 5.1.1 The part-assembly pipeline
NMS fauna and flora are not meshes generated from mathematical noise at runtime. They are **seed-driven recombinations of authored content**:

- A **skeleton library** — a fixed set of rigs per body class (biped, quadruped, hexapod/multi-leg, serpentine, avian/flyer, aquatic, "fantastical" hybrids) — each with a bone hierarchy, joint limits, and named attachment sockets (head, neck, spine segments, fore-limb pair, hind-limb pair, tail root, wing root, fin root).
- An **authored part library** per socket: dozens of head sculpts (beaked, horned, tusked, multi-eyed, antlered…), torso/thorax shapes, limb-pair meshes (digitigrade, plantigrade, hooved, clawed, tentacled), tails, wings, fins, dorsal ornaments (spines, sails, plating). Every part is modeled once by an artist, rigged to the parent skeleton's bone convention, and includes an LOD chain.
- At spawn time the generator: (1) picks a skeleton compatible with the target habitat (land/air/water) and diet-driven size class; (2) for each socket, picks a compatible part weighted by biome "weirdness"/exotic sliders; (3) applies a **continuous scale/proportion randomization** per bone (limb length, torso girth, head size) so two creatures using identical parts still read as visually distinct individuals; (4) generates a **texture/pattern/palette** — base coat, pattern (spots/stripes/scutes/bioluminescent seams), and color ramp keyed to the planet's flora/atmosphere palette so fauna visually belongs to its world; (5) bakes a skinned mesh with the standard bone-weighted rig, ready for the shared animation set.
- "Unlimited" is therefore combinatorial, not infinite in a literal sense: N skeletons × M compatible parts per socket × continuous scale × continuous palette produces a space large enough that two players essentially never see the same creature twice, while every individual is still built from a bounded, quality-controlled content set. This is the actual trick, and it's the one AllMansSky needs to copy.

### 5.1.2 Genus/species taxonomy & trait vectors
Every scanned creature resolves to a binomial name (`Genus speciesepithet`) plus a stat sheet recorded in the Discoveries catalog:

| Trait | Values / role |
|---|---|
| Genus | Groups individuals of the same generated "species" across a planet and across re-visits — the genus/species pairing is stable for a given creature archetype, not re-rolled per individual |
| Diet | Carnivore / Herbivore / Omnivore-ish tiers, each with a feeding-behavior implication |
| Size class | Small / Medium / Large / Very Large — gates ride-ability and threat level |
| Temperament | Passive / Skittish / Aggressive (predator) |
| Behavior tags | Herd, Predator, Farmable (produces resource on interaction), Aggressive-if-provoked |
| Activity period | Diurnal / Nocturnal — shifts spawn/behavior with the day-night cycle |
| Rarity tier | Common → Uncommon → Rare → Exotic → (per-planet) Unique — drives Units/nanite payout on upload |
| Flavor "notes" | 1–2 generated sentences of pseudo-scientific color text, unique per discovery |

### 5.1.3 Ecology
- **Herding/flocking**: herbivores move as loose herds/flocks with separation-cohesion-alignment (boids-style) steering; grazing creatures wander together and share a flee response.
- **Predator-prey**: "Predator"-tagged fauna actively hunt smaller herbivore fauna on the same planet — a real chase-and-kill loop the player can witness or interrupt.
- **Fleeing**: skittish/passive creatures break and run when the player (or a predator) closes within a threat radius; herd members flee together.
- **Territorial aggression**: some species charge and attack the player on approach, with a windup/attack/cooldown loop and knockback.
- **Feeding**: the player throws or drops a specific bait item (hinted by the analysis visor — "creature favors X"); correct bait triggers a positive reaction animation, sometimes yields a bonus resource pickup ("milk"/mildew-style secretions), and increments a trust counter.
- **Taming**: repeated correct feeding flips a creature to a tamed state — it stops fleeing/fighting, can be interacted with freely, and becomes eligible for adoption.
- **Riding**: sufficiently large tamed (or specifically "rideable" tagged) creatures can be mounted; the player controller swaps to a mount-traversal mode with its own speed/turn/jump feel, useful for fast overland travel.
- **Breeding via eggs**: certain tamed/discovered species yield eggs; eggs go through an **egg-sequencing** minigame/incubation step that lets the player nudge trait mutations (coat pattern, secondary traits) before hatching a companion whose genome is derived from the parent species plus the chosen mutations.
- **Companion pets**: hatched or adopted creatures become persistent companions with genes/traits (inherited + mutated), a growth stage (juvenile → adult), and a small command set (follow, dig for resources, hunt, sit); companions accompany the player across planets and remember trained commands.

### 5.1.4 Fauna categories
Land walkers, flying fauna (birds/insectoids with true flight loops and flock behavior), aquatic swimmers (fish schools and larger sea creatures in oceans/lakes with swim-specific animation and buoyancy), cave/underground-exclusive fauna (a distinct roster that only spawns in subterranean biome pockets, part of the cave/voxel pass), and rare/exotic/mechanical variants (robotic "drone" fauna on Sentinel-heavy or corrupted worlds, and fully "Desolate" planets with zero fauna by design). Each planet rolls a **fauna roster** — the set of genus/species that can appear there — constrained by the planet's flora/fauna sliders and habitat mix (land vs. water vs. air vs. cave), not a single undifferentiated pool.

### 5.1.5 Flora
Trees/canopy flora, low scrub, exotic alien flora (bioluminescent, crystalline, fungal), **hazardous flora** (explosive/spore pods and stinging plants that damage the player on contact or proximity), and **resource plants** — biome-specific harvestables that yield a resource matched to that species (not a single universal resource token), hinted the same way fauna bait is hinted. Distribution is biome-appropriate and density-slider-driven, and rare flora is individually discoverable/name-able exactly like fauna.

### 5.1.6 The discovery loop
Analysis visor reticle over a creature/plant → hold to scan → catalog entry generated (genus/species name, traits, notes) → player may **rename** it before committing → **upload** to the network for Units + a small nanite trickle → scanning every distinct species on a planet triggers a **100% zoology completion** bonus (bonus currency, and — if first to fully catalog that planet — the player's name is attached to the planet/system discovery record). Discoveries persist in a per-save Discoveries app and (in the live game) sync to a shared universe-wide database so other explorers see who found a species first.

### 5.1.7 Procedural animation rigs
Walk/run/idle/eat/attack/swim/fly are a **shared animation set per body class**, applied via standard bone-weighted skinning to whatever part combination was selected — the same walk cycle animates a beaked quadruped and a tusked quadruped identically because they share a skeleton, with IK-adjusted foot placement so gait reads correctly regardless of limb-length randomization.

---

## 5.2 What we have (cite source)

`src/render/creature.js` — `buildCreature(seed, biome, opts)` is a from-scratch procedural mesh assembler, not a part-recombination system. It has **6 hard-coded body plans** (`BODY_TYPES = ['quadruped', 'hopper', 'hexapod', 'serpent', 'floater', 'flyer']`), selected per-biome via `TYPE_WEIGHTS` (e.g. `desert: { hexapod: 3.0, serpent: 2.6, hopper: 2.6 }`). Each body plan has its own hand-written builder function (`buildQuadruped`, `buildHopper`, `buildHexapod`, `buildSerpent`, `buildFloater`, `buildFlyer`, registered in the `BUILDERS` map) that procedurally constructs primitive-geometry parts (`capsule()`, `sphere()`, `cone()`) at seed-randomized dimensions via helpers `makeLeg` (a two-segment `THREE.Group` hip/knee hierarchy, not a skinned bone), `makeHead` (variant ∈ `beaked|horned|bulbous|antlered`), `makeTail` (tapering pivot chain), `makeBackFeature` (`spines|plates|fin`), and `makeWingGeometry` (a procedurally-shaped flat `THREE.Shape`). There is **no skeleton and no skinning** anywhere — "gait" is per-part `Object3D.rotation` animation driven by sine functions of a gait clock, returned as an `animate(T, TI, m, dt)` closure per body-builder (e.g. `buildQuadruped`'s closure drives `L.hip.rotation.x`/`L.knee.rotation.x` per leg with a fixed trot phase table `[0, Math.PI, Math.PI, 0]`).

Coloring is genuinely good procedural work worth keeping: `paintCreature()` bakes per-vertex color from a belly→back gradient plus a seeded `stripes|spots|none` pattern via `SimplexNoise`, keyed to an 11-entry `BIOME_STYLE` palette table (hue window, saturation window, accent hue, glow-eye probability per biome). Size (`TYPE_DIMS[bodyType].size` range), speed (`dims.speed(size)`), diet (`DIETS[bodyType]`, e.g. hexapod ∈ `insectivore|lithovore|scavenger`), and temperament (`docile|skittish|territorial`, rolled from diet+size in `buildCreature`) are assembled into a flat `profile` object returned alongside the mesh. Naming is `latinName(rng.fork('name'))` — a **self-contained syllable generator** (`SYL_A`/`SYL_B`/`END_G`/`END_S` tables) producing a binomial purely for flavor; it is explicitly *not* coupled to any genus/species registry (file header: "Self-contained latin-ish binomial generator (no lore.js coupling)"). Critically, the name is derived from the individual creature's own seed (`rng.fork('name')` inside `buildCreature`), so **every individual spawn is its own unique "species"** — there is no concept of two creatures belonging to the same genus/species at all.

`src/gameplay/creatures.js` — `CreatureSystem` is a competent lightweight population + AI layer: deterministic per-64m-cell herds (`_cellSpecs` via `field.cellRng(cx, cz, 'fauna')`, 1–3 individuals, reproducible on revisit), a spawn/despawn ring (`SPAWN_R=300`, `DESPAWN_R=400`, `MAX_ACTIVE=12`, scanned every `SCAN_INTERVAL=0.7s`), and a **7-state AI machine** (`idle`/`wander`/`flee`/`circle`/`drift`/`fly`/`landing`) driven in `_think()`. Threat response is real but simple: `temperament === 'skittish'` triggers `flee` inside a size-scaled radius (`9 + size*3.5`); `temperament === 'territorial'` triggers `circle` (an orbit-and-prowl behavior around the player, not an attack) inside a larger radius. Movement (`_move()`) does correct terrain-sticking (`field.height`), refuses to walk into the sea, and slope-tilts the body from `field.normal`. `scanNearest(pos, range)` exposes the closest creature to the scanner. There is **no herd cohesion** (each individual in a "herd" spawn group runs its own independent AI with no awareness of herd-mates), **no predator-prey interaction** (creature-vs-creature AI does not exist — only creature-vs-player), and **no needs model** (no hunger/energy driving behavior).

`src/render/flora.js` — `FloraSystem` streams **2–4 hand-written archetypes per biome** (e.g. lush: `canopyA`, `canopyB`, `fern`, `bush`; desert: `saguaro`, `barrel`, `dryshrub`) via `buildArchetypes(def, kit, rng)`, each archetype a merged static geometry rendered through one `THREE.InstancedMesh` (cap `ARCH_CAP=3000`). Placement is deterministic per 64m cell (`field.cellRng(cx, cz, 'flora')`), density- and moisture-scaled (`_genCell`). This is not species diversity, it is **a fixed small archetype set per biome with continuous scale/rotation/shade jitter per instance** — genuinely closer to "decoration" than "unlimited flora." Harvestable archetypes are flagged `collect: <itemId>`; grepping the file shows **every single harvestable archetype across all 11 biomes sets `collect: 'carbyne'`** — saguaro, reeds, frostscrub, emberpod, sporesac, blightshrub, cryshard, shoregrass, deadscrub all yield the identical generic resource token regardless of species or biome. There is no hazardous flora (no damage-on-touch plant), and no per-species resource identity.

`src/gameplay/scanner.js` — `Scanner.scan()` fires a one-shot expanding ring (`COOLDOWN=6s`, `PULSE_RADIUS=350`) and, after a 900ms delay, `_collect()` catalogs world props plus **the single nearest creature** (`surface.creatures.scanNearest(pos, CREATURE_RANGE=120)`) into a 5-minute marker list. On creature scan it calls `gs.discover('creatures', key, creature.name, 90)` where `key = ${planetId}:${creature.name}` — since the name is per-individual (see above), this means **discovery keys are effectively per-individual, not per-species**: scanning two different individuals spawned from different seeds anywhere always creates two separate catalog entries, even if they are visually identical body-plan/biome combinations. Flora is worse: `_collect()` calls `gs.discover('flora', ${planetId}:flora, ${planetName} flora, 45)` **once per planet regardless of archetype count** — there is no per-species flora discovery at all, just one blanket "this planet has flora" entry. There is no analysis-visor UI, no player renaming step, no explicit "upload" action (discovery and reward are the same atomic call), and no 100%-zoology-completion bonus logic anywhere.

`src/gameplay/state.js` — `GameState.discoveries = { systems, planets, creatures, flora, ruins }`, each a flat `{key: {name, at}}` dictionary; `discover(kind, key, name, value)` awards `value` Lumens exactly once per key. No stored trait sheet (diet/size/temperament/notes), no genus field, no rarity tier, no completion tracking, no separation between "scanned" and "uploaded" states.

`src/universe/biomes.js` provides `floraDensity`/`faunaDensity` ranges per biome and feeds `TYPE_WEIGHTS`/biome palettes in `creature.js`, but there is **no explicit per-biome fauna roster** (list of allowed genus/species) — every biome draws from the same universal 6-body-plan pool, just reweighted, and there is no habitat partition beyond `bodyType` (`flyer`/`floater` fly/drift; the rest walk). There is no aquatic swimming body type, no cave/underground roster (no caves exist at all — see Volume 3), and no mechanical/exotic creature category.

---

## 5.3 The gap

| # | Gap | Severity | Effort |
|---|---|:--:|:--:|
| 1 | No authored part+skeleton library — creatures assembled from raw primitives, not recombined parts | **[Structural]** | XL |
| 2 | No skeleton/skinning — limbs are nested `Object3D` groups, not bone-weighted meshes; caps animation quality and blend-tree reuse | **[Structural]** | L |
| 3 | No genus/species taxonomy — every individual spawn is its own unique "species"; no stable genus grouping across individuals or revisits | **[Structural]** | M |
| 4 | No trait vector beyond `{size, speed, temperament, diet, name, bodyType}` — missing rarity tier, activity period, behavior tags, "notes" flavor text | **[Feature]** | S |
| 5 | No herd cohesion — spawned "herds" are independent AI agents with no awareness of herd-mates (no boids separation/cohesion/alignment) | **[Feature]** | M |
| 6 | No predator-prey AI — creature-vs-creature interaction does not exist; only creature-vs-player | **[Feature]** | M |
| 7 | No needs model (hunger/energy) driving foraging/behavior | **[Feature]** | S |
| 8 | No feeding/bait mechanic (correct item → reaction → trust) | **[Feature]** | M |
| 9 | No taming state or tamed-creature persistence | **[Feature]** | M |
| 10 | No riding/mounts (controller swap, mount traversal feel) | **[Structural]** | M |
| 11 | No egg discovery, incubation, or egg-sequencing mutation minigame | **[Structural]** | L |
| 12 | No companion pet system (genes/traits inheritance, growth stages, command set, cross-planet persistence) | **[Structural]** | L |
| 13 | No aquatic swimming body type / underwater fauna AI (buoyancy, swim gait) | **[Feature]** | M |
| 14 | No cave/underground fauna roster — blocked on caves not existing at all | **[Engine]** | — (Vol. 3 dep.) |
| 15 | No rare/exotic/mechanical creature category or "Predator planet"/"Desolate planet" archetype rules | **[Feature]** | S |
| 16 | No per-biome fauna *roster* (allowed genus list) — every biome draws the same 6-body-plan pool, just reweighted | **[Feature]** | S |
| 17 | Flora: every harvestable archetype across every biome yields the identical `'carbyne'` item — no per-species resource identity | **[Feature]** | S |
| 18 | Flora: no hazardous flora (damage-on-touch/explosive pods) | **[Feature]** | S |
| 19 | Flora: only 2–4 static archetypes per biome, not species-level diversity; no per-species discovery (one blanket "planet flora" catalog entry) | **[Structural]** | M |
| 20 | Discovery loop is a single atomic auto-reward call — no analysis-visor UI, no player rename step, no separate "upload" action | **[Feature]** | S |
| 21 | No 100%-zoology-completion bonus or per-planet species-completion tracking | **[Feature]** | S |
| 22 | No day/night-linked activity period (diurnal/nocturnal) affecting spawn/behavior | **[Feature]** | S |
| 23 | Discovery keys are per-individual (`planetId:creature.name`), not per-species — re-scanning the "same" species anywhere always mints a new catalog entry | **[Structural]** | M |
| 24 | Animation is fixed sine-wave transform hacks per body-builder closure, not a reusable blend-tree (walk/run/idle/eat/attack/swim as named clips) | **[Cosmetic]/[Feature]** | M |

Effort key: **S** ≈ 1–2 eng-weeks, **M** ≈ 3–5, **L** ≈ 6–10, **XL** ≈ 10+ (see §5.6 for the rolled-up totals).

---

## 5.4 Target design

### 5.4.1 The authored-part-library recommendation (where the no-asset rule bends)

This is the load-bearing decision for the whole volume. Zero-asset purity and NMS-grade silhouette/animation quality are **mutually exclusive** — a runtime function assembling capsules and spheres cannot produce a tusked, plated, multi-eyed alien the way a rigged 40-part authored library can, no matter how clever the noise. Recommendation: **introduce a small, versioned, offline-authored part+skeleton content pack** (target: 6 skeletons × 8–10 parts per socket × 2 LODs, glTF + Draco compressed, budget ≈ 3–6 MB total), produced once (by a technical artist, or by an AI 3D-generation pipeline curated by an engineer — either way it is authored *once*, checked into the repo, and never regenerated at runtime), and then:

- **Recombination stays fully procedural and seed-deterministic** — which parts, which proportions, which palette — so the "unlimited species" claim is honest in the same combinatorial sense NMS's is (see §5.1.1: NMS is not infinite either, it is *combinatorially huge from a finite authored set*).
- **The existing procedural vertex-paint pipeline (`paintCreature()`, `BIOME_STYLE`) is genuinely good and should be preserved as-is**, just retargeted to skin the new authored meshes instead of the primitive ones — this is the one piece of the current system that is already at a defensible fraction of NMS quality.
- **Skeletal animation becomes a real subsystem**: authored skeletons ship with a small shared clip library (walk/run/idle/eat/attack/flee/swim/fly) authored once per body class and retargeted by bone-name convention across all parts using that skeleton (three.js supports `SkinnedMesh` + `AnimationMixer` natively — this is not an engine-tier blocker like Volume 2/3's cube-sphere/voxel work, but it is a genuinely new subsystem, hence [Structural] not [Cosmetic]).
- This is scoped deliberately small: 6 skeletons (quadruped, biped-hexapod/insectile, serpent, avian/flyer, aquatic, floater-tentacle) is enough to cover every current body plan plus the two NMS categories we're missing (aquatic, true biped), without attempting NMS's full "fantastical hybrid" breadth in v1.

### 5.4.2 Creature genome data model

```js
// src/gameplay/creatureGenome.js
/**
 * CreatureGenome — the full, serializable identity of one creature species
 * (not individual). Two calls to rollGenome() with the same seed+biome
 * always return a structurally identical genome (part IDs, trait scalars).
 */
const CreatureGenome = {
  genusId:      'u32',   // stable hash — identical for every individual of this species
  speciesEpithet: 'string', // latinName() species half, genus-stable per genusId
  skeletonId:   'string', // one of SKELETONS: quadruped|hexapod|serpent|avian|aquatic|floater
  habitat:      'string', // land|air|water|cave — gates roster placement
  parts: {                 // socket -> authored part id (from the part library manifest)
    head: 'string', torso: 'string', limbsFore: 'string', limbsHind: 'string',
    tail: 'string|null', wings: 'string|null', fins: 'string|null', dorsal: 'string|null',
  },
  traits: {
    size01: 'float',        // 0..1, mapped to skeleton's [sizeMin,sizeMax] metres
    aggression01: 'float',  // drives temperament + predator/prey role
    sociability01: 'float', // drives herd-group size + cohesion weight
    boldness01: 'float',    // flee-radius scalar (low = skittish)
  },
  diet: 'grazer|browser|frugivore|insectivore|lithovore|scavenger|predator|photovore|filter-feeder|sporivore',
  temperament: 'docile|skittish|territorial|predator', // derived from traits + diet
  rarity: 'common|uncommon|rare|exotic|unique',
  activityPeriod: 'diurnal|nocturnal|cathemeral',
  paletteSeed: 'u32',       // feeds the existing paintCreature() pipeline unchanged
  tamable: 'bool',
  rideable: 'bool',         // gated on skeletonId + size01 threshold
  baitItemId: 'string|null',// correct feed item for taming/farming
  notes: 'string[]',        // 1-2 generated flavor sentences
};
```

### 5.4.3 Generation pseudocode

```
function rollGenome(seed, biome, habitat):
    rng = RNG(hash32(seed, biome_hash, habitat_hash))
    genusRng = rng.fork('genus')          // genus stable per (biome, habitat, genus-slot)
    genusId  = hash32(seed_genus_bucket)  // see note below on genus-bucketing

    roster   = FAUNA_ROSTERS[biome][habitat]         // weighted skeleton list, §5.4.5
    skeletonId = pickWeighted(rng, roster.weights)
    skel     = SKELETON_LIBRARY[skeletonId]

    parts = {}
    for socket in skel.sockets:
        compatible = PART_LIBRARY[skeletonId][socket]         // authored options
        parts[socket] = weightedPickByBiomeAffinity(rng, compatible, biome)

    traits = {
        size01: rng.range(0,1),
        aggression01: rng.range(0,1),
        sociability01: rng.range(0,1),
        boldness01: rng.range(0,1),
    }
    diet = pickWeighted(rng, skel.dietWeights)
    temperament = deriveTemperament(diet, traits)   // same logic as current buildCreature, kept
    rarity = rollRarity(rng, biome.rarityBias)
    activityPeriod = pickWeighted(rng, ['diurnal','nocturnal','cathemeral'], [.55,.30,.15])

    genome = CreatureGenome{ genusId, skeletonId, habitat, parts, traits, diet,
                              temperament, rarity, activityPeriod,
                              paletteSeed: hash32(seed, 0xC0107),   // unchanged from today
                              tamable: rarity != 'unique' and diet != 'predator',
                              rideable: skel.rideCapable and traits.size01 > 0.6,
                              baitItemId: pickBait(diet, biome),
                              notes: generateNotes(rng, genome) }
    return genome
```

**Genus bucketing (fixes gap #23):** derive `genusId` from a *coarser* key than the individual spawn seed — e.g. `hash32(planetSeed, biomeId, skeletonId, rng.int(0, ROSTER_SLOTS-1))` where `ROSTER_SLOTS` (≈8–14) is fixed per planet at world-gen time. This means a planet has a **fixed, enumerable species roster** rolled once (like NMS), and every individual creature spawned on that planet picks one of those `ROSTER_SLOTS` genus buckets rather than rolling a fresh unique genome per spawn. This single change is what makes "two individuals of the same species" and "100% planet zoology" meaningful — it's the most important structural fix in this volume, more important than the mesh-quality work in §5.4.1.

### 5.4.4 Individual instantiation (kept close to today's shape)

```
function instantiateIndividual(genome, individualSeed):
    rng = RNG(individualSeed)
    scale = lerp(genome.skel.sizeMin, genome.skel.sizeMax, genome.traits.size01)
             * rng.range(0.92, 1.08)     // small per-individual variance, like NMS
    mesh  = assembleFromParts(genome.parts, genome.skeletonId)   // replaces buildQuadruped() etc.
    paintCreature(mesh, paletteFor(genome))                       // UNCHANGED pipeline
    rig   = bindSkeleton(mesh, SKELETON_LIBRARY[genome.skeletonId])
    return { mesh, rig, genome, scale, profile: profileFrom(genome) }
```

### 5.4.5 Per-biome/habitat fauna rosters (fixes gap #16)

```js
// src/universe/faunaRosters.js
export const FAUNA_ROSTERS = {
  lush:   { land: { weights: { quadruped: 3, hexapod: 1 } }, air: { weights: { avian: 3 } }, water: { weights: { aquatic: 2 } } },
  ocean:  { land: { weights: { hexapod: 1 } }, air: { weights: { avian: 3 } }, water: { weights: { aquatic: 4, floater: 1 } } },
  desert: { land: { weights: { hexapod: 3, serpent: 2 } }, air: { weights: { avian: 1 } }, water: null },
  // ...one row per biome; water: null means the biome has no swimmable bodies
};
```
Each planet, at world-gen time, samples a fixed **species roster** (§5.4.3's `ROSTER_SLOTS`) from its biome's habitat weights — enumerable, so the UI can show "7 / 12 species catalogued."

### 5.4.6 Ecology / behavior system

Steering is upgraded from today's single-agent heading interpolation (`_steerTo`/`_turnToward` in `creatures.js`) to boids-style group steering plus a needs-driven state machine:

```
class EcologySystem {
  update(dt, playerPos):
    for group in herds:                      // groups now first-class, not implicit
      centroid = mean(group.members.position)
      for c in group.members:
        sep  = separationForce(c, group.members, radius=2*c.size)
        coh  = (centroid - c.position) * group.cohesion * c.genome.traits.sociability01
        align= meanHeading(group.members) - c.heading
        c.steerAccum += sep*W_SEP + coh*W_COH + align*W_ALIGN

    for c in allCreatures:
      c.hunger += dt * HUNGER_RATE[c.genome.diet]
      if c.hunger > FORAGE_THRESHOLD and c.state == IDLE:
        target = nearestForageSource(c)       // flora instance for herbivores, prey for predators
        c.state = (c.genome.diet == 'predator') ? HUNTING : FORAGING

    for pred in predators:
      if pred.state == HUNTING:
        prey = nearestPreyWithinDetection(pred, allCreatures)
        if prey == null: pred.state = IDLE; continue
        steerToward(pred, prey.position)
        if distance(pred, prey) < ATTACK_RANGE: pred.state = ATTACKING
      if pred.state == ATTACKING:
        if attackResolves(pred, prey): prey.state = FLEEING_PERMANENT; killOrScareOff(prey)

    for prey in allCreatures where prey.state != FLEEING:
      threat = nearestThreat(prey, [player, ...activePredators])
      if threat and distance(prey, threat) < FLEE_RADIUS(prey):
        prey.state = FLEEING; prey.fleeFrom = threat
        for mate in prey.group.members: mate.state = FLEEING  // herd panic propagation
}
```

### 5.4.7 Behavior state machine (extends today's 7-state machine in `_think()`)

| State | Entry condition | Exit condition | New vs. today |
|---|---|---|---|
| `idle` | default / calmed down | timer, or threat detected | kept |
| `wander` | idle timer expired | reached target / timer | kept |
| `forage` | hunger > threshold, herbivore/omnivore | fed, or threat detected | **new** — needs-driven |
| `flee` | threat within `boldness01`-scaled radius | distance > 2.6×radius, timer | kept, now propagates to herd-mates |
| `circle` (territorial display) | territorial temperament, player in range | player leaves, or escalates to `attack` | kept |
| `attack` | territorial/predator + target in strike range | attack resolves or target flees out of range | **new** |
| `hunt` | predator temperament, hunger, prey detected | prey lost, caught, or hunger sated | **new** |
| `feed_react` | player offers correct bait within range | reaction anim completes | **new** — taming hook |
| `tamed_follow` | trust ≥ tame threshold | player dismisses / distance exceeded | **new** — companion hook |
| `ride` | player mounts a tamed rideable individual | player dismounts | **new** — controller-swap |
| `drift` / `fly` / `landing` | (floater/flyer specific) | — | kept |

### 5.4.8 Taming, breeding & companion subsystem

```js
// src/gameplay/taming.js — sketch
function offerBait(creature, itemId, gs) {
  if (itemId !== creature.genome.baitItemId) return { ok: false };
  creature.state = 'feed_react';
  creature.trust = Math.min(1, (creature.trust ?? 0) + TRUST_PER_FEED);
  if (creature.genome.diet !== 'predator' && creature.trust >= TAME_THRESHOLD) {
    creature.tamed = true;
    events.emit('creature:tamed', { genusId: creature.genome.genusId });
  }
  return { ok: true, resource: rollFeedBonus(creature.genome) }; // e.g. farmable "mildew" analog
}

function collectEgg(creature, gs) {
  if (!creature.tamed || creature.eggCooldown > 0) return null;
  creature.eggCooldown = EGG_COOLDOWN_S;
  return { itemId: 'creature_egg', parentGenomeId: creature.genome.genusId };
}

function hatchEgg(eggItem, mutationChoices, gs) {
  const parent = GENOME_REGISTRY.get(eggItem.parentGenomeId);
  const childGenome = mutateGenome(parent, mutationChoices); // reroll 1-3 trait/part slots
  return spawnCompanion(childGenome, gs.player.position);
}

class Companion {
  constructor(genome) { this.genome = genome; this.growth = 'juvenile'; this.commands = ['follow']; }
  issueCommand(cmd) { /* follow | dig | hunt | sit — dig triggers a flora/mineral harvest role */ }
  tick(dt) { /* growth timer -> 'adult' unlocks full command set + ride eligibility */ }
}
```
Riding reuses the existing player-controller pattern already used for the rover (`src/gameplay/rover.js`) — swap the active controller to a `MountController` that reads the same input map but drives the creature's rig instead of the player capsule, exactly the precedent NMS itself follows (mounts are "another vehicle").

### 5.4.9 Discovery / registry system

```js
// src/gameplay/discovery.js — extends state.js's flat discoveries dict
DiscoveryEntry = {
  genusId, speciesEpithet, displayName,   // displayName defaults to generated name,
                                            // overwritten if the player renames before upload
  kind: 'fauna'|'flora',
  traits: { diet, size01, temperament, activityPeriod, rarity, notes },
  scannedAt: timestamp, uploaded: bool, value: int,
};

function scanTarget(gs, target) {           // visor hold-to-scan, not instant
  const entry = draftEntryFrom(target.genome);
  gs.pendingScan = entry;                    // UI shows name-entry prompt
  return entry;
}
function commitUpload(gs, chosenName) {
  const entry = gs.pendingScan;
  entry.displayName = chosenName || entry.displayName;
  const isNew = gs.discover(entry.kind, entry.genusId, entry.displayName, entry.value);
  if (isNew) {
    gs.addLumens(entry.value);
    updateZoologyProgress(gs, currentPlanetId(gs));
  }
  gs.pendingScan = null;
}
function updateZoologyProgress(gs, planetId) {
  const roster = PLANET_ROSTERS[planetId];               // fixed at world-gen, §5.4.5
  const found = roster.filter(g => gs.discoveries.creatures[g.genusId]);
  if (found.length === roster.length && !gs.discoveries.planets[`${planetId}:100pct`]) {
    gs.discover('planets', `${planetId}:100pct`, 'Full Zoology', ZOOLOGY_BONUS);
  }
}
```
This directly fixes gaps #20, #21, #23: scanning is keyed by `genusId` (stable per species, per §5.4.3's roster bucketing) rather than per-individual name, upload is a distinct player-driven step with a rename prompt, and 100% completion is computable because the roster is now finite and enumerable per planet.

### 5.4.10 Module/file plan

| File | Role |
|---|---|
| `src/gameplay/creatureGenome.js` | `rollGenome()`, `CreatureGenome` shape, mutation for breeding |
| `src/universe/faunaRosters.js` | Per-biome/habitat skeleton weights + planet roster rolling |
| `src/render/creatureParts/manifest.js` | Authored part library index (glTF paths, socket compatibility, LOD refs) |
| `src/render/creatureRig.js` | Skeleton binding, part assembly onto bones, replaces ad-hoc `makeLeg`/`makeHead`/`makeTail` |
| `src/render/creatureAnim.js` | Shared clip library + `AnimationMixer` blend tree (walk/run/idle/eat/attack/flee/swim/fly) per skeleton class |
| `src/render/creature.js` | Slimmed to orchestration: calls genome → rig → anim → `paintCreature()` (kept) |
| `src/gameplay/ecology.js` | Herd steering, needs, predator-prey state machine (§5.4.6) |
| `src/gameplay/taming.js` | Feed/tame/egg/breed/companion/ride (§5.4.8) |
| `src/gameplay/discovery.js` | Scan/name/upload/zoology registry (§5.4.9), supersedes ad-hoc calls in `scanner.js` |
| `src/render/flora.js` | Extended: per-archetype distinct `collect` item ids, `hazard: {damage, radius}` flag, per-species discovery hook |
| `src/gameplay/creatures.js` | Rehomed onto `EcologySystem` + `CreatureGenome`; keeps its cell-streaming spawn/despawn logic (already sound) |

---

## 5.5 Phases

1. **Genome + roster data model** (no visual change): `creatureGenome.js`, `faunaRosters.js`, genus-bucketed discovery keys wired into existing `scanner.js`/`state.js`. Unblocks acceptance criterion 1 immediately.
2. **Authored part+skeleton pilot**: one skeleton (quadruped) fully authored and bound via `creatureRig.js`/`creatureAnim.js`, replacing `buildQuadruped()`; validates the pipeline end-to-end including the kept `paintCreature()` palette step.
3. **Roll out remaining 5 skeletons**, retire the old primitive body-builders, add the aquatic skeleton (net-new habitat).
4. **Ecology system**: herd steering, needs, predator-prey (`ecology.js`), extends the state machine per §5.4.7.
5. **Taming + feeding** (`taming.js` core), bait items wired into `items.js`.
6. **Breeding (eggs/mutation) + companions + riding** — the largest single feature slice; riding reuses the rover controller pattern.
7. **Discovery loop UI**: analysis-visor hold-scan, name prompt, upload action, zoology % HUD (`discovery.js` + UI layer).
8. **Flora depth pass**: per-species resource identity (retire the universal `'carbyne'` shortcut), hazardous flora, per-species flora discovery.
9. **Cave/underground roster** — held until Volume 3 (voxel terrain/caves) lands; roster data model from Phase 1 already supports a `habitat: 'cave'` value, so this phase is mostly content once caves exist.

---

## 6. Effort & risk (engineer-weeks)

| Phase | Work | Est. (eng-wk) |
|---|---|--:|
| 1 | Genome/roster data model, genus-bucketed discovery keys | 2 |
| 2 | Authored part+skeleton pilot (1 skeleton, rig+anim pipeline built from scratch) | 8 |
| 3 | Remaining 5 skeletons + part libraries (content + integration, pipeline reused) | 10 |
| 4 | Ecology (herd steering, needs, predator-prey) | 4 |
| 5 | Taming/feeding | 3 |
| 6 | Breeding/eggs/mutation/companions/riding | 8 |
| 7 | Discovery loop UI (scan/name/upload/zoology %) | 3 |
| 8 | Flora depth pass (per-species resources, hazards, discovery) | 4 |
| 9 | Cave roster content (post-Volume 3) | 2 |
| **Total** | | **≈ 44 eng-weeks (~10 months at 1 FTE, ~5 months at 2 FTE)** |

**Key risk — this is the one to flag loudest:** Phases 2–3 are not "write more JS." They require an actual **skeletal-animation pipeline**: bone hierarchies with joint limits, skinned-mesh binding (vertex weights), a shared clip library authored per skeleton class, and a runtime blend tree (idle↔walk↔run↔attack blending by speed/state, matching the smoothing already done for the sine-wave gaits today). three.js's `SkinnedMesh`/`AnimationMixer`/`AnimationClip` cover the runtime side natively, so this is not gated behind an engine rewrite the way Volumes 2/3 are — but it is a real new competency for the project (rigging + clip authoring), and it is the point where **"zero external assets" must formally end**: even a minimal 6-skeleton/40-part library is authored content, whether produced by a technical artist or curated from an AI mesh-generation pipeline. Budget accordingly — this is the single largest line item in the entire volume (18 of 44 weeks), and quality here directly gates whether creatures stop reading as "capsule toys." A fallback if the authored-asset bridge is rejected: keep the current primitive-assembly system but invest the 18 weeks instead in *procedural* rig quality (auto-generated skin weights via heat-diffusion binding over the existing procedural meshes, IK foot placement, a real blend tree) — this raises animation quality without new assets, but silhouette quality remains capped at "abstract, not alien," which is the ceiling the exec summary already scored at 2/10.

---

## 7. Acceptance criteria

All headless-verifiable (project already tests via Playwright + SwiftShader per Volume 0 methodology):

1. **Distinct genomes per seed.** `rollGenome(seedA, 'lush', 'land')` and `rollGenome(seedB, 'lush', 'land')` for `seedA ≠ seedB` produce genomes where the part-id set differs in at least one socket **or** `skeletonId` differs **or** the trait-vector Euclidean distance exceeds a threshold — i.e. not merely a repaint. Assert via a script that rolls 200 seeds and checks pairwise silhouette-signature (skeleton+parts tuple) cardinality is > 60% of the sample (bounded species pool is expected and correct per §5.4.3, but it must not collapse to 1–2 configurations).
2. **Herd flees a predator.** Spawn a herd of 4 herbivore individuals sharing a `group`, spawn one predator-temperament individual within its detection radius, run `EcologySystem.update()` for N simulated ticks; assert every herd member's `state` transitions to `flee`/`fleeing` within a bounded tick count and that the mean distance between herd centroid and predator strictly increases over the run.
3. **Scan → name → upload increments the registry.** Programmatically call `scanTarget(gs, creature)`, then `commitUpload(gs, 'Test Name')`; assert `gs.discoveries.creatures[genusId].name === 'Test Name'`, `gs.lumens` increased by exactly the entry's `value`, and a second `commitUpload` for the same `genusId` is a no-op (no double reward). Extend the same test to fully catalog a fixed-roster test planet and assert the `${planetId}:100pct` completion entry appears exactly once.
