# AllMansSky vs. No Man's Sky — honest gap analysis (v1.0)

> **Wave 2 complete.** Every Tier-2 item below is now shipped and headless-verified:
> walkable station interiors with faction crews you can talk to and terminals you
> walk up to (TRADE/SHIPYARD/MISSIONS), a faction mission board + five reputation
> tiers, word-by-word Luminel language gating on lore, economy types + trade routes,
> pulse drive, three save slots, exocraft rover, and photo mode.

## A. Built, but materially different from NMS

| Area | NMS | AllMansSky today | Fixable? |
|---|---|---|---|
| Planets | True spheres; seamless orbit→ground; circumnavigable; continents match from space; moons/planets visible in surface sky; real rotation | Scaled-space theater: display sphere in space, infinite flat heightfield on surface, fog horizon, no correspondence, nothing in surface sky | Engine-level rebuild (quadtree sphere + floating origin) |
| Space↔surface | Zero-cut continuum | Masked scene swap (entry flight hides a fade) | Follows from spherical rebuild |
| Terrain | Voxel isosurface: caves, overhangs, digging (terrain manipulator) | Heightfield y=f(x,z): none of those | Voxel chunk rebuild (self-contained) |
| Embodiment | Visible hands/multitool, cockpit interiors, 3rd person, landing/exit animations | Floating camera, chase-cam ship, no tool model | Tier-1 feature work |
| Water | Swimming, diving, underwater fauna/wrecks, submarine | Visual plane only; walk on seafloor, no swim/drown | Tier-1 feature work |
| Creatures | Ecologies (predation, feeding, taming, riding, companions), per-species catalog, air/water/underground rosters | ~6 body plans, wander/flee/territorial, one-shot scan | Incremental |
| Mining/crafting | Minable terrain, refiners, cooking, farming, element families | Discrete nodes, flat recipes | Incremental |
| Combat | Sentinel wanted levels 1–5 (drones→walkers), pillar sites; space fleet battles, freighter combat | One Warden type + one escalation; one pirate wave pattern | Incremental |
| Economy | Economy types/tiers, trade routes, 3 currencies | 6 economy types ×3 tiers, export/import + trade routes, 1 currency | Incremental (currencies) |
| Progression | Slot-grid tech install w/ adjacency, C/B/A/S classes, procedural modules, ship/multitool acquisition | 6 fixed tracks ×3 levels; can never change ship or tool | Structural UI+data work |
| NPCs/story | Races, word-by-word language learning, dialogue choices, reputation, station interiors, Artemis/Atlas arcs, mission board | Walkable station interiors + wandering faction crew you can speak with, word-by-word Luminel language gating lore, 3-faction reputation (5 tiers), 7-kind mission board, 6-beat Vesper story chain, contract templates | Incremental (branching dialogue) |
| Galaxy meta | Core pilgrimage, star-class warp gating, black-hole shortcuts, portals/glyphs, 255 galaxies | Uniform neighbor-bubble warping; anomalies are set dressing | Incremental |
| Presentation | Volumetric clouds, water reflections, dense grass, rings in surface sky, licensed generative score, photo mode, saves | Stylized low-poly, synth score, free-fly photo mode, three save slots | Incremental |

## B. Missing outright — prioritized

**Tier 1 (highest experience/effort, all feasible now):** cockpit + visible Arcforge + hands · swimming/underwater world · ship purchasing at pads · NMS-style scan-pulse POI markers + waypoints · Warden wanted-level escalation (incl. walker) · refiner + farming · heightfield "dig" modifier layer (craters, not caves)

**Tier 2 — ✅ SHIPPED in Wave 2:** walkable station interiors + faction crew + walk-up service terminals · mission board + faction reputation (5 tiers) · language-learning gate on lore · economy types/trade routes · pulse drive · three save slots · exocraft rover · photo mode. _(Remaining from this tier: slot-grid tech inventory with adjacency bonuses, and ship-boarding interdictions.)_

**Tier 3 (engine bets):** voxel terrain (caves/dig) · true spherical seamless planets · freighters/fleets · multiplayer (needs server)

**Small but felt:** buried tech/drop pods (suit slots), knowledge stones, taming/riding, storm fronts w/ crystal spawns, black-hole traversal, portal network, settlements, derelict-freighter dungeons, difficulty modes.
