# Volume 2 — Spherical Planets & Seamless Space↔Surface

**Scope and headline verdict.** This is the flagship chapter and the master dependency: the Executive Summary scores this domain **1/10** and names it the single gate behind roughly 40% of the remaining feature gap. No Man's Sky's defining technical achievement is not any one shader or biome — it is that a planet is *one object*, continuously rendered from a million kilometers away down to a boot print, with a floating-origin camera and a cube-sphere LOD quadtree doing the work invisibly. AllMansSky has two objects that are never the same one: a decorative UV-sphere in space (`src/render/planetmesh.js`) and an infinite flat plane on the ground (`src/universe/terrainfield.js` + `src/render/terrain.js`), joined by a screen fade and a full state-machine teardown/rebuild (`src/states/spacestate.js` ⇄ `src/states/surfacestate.js`). This volume specifies the rebuild that fuses them into one continuous, curved, streamed world, coordinated with **Volume 3** (voxel terrain, which must be expressed relative to this sphere, not `-Y`) and unblocking large parts of Volumes 1, 4, 5, 6, and 8.

---

## 1. What No Man's Sky Does (Exhaustive/Technical)

**Sphere representation: cube-sphere over icosphere/UV-sphere.** NMS represents each planet as a **cube-sphere** — six quadtrees, one per cube face, each face warped onto the unit sphere by a non-linear cube→sphere mapping (e.g. `s = x·sqrt(1 − y²/2 − z²/2 + y²z²/3)` applied per axis) chosen specifically to reduce the area/angle distortion that a naive per-axis normalization (`normalize(cubePoint)`) leaves behind near the cube edges. This beats a UV-sphere (latitude/longitude grid), which has two degenerate poles where a full ring of triangles collapses to a point — catastrophic for a streaming quadtree, since "how many chunks touch this vertex" stops being a small constant near the poles. It also beats a naive icosphere for *this specific job*: icosphere subdivision is seam-free and low-distortion, but its 20-triangle base and non-power-of-4 child counts make integer chunk addressing, neighbor-finding, and LOD-level arithmetic meaningfully harder than a cube-sphere's simple `(face, level, i, j)` grid, where every face is just a quadtree over `[0, 2^level) × [0, 2^level)`.

**Quadtree LOD chunking.** Each face's root chunk recursively splits into four children when the projected screen-space error of its current resolution exceeds a threshold, and merges back when the camera retreats. This is the standard **chunked LOD** technique (in the lineage of geometry clipmaps and CDLOD): geometric error (how much detail this LOD level fails to represent) is projected through the camera's field of view to estimate the resulting error in *pixels*, not world units, so LOD selection stays visually consistent at any altitude — the same logic that decides "split this chunk" at 50 m AGL over rough terrain also decides "split this chunk" at 50 km AGL over a whole continent. **Cracks and seams** between chunks whose neighbors are one LOD level coarser are hidden with a combination of **skirts** (extra downward-facing apron geometry at chunk borders that fills any gap regardless of the neighbor's resolution) and **vertex morphing** (border vertices interpolate toward their position in the next-coarser LOD as the split threshold approaches, so a split/merge event doesn't pop visibly).

**Floating origin & the 32-bit float problem.** A planet a few kilometers in radius, in a system tens of thousands of kilometers across, in a galaxy of ~400 billion star systems, cannot be rendered from one fixed world origin at single (32-bit) floating-point precision — a 32-bit float has ~7 significant decimal digits, so a vertex 100,000 units from the origin already carries only centimeter-to-meter precision, and the *composition* of model/view/projection matrices multiplies that error further, producing visible vertex jitter, z-fighting, and shimmering geometry long before you'd naively expect precision loss. The universal fix is **floating-origin (camera-relative) rendering**: the game's authoritative world state is kept in double precision (64-bit), but every object's position is re-expressed *relative to the camera* — a small delta — immediately before it reaches the GPU, which only ever sees small, precision-safe numbers. Practically this means periodically "rebasing": when camera drift from the last rebase point exceeds a threshold, the engine subtracts the camera's true position from every tracked double-precision position and resets the camera's render-space position to (0,0,0) (or near it). Nothing the GPU ever touches is allowed to be a large number.

**Seamless orbit → atmosphere → surface, with no cut.** Because the sphere, the camera, and the floating-origin frame are all one continuous system, "landing" is not an event — it is a continuously decreasing altitude value driving continuously increasing LOD detail (the quadtree splits more chunks near the camera as you descend) and a continuously blending atmosphere shader (see below). There is no loading screen, no scene teardown, no swapped camera. Cosmetic entry-heating effects (screen shake, particle streaks, glow) are an overlay on top of unchanged physics, not a disguise for a hidden state transition.

**Gameplay-scaled planet radius.** NMS's planets are *not* astronomically scaled — community measurement and datamining consistently put planet radii on the order of a few kilometers (walking circumnavigation on foot takes roughly 20–40 real-world minutes depending on terrain and planet size setting), not the thousands of kilometers of a real rocky planet. This is a deliberate, load-bearing compromise: a true-to-life radius would make horizon curvature imperceptible from human eye height (you'd need to be dozens of kilometers up before the curve became visible) and would make circumnavigation a many-hour or many-day undertaking even by ship, defeating the "explore a whole world" fantasy the game sells. The cost of the compromise is physically incoherent gravity (a body that small shouldn't hold an atmosphere or produce ~1g surface gravity) — NMS simply doesn't simulate real gravitation and accepts the incongruity as invisible in normal play.

**Horizon curvature.** Because the radius is deliberately small, curvature is visible at modest altitude (hundreds of meters) rather than requiring high-altitude flight — this is a direct, intentional consequence of the scale compromise above, not an incidental rendering detail.

**Circumnavigation and poles.** Because the mesh is a cube-sphere quadtree rather than a lat/lon UV-sphere, there is no special-cased "north pole" or "south pole" code path anywhere in terrain generation, texturing, or streaming — a pole is just an ordinary vertex shared by three chunk quadrants across two adjoining cube faces, generated by the exact same noise/biome/prop-placement logic as the equator. Walking a great-circle route (including through a pole) is topologically unremarkable; the only engineering care required is at the twelve cube edges and eight cube corners, where adjacent faces' quadtrees must agree on chunk boundary resolution (or use the skirt/morph scheme above) so no crack opens at a face seam.

**Atmosphere rendered from outside and inside.** The same physically-motivated scattering model (an analytic Rayleigh + Mie approximation, cheaper than a full Bruneton/Preetham integration but sharing its structure) is evaluated from two different camera situations: from orbit, the ray from the camera to the planet's limb passes through a thin grazing slice of atmosphere, producing the characteristic **rim glow / limb haze**; from the ground, the camera is *inside* the shell, so the same scattering integral evaluated along rays toward the sky dome produces the full-sky gradient, sunset reddening, and haze players see when grounded. Because it is the same function with a different view origin, the transition through the shell boundary is continuous by construction — there is no seam between "space sky" and "ground sky" because there was never a second, independently authored shader.

**Rings, moons, and sibling planets visible in the surface sky, with real parallax.** Every celestial body in a system — the star, sibling planets, moons, rings, other players' or NPC ships and freighters — shares the same floating-origin double-precision coordinate frame as the camera, updated by the same orbital simulation whether you're in orbit or standing on the ground. Standing on a planet's surface and looking up therefore shows the *actual*, currently-true positions of everything else in the system: a near moon visibly drifts against the far starfield as you walk (true parallax, not a fixed-distance billboard), a ringed neighbor's rings correctly foreshorten by viewing angle, and a planet's own rings cast a moving shadow band across the ground as the planet rotates through them. None of this is separately authored for the "in-sky" case — it falls out of one coordinate system being used everywhere.

**Biome/height mapping on a sphere.** Continent shape, mountain ridges, and biome macro-variation are generated by 3-D noise (domain-warped fbm, ridged multifractal) sampled **directly on the sphere's surface** — at `dir · (radius + amplitude terms)` for a unit direction `dir`, not by generating a 2-D heightmap and projecting/wrapping it onto the sphere (which would produce seams at the wrap edges and pole pinching identical to a UV-sphere's texture problems). Latitude-band effects (polar ice caps, climate zonation, biome blending by temperature) read `dir`'s component along the planet's rotation axis (after axial tilt) — `latitude = asin(dir · axis)` — which is well-defined and singularity-free at every point on the sphere, including exactly at the poles.

**Water as a sea-level sphere.** Oceans are a second, larger concentric sphere (or the same cube-sphere quadtree structure evaluated at a fixed sea radius) sharing the planet's LOD/floating-origin system — so a sea recedes to a curved horizon and reveals more of itself as you gain altitude exactly like land does, rather than being an infinite flat plane that never curves.

**Chunk streaming budget & threading.** Terrain generation (density/height evaluation, and for near chunks the volumetric meshing described in Volume 3) is expensive per chunk and is dispatched to background worker/job threads, with the main thread's per-frame budget spent only on GPU buffer upload and scene-graph attach/detach of already-built chunks. This is what lets the streaming radius be large (dozens of chunk rings to a visible horizon) without a frame-time cliff when the camera crosses a chunk boundary.

**Collision on streamed chunks.** Physics collision reads from the same chunk data that gets rendered — a heightfield-style analytic sample for coarse, distant chunks (cheap, adequate when nothing overhangs) and true mesh/SDF collision for near chunks where caves and overhangs exist (Volume 3's domain) — so what is rendered is what can be stood on, mined into, or crashed a ship against, with no separate simplified collision authority to fall out of sync with the visuals.

---

## 2. What AllMansSky Has Today (Cited)

**A decorative UV-sphere prop, not a walkable world.** `createPlanetVisual(def, opts)` in `src/render/planetmesh.js:299-431` builds one fixed-resolution `THREE.SphereGeometry(radius, segments, segments*0.7)` (`segments` clamped 64–96, so up to ~96×67 quads — a classic UV-sphere, poles included) with a `ShaderMaterial` whose vertex shader (`PLANET_VERT`, lines 111–131) genuinely does displace along the sphere normal using **3-D simplex noise sampled directly on the unit-sphere direction** — `vObj = normalize(position)` then `heightAt(vObj, ...)` (`TERRAIN_GLSL`, lines 86–109) composing domain-warped `fbm` continents and a masked `ridge` term. This is, mechanically, correct spherical/3-D height mapping with no pole seam — genuinely reusable technology for the rebuild (see §4). But the displacement amplitude is cosmetic: `uDispAmt: 0.012 + relief*0.022` (line 344), i.e. roughly 1–3% of the display radius — a silhouette bump for a shape you see from a distance, not meter-scale walkable terrain. The mesh has **zero LOD**, is **never collided with**, is **only ever seen from `SpaceState`**, and is explicitly torn down the moment you leave it: `for (const p of this.planets) p.visual.dispose?.()` in `SpaceState.exit()` (`spacestate.js:425`).

**A completely disconnected flat heightfield for the ground.** `TerrainField` (`src/universe/terrainfield.js`) is, per its own header comment, "THE deterministic height authority for planet surfaces" — but its entire public surface is `height(x, z)`, `normal(x, z, eps)`, `moisture(x, z)`: a **2-D function**, infinite domain, no curvature term anywhere. Its five noise instances are seeded independently of `planetmesh.js`'s shader (`hash32(this.seed, 101..105)` vs. the shader's own `uSeedOffset` random `vec3`), so even setting aside the representation mismatch, the *specific* noise fields used for "what this planet looks like from space" and "what this planet's ground actually is" are unrelated by construction — there is no seed-level guarantee, let alone a geometric one, that a continent visible from orbit corresponds to anything under your boots after landing.

**The unit system itself is incoherent between the two states.** `docs/ARCHITECTURE.md`'s own ground rules state it plainly: *"Space scene units: 1 unit ≈ 1 km, planets radius 40–90 ... Surface scene units: 1 unit = 1 m."* The from-space display sphere and the ground heightfield don't just use different noise — they don't even agree on what a "1" means. `TerrainField`'s amplitude terms (`contAmp = 14 + 34·relief` → 14–48 m, `mountAmp` up to 90 m) are meter-scale; `planetmesh.js`'s `radius` field (40–90) is nominally kilometer-scale. There is no code path that could make these consistent even in principle, because they were never meant to describe the same object.

**Streaming: `TerrainRenderer`.** `src/render/terrain.js` is a genuinely well-built flat-world chunk streamer: 64 m chunks (`CHUNK = 64`, line 11) in a circular ring around a "focus" position (`viewChunks = 9` by default, ≈576 m radius, line 164), three LOD bands purely by planar distance (`LOD_SEGS = [32,16,8]`, `LOD_NEAR = 3.4`, `LOD_MID = 6.9` chunk-radii, lines 12–13), skirt geometry to hide LOD seams (`_indexFor`, lines 321–343 — four-edge skirt quads emitted with both windings), geometry pooling (`_pool`/`POOL_MAX=80`) and a frame-budgeted synchronous build queue (`_processQueue`, line 501 — **12 ms/frame** steady-state, **4000 ms blocking** on first load, line 529). All of this machinery — rings, LOD-by-distance, skirts, pooling, a budgeted queue — is the *right shape* of solution and directly reusable in spirit for a spherical rebuild (§4). But it operates entirely in flat XZ, its LOD selection is Euclidean chunk-distance rather than screen-space error, it runs single-threaded on the main thread (no `Worker` anywhere in the module), and the sea is a literal camera-following flat plane: `new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 1, 1)` re-centered every frame (`this._sea.position.set(focusPos.x, this.field.seaY, focusPos.z)`, line 296) — an infinite ocean that never curves.

**"Landing" is a masked scene swap, not a transition.** `SpaceState._land(p)` (`spacestate.js:314-331`): pressing G within `LAND_RANGE = 1.75` planet-display-radii (line 20) disables ship control, plays `await ctx.fade(1.1, '#e8f4ff')` — a literal full-screen color fade — computes a landing site from the ship's current approach azimuth (`az = atan2(rel.z, rel.x)`), and calls `ctx.switchState('surface', { arrive: 'entry', landingPos: {x: cos(az)*380, z: sin(az)*380} })`. `Game.switchState` (`main.js:161-176`) then runs `old?.exit?.()` — which in `SpaceState.exit()` (lines 413-428) disposes the *entire* scene: starfield, every planet visual, the ship's engine trail, cockpit, effects, combat, mining, and life systems — and constructs a brand-new `SurfaceState` from scratch (`enter()`, `surfacestate.js:51-160`, which builds a new `THREE.Scene`, new `THREE.PerspectiveCamera`, new `TerrainField`, new `TerrainRenderer`, new `SkyDome`, and re-`buildShip`s the player's ship). **There is no camera continuity, no geometry continuity, and no physical-state continuity across that fade — it is definitionally a scene swap**, with the fade's only job being to hide the cut. `SurfaceState.enter()` with `params.arrive === 'entry'` then drops the ship in at a **hard-coded** `ENTRY_ALT = 420` m AGL (line 39), aimed back toward the origin (`Math.atan2(-lp.x, -lp.z)`, line 112) — a scripted re-entry flight with no relationship to the actual descent trajectory the player flew in `SpaceState`. Leaving reverses the trick: `_exitAtmosphere()` (lines 224-239) triggers at `EXIT_ALT = 470` m AGL, fades, and calls `switchState('space', { mode: 'takeoff', planetIndex })`; `SpaceState._placeShip({mode:'takeoff'})` (lines 110-118) then re-places the ship at `planetPos + (0, radius*1.9, radius*0.6)` — a position with no mathematical relation whatsoever to where the ship "took off" from on the ground below.

**Sky bodies and the sun are independently faked, not derived.** `SkyBodies` (`src/render/skybodies.js`) draws every sibling planet as a canvas-textured disc sprite pinned to a fixed shell radius (`SHELL = 3300`, line 8) at a **hand-authored, golden-angle-spread azimuth and fixed 8°–32° elevation** (`az: (i * 2.399963) % TAU`, `el: 0.14 + ((i*37)%10)/10*0.42`, lines 97-99) that slowly drifts with time-of-day — entirely decorative, with zero connection to the actual orbital positions computed independently in `SpaceState.enter()` (`orbit = 800 + i*720 + phase*140`, `spacestate.js:58`). `SkyDome` (`src/render/sky.js`) rolls its **own independent** sun azimuth (`this._azimuth = rng.range(0, 2π)`, line 143), unrelated to the sun object `createSun(this.system.star)` actually built in `SpaceState`. Two different rigs, two different shaders (`SKY_FRAG` in `sky.js` for the inside-the-dome view vs. `createAtmosphere` in `src/render/atmosphere.js` for the outside-the-planet rim view), tuned independently, with nothing enforcing that they'd agree if you could ever see both at once — which, by construction, you can't, because they never coexist in the same scene.

**What's already correct and reusable.** `src/universe/biomes.js` (`rollPlanetDef`) and `src/universe/starsystem.js` (`generateSystem`) are pure data generators — palette, hazard rolls, terrain parameter ranges, orbit radius/phase — with **zero coupling** to the flat-vs-sphere rendering split. They don't need to change for this rebuild; that materially bounds its blast radius. `planetmesh.js`'s `heightAt` GLSL (3-D-direction-sampled fbm/ridge/warp) is directly reusable as the seed of the new unified height authority. `terrain.js`'s skirt/pool/budgeted-queue patterns are directly reusable as the seed of the new chunk residency manager.

---

## 3. The Gap

| Feature | NMS | Ours | Severity | Effort |
|---|---|---|---|---|
| Sphere mesh representation | Cube-sphere, 6-face quadtree, no poles/UV seam | Single fixed-res `THREE.SphereGeometry` UV-sphere, pole pinch, prop-only (`planetmesh.js:370-371`) | **Engine** | Very Large |
| Ground representation | Same sphere, walkable, collidable | Disconnected infinite flat `y=f(x,z)` (`terrainfield.js`) | **Engine** | Very Large |
| LOD selection | Screen-space projected geometric error | Euclidean chunk-distance, 3 fixed bands (`terrain.js:12-13`) | Structural | Large |
| LOD seam handling | Skirts + vertex morph, cube-face-edge aware | Skirts only, flat-grid only, no face-edge case exists | Structural | Medium (skirts reusable; face edges are new) |
| Floating origin / precision | Double-precision world state, camera-relative GPU upload, periodic rebase | None — single fixed `THREE.Scene` origin per state; only ever a few hundred meters from camera by construction (small world masks the missing rig) | **Engine** | Large |
| Orbit→surface transition | Continuous, zero cuts, same camera/scene | Scripted flight + `ctx.fade()` + full `switchState('surface')` teardown/rebuild (`spacestate.js:314-331`, `main.js:161-176`) | **Engine** | Large |
| Planet radius scale | Deliberate gameplay-small (~km-scale), internally consistent with a walkable circumference | Two incompatible scales: 40–90 "km" display prop vs. meter-scale flat ground with no radius at all | **Engine** | Medium (a rescale + convention fix, not new algorithms) |
| Horizon curvature | Visible within hundreds of meters altitude, by design | None on the ground (flat plane); cosmetic-only on the display sphere (never seen at ground-level) | Structural | Included in sphere rebuild |
| Circumnavigation | Fully supported; poles are ordinary geometry | Impossible — the ground has no circumference | **Engine** | Included in sphere rebuild |
| Poles | No special case; cube-sphere avoids UV-sphere pinch | N/A (no sphere underfoot); the *display* sphere has classic UV pole pinch nobody ever walks near | Structural | Included in sphere rebuild |
| Atmosphere: outside view | Rim/limb scattering, physically motivated | `createAtmosphere` shell (`atmosphere.js`), tuned independently | Cosmetic (exists, needs unification) | Small–Medium |
| Atmosphere: inside view | Same scattering function, camera-inside case | `SkyDome` (`sky.js`) — an unrelated, independently authored gradient dome shader | Structural | Medium |
| Rings/moons/planets in surface sky | Real orbital position, true parallax as you move | Fixed-shell billboard sprites, hand-authored azimuth/elevation (`skybodies.js:90-100`) | **Structural** | Large |
| Biome/height mapping | 3-D noise sampled on sphere surface, latitude bands, no seam | Two unrelated fields: 3-D-on-sphere (display only, cosmetic) vs. 2-D-flat (ground, real) | **Engine** | Included in unification |
| Water | Sea-level concentric sphere, curves with the world | Camera-following infinite flat plane (`terrain.js:250-273`) | Structural | Medium |
| Chunk streaming threading | Background worker/job threads, main thread only uploads | Fully synchronous main-thread build (`terrain.js:501-512`), 4000 ms blocking first-load spike | Structural | Medium–Large |
| Collision on chunks | Reads the same streamed chunk data players see | Analytic `field.height(x,z)`/`field.normal(x,z)` lookup only (`player.js`, several call sites) | Structural | Medium (heightfield case is easy; caves are Volume 3's problem) |
| Save/location addressing | Planet-relative (surface coordinate on the sphere) | Flat world-space `{x,z}` (`gameplay/state.js` `location.pos`/`landingPos`) | Feature | Small–Medium |
| Cross-state continuity of gameplay systems | One continuous scene; systems just keep running | Entirely separate `SpaceState`/`SurfaceState` instances, full construct/dispose per crossing (`spacestate.js`/`surfacestate.js`) | **Engine** | Very Large (the merge itself) |

**Read on severity:** eleven of nineteen rows are **Engine**-tagged or folded into the Engine-tagged sphere/merge rebuild. This table is intentionally shorter and heavier than most other volumes' gap tables — nearly every row is a consequence of the same root cause (two disconnected representations), which is precisely the "one fact that governs everything" the Executive Summary opens with.

---

## 4. Target Design

### 4.1 Unit system: pick one

The single cheapest, highest-leverage fix, and the precondition for everything else: **one unit system, meters, everywhere.** Interplanetary/interstellar distances don't need kilometers-as-a-separate-unit — JS numbers are IEEE-754 doubles regardless of what we call them, so "orbit radius = 4,200,000" (meters) costs nothing extra over "orbit radius = 4,200" (the old pseudo-km). What must change is the **planet radius itself**: replace the current 40–90 "km" display-only prop radius with a **gameplay-scaled real radius the ground actually has**, in the NMS ballpark — target **2,000–4,000 m**, tunable per `biomes.js` terrain roll (bigger worlds for gas giants/ocean worlds, smaller for moons). This is a deliberate, named compromise for the same reason NMS makes it: at 2–4 km radius, circumference is ~12.5–25 km, a fast walk/rover circumnavigates a small world in well under an hour, and curvature is visible within a few hundred meters of altitude — both are gameplay-load-bearing. `TerrainField`'s existing amplitude constants (`contAmp` 14–48 m, `mountAmp` up to 90 m) stay meter-scale and **need no rescaling** — they already describe a walkable-scale world; they just need to be applied to a sphere instead of an infinite plane.

### 4.2 Cube-sphere face → chunk quadtree

```js
// Six faces; each face owns an independent quadtree over an integer grid.
// (u, v) basis vectors span the face in [-1, 1]^2; n is the face normal.
const FACES = [
  { id: 0, u: [0, 0, -1], v: [0, 1, 0], n: [ 1, 0, 0] },  // +X
  { id: 1, u: [0, 0,  1], v: [0, 1, 0], n: [-1, 0, 0] },  // -X
  { id: 2, u: [1, 0,  0], v: [0, 0, 1], n: [ 0, 1, 0] },  // +Y
  { id: 3, u: [1, 0,  0], v: [0, 0,-1], n: [ 0,-1, 0] },  // -Y
  { id: 4, u: [1, 0,  0], v: [0, 1, 0], n: [ 0, 0, 1] },  // +Z
  { id: 5, u:[-1, 0,  0], v: [0, 1, 0], n: [ 0, 0,-1] },  // -Z
];

// Map a chunk (face, level, i, j) to a *direction* (unit vector) at local
// (fu, fv) inside that chunk, fu/fv in [0,1]. gridSize = 2^level chunks/face.
function chunkDir(face, level, i, j, fu, fv) {
  const gridSize = 1 << level;
  const cu = -1 + 2 * (i + fu) / gridSize;   // chunk-local -> face UV [-1,1]
  const cv = -1 + 2 * (j + fv) / gridSize;
  const p = addScaled(addScaled(face.n, face.u, cu), face.v, cv); // cube point
  return cubeToSphere(p);   // warp (see below), then normalize -> unit dir
}

// Reduces edge/corner distortion vs. naive normalize(p).
function cubeToSphere(p) {
  const [x, y, z] = p, x2 = x*x, y2 = y*y, z2 = z*z;
  return normalize([
    x * Math.sqrt(1 - y2/2 - z2/2 + y2*z2/3),
    y * Math.sqrt(1 - z2/2 - x2/2 + z2*x2/3),
    z * Math.sqrt(1 - x2/2 - y2/2 + x2*y2/3),
  ]);
}

class ChunkNode {
  constructor(face, level, i, j, parent = null) {
    this.face = face; this.level = level; this.i = i; this.j = j;
    this.parent = parent; this.children = null;   // 4 ChunkNode | null
    this.center = chunkDir(face, level, i, j, 0.5, 0.5);
    this.spanRad = 2 / (1 << level);               // angular span, radians-ish
    this.mesh = null;                                // resident THREE.Mesh | null
    this.key = `${face.id}:${level}:${i}:${j}`;
  }
  split() {
    if (this.children) return;
    const { face, level, i, j } = this;
    this.children = [
      new ChunkNode(face, level + 1, i*2,     j*2,     this),
      new ChunkNode(face, level + 1, i*2 + 1, j*2,     this),
      new ChunkNode(face, level + 1, i*2,     j*2 + 1, this),
      new ChunkNode(face, level + 1, i*2 + 1, j*2 + 1, this),
    ];
  }
  merge() { this.children = null; } // release() called on the old subtree first
}
```

Face-edge and corner seams (12 edges, 8 corners of the cube) are the one place a naive per-face quadtree needs care: neighbor lookup across a face boundary requires a small transform table (which edge of which neighboring face lines up, and whether `i`/`j` run the same or flipped direction) rather than simple `±1` arithmetic. This is bookkeeping, not a new algorithm — implemented once in `cubesphere.js`, consumed everywhere else as `neighborAcrossEdge(node, edge)`.

### 4.3 LOD split/merge by screen-space error

```js
const SSE_SPLIT_PX = 24;   // split once this chunk's error exceeds N screen pixels
const SSE_MERGE_PX = 12;   // merge back below this (hysteresis prevents flicker)
const MAX_LEVEL = 22;      // ~2.5 m/chunk-edge at a 3 km radius; tune per planet size

function screenSpaceError(node, camState) {
  const worldDir = node.center;                                   // unit vector
  const worldPoint = scale(worldDir, planet.radius + heightAt(worldDir));
  const rel = sub(worldPoint, camState.worldPosDouble);            // small #s (floating origin)
  const dist = Math.max(length(rel), 1e-3);
  const chunkArc = node.spanRad * planet.radius;                   // approx chunk edge, meters
  const geometricError = chunkArc / GRID_RES;                      // undetailed feature size
  return (geometricError / dist) * (camState.viewportPx / (2 * Math.tan(camState.fovY / 2)));
}

function updateNode(node, camState, jobs) {
  if (!frustumIntersects(node, camState)) { releaseSubtree(node); return; }
  const err = screenSpaceError(node, camState);
  if (err > SSE_SPLIT_PX && node.level < MAX_LEVEL) {
    if (!node.children) node.split();
    for (const c of node.children) updateNode(c, camState, jobs);
    if (node.mesh) releaseMesh(node);           // parent doesn't render once children cover it
  } else {
    if (node.children) {
      const parentErr = err; // measured at the parent's own resolution
      if (parentErr < SSE_MERGE_PX) node.merge();
      else for (const c of node.children) updateNode(c, camState, jobs);
    }
    if (!node.children && !node.mesh) jobs.push(node);   // enqueue for (re)build
  }
}
```

`SSE_SPLIT_PX > SSE_MERGE_PX` hysteresis is the same trick `terrain.js` already uses implicitly with its `LOD_NEAR`/`LOD_MID` distance bands (two thresholds, not one) — carried forward here in screen-space-error form so it works identically at any altitude, not just within the current ~576 m flat-world streaming radius. Split/merge produces a *job list*, not immediate geometry — building is deferred to the worker pool (§4.5).

### 4.4 Height and biome on the sphere

`TerrainField` and `planetmesh.js`'s shader-only `heightAt` are unified into one JS/worker-portable authority, keeping the existing noise *recipe* (continents → masked ridged mountains → detail fbm → plateau → canyon → craters → player edits) but evaluated on a 3-D direction rather than a 2-D `(x,z)`:

```js
class PlanetField {
  constructor(def) {
    this.radius = def.radius;                 // now meters, ~2000-4000
    this.contAmp = 14 + 34 * def.terrain.relief;      // unchanged from terrainfield.js
    this.mountAmp = 90 * def.terrain.relief;          // unchanged
    // noise.js gains warped3/ridged3 (3-D analogues of the existing 2-D
    // warped2/ridged2) -- same fbm3/noise3D primitives already present.
    this._nCont = new SimplexNoise(hash32(this.seed, 101));
    this._nMount = new SimplexNoise(hash32(this.seed, 102));
    // ... _nDetail, _nCanyon, _nMoist unchanged in spirit
  }

  // dir: unit vector -- ANY point on the sphere, poles included, no special case.
  height(dir) {
    const p = scale(dir, this.radius / 1500);           // continent wavelength, unchanged constant
    const c = this._nCont.warped3(p.x, p.y, p.z, this.warpAmt, 4);
    let h = c * this.contAmp;
    if (this.mountAmp > 0.5) {
      const mask = smooth01((c + 0.05) / 0.55);
      if (mask > 0.002) h += sqr(this._nMount.ridged3(...)) * this.mountAmp * mask;
    }
    h += this._nDetail.fbm3(...) * this.detailAmp;
    // plateau / canyon / crater / dig terms: same math, 3-D domain instead of 2-D
    return h;                                             // metres above/below base radius
  }

  latitude(dir, axis) { return Math.asin(clamp(dot(dir, axis), -1, 1)); }
  worldPoint(dir) { return scale(dir, this.radius + this.height(dir)); }
}
```

Biome/latitude effects port almost verbatim: `planetmesh.js`'s existing `lat = abs(dirN.y)` ice-cap logic (`PLANET_FRAG`, line 210) already reads a sphere direction — it becomes `latitude(dir, axis)` above, now driving *real* ground snow/ice rather than a cosmetic shader term. **Gameplay call sites migrate mechanically, not conceptually**: every `field.height(x, z)` in `flora.js`, `creatures.js`, `mining.js`, `basebuilding.js`, `weather.js`, `rover.js`, `underwater.js`, `survival.js`, `player.js` becomes `field.height(dirAt(localX, localZ))`, where `dirAt` resolves a small local offset (still meaningful near the camera, since floating origin keeps local coordinates small and near-flat over gameplay distances of tens of meters) into a sphere direction via the current chunk's face/UV frame. This is the majority of the ~40-module blast radius, and it is *find-and-replace-shaped* work, not new design, because `PlanetField` keeps `height`/`normal`/`moisture` as its public contract — only the argument changes from `(x, z)` to `dir`.

### 4.5 Floating-origin camera rig and worker-threaded chunk building

```js
class FloatingOriginRig {
  constructor(scene) {
    this.root = new THREE.Group();           // everything renders under this
    scene.add(this.root);
    this.worldPos = { x: 0, y: 0, z: 0 };     // true double-precision origin (plain JS numbers = f64)
    this.rebaseThreshold = 4000;              // meters of drift before a rebase
    this.tracked = [];                        // { worldPosDouble, mesh } pairs
  }
  toRender(pDouble, out) {
    out.x = pDouble.x - this.worldPos.x;
    out.y = pDouble.y - this.worldPos.y;
    out.z = pDouble.z - this.worldPos.z;      // small -> safe for the f32 GPU pipeline
    return out;
  }
  update(cameraWorldPosDouble, camera) {
    if (dist(cameraWorldPosDouble, this.worldPos) > this.rebaseThreshold) {
      this.worldPos = { ...cameraWorldPosDouble };
      for (const t of this.tracked) t.mesh.position.copy(this.toRender(t.worldPosDouble, _tmp));
    }
    camera.position.copy(this.toRender(cameraWorldPosDouble, _tmp));
  }
}
```

The precision fix is specifically necessary because **three.js downcasts to `Float32Array` at the GPU boundary** — `BufferGeometry` position/normal attributes are `Float32Array`, and `WebGLRenderer` uploads composed model/view/projection matrices as 32-bit uniforms regardless of the 64-bit JS arithmetic used to build them. `TerrainField`'s own math, `RNG`, and `SimplexNoise` are already full float64 (ordinary JS numbers) and need no change; the rig's job is purely to keep whatever finally reaches a `BufferAttribute` or a matrix uniform small.

Chunk geometry building moves off the main thread. `PlanetField` is deliberately kept DOM/THREE-free (mirroring `TerrainField`'s existing "pure math, no scene objects" design) so it runs unmodified inside a `Worker`:

```js
// main thread (planetchunktree.js)
worker.postMessage({ cmd: 'build', key: node.key, face: node.face.id, level: node.level,
                      i: node.i, j: node.j, planetSeed, terrainParams });
worker.onmessage = (e) => {
  const { key, positions, normals, colors } = e.data;
  attachChunkMesh(key, positions, normals, colors);   // upload + scene-graph attach only
};

// planetchunk.worker.js
onmessage = (e) => {
  const { key, face, level, i, j, planetSeed, terrainParams } = e.data;
  const field = new PlanetField(terrainParams, planetSeed);   // no THREE/DOM needed
  const { positions, normals, colors } = buildChunkGeometry(field, FACES[face], level, i, j);
  postMessage({ key, positions, normals, colors },
    [positions.buffer, normals.buffer, colors.buffer]);        // zero-copy transfer
};
```

`buildChunkGeometry` is a direct port of `terrain.js`'s existing `_buildChunk` (lines 394-450) — sample a `(segs+3)²` scratch grid, central-difference normals, vertex-color biome ramp, skirt perimeter — with `field.height(x, z)` replaced by `field.height(chunkDir(face, level, i, j, fu, fv))` and skirt direction changed from "push down in Y" to "push inward along `-dir`" (toward the planet center) so skirts still hide seams on a curved surface. A pool of 3–4 workers (`navigator.hardwareConcurrency`-bounded) keeps the main thread doing only what `terrain.js` already does well: queue management, geometry pooling, and frame-budgeted attach/detach — now bounded by upload cost alone, not generation cost, closing the current 4000 ms first-load stall.

### 4.6 Coupling to Volume 3 (voxel terrain must live on the sphere)

Volume 3 specifies a density field `d(p) = surface(p) + caves(p) + edits(p)` extracted with a marching-cubes-family mesher, with `surface(p)` originally sketched as `p.y − groundY` (a flat half-space assumption). Once terrain lives on a sphere, that term must become **radial**, not vertical:

```js
function surfaceDensity(p, planetCenterDouble, field) {
  const rel = sub(p, planetCenterDouble);         // small, floating-origin-relative
  const r = length(rel);
  const dir = scale(rel, 1 / r);
  const groundR = field.radius + field.height(dir);  // PlanetField.height(dir), §4.4
  return r - groundR;                                 // >0 outside rock, <0 inside
}
```

Volume 3's voxel chunk grid is defined **inside** a `PlanetChunkTree` leaf (a bounded radial shell around that chunk's surface, per Volume 3 §4.1's "thin shell, not a solid planet" principle), in the chunk's own face-local frame, so caves only need to be voxelized where the camera actually is — distant chunks stay pure heightfield-style meshes from §4.5, exactly mirroring how NMS keeps voxel detail near the player and falls back to coarse shape at range. This is the explicit contract handed from Volume 2 to Volume 3: **a chunk is a face-local coordinate patch with a known ground direction and radius**, and volumetric detail is layered on top of that patch, never computed against a flat `-Y` assumption.

### 4.7 Merging SpaceState + SurfaceState

The two states collapse into one: `src/states/worldstate.js`, owning **one `THREE.Scene`, one `THREE.PerspectiveCamera`, one `FloatingOriginRig`**, with a `PlanetChunkTree` per system body (full detail for the one you're near/on, coarse far-LOD-only for the rest) and a small internal `mode` machine (`'flight' | 'foot' | 'auto'` — `'auto'` retained only for the cosmetic board/rise/dock lerp sequences, which are legitimately scripted moments even in NMS). "Landing" stops being an event: `ShipController`'s existing flight physics (`gameplay/shipcontrol.js`, unchanged) simply keeps integrating as altitude above the `PlanetChunkTree` surface decreases, LOD naturally sharpens (§4.3), and atmosphere entry becomes a cosmetic VFX layer (heat shimmer, particle streaks) gated by AGL and speed — not a disguise for `ctx.switchState`. `ctx.switchState` is **kept**, but narrowed to the transitions that are legitimate hard cuts even in NMS's own design: menu ⇄ world, and world ⇄ station-interior (`HangarState` — instanced interiors are an accepted NMS pattern too, so this one boundary is *not* rebuilt).

### 4.8 File plan

| Action | Path | Notes |
|---|---|---|
| **New** | `src/universe/cubesphere.js` | Face table, `chunkDir`, `cubeToSphere`, cross-face neighbor lookup |
| **New** | `src/universe/planetfield.js` | `PlanetField` — unified height/biome/moisture authority, DOM-free, worker-portable |
| **New** | `src/render/planetchunktree.js` | `PlanetChunkTree` — quadtree, SSE split/merge, chunk residency, job dispatch |
| **New** | `src/render/planetchunk.worker.js` | Background geometry builder (port of `terrain.js` `_buildChunk`) |
| **New** | `src/render/floatingorigin.js` | `FloatingOriginRig` — double-precision bookkeeping + rebase |
| **New** | `src/render/planetsea.js` | Chunked sea shell at fixed radius, reuses `PlanetChunkTree` machinery |
| **New** | `src/states/worldstate.js` | Merged continuous scene, replaces both state files |
| **Modify** | `src/core/noise.js` | Add `warped3`/`ridged3` (3-D analogues of existing `warped2`/`ridged2`) |
| **Modify** | `src/universe/biomes.js` | `radius` range → 2000–4000 m; no other change (data generator already representation-agnostic) |
| **Modify** | `src/universe/starsystem.js` | Orbit distances re-expressed in meters (pure constant rescale) |
| **Modify** | `src/gameplay/player.js`, `src/gameplay/shipcontrol.js` | "Up" becomes local `dir` instead of global `+Y`; ground query becomes `field.height(dir)` |
| **Modify** | `src/render/atmosphere.js`, `src/render/sky.js` | Share one scattering parameter set / GLSL chunk so outside/inside views agree (full physical unification is Volume 1's job; this volume only removes the *structural* disconnect) |
| **Modify** | `src/render/skybodies.js` | Query real double-precision sibling-planet positions from `worldstate.js` instead of fixed billboards |
| **Modify** | `src/gameplay/{flora,creatures,mining,basebuilding,weather,rover,underwater,survival}.js` | Mechanical: `height(x,z)` → `height(dir)` via local frame helper |
| **Modify** | `src/gameplay/state.js` | `location.pos`/`landingPos` become `{ planetId, dir:[x,y,z], localOffset }` |
| **Delete** | `src/states/spacestate.js`, `src/states/surfacestate.js` | Subsumed by `worldstate.js` |
| **Delete** | `src/universe/terrainfield.js` | Subsumed by `planetfield.js` |
| **Delete** | `src/render/terrain.js` | Subsumed by `planetchunktree.js` + worker (skirt/pool/queue *logic* is harvested, not lost) |
| **Delete (harvest math)** | `src/render/planetmesh.js`'s standalone sphere-mesh path | `heightAt`/color GLSL logic is folded into `planetfield.js`/the chunk worker; the file itself may keep atmosphere/cloud/ring composition helpers |
| **Unchanged** | `src/universe/galaxy.js`, `src/universe/lore.js`, `src/core/rng.js`, `src/states/hangarstate.js` | No coupling to the flat/sphere split |

---

## 5. Implementation Phases

1. **Foundations.** `cubesphere.js`, `planetfield.js` (port `TerrainField`'s recipe to 3-D, add `warped3`/`ridged3` to `noise.js`), meter-unit rescale of `biomes.js`/`starsystem.js`. Validate `PlanetField.height(dir)` against a rendered wireframe sphere for visual continuity with the old `TerrainField` "feel" (same relief/roughness knobs should still read the same).
2. **Static chunked sphere renderer.** `PlanetChunkTree` + `planetchunk.worker.js`, screen-space-error LOD, skirts, face-edge neighbor stitching — rendered in isolation (a standalone test harness page, `test/pages/planet.html` already exists as a natural home) before touching either state file. Exit criterion: one planet, walkable in a throwaway free-camera rig, no cracks at any of the 12 cube edges or a pole.
3. **Floating-origin rig.** `FloatingOriginRig`, rebase policy, precision soak test across system-scale distances (camera flown from ground to far orbit and back with no visible jitter).
4. **State merge.** `worldstate.js` replaces `spacestate.js`/`surfacestate.js`; delete the scripted-entry/fade landing path; `ShipController`/`PlayerController` gain sphere-local "up." This is the highest-regression-risk phase — it touches every system that currently assumes a `SpaceState`-vs-`SurfaceState` boundary (combat, mining, effects, HUD mode switching).
5. **Gameplay call-site migration.** Mechanical `height(x,z)` → `height(dir)` sweep across the ~10 consumer modules listed in §4.8; save-schema migration for `location.pos`/`landingPos`.
6. **Sky/water unification.** Shared atmosphere parameters for `sky.js`/`atmosphere.js`; `skybodies.js` rewritten to real double-precision positions with parallax; `planetsea.js` chunked sea sphere replacing the flat plane.
7. **QA & performance pass.** Pole/seam stress tests, LOD split/merge hysteresis tuning (no thrash), worker-pool sizing, headless acceptance suite (§7), full regression sweep of the ~40 modules that touch `TerrainField`/`SpaceState`/`SurfaceState` today.

Phases 1–3 can run essentially engine-only, isolated from gameplay, which is why they're sequenced first: they can be built and validated on a throwaway harness without destabilizing the shipping two-state game, then phase 4 does the one irreversible cutover.

---

## 6. Effort & Risk

| Phase | Engineer-weeks | Primary risk |
|---|:--:|---|
| 1. Foundations (cube-sphere math, `PlanetField`, unit rescale) | 3 | Noise-recipe drift changing planet "feel" vs. current builds |
| 2. Static chunked sphere renderer (SSE LOD, skirts, face seams) | 6 | Face-edge/pole cracks are notoriously fiddly to fully eliminate |
| 3. Floating-origin rig + precision validation | 3 | Rebase-boundary pops if any object is missed by the tracked-object registry |
| 4. State merge (`worldstate.js`, delete scripted landing) | 7 | Highest regression risk — touches combat/mining/effects/HUD mode logic throughout |
| 5. Gameplay call-site migration (~10 modules) + save migration | 6 | Mechanical but wide; easy to miss a call site and get silent flat-world behavior on part of the map |
| 6. Sky/water unification, real-position sky bodies | 5 | Atmosphere shader unification bleeds into Volume 1's graphics scope — needs a scope line drawn early |
| 7. QA, LOD tuning, full regression pass | 6 | LOD split/merge thrash and chunk-build worker starvation under motion are classic late-discovered bugs |
| **Total** | **36 weeks (~8.3 engineer-months)** solid-path; **9–15 engineer-months** realistic range with iteration on seam/precision bugs and regression fallout | — |

This matches the Executive Summary's top-line 9–15 engineer-month estimate for this volume. The range's width reflects that phases 2 and 4 are genuinely novel engineering (nothing in the current codebase is a scaled-down version of a cube-sphere quadtree or a merged flight/foot state machine — they are new), while phases 1, 5, and 6 are closer to well-scoped, lower-variance ports. With two engineers (one on phases 1–3 core-engine work, one auditing and preparing the ~40-module call-site migration for phase 5 in parallel), wall-clock time compresses to roughly 6–8 months without reducing total effort.

**What this unblocks:** Volume 3 (voxel terrain/caves — cannot be built against a flat `-Y` assumption, per §4.6); large parts of Volume 1 (aerial perspective, planetary atmosphere rendering, terrain materials, foliage density all pay off far more once terrain is spherical/streamed); Volume 4 (universe scale — a floating-origin rig is the precondition for extending beyond the current neighbor-bubble without precision collapse); Volume 5 (creature/flora placement across a real latitude/biome sphere instead of an infinite plane); Volume 6 (space encounters positioned relative to real orbits instead of a decorative display-sphere layout); Volume 8 (base building on curved, walkable ground). This is why the Roadmap (Volume 17) sequences it first among engine work.

---

## 7. Acceptance Criteria (Headless Playwright)

Following this project's existing pattern (`test/*.mjs`, Chromium + SwiftShader, `window.__AMS__.game.state` as the debug hook, `?state=` URL params — see `test/land-debug.mjs`, `test/journey.mjs`):

**7.1 Circumnavigation proves curvature.** Teleport the player/ship to a known direction on a test planet, walk/fly a fixed great-circle heading for a distance equal to the planet's circumference, and assert the returned position matches the start within tolerance — proving the world is topologically closed, not infinite.

```js
await page.goto(`${base}/index.html?state=surface&planet=testworld`);
await page.waitForFunction(() => window.__AMS__?.ready);
const result = await page.evaluate(async () => {
  const s = window.__AMS__.game.state;
  const start = s.field.dirOf(s.player.position).clone();     // unit direction, start
  const circumference = 2 * Math.PI * s.field.radius;
  s.player.setHeading(0, 1);                                   // due "east" along a great circle
  for (let t = 0; t < circumference / s.player.walkSpeed; t += 1/60) s.player.tick(1/60);
  const end = s.field.dirOf(s.player.position).clone();
  return { angularError: start.angleTo(end) };                 // radians
});
assert(result.angularError < 0.02);   // ~1.1 degrees over a full lap
```

**7.2 Orbit→ground with no state swap.** Assert the *same* state object instance persists across a full descent from orbital altitude to standing on the ground — no `switchState` fired, no fade opacity spike, no scene/camera re-creation.

```js
const trace = await page.evaluate(async () => {
  const s = window.__AMS__.game.state, id = s;                 // reference identity
  const log = [];
  events.on('state:change', () => log.push('SWAP'));           // must never fire
  for (let agl = 50000; agl > 2; agl *= 0.92) {
    s.shipCtl.position.y = s.field.groundY(s.shipCtl.position) + agl;
    s.update(1/60);
    log.push({ agl: Math.round(agl), sameInstance: window.__AMS__.game.state === id });
  }
  return log;
});
assert(trace.every((e) => e === 'SWAP' ? false : e.sameInstance));
assert(!trace.includes('SWAP'));
```

**7.3 A moon appears at the predicted sky azimuth.** Given known orbital parameters at a fixed simulated time, compute expected azimuth/elevation from the player's position analytically, then compare against the actual rendered body's world-space direction.

```js
const result = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const moon = s.bodies.find((b) => b.kind === 'moon');
  const toMoon = moon.worldPosDouble.clone().sub(s.player.worldPosDouble).normalize();
  const localUp = s.field.dirOf(s.player.position);
  const localEast = localUp.clone().cross(new THREE.Vector3(0,1,0)).normalize();
  const localNorth = localEast.clone().cross(localUp);
  const predictedAz = Math.atan2(toMoon.dot(localEast), toMoon.dot(localNorth));
  const renderedAz = s.skyBodies.azimuthOf(moon);     // read back from the actual sprite/mesh transform
  return Math.abs(predictedAz - renderedAz);
});
assert(result < 0.02);   // radians
```

**7.4 Cube-face and pole seam integrity.** Walk a path crossing at least one of the 12 cube-face edges and the pole; sample terrain height and normal on both sides of each crossing at sub-meter offsets and assert continuity (no discontinuous height jump, no inverted normal), and assert frame time doesn't spike (no pop/rebuild stall) during the crossing.

**7.5 Floating-origin precision soak.** Fly to an extreme system-scale distance (e.g., the far edge of a belt or a distant sibling planet's orbit) and back; sample a static reference object's rendered (post-projection) screen position at 1 Hz throughout and assert no discontinuous jump exceeding a few pixels except at deliberate rebase events (which should themselves be imperceptible — assert the object's *world* delta before/after a rebase is within float32 epsilon).

**7.6 LOD split/merge hysteresis.** Hold the camera at an altitude straddling a known SSE threshold and jitter it by a few meters per frame for 10 seconds; assert the chunk-build job count stays bounded (e.g., under 5/second) rather than thrashing split/merge every frame.

---

*Continue to [Volume 3 — Voxel Terrain & Manipulation](./03-voxel-terrain.md), which specifies the volumetric layer built on top of this sphere, or return to [Volume 0 — Executive Summary](./00-executive-summary.md).*
