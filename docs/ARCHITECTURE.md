# AllMansSky — Architecture & Module Contracts

Read this before writing any module. Modules are built in parallel by different
authors; these contracts are what make them snap together. **Never edit files
outside your assigned ownership. Match these signatures exactly.**

## Ground rules

- Plain ES modules, browser-native, **no build step, no TypeScript, no new deps**.
- `import * as THREE from 'three'` and `three/addons/...` (import-mapped) only.
- **Zero external assets.** All textures via `document.createElement('canvas')`
  (procedural draw → `THREE.CanvasTexture`), all geometry procedural, GLSL
  inline as template strings, audio synthesized via WebAudio.
- **Determinism:** anything world-derived takes a seed and uses `RNG` /
  `SimplexNoise` from core. Never `Math.random()` for world content (fine for
  transient VFX like particle jitter).
- Every scene-graph-owning object exposes `update(dt, ...)` and `dispose()`.
- HDR discipline: emissive colors may exceed 1.0 (e.g. `new THREE.Color(3,2,1)`)
  — bloom threshold is 0.85. Lit PBR albedo stays ≤ 1.
- Space scene units: 1 unit ≈ 1 km, planets radius 40–90, log depth buffer on.
  Surface scene units: 1 unit = 1 m, +Y up, terrain is a heightfield y=f(x,z).
- Code style: JSDoc on exports, small focused functions, no console spam.

## Existing core (do not modify)

- `src/core/engine.js` — `Engine(canvas)`: `.renderer`, `.setScene(scene, cam,
  {bloomStrength,bloomRadius,bloomThreshold})`, `.setExposure(v)`, `.render()`,
  `.tick() → dt`.
- `src/core/input.js` — singleton `input`: `.action(name)`, `.actionPressed(name)`,
  `.keys`, `.mouseDX/.mouseDY`, `.wheelDelta`, `.mouseDown[b]`, `.mouseClicked[b]`,
  `.requestPointerLock()`, `.pointerLocked`, `.endFrame()`.
- `src/core/rng.js` — `hash32(...ints)`, `hashString(s)`, `mulberry32(seed)`,
  `RNG(seed)`: `.next() .range(a,b) .int(a,b) .chance(p) .pick(arr)
  .gaussian(m,s) .fork(label)`.
- `src/core/noise.js` — `SimplexNoise(seed)`: `.noise2D .noise3D .fbm2 .fbm3
  .ridged2 .warped2`.
- `src/core/events.js` — singleton `events`: `.on/.once/.off/.emit`. Event names
  documented in the file header.

## Data model (single source of truth)

### `src/universe/galaxy.js`
```js
export const GALAXY_SEED_DEFAULT = 1337;
export class Galaxy {
  constructor(seed)
  starsInSector(sx, sy, sz) // → [StarStub]; deterministic; 0–4 stars/sector,
                            // density falls off with |sector| (disc: |sy| thin)
  getSystem(starId)         // → StarSystem (cached); accepts StarStub.id
  neighborsOf(starId, radiusSectors = 3) // → [StarStub] sorted by distance
  startingSystemId()        // deterministic pleasant G-class start w/ lush planet
}
// StarStub: { id: 'sx:sy:sz:i', seed, name, pos: THREE.Vector3 (sector coords,
//             1 sector = 1 unit), starClass, starColorHex }
```

### `src/universe/starsystem.js`
```js
export function generateSystem(stub, galaxySeed) // → StarSystem
// StarSystem: {
//   id, seed, name, faction: 'meridian'|'chorale'|'sunward'|'ashen'|'none',
//   star: { class:'M'|'K'|'G'|'F'|'A'|'B'|'O'|'exotic', colorHex, radius(units),
//           temperature },
//   planets: [PlanetDef],           // 1–6
//   belt: null | { radius, width, density },
//   station: null | { name, faction, orbitRadius, angle },
//   anomaly: null | { kind:'derelict'|'blackhole'|'wormhole', orbitRadius, angle },
//   pirateThreat: 0..1
// }
```

### `src/universe/biomes.js`
```js
export const BIOMES = { lush: {...}, swamp: {...}, desert: {...}, frozen: {...},
  volcanic: {...}, toxic: {...}, irradiated: {...}, ocean: {...},
  crystal: {...}, barren: {...}, exotic: {...} };
// each: { name, weight, paletteRanges, hazard: {heat,cold,toxic,rad},
//   weatherSet, floraDensity:[min,max], faunaDensity:[min,max],
//   resourceBias: [itemIds], terrain: {relief, seaBias, ...} }
export function rollPlanetDef(rng, systemCtx, index) // → PlanetDef
// PlanetDef: {
//   id, seed, name, biome, radius(40..90), orbitRadius, orbitPhase, orbitSpeed,
//   axialTilt, dayLength(s, 300..1200), gravity(0.4..1.8),
//   seaLevel(0..0.45, 0=no sea),
//   atmosphere: { density(0..1), colorHex, skyColorHex, fogColorHex },
//   clouds: { coverage(0..1), colorHex } | null,
//   rings: { innerR, outerR, colorHex, opacity } | null,
//   hazard: { heat, cold, toxic, rad },   // each 0..1
//   weather: 'clear'|'rain'|'toxicrain'|'snow'|'sandstorm'|'thunder'|'ashfall',
//   palette: { deepWater, shallowWater, shore, low, mid, high, peak, cliff,
//              accent, glow },            // hex strings
//   resources: [itemId],                  // 3–5 biased by biome
//   floraDensity, faunaDensity, crystalDensity, // 0..1
//   hasRuins: bool, hasOutpost: bool,
//   terrain: { relief(0..1), roughness(0..1), warp(0..1), plateau(0..1),
//              crater(0..1), canyon(0..1) }
// }
```

### `src/universe/terrainfield.js` — THE height authority
```js
export class TerrainField {
  constructor(planetDef)
  height(x, z)        // metres; sea level is a horizontal plane at this.seaY
  normal(x, z, eps=1) // → THREE.Vector3
  get seaY()          // world Y of the sea plane (or -Infinity if none)
  moisture(x, z)      // 0..1 slow-varying — drives flora placement & tinting
  cellRng(cx, cz, salt) // → RNG for deterministic per-64m-cell placement
}
```
Used by BOTH the terrain renderer and all gameplay physics. Height blends biome
features from `def.terrain` (ridged mountains, warped continents, plateaus,
canyons, craters); amplitude ~ `relief * 90m`, feature wavelengths 100–2000 m.

### `src/universe/lore.js`
```js
export function systemName(rng), planetName(rng), creatureName(rng),
  stationName(rng, faction), npcName(rng, faction), shipName(rng),
  ruinLore(rng)      // → { title, text } Luminel beacon fragments (~2 sentences)
export const FACTIONS = { meridian: {name, blurb, colorHex}, chorale: {...},
  sunward: {...}, ashen: {...} };
export function greeting(rng, faction) // NPC bark lines
```

## Render modules

All take plain params, return objects owning THREE objects, and expose
`update()`/`dispose()`. None reads game state or input; none touches UI.

### `src/render/starfield.js`
```js
export function createStarfield(seed) // → { object3d, update(dt, camQuat?) }
// far-shell galaxy backdrop: milky-way band + colored point stars w/ twinkle,
// canvas-texture skysphere. Must look stunning as the space-scene backdrop.
export function createNebulaField(seed) // → { object3d, update(dt) }
// clustered additive billboards from procedural canvas noise; HDR tints.
```

### `src/render/sun.js`
```js
export function createSun(star /* StarSystem.star */) // → { object3d, light,
//   update(dt, cameraPos) }
// animated surface shader + corona billboards + HDR glow that feeds bloom;
// `light` is the system's key light (add to scene separately).
```

### `src/render/planetmesh.js`
```js
export function createPlanetVisual(def /* PlanetDef */, opts = {})
// → { group, update(dt, cameraPos, sunDir), dispose() }
// space-view planet: sphere whose fragment shader raises 3D-noise terrain
// coloring from def.palette (continents/sea/ice caps per biome), + night-side
// darkening; add clouds/atmosphere/rings via sibling modules internally.
```
`src/render/atmosphere.js`: `createAtmosphere(radius, atmoDef)` → rim-scattering
shell (backside additive fresnel). `src/render/clouds.js`:
`createCloudLayer(radius, cloudsDef, seed)`. `src/render/rings.js`:
`createRings(ringsDef, seed)`. Each returns `{ object3d, update(dt, sunDir?) }`.

### `src/render/terrain.js`
```js
export class TerrainRenderer {
  constructor(scene, planetDef, field /* TerrainField */)
  update(dt, focusPos) // stream 64m chunks in rings (view dist ~800m), LOD by
                       // distance, vertex colors from palette+moisture+slope,
                       // sea plane w/ animated shader if seaLevel>0
  dispose()
}
```

### `src/render/sky.js`
```js
export class SkyDome {
  constructor(scene, planetDef)
  update(dt, sunElevation /* -1..1 */, camPos) // gradient dome shader (day/
  // sunset/night from atmosphere colors), sun disc + HDR halo, night starfield,
  // scene fog matched to horizon. Exposes .sunDir (THREE.Vector3), .light
  // (directional), .ambient.
  dispose()
}
```

### `src/render/flora.js`
```js
export class FloraSystem {
  constructor(scene, planetDef, field)
  update(dt, focusPos) // instanced vegetation/crystals per 64m cell around
                       // player using field.cellRng; biome family shapes;
                       // emissive accents on crystal/exotic/night flora
  dispose()
  collectableAt(pos, radius) // → nearest {id, itemId, position} carbyne-bearing
  removeInstance(id)
}
```

### `src/render/props.js`
```js
export function createRuin(rng), createBeacon(rng), createOutpost(rng, faction),
  createCrashedShip(rng), createResourceNode(itemId, rng), createLandingPad(rng)
// each → { object3d, interactRadius, kind } — placed by the surface state.
// Resource nodes: chunky crystal/ore meshes tinted by item color, emissive.
```

### `src/render/creature.js` + `src/gameplay/creatures.js`
```js
export function buildCreature(seed, biome) // render: → { group, animate(dt,
//   speed01), profile: { size, speed, temperament:'docile'|'skittish'|'territorial',
//   diet, name } } — procedural bodies: torso spine + 2/4/6 legs | serpent |
//   floater w/ tentacles | winged; palette from seed; idle/walk cycle via
//   per-limb transform animation (no skeletons).
export class CreatureSystem { // gameplay
  constructor(scene, planetDef, field)
  update(dt, playerPos)  // spawn ≤ 12 within 300m, wander/flee/chase AI,
                         // gravity-stick to field.height
  scanNearest(pos, range) // → {name, profile, position} | null
  dispose()
}
```

### `src/render/shipmesh.js`
```js
export function buildShip(seed, shipClass /* 'swift'|'talon'|'dray'|'prospect'|'vanta' */)
// → { group, engineGlows: [Mesh], profile: {class, name} }
// modular procedural ships: fuselage + cockpit canopy + wings/pods per class,
// PBR materials w/ seed-tinted paint + decal-ish canvas texture, HDR engine
// nozzles (glow meshes whose material.emissiveIntensity the flight code drives).
export function buildStation(seed, faction) // → { group, dockPos: Vector3, update(dt) }
```

### `src/render/effects.js`
```js
export class EffectsSystem {
  constructor(scene)
  update(dt)
  engineTrail(followObj, colorHex)      // → handle { setLevel(0..1), dispose() }
  explosion(pos, scale=1, colorHex?)
  sparks(pos, normal, colorHex?)
  miningBeam(from, to, colorHex)        // → handle { set(from,to), off() }
  warpTunnel(camera)                    // → handle { setLevel(0..1), dispose() }
  landingDust(pos)
  laserBolt(from, dir, speed, colorHex) // → tracked projectile { position, alive }
  dispose()
}
```

## Audio — `src/audio/audio.js`
```js
export const audio = {
  init(),                       // call on first user gesture
  setScene(kind, mood = {}),    // 'menu'|'space'|'surface'; mood: {biome, danger}
  sfx(name, opts = {}),         // 'click','hover','confirm','deny','scan','scanDone',
    // 'mine','mineHit','collect','craft','laser','boltHit','explosion','hurt',
    // 'jetpack','land','takeoff','warp','dock','notify','discovery','death'
  engine(level0to1),            // continuous ship engine loop follows throttle
  setMuted(bool), muted,
};
```
Generative ambient: slow synth pad progressions per scene/biome + sparse motifs;
space = vast/cold, lush = warm, danger raises tension. All WebAudio, no samples.

## UI — DOM overlay in `#ui-root`

`src/ui/widgets.js`: `el(tag, cls, parent?)`, `statBar(label, colorVar)` →
`{root, set(v01, text?)}`, `iconSVG(name)` (inline SVG path set: health, shield,
o2, energy, jetpack, lumens, cargo, warp, scan, temp, rad, tox, compass...).
`src/ui/notifications.js`: listens `events.on('notify')` → toast stack; also
`discovery` banners. `src/ui/hud.js`: `class HUD` — `setMode('foot'|'ship'|
'space'|'hidden')`, `update(dt, snapshot)` where snapshot = `{ health, shield,
oxygen, energy, jetpack, lumens, speed, altitude, fuel, warpCharges, hazardIcons,
compassDeg, target?, reticle:'dot'|'ship'|'interact', interactLabel? }`.
`src/ui/screens.js`: `class Screens` — full-screen overlays: `mainMenu(opts)`,
`pause()`, `settings()`, `dead()`; promise/callback based; Esc handling;
holographic glass theme per DESIGN.md. `src/ui/style.css`: complete theme
(CSS vars: `--ui-cyan #7de8ff, --ui-amber #ffb454, --ui-red #ff5470,
--ui-green #7dffb4`; panels: rgba(8,20,28,.72) + 1px cyan borders + backdrop
blur; scanline overlay class; keyframes for pulse/flicker/slide).

## Game states (integration layer — owned by integrator, not module agents)

`src/main.js`: Game class, state machine `menu → space ⇄ surface`, debug URL
params (`?state=space|surface&seed=N&biome=lush`) for headless testing.
`src/states/spacestate.js`, `src/states/surfacestate.js`,
`src/gameplay/shipcontrol.js`, `src/gameplay/player.js` — integrator-owned.
Gameplay systems (inventory, crafting, mining, survival, combat, trading,
quests, bases, saves) land in fan-out #2 with their own contracts.

## Testing

`node test/smoke.mjs [path] [shotName] [waitMs]` boots headless Chromium
(SwiftShader), fails on console errors, screenshots to `test/screenshots/`.
Every module must import cleanly with zero console errors. Set
`window.__AMS__.ready = true` only from main.js.
