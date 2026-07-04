// -----------------------------------------------------------------------------
// godrays.js — Volumetric-looking crepuscular rays (god rays / light shafts) as
// a post pass for AllMansSky.
//
// WHY: A bright sun low on the horizon throwing shafts of light through haze and
// cloud is the single strongest "real engine" mood cue at sunrise/sunset — the
// No Man's Sky money shot. We fake the volumetric scatter cheaply as a
// screen-space radial blur from the sun's projected position (the classic
// GPU Gems 3 "Volumetric Light Scattering as a Post-Process", Mitchell 2007).
// No compute, no ray-marching, no depth read — SwiftShader-safe.
//
// ---------------------------------------------------------------------------
// HOW IT WORKS (two fullscreen draws, no extra scene geometry pass)
// ---------------------------------------------------------------------------
//   (1) BRIGHT-PASS / OCCLUSION: threshold the incoming HDR frame's luminance
//       into a (half-res) buffer. Only the very bright regions survive — the HDR
//       sun disc/halo the SkyDome renders (~5x sun colour) and bloom-lit cloud
//       edges. Everything the sun is *behind* stays black → it occludes the rays,
//       exactly like the depth-based occlusion buffer in the classic technique,
//       but derived for free from the already-composited frame.
//   (2) RADIAL BLUR + COMPOSITE: from the sun's screen-space position, march a
//       FIXED number of taps (compile-time SAMPLES) back toward the light through
//       the bright-pass buffer, accumulating with per-step decay/weight, scale by
//       exposure, tint by sun colour, and ADD over the original frame.
//
// Because it reads the composited colour there is no G-buffer, no depth texture,
// and no second scene render — just two screen-space quads (one at half res).
//
// ---------------------------------------------------------------------------
// WHERE IT GOES IN THE COMPOSER  (read before touching engine.js)
// ---------------------------------------------------------------------------
// Engine chain today:
//     RenderPass -> [AO] -> UnrealBloomPass -> OutputPass -> GradePass
// Insert this pass AFTER UnrealBloomPass and BEFORE OutputPass:
//     RenderPass -> [AO] -> UnrealBloomPass -> GODRAYS -> OutputPass -> GradePass
//
// WHY THAT SLOT:
//   * At that point the buffer is still HDR-linear (OutputPass does the ACES
//     tonemap + sRGB encode). Our bright-pass can cleanly threshold the HDR sun
//     (values >> 1) instead of a clipped LDR blob, and the added shafts are then
//     tonemapped WITH the rest of the frame — ACES rolls off the bright cores so
//     rays never harshly clip, and the subsequent GradePass vignette/contrast/
//     grain unifies them into the image instead of a "pasted-on" LDR overlay.
//   * After bloom (not before) so the sun's bloom halo feeds the occlusion buffer
//     — wider, softer ray roots — and so we don't bloom the streaks into mush.
//
// ---------------------------------------------------------------------------
// SwiftShader / headless safety (mirrors postao.js)
// ---------------------------------------------------------------------------
//   * The internal targets are HalfFloat (to preserve the HDR sun for a clean
//     threshold) and require WebGL2 float-colour-render support
//     (EXT_color_buffer_float). Chromium SwiftShader (WebGL2) exposes it and the
//     engine composer already depends on it, but we probe defensively and return
//     null (rays disabled) rather than allocate an incomplete framebuffer.
//   * The sample loop uses a COMPILE-TIME constant bound (#define SAMPLES) so it
//     compiles as an unrolled/fixed loop — no dynamic-length loops, which some
//     SwiftShader/ANGLE builds miscompile. GLSL ES 1.00, no extensions.
//   * render() is wrapped in try/catch: on the first GL error the pass disables
//     itself (pass.enabled = false — EffectComposer then skips it) and warns once.
//     It NEVER throws into the composer's frame loop, and on failure it passes the
//     frame through unchanged (copies readBuffer -> writeBuffer) so nothing breaks.
//   * opts.enabled === false returns null so the caller simply never adds it.
//
// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------
//   createGodrayPass(scene, camera, size, opts)      -> Pass | null
//   updateGodraySun(pass, sunWorldPos, camera, bool) -> void   (safe on null)
//   updateGodraySize(pass, width, height)            -> void   (safe on null)
//   disposeGodrayPass(pass)                          -> void   (safe on null)
// -----------------------------------------------------------------------------

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Cinematic defaults — deliberately SUBTLE. Rays should read as a mood cue and a
// low-sun accent, not a hazy soup that washes the frame out. Every value is
// overridable via opts and live-tunable through pass.uniforms.
const DEFAULTS = {
  density: 0.85,        // how far the tap vector reaches toward the sun (streak length)
  weight: 0.42,         // per-sample contribution
  decay: 0.93,          // illumination falloff per step (dimmer away from the sun)
  exposure: 0.34,       // overall scatter scale (applied pre-tonemap, so keep modest)
  intensity: 0.85,      // master multiplier (separate knob from exposure for easy fades)
  samples: 32,          // FIXED tap count, clamped [8,64]; compiled as a constant
  threshold: 0.55,      // HDR luminance above which a pixel counts as "light"
  thresholdSoft: 0.65,  // soft knee above the threshold
  tint: new THREE.Color(1.0, 0.86, 0.66), // warm sun tint over the shafts
  resolutionScale: 0.5, // bright-pass + blur buffer resolution (0.5 = half res)
  edgeFade: 0.22,       // screen-margin over which rays fade as the sun exits frame
};

const _viewPos = new THREE.Vector3();
const _ndc = new THREE.Vector3();

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// smoothstep(0,m,d): 0 at d<=0, 1 at d>=m.
function smoothEdge(d, m) {
  if (m <= 0) return d > 0 ? 1 : 0;
  const t = clamp(d / m, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Defensive probe: can this renderer render to a HalfFloat colour target? */
function _canRenderHalfFloat(renderer) {
  try {
    if (!renderer || typeof renderer.getContext !== 'function') return true;
    const gl = renderer.getContext();
    if (!gl) return true;
    const isWebGL2 = renderer.capabilities ? renderer.capabilities.isWebGL2 !== false : true;
    const has = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    return !!(isWebGL2 && has);
  } catch (_e) {
    return true; // probing failed — don't block on a flaky getExtension; render() is guarded anyway
  }
}

// ---------------------------------------------------------------------------
// The pass. Extends the addon Pass so EffectComposer sees a standard interface
// (enabled/needsSwap/renderToScreen/setSize/render/dispose).
// ---------------------------------------------------------------------------
class GodrayPass extends Pass {
  constructor(width, height, opts) {
    super();
    this.isGodrayPass = true;
    this.needsSwap = true;
    this._failed = false;

    const samples = Math.round(clamp(opts.samples, 8, 64));
    this._resScale = clamp(opts.resolutionScale, 0.1, 1.0);
    this._edgeFade = clamp(opts.edgeFade, 0.0, 0.5);

    const rw = Math.max(1, Math.round(width * this._resScale));
    const rh = Math.max(1, Math.round(height * this._resScale));

    // Half-res HDR bright-pass / occlusion buffer.
    this.occlusionRT = new THREE.WebGLRenderTarget(rw, rh, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.occlusionRT.texture.name = 'Godray.occlusion';

    // (1) bright-pass material — luminance threshold, keep HDR colour.
    this.occlusionMaterial = new THREE.ShaderMaterial({
      name: 'GodrayOcclusion',
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: opts.threshold },
        uThresholdSoft: { value: opts.thresholdSoft },
      },
      vertexShader: GODRAY_VERT,
      fragmentShader: GODRAY_OCCLUSION_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    // (2) radial-blur + composite material.
    this.compositeMaterial = new THREE.ShaderMaterial({
      name: 'GodrayComposite',
      defines: { SAMPLES: samples },
      uniforms: {
        tDiffuse: { value: null },   // original HDR frame (full res)
        tOcclusion: { value: null }, // bright-pass buffer (half res)
        uLightScreen: { value: new THREE.Vector2(0.5, 0.5) },
        uDensity: { value: opts.density },
        uWeight: { value: opts.weight },
        uDecay: { value: opts.decay },
        uExposure: { value: opts.exposure },
        uIntensity: { value: opts.intensity },
        uVisibility: { value: 0.0 }, // driven by updateGodraySun; starts hidden
        uTint: { value: opts.tint.clone() },
      },
      vertexShader: GODRAY_VERT,
      fragmentShader: GODRAY_COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this._fsQuad = new FullScreenQuad(this.occlusionMaterial);

    // Convenience: expose the live composite uniforms so callers can retint or
    // retune per frame, e.g. pass.uniforms.uTint.value.copy(sky.light.color).
    this.uniforms = this.compositeMaterial.uniforms;
  }

  setSize(width, height) {
    const rw = Math.max(1, Math.round(width * this._resScale));
    const rh = Math.max(1, Math.round(height * this._resScale));
    this.occlusionRT.setSize(rw, rh);
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    if (this._failed) return; // enabled=false already; composer skips us anyway
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;

      // (1) bright-pass -> half-res occlusion buffer (fullscreen tri covers all,
      // so no clear needed).
      this.occlusionMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      this._fsQuad.material = this.occlusionMaterial;
      renderer.setRenderTarget(this.occlusionRT);
      this._fsQuad.render(renderer);

      // (2) radial blur + add over the base frame -> writeBuffer (or screen).
      this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      this.compositeMaterial.uniforms.tOcclusion.value = this.occlusionRT.texture;
      this._fsQuad.material = this.compositeMaterial;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this._fsQuad.render(renderer);
    } catch (err) {
      if (!this._failed) {
        this._failed = true;
        console.warn('[godrays] render failed — disabling to protect the frame loop.', err);
      }
      this.enabled = false;
      // Pass the frame through unchanged so downstream passes get valid pixels.
      try {
        this.needsSwap = false; // keep the untouched readBuffer as the live buffer
      } catch (_e) { /* noop */ }
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
    }
  }

  dispose() {
    this.occlusionRT?.dispose();
    this.occlusionMaterial?.dispose();
    this.compositeMaterial?.dispose();
    this._fsQuad?.dispose();
  }
}

// ---------------------------------------------------------------------------
// createGodrayPass — build and configure the pass, or return null if disabled /
// unsupported. Attach it to the composer AFTER UnrealBloomPass, BEFORE OutputPass.
//
// @param {THREE.Scene}  scene   (unused by the shader — kept for API symmetry
//                                with createAOPass and future scene-aware tuning)
// @param {THREE.Camera} camera  (unused here; the sun is projected in updateGodraySun)
// @param {THREE.Vector2|{x,y}|{width,height}} size  CSS-pixel size (renderer.getSize).
//        The composer resizes the pass to DEVICE pixels on addPass, so this is
//        only the initial allocation.
// @param {object} opts
//        opts.enabled          default true; false -> returns null
//        opts.renderer         recommended: the WebGLRenderer, for the capability probe
//        opts.density/weight/decay/exposure/intensity/samples/threshold/
//        opts.thresholdSoft/tint/resolutionScale/edgeFade  override DEFAULTS
// ---------------------------------------------------------------------------
export function createGodrayPass(scene, camera, size, opts = {}) {
  if (opts.enabled === false) return null;
  if (opts.renderer && !_canRenderHalfFloat(opts.renderer)) {
    console.warn('[godrays] HalfFloat colour rendering unsupported — god rays disabled.');
    return null;
  }

  const o = Object.assign({}, DEFAULTS, opts);
  // tint may arrive as a hex/number/string — normalise to a THREE.Color.
  o.tint = (opts.tint instanceof THREE.Color) ? opts.tint.clone()
    : (opts.tint != null ? new THREE.Color(opts.tint) : DEFAULTS.tint.clone());

  const pr = opts.renderer && typeof opts.renderer.getPixelRatio === 'function'
    ? opts.renderer.getPixelRatio() : 1;
  const w = Math.max(1, Math.round((size?.x ?? size?.width ?? 512) * pr));
  const h = Math.max(1, Math.round((size?.y ?? size?.height ?? 512) * pr));

  try {
    return new GodrayPass(w, h, o);
  } catch (err) {
    console.warn('[godrays] Failed to construct god-ray pass — god rays disabled.', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// updateGodraySun — call once per frame BEFORE render. Projects the sun's world
// position to screen space and fades the rays out when the sun is behind the
// camera, off-screen (with a soft margin), or when the caller reports it invisible
// (visible === false, e.g. sun below the horizon at night).
//
// @param {Pass}          pass         from createGodrayPass (safe on null)
// @param {THREE.Vector3} sunWorldPos  a world-space point ALONG the sun direction
//        from the camera, e.g. camera.position + sky.sunDir * 1000. (Any positive
//        distance projects to the same pixel; keep it inside camera.far.)
// @param {THREE.Camera}  camera
// @param {boolean}       visible      false forces intensity 0 (sun below horizon)
// ---------------------------------------------------------------------------
export function updateGodraySun(pass, sunWorldPos, camera, visible) {
  if (!pass || !pass.isGodrayPass) return;
  const u = pass.compositeMaterial.uniforms;

  if (visible === false || !sunWorldPos || !camera) {
    u.uVisibility.value = 0;
    return;
  }

  // Behind the camera? (three looks down -z in view space → in front means z < 0)
  _viewPos.copy(sunWorldPos).applyMatrix4(camera.matrixWorldInverse);
  if (_viewPos.z >= 0) { u.uVisibility.value = 0; return; }

  // Project to normalized device coords, then to [0,1] screen UV.
  _ndc.copy(sunWorldPos).project(camera);
  const sx = _ndc.x * 0.5 + 0.5;
  const sy = _ndc.y * 0.5 + 0.5;
  u.uLightScreen.value.set(sx, sy);

  // Fade as the sun leaves the frame: 1 fully on-screen, ramping to 0 once it is
  // `edgeFade` beyond an edge. Distance outside [0,1] per axis, combined.
  const m = pass._edgeFade;
  const dx = sx < 0 ? -sx : (sx > 1 ? sx - 1 : 0);
  const dy = sy < 0 ? -sy : (sy > 1 ? sy - 1 : 0);
  const fade = (1 - smoothEdge(dx, m)) * (1 - smoothEdge(dy, m));
  u.uVisibility.value = clamp(fade, 0, 1);
}

// ---------------------------------------------------------------------------
// updateGodraySize — resize the internal buffer. Pass DEVICE pixels
// (width * pixelRatio), matching what EffectComposer feeds passes. If the pass is
// already in a composer, composer.setSize() already calls this for you. Safe on null.
// ---------------------------------------------------------------------------
export function updateGodraySize(pass, width, height) {
  if (!pass || typeof pass.setSize !== 'function') return;
  try {
    pass.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  } catch (err) {
    console.warn('[godrays] updateGodraySize failed.', err);
  }
}

// ---------------------------------------------------------------------------
// disposeGodrayPass — release GPU resources. Safe on null / already-disposed.
// ---------------------------------------------------------------------------
export function disposeGodrayPass(pass) {
  if (!pass) return;
  try {
    if (typeof pass.dispose === 'function') pass.dispose();
  } catch (err) {
    console.warn('[godrays] disposeGodrayPass failed.', err);
  }
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------
const GODRAY_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Bright-pass: keep only HDR-bright pixels (the sun disc/halo + bloom), preserve
// their colour. Everything dimmer is black and thus occludes the shafts.
const GODRAY_OCCLUSION_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  uniform float uThresholdSoft;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float mask = smoothstep(uThreshold, uThreshold + uThresholdSoft, lum);
    gl_FragColor = vec4(c * mask, 1.0);
  }
`;

// Radial blur toward the sun through the bright-pass buffer, then add over base.
// SAMPLES is a compile-time constant (#define) so the loop bound is fixed.
const GODRAY_COMPOSITE_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tOcclusion;
  uniform vec2 uLightScreen;
  uniform float uDensity;
  uniform float uWeight;
  uniform float uDecay;
  uniform float uExposure;
  uniform float uIntensity;
  uniform float uVisibility;
  uniform vec3 uTint;
  varying vec2 vUv;
  void main() {
    vec3 base = texture2D(tDiffuse, vUv).rgb;

    // Early out when the sun is faded fully out — just pass the frame through.
    if (uVisibility <= 0.0) { gl_FragColor = vec4(base, 1.0); return; }

    vec2 texCoord = vUv;
    vec2 delta = (vUv - uLightScreen) * (uDensity / float(SAMPLES));
    float decay = 1.0;
    vec3 rays = vec3(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      texCoord -= delta;
      vec3 s = texture2D(tOcclusion, texCoord).rgb;
      rays += s * (decay * uWeight);
      decay *= uDecay;
    }
    rays *= uExposure * uIntensity * uVisibility;
    // Additive, warmed by the sun tint. Pre-tonemap → OutputPass ACES rolls it off.
    gl_FragColor = vec4(base + rays * uTint, 1.0);
  }
`;
