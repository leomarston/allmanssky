# Volume 17 — Engineering Roadmap, Phasing, Effort & Verdict

This volume synthesizes the sixteen domain volumes into a single sequenced program: what to build, in what order, with what team, at what cost, and whether "the exact same level as No Man's Sky, no exception" is a realistic target. Read Volume 0 first for the parity scorecard; read this to know what to actually *do*.

---

## 17.1 The governing constraint: dependency order, not wish order

You cannot build this in the order the features excite you. The domains form a dependency graph, and one node dominates it: **the spherical, floating-origin, streamed-planet engine (Volume 2)** with its sibling **voxel terrain (Volume 3)**. Until those land, a large fraction of the other work is either impossible or will be thrown away.

```
                     ┌─────────────────────────────────────────────┐
                     │  V16 Content Pipeline / Determinism (spine)  │
                     │  V4 Universe Address & Galaxy (parallel)     │
                     └───────────────────────┬─────────────────────┘
                                             │
                    ┌────────────────────────▼────────────────────────┐
                    │  V2 Spherical Planets + Floating Origin (GATE)   │
                    │  V3 Voxel Terrain (rides on V2)                  │
                    └───┬─────────────┬──────────────┬────────────┬───┘
        ┌───────────────┘             │              │            └───────────────┐
        ▼                             ▼              ▼                            ▼
  V1 Graphics             V5 Flora/Fauna     V8 Base Building        V11 Survival/Weather
  (parallel-ish,          (needs sphere      (needs terrain edit    (needs environment
   full payoff post-V2)    for placement)     from V3)               model on sphere)
        │                             │              │                            │
        └──────────────┬──────────────┴──────────────┴────────────────────────────┘
                       ▼
   NOT engine-gated — can proceed NOW, in parallel with the engine team:
   V6 Space Combat/AI · V7 Ships/Tools/Exocraft · V9 Economy/Crafting ·
   V10 NPCs/Story · V14 UI/UX · V12 Audio · V15 Live-ops · V13 Multiplayer (late)
```

**Two independent tracks fall out of this graph:**

- **The Engine Track** (V16 spine → V4 → V2 → V3 → then V1/V5/V8/V11 unlock). This is the long pole. It is where the "round planets," "chunk system," "unlimited," and "graphics that are actually near" live.
- **The Systems Track** (V6, V7, V9, V10, V14, V12, V15) can start *today* on the current architecture and deliver visible parity wins while the engine is rebuilt, because those systems are logic/data/UI, not world-representation. V13 (multiplayer) starts late because it depends on a stable entity model and the determinism spine.

Running both tracks concurrently is how you avoid an 18-month stretch with nothing shippable. The Systems Track keeps producing playable improvements every few weeks; the Engine Track delivers the one big architectural leap.

---

## 17.2 The phase plan

Five phases. Each phase has an explicit exit criterion — a demonstrable, headless-verifiable capability — so "are we there yet" is never a matter of opinion.

### Phase 0 — Foundations & de-risking *(≈1.5–2.5 months)*
Prove the two riskiest bets in isolation before committing the program to them.

- **Spike: floating-origin cube-sphere.** A throwaway three.js scene: one cube-sphere planet, quadtree LOD, camera-relative origin rebasing, walk from orbit to ground with no cut. Prove precision holds and framerate survives in a browser. *(V2)*
- **Spike: WebGPU vs WebGL2.** Stand up a `WebGPURenderer`/TSL branch; port one heavy effect (raymarched clouds or clustered lights) to compute; measure. Decide the renderer future now — it colors everything in V1. *(V1/V16)*
- **Spike: authored-part pipeline.** Load one glTF skeleton + a handful of parts, recombine by seed, retarget one animation. Prove the "relax zero-asset, stay procedural" thesis is real. *(V16/V5)*
- **Universe address model.** Land the 64-bit/BigInt address + galaxy stack + portal glyph encode/decode. Pure data; unblocks V4 UI and later multiplayer. *(V4)*
- **Determinism spine.** Formalize `seed → address → params → content` and the edit-delta layer contract every later system will store into. *(V16)*

**Exit criteria:** a spike build walks orbit→ground seamlessly on a cube-sphere at ≥30 fps in Chrome; a renderer decision is documented with numbers; a seed round-trips through the address + one recombined asset.

### Phase 1 — The Engine Rebuild *(≈6–10 months, the long pole)*
Turn the spikes into the real substrate. This is the single largest investment and the one that makes "No Man's Sky" an honest word.

- **V2 Spherical planets:** production cube-sphere quadtree, streaming over web workers, floating origin, seamless space↔surface (merge `SpaceState`/`SurfaceState` into one continuum), atmosphere from both sides, moons/rings/neighbors correctly placed in-sky, circumnavigation, poles.
- **V3 Voxel terrain:** density-field + chunk mesher (dual contouring/surface nets) in workers, caves/overhangs, terrain manipulator, edit-delta persistence, collision on extracted meshes, resource deposits.
- **V16 (partial):** the asset manifest + streaming/caching (IndexedDB/Cache API) and the small authored-part library go live, because organic content (V5) and materials (V1) now need them.

**Exit criteria:** land anywhere on a real sphere, dig a cave that persists across reload, circumnavigate and return to your base, see this planet's moon rise at the predicted azimuth — all headless-proven.

### Phase 2 — Systems Parity *(runs largely in PARALLEL from Phase 0 onward; ≈8–14 months of work, overlapped)*
The Systems Track. Most of this does **not** wait for Phase 1 and should be staffed from the start.

- **V6 Space combat & AI** — steering/boids AI, encounter director, pirate/Sentinel waves, asteroid fields, freighter battles, wingmen. *(highest ROI; not engine-gated)*
- **V7 Ships/tools/exocraft/exosuit** — classes/archetypes, slot-grid + adjacency + supercharged inventory (shared model), acquisition, multitool variety, exocraft roster incl. submarine + mech. *(slot-grid is a keystone data model reused everywhere)*
- **V9 Economy/crafting/refining** — nanites + quicksilver, supply/demand market, recipe graph, cooking, guild reputation.
- **V10 NPCs/factions/language/story** — branching dialogue engine, race models (authored-part faces), expanded language, a main-arc quest framework, procedural mission generator.
- **V14 UI/UX** — analysis visor + discovery catalog, galaxy-map filter modes, radial quick-menu, accessibility matrix, deeper inventory feeding V7.
- **V5 Flora/fauna** — genome model + recombination generator + ecology/taming/breeding/companions + discovery registry. *(silhouette/animation quality unlocked by Phase-1 authored-part + skeletal pipeline)*
- **V8 Base building** — part catalog, socket snapping, power/logic graph solver, farming, settlements, NPC specialists. *(terrain-edit integration waits on V3)*
- **V11 Survival/weather/modes** — environment model, hazard/life-support web, extreme storms, the game-mode matrix (Creative/Survival/Permadeath/Custom). *(full payoff once the sphere gives real biomes/altitude)*
- **V12 Audio** — deeper adaptive layers, spatialization + reverb zones, param-driven creature vocals, hybrid stem pack.

**Exit criteria:** each volume's own acceptance tests pass headlessly; a new player can fly, fight a scaled pirate wave, mine an asteroid, install adjacency-bonused tech, tame a creature, cook a meal, take a branching mission, and build a powered base.

### Phase 3 — Live Content, Multiplayer & Endgame *(≈4–8 months + ongoing)*
- **V13 Multiplayer** — WebSocket/WebRTC relay, entity replication leveraging deterministic worldgen (sync players/edits/discoveries only), discovery registry service, a social-hub analog, co-op, later voice. *(needs the stable entity model from Phase 2 and the determinism spine)*
- **V15 Expeditions & live-ops** — expedition framework (shared seed, phased milestones, cross-save rewards), Nexus-style repeatable missions + quicksilver cosmetics, endgame loops (S-class re-roll, derelict dungeons, frigate missions, racing, collection metagames), an update cadence.

**Exit criteria:** two browser clients share a system and a discovery; an expedition seed reproduces a shared start and grants a persisted reward.

### Phase 4 — Fidelity & Parity Polish *(continuous, heaviest at the end; ≈4–8 months)*
- **V1 Graphics** to AAA: the full PBR/clustered pipeline, aerial-perspective atmosphere, volumetric clouds, water reflections/refraction/caustics, dense instanced foliage, GPU particles, the graded HDR post chain, temporal upscaling — most of it landing on the WebGPU renderer decided in Phase 0 and paying off fully now that terrain is spherical/voxel.
- Cross-cutting performance, memory budget, streaming tuning, accessibility, and the long tail of "small but felt" items (buried tech, storm crystals, black-hole traversal, derelicts, settlements depth).

**Exit criteria:** side-by-side, a naive viewer cannot instantly tell which is which on a static planet vista; frame budget holds on mid hardware.

---

## 17.3 If you can only do five things (the high-ROI shortlist)

For a small team that cannot fund the full program, these five deliver the most perceived "it's like No Man's Sky now" per engineer-week, and none except #1 requires the engine rebuild:

1. **Round planets + seamless transition (V2).** Nothing else moves the needle like this. It is the identity of the game. Expensive, but it is *the* thing. If you fund one big item, fund this.
2. **Space is alive (V6).** Asteroid fields, pirate waves with real dogfighting AI, a freighter battle. Cheap relative to impact; the current empty space is one of the most obvious gaps.
3. **The slot-grid + adjacency inventory across ship/tool/suit/exocraft (V7).** This single data model is the backbone of NMS progression and makes upgrading feel like NMS instead of a stat bar.
4. **Analysis visor + discovery catalog (V14) with the creature genome + ecology (V5).** "Scan an unlimited creature, name it, upload it" is a core NMS fantasy and is mostly logic/UI + a generator.
5. **Graphics uplift on the current scenes (V1, pre-engine subset):** aerial-perspective sky, better terrain materials, denser foliage, water reflections, a graded post chain. Directly answers "the graphic level is not even near" without waiting for Phase 1.

---

## 17.4 Effort model & team

These are planning-grade estimates for competent senior engineers, **excluding art/audio authoring**, which is a separate and substantial line (see Volume 16). Ranges reflect the difference between "solid" and "polished-to-parity."

| Track / Phase | Volumes | Engineer-months (range) |
|---|---|---|
| Phase 0 — Foundations | V2/V1/V16/V4 spikes | 4 – 7 |
| Phase 1 — Engine | V2, V3, V16 (partial) | 14 – 24 |
| Phase 2 — Systems | V5,6,7,8,9,10,11,12,14 | 45 – 75 |
| Phase 3 — MP & Live | V13, V15 | 10 – 18 |
| Phase 4 — Graphics/Polish | V1 (full), cross-cutting | 12 – 22 |
| **Total engineering** | | **≈ 85 – 145 engineer-months** |

That is **roughly 7–12 engineer-years of pure engineering.** Add, as distinct non-engineering lines:

- **Art authoring** (the minimal-but-real part libraries: creature parts/skeletons, ship kits, NPC/race models, base parts, material textures, VFX): on the order of **4–10 artist-years** to reach recognizable NMS breadth even at "small curated library, seed-recombined" scale.
- **Audio authoring** (stem pack + SFX design): **0.5–1.5 audio-years.**
- **Narrative writing** (main arc + branching dialogue + lore at NMS volume): **1–3 writer-years.**
- **Live-ops content** thereafter: **continuous**, indefinitely.
- **Server infrastructure & ops** for multiplayer/discovery/expeditions: ongoing hosting + a portion of an engineer.

**A realistic staffing shape** to hit this in a **~2.5–3.5 calendar-year** window: an **Engine pod (2–3)**, a **Systems pod (3–5)**, a **Graphics/Tech-art pod (1–2)**, a **Tools/Pipeline + Multiplayer engineer (1–2)**, **2–4 artists**, **1 audio**, **1 writer**, plus design/QA/production. Call it **~12–18 people** sustained. That is the honest shape of "the same level as No Man's Sky," and it is roughly the shape Hello Games itself grew into across a decade.

---

## 17.5 The three strategic decisions the owner must make now

The roadmap forks on three choices that are not engineering details — they are product bets. Each is discussed in depth in its volume; here is the decision each forces:

1. **WebGL2 or WebGPU? (V1)** Staying on WebGL2 caps you well below AAA (no compute for clouds/particles/terrain meshing, limited clustered lighting, harder temporal upscaling). WebGPU is the realistic path to "graphics that are actually near," at the cost of narrower browser support today and a renderer migration. **Recommendation: commit to WebGPU (three.js WebGPURenderer/TSL) in Phase 0**, with a WebGL2 fallback path. Deciding late means redoing graphics work.
2. **Keep the zero-asset purity, or relax it? (V16)** Matching NMS's *variety and organic fidelity* with zero authored assets is impossible for creatures, characters, animation, and music. **Recommendation: relax the rule in a controlled way** — a small curated authored library (tens of MB, streamed/cached), recombined by seed exactly as NMS does. Keep procedural where it already wins (terrain, materials, hard-surface geometry, VFX). Refusing this caps the ceiling permanently.
3. **Native or browser? (cross-cutting)** The browser + no-build constraint is a real differentiator and a real ceiling (memory, threads, GPU access, store presence for Steam). WebGPU + asset streaming narrows the gap; a future native/Electron or wasm path (the repo already ships a Steam Electron shell) is the escape hatch if browser limits bite. **Recommendation: stay browser-first through Phase 2, keep the Electron shell current, and re-evaluate a native core before Phase 4 graphics.**

---

## 17.6 Risk register (top risks)

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Floating-origin precision / LOD cracks on the cube-sphere (V2) | Program-defining | Medium | Phase-0 spike proves it before committing; skirts/morphing; origin rebasing tested headlessly |
| Browser performance ceiling for streamed voxel planets (V2/V3) | High | Medium-High | WebGPU compute meshing; worker threads; aggressive LOD; budget caps; native escape hatch |
| Scope: Systems Track is 9 volumes deep | High | High | Ruthless MVP-per-volume; the §17.3 shortlist first; each volume ships behind its own acceptance tests |
| Zero-asset purity kept for ideology → fidelity ceiling | High | Medium | Decision §17.5.2 made explicitly and early |
| Art/animation authoring underestimated | High | High | Treat as a first-class staffed line from Phase 0, not an afterthought |
| Multiplayer built too early on an unstable entity model | Medium | Medium | Sequence V13 after Phase 2; lean on determinism to shrink sync surface |
| Live-ops treadmill with no content pipeline | Medium | Medium | Build V15's data-driven expedition/mission framework before shipping any season |
| Solo/tiny-team reality vs a 12–18 person plan | Existential | — | Be honest: at tiny scale, target the §17.3 shortlist and accept "inspired by," not "parity" |

---

## 17.7 Honest verdict

**Can AllMansSky become "the exact same level as No Man's Sky, in all terms, no exception"?** Technically, almost all of it is achievable — none of the sixteen volumes describes something physically impossible in a modern browser with WebGPU and a modest asset pipeline. The engine rebuild is hard but well-trodden (cube-sphere planetary engines are a solved problem in the literature and in shipped games). The systems are "just" a great deal of careful gameplay engineering. Even multiplayer is tractable because our deterministic universe shrinks the sync problem.

**But "no exception" is a scale statement, not a feature statement.** No Man's Sky is the output of ~100+ people over a decade of continuous development, on a bespoke native engine, with gigabytes of authored content feeding its procedural systems. The gap is not any single missing feature — it is the *aggregate*: the depth in every system, the breadth of authored parts behind the "unlimited," the years of live content, and a rendering pipeline built for exactly this. Reaching literal parity is a **7–12 engineer-year program plus multiple art/audio/writing-years and ongoing live-ops** — realistically a funded studio effort over ~3 years, and two strategic concessions (WebGPU; relax zero-asset).

**What is very achievable, and what this report is really for:** a browser-native game that captures 80–90% of the *felt* No Man's Sky experience — round planets you seamlessly land on, living space with combat and asteroids, unlimited scan-and-name life, deep ship/tool progression, base building, a real economy, and a graded, atmospheric look — is a bounded, fundable program. Do Phase 0, commit the two strategic decisions, fund the Engine Track and the §17.3 shortlist in parallel, and you will have something no other browser game is: a genuine No Man's Sky on the open web.

The current v1.0 is a remarkable prototype and the right foundation to have built first. The distance to parity is enormous but mapped. The sixteen volumes that precede this one are the map.

---

*End of Volume 17. Return to [Volume 0 — Executive Summary](./00-executive-summary.md) or the [report index](./README.md).*
