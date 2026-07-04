// -----------------------------------------------------------------------------
// postao.js — Ambient Occlusion / contact-shadow post pass for AllMansSky.
//
// WHY: Objects on terrain and inside the station read as "pasted on" without
// ambient occlusion — AO is the single biggest cue that grounds geometry and
// separates a flat three.js frame from a real-engine frame. This module owns a
// screen-space AO pass that is inserted into the engine's EffectComposer chain
// AFTER RenderPass and BEFORE UnrealBloomPass (so crevices darken *before* they
// can bloom).
//
// WHAT PASS: Prefers three's GTAOPass (Ground-Truth AO — horizon-based, the same
// family Unity/Unreal ship) from `three/addons/postprocessing/GTAOPass.js`, which
// is present in three@0.160. Falls back to SSAOPass if GTAO is ever missing.
// Detection is a try/dynamic-import (see the top-level block below), so a build
// on a three version without GTAO degrades to SSAO instead of throwing.
//
// ---------------------------------------------------------------------------
// COMPOSER / DEPTH interaction  (read before touching engine.js)
// ---------------------------------------------------------------------------
// * The engine composer renders into a 4x-MSAA HalfFloat target. A multisampled
//   depth buffer is NOT sampleable as a texture, so an AO pass can't read the
//   composer's depth. GTAOPass/SSAOPass SIDESTEP this entirely: each renders its
//   OWN normal+depth G-buffer with a single-sample MeshNormalMaterial prepass.
//   => The AO pass does NOT need composer depth and does NOT require any change
//      to how the composer allocates its MSAA target.
//   => COST: one extra full-scene geometry pass per frame (the normal/depth
//      prepass), plus 2-3 fullscreen passes (AO + denoise/blur + blend). See the
//      perf note at the bottom.
//
// * logarithmicDepthBuffer: the renderer is created with
//   `logarithmicDepthBuffer: true`. GTAO/SSAO linearize depth with
//   `perspectiveDepthToViewZ` (standard hyperbolic depth) — they do NOT
//   understand log-encoded depth. Because the AO pass renders its own prepass
//   with the SAME renderer, that prepass would store log depth and the AO would
//   be wrong (haloing / distance-dependent over-darkening).
//   FIX (automatic, here): we wrap the pass's render() and temporarily flip
//   `renderer.capabilities.logarithmicDepthBuffer = false` for the duration of
//   the AO pass only. This makes the AO prepass compile+store LINEAR depth (what
//   the AO shader expects) while the main scene render is untouched. The flag is
//   restored in a finally{}. Toggle off with `opts.compensateLogDepth === false`.
//
// ---------------------------------------------------------------------------
// SwiftShader / headless safety
// ---------------------------------------------------------------------------
// * All AO render targets are HalfFloat and require WebGL2 float-color-render
//   support (EXT_color_buffer_float). Chromium SwiftShader (WebGL2) exposes it —
//   and the engine's composer already relies on it — but we probe defensively and
//   return null (AO disabled) rather than allocating an incomplete framebuffer if
//   it is ever missing. Construction is wrapped in try/catch.
// * The per-frame render() is wrapped in try/catch: on the first GL error the AO
//   pass disables itself (pass.enabled = false, which EffectComposer skips) and
//   warns once — the frame loop keeps running. NEVER throws into the composer.
// * `opts.enabled === false` returns null so the caller simply never adds the
//   pass. Default is on but fully overridable.
//
// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------
//   createAOPass(scene, camera, size, opts) -> Pass | null
//   updateAOSize(pass, width, height)       -> void   (safe on null)
//   disposeAOPass(pass)                     -> void   (safe on null)
//   isAOAvailable()                         -> boolean
//   AO_IMPLEMENTATION                       -> 'GTAOPass' | 'SSAOPass' | null
// -----------------------------------------------------------------------------

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Availability detection — try/dynamic import with graceful fallback.
// Top-level await keeps createAOPass() synchronous (so it drops straight into
// the synchronous setScene chain). Any importer of this module transparently
// waits for these to resolve, which happens once at app startup.
// ---------------------------------------------------------------------------
let _AOClass = null;
/** @type {'GTAOPass'|'SSAOPass'|null} */
let _impl = null;

try {
  const m = await import('three/addons/postprocessing/GTAOPass.js');
  if (m && m.GTAOPass) { _AOClass = m.GTAOPass; _impl = 'GTAOPass'; }
} catch (_e) {
  // GTAO not present in this three build — fall through to SSAO.
}
if (!_AOClass) {
  try {
    const m = await import('three/addons/postprocessing/SSAOPass.js');
    if (m && m.SSAOPass) { _AOClass = m.SSAOPass; _impl = 'SSAOPass'; }
  } catch (_e) {
    // Neither AO pass is available — createAOPass() will return null.
  }
}

/** Which implementation loaded: 'GTAOPass' | 'SSAOPass' | null. */
export const AO_IMPLEMENTATION = _impl;

/** True if an AO pass class was resolved and could be instantiated. */
export function isAOAvailable() { return _AOClass !== null; }

// ---------------------------------------------------------------------------
// Per-scene tuning profiles. Values are deliberately SUBTLE — AO should ground
// objects, not paint dark rings. Radii are in world units (view-space), matched
// to each scene's characteristic object scale.
// ---------------------------------------------------------------------------
const GTAO_PROFILES = {
  // Large outdoor terrain: rocks, flora, props, player at ~metre scale. Wider
  // radius for soft ground contact; strong distance falloff so distant terrain
  // and the sky/horizon stay clean.
  surface: {
    ao: { radius: 0.9, distanceExponent: 1.3, thickness: 1.0, distanceFallOff: 1.0, scale: 1.0, samples: 16, screenSpaceRadius: false },
    pd: { lumaPhi: 5, depthPhi: 2.0, normalPhi: 3.0, radius: 6, radiusExponent: 1.6, rings: 2, samples: 16 },
    intensity: 0.85,
  },
  // Tight interior station / hangar: crisper, shorter-range contact shadows in
  // corners and where props meet floors/walls. Full intensity reads well indoors.
  hangar: {
    ao: { radius: 0.5, distanceExponent: 1.0, thickness: 0.9, distanceFallOff: 1.0, scale: 1.0, samples: 16, screenSpaceRadius: false },
    pd: { lumaPhi: 6, depthPhi: 1.5, normalPhi: 4.0, radius: 5, radiusExponent: 1.4, rings: 2, samples: 16 },
    intensity: 1.0,
  },
  // Space: mostly empty. AO matters only for the cockpit interior / nearby
  // asteroids; a small world radius + steep falloff means distant planets and the
  // starfield receive ~zero AO (no haloing). Low intensity, present but quiet.
  space: {
    ao: { radius: 1.4, distanceExponent: 2.0, thickness: 1.0, distanceFallOff: 1.0, scale: 1.0, samples: 16, screenSpaceRadius: false },
    pd: { lumaPhi: 6, depthPhi: 2.0, normalPhi: 3.0, radius: 5, radiusExponent: 1.6, rings: 2, samples: 16 },
    intensity: 0.55,
  },
};

// SSAO fallback profiles (SSAO exposes a different, smaller knob set).
const SSAO_PROFILES = {
  surface: { kernelRadius: 12, minDistance: 0.0025, maxDistance: 0.08 },
  hangar:  { kernelRadius: 8,  minDistance: 0.005,  maxDistance: 0.10 },
  space:   { kernelRadius: 16, minDistance: 0.001,  maxDistance: 0.05 },
};

/** Normalize a requested profile name to a known key. */
function _profileKey(name) {
  switch (name) {
    case 'space': return 'space';
    case 'hangar':
    case 'station':
    case 'interior': return 'hangar';
    case 'surface':
    case 'planet':
    default: return 'surface';
  }
}

/** Defensive probe: can this renderer render to a HalfFloat color target? */
function _canRenderHalfFloat(renderer) {
  try {
    if (!renderer || typeof renderer.getContext !== 'function') return true; // no renderer to probe — assume yes, guarded by try/catch elsewhere
    const gl = renderer.getContext();
    if (!gl) return true;
    const isWebGL2 = renderer.capabilities ? renderer.capabilities.isWebGL2 !== false : true;
    // WebGL2: EXT_color_buffer_float enables half-float color rendering. Some
    // stacks additionally expose EXT_color_buffer_half_float.
    const has = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    return !!(isWebGL2 && has);
  } catch (_e) {
    return true; // probing failed — don't block AO on a flaky getExtension; render() is guarded anyway
  }
}

// ---------------------------------------------------------------------------
// createAOPass — build and configure the AO pass, or return null if AO is
// unavailable / disabled. Attach it to the composer AFTER RenderPass and BEFORE
// bloom. The returned pass carries metadata: pass.aoImplementation, pass.aoProfile.
//
// @param {THREE.Scene}  scene
// @param {THREE.Camera} camera
// @param {THREE.Vector2|{x:number,y:number}} size  CSS-pixel size (as from
//        renderer.getSize). The composer re-sizes the pass to device pixels on
//        addPass, so this is only the initial allocation.
// @param {object} opts
//        opts.scene        'surface' | 'space' | 'hangar' (profile; default 'surface')
//        opts.enabled      default true; false -> returns null
//        opts.renderer     recommended: the WebGLRenderer, for the capability probe
//        opts.intensity    override AO blend intensity (0..~1.5)
//        opts.ao           object merged over the profile's GTAO params
//        opts.pd           object merged over the profile's Poisson-denoise params
//        opts.compensateLogDepth  default true; false disables the log-depth fix
// ---------------------------------------------------------------------------
export function createAOPass(scene, camera, size, opts = {}) {
  if (opts.enabled === false) return null;
  if (!_AOClass) {
    console.warn('[postao] No AO pass available in this three build — AO disabled.');
    return null;
  }
  if (opts.renderer && !_canRenderHalfFloat(opts.renderer)) {
    console.warn('[postao] HalfFloat color rendering unsupported — AO disabled.');
    return null;
  }

  const profileName = _profileKey(opts.scene);
  const pr = opts.renderer && typeof opts.renderer.getPixelRatio === 'function'
    ? opts.renderer.getPixelRatio() : 1;
  const w = Math.max(1, Math.round((size?.x ?? size?.width ?? 512) * pr));
  const h = Math.max(1, Math.round((size?.y ?? size?.height ?? 512) * pr));

  let pass;
  try {
    if (_impl === 'GTAOPass') {
      const prof = GTAO_PROFILES[profileName];
      const aoParams = Object.assign({}, prof.ao, opts.ao);
      const pdParams = Object.assign({}, prof.pd, opts.pd);
      // GTAOPass(scene, camera, width, height, parameters, aoParameters, pdParameters)
      // parameters = undefined -> it allocates its own depthTexture + normal RT.
      pass = new _AOClass(scene, camera, w, h, undefined, aoParams, pdParams);
      pass.output = 0; // GTAOPass.OUTPUT.Default -> blends AO multiplicatively into the color
      pass.blendIntensity = (opts.intensity != null) ? opts.intensity : prof.intensity;
    } else {
      // SSAO fallback
      const prof = SSAO_PROFILES[profileName];
      pass = new _AOClass(scene, camera, w, h, 32);
      pass.kernelRadius = prof.kernelRadius;
      pass.minDistance = prof.minDistance;
      pass.maxDistance = prof.maxDistance;
      pass.output = 0; // SSAOPass.OUTPUT.Default -> blends AO into the color
      // SSAO has no blendIntensity uniform; intensity is baked into min/maxDistance.
    }
  } catch (err) {
    console.warn('[postao] Failed to construct AO pass — AO disabled.', err);
    return null;
  }

  // Metadata for the caller / debugging.
  pass.aoImplementation = _impl;
  pass.aoProfile = profileName;
  pass._compensateLogDepth = opts.compensateLogDepth !== false;

  // --- Wrap render(): (1) log-depth compensation, (2) crash isolation --------
  const _origRender = pass.render.bind(pass);
  let _failed = false;
  pass.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const caps = renderer.capabilities;
    const prevLog = caps ? caps.logarithmicDepthBuffer : false;
    const doComp = pass._compensateLogDepth && prevLog === true;
    if (doComp) caps.logarithmicDepthBuffer = false; // AO prepass -> linear depth
    try {
      _origRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } catch (err) {
      if (!_failed) {
        _failed = true;
        console.warn('[postao] AO pass render failed — disabling to protect the frame loop.', err);
      }
      pass.enabled = false;   // EffectComposer skips disabled passes on subsequent frames
      pass.needsSwap = false; // don't hand a half-written buffer downstream this frame
    } finally {
      if (doComp) caps.logarithmicDepthBuffer = prevLog; // always restore
    }
  };

  return pass;
}

// ---------------------------------------------------------------------------
// updateAOSize — resize the AO pass's internal targets. Pass DEVICE pixels
// (width * pixelRatio), matching what EffectComposer feeds passes.
//
// NOTE: If the pass has been added to the EffectComposer, `composer.setSize(w,h)`
// already resizes it automatically (the composer calls pass.setSize for every
// pass). This helper is for manual control or if the pass lives outside a
// composer. Safe on null.
// ---------------------------------------------------------------------------
export function updateAOSize(pass, width, height) {
  if (!pass || typeof pass.setSize !== 'function') return;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  try {
    pass.setSize(w, h);
  } catch (err) {
    console.warn('[postao] updateAOSize failed.', err);
  }
}

// ---------------------------------------------------------------------------
// disposeAOPass — release the pass's GPU resources (render targets, materials,
// data textures, fullscreen quad). Call before rebuilding the composer or on
// scene teardown. Safe on null / already-disposed.
// ---------------------------------------------------------------------------
export function disposeAOPass(pass) {
  if (!pass) return;
  try {
    if (typeof pass.dispose === 'function') pass.dispose();
  } catch (err) {
    console.warn('[postao] disposeAOPass failed.', err);
  }
}
