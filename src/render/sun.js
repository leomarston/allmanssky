// Sun renderer: animated convective star surface (3D-noise shader), layered
// camera-facing corona billboards (procedural canvas textures, additive HDR),
// and the system key light. All content deterministic from the star params.
import * as THREE from 'three';
import { RNG, hashString } from '../core/rng.js';

// Per-class art parameters. `color` is a fallback when star.colorHex is absent;
// the star's own colorHex always wins so galaxy + sun agree exactly.
const STAR_CLASSES = {
  M:      { color: 0xff6a3c, coronaScale: 0.92, lightIntensity: 2.2, churn: 1.25, granuleScale: 5.0 },
  K:      { color: 0xffa050, coronaScale: 0.96, lightIntensity: 2.6, churn: 1.1,  granuleScale: 5.6 },
  G:      { color: 0xffd27a, coronaScale: 1.0,  lightIntensity: 3.0, churn: 1.0,  granuleScale: 6.2 },
  F:      { color: 0xfff0c8, coronaScale: 1.05, lightIntensity: 3.3, churn: 0.9,  granuleScale: 6.8 },
  A:      { color: 0xf2f4ff, coronaScale: 1.1,  lightIntensity: 3.6, churn: 0.8,  granuleScale: 7.4 },
  B:      { color: 0xc4d6ff, coronaScale: 1.2,  lightIntensity: 4.0, churn: 0.7,  granuleScale: 8.0 },
  O:      { color: 0x9db9ff, coronaScale: 1.35, lightIntensity: 4.5, churn: 0.6,  granuleScale: 8.8 },
  exotic: { color: 0xc07dff, coronaScale: 1.25, lightIntensity: 3.4, churn: 1.6,  granuleScale: 7.0 },
};

// ---------------------------------------------------------------------------
// GLSL: Ashima/webgl-noise 3D simplex (public domain style, MIT) + fbm.
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm3(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * snoise(p);
    p = p * 2.02 + vec3(13.7);
    a *= 0.5;
  }
  return s;
}
`;

const SUN_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vObj = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SUN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColDark;
uniform vec3 uColMid;
uniform vec3 uColHot;
uniform vec3 uSeedOffset;
uniform float uGranuleScale;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorldPos;
${NOISE_GLSL}
void main() {
  vec3 p = vObj + uSeedOffset;
  vec3 drift = vec3(uTime * 0.018, uTime * 0.011, -uTime * 0.014);

  // Large slow active regions (hot latitudes / cool basins).
  float region = fbm3(p * 2.1 + drift);
  // Mid-scale convection: bright lanes where |noise| collapses to zero,
  // domain-warped by the large field so cells shear and flow.
  vec3 q = p * uGranuleScale + drift * 2.4 + region * 0.35;
  float lanes = 1.0 - abs(fbm3(q));
  lanes = pow(clamp(lanes, 0.0, 1.0), 4.5);
  // Fine granulation sparkle.
  float grain = fbm3(p * uGranuleScale * 3.1 - drift * 1.7) * 0.5 + 0.5;

  float heat = clamp(0.55 + 0.5 * region, 0.0, 1.0);
  vec3 col = mix(uColDark, uColMid, heat);
  col = mix(col, uColHot, lanes * (0.3 + 0.7 * heat));
  col += uColHot * grain * grain * 0.09;

  // Sunspots in the deepest basins.
  float spot = smoothstep(-0.38, -0.6, region);
  col = mix(col, uColDark * 0.3, spot * 0.9);

  // Limb darkening toward the edge of the disc.
  vec3 V = normalize(cameraPosition - vWorldPos);
  float mu = clamp(dot(normalize(vNormalW), V), 0.0, 1.0);
  col *= 0.2 + 0.84 * pow(mu, 0.6);
  // Thin chromosphere rim so the disc melts into the corona.
  col += uColHot * pow(1.0 - mu, 3.5) * 0.35;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Corona canvas textures (white; tinted by material color at HDR intensity).

function coronaGlowTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, a] of stops) g.addColorStop(t, `rgba(255,248,238,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function coronaStreamerTexture(size, rng) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const half = size / 2;
  ctx.globalCompositeOperation = 'lighter';
  const rays = 26 + rng.int(0, 10);
  for (let i = 0; i < rays; i++) {
    const ang = rng.next() * Math.PI * 2;
    const len = half * rng.range(0.42, 0.98);
    const w = half * rng.range(0.02, 0.07);
    const a = rng.range(0.12, 0.4);
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.35, `rgba(255,250,240,${a * 0.5})`);
    g.addColorStop(1, 'rgba(255,245,235,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -w);
    ctx.quadraticCurveTo(len * 0.5, -w * 0.3, len, 0);
    ctx.quadraticCurveTo(len * 0.5, w * 0.3, 0, w);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // Soft ring so streamers root into the limb (kept outside the disc region).
  const g = ctx.createRadialGradient(half, half, half * 0.3, half, half, half * 0.62);
  g.addColorStop(0, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.45, 'rgba(255,252,246,0.18)');
  g.addColorStop(1, 'rgba(255,250,240,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Radial fade mask: transparent edges AND a dimmed centre so the star disc
  // stays readable underneath (the billboard covers it).
  ctx.globalCompositeOperation = 'destination-in';
  const m = ctx.createRadialGradient(half, half, 0, half, half, half);
  m.addColorStop(0, 'rgba(0,0,0,0.08)');
  m.addColorStop(0.3, 'rgba(0,0,0,0.45)');
  m.addColorStop(0.4, 'rgba(0,0,0,1)');
  m.addColorStop(0.66, 'rgba(0,0,0,1)');
  m.addColorStop(0.92, 'rgba(0,0,0,0)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = m;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------

/**
 * Build the system star: animated convective surface shader, layered corona
 * billboards, and the system key light.
 *
 * @param {{class:string, colorHex:(number|string|undefined), radius:number,
 *          temperature:number}} star - `StarSystem.star` shape.
 * @returns {{object3d: THREE.Group, light: THREE.PointLight,
 *           update(dt:number, cameraPos?:THREE.Vector3):void, dispose():void}}
 *   Add `object3d` and `light` to the scene separately; `update` billboards the
 *   corona toward `cameraPos` and evolves the surface.
 */
export function createSun(star) {
  const cls = STAR_CLASSES[star?.class] || STAR_CLASSES.G;
  const radius = star?.radius > 0 ? star.radius : 30;
  const base = new THREE.Color(star?.colorHex ?? cls.color);
  const rng = new RNG(hashString(`sun:${star?.class}:${base.getHexString()}:${radius.toFixed(2)}`));

  // Palette family from the star color.
  const hot = base.clone().lerp(new THREE.Color(1, 1, 1), 0.72);
  const dark = base.clone().multiplyScalar(0.5).lerp(new THREE.Color(0.12, 0.02, 0.05), 0.28);
  const coronaTint = base.clone().lerp(new THREE.Color(1, 0.98, 0.94), 0.35);

  const group = new THREE.Group();
  group.name = 'sun';

  // --- surface -------------------------------------------------------------
  const surfMat = new THREE.ShaderMaterial({
    vertexShader: SUN_VERT,
    fragmentShader: SUN_FRAG,
    uniforms: {
      uTime: { value: rng.range(0, 400) },
      uColDark: { value: dark.clone().multiplyScalar(0.55) },
      uColMid: { value: new THREE.Color(base.r * 0.62, base.g * 0.62, base.b * 0.62) },
      uColHot: { value: new THREE.Color(hot.r * 2.0, hot.g * 2.0, hot.b * 2.0) },
      uSeedOffset: { value: new THREE.Vector3(rng.range(-40, 40), rng.range(-40, 40), rng.range(-40, 40)) },
      uGranuleScale: { value: cls.granuleScale },
    },
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), surfMat);
  sphere.frustumCulled = true;
  group.add(sphere);

  // --- corona billboards -----------------------------------------------------
  // NOTE: plane geometry is 2x2, so `scale` is the billboard HALF-extent;
  // the star disc occupies radius/scale of each texture. Inner layers are
  // ring-shaped so the additive glow does not wash out the disc shader.
  const cs = cls.coronaScale;
  const layers = [
    { // chromosphere ring hugging the limb (alpha hits 0 well inside the quad)
      tex: coronaGlowTexture(512, [[0, 0.02], [0.45, 0.05], [0.56, 0.3], [0.68, 0.09], [0.78, 0.02], [0.88, 0], [1, 0]]),
      scale: radius * 1.75 * cs, hdr: 1.3, pulse: 0.03, speed: 0.9, spin: 0.0,
    },
    { // streamers
      tex: coronaStreamerTexture(512, rng.fork('streamers')),
      scale: radius * 2.8 * cs, hdr: 1.1, pulse: 0.05, speed: 0.55, spin: 0.02,
    },
    { // broad soft halo — big and round so it swallows bloom's boxy tail
      tex: coronaGlowTexture(512, [[0, 0.2], [0.14, 0.15], [0.3, 0.075], [0.5, 0.032], [0.7, 0.011], [0.88, 0], [1, 0]]),
      scale: radius * 6.4 * cs, hdr: 0.65, pulse: 0.06, speed: 0.34, spin: 0.0,
    },
  ];
  const planeGeo = new THREE.PlaneGeometry(2, 2);
  const billboards = layers.map((l, i) => {
    const mat = new THREE.MeshBasicMaterial({
      map: l.tex,
      color: new THREE.Color(coronaTint.r * l.hdr, coronaTint.g * l.hdr, coronaTint.b * l.hdr),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.renderOrder = 1 + i;
    mesh.scale.setScalar(l.scale);
    mesh.frustumCulled = false;
    group.add(mesh);
    return {
      mesh, mat,
      baseScale: l.scale,
      pulse: l.pulse,
      speed: l.speed * cls.churn,
      phase: rng.range(0, Math.PI * 2),
      baseAngle: rng.range(0, Math.PI * 2),
      spin: l.spin * (rng.chance(0.5) ? 1 : -1),
    };
  });

  // --- key light -------------------------------------------------------------
  const light = new THREE.PointLight(base.clone().lerp(new THREE.Color(1, 1, 1), 0.4), cls.lightIntensity, 0, 0);

  let t = 0;
  const tmpWorld = new THREE.Vector3();

  return {
    object3d: group,
    light,

    /**
     * Advance the surface animation and face the corona toward the camera.
     * @param {number} dt seconds
     * @param {THREE.Vector3} [cameraPos] camera world position
     */
    update(dt, cameraPos) {
      t += dt;
      surfMat.uniforms.uTime.value += dt * cls.churn;
      for (let i = 0; i < billboards.length; i++) {
        const b = billboards[i];
        if (cameraPos) {
          b.mesh.lookAt(cameraPos);
          b.mesh.rotateZ(b.baseAngle + b.spin * t);
        }
        const s = b.baseScale * (1 + b.pulse * Math.sin(t * b.speed + b.phase));
        b.mesh.scale.setScalar(s);
      }
      // Keep the key light glued to the star unless someone parented it here.
      if (light.parent && light.parent !== group) {
        group.getWorldPosition(tmpWorld);
        light.position.copy(tmpWorld);
      }
    },

    /** Release all GPU resources and detach from the scene graph. */
    dispose() {
      group.removeFromParent();
      light.removeFromParent();
      sphere.geometry.dispose();
      surfMat.dispose();
      planeGeo.dispose();
      for (const b of billboards) {
        b.mat.map.dispose();
        b.mat.dispose();
      }
    },
  };
}
