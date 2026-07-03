# Volume 1 — Graphics & Rendering

> **Scope.** This is the flagship volume. The user's stated #1 priority is graphics ("the graphic level is not even near"), so this chapter goes deepest. It compares No Man's Sky's (NMS) rendering stack against AllMansSky (AMS) function-by-function, itemizes the delta with severity and effort, then specifies a concrete target architecture — including a reasoned WebGL2-ceiling analysis and a WebGPU/TSL migration recommendation. Everything credited to AMS is grounded in the actual source under `src/render/` and `src/core/engine.js`. Where a gap is dictated by the display-sphere/flat-heightfield split, it is flagged as **engine-gated (Vol 2/3)**. Where the zero-external-asset rule caps fidelity, that is stated explicitly.

---

## 1) What No Man's Sky does (exhaustive, technical)

NMS ships a bespoke engine internally referred to as the "Engine" (descendant of the Joustra/Nada tooling), a forward-plus/clustered renderer that has been iterated across a decade (Foundation → Next → Beyond → Origins → Waypoint → Worlds Part I/II). It targets D3D11/D3D12 and Vulkan on PC, plus fixed consoles (PS4/PS5/Xbox/Switch) and PSVR2, which forces a scalable, mostly-deferred-ish design with aggressive LOD. The salient subsystems:

**PBR material model & uber-shaders.** Metallic-roughness PBR with the full channel set: albedo, metalness, roughness, tangent-space normal, ambient occlusion, height/parallax, and a subsurface/scatter term used on foliage, flesh, ice and translucent minerals. Surface authoring is dominated by a small library of tiling *material palettes* fed through an uber-shader whose permutations are toggled by `#define`-style feature flags (detail-normal blending, parallax-occlusion mapping, dual-layer snow/sand accumulation, wetness, emissive, iridescence). Because planets are procedural, surfaces are assembled by blending a handful of tiling detail sets rather than unique authored textures — the *palette* is the reused asset, not a per-planet bitmap.

**Terrain: triplanar + splat + voxels.** The ground is a signed-distance voxel field (dual-contoured/polygonised) that supports true overhangs, caves and terrain edits, streamed as an LOD octree with geomorphing between levels. Shading is **triplanar** (three world-axis projections blended by the squared normal, killing UV stretch on cliffs/caves) layered over a **splat**/rules system that selects material sets by slope, altitude, latitude, biome and noise. Height-based blend factors give hard rock-to-scree and sand-drift transitions. Distant terrain uses lower voxel LODs plus a horizon/impostor band.

**Lighting.** A clustered/tiled light culling scheme supports many local lights (bioluminescence, buildings, ship engines, weapon impacts, storms) on top of a single dominant directional (the star). Shadows are **cascaded shadow maps** (CSM, typically 3–4 splits) for the sun with stabilised texel snapping, plus local shadow maps for hero lights, and **screen-space contact shadows** to recover small-scale contact that CSM texel density misses.

**Ambient occlusion.** Screen-space AO — historically HBAO-class, GTAO on higher settings — darkening creases, foliage bases and cave mouths, combined with baked/vertex AO on props.

**Global illumination.** Not full RT-GI, but a layered approximation: sky/ambient from an analytic or captured environment, image-based lighting from a per-frame or per-region environment probe (the visible sky + atmosphere), plus screen-space GI/reflection contributions on higher settings. The atmosphere itself acts as a giant area light: aerial perspective and sky colour drive the ambient term so a red-sky world tints everything warm.

**Anti-aliasing & temporal upscaling.** **TAA** is the backbone — temporal accumulation with velocity-buffer reprojection, neighbourhood clamping and jittered projection. On top of that, **temporal upscalers**: FSR2 / DLSS-class reconstruction (and console dynamic-resolution) render at a fraction of native and reconstruct, which is *the* enabling technology for the heavy volumetrics at 60 Hz. This point is load-bearing for AMS: a browser target that wants NMS-class volumetrics almost certainly needs its own temporal reconstruction.

**Atmospheric scattering & aerial perspective.** Physically-motivated **Rayleigh + Mie** sky with a precomputed/analytic transmittance and in-scatter model (Bruneton-style lineage). Crucially, **aerial perspective** is applied to *surface* geometry: distant terrain is tinted and desaturated by the integrated in-scatter between camera and fragment, giving depth cues and the blue-haze horizon. From orbit, the same model produces the lit atmospheric rim, the day/night terminator gradient, and forward-scatter halo on backlit crescents. Sky colour, fog and ambient are all derived from one coherent atmosphere solution.

**Volumetric clouds.** Raymarched volumetric clouds driven by 3D noise (Worley/Perlin) and a 2D **weather map** (coverage/type/height), with Beer–Powder extinction, multiple-scattering approximation, sun-direction silver lining, and cheap temporal reprojection to amortise the march. Clouds have real parallax and can be flown through; a flat cloud shell is used only at extreme LOD.

**Water.** Screen-space reflections (with planar/cubemap fallback), refraction via scene-colour distortion, animated Gerstner/FFT-ish wave normals, depth-based colour extinction, shoreline foam from depth deltas, subsurface tint, caustics on the seabed, and underwater fog + godrays. Wet-sand darkening at the waterline.

**Foliage & grass.** Dense **GPU-instanced** foliage with per-instance wind (hierarchical vertex animation: trunk bend + branch flutter + leaf jitter), scattered by planet rules, LODed to billboards/impostors at distance, with a wind vector field and gusts. Grass is a separate high-density near-camera instanced layer with view-distance fade.

**GPU particles & weather VFX.** GPU-simulated particle systems for engine trails, explosions, mining, atmospheric entry heat, and weather: rain, snow, sandstorms, dust, ash, toxic rain, lightning with screen flashes and local light. Storms modulate fog, wind, exposure and audio.

**Space visuals.** HDR starfields, volumetric/layered nebulae, real planet shadows and eclipses, atmospheric entry glow, engine heat-haze distortion, warp tunnel, and a coherent skybox-as-galaxy where the galactic band matches the map.

**Post chain.** HDR linear pipeline → exposure with **eye adaptation** (auto-exposure histogram) → bloom (HDR threshold, multi-mip) → **motion blur** (per-object + camera, velocity buffer) → **depth of field** (cockpit/photo mode) → chromatic aberration → film grain → vignette → **color-grading LUT** (per-biome/mood 3D LUT) → tonemap. TAA and upscaling sit inside this chain.

**Streaming/scalability.** Texture streaming (virtual/partially-resident on some platforms), geometry LOD + impostors, terrain octree streaming, dynamic resolution, and per-platform quality tiers. Draw distance scales from cockpit detail to planet-from-orbit.

---

## 2) What AllMansSky has today (grounded in source)

AMS is a no-build, browser-native three.js@0.160 (WebGL2) app, ~22,900 LOC, fully procedural with **zero external art/audio**. Rendering is spread across `src/render/*` and driven by `src/core/engine.js`. It is architecturally a state machine (`src/main.js`: SpaceState ⇄ SurfaceState + HangarState); "landing" is a masked scene-swap from a **display-sphere planet** (`planetmesh.js`) to an **infinite flat heightfield** (`terrain.js`). There is no round planet underfoot and no seamless orbit→surface transition. That split gates a large fraction of the graphics gap and recurs below.

**Engine & post chain (`core/engine.js`).** `Engine` wraps `THREE.WebGLRenderer` with `antialias:true`, `powerPreference:'high-performance'`, `logarithmicDepthBuffer:true` (space spans metres→megametres), `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure = 1.0`, `shadowMap.type = PCFSoftShadowMap`, pixel ratio clamped to `min(devicePixelRatio, 2)`. `setScene()` builds a fresh `EffectComposer` per scene: `RenderPass → UnrealBloomPass → OutputPass`. `main.js` tunes bloom per state (space `0.65/0.55/0.8`, surface `0.55/0.58/0.84`, hangar `0.4/0.5/0.85`). That is the **entire** post chain. Consequences worth stating plainly:

- **No anti-aliasing in practice.** The `antialias:true` flag is on the default framebuffer, but once `EffectComposer` owns rendering the frame passes through its render targets, which are not MSAA-enabled here. There is no `SMAAPass`, no `TAARenderPass`. Edges alias; sub-pixel HDR specks (star points, sea glints, engine glow) shimmer with no temporal filter.
- **No SSAO/HBAO/GTAO**, no motion blur, no DoF, no chromatic aberration, no film grain, no vignette, no color-grade LUT, no auto-exposure. Exposure is a fixed `1.0` (settable via `setExposure` but never adapted).
- **Fixed ACES tonemap** is correct and modern, and HDR authoring is real (many shaders push values >1 specifically to feed bloom), so the one post effect present — bloom — is used well.

**From-space planet (`planetmesh.js`).** `createPlanetVisual` is a genuine highlight: a single `ShaderMaterial` on a `SphereGeometry(radius, 96, ~67)` running Ashima 3D simplex `fbm`/`ridge` to compute a height field shared between vertex (silhouette displacement, `uDispAmt`) and fragment (colour + derivative-based bump normal via `dFdx/dFdy`). It ramps an 10-stop palette by altitude, applies moisture accent tint, cliff darkening from the bumped normal, polar ice by `|latitude|`, altitude snow, volcanic lava veins (HDR emissive, animated pulse), crystal/exotic banding, ocean sun-glint, atmospheric limb haze, and night-side emissive **city speckles** near the terminator. It composes sibling modules (`atmosphere`, `clouds`, `rings`) under one axially-tilted group and slow-spins for a visible day/night creep. For a display object this is well above hobby grade — but it is a *display object*: you cannot approach it, and none of this shader reaches the surface renderer.

**Atmosphere (`atmosphere.js`).** `createAtmosphere` is a back-side additive fresnel rim shell at `radius*(1.035…)`, with `mu = -dot(V,N)/uMuMax`, `glow = pow(mu,1.8)*.75 + pow(mu,7)*.55 + …`, a day/terminator/night azimuthal term and a forward-scatter glare lobe. It reads convincingly as a limb but is **not** a scattering integral — no Rayleigh/Mie phase, no optical depth, no transmittance, and critically **no aerial perspective on geometry**.

**Clouds (`clouds.js`).** `createCloudLayer` bakes a seam-free equirectangular `CanvasTexture` (768×384) by sampling warped 3D `fbm` along sphere directions (`makeCloudTexture`), then maps it onto a shell at `radius*1.018` with day/terminator shading and night fade. It is a **2D texture on a sphere**, not a raymarch: no volume, no parallax, no weather map, and it exists only from space. The surface scene has no cloud system at all.

**Surface sky & lighting (`sky.js`).** `SkyDome` is an inverted gradient dome (`ShaderMaterial`, radius 3600) blending zenith/horizon/night palettes, an HDR sun disc + tight/wide halos (feeds bloom), a baked star `CanvasTexture`, a sunset azimuth ring, and horizon→fog blend so terrain melts into sky. It owns the surface light rig: one shadow-casting `DirectionalLight` (intensity ~4.2, `2048²` shadow map, ortho frustum ±160 covering a ~300 m bubble, `bias -0.0005`, `normalBias 1.0`) plus a `HemisphereLight` fill, and installs `scene.fog = FogExp2` synced to the horizon colour. It is a gradient/analytic sky, **not** a scattering sky; there is a single shadow cascade (not CSM), so shadow quality falls off fast beyond the bubble.

**Surface terrain (`terrain.js`).** `TerrainRenderer` streams 64 m heightfield chunks in a 9-chunk ring with three LODs (`LOD_SEGS = [32,16,8]`) and downward **skirts** to hide LOD seams; geometry is pooled. Height is sampled on the **CPU** from `TerrainField`. Material is a single `MeshStandardMaterial` (`vertexColors`, `roughness 0.95`, `metalness 0`) with an `onBeforeCompile` injection that multiplies albedo by two octaves of a tiling `makeDetailTexture` (`DataTexture` 256², world-XZ sampled, distance-faded). `_colorFor` ramps the palette by height/slope/moisture/snow with noise dither. There is a single large animated **sea plane** (`SEA_VERT/FRAG`): simplex + sine wave normals, a CPU-baked depth `DataTexture` (`SEA_TEX` 96²) for shallow/deep tint and shoreline foam, one Blinn spec lobe (HDR glints), and fog-colour used as a *stand-in* for sky reflection. So water has **no SSR, no refraction, no real caustics** (surface), and terrain shading is **vertex-colour + one detail texture, no triplanar, no splat, no normal/AO/parallax maps**.

**Underwater (`underwater.js`).** Genuinely rich for its size: swaps to depth-graded water fog, camera tint shell, opaque fog-walled backdrop, instanced streamed **kelp** with vertex-shader sway, boids-lite **fish schools**, pooled **bubbles** (player stream + seafloor vents), additive **caustic** patches (`makeCausticTexture`) aligned to seafloor slope, and **god-ray shafts** — all ≤8 draw calls, pooled, deterministic. This is the closest AMS gets to NMS's underwater mood, though caustics/shafts are billboarded canvas textures, not projected/raymarched.

**Flora & grass (`flora.js`).** `FloraSystem` builds 3–5 merged low-poly archetypes per biome (kit-bashed cylinders/icos/cones with vertex jitter and a bottom→top colour+glow gradient), one `InstancedMesh` per archetype streamed over a 5-cell (~320 m) radius, plus a near-player cross-quad **grass** layer (`GRASS_CAP 5200`). Wind sway and HDR emissive glow are injected via `onBeforeCompile`. This is real instanced foliage with wind — but per-archetype instancing (not a unified GPU scatter), no impostor/billboard LOD, and hard pop at the stream radius.

**Weather (`weather.js`).** `WeatherSystem` is CPU-updated `THREE.Points` fields (rain/toxicrain/snow/sandstorm/ashfall/thunder + clear-day motes) following the player in a ~38 m box, with a seeded wax/wane intensity cycle and, for thunder, a `DirectionalLight` flash. Effective and cheap, but a small pooled point field — not GPU particles, no accumulation on surfaces, no wind-coupled sheets, and it does not modulate exposure/fog beyond the flash light.

**Space set-dressing.** `starfield.js` bakes a 2048×1024 galaxy `CanvasTexture` (band, dust lanes, hotspot, galaxy smudges, ~5200 baked micro-stars) plus 6000 shader point-stars with per-star colour temperature and twinkle. `nebula.js` scatters 3–6 clusters of additive billboard sprites from baked warped-fbm `CanvasTexture`s with HDR cores and star glints. `sun.js` is an animated convective star surface shader (simplex fbm lanes, granulation, sunspots, limb darkening, chromosphere rim) with layered corona billboards and the system `PointLight`. `rings.js` bakes a 1024×4 radial band strip with Cassini gaps and renders a planet-shadow cylinder across the disc. These are strong, coherent, and the reliance on baked `CanvasTexture` is the visible ceiling: no volumetric nebulae, no HDR-buffered star PSF, sprites read as flat when passed.

**VFX (`effects.js`).** `EffectsSystem` is a well-engineered **CPU** pool: `PointPool` (custom point `ShaderMaterial`, `GLOW_CAP 4096`, `SMOKE_CAP 1024`), sprite flashes, an instanced-capsule laser-bolt pool, mining beams, warp tunnel, engine trails, explosion/spark/landing-dust. Zero per-frame allocation. But it is CPU-simulated sprites/points — no GPU particles, no soft-particle depth fade, no heat-haze/refraction, no decals.

**Ships/stations (`shipmesh.js`).** The best PBR in the project: kit-bashed lofted superellipse fuselages, extruded wings, `MeshStandardMaterial` with a canvas-painted albedo (panel lines, stripes, decals, wear), `metalness 0.75 / roughness 0.35`, tinted glass canopies, HDR emissive engine nozzles, and animated stations. Still: albedo-only maps (**no normal/roughness/metalness maps**, so surfaces read smooth/flat), and no environment map, so metal has nothing to reflect.

**Net read.** AMS punches far above its weight *procedurally* and has excellent HDR-for-bloom discipline, pooling, determinism and streaming hygiene. But measured against NMS it is missing essentially every modern post/lighting/material pillar: AA/TAA, SSAO, aerial perspective, volumetric clouds, PBR map channels + triplanar/splat terrain, SSR/refraction water, GPU particles, environment IBL, and — structurally — a real planet you can fly down to.

---

## 3) The gap (itemized)

Severity: **[Cosmetic]** = polish; **[Feature]** = a bounded subsystem to add; **[Structural]** = requires reworking scene/data layout; **[Engine]** = gated by the display-sphere/flat-heightfield rebuild (Vol 2/3) or a renderer swap. Effort in engineer-weeks (ew) is the standalone cost of parity-*enough*, not literal NMS parity.

| # | Feature | NMS | AMS today | Severity | Effort |
|---|---------|-----|-----------|----------|--------|
| 1 | Anti-aliasing | TAA + upscaler | none effective (composer bypasses MSAA) | [Feature] | 0.5 ew (SMAA) / 3 ew (TAA) |
| 2 | Temporal upscaling | FSR2/DLSS-class | none | [Structural] | 4–6 ew |
| 3 | PBR material channels | albedo/metal/rough/normal/AO/height/SSS | albedo-only (ships); vertex-colour (terrain/flora) | [Feature] | 3 ew |
| 4 | Terrain shading | triplanar + splat + POM | vertex-colour + 1 detail tex | [Feature] | 2.5 ew |
| 5 | Terrain topology | SDF voxels, caves, overhangs, edits | CPU flat heightfield, skirts | [Engine] | Vol 2/3 |
| 6 | Round planet / seamless landing | continuous LOD octree | display sphere → scene-swap | [Engine] | Vol 2/3 |
| 7 | Clustered/many lights | tiled/clustered | 1 dir + 1 hemi (surface); 1 point (space) | [Structural] | 3 ew (WebGL) |
| 8 | Shadows | CSM 3–4 + contact | 1 ortho cascade, 2048² | [Feature] | 2 ew (CSM) |
| 9 | SSAO/GTAO | HBAO/GTAO | none | [Feature] | 1.5 ew |
| 10 | GI / IBL | probes + SSGI | hemi fill only, no env map | [Feature] | 2 ew (IBL) |
| 11 | Aerial perspective | Rayleigh/Mie on geometry | none (rim shell only) | [Feature] | 2.5 ew |
| 12 | Sky model | precomputed scattering | gradient dome | [Cosmetic]→[Feature] | 2 ew |
| 13 | Volumetric clouds | raymarched + weather map | baked 2D shell (space only) | [Feature] | 4 ew (WebGL) / 2 ew (WebGPU) |
| 14 | Water surface | SSR + refraction + caustics + foam | tint + sine normals + 1 spec | [Feature] | 3 ew |
| 15 | Foliage LOD | instanced + impostors + wind field | instanced + wind, hard pop | [Cosmetic] | 1.5 ew |
| 16 | Grass density/fade | GPU, huge counts | 5.2k cross-quads, near only | [Cosmetic] | 1 ew |
| 17 | GPU particles | GPU-sim | CPU pools | [Structural] | 2 ew (WebGL TF) |
| 18 | Weather VFX depth | storms modulate world | point fields + flash | [Cosmetic] | 1 ew |
| 19 | Heat-haze / refraction | scene-colour distortion | none | [Feature] | 1 ew |
| 20 | Bloom quality | HDR multi-mip | UnrealBloom (boxy tail) | [Cosmetic] | 0.5 ew |
| 21 | Motion blur | per-object + camera | none | [Feature] | 1.5 ew |
| 22 | Depth of field | cockpit/photo | none | [Cosmetic] | 1 ew |
| 23 | Auto-exposure | histogram eye-adapt | fixed 1.0 | [Feature] | 1 ew |
| 24 | Color grading | per-biome 3D LUT | none | [Cosmetic] | 0.5 ew |
| 25 | Environment reflections | probes/SSR | none (metal reflects nothing) | [Feature] | 1.5 ew |
| 26 | Volumetric nebulae | layered/volumetric | additive sprites | [Cosmetic] | 1.5 ew |
| 27 | Texture streaming | virtual/PRT | N/A (procedural, small) | — | n/a |

**Reading the table.** The [Cosmetic]/[Feature] rows (1, 3, 4, 8–14, 19–25) are the fast, high-visibility wins that close most of the *perceived* "not even near" gap and are achievable **on the current WebGL2 engine without the planet rebuild**. The [Engine] rows (5, 6) — voxel terrain and a round, seamlessly-landable planet — are the true structural chasm and are owned by Vol 2/3. The [Structural] rows (2, 7, 17) are where WebGL2 starts to fight us and WebGPU becomes the rational path (§6).

---

## 4) Target design (data structures, algorithms, GLSL/JS sketches, file plan)

### 4.1 Post-processing framework (`src/render/post/`)

Replace the ad-hoc composer in `engine.js` with an explicit, ordered, HDR pass graph. Render the scene to an **HDR float target** (`HalfFloatType`), keep a **velocity buffer** (RG16F, per-object motion) and **depth** for AO/DoF/fog, then run:

```
GBuffer/HDR + velocity + depth
  → TAA (jittered projection, history reproject, neighbourhood clamp)   [pass]
  → SSAO/GTAO (half-res, bilateral upsample, multiplied into ambient)   [pass]
  → Bloom (HDR threshold, 6-mip down/up, energy-preserving)             [pass]
  → Motion blur (velocity gather)                                       [pass]
  → DoF (CoC from depth, gather)                                        [pass, optional]
  → Auto-exposure (downsample→histogram→adapt uExposure)                [compute-ish]
  → Composite: exposure → ACES → LUT → grain/vignette/CA → OutputPass
```

Data structure — a declarative pass list so states can toggle passes and quality tiers:

```js
// src/render/post/PostChain.js
export class PostChain {
  constructor(renderer, { hdr = true } = {}) {
    this.passes = [];          // [{ enabled, quality, render(read, write, ctx) }]
    this.hdrTarget = makeRT(THREE.HalfFloatType);
    this.velocityTarget = makeRT(THREE.HalfFloatType, 2);
    this.history = makeRT(THREE.HalfFloatType);   // TAA
    this.uExposure = { value: 1 };                // driven by auto-exposure
  }
  add(pass) { this.passes.push(pass); return pass; }
  setTier(tier) { /* 'low'|'med'|'high' flips enabled+quality */ }
  render(scene, camera) { /* jitter camera, render, ping-pong passes */ }
}
```

**TAA (highest-leverage single item).** Jitter the projection matrix by a Halton(2,3) sequence each frame, reproject history using the velocity buffer, clamp history to the local neighbourhood AABB in YCoCg to kill ghosting, blend `~0.9` history. This alone removes the shimmer that currently makes AMS read as "cheap," and it is the prerequisite for affordable volumetrics.

**Auto-exposure.** Downsample luminance → log-average (or 64-bin histogram) → exponential adaptation into `uExposure`. Wire into `Engine.setExposure`. Instantly modernises cave→surface and night→day transitions.

**Bloom + LUT + grain.** Swap `UnrealBloomPass` for an energy-preserving multi-mip bloom (kills the boxy tail called out in `sun.js`). Add a 32³ 3D-LUT sampler (bake per-biome grades procedurally — no external asset) and a cheap grain/vignette/CA composite. These four (TAA, exposure, LUT, bloom) are ~2 ew combined and move the needle more than anything else.

### 4.2 Aerial-perspective atmosphere (`src/render/sky/atmosphere2.js`)

Replace the rim shell with a scattering model whose transmittance/in-scatter is *also applied to surface geometry*. Precompute a small transmittance LUT (256×64) and optional multi-scatter LUT once per planet (Bruneton/Hillaire-lite). Sky dome samples full in-scatter; every opaque surface shader applies aerial perspective as a post-lighting term.

GLSL sketch (single-scatter, analytic, no LUT — the minimal version that already beats the current shell):

```glsl
// Rayleigh + Mie single scattering integrated camera→fragment.
const vec3  betaR = vec3(5.8e-6, 13.5e-6, 33.1e-6); // Rayleigh (scaled to world)
const float betaM = 21e-6;                           // Mie
float phaseR(float c){ return 0.0596831 * (1.0 + c*c); }
float phaseM(float c, float g){                       // Henyey-Greenstein
  float g2 = g*g;
  return 0.1193662 * (1.0-g2) / pow(1.0 + g2 - 2.0*g*c, 1.5);
}
// out: color the surface fragment already lit, then fold in aerial perspective.
vec3 aerialPerspective(vec3 camPos, vec3 fragPos, vec3 litColor, vec3 sunDir,
                       float planetR, float atmoR, vec3 sunColor) {
  vec3  ray   = fragPos - camPos;
  float dist  = length(ray);
  vec3  dir   = ray / dist;
  const int N = 8;                       // few steps; TAA hides the noise
  float seg   = dist / float(N);
  float cosT  = dot(dir, sunDir);
  float pR = phaseR(cosT), pM = phaseM(cosT, 0.76);
  vec3  inscat = vec3(0.0); float odR = 0.0, odM = 0.0;
  for (int i = 0; i < N; ++i) {
    vec3 p  = camPos + dir * (seg * (float(i)+0.5));
    float h = max(length(p) - planetR, 0.0);
    float hr = exp(-h / 8000.0), hm = exp(-h / 1200.0);
    odR += hr * seg; odM += hm * seg;
    vec3 tr = exp(-(betaR*odR + betaM*1.1*odM));      // transmittance to camera
    // (sun transmittance to p would come from the LUT; approx = 1 here)
    inscat += tr * (betaR*hr*pR + betaM*hm*pM) * seg;
  }
  vec3 transmit = exp(-(betaR*odR + betaM*1.1*odM));
  return litColor * transmit + inscat * sunColor * 20.0; // fold haze over geometry
}
```

Wire `aerialPerspective()` into the terrain and flora fragment shaders (replacing/augmenting `FogExp2`), and the same betas drive the sky dome and the from-orbit rim. One coherent solution → distant terrain gains the blue-haze depth cue that currently reads as flat, sunsets tint the whole world, and the orbit rim becomes physical rather than a fresnel guess. **Engine note:** on the surface this is trivially compatible with the flat heightfield; the *from-orbit → surface continuity* of the atmosphere is engine-gated (Vol 2/3).

### 4.3 Raymarched volumetric clouds (`src/render/sky/volclouds.js`)

Surface-scene raymarched clouds in a slab between two altitudes, coverage from a 2D weather texture, density from 3D Worley/Perlin, Beer–Powder lighting, temporal reprojection + blue-noise offset to keep step counts low. This is the single most impactful *sky* upgrade for the surface.

```glsl
uniform sampler3D uNoise;      // packed Perlin-Worley (rgba octaves)
uniform sampler2D uWeather;    // r=coverage g=type b=rain a=-
uniform float uCloudBase, uCloudTop, uTime;
uniform vec3  uSunDir, uSunColor;

float remap(float v,float a,float b,float c,float d){return c+(v-a)/(b-a)*(d-c);}
float density(vec3 p){
  vec2 uvw = p.xz * 0.00004 + uTime * 0.002;
  float cov = texture(uWeather, uvw).r;
  float hf  = clamp((p.y-uCloudBase)/(uCloudTop-uCloudBase),0.0,1.0);
  float base = texture(uNoise, p*0.0004 + uTime*0.01).r;
  base = remap(base, 1.0-cov, 1.0, 0.0, 1.0);
  float detail = texture(uNoise, p*0.004).g;         // erode edges
  float shape = clamp(base - detail*(1.0-hf)*0.4, 0.0, 1.0);
  float grad = hf*(1.0-hf)*4.0;                       // fat middle, thin caps
  return shape * grad;
}
float lightMarch(vec3 p){                             // toward the sun
  float d = 0.0, t = 0.0;
  for (int i=0;i<6;i++){ t += 40.0; d += density(p + uSunDir*t); }
  return exp(-d*0.9) + 0.3*exp(-d*0.15);              // Beer + powder-ish
}
vec4 marchClouds(vec3 ro, vec3 rd, float blueNoise){
  float t = intersectSlab(ro, rd, uCloudBase, uCloudTop) + blueNoise*30.0;
  vec3 sum = vec3(0.0); float trans = 1.0;
  for (int i=0;i<64;i++){
    vec3 p = ro + rd*t;
    if (p.y<uCloudBase-50.0 || p.y>uCloudTop+50.0 || trans<0.02) break;
    float dn = density(p);
    if (dn > 0.001){
      float li = lightMarch(p);
      vec3  c  = uSunColor * li;
      float a  = 1.0 - exp(-dn*0.06*40.0);
      sum   += c * a * trans;
      trans *= 1.0 - a;
    }
    t += 40.0;                                        // reproject prev frame to amortise
  }
  return vec4(sum, 1.0 - trans);
}
```

Composite before the sky dome using depth so hills occlude clouds. On WebGL2 this is a full-screen frag pass at half-res + TAA upsample (~4 ew, watch mobile). On WebGPU it becomes a compute pass with a persistent history texture (~2 ew), which is a concrete argument for §6.

### 4.4 Triplanar + splat terrain material (`src/render/terrain_material.js`)

Upgrade the terrain `MeshStandardMaterial` (or replace with a custom PBR node material) to triplanar-projected, height-blended splat with full map channels. Data model:

```js
// A biome material set = tiling PBR maps (all procedurally baked, no external assets).
const MaterialSet = {
  rock:  { albedo, normal, rough, ao, scale: 4.0 },
  scree: { albedo, normal, rough, ao, scale: 2.0 },
  soil:  { albedo, normal, rough, ao, scale: 3.0 },
  snow:  { albedo, normal, rough, ao, scale: 6.0 },
  sand:  { albedo, normal, rough, ao, scale: 5.0 },
};
// splat weights chosen per-fragment from slope/altitude/moisture/latitude/noise,
// height-map-blended for hard transitions (not linear crossfade).
```

```glsl
// Triplanar sample: project on 3 world axes, blend by normal^k. Kills UV stretch.
vec4 triplanar(sampler2D tex, vec3 wp, vec3 n, float scale){
  vec3 bw = pow(abs(n), vec3(4.0));
  bw /= (bw.x+bw.y+bw.z);
  vec4 x = texture(tex, wp.zy*scale);
  vec4 y = texture(tex, wp.xz*scale);
  vec4 z = texture(tex, wp.xy*scale);
  return x*bw.x + y*bw.y + z*bw.z;
}
// Height-map blend: sharpens splat seams instead of muddy linear mixes.
float heightBlend(float wa, float ha, float wb, float hb){
  float d = 0.2;
  float ma = wa + ha, mb = wb + hb, m = max(ma, mb) - d;
  return clamp(ma - m, 0.0, 1.0) / (clamp(ma-m,0.0,1.0)+clamp(mb-m,0.0,1.0)+1e-5);
}
vec3 terrainAlbedo(vec3 wp, vec3 n, Splat s){
  vec4 rock = triplanar(rockAlb, wp, n, 4.0);
  vec4 soil = triplanar(soilAlb, wp, n, 3.0);
  vec4 snow = triplanar(snowAlb, wp, n, 6.0);
  float wRockSoil = heightBlend(s.rock, rock.a, s.soil, soil.a);
  vec3 c = mix(soil.rgb, rock.rgb, wRockSoil);
  c = mix(c, snow.rgb, heightBlend(1.0-s.snow, 0.5, s.snow, snow.a));
  return c;
}
```

Because the maps are **procedurally baked** (bake `makeDetailTexture`-style DataTextures into an albedo/normal/rough/ao set per biome at load), this respects the zero-asset rule while giving the ground real normal-mapped micro-relief, correct cliff shading, and hard rock/sand/snow transitions. This is a pure win on the **existing flat heightfield** — no engine rebuild required — and is the highest-ROI *surface* fidelity item.

### 4.5 Water (`src/render/water.js`), IBL, particles

- **Water:** add screen-space reflection (march the depth/colour buffer) with a horizon/roughness fallback, refraction via scene-colour UV distortion by the wave normal, depth-based extinction (reuse the existing sea depth texture), shoreline foam from depth delta (already partly present), and projected caustics on the seabed. Reuse `SEA_FRAG` as the base.
- **IBL/reflections:** capture a small `PMREMGenerator` environment from the sky (and nebula/sun in space) once per lighting change; assign as `scene.environment`. This immediately gives ship metal (`shipmesh.js`, currently `metalness 0.75` reflecting nothing) something to reflect and grounds all PBR.
- **GPU particles:** move `effects.js` pools to transform-feedback (WebGL2) or compute (WebGPU) with soft-particle depth fade and additive heat-haze via scene-colour refraction. Keep the excellent pooling API; swap the simulation backend.

### 4.6 Module/file plan under `src/render/`

```
src/render/
  post/PostChain.js         # ordered HDR pass graph (replaces composer in engine.js)
  post/passes/TAA.js
  post/passes/GTAO.js
  post/passes/Bloom.js      # energy-preserving multi-mip
  post/passes/MotionBlur.js
  post/passes/DoF.js
  post/passes/AutoExposure.js
  post/passes/Composite.js  # exposure→ACES→LUT→grain/vignette/CA
  sky/atmosphere2.js        # scattering + aerial perspective (surface & orbit)
  sky/volclouds.js          # raymarched surface clouds
  terrain_material.js       # triplanar + splat + baked PBR map sets
  water.js                  # SSR + refraction + caustics
  ibl.js                    # PMREM env capture from sky/sun/nebula
  particles/GPUParticles.js # TF/compute backend behind the effects.js API
```

`engine.js` shrinks to renderer setup + `PostChain` ownership; each `*State` selects a quality tier and a per-biome LUT.

---

## 5) Implementation phases (dependency-ordered)

**Phase A — Post foundation (no engine changes).**
- [ ] `PostChain` HDR graph replaces the composer in `engine.js`; wire velocity + depth targets.
- [ ] SMAA immediately; then TAA (jitter + reproject + clamp). *Depends on velocity buffer.*
- [ ] Auto-exposure → `uExposure`; energy-preserving bloom; 3D-LUT composite + grain/vignette/CA.
- [ ] GTAO half-res + bilateral upsample into ambient. *Depends on depth+normal.*

**Phase B — Lighting & materials (flat heightfield OK).**
- [ ] IBL: `PMREMGenerator` env from sky; assign `scene.environment`; grade ship/station metal.
- [ ] CSM (3 splits) replacing the single ortho cascade in `sky.js`; add contact shadows.
- [ ] Triplanar + splat + baked PBR map sets in `terrain_material.js`.
- [ ] PBR map channels for ships/stations (bake normal/rough from the existing paint canvas).

**Phase C — Atmosphere & sky (surface first).**
- [ ] `atmosphere2.js` scattering + aerial perspective folded into terrain/flora/water shaders and the sky dome.
- [ ] `volclouds.js` raymarched surface clouds with weather map + TAA upsample. *Depends on TAA + depth.*

**Phase D — Water, particles, weather depth.**
- [ ] `water.js` SSR + refraction + caustics + foam. *Depends on scene-colour + depth.*
- [ ] GPU particle backend behind `effects.js`; soft particles + heat-haze.
- [ ] Weather couples to fog/wind/exposure; surface accumulation (snow/wet).

**Phase E — Space polish & finish.**
- [ ] HDR-buffered star PSF, layered/volumetric nebulae, planet shadows/eclipses, entry glow.
- [ ] Motion blur, DoF (cockpit/photo), foliage impostor LOD + wind field.

**Phase F — Engine-gated (Vol 2/3).**
- [ ] Round planet + seamless orbit→surface; SDF-voxel terrain (caves/overhangs/edits). *Everything above is designed to drop onto the new engine unchanged (shaders and passes are geometry-agnostic).* 

**Dependency spine:** velocity+depth → TAA → (volclouds, motion blur, DoF); depth+normal → GTAO; scene-colour+depth → water SSR + heat-haze; IBL → all PBR. TAA is the keystone — do it first.

---

## 6) Effort & risk (engineer-weeks, risks, engine-gating)

### 6.1 Effort roll-up

| Phase | Content | Effort |
|-------|---------|--------|
| A | Post foundation (TAA, exposure, bloom, LUT, GTAO) | 6–7 ew |
| B | IBL, CSM+contact, triplanar/splat terrain, ship PBR maps | 8–9 ew |
| C | Aerial-perspective atmosphere + volumetric clouds (WebGL2) | 6–7 ew |
| D | Water SSR/refraction/caustics, GPU particles, weather depth | 6 ew |
| E | Space polish, motion blur, DoF, foliage LOD | 5 ew |
| **Subtotal (WebGL2, on current engine)** | | **31–34 ew** |
| F | Round planet + voxel terrain (Vol 2/3) | out of scope here |
| WebGPU migration (see below) | renderer swap + TSL port | 10–14 ew (partly overlaps C/D) |

A single engineer reaches a *dramatic* perceived-quality jump after **Phase A alone (~1.5 months)** — TAA + auto-exposure + LUT + better bloom is where "not even near" starts to become "clearly the same family." Phases B–C are where AMS reads as a genuine peer on the *look* (if not the topology).

### 6.2 The WebGL2 ceiling and the WebGPU recommendation

**Where WebGL2 pinches.** WebGL2 has no compute shaders and no storage buffers. That forces:
- **Particles/cloth/foliage sim** into transform feedback — workable but awkward, no scatter writes, painful for large sorted systems.
- **Volumetric clouds** into full-screen fragment marches with ping-pong history — doable (§4.3) but expensive; half-res + TAA is mandatory and mobile struggles.
- **Clustered/tiled lighting** into texture-encoded light lists built on the CPU or via fragment tricks — the light-culling compute pass that makes NMS's many-lights cheap is essentially unavailable, so [Structural] row 7 stays capped.
- **No temporal upscaler** worth the name; you hand-roll TAA and eat native-res cost.

None of this blocks Phases A–E — they are explicitly scoped to WebGL2 — but they cap the *ceiling*: many-lights, cheap volumetrics, and GPU-driven scatter/culling are where you hit the wall.

**Recommendation: migrate to three.js `WebGPURenderer` + TSL, as a deliberate Phase-C/D-parallel track, not a prerequisite.** Rationale:
- **What it unlocks:** compute shaders (clouds, GPU particles, foliage scatter, terrain meshing on GPU), storage buffers, and a clean path to **clustered lighting** — precisely the three [Structural] gaps. WebGPU-class volumetrics drop from ~4 ew of fragment-march plumbing to ~2 ew of a compute pass with a real history buffer.
- **TSL (Three Shading Language):** node-based, compiles to both WGSL and GLSL, so shaders are written once and the `WebGLRenderer` remains a fallback. This de-risks the browser-support problem: WebGPU is shipping in current Chrome/Edge/Firefox and Safari 17+/18, but you keep a WebGL2 path for the tail.
- **Cost/risk:** the port is real work (10–14 ew) because AMS has many hand-written `ShaderMaterial`/`onBeforeCompile` GLSL injections (`terrain.js`, `flora.js`, `underwater.js`, `planetmesh.js`) that must be reauthored in TSL. `EffectComposer` → `PostProcessing` node graph is a rewrite of `PostChain`. Mitigation: build `PostChain` (Phase A) with a thin abstraction so its passes can target either backend, and port shaders module-by-module behind the existing update/dispose contracts (which are already clean).
- **Verdict:** WebGPU is the *realistic path to AAA-adjacent fidelity in a browser*, and it is the correct home for the round-planet/voxel rebuild (Vol 2/3), whose GPU meshing wants compute. Do Phases A–B on WebGL2 (fast, universal), stand up the WebGPU/TSL track in parallel starting at Phase C, and make the round-planet engine WebGPU-native.

### 6.3 Risks

- **Perf regression on integrator GPUs / mobile.** TAA + GTAO + volclouds + SSR is a lot. Mitigation: strict quality tiers in `PostChain.setTier`, dynamic-resolution scaling driven by the frame clock (`Engine.tick` already clamps dt), and half-res volumetrics.
- **TAA ghosting** on the many additive HDR elements (stars, engine trails, sea glints). Mitigation: velocity for dynamic emitters, YCoCg neighbourhood clamp, and a "no-history" stencil for known-problem additive layers.
- **Zero-asset rule vs. PBR maps.** All new maps (normal/rough/ao/3D noise/LUT/weather) must be **baked procedurally at load** (extending the existing `makeDetailTexture`/`makeCloudTexture`/`ringTexture` pattern). Budget bake time and cache in IndexedDB.
- **Engine-gating conflation.** Aerial perspective and clouds *look* like they need the round planet — they don't (surface versions work on the flat heightfield). Only *orbit↔surface continuity* is gated. Keep that boundary explicit so Phases C–D don't stall waiting on Vol 2/3.
- **Determinism.** VFX may use `Math.random` (per project rules), but any world-affecting procedural bake must stay seeded (`RNG`), matching the existing discipline.

---

## 7) Acceptance criteria (headless verification)

Testing graphics headlessly is constrained: the CI target is **Playwright + Chromium with SwiftShader** (software WebGL2). SwiftShader is a correctness reference, not a fidelity or perf reference — it lacks real MSAA behaviour, float-filtering edge cases differ, timing is 10–100× slower than GPU, and **WebGPU is not reliably available** under it. So acceptance is split into *behavioural* checks (run everywhere), *reference-image* checks (run on a GPU runner or with generous tolerances on SwiftShader), and *perf* checks (GPU runner only, advisory on SwiftShader).

**A. Behavioural / smoke (Playwright + SwiftShader, must pass in CI):**
- [ ] Each state boots and `PostChain.render()` produces a non-blank, finite framebuffer (sample center pixels; assert not all-black/all-NaN) for Space, Surface, Hangar, and Underwater-submerged.
- [ ] Toggling each pass (`taa/gtao/bloom/dof/lut`) changes the output hash (proves the pass is wired) and never throws.
- [ ] `AutoExposure` drives `uExposure` monotonically toward target when average luminance is forced high/low (unit-test the adaptation curve, not pixels).
- [ ] No WebGL errors/`INVALID_*`, no shader link failures (assert on `getProgramInfoLog`), no per-frame allocations in the steady state (heap-delta assertion over N frames, matching existing pooling discipline).
- [ ] All `dispose()` paths free GPU resources (count `renderer.info.memory.{textures,geometries}` returns to baseline after enter→leave for each new module).

**B. Reference-image / perceptual (GPU runner preferred; SwiftShader with high tolerance):**
- [ ] Deterministic camera poses per state (fixed seed, fixed sun elevation) rendered to PNG, compared against golden images via SSIM/`pixelmatch` with per-scene tolerance (looser on SwiftShader; tight on GPU). Store goldens per backend.
- [ ] Feature presence probes: with TAA off vs on, edge-variance (Laplacian energy along known silhouettes) must drop ≥X%. With GTAO on, mean luminance in known crevice regions must decrease. With aerial perspective on, distant-terrain saturation must fall and hue shift toward the sky beta. These are *statistical* assertions robust to software-renderer colour drift.
- [ ] Bloom energy: total HDR energy above threshold before/after bloom conserved within tolerance (catches the boxy-tail regression).
- [ ] Volumetric-cloud coverage matches the weather map: rendered cloud-alpha histogram correlates (≥0.8) with the input coverage texture.

**C. Performance (GPU runner only; advisory elsewhere):**
- [ ] Frame-time budget per tier at 1080p: `low ≤ 8 ms`, `med ≤ 12 ms`, `high ≤ 16 ms` on the reference GPU, measured via `EXT_disjoint_timer_query_webgl2` GPU timers (fall back to wall-clock deltas from `Engine.tick`).
- [ ] Draw-call and triangle ceilings per state asserted from `renderer.info.render` (regression guard; underwater already targets ≤8 draw calls — keep such budgets per module).
- [ ] Memory ceiling: `renderer.info.memory.textures` under a per-tier cap (guards the procedural-bake explosion risk).
- [ ] Adaptive-resolution controller keeps frame-time in band under a synthetic load spike (drive a scripted worst-case: storm + volclouds + water + full foliage).

**SwiftShader-specific guidance:** run Suite A on every PR (fast, deterministic, catches wiring/link/dispose regressions — the bugs that actually break). Run Suite B/C nightly on a GPU runner and gate releases on them. Where a check must run on SwiftShader, prefer **statistical/structural assertions** (variance, histogram correlation, energy conservation, monotonic adaptation) over exact pixel equality, because software-rasteriser colour/filtering drift will otherwise cause flaky goldens. Never assert AA quality on SwiftShader — its edge handling is not representative.

---

*End Volume 1. The surface-side of every item here (Phases A–E) is deliverable on the current WebGL2 display-sphere/flat-heightfield engine; only true round-planet continuity and voxel topology (rows 5–6) are engine-gated to Vol 2/3, and the WebGPU/TSL track in §6 is the recommended home for both the [Structural] gaps and that rebuild.*
