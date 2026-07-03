# Volume 16 — Content Pipeline, Determinism & Asset Budget

> **Scope.** This is the cross-cutting strategy volume every other domain volume defers to once it hits what Volume 0 calls "the zero-asset wall." It does not re-litigate graphics (Vol 1), terrain (Vol 3), fauna (Vol 5), ships (Vol 7), NPCs (Vol 10), or audio (Vol 12) feature-by-feature — it answers the one question underneath all of them: **how does No Man's Sky actually generate "unlimited" content without a database, and what does AllMansSky (AMS) have to become, structurally, to approach the same fidelity while its founding constraint is zero external assets?** The thesis, stated once and argued throughout: NMS's proceduralism is a *recombination* system over an *authored* parts library, not generation from nothing. AMS's determinism core (`src/core/rng.js`, `src/core/noise.js`) already reproduces NMS's addressing trick — seed in, universe out, nothing stored — but AMS has no parts library, so its recombination has nothing to recombine except primitives and canvas paint. That gap is invisible in terrain and materials (where noise *is* the authored asset) and structural in creatures, animation, faces, music, and kit variety (where noise cannot substitute for sculpted topology, motion capture, or melody). Reaching literal parity in those domains requires relaxing the zero-asset rule in a small, controlled, still-deterministic way. This volume specifies that pipeline.

---

## 1) What No Man's Sky does (pipeline & determinism)

NMS ships as a multi-gigabyte install (~8–12 GB depending on platform/update) precisely because "infinite" content is a lie told well: the game contains a finite, hand-authored **parts library**, and the procedural layer is a **seed-driven recombination engine** that selects, parameterizes, and stitches those parts together. Nothing about a planet, creature, or ship is synthesized from raw noise alone; noise selects *which* authored pieces appear and how they're tinted/scaled/posed.

**Authored asset libraries.** Internally this is understood to break down into:
- **Mesh/part libraries.** Creature body parts (heads, torsos, limb sets, tails, wings, fins, frills) sculpted to fit a small number of shared **skeleton rigs** (biped, quadruped, avian, aquatic, insectoid, and hybrids). Building parts (walls, roofs, catwalks, pipes, greebles) as socketed kit pieces. Ship hull sections, wings, engines, cockpits as archetype-specific kits (fighter/explorer/hauler/shuttle/exotic). Vegetation as authored plant "species" (trunk/frond/flower meshes) recombined by biome rules.
- **PBR texture sets ("material palettes").** A bounded library of tiling detail textures (albedo/normal/roughness/metal/height/AO/emissive sets) — rock, sand, ice, foliage, metal-worn, metal-clean, crystal, organic-flesh, energy — not per-object unique textures. A given planet's terrain is a *blend recipe* over 3–6 of these palettes selected by biome/seed, not a baked planet-sized texture.
- **Animation clips on shared skeletons.** A bounded clip library (idle, walk, run, flee, eat, attack, sleep, take-off/land, interact) authored once per skeleton archetype, then **retargeted** — reused across every creature that shares that skeleton regardless of its authored body-part mix, exactly like a game-engine humanoid rig reuses mocap across differently-dressed characters.
- **Audio stems.** The generative soundtrack (composer 65daysofstatic's system) is a layered mix of **authored musical stems** (pad, bass, percussion, lead, texture layers per mood/biome) that a runtime director selects, transposes, and crossfades based on game state — not a single linear score, but not synthesized from nothing either. Creature vocalizations are synthesized/pitch-shifted from a smaller authored sample set, layered with proc-audio (formant shifting, granular grain) for per-creature uniqueness.

**The procedural recombination layer.** The actual "generator" is thin: `seed → deterministic parameter vector → { skeleton choice, part-slot choices, palette choice, per-part scale/color/detail params } → assembled mesh + material`. Concretely (as understood from datamining/community research): a creature's seed hashes into a skeleton pick, then a part pick *per socket* (head/torso/tail/limb/wing) constrained to parts compatible with that skeleton and biome, then continuous parameters (limb length, torso girth, hue, pattern) sampled from the seed to vary instances *within* a fixed part combination. The combinatorics — dozens of skeletons × tens of parts per socket × continuous scale/color — is what produces the appearance of infinite variety from a finite (large but bounded) authored set. Ships and buildings follow the identical pattern with sockets instead of biological joints.

**Uber-shaders and material palettes.** Rather than unique shaders per object, NMS runs a small number of **uber-shader permutations** (terrain, hero-object PBR, foliage, water, energy/emissive, creature-skin) toggled by feature flags baked at material-instance time (parallax on/off, wetness layer, subsurface term, iridescence). The "content" a planet ships with is which palette indices and blend weights feed that shader, not a bespoke shader per biome.

**Texture atlasing & streaming.** Because the palette library is finite and reused everywhere, texture sets are **atlased and streamed** (partially-resident/virtual texturing on higher platforms): only the tiles actually in view at the current LOD are resident in VRAM, and the same rock-01 normal map is shared across every planet in the galaxy that rolls "rock-01" in its blend recipe — there is no per-planet texture memory cost.

**Animation retargeting.** A clip authored once on a canonical skeleton (say, "quadruped_v2") plays back correctly on any creature instance built on that skeleton, however differently its part meshes are shaped, because the skeleton's bone hierarchy and bind pose are fixed and the part meshes are all skinned to that same bone set at authoring time. This is the single mechanism that lets a bounded animation budget cover an unbounded creature population — it is *reuse through a shared rig contract*, not per-creature procedural motion.

**Offline bake vs. runtime generation split.** The heavy, expensive, or inherently non-deterministic-feeling work (art creation, rigging, animation capture/keying, texture painting, music composition and stem mixing, collision-mesh generation, LOD chain baking) happens **once, offline, by humans and tools**, and ships as static data in the install. The **runtime** only does cheap, deterministic, seed-driven *selection and parameterization* — hashing, weighted picks, procedural placement, shader parameter blending. This split is why an 18-quintillion-planet galaxy fits on a disc: the disc holds the parts catalog (finite, ~10 GB), and the seed reconstructs an address into that catalog (a few bytes) on demand.

**Determinism & the no-database property.** A planet is not "generated once and saved" — its terrain, flora placement, creature roster, weather pattern, and resource distribution are **pure functions of `(galaxySeed, galaxyIndex, starSeed, planetIndex, ...)`**, recomputed every time from the same inputs. This is what makes 18.4 quintillion (2^64-ish addressable) planets possible with a client that ships gigabytes, not exabytes: nothing about an unvisited planet is stored anywhere, ever. **The tension** is player agency: bases you build, terrain you dig, resources you deplete, and (in multiplayer) discoveries other players make and name are *not* reproducible from the seed — they are genuine deviations from the deterministic baseline. NMS resolves this by storing **deltas**, not full state: a save/server record contains the seed-derivable address **plus** a sparse list of edits (dug voxel regions, placed base parts, claimed discovery names) that get **replayed on top of** the freshly regenerated baseline whenever that location is revisited. The regenerate-then-overlay pattern is exactly how the system stays both "infinite" and "persistent" at the same time.

---

## 2) What we have today

AMS's determinism core is, without qualification, the strongest piece of infrastructure in the project and is already architecturally the *right shape* for NMS-style seed addressing — it is the parts library and retargeting layer that are absent, not the addressing math.

**`src/core/rng.js`.** `hash32(...ints)` is a 32-bit xxhash-inspired integer mixer (Murmur-style avalanche: `Math.imul` rotate-mix over each input, then a finalizer) that takes any number of integer arguments and returns a well-distributed 32-bit hash — this is the universal "address → seed" primitive used everywhere (`hash32(seed, sx, sy, sz, i)` for a star, `hash32(planetDef.seed, hashString('flora-arch'))` for a flora archetype, `hash32(seed | 0, hashString('ship'), hashString(cls))` for a ship). `hashString(str)` (FNV-1a) lets string labels ("ship", "flora-arch", "name") participate in hashing without a lookup table. `mulberry32(seed)` is the underlying fast, seedable PRNG returning a `() => float in [0,1)` closure. The `RNG` class wraps it with typed draws — `next()`, `range(a,b)`, `int(a,b)`, `chance(p)`, `pick(arr)`, `gaussian(mean,std)` — and critically **`fork(label)`**, which derives an independent child `RNG` via `new RNG(hash32(this.seed, hashString(label)))` without perturbing the parent stream. `fork` is the mechanism that lets one object's generation split into independent, order-independent sub-streams (palette vs. geometry vs. naming) — exactly the property NMS's per-socket part selection needs and that any future part-recombination layer would reuse unchanged.

**`src/core/noise.js`.** `SimplexNoise` is a seeded (via `mulberry32`) permutation-table simplex implementation with `noise2D`/`noise3D`, plus fractal helpers built on top: `fbm2`/`fbm3` (standard octave-summed Brownian motion), `ridged2` (ridged multifractal for sharp ranges), and `warped2` (domain-warped fbm for organic continent/nebula flow). This is the *terrain and material* half of NMS's content system — where NMS blends authored detail-texture palettes by noise-driven weights, AMS's noise **is** the palette; there is no authored texture underneath.

**How `render/*` actually generates content today — kit-bash geometry + canvas paint, zero skeletons.**

- `src/render/shipmesh.js` — `buildShip(seed, shipClass)` seeds an `RNG` via `hash32(seed, hashString('ship'), hashString(cls))`, builds a `ShipKit`, and dispatches to one of five `CLASS_BUILDERS` (`buildSwift`/`buildTalon`/`buildDray`/`buildProspect`/`buildVanta`). Hulls are **lofted** (`loftGeometry(sections, radial)`) from superellipse cross-sections (nose→tail array of `{z, w, h, n}`, `n` controlling roundness→boxiness) — a genuinely clever from-primitives fuselage technique — with wings as extruded planforms. Surface detail is entirely **`CanvasTexture`**: `makePaintTexture(rng, pal, opts)` procedurally paints panel lines, stripes, decals, and wear directly onto a 2D canvas that becomes the albedo map; `makeStationMaps(rng, factionColor)` does the same for stations (plating rectangles, grid lines, faction trim bands, a separate emissive canvas for window rows). There is exactly one texture channel (albedo) — no normal/roughness/metalness maps — so `MeshStandardMaterial({metalness:0.75, roughness:0.35})` is a flat scalar, not a painted map (this is also flagged in Vol 1 §3 row 3).
- `src/render/creature.js` — explicitly documents its own approach in its header comment: *"Procedural fauna assembler: builds a low-poly rounded creature from parametric parts (torso, articulated legs, heads, tails, fins, wings, tentacles)... **No skeletons** — gait is per-limb transform animation driven by `animate(dt, speed01)`."* `buildCreature(seed, biome, opts)` seeds `RNG(hash32(seed, 0xfa07a))` and a matching `SimplexNoise`, picks a `bodyType` from six hard-coded body plans (`quadruped/hopper/hexapod/serpent/floater/flyer`) via biome-weighted `pickWeighted` over `TYPE_WEIGHTS`, looks up `TYPE_DIMS` for size/speed curves, and dispatches to a `BUILDERS[bodyType]` function (`buildQuadruped`, `buildHopper`, `buildHexapod`, `buildSerpent`, `buildFloater`, `buildFlyer`) that procedurally places primitive-derived parts (`makeLeg`, `makeHead`, `makeTail`, `makeBackFeature`, `makeWingGeometry`) as a `THREE.Group` hierarchy. Palette is per-instance HSL sampled from `BIOME_STYLE` hue/saturation windows; skin is `vertexColors`, not a texture. Locomotion is a hand-tuned sinusoidal transform loop over that group hierarchy (bob/leg-swing driven by a `gaitRate` clock), not skeletal animation on a rig — there is no bind pose, no bone weights, no clip data, and (structurally important) no way to *reuse* a walk cycle across a differently-shaped instance the way NMS retargets, because there is no shared skeleton contract to retarget onto.
- `src/render/stationinterior.js` — `buildHangar(seed, faction)` composes interior geometry entirely from primitives dressed with **baked canvas textures**: `makeDeckTexture`, `makeWallTexture`, `makePadTexture`, `makeHazardTexture`, `makeCrateTexture`, `makeStarTexture`, `makeNebulaTexture`, `makeScreenTexture` each procedurally draw to a `<canvas>` and wrap the result as a `THREE.CanvasTexture`. Same pattern as ships: geometry from primitives, surface detail from 2D canvas paint, no PBR channel set.
- `src/render/flora.js` — `FloraSystem` (constructor takes `scene, planetDef, field`) calls `buildArchetypes(planetDef, kit, rng)` to kit-bash 3–5 merged low-poly plant archetypes per biome from an `RNG` seeded on `hash32(planetDef.seed, hashString('flora-arch'))`, then streams them as `THREE.InstancedMesh` per archetype (capped `ARCH_CAP`) plus a separate cross-quad grass layer (`makeGrassGeometry`/`makeGrassTexture`/`makeGrassMaterial`, capped `GRASS_CAP`). This is the closest thing AMS has to NMS's "authored species, seed-placed" model — except the "species" themselves are also generated, not authored, so variety is bounded by the kit-bash grammar rather than an art budget.

**Universe addressing already works like NMS's, minus the parts.** `src/universe/galaxy.js`'s `Galaxy` class is architecturally the correct pattern: `starsInSector(sx,sy,sz)` seeds `RNG(hash32(this.seed, sx, sy, sz))`, computes an expected star count from a density function (`_expectedCount`, radial falloff × spiral-arm modulation × disc thickness), and forks a child `RNG` per star (`rng.fork(i)`) for class/name/color — fully lazy, fully cacheable (`_sectors` Map, LRU-capped at `MAX_SECTOR_CACHE = 8192`), and **order-independent**: any sector queried in any order yields the same stars, exactly NMS's "no database" property. `getSystem(starId)` lazily calls `generateSystem(stub, seed)` and memoizes. `startingSystemId()` deterministically searches outward from a fixed anchor for a pleasant G/K-class star with a lush planet — same galaxy seed, same starting system, always. This is genuinely NMS-grade addressing math; Volume 4 extends it to a full 64-bit universe/galaxy-stack address, and everything in *this* section carries forward unchanged.

**The edit-delta pattern already exists, in miniature.** `src/universe/terrainfield.js` is the one place in the codebase that already solves the "determinism vs. player edits" tension NMS solves with deltas. Base height is a pure function of `(seed, x, z)` via noise (`_craterAt` even procedurally scatters *natural* crater bowls on a deterministic cell grid, generated fresh every time — no storage). Player digging (Arcforge dig mode) is handled completely differently: `carve(x, z, r, d)`-style calls push `{x, z, r, d}` bowl records into `this._digs[]` (capped at 400 "so save files stay sane" — the comment states the storage concern explicitly), indexed into a spatial hash `_digIndex` (32-unit cells) for fast lookup, and `_digAt(x,z)` sums overlapping dig bowls on top of the procedural base in `heightAt`. This is the exact regenerate-base-then-overlay-deltas pattern NMS uses at planetary scale — it just currently exists only for one terrain-edit feature on one planet type, not as a general-purpose pattern reused across base building, resource depletion, or (eventually) multiplayer discovery state.

**Audio: generative synthesis, no stems.** `src/audio/music.js` is a WebAudio-only generative ambient engine (per its header: *"all WebAudio, all synthesized"*) — layered detuned triangle/sine pad voices through a lowpass + feedback delay + fake multi-tap reverb, chord progressions from a seeded random walk over `SCALES` (dorian/minorPent/majorPent/phrygian/lydian) via `MOODS` presets keyed by biome (`BIOME_TO_MOOD`), sparse bell motifs, crossfaded scene transitions. No sample playback, no stems, no authored melodic motifs — every note is oscillator synthesis. This is Volume 12's subject in depth; here it matters as the audio analogue of the "noise instead of authored asset" pattern.

**No-build delivery model.** `index.html` loads three.js via a native browser `<script type="importmap">` (`"three": "./vendor/three/three.module.js"`, `"three/addons/": "./vendor/three/addons/"`) and boots `src/main.js` as a plain ES module — there is no bundler, transpiler, or build step anywhere in the critical path. `server.mjs` is a zero-dependency Node static file server: it gzips compressible text assets on the fly, serves `no-cache` with `Last-Modified`/304 revalidation for all game files (explicitly so a deploy is never masked by a stale cache — "otherwise browsers keep playing hour-old builds after a deploy"), and reserves `public, max-age=86400` long-caching only for `/vendor/` (pinned three.js). There is no asset pipeline, no manifest, no content-hashing, no CDN, no IndexedDB or Cache API usage anywhere in `src/` (verified — `localStorage` is used only for save slots in `src/gameplay/state.js` and a UI preference in `src/ui/screens.js`). Any authored-asset pipeline this volume proposes must be **additive** to this model, not a replacement of it — the "open `index.html` in a browser and it runs" property is load-bearing for the project's identity and must survive.

---

## 3) The gap / the asset-budget wall

The question this table answers, domain by domain: **can more/better procedural code alone close the gap to NMS, or does the gap require authored source material no algorithm can synthesize?**

| Domain | Zero-asset holds? | Why | Authored assets that would be needed | Severity |
|---|:--:|---|---|:--:|
| Terrain macro-shape (heightfield/voxel silhouette) | **Holds** | Landforms are exactly what fbm/ridged/warped noise is good at; NMS's own terrain silhouette is noise-driven too | None | — |
| Terrain surface materials (rock/sand/ice/splat blending) | **Holds, with more work** | Triplanar + multi-octave procedural detail (Vol 1 §3 rows 3–4, Vol 3) can approach NMS's *look* without unique bitmaps — NMS's own palettes are tiling/generic, not per-planet unique | None strictly required; a curated set of a dozen procedural "detail kernels" (noise param presets) would speed authoring but isn't an asset dependency | [Cosmetic]→[Feature] |
| Hard-surface geometry — ships, stations, props, buildings | **Holds for silhouette**, breaks for *surface fidelity* | Kit-bash primitives (`loftGeometry`, extrusion) already produce plausible hard-surface silhouettes; PBR normal/roughness detail *can* be procedurally generated (worn-edge/panel-seam shaders) without bitmaps | None for silhouette; optional curated normal-detail noise presets for wear/scratches | [Cosmetic] |
| VFX / particles / weather | **Holds** | Explosions, trails, storms, dust are inherently procedural even in NMS (GPU-sim, not authored meshes) | None | — |
| Space set-dressing (starfield, nebula, rings, sun) | **Holds** | Already baked-canvas + shader, matches NMS's own procedural-noise approach for these | None | — |
| Creature/character **silhouette quality** (organic sculpted forms, believable proportions, expressive shapes) | **Breaks** | Parametric primitive assembly (cylinders/icospheres/cones in `creature.js`) cannot reach the sculpted, anatomically coherent silhouettes of an authored body-part library; noise cannot invent good topology | A small library of sculpted base meshes / morph-target part kits per skeleton archetype | **[Structural]** |
| Skeletal **animation** (walk/run/idle/attack cycles, foot IK, secondary motion) | **Breaks** | `creature.js` explicitly has **no skeleton** — per-limb sinusoidal transforms are a passable stand-in at a glance but cap out far below real gait quality, can't retarget, and can't support IK foot-planting on uneven terrain | Rigged skeletons (glTF) + a bounded authored animation-clip library per rig, retargeted | **[Structural]** |
| Faces / facial expression / NPC portraits | **Breaks** | Procedural facial synthesis that reads as appealing (not uncanny) is an unsolved art problem in general, and entirely absent from AMS today | Authored head/face part kit with blend-shape expression rig | **[Structural]** |
| Music — thematic identity, memorable motifs, mix depth | **Partially breaks** | `music.js`'s generative pad system is a legitimately good *ambient bed* substitute, but lacks NMS's authored-stem instrumentation variety, arrangement complexity, and recognizable melodic identity — pure synthesis plateaus below "a soundtrack you'd hum" | A stem library (pad/bass/perc/lead/texture per mood) composed once, layered/selected generatively — same mixing logic AMS already has, richer raw material underneath | [Feature]→[Structural] |
| Ship/NPC/building **variety at NMS's combinatorial scale** | **Breaks at parity scale** | Current kit-bash yields ~5 ship classes total; NMS's "unlimited" fleet variety comes from dozens of authored part kits recombined at sockets — no amount of *more procedural code* over 5 hand-built builder functions reaches that combinatorial space | An authored part-kit library (hull sections/wings/engines/greebles per archetype) recombined at seed-picked sockets, same pattern `shipmesh.js` already uses conceptually, larger raw material | **[Structural]** |
| Creature vocalizations / ambient SFX | **Holds, reasonably** | Formant-shifted/granular synthesis (Vol 12) is a domain where procedural audio genuinely competes with sampled audio — abstract/alien sound doesn't need to be "real" | None required; optional short authored samples would raise the ceiling further but aren't load-bearing | [Cosmetic] |
| UI iconography, HUD chrome | **Holds** | Vector/canvas-drawn UI is standard practice even in AAA titles | None | — |

**Reading the table:** the zero-asset wall is not evenly distributed. It holds cleanly across everything inorganic and everything statistical (terrain, materials, VFX, space dressing, UI) — these are domains where NMS's own "authored" assets are themselves generic, reusable, noise-blended palettes, so AMS's noise-only approach is doing structurally the same job with a smaller palette. It breaks specifically where NMS's content depends on **human craft that encodes taste and anatomy** — sculpted organic topology, believable motion, facial appeal, melodic memorability, and *combinatorial* variety at a scale no five hand-written builder functions can reach. Those four-and-a-half rows (creature silhouette, animation, faces, music, kit variety) are where "the exact same level, no exception" cannot be reached without authored source material, full stop — this is not a resourcing problem solvable by more engineer-weeks on the current architecture.

---

## 4) Target strategy

### 4.1 Content-generation data-flow (target architecture)

```
UNIVERSE SEED (64-bit, Vol 4 addressing)
   │
   ├─ hash32(seed, sx,sy,sz) ──────► Galaxy.starsInSector()            [universe/galaxy.js — unchanged]
   │        └─ hash32(seed, sx,sy,sz,i) ──► per-star seed
   │                 └─ generateSystem(stub, seed) ──► StarSystem{planets[]}   [universe/starsystem.js]
   │                          └─ per-planet seed ─────────────────────────────────┐
   ▼                                                                              ▼
PLANET SEED                                                              OBJECT SEED (ship/creature/NPC/base-part id)
   │                                                                              │
   ├─ RNG(hash32(seed,'biome')) → biome/palette        [biomes.js, unchanged]     │
   ├─ SimplexNoise(...) → heightfield                  [terrainfield.js, unchanged]│
   └─ RNG.fork('flora-arch') → archetype params        [flora.js, unchanged]      │
                                                                                   ▼
                                                                 PARAM VECTOR (bodyType/shipClass/
                                                                 skeleton/size/hue/temperament/…)
                                                                       │  RNG.fork() per axis — UNCHANGED
                     ┌─────────────────────────────────────────────────┴──────────────────────────┐
                     ▼                                                                              ▼
        PROCEDURAL ASSEMBLY (kept, all domains)                                    PART SELECTION (NEW, gated domains only)
        loftGeometry() / BUILDERS[bodyType]()                                      rng.pick(manifest.partsFor(kind, biome, skeleton))
        → THREE.BufferGeometry, kit-bashed, no deps                                → { partId, socket, lodTier }
                     │                                                                              │
                     ▼                                                                              ▼
        CANVAS MATERIAL BAKE (kept, all domains)                                   ASSET LOADER + CACHE (NEW)
        makePaintTexture()/make*Texture() → CanvasTexture,                         assets/loader.js → Cache API / IndexedDB
        in-memory, regenerated every load                                          → GLTFLoader → BufferGeometry+Skin (cached)
                     │                                                                              │
                     └──────────────────────────────┬───────────────────────────────────────────────┘
                                                      ▼
                                          MATERIAL PALETTE (uber-shader params)
                                       hue/sat/wear/faction-color applied over EITHER
                                       canvas-baked OR authored-UV textures, same shader
                                                      ▼
                                            THREE.Mesh / SkinnedMesh
                                       skinned + retargeted clip IF authored rig present
                                       (creature.js BUILDERS path) ELSE per-limb transform anim (unchanged fallback)
```

The key design commitment: **the authored-part path is an alternate branch, not a replacement.** `RNG.fork()` already gives independent, order-stable sub-streams for geometry vs. palette vs. naming — the same fork points that pick `bodyType` today can, when a manifest is present, additionally pick a `skeletonId` and per-socket `partId`s. When no manifest is reachable, every module falls back to exactly its current procedural path. This is what preserves the no-build, asset-optional identity while adding real fidelity where it's reachable.

### 4.2 Asset manifest & streaming schema

```jsonc
// assets/manifest.json — built by an OPTIONAL offline tool (tools/bake/*.mjs),
// fetched once at boot, versioned and content-hashed so saves can pin to it.
{
  "manifestVersion": 1,
  "assetRoot": "assets/",
  "tiers": {
    "core": { "loadWhen": "boot",           "maxBytes": 8388608  },  // ~8 MB — must not slow first paint
    "near": { "loadWhen": "system-entry",   "maxBytes": 25165824 },  // ~24 MB — streamed while warping in
    "deep": { "loadWhen": "on-demand",      "maxBytes": 29360128 }   // ~28 MB — fetched lazily per object kind
  },
  "parts": [
    {
      "id": "creature.skeleton.quadruped_v1", "kind": "skeleton", "tier": "core",
      "format": "gltf-binary", "path": "skeletons/quadruped_v1.glb",
      "bytes": 41200, "sha256": "…",
      "bones": ["root","spine1","spine2","neck","head","legFL_up","legFL_lo","legFR_up","…"],
      "clips": ["idle","walk","run","flee","eat","alert"]
    },
    {
      "id": "creature.part.quad_head_A", "kind": "bodyPart", "slot": "head", "tier": "near",
      "compatibleSkeletons": ["quadruped_v1"],
      "format": "gltf-binary", "path": "parts/quad_head_A.glb",
      "bytes": 18400, "sha256": "…",
      "morphTargets": ["snoutLength","browRidge","hornSize"]
    },
    {
      "id": "ship.kit.interceptor", "kind": "partKit", "tier": "near",
      "format": "gltf-binary", "path": "ships/interceptor_kit.glb",
      "bytes": 96000, "sha256": "…",
      "sockets": ["nose","wingL","wingR","engineMain","engineAux[0..3]"]
    },
    {
      "id": "audio.stem.dorian_pad_low", "kind": "audioStem", "tier": "deep",
      "format": "opus", "path": "audio/dorian_pad_low.opus",
      "bytes": 210000, "sha256": "…", "loopPointSec": 8.0,
      "key": "dorian", "layer": "pad"
    }
  ]
}
```

Loader/cache contract (`src/assets/loader.js`, `src/assets/cache.js`, new modules):

```js
// pseudocode
async function loadPart(partId) {
  const meta = manifest.byId[partId];
  const cached = await cache.match(meta.path);          // Cache API, keyed by path+sha256
  const buf = cached ?? await fetchAndVerify(meta);      // sha256-checked before caching
  if (!cached) await cache.put(meta.path, buf);
  return gltfLoader.parseAsync(buf);                     // THREE.GLTFLoader, already available via
}                                                          // three/addons/ import-map entry — no new dep
```

`Cache API` (not raw IndexedDB) is the right primitive here: it natively stores `Response` objects keyed by request, survives reloads, and pairs with a `sha256` integrity check embedded in the manifest rather than relying on HTTP cache headers alone — important because `server.mjs` currently serves everything else `no-cache` by design (Section 2). Assets get their **own** cache-control story: content-hashed filenames (or the manifest's `sha256` field used as a query/cache key) so they can be cached aggressively without the "stale after deploy" problem the rest of the app deliberately avoids.

### 4.3 A real skeletal-animation pipeline

Because `creature.js` has no skeleton today, this is new plumbing, not a refactor of existing code:
1. **Rig authoring (offline, art).** A small number of canonical skeletons (5–6: quadruped, biped/hopper, hexapod, serpent, avian/flyer, aquatic/floater) authored once in a standard DCC tool, exported as glTF with a fixed bone-name convention.
2. **Clip authoring (offline, art).** A bounded clip set per skeleton (idle/walk/run/flee/eat/alert — matching the states `creature.js`'s `animate(dt, speed01)` already models conceptually), exported as glTF animation clips on the same rig.
3. **Retarget system (`src/render/animretarget.js`, new).** Because every body-part mesh sharing a skeleton is skinned to the *same* bone hierarchy at authoring time (the NMS trick — Section 1), runtime retargeting is closer to "attach" than "solve": `THREE.AnimationMixer` plays clips authored on `quadruped_v1` directly against any instance built from `quadruped_v1` parts, with no per-instance IK solve required for the base cycle. A thin **procedural IK layer** on top (single-bone foot-lock against the terrain heightfield already sampled by `TerrainField.heightAt`) handles uneven-ground foot placement, reusing data AMS already computes for terrain rendering.
4. **Fallback.** If no manifest/skeleton is available for a given `bodyType`, `creature.js` keeps its current `BUILDERS[bodyType]` + per-limb transform path verbatim — this is the permanent "asset-optional" ceiling, not a temporary migration state.

### 4.4 Determinism model, extended

The addressing chain from Section 2 (`hash32` → `RNG.fork`) is preserved exactly; what changes is that some fork points now resolve into a **manifest lookup** instead of a purely computed parameter. The determinism guarantee becomes: *same `(universeSeed, objectId, manifestVersion)` → same part IDs, same transforms, same palette, forever* — with `manifestVersion` promoted to a first-class input alongside the seed, because unlike noise (which is a closed-form function with no external state), a parts manifest is a versioned artifact that can change between updates. This mirrors a real NMS caveat worth stating honestly: NMS's own galaxy has **not** been perfectly stable across major updates (algorithm/content changes have measurably altered specific planets after big patches) — perfect eternal determinism across *all future updates* is not actually what NMS achieves either; what it achieves is determinism *within* a content version, plus a save format that tolerates drift. AMS should target the same bar, not a stricter one: pin `manifestVersion` per save/discovery record, and treat cross-version drift as an accepted, documented behavior rather than a bug to eliminate.

### 4.5 Determinism-vs-storage decision table

| Data | Regenerate from seed? | Store? | Precedent in codebase |
|---|:--:|:--:|---|
| Terrain base heightfield | Yes, always | No | `TerrainField._craterAt` — pure fn of `(seed,x,z)` |
| Biome/palette assignment | Yes | No | `biomes.js` seed-derived |
| Flora archetype set & placement | Yes | No | `flora.js buildArchetypes`, cell-hash placement |
| Star/system/planet roster | Yes | No | `galaxy.js starsInSector`/`getSystem`, memoized not persisted |
| **Player dig bowls** | No — is the edit itself | **Yes** (delta list, capped) | **Already shipping**: `terrainfield.js _digs[] = [{x,z,r,d}]`, capped 400 |
| Base-building placements (Vol 8) | No | Yes (delta list, same pattern as `_digs`) | Not yet built; extend the `_digs` precedent |
| Creature skeleton/part pick (proposed) | Yes, **if** `manifestVersion` pinned | No (only the version int) | New — mirrors `galaxy.js`'s star-seed pattern |
| `manifestVersion` used at generation time | N/A | **Yes** (1 int, per save/discovery) | New — required for cross-update stability |
| Ship visual (current kit-bash path) | Yes | No | `shipmesh.js buildShip` — pure fn of seed+class |
| NPC dialogue/quest flags | No | Yes | `gameplay/state.js` save slots |
| Multiplayer discovery registry (Vol 13, future) | No | Yes (server-authoritative) | Not yet built — first-to-discover is a race, not derivable |

### 4.6 Module/file plan

| Module | Status | Purpose |
|---|---|---|
| `src/assets/manifest.js` | New | Fetch/parse/validate `assets/manifest.json`, expose `byId`, `partsFor(kind, filter)`, tier metadata |
| `src/assets/loader.js` | New | `loadPart(id)`: cache lookup → fetch+sha256-verify → `GLTFLoader.parseAsync` → memoize in-memory |
| `src/assets/cache.js` | New | Thin wrapper over `caches.open('ams-assets-v1')`; integrity-checked put/match |
| `src/render/animretarget.js` | New | `AnimationMixer` setup per skeleton id, clip playback, foot-lock IK layer over `TerrainField.heightAt` |
| `src/render/creature.js` | Extended | `BUILDERS[bodyType]` gains an optional authored-skeleton branch selected when `manifest.hasSkeleton(bodyType)`; procedural branch untouched as fallback |
| `src/render/shipmesh.js` | Extended | `CLASS_BUILDERS` gains a socket-based authored-kit branch alongside existing `buildSwift`/`buildTalon`/etc.; `loftGeometry` path remains the fallback |
| `src/audio/music.js` | Extended | Stem-mixer layer added alongside existing `MOODS` synthesis; synthesis remains the ambient bed / no-manifest fallback |
| `tools/bake/*.mjs` | New, dev-only | Offline manifest generator + optional glTF/texture packer; **never required** for `npm start` to work |
| `docs/nms-parity/16-content-pipeline-assets.md` | This document | — |

---

## 5) Phases

**Phase 0 — Now, no asset dependency (ships regardless of the Section 6 decision).** Keep pushing the procedural ceiling in domains that hold (Section 3): richer terrain triplanar/splat blending (Vol 3), more `loftGeometry` cross-section variety and canvas-detail passes for ships/stations (Vol 1/7), deeper `MOODS`/`SCALES` variation in `music.js` (Vol 12), more nebula/starfield richness. Zero art budget, pure engineering.

**Phase 1 — Infra plumbing, proven on a placeholder.** Build `assets/manifest.js` + `loader.js` + `cache.js` + the manifest schema, and prove the whole fetch → verify → cache → parse → render loop against a single throwaway test glTF (a rigged cube) before committing any real art budget. Add the Playwright coverage from Section 7 (AC1, AC2, AC7) at this stage so regressions are caught immediately. ~3 engineer-weeks, zero authoring cost.

**Phase 2 — One canonical skeleton, end to end.** Rig exactly one skeleton (quadruped — the highest-population `bodyType` per `TYPE_WEIGHTS.default`), author its 6 clips, build `animretarget.js`, and wire it into `creature.js` as the first live authored-part branch. This validates the highest-value, highest-risk domain (animation) before scaling the part library out. ~4 engineer-weeks + first authoring tranche.

**Phase 3 — Scale the part library.** Commission the remaining 4–5 skeletons + body-part kits (Section 6 art budget), the ship/building part kits, and a small curated PBR texture-set library. Wire seed→part-selection into `shipmesh.js`/`stationinterior.js` following the Phase 2 pattern. Procedural paths remain live as the no-manifest fallback throughout (AC7).

**Phase 4 — Music stems.** Build the stem-mixer engine alongside (not replacing) `music.js`'s synthesis — synthesis stays as the ambient sub-layer and the universal fallback; authored stems add thematic/motif identity on top, selected and crossfaded by the same `MOODS`/biome logic that already exists.

**Phase 5 — Multiplayer-readiness (gates on Vol 13).** Generalize the `_digs[]` edit-delta precedent to base-building placements and a server-authoritative discovery registry; require `manifestVersion` in the sync protocol so peers with different cached asset states still agree on canonical part IDs (a peer lazily fetches any part it doesn't yet have cached, keyed by the same `sha256`).

---

## 6) Effort & risk

**Engineering infrastructure (engineer-weeks, excludes authoring):**

| Item | Effort |
|---|--:|
| Manifest schema + offline generator (`tools/bake/*.mjs`) | 1 ew |
| Loader/cache module (Cache API, tiered streaming, sha256 integrity) | 2 ew |
| glTF integration (skinning, `GLTFLoader` wiring — loader itself is already available via `three/addons/`) | 1.5 ew |
| Animation retarget system + terrain foot-lock IK | 4 ew |
| Part-recombination integration into `creature.js`/`shipmesh.js`/`stationinterior.js` (socket picking, palette-over-authored-UV) | 3 ew |
| Determinism/versioning layer (`manifestVersion` pin + save migration) | 1 ew |
| Music stem-mixer engine alongside `music.js` | 2 ew |
| Verification tooling (Playwright: manifest fetch, cache-hit offline replay, seed-reproducibility snapshot) | 1 ew |
| **Total infra** | **~15.5 ew** (≈4 months, one engineer; compressible with parallel workstreams) |

**Art/audio authoring — a distinct cost line, not engineer-weeks.** This is specialist labor (3D modeling/rigging, animation, texture painting, music composition/mixing) the current team composition has not needed at all, because AMS has shipped zero external assets to date. Rough scope for a "tens of MB, not GB" library sized to match AMS's existing stylized low-poly aesthetic (NOT NMS's own asset fidelity — a proportionally scaled-down library):

| Line item | Scope | Rough duration (specialist-weeks) |
|---|---|--:|
| Skeleton rigs | 5–6 archetypes (quadruped/hopper/hexapod/serpent/flyer/floater) | 6–10 |
| Creature body-part kits | ~6 sockets × 5–8 variants × 5–6 rigs ≈ 200–250 low-poly parts | 8–12 |
| Ship/building part kits | ~150 socketed parts across 5+ archetypes | 6–8 |
| Curated PBR texture-set library | ~2 dozen tiling detail sets (rock/sand/ice/metal/organic/crystal/energy) | 2–3 |
| Music stems | 6–10 mood palettes × 6–8 stems (pad/bass/perc/lead/texture) ≈ 50–70 stems | 3–5 |
| Face/portrait kit (if pursued, Vol 10) | Head/expression blend-shape kit for NPC variety | 3–4 |
| **Total art/audio** | | **~28–42 specialist-weeks** (≈4–6 months, blended contractor budget roughly **$35k–$90k** at typical freelance/contract rates — planning-grade, not a quote) |

**Risks:**
- **Identity/marketing risk.** "Zero external assets" is currently a stated architectural badge across this project's docs (Vol 0 explicitly calls it "a genuine engineering achievement and a strategic straitjacket"). Introducing *any* authored assets is a positioning change the project owner must make explicitly and communicate, not something to slip in quietly.
- **Download-size risk.** The current cold-load is near-instant (no bundler, small JS payload). The tiered manifest (Section 4.2) exists specifically to protect the `core` boot tier (~8 MB) so first-interactive-frame time doesn't regress; `near`/`deep` tiers must genuinely defer, not just declare intent to.
- **Determinism-drift risk.** Authored assets are versioned artifacts, unlike closed-form noise — without the `manifestVersion` pin (Section 4.4), a future art update silently changes what old seeds/saves render. This is a real, novel failure mode the current pure-procedural system cannot have (noise functions don't get "updated" out from under a seed the way an asset library does).
- **Rights/licensing risk.** Any commissioned or outsourced art/audio must be fully owned (no CC-BY-NC, no stock-asset licensing traps) — this is new legal surface area for a project that currently has none.
- **No-build-flow risk.** `tools/bake/*.mjs` must remain strictly optional; every extended module (Section 4.6) must have a working procedural fallback so `npm start` on a fresh checkout with no baked assets still produces a fully playable (lower-fidelity) game — this is both a technical requirement (AC7, Section 7) and a philosophical one (Section 2's no-build model is worth protecting on its own merits, independent of the asset decision).

**The strategic decision the project owner must make.** This volume's honest conclusion is that there is no clever architecture that avoids this choice — it is a fact about what NMS's content actually is, not a negotiating position:

- **(A) Keep zero-asset purity.** Explicitly cap ambition below full parity in creature/character silhouette, animation, faces, music, and kit variety (Section 3's broken rows), and continue describing AMS as a *tribute* — "the exact same level, no exception" is then acknowledged as unreachable in those specific domains, by design, permanently.
- **(B) Authorize the minimal authored-part pipeline in this volume.** A curated, tens-of-MB library, seed-recombined exactly like NMS's own content (Section 4), keeping the no-build dev flow, the deterministic addressing model, and most of the current codebase's zero-asset domains untouched (Section 3's "holds" rows stay pure procedural forever — this is not a wholesale abandonment of the constraint, just a targeted relaxation where noise structurally cannot substitute for craft).

There is no **(C)** that reaches parity in organic silhouette/animation/faces/music/variety while keeping literally zero assets — Section 3's table is the evidence, and it is not a resourcing gap closeable by more engineer-weeks against the current architecture.

---

## 7) Acceptance criteria

1. **AC1 — Manifest integrity.** `assets/manifest.json` fetches over HTTP, validates against its schema, and every listed part's `sha256` matches its fetched bytes.
2. **AC2 — Cache correctness.** On a second load, all previously-fetched parts are served from `Cache API` with zero network requests (verified: Playwright test loads once online, goes offline via route interception, reloads, confirms the scene still builds byte-for-byte from cache).
3. **AC3 — Seed reproducibility.** Given identical `(universeSeed, objectId, manifestVersion)`, the authored-part recombination path (creature/ship/building) produces byte-identical `partId` selections, socket transforms, and palette parameters across two independent runs/browser contexts (deterministic snapshot test, same discipline as the existing `galaxy.js` addressing).
4. **AC4 — Boot-tier budget.** Total bytes fetched before first interactive frame stays within the `core` tier budget (~8 MB); `near`-tier streaming during system entry introduces no single stall greater than the target frame-budget threshold already used elsewhere in the project's perf tests (`test/perf.mjs`).
5. **AC5 — Edit-delta layer holds under the new content.** Extending the existing `_digs[]` precedent (`terrainfield.js`) to base-building placements: dig/build, save, reload, and confirm deltas replay correctly on top of freshly regenerated (and, where applicable, freshly re-fetched) baseline content — a Playwright test performing exactly this sequence and diffing terrain heights / placed-object positions before and after reload.
6. **AC6 — Version pinning survives manifest updates.** Loading an older save against a newer `manifest.json` either resolves via an explicit migration map or falls back to the exact historical manifest bytes (still fetchable/cached) referenced by the save's pinned `manifestVersion` — verified by a test that swaps manifest fixtures mid-suite and confirms no seed's rendered output silently changes.
7. **AC7 — No hard dependency on authored assets.** With the asset route blocked entirely (manifest fetch fails/404s), the game still boots and is fully playable end-to-end using only the pure-procedural fallback paths already documented in Section 2 — verified by a Playwright test with `assets/` routes intercepted and rejected.
8. **AC8 — Retargeting correctness.** A single animation clip authored once on a canonical skeleton plays without bone-mapping artifacts (no vertex tearing, no foot penetration beyond the IK tolerance) across at least three differently-proportioned creature instances built on that same skeleton — visual/pose regression check, consistent with this project's existing headless-Playwright verification discipline (`test/*.mjs`).
