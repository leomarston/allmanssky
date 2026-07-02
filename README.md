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
npm install          # once, for the headless test runner
npm test             # boots the game headless, screenshots, checks for errors
```

## Docs

- [docs/DESIGN.md](docs/DESIGN.md) — game design: lore, factions, resources,
  biomes, ships, survival, art direction
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module contracts and
  engineering conventions

## Controls

Pointer-lock mouse look. On foot: **WASD** move, **Shift** sprint, **Space**
jump / hold jetpack, **F** interact, **V** scan, **LMB** mine/fire, **Tab**
inventory, **M** galaxy map. In ship: mouse steer, **W/S** throttle, **Q/E**
roll, **Shift** boost, **G** land / take off, **J** warp. **Esc** pause.
