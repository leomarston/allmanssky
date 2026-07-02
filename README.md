# AllMansSky

An open-world procedural space exploration game that runs natively in the
browser. One seed generates a galaxy: fly a ship between stars, drop through
atmospheres onto procedurally generated planets, explore on foot, mine, craft,
trade, fight, build — and follow the Vesper Signal deeper into the Aurelia
Reach.

Built with WebGL2 + three.js. **No build step, no external assets** — every
texture, mesh, sound, and world is generated procedurally at runtime.

## Run

```bash
npm start            # serves on http://localhost:8087
```
(or any static file server from the repo root)

## Test

```bash
npm install                 # once, for the headless test runner
npm test                    # boots the game headless, screenshots, checks errors
node test/journey.mjs       # full loop: menu → space → land → walk → takeoff → warp
node test/perf.mjs          # draw calls / triangles / resource audit per state
node test/smoke.mjs "/index.html?state=surface&biome=lush&tod=0.15" shot 12000
                            # debug boots: ?state= ?biome= ?tod= ?seed= ?system=
```
Module test pages live in `test/pages/` — each renders one subsystem in
isolation (planets, terrain, creatures, ships, UI, galaxy map…).

## Docs

- [docs/DESIGN.md](docs/DESIGN.md) — game design: lore, factions, resources,
  biomes, ships, survival, art direction
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module contracts and
  engineering conventions

## Controls

Pointer-lock mouse look. On foot: **WASD** move, **Shift** sprint, **Space**
jump / hold jetpack, **F** interact, **V** scan, **LMB** mine/fire, **R** swap
Arcforge mode (beam/bolts), **T** headlamp, **B** build mode, **Tab**
inventory, **M** galaxy map. In ship: mouse steer, **W/S** throttle, **Q/E**
roll, **Shift** boost, **LMB** lasers/mining beam, **G** land / take off,
**F** dock, **J** warp (needs a Void Cell). **Esc** pause.
