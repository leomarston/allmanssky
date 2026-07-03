# Volume 3 — Voxel Terrain & Manipulation

## Scope and headline verdict

AllMansSky's ground is a mathematical function `y = f(x,z)` evaluated per-vertex on a streamed grid mesh. No Man's Sky's ground is a volumetric density field sampled on a 3-D voxel grid and surfaced with an isosurface extractor, letting the player carve tunnels, discover caves, and stand under overhangs. These are not two implementations of the same feature — a heightfield is topologically incapable of representing a cave (a height function returns exactly one `y` per `(x,z)`; a tunnel requires two or more). Every item below that reads "not possible" is not a missing option flag, it is a mathematical consequence of the representation, and no amount of shader or content work changes that. The fix is a representation change: `f(x,z) → d(x,y,z)`. This volume specifies that change in full, coordinated with Volume 2 (the cube-sphere planet rebuild) since voxels only make sense once "down" is not globally `-Y`.

---

## 1) What NMS does

No Man's Sky's terrain is one of the few AAA examples of fully destructible, streamed, planet-scale voxel terrain shipping on consoles since 2016, refined through the NEXT (2018) and Origins/Companions engine passes.

**Volumetric representation.** Terrain is a signed-distance/density field, not a heightmap. Each planet's base shape is generated from layered 3-D noise (domain-warped fbm, ridged multifractal for mountains, low-frequency shaping for continents and biome macro-features) evaluated directly in 3-D, not projected from a 2-D height function. Because the field is 3-D, it can be negative in enclosed regions — that is precisely what produces caves, overhangs, arches, and floating islands: the density function dips below the surface iso-value, rises back above it, and dips again, with no requirement that any given `(x,z)` column have a single surface crossing.

**Mesh extraction.** The renderable surface is extracted from the density volume with a Marching-Cubes-family algorithm running per voxel chunk. NMS uses a bespoke, heavily optimized variant (the community and decompiled-shader analysis point to a surface-nets/dual-contouring-flavored extractor rather than textbook Marching Cubes, chosen for smoother normals and fewer degenerate slivers) executed on the GPU via compute shaders, with the extracted mesh cached per chunk. LOD transitions use a seam-avoidance scheme in the spirit of Transvoxel: neighboring chunks at different LODs share a boundary contract (stitching skirts or transition cells) so no visible cracks appear at LOD boundaries, which matters enormously at planetary scale where a player can see dozens of chunk rings to the horizon.

**Chunk grid & streaming.** The voxel volume is chunked (documented/estimated chunk sizes in the tens of meters cubed) and organized in an octree/grid keyed to the planet's local coordinate frame, itself relative to a floating-origin camera (see Volume 2). Chunks stream in around the player and de-stream at distance; farther rings fall back to lower LOD or to the pre-voxel coarse shape so horizon silhouettes stay populated without paying full voxel cost. Meshing work is dispatched to background jobs (worker threads / GPU compute) so streaming doesn't stall the frame.

**Caves, overhangs, arches, floating islands.** These fall directly out of the 3-D density field: a `ridged3D`-style cave-noise term subtracted from the base solid density carves tunnel networks; large-scale warped noise occasionally detaches a blob of positive density from the main landmass (floating islands); overhangs and arches are just places where the iso-surface's outward normal has a negative Y component — visually striking but computationally identical to any other surface cell. Caves are seeded with their own biome-flavored lighting, bioluminescent flora, cave-specific fauna, and mineral deposit types not found on the surface, reinforcing that this is a first-class content layer, not terrain doing double duty.

**The Terrain Manipulator.** The player's mining/terrain tool supports at least four operations: **Create** (add mass — build terrain up, e.g., to shore up a wall or seal a leak in a base), **Remove/Subtract** (dig — the default mining action), **Flatten** (drive the surface within a radius to a common plane, foundational for base building on uneven ground), and **Restore** (revert edits within a radius back to procedural default, refunding nothing but undoing damage). All four operate on the same density volume: they are local, radius-and-falloff-shaped additions or subtractions to `d(p)` around the tool's aim point, immediately re-meshed for the touched chunks.

**Edit persistence.** Terrain edits are stored as a **sparse delta layer keyed by chunk/region**, not as a modified copy of the whole planet. The base procedural field is always regenerable from the seed; only the deltas (which chunks were touched, and how) are serialized to the save file. This is what lets an effectively infinite, fully proc-gen universe still "remember" that you dug a tunnel under your base three real-world months ago. There are practical edit-volume limits — extremely large excavations (e.g., hollowing out an entire mountain) are throttled or capped — and abandoned/unvisited edits far from any base historically had integrity issues across versions (a known long-standing tension between "infinite regenerable world" and "persistent player changes"), which is itself useful context: even NMS treats this as an engineering compromise, not a solved problem.

**Materials, biome, and texturing.** Each voxel/vertex carries a material ID derived from depth, biome, and noise (topsoil vs. rock vs. biome-special layers like frozen substrate or fungal crust), rendered with triplanar mapping so that steep and overhanging faces — impossible to UV-unwrap sanely from a top-down heightmap projection — still texture correctly from all three axes. Underground layers expose distinct resource-deposit materials (larger, rarer mineral veins, different from surface scatter nodes) and cave-exclusive flora/fauna spawn tables.

**Collision & performance.** Physics collision runs against the actual extracted mesh (or a simplified collision proxy derived from it), so overhangs, caves and tunnels are physically enterable/standable, not just visually implied. Meshing itself is the expensive part; it runs off the main thread (compute shaders / job system) with aggressive chunk caching, greedy-meshing-style triangle reduction, and per-chunk LOD so the moment-to-moment frame cost of "planet made of voxels" stays bounded even during active digging.

---

## 2) What AllMansSky has today

Source of truth: `src/universe/terrainfield.js` (height authority), `src/render/terrain.js` (mesh generation/streaming), `src/gameplay/mining.js` (mining + "dig" tool).

**Representation: `TerrainField`.** `TerrainField.height(x, z)` (`src/universe/terrainfield.js:92-135`) returns a single scalar `y` for any `(x, z)`, composed additively: domain-warped fbm continents (`_nCont.warped2`, ~1500 m wavelength) → ridged-noise mountains masked by continent height (`_nMount.ridged2`) → fbm roughness detail (`_nDetail.fbm2`) → optional plateau terracing → optional branching canyon carve (an *absolute-value* warped-noise valley, still single-valued per column) → crater bowls/rims stamped on a 230 m hash-seeded cell grid (`_craterAt`, lines 178-200) → player dig deltas (`_digAt`, lines 163-176). Every one of these is a term in a 2-D function `y=f(x,z)`; none of them, individually or summed, can produce two `y` values for one `(x,z)`. This is architecturally a heightfield, full stop — canyons and craters are "deep dents," not caves.

**Mesh generation: `TerrainRenderer`.** `src/render/terrain.js` streams 64 m chunks in rings (`viewChunks`, default 9) around a focus point, each built by `_buildChunk` (lines 394-450): sample `field.height` on a `(segs+3)²` scratch grid, central-difference normals, per-vertex vertex-color biome ramp (`_colorFor`), skirt-flap perimeter verts pushed down to hide LOD cracks. Three discrete LOD bands by chunk-distance (`LOD_SEGS = [32,16,8]`), geometry pooling (`_pool`, `_acquireGeometry`/`_releaseChunk`) to avoid GC churn, and a frame-budgeted build queue (`_processQueue`, 12 ms/frame steady-state, 4000 ms on first load) round out the streaming design. `invalidateArea(x,z,r)` (line 485) re-queues chunks overlapping an edited circle at the front of the queue. This is a solid, well-engineered *2.5-D* terrain streamer — no complaint about its heightfield-appropriate engineering — but it is fundamentally a grid-of-quads mesher over a scalar field, not an isosurface extractor over a volume; there is no marching-cubes/dual-contouring/surface-nets code anywhere in the module, because there is no volume to extract from.

**"Digging": `addDig`/`_digAt` + Arcforge dig mode.** `TerrainField.addDig(x,z,r,d)` (lines 141-156) pushes a `{x,z,r,d}` bowl record into a flat array plus a 32 m-cell spatial index (`_digIndex`) for O(1)-ish lookup, capped at **400 edits per planet** (`if (this._digs.length >= 400) return false`). `_digAt(x,z)` (lines 163-176) sums a smoothstep-falloff parabolic depression for every dig whose cell the query point falls in. `mining.js`'s `GroundMining._updateDig` (lines 92-137) is the player-facing loop: march the camera ray in 0.5 m steps until it crosses `surface.field.height(p.x,p.z)` (a literal heightfield raymarch, not a voxel/SDF raymarch), call `addDig(hit.x, hit.z, 2.8, 1.05)` every 0.35 s while firing, then `surface.terrain.invalidateArea(...)` to force a rebuild and push `[x,z,r,d]` into `gs.digs[planetId]` for save persistence. **This is a real, working, persisted edit system — but it is a "carve a bowl into a height function" system, not a volumetric excavation.** You can dig a shallow pit; you cannot dig a hole that goes anywhere, tunnel horizontally, or ever produce a passage you walk through with rock overhead. There is no "add mass" (build up) operation, no flatten operation, and no restore-to-procedural operation — only subtract-a-bowl.

**Persistence format.** `src/gameplay/state.js:46`: `this.digs = {}` — a plain `{ [planetId]: [[x,z,r,d], ...] }` map on the save-game root, restored via `field.loadDigs(gs.digs?.[this.def.id])` in `src/states/surfacestate.js:69`. This is already, correctly, a **sparse delta keyed by planet** (not a full terrain snapshot) — the right shape of idea, just operating on the wrong underlying primitive (bowls-in-a-heightfield instead of voxel/SDF deltas). It's a good foundation to generalize, not a mistake to throw away.

**Resource nodes are discrete decorative props, not terrain material.** `src/states/surfaceprops.js:66-71` places `kind:'node'` props (`createResourceNode`) with an `itemId` and `hp` at spawn time from `def.resources`; `mining.js`'s non-dig `GroundMining.update` raycasts against `surface.props.all` for these nodes (or flora) and depletes `hp` per beam-tick, granting items and eventually `surface.props.remove(target)`. This is NMS's "surface deposit" mechanic in spirit (aim at a rock, beam it, get resources) but implemented as a billboard-style prop pool, completely decoupled from the terrain mesh/field — mining a node never touches `TerrainField`, and digging a bowl never touches a node. There is no concept of a mineral vein embedded *in* terrain material, no underground-only deposits, and no cave-exclusive resources, because there are no underground volumes to place them in.

**Collision.** `src/gameplay/player.js` reads `field.height(x,z)` directly for ground clamping (lines 46, 120, 201) and `field.normal(x,z)` for slope-aligned orientation (line 84) — collision *is* the heightfield, evaluated analytically, with zero mesh-collision code anywhere in the terrain path. This is cheap and robust for a flat world, and it is precisely what breaks the instant a cave or overhang needs to exist: analytic `y=f(x,z)` collision has no way to represent "you are standing on rock with more rock five meters above your head and open air ten meters below that."

---

## 3) The gap

| Feature | NMS | Ours | Severity | Effort |
|---|---|---|---|---|
| Terrain representation | 3-D density/SDF volume | 2-D heightfield `y=f(x,z)` | **Engine** | Very Large |
| Mesh extraction | Marching-cubes-family (surface-nets/dual-contouring flavored) isosurface extraction, GPU compute | Direct grid-of-quads sampling of `height()` | **Engine** | Large |
| LOD seam handling | Transvoxel-style stitching / transition cells between voxel LODs | Skirt-flap quads hiding heightfield LOD cracks (`terrain.js:331-343`) | Structural | Medium |
| Chunk streaming | Octree/grid voxel chunks, floating-origin, GPU/worker meshing | 64 m ring-streamed heightfield chunks, main-thread budgeted build (`terrain.js:501-512`) | Structural | Large |
| Caves / tunnels | Native — negative-density regions in 3-D field | **Impossible** on `y=f(x,z)`; zero code | **Engine** | Large (post-voxel) |
| Overhangs / arches | Native — surface normal can point downward | **Impossible**; every column has exactly one `y` | **Engine** | Large (post-voxel) |
| Floating islands | Native — disconnected positive-density blobs | **Impossible** | **Engine** | Medium (post-voxel) |
| Manipulator: Subtract (dig) | Radius+falloff density carve, any direction incl. horizontal | `addDig` bowl subtracted from `height()`, vertical-only, shallow (`terrainfield.js:141-176`) | Structural | Medium (already has raymarch + beam UX to build on) |
| Manipulator: Create (add mass) | Native op | **Absent** — no add-mass code path anywhere | Feature | Medium |
| Manipulator: Flatten | Native op (critical for base building) | **Absent** | Feature | Small–Medium |
| Manipulator: Restore | Native op, reverts to procedural | **Absent** | Feature | Small |
| Edit cap / auto-regen policy | Soft limits on excavation extent | Hard cap: 400 dig-records per planet, silent player-facing warning (`mining.js:118-120`) | Feature | Small |
| Edit persistence | Sparse per-chunk voxel deltas in save file | Sparse per-planet dig-record array `gs.digs[planetId]` (`state.js:46`) — right shape, wrong primitive | Structural | Medium (extend format) |
| Per-voxel material / biome layering | Depth+biome+noise material ID per voxel, triplanar textured | Per-vertex biome color ramp only (`terrain.js:_colorFor`), no material ID, no triplanar (steep faces stretch) | Feature | Medium |
| Underground resource deposits | Native — large veins placed inside rock volume, cave-exclusive materials | **Absent**; resources are surface-only decorative props (`surfaceprops.js:66-71`), decoupled from terrain | Structural | Medium (post-voxel) |
| Cave flora/fauna | Bioluminescent, cave-specific spawn tables | **Absent** — no cave volumes to spawn into | Structural | Medium (post-voxel, depends on Vol. 5) |
| Collision | Against extracted mesh — handles caves/overhangs | Analytic heightfield lookup, `field.height`/`field.normal` (`player.js:46,84,120,201`) — cannot represent overhead rock | **Engine** | Large |
| Meshing performance strategy | GPU compute shaders + chunk cache + greedy-meshing-style reduction | Main-thread `_buildChunk`, frame-budgeted queue, geometry pooling — well engineered for what it is | Cosmetic (current approach is fine for heightfields) | — |
| Digging tied to economy/tool progression | Terrain Manipulator upgrades widen radius/range | `toolMine` upgrade scales tick rate only (`mining.js:62,114`); dig radius/depth are hardcoded constants (R=2.8, D=1.05) | Feature | Small |

**Read on severity:** twelve of eighteen rows are tagged Structural or Engine. The core blocker — heightfield vs. volume — is Engine-severity and gates nearly every downstream row (caves, overhangs, floating islands, underground deposits, cave biology, mesh-based collision). This is the single largest "everything downstream is fake until this lands" dependency in the terrain domain, comparable in kind to Volume 2's sphere rebuild — and the two are coupled (see §6).

---

## 4) Target design

### 4.1 Design principles

1. **Keep the world infinite and regeneration-based.** The base density field must remain a pure function of `(seed, position)` — never a stored grid. Only *deltas* are ever persisted, exactly like today's `gs.digs`, just generalized from "list of bowls" to "list of typed edit primitives with an efficient chunk index."
2. **Voxels are a thin shell, not a solid planet.** No client can hold a full 3-D voxel grid for an Earth-scale sphere. Following NMS's own approach and dictated by memory reality, the density field is evaluated (and chunked) only within a bounded radial shell around the *current* surface height — say -80 m to +40 m locally — with the existing heightfield formula used as a distant fallback (LOD0 visuals far below/above the shell, and as the coarse base shape the density field is built from in the first place).
3. **Composable density, not a monolithic function.** `d(p) = surface(p) + caves(p) + edits(p)` — each term independently understandable, independently toggleable per-biome (e.g., caves disabled on airless moons for now), and independently testable.
4. **Meshing off the main thread.** A `Worker`-based (not GPU-compute — no build step / broad WebGL2 compatibility argument in Volume 1 applies here too) dual-contouring or surface-nets mesher, chunked, LOD'd, with a transition-cell seam scheme.
5. **Coupling to Volume 2 is explicit and load-bearing.** "Down" stops being `-Y` once the planet is a cube-sphere; `surface(p)` must be expressed relative to the local cube-sphere radial direction, and the voxel chunk grid must be defined in a face-local or floating-origin frame consistent with Volume 2's chunk/quadtree scheme. Building this before Volume 2 lands would mean rebuilding it again after — sequencing matters (§5–6).

### 4.2 Density field

```
// d(p) < 0  => solid (inside rock)
// d(p) >= 0 => air
// iso-surface is d(p) == 0

function density(p, planet, edits, caveCfg) {
  // 1. surface term: turn the existing 2-D heightfield into a 3-D half-space
  //    density by measuring signed vertical distance to it. This is exactly
  //    TerrainField.height(x,z), reused unmodified — no regression on the
  //    macro shape players already see.
  const groundY = planet.heightfield.height(p.x, p.z);   // existing terrainfield.js
  let d = p.y - groundY;                                 // >0 above ground, <0 below

  // 2. caves: subtract (i.e. carve air into solid) using 3-D ridged/warped
  //    noise, gated to a band under the surface and to biome caveAmt, and
  //    faded to zero near y=groundY so cave mouths don't perforate the crust
  //    randomly (only where a dedicated "cave entrance" mask permits, see 4.5).
  if (caveCfg.amt > 0 && p.y < groundY - caveCfg.minDepth) {
    const n = ridgedNoise3D(p.x * caveCfg.freq, p.y * caveCfg.freq * 1.4, p.z * caveCfg.freq,
                             caveCfg.octaves, planet.seed ^ 0xCAFE);
    const tunnel = caveCfg.threshold - Math.abs(n);       // >0 inside a tunnel
    const depthFade = smooth01((groundY - caveCfg.minDepth - p.y) / caveCfg.fadeDist);
    if (tunnel > 0) d += tunnel * caveCfg.strength * depthFade;  // push toward air
  }

  // 3. edits: sparse, chunk-indexed list of {type, center, radius, amount,
  //    falloff} primitives (§4.5) — evaluated only for edits whose bounding
  //    sphere overlaps p's chunk (index by chunk key, not linear scan).
  const e = edits.sampleAt(p);       // sums subtract(-) / create(+) / flatten
  d += e;

  return d;
}
```

Cave gating deliberately keeps `caves(p)` a no-op near the surface and on planets/biomes with `caveAmt = 0`, so early implementation phases can ship the voxel *pipeline* (meshing, editing, persistence) on a mostly-solid shell before cave generation is tuned — de-risking the highest-effort engine change from the highest-risk content-tuning change.

### 4.3 Voxel chunk grid & the heightfield handoff

```
ShellVolume
  chunkSize = 16          // voxels per axis, world units = 16 * voxelSize
  voxelSize = 1.0 m        // coarsened to 2.0 m at LOD1, 4.0 m at LOD2
  shellBelow = 80 m        // depth below local terrain height that gets voxelized
  shellAbove = 40 m        // height above local terrain that gets voxelized (peaks/overhangs)

  isChunkActive(chunkKey, focusPos):
    // only chunks whose AABB intersects [groundY-shellBelow, groundY+shellAbove]
    // AND within voxelRadius (e.g. 6 chunks, ~96 m) of focus are meshed via
    // dual contouring. Outside that: fall back to the existing TerrainRenderer
    // heightfield quad-mesh (unchanged) for horizon-scale rendering.
```

This directly reuses `src/render/terrain.js`'s existing ring-streaming and LOD-band machinery for everything beyond the voxel radius — the flat heightfield renderer is not deleted, it becomes the **far-field LOD** of the new system, exactly as NMS falls back to a coarser non-cave-bearing shape at distance. Near the player, the voxel shell takes over and pays for the extra cost, at a radius chosen for editor/mining reach.

### 4.4 Chunk mesher (worker-side dual contouring, pseudocode)

```
// runs inside a Web Worker, one job per chunk. Dual contouring chosen over
// classic Marching Cubes because it preserves sharp edges (dig-tool corners,
// flatten-tool planes) and produces one vertex per active cell rather than
// MC's occasional degenerate slivers -- and over "vanilla" surface nets
// because DC's per-cell QEF-solved vertex position holds edits' straight
// edges much better than SN's cell-center placement.
function meshChunk(chunkKey, densityFn, voxelSize, N) {
  const corners = sampleCornerDensities(chunkKey, densityFn, voxelSize, N); // (N+1)^3 grid

  const cellVerts = new Map();  // cellIndex -> {pos, normal}
  for (const cell of activeCells(corners, N)) {         // cells with a sign change on >=1 edge
    const edgeCrossings = [];
    for (const edge of cell.edges12) {
      const [dA, dB] = [corners[edge.a], corners[edge.b]];
      if (sign(dA) !== sign(dB)) {
        const t = dA / (dA - dB);                        // linear root find
        const p = lerp(edge.a.pos, edge.b.pos, t);
        const n = gradientNormal(densityFn, p);           // central-difference d(p)
        edgeCrossings.push({ p, n });
      }
    }
    if (edgeCrossings.length === 0) continue;
    const vertex = solveQEF(edgeCrossings);   // least-squares point minimizing
                                                // distance to all crossing planes;
                                                // clamped to cell bounds
    cellVerts.set(cell.index, { pos: vertex, normal: averageNormal(edgeCrossings) });
  }

  const indices = [];
  for (const edge of sharedEdgesWithSignChange(corners, N)) {
    // dual contouring quad rule: one quad per sign-changing edge, built from
    // the 4 cells sharing that edge (3 in edge chains at boundaries -> triangle fan)
    const quadCells = cellsAround(edge, N);
    emitQuad(indices, cellVerts, quadCells, edge.solidToAirDirection);
  }

  return buildBufferGeometry(cellVerts, indices, materialIdsPerVertex(corners));
}

// LOD seam handling (Transvoxel-lite): a chunk meshed at LOD n samples an
// extra "transition skirt" ring using LOD (n-1) density resolution along
// faces adjacent to a coarser neighbor, and stitches a pre-tabulated fan
// (16 cases per edge, mirroring Transvoxel's 2D transition-cell table)
// instead of MC's classic 256-case 3D table -- 2D because we only need to
// stitch a face, not merge two arbitrary interior topologies.
function stitchTransitionFace(chunk, neighborLOD) { ... }  // Phase 3, see §5
```

Each `meshChunk` call returns transferable `Float32Array`/`Uint32Array` buffers posted back to the main thread via `postMessage` with transfer, avoiding structured-clone cost — mirroring the transferable-buffer discipline already used for `TerrainRenderer`'s pooled `Float32Array` scratch buffers, just moved off-thread.

### 4.5 Edit-delta model and application

Edits generalize today's `{x,z,r,d}` dig record into a typed, chunk-indexed primitive list:

```
EditPrimitive {
  type: 'subtract' | 'create' | 'flatten',
  center: {x, y, z},        // NOTE: full 3-D center, not x,z — this is the crux
                              // of the heightfield -> volume upgrade
  radius: number,            // meters
  amount: number,             // meters of density-equivalent depth (subtract/create)
                              // or target-Y offset (flatten)
  falloff: 'smooth' | 'linear',
  materialId: number | null,  // for 'create': what material the added mass is
  seq: uint32                 // monotonic edit sequence number, for delta replay order
}

EditStore {
  byChunk: Map<chunkKey, EditPrimitive[]>,   // spatial index, chunkKey = "cx,cy,cz"
  all: EditPrimitive[],                       // flat list, save-serialized in seq order

  add(edit) {
    if (this.all.length >= EDIT_SOFT_CAP) tryMergeOrReject(edit);  // §4.6
    edit.seq = this.all.length;
    this.all.push(edit);
    for (const chunkKey of chunksOverlapping(edit.center, edit.radius)) {
      (this.byChunk.get(chunkKey) ?? this.byChunk.set(chunkKey, []).get(chunkKey))
        .push(edit);
    }
    return edit;
  },

  sampleAt(p) {                        // called from density(p) — must be fast,
    const key = chunkKeyOf(p);          // O(edits-in-this-chunk), not O(all edits)
    const local = this.byChunk.get(key);
    if (!local) return 0;
    let delta = 0;
    for (const e of local) delta += evalPrimitive(e, p);
    return delta;
  },
}

function evalPrimitive(e, p) {
  const d = dist(p, e.center);
  if (d >= e.radius) return 0;
  const t = smooth01(1 - d / e.radius);        // falloff==smooth path
  switch (e.type) {
    case 'subtract': return  -e.amount * t;     // carve air (increase density outward)
    case 'create':   return  +e.amount * t;     // add mass (decrease density / fill air)
    case 'flatten':  return  (e.center.y - p.y) * t * FLATTEN_GAIN; // pull local surface to center.y
  }
}
```

Applying an edit at runtime:

```
function applyEdit(edit, world) {
  world.edits.add(edit);
  for (const chunkKey of chunksOverlapping(edit.center, edit.radius + MESH_MARGIN)) {
    world.mesher.invalidate(chunkKey);           // re-enqueue for worker remesh,
  }                                                // front of queue (mirrors today's
                                                     // terrain.js invalidateArea)
  if (edit.type !== 'restore') world.saveQueue.markDirty(world.planetId);
}

function restoreEdit(center, radius, world) {
  // 'restore' removes/clips overlapping primitives rather than adding a new
  // counter-primitive, so the delta list doesn't grow unboundedly under
  // repeated dig/restore/dig cycles at the same spot
  world.edits.clipOrRemove(center, radius);
  for (const chunkKey of chunksOverlapping(center, radius)) world.mesher.invalidate(chunkKey);
}
```

### 4.6 Edit limits & auto-regen policy

Today's flat 400-record hard cap with a "GROUND TOO UNSTABLE" refusal (`mining.js:118-120`) is a reasonable UX pattern to keep — generalize the mechanism, keep the message:

- **Per-planet soft cap** (e.g. 2,000 primitives): beyond this, `tryMergeOrReject` first attempts to **merge** new edits into existing nearby same-type primitives within the same chunk (coalescing many small dig-ticks into fewer, larger radius/amount primitives — this is also a save-size win, since today's design already accumulates one array entry *per mining tick*, not per drag-gesture).
- **Per-planet hard cap** (e.g. 6,000 primitives, ~large save-file guardrail): further edits refused with the existing warning event.
- **Auto-regen / abandonment policy:** chunks with edits that haven't been visited in N in-game days *and* are farther than a base-claim radius from any player base MAY be pruned from `byChunk`'s spatial index for streaming purposes (they still exist in `all` for potential undo) — mirroring NMS's own known compromise between "remembers your tunnel" and "can't remember everything forever." This is explicitly a Phase-4+ concern, not required for MVP parity.

### 4.7 Composition with the cube-sphere (Volume 2 dependency)

Volume 2 replaces the flat plane with a cube-sphere quadtree where "surface" is a radial function `r = R + h(u,v)` on each cube face, and `-Y` is replaced by `-radial` (direction from planet center to camera). The voxel shell in this volume must be expressed in that same local frame:

```
function surfaceTerm(p, planet) {
  const radial = p.clone().sub(planet.center);
  const r = radial.length();
  const dir = radial.normalize();
  const faceUV = cubeSphereProject(dir);              // Volume 2's face/uv mapping
  const groundR = planet.radius + planet.heightfield.height(faceUV.u, faceUV.v); // terrainfield.js, reparented
  return r - groundR;   // signed radial distance, same role as `p.y - groundY` today
}
```

Everything else in §4.2–§4.6 (caves, edits, meshing, persistence) is representation-agnostic once `surfaceTerm` is swapped — chunk keys become `(faceId, cx, cy, shellDepth)` instead of `(cx, cz)`, and the worker mesher operates in a local tangent-plane frame per chunk to avoid precision loss far from the cube-sphere's origin (consistent with Volume 2's floating-origin requirement). **This volume's Phase 1–2 (pseudocode above, flat-world only) can and should be built and validated on the current flat plane** — it's a strict superset of the current dig system and de-risks the hardest algorithmic work (dual contouring, worker meshing, edit-delta store) independently of the sphere rebuild. Phase 3+ (real caves, floating islands, overhangs at scale) requires Volume 2's local "down" vector and cannot ship believably before it, because a "cave" carved into a flat plane's shell is really just a basement — visually fine as a tech demo, but arches/overhangs/tunnels-that-go-somewhere only pay off once the world curves.

### 4.8 Module/file plan

| File | Role |
|---|---|
| `src/universe/densityfield.js` (new) | `density(p, planet, edits, caveCfg)` — composes `surface(p) + caves(p) + edits(p)`; wraps existing `TerrainField.height/normal` for the surface term |
| `src/universe/caveNoise.js` (new) | 3-D ridged/warped noise config + `ridgedNoise3D`, cave-entrance mask, per-biome `caveCfg` presets |
| `src/universe/editstore.js` (new) | `EditStore` class: `add/sampleAt/clipOrRemove/serialize/deserialize`, chunk spatial index, merge-on-cap logic |
| `src/workers/voxelmesher.worker.js` (new) | Dual-contouring `meshChunk`, QEF solver, transition-face stitcher; message protocol `{cmd:'mesh', chunkKey, lod} -> {chunkKey, positions, normals, materialIds, indices}` (transferables) |
| `src/render/voxelterrain.js` (new) | Owns the near-field voxel shell: chunk activation radius, worker pool dispatch, mesh upload/dispose, hands off to `TerrainRenderer` beyond `voxelRadius` |
| `src/render/terrain.js` (extend) | Becomes explicit far-field LOD provider; exposes a `heightAt`/`normalAt` contract `voxelterrain.js` calls for its `surface(p)` term (no behavior change to existing rings/pooling) |
| `src/gameplay/manipulator.js` (new, replaces dig portion of `mining.js`) | Subtract/Create/Flatten/Restore tool logic, raymarch-against-density (replaces heightfield raymarch in `mining.js:96-105`), emits `EditPrimitive`s via `EditStore.add` |
| `src/gameplay/mining.js` (trim) | Keeps discrete node/flora mining (`GroundMining.update`, unchanged) and ship `SpaceMining`; delegates dig-mode to `manipulator.js` |
| `src/gameplay/state.js` (extend) | `gs.digs` → `gs.terrainEdits` (versioned; migrate old `digs` arrays into `subtract` primitives on load, see §4.9) |
| `src/gameplay/collision.js` (new) | Mesh-based collision query against active voxel chunk meshes (BVH per chunk) for the near-field shell; falls back to `field.height` far-field (matches `voxelterrain.js`'s own LOD split) |

### 4.9 Save format & migration

```
// gs.terrainEdits[planetId] = {
//   version: 2,
//   primitives: [ { type, center:[x,y,z], radius, amount, falloff, materialId, seq }, ... ]
// }

function migrateLegacyDigs(gs) {
  for (const [planetId, oldDigs] of Object.entries(gs.digs ?? {})) {
    // old record: [x, z, r, d] (2-D bowl, vertical subtract)
    gs.terrainEdits ??= {};
    gs.terrainEdits[planetId] = { version: 2, primitives: oldDigs.map(([x, z, r, d], i) => ({
      type: 'subtract',
      center: [x, groundYAtLoadTime(planetId, x, z), z],  // reconstruct a 3-D center
      radius: r, amount: d, falloff: 'smooth', materialId: null, seq: i,
    })) };
  }
  delete gs.digs;  // one-time migration; old field stays readable one version for safety
}
```

Existing player saves are not invalidated — every historical dig bowl becomes a valid `subtract` primitive centered at the surface, visually identical to today's crater the moment it's re-meshed.

---

## 5) Implementation phases

| Phase | Deliverable | Depends on |
|---|---|---|
| **0. Groundwork** | `densityfield.js` surface-only term (wraps `TerrainField.height`, no caves/edits yet); unit tests confirming `density(p)==0` matches `height(x,z)` within epsilon | none |
| **1. Voxel mesh pipeline (flat world)** | `voxelmesher.worker.js` dual contouring + QEF; `voxelterrain.js` chunk activation/streaming near focus; visually should reproduce today's terrain exactly (sanity: no caves enabled yet) at a real perf cost — this phase is about proving the pipeline, not new content | Phase 0 |
| **2. Manipulator (subtract/create/flatten/restore) on flat world** | `editstore.js` + `manipulator.js`; replaces dig-mode raymarch; save migration (§4.9); flatten enables real base-building on uneven ground | Phase 1 |
| **3. LOD seam stitching + far-field handoff** | Transition-face stitching between voxel LOD bands; `voxelterrain.js` → `terrain.js` handoff at `voxelRadius` boundary, tuned for no visible seam/pop | Phase 1 |
| **4. Cave generation (flat world, "basement" caves)** | `caveNoise.js` 3-D cave term enabled; cave-entrance masking; mesh-based collision (`collision.js`) replaces analytic heightfield collision in the voxel shell | Phase 2, 3 |
| **5. Cube-sphere reparenting** | `surfaceTerm` rewritten against Volume 2's radial/faceUV frame; chunk keys become face-relative; tangent-frame meshing for precision | **Volume 2 shipped**; Phases 1–4 |
| **6. True caves/overhangs/arches/floating islands at scale** | Full 3-D cave networks that traverse under real topography, floating island generation, overhang-bearing cliffs | Phase 5 |
| **7. Underground deposits & cave biology** | Per-voxel material IDs feed vein placement; cave-exclusive flora/fauna spawn tables (coordinates with Volume 5) | Phase 6 |
| **8. Edit-budget policy & save-size hardening** | Merge-on-cap, abandonment pruning, save compaction for high-edit-count planets | Phase 2 (can run parallel to 4-7) |

Phases 0–4 are **sphere-independent** and deliver real, demoable value (tunnels, overhangs, base-flattening) on the existing flat world; this is deliberate so the highest-uncertainty engineering (worker meshing, QEF dual contouring, edit-delta correctness) gets validated and shipped before being re-parented onto the sphere in Phase 5, rather than attempting both rebuilds simultaneously.

---

## 6) Effort & risk

| Phase | Engineer-weeks | Primary risk |
|---|---|---|
| 0. Groundwork | 0.5 | Low — thin wrapper |
| 1. Voxel mesh pipeline | 5–7 | QEF solver correctness/stability at cell boundaries; worker message throughput at streaming rates; this is the highest-skill-risk phase in the whole volume |
| 2. Manipulator (4 ops) + save migration | 3–4 | Flatten/create UX tuning; migration correctness against real player saves |
| 3. LOD seam stitching | 3–5 | Historically one of the hardest parts of any voxel terrain system (Transvoxel's original paper exists because this is genuinely hard); visible cracks are highly noticeable and hard to fully eliminate |
| 4. Caves (flat) + mesh collision | 4–6 | Cave-entrance masking (avoiding random crust perforation) is a tuning-heavy content problem, not just code; mesh collision BVH perf under active digging |
| 5. Cube-sphere reparenting | 3–5 | **Hard dependency on Volume 2 being complete and stable** — cannot start meaningfully earlier; precision at tangent-frame boundaries |
| 6. Full 3-D caves/overhangs/floating islands | 4–6 | Generation tuning (believable tunnel networks, non-degenerate floating islands) is iterative/artistic, hard to estimate tightly |
| 7. Underground deposits & cave biology | 3–4 (engine side; content/design time separate) | Coordinates with Volume 5 (fauna) and Volume 8 (economy) — cross-volume sequencing risk |
| 8. Edit-budget/save hardening | 1–2 | Low, but easy to deprioritize into a live bug later if skipped |
| **Total** | **~27–40 engineer-weeks (≈6.5–9.5 engineer-months)** | |

**Critical dependency:** Phase 5 onward (roughly 55% of this volume's total effort) cannot start until Volume 2's cube-sphere rebuild has landed a stable local-frame/floating-origin API — this volume and Volume 2 are the two largest Engine-severity items in the entire report and are sequenced back-to-back for a reason (Volume 2 first, per the executive summary). Attempting to build true caves/overhangs before Volume 2 lands would mean redoing the coordinate-frame plumbing twice. Phases 0–4 (flat-world voxels, manipulator, basement caves) are safe to parallelize with Volume 2's development since they touch disjoint code paths (`densityfield.js`/`voxelterrain.js` vs. Volume 2's quadtree/camera work) and only need to rendezvous at Phase 5.

**Biggest single technical risk in the volume:** the dual-contouring QEF solver and LOD transition stitching (Phases 1 and 3) are the parts of voxel terrain systems that consistently take longer than estimated industry-wide — budget explicit spike/prototype time before committing Phase 1's 5–7 weeks to a hard deadline.

---

## 7) Acceptance criteria

Headless (no-GUI) checks, runnable in CI against the worker/module layer directly:

1. **Dig produces a real hole with mesh + persistence proof.**
   - Call `manipulator.subtract(center, radius=3, amount=4)` at a known flat point on a test planet.
   - Assert `densityfield.density(center.clone().setY(center.y - 1)) > 0` (now air where it was solid) and `density(farAwayPoint) < 0` unchanged (no global regression).
   - Trigger `voxelterrain.js` remesh for the touched chunk; assert the returned geometry's vertex count/bounds differ from the pre-edit mesh, and that at least one triangle's centroid lies inside the dig sphere with a downward-shifted Y relative to pre-edit sampling.
   - Serialize `EditStore` (`gs.terrainEdits[planetId]`), discard in-memory `TerrainField`/`voxelterrain` state entirely, reconstruct a fresh planet from `(seed, terrainEdits)`, and re-sample `density(center)` — must match the pre-serialization value within epsilon. This proves persistence round-trips through the save format, not just runtime state.

2. **Enter a cave (Phase 4+).**
   - On a test planet with `caveCfg.amt > 0`, sample `density(p)` along a vertical column from `groundY+5` down to `groundY-50`; assert **at least two sign changes** (crust → cave air → rock below), proving a genuine enclosed void exists — something structurally impossible to assert against the current `TerrainField.height` (single-valued by construction).
   - Mesh the chunk containing that column; assert the extracted geometry contains triangles whose normals point in both `+Y`-dominant and `-Y`-dominant directions within the same chunk (roof and floor of the same cave), proving the mesher produced a non-heightfield topology.
   - Run a scripted "walk" that moves a capsule collider along the column from above into the cave interior; assert the collider comes to rest with **open space above it and solid below**, verified via `collision.js` raycasts in both `+Y` and `-Y` from the resting position.

3. **Overhang collision.**
   - Construct (or generate via cave/edit primitives) a chunk with a known overhang: solid density at `y=[0,10]` and `y=[20,30]` at the same `(x,z)`, air at `y=[10,20]`.
   - Assert `collision.js`'s mesh-based query, given a capsule at `y=15` (in the open pocket) moving upward, **collides with the underside of the upper slab** at `y≈20` rather than passing through — the specific case an analytic `field.height()` lookup (today's `player.js:120,201`) cannot represent, since it would only ever return the topmost surface (`y≈30`) for that `(x,z)`, making this test fail by construction against the current collision code and pass only once mesh-based collision (§4.8, `collision.js`) is wired in.
   - Additionally assert a raycast from above at that `(x,z)` returns the `y≈30` hit (topmost surface, matching legacy heightfield expectations for anything approaching from open sky), while a raycast from within the pocket at `y=15` going up returns `y≈20` — same `(x,z)` column, two different collision answers depending on ray origin, which is the operational definition of "this world has overhangs now."

Each of these is implementable as a pure-function/module-level test (density sampling, worker mesh output inspection, collision module queries) with no rendering or browser context required, consistent with the project's zero-build-step, all-procedural architecture.
