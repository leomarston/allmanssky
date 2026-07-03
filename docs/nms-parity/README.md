# AllMansSky → No Man's Sky Parity Report

An exhaustive, engineering-grade audit of everything AllMansSky (`v1.0`) is missing versus No Man's Sky, and a concrete, sequenced plan to close every gap — system by system, feature by feature, with data models, algorithms, shader/pseudocode sketches, module-level file plans, effort estimates in engineer-weeks, and headless acceptance criteria.

The report is split into **18 volumes**. Each domain volume is a self-contained deep-dive (~4,000–6,000 words / ~15–30 printed pages) that a feature team can pick up and execute. Read the **Executive Summary** first, then the **Roadmap**, then the domain volumes in any order.

## How to read

1. **[Volume 0 — Executive Summary, Methodology & Parity Scorecard](./00-executive-summary.md)** — the honest verdict, the 0–10 parity scorecard across all domains, the five headline gaps, and the one architectural fact that governs everything (the engine is the gate).
2. **[Volume 17 — Engineering Roadmap, Phasing, Effort & Verdict](./17-roadmap.md)** — the sequenced program: dependency graph, five-phase plan, the "if you only do five things" shortlist, the effort/team model (~7–12 engineer-years + art/audio/writing), the three strategic decisions, the risk register, and the feasibility verdict.
3. The domain volumes below.

## The volumes

| Vol | Title | Parity | Theme |
|---|---|:--:|---|
| **0** | [Executive Summary, Methodology & Scorecard](./00-executive-summary.md) | — | Framing & verdict |
| **1** | [Graphics & Rendering](./01-graphics-and-rendering.md) | 2/10 | *User's #1 priority.* PBR, GI, TAA, volumetrics, water, foliage, post; WebGPU migration |
| **2** | [Spherical Planets & Seamless Space↔Surface](./02-spherical-planets.md) | 1/10 | **The engine gate.** Cube-sphere LOD, floating origin, round worlds, circumnavigation |
| **3** | [Voxel Terrain & Manipulation](./03-voxel-terrain.md) | 1/10 | SDF/voxel meshing, caves/overhangs, terrain edit + persistence |
| **4** | [Universe Scale, Galaxy & Meta-progression](./04-universe-scale.md) | 3/10 | 18-quintillion address space, 256 galaxies, portals/glyphs, core pilgrimage |
| **5** | [Flora, Fauna & Unlimited Procedural Life](./05-flora-fauna.md) | 2/10 | Genome recombination, ecology, taming/breeding/companions, discovery registry |
| **6** | [Space Flight, Combat & Enemy AI](./06-space-combat-ai.md) | 2/10 | *Highest ROI.* Dogfighting AI, pirate/Sentinel waves, asteroids, freighter battles |
| **7** | [Ships, Multitools, Exocraft & Exosuit](./07-ships-tools-exocraft.md) | 3/10 | Classes/archetypes, slot-grid + adjacency + supercharged, exocraft roster |
| **8** | [Base Building & Settlements](./08-base-building.md) | 3/10 | Part catalog, power/logic graph, farming, freighter bases, settlements sim |
| **9** | [Economy, Crafting, Refining & Progression](./09-economy-crafting.md) | 3/10 | Three currencies, supply/demand market, recipe graph, cooking, guilds |
| **10** | [NPCs, Factions, Language, Story & AI](./10-npcs-factions-story.md) | 3/10 | Races, branching dialogue, language depth, main-arc story, mission generator |
| **11** | [Weather, Hazards, Survival & Game Modes](./11-survival-hazards-modes.md) | 3/10 | Environment model, hazard web, extreme storms, mode matrix (Creative→Permadeath) |
| **12** | [Audio & Generative Music](./12-audio-music.md) | 3/10 | Adaptive layered music, spatialization/reverb, creature vocals, hybrid stems |
| **13** | [Multiplayer & Networking](./13-multiplayer.md) | 0/10 | Co-op, discovery registry, social hub, replication over deterministic worldgen |
| **14** | [UI/UX, Photo Mode & Accessibility](./14-ui-ux-photo-accessibility.md) | 4/10 | Analysis visor + catalog, galaxy-map filters, quick-menu, accessibility matrix |
| **15** | [Expeditions, Live Content & Endgame](./15-expeditions-liveops-endgame.md) | 1/10 | Expedition framework, Nexus loop, endgame metagames, update cadence |
| **16** | [Content Pipeline, Determinism & Asset Budget](./16-content-pipeline-assets.md) | 3/10 | The zero-asset wall; the minimal authored-part pipeline; streaming & determinism |
| **17** | [Engineering Roadmap, Phasing, Effort & Verdict](./17-roadmap.md) | — | The plan, the team, the cost, the verdict |

## The one-paragraph verdict

AllMansSky v1.0 is a remarkable **vertical-slice tribute** — roughly **15–20% of No Man's Sky's realized scope and a smaller fraction of its fidelity** — built in ~22,900 lines of asset-free browser JavaScript. It reproduces the silhouette of the experience but almost every system is a scaled-down theatrical stand-in. The single fact governing all remediation: NMS is one continuous 64-bit floating-origin universe of streamed voxel spheres, and AllMansSky is a state machine of disconnected scenes (a display-sphere planet + an infinite flat heightfield joined by a masked fade). **~40% of the remaining gap is gated behind a spherical/voxel engine rebuild** (Volumes 2–3), which must come first. Reaching literal "same level, no exception" is a **~7–12 engineer-year program plus multiple art/audio/writing-years and ongoing live-ops**, and hinges on two strategic concessions: **adopt WebGPU** for AAA rendering, and **relax the zero-asset purity** into a small authored-part library that is still seed-recombined the way NMS does it. Capturing **80–90% of the *felt* experience** — round planets you seamlessly land on, living space combat, unlimited scan-and-name life, deep progression, base building, a real economy, and a graded atmospheric look — is a bounded, fundable program. Volume 17 sequences it.

---

*Generated as a standalone report under `docs/nms-parity/`. Every "current state" claim is traceable to a real module under `src/`. Effort figures are planning-grade engineer-time, exclusive of art/audio/writing (called out separately in Volumes 16–17).*
