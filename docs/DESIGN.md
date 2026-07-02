# AllMansSky — Game Design Document

A browser-native, open-world procedural space exploration game. WebGL2 + three.js,
no build step, everything procedurally generated from a single universe seed.
Tone: luminous, melancholy wonder — an ocean of stars that remembers a vanished
civilization. **Not** a No Man's Sky clone: original lore, factions, resources,
progression, art direction.

## Identity & Lore

- **Setting:** the **Aurelia Reach**, a spiral galaxy scarred by the disappearance
  of the **Luminel** — a precursor race who "folded themselves into light."
  They left **Beacons**: monolithic ruins that whisper coordinates and grant
  technology to those who listen.
- **Player:** a **Wayfarer** — an independent pilot woken from cryo-drift by a
  recurring signal, **the Vesper Signal**, that always points one warp deeper
  into the galaxy. Following it is the spine of progression.
- **Factions:**
  - **Meridian Combine** — industrial trade cartel. Stations, contracts, credits.
  - **Choir of Glass** — mystics who study Luminel Beacons. Lore, upgrades.
  - **Sunward Kin** — nomad clans, shipwrights. Ship classes, flight tech.
  - **The Ashen Fleet** — raiders burning the Reach's edges. Space combat antagonist.
  - **Wardens** — self-replicating Luminel custodian machines that police planets.
    Provoked by over-mining. Ground combat antagonist.
- **Currency:** **Lumens** (⌾) — crystallized light, the Reach's universal tender.
- **Player tool:** the **Arcforge** — modular forearm unit: mining beam, bolt
  caster, scanner, terrain torch.

## Resources (original periodic-fiction table)

| id | Name | Kind | Found | Use |
|---|---|---|---|---|
| ferrox | Ferrox | metal | rocks everywhere | structural crafting |
| carbyne | Carbyne | organic | flora | life support, fuel mix |
| oxylite | Oxylite | gas-crystal | red crystals | oxygen refill |
| silica | Silica | mineral | sand/rock biomes | glass, circuits |
| pyrene | Pyrene | fuel | yellow crystals | launch fuel |
| voidsalt | Voidsalt | exotic | asteroids, caves | warp cells |
| aurium | Aurium | precious | deep deposits | high-value trade, tech |
| cryostal | Cryostal | precious | frozen biomes | cooling tech |
| solanite | Solanite | precious | volcanic biomes | weapon tech |
| chlorophane | Chlorophane | precious | lush/swamp biomes | bio tech |
| voltglass | Voltglass | precious | storm/crystal biomes | shield tech |
| nebulite | Nebulite | exotic | anomalies, derelicts | exotic upgrades |

Compounds (crafted): **Ferroweave** (ferrox+carbyne), **Lumin Glass**
(silica+pyrene), **Weave Circuit** (silica+voltglass or aurium), **Void Cell**
(voidsalt+lumin glass) → warp fuel, **Stim Gel** (chlorophane+carbyne) → heal,
**Aegis Cell** (voltglass+ferrox) → shield recharge.

## Biomes (11)

lush, swamp, desert, frozen, volcanic, toxic, irradiated, ocean, crystal,
barren, exotic. Each defines palette ranges, hazard profile, weather set, flora
family, fauna density, resource bias. Exotic = rule-breakers (floating shards,
glass seas, monochrome). Every planet draws a palette from its biome's ranges
via its seed — no two planets identical.

## Hazards & Survival

Suit systems: **Health**, **Shield** (recharges), **Oxygen** (drains in thin/no
atmosphere, refills from Oxylite), **Suit Power** (thermal/rad/toxin protection
drain; refills from Pyrene/sunlight), **Jetpack charge**. Hazards by biome:
heat, cold, toxicity, radiation, storms that multiply drain. Depleted oxygen →
health drain → death → respawn at ship/base with inventory intact (grace) but
hull scratch.

## Ships

Classes: **Swift** (explorer, balanced), **Talon** (fighter, agile + guns),
**Dray** (hauler, cargo), **Prospect** (miner, beam + cargo), **Vanta** (exotic,
endgame). Stats: hull, shield, speed, agility, cargo slots, weapon mounts.
Upgrades: engines, shields, weapons, warp range, cargo. Fuel: Pyrene for
launches; Void Cells for warp jumps.

## Core Loop

land → explore/scan/mine → survive hazards → craft/refuel → discover ruins &
lore → trade at stations → upgrade ship/suit/tool → warp deeper along the
Vesper Signal → repeat, with combat (Wardens, Ashen pirates) and base-building
as pressure valves. Discoveries (planets, species, ruins) grant Lumens when
uploaded from the scanner.

## Space Layout

Galaxy of ~10^7 reachable stars on a seeded 3D sector grid. Each system: 1 star
(class M/K/G/F/A/B/O or exotic), 1–6 planets on circular orbits, optional
asteroid belt, optional Meridian station, occasional anomaly (black hole,
derelict, wormhole). Warp range limits reachable neighbors; the galaxy map
shows the local bubble.

## Art Direction

- **Space:** deep blacks, HDR star glow, saturated nebula fields, rim-lit
  planets with visible atmospheres — every frame should look like a poster.
- **Surface:** stylized-realistic terrain, strong fog + aerial perspective,
  saturated biome palettes, emissive crystals/flora accents, dramatic skies.
- **UI:** holographic glass — thin cyan (#7de8ff) strokes on smoked glass,
  amber (#ffb454) warnings, uppercase letterspaced type, subtle scanline sheen.
- **Bloom discipline:** emissive HDR colors (values > 1) are reserved for light
  sources: stars, engines, beams, crystals, UI holograms in-world.

## Controls

Pointer lock mouse-look everywhere. On foot: WASD run, Shift sprint, Space
jump/hold jetpack, F interact, V scan, LMB mine/fire, R swap tool mode, Tab
inventory, B build, M map. Ship: mouse steer, W/S throttle, Q/E roll, Shift
boost, Space/C vertical, G land/take off, J warp (map), F dock. Esc pause.
