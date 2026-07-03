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
npm start            # serves on http://localhost:8087 (zero dependencies)
```
(or any static file server from the repo root)

## Deploy (Railway)

The repo ships a `Dockerfile` (Node 22 + the zero-dependency `server.mjs`,
which respects Railway's injected `$PORT`, gzips assets, and long-caches
`vendor/`). No build step, no npm install.

1. [railway.com](https://railway.com) → **New Project → Deploy from GitHub repo**
   → pick this repository.
2. In the service **Settings → Source**, choose the branch to deploy.
   Railway auto-detects the `Dockerfile`.
3. **Settings → Networking → Generate Domain** — the game is live at that URL.

Any other Docker host works the same way:
`docker build -t allmanssky . && docker run -p 8087:8087 allmanssky`

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

Mouse look: click once to capture the mouse (a prompt shows until captured);
**dragging with the button held** and the **arrow keys** also steer, so the
game stays controllable even where pointer lock is unavailable.
On foot: **WASD** move, **Shift** sprint, **Space**
jump / hold jetpack, **F** interact, **V** scan, **LMB** mine/fire, **R** swap
Arcforge mode (beam/bolts), **T** headlamp, **B** build mode, **P** photo mode, **N** summon/board exocraft, **Tab**
inventory, **M** galaxy map. In ship: mouse steer, **W/S** throttle, **Q/E**
roll, **Shift** boost, **LMB** lasers/mining beam, **G** land (low over ground) / take off,
**X** pulse drive, **J** warp (needs a Void Cell). **Esc** pause.
Enter a planet's atmosphere with **G** from space — you keep flying; land where
you like, and climb high to leave the atmosphere back into space.

**Stations.** Fly close to a station and press **F** to *disembark* — you step out
onto the deck of a walkable hangar. Walk up to the holographic **TRADE**,
**SHIPYARD**, and **MISSIONS** terminals to use them, chat with the wandering
faction crew (**F**), then board your parked ship (**F**) to launch back into
space. **H**/**K** still quick-open the shipyard/mission board straight from the
cockpit if you'd rather not leave your seat.
