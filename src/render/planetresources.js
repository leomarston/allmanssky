// PlanetResources — HARVESTABLE mineral / crystal / botanical nodes for the
// SEAMLESS round planet (?state=planet). The gathering layer of the NMS loop:
// aim at a node, hold the mine button, a beam drains it, items flow into the
// inventory, the node depletes and stays gone for the session.
//
// Three archetypes → three InstancedMeshes (three draw calls), all children of
// ONE rebased Group:
//   1. Mineral spire   — tall angular shard, matte MeshStandardMaterial.
//                        Item: ferrox (low) / silica (higher).
//   2. Crystal cluster — 3-4 faceted prisms, EMISSIVE (emissive = item colour at
//                        ~1.5 so it exceeds 1.0 and BLOOMS).
//                        Item: cryostal / voltglass / solanite (rng + altitude).
//   3. Botanical pod   — bulbous gourd, faint emissive for chlorophane.
//                        Item: carbyne / chlorophane.
//
// FLOATING-ORIGIN FRAME (mirrors PlanetScatter / PlanetFauna exactly)
//   PlanetSphere renders camera-relative: its root sits at
//   (planetCenter - playerUniPos) while chunk vertices are ABSOLUTE planet-local
//   positions (dir * heightAt(dir)). We do the same: the InstancedMeshes live in
//   one Group whose position we set to (planetCenter - playerUniPos) every frame,
//   and every instance matrix stores an ABSOLUTE planet-local pose (position =
//   dir * heightAt(dir), local +Y aligned to the radial dir). Instance world pos
//   therefore equals dir*r - playerUniPos — the identical frame the terrain
//   uses — so nodes glue to the visible ground. Matrices are rebuilt only when
//   the player crosses a resource cell.
//
// STREAMING / STABILITY
//   Cells live on a cube-face UV grid (same family as the planet). Placement is
//   deterministic per (seed, face, cellI, cellJ). On a cell crossing we
//   regenerate the neighbourhood; a depleted-key Set persists for the session so
//   harvested nodes never come back. A stable node registry (this.nodes) drives
//   aim-picking and swap-remove-on-harvest.
//
// SwiftShader-safe: plain MeshStandardMaterial, no VTF, no alpha test, no loops
// in onBeforeCompile (only a couple of ALU injections, like PlanetScatter).

import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';
import { itemColor } from '../gameplay/items.js';

// --- tunables ---------------------------------------------------------------
const RING = 60;             // metres — resource ring radius around the player
const CELL_M = 34;           // metres — resource cell size (near cube-face centre)
const AGL_CUTOFF = 95;       // metres — hide all nodes above this AGL
const SLOPE_MIN = 0.60;      // reject spawns where local normal.y < this (too steep)
const MIN_ALT = 1.0;         // metres above sea — keep nodes off the shoreline
const SNOW_MARGIN = 0.90;    // stay below SNOW_MARGIN * snow line
const RES_CAP = 500;         // hard instance cap per archetype (one draw call each)
const PER_CELL = 3;          // candidates per archetype per cell (pre-rejection)
const TAU = Math.PI * 2;

// --- geometry helpers -------------------------------------------------------

/** Lift a geometry so its base sits at y=0 (object up = radial after instancing). */
function baseToFloor(geo) {
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0);
  geo.computeBoundingBox();
  return geo;
}

/** Merge a list of indexed geometries (position + normal) into one. */
function mergeGeos(geos) {
  let vtot = 0, itot = 0;
  for (const g of geos) {
    vtot += g.attributes.position.count;
    itot += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vtot * 3);
  const nor = new Float32Array(vtot * 3);
  const idx = new Uint16Array(itot);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal;
    const base = vo;
    for (let i = 0; i < p.count; i++) {
      pos[vo * 3] = p.getX(i); pos[vo * 3 + 1] = p.getY(i); pos[vo * 3 + 2] = p.getZ(i);
      nor[vo * 3] = n ? n.getX(i) : 0; nor[vo * 3 + 1] = n ? n.getY(i) : 1; nor[vo * 3 + 2] = n ? n.getZ(i) : 0;
      vo++;
    }
    if (g.index) { const gi = g.index; for (let i = 0; i < gi.count; i++) idx[io++] = base + gi.getX(i); }
    else { for (let i = 0; i < p.count; i++) idx[io++] = base + i; }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** A tall angular mineral shard: jittered 5-sided pyramid. Base at y=0. */
function buildSpire(rng) {
  const g = new THREE.ConeGeometry(0.5, 3.0, 5, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) + rng.range(-0.08, 0.08),
      p.getY(i) + rng.range(-0.12, 0.12),
      p.getZ(i) + rng.range(-0.08, 0.08));
  }
  g.computeVertexNormals();
  return baseToFloor(g);
}

/** A faceted crystal cluster: 3-4 hexagonal prisms fanned from a common base. */
function buildCrystal(rng) {
  const shards = [];
  const N = 3 + (rng.next() < 0.5 ? 0 : 1);
  const off = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const h = rng.range(1.1, 1.9);
    const rad = rng.range(0.15, 0.28);
    const g = new THREE.ConeGeometry(rad, h, 6, 1);
    g.translate(0, h / 2, 0);                 // base at y=0, tip at +h
    off.set(rng.range(-0.34, 0.34), 0, rng.range(-0.34, 0.34));
    axis.set(rng.range(-1, 1), 0, rng.range(-1, 1));
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize();
    q.setFromAxisAngle(axis, rng.range(-0.34, 0.34));
    m.compose(off, q, one);
    g.applyMatrix4(m);
    shards.push(g);
  }
  const merged = mergeGeos(shards);
  for (const g of shards) g.dispose();
  return baseToFloor(merged);
}

/** A bulbous botanical pod: a squashed, jittered icosahedron. Base at y=0. */
function buildPod(rng) {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  g.scale(1.15, 0.92, 1.15);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) + rng.range(-0.06, 0.06),
      p.getY(i) + rng.range(-0.05, 0.05),
      p.getZ(i) + rng.range(-0.06, 0.06));
  }
  g.computeVertexNormals();
  return baseToFloor(g);
}

// ---------------------------------------------------------------------------
export class PlanetResources {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./planetsphere.js').PlanetSphere} planet
   * @param {object} [opts]
   * @param {number} [opts.seed]           deterministic placement seed
   * @param {THREE.Vector3} [opts.sunDir]  world-space unit vector toward the sun
   * @param {number} [opts.density=1]      0..1 scales node counts
   */
  constructor(scene, planet, opts = {}) {
    this.scene = scene;
    this.planet = planet;
    this.radius = planet.radius;
    this.seaLevel = planet.seaLevel;
    this.density = Math.max(0, Math.min(1, opts.density ?? 1));
    this.cellUV = CELL_M / this.radius;
    this.seed = (opts.seed ?? 0x5e50c) >>> 0;
    this.time = 0;
    this.sunDir = (opts.sunDir ? opts.sunDir.clone() : new THREE.Vector3(0.55, 0.42, 0.72)).normalize();

    // stable registry + session-persistent depletion set.
    this.nodes = [];
    this._depleted = new Set();

    // last streamed cell (numeric, compared each frame — no per-frame alloc).
    this._cFace = -1; this._cCi = 0x7fffffff; this._cCj = 0x7fffffff;
    this._R = Math.ceil(RING / CELL_M) + 2;   // neighbourhood radius in cells
    this._ring2 = RING * RING;

    // shared uniform — one update site drives the emissive shimmer.
    this.uniforms = { uTime: { value: 0 } };

    // the rebased frame — tracks (planetCenter - playerUniPos) like PlanetSphere.
    this.group = new THREE.Group();
    this.group.name = 'planetResources';
    scene.add(this.group);

    const grng = new RNG(hash32(this.seed, hashString('resources-geo')));
    this.spireGeo = buildSpire(grng.fork('spire'));
    this.crystalGeo = buildCrystal(grng.fork('crystal'));
    this.podGeo = buildPod(grng.fork('pod'));

    const spireH = this.spireGeo.boundingBox.max.y;
    const crystalH = this.crystalGeo.boundingBox.max.y;
    const podH = this.podGeo.boundingBox.max.y;

    this.spireMat = this._makeMat({ key: 'spire', roughness: 0.85, metalness: 0.02, flat: true, emissiveBoost: 0 });
    this.crystalMat = this._makeMat({ key: 'crystal', roughness: 0.32, metalness: 0.12, flat: true, emissiveBoost: 1.5, pulse: true });
    this.podMat = this._makeMat({ key: 'pod', roughness: 0.7, metalness: 0.0, flat: false, emissiveBoost: 0.34 });

    this._spire = this._mkMesh(this.spireGeo, this.spireMat, 'resources:spire');
    this._crystal = this._mkMesh(this.crystalGeo, this.crystalMat, 'resources:crystal');
    this._pod = this._mkMesh(this.podGeo, this.podMat, 'resources:pod');
    this._meshes = [this._spire, this._crystal, this._pod];

    // per-archetype config (meshIndex === kind === array index).
    this._arch = [
      {
        mesh: this._spire, geoH: spireH, prob: 0.55, cap: RES_CAP, hp: 5, minAlt: MIN_ALT,
        syA: 0.72, syB: 1.32, sxzA: 0.6, sxzB: 1.05,
        pickItem: (alt) => (alt < 30 ? 'ferrox' : 'silica'),
      },
      {
        mesh: this._crystal, geoH: crystalH, prob: 0.4, cap: RES_CAP, hp: 4, minAlt: MIN_ALT,
        syA: 0.8, syB: 1.5, sxzA: 0.7, sxzB: 1.15,
        pickItem: (alt, r) => {
          if (alt > 40) return r < 0.6 ? 'cryostal' : 'voltglass';
          if (alt < 16) return r < 0.6 ? 'solanite' : 'voltglass';
          return r < 0.34 ? 'solanite' : (r < 0.7 ? 'voltglass' : 'cryostal');
        },
      },
      {
        mesh: this._pod, geoH: podH, prob: 0.5, cap: RES_CAP, hp: 3, minAlt: MIN_ALT,
        syA: 0.8, syB: 1.4, sxzA: 0.85, sxzB: 1.3,
        pickItem: (alt, r) => (r < 0.7 ? 'carbyne' : 'chlorophane'),
      },
    ];

    // scratch — no per-frame allocation in the hot path.
    this._up = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._t0 = new THREE.Vector3();
    this._b0 = new THREE.Vector3();
    this._T = new THREE.Vector3();
    this._B = new THREE.Vector3();
    this._Y = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._gp = new THREE.Vector3();     // player ground point
    this._cc = new THREE.Vector3();     // cell-centre cull scratch
    this._n = new THREE.Vector3();      // slope sample scratch
    this._rel = new THREE.Vector3();    // pick scratch
    this._an = new THREE.Vector3();     // pick aim-normalise scratch
    this._m4 = new THREE.Matrix4();
    this._c = new THREE.Color();
    this._face = 0; this._u = 0; this._v = 0;
  }

  _mkMesh(geo, mat, name) {
    const m = new THREE.InstancedMesh(geo, mat, RES_CAP);
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;    // streamed around the player; bounds are local
    m.castShadow = false;
    m.receiveShadow = false;
    m.name = name;
    this.group.add(m);
    return m;
  }

  // Emissive material factory. instanceColor (setColorAt) tints the diffuse; an
  // onBeforeCompile injection adds the SAME colour into totalEmissiveRadiance so
  // it exceeds 1.0 and blooms. Branch-light ALU only — SwiftShader-safe.
  _makeMat(opt) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: opt.roughness ?? 0.85,
      metalness: opt.metalness ?? 0.0,
      flatShading: !!opt.flat,
    });
    if (opt.emissiveBoost > 0) {
      const boost = opt.emissiveBoost.toFixed(3);
      const pulse = opt.pulse ? '(0.82 + 0.18 * sin(uTime * 2.2))' : '1.0';
      const uniforms = this.uniforms;
      mat.onBeforeCompile = (sh) => {
        if (opt.pulse) {
          Object.assign(sh.uniforms, uniforms);
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>',
            '#include <common>\nuniform float uTime;');
        }
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', [
          '#include <emissivemap_fragment>',
          `totalEmissiveRadiance += diffuseColor.rgb * (${boost} * ${pulse});`,
        ].join('\n'));
      };
      mat.customProgramCacheKey = () => `ams-planetres-${opt.key}`;
    }
    return mat;
  }

  /** World-space unit sun vector (stored; nodes are lit by the scene sun). */
  setSunDirection(v) { this.sunDir.copy(v).normalize(); }

  // --- cube-face parameterisation (a global, seam-consistent grid) ----------

  _faceUV(x, y, z) {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax >= ay && ax >= az) {
      const inv = 1 / ax; this._face = x < 0 ? 1 : 0; this._u = y * inv; this._v = z * inv;
    } else if (ay >= az) {
      const inv = 1 / ay; this._face = y < 0 ? 3 : 2; this._u = x * inv; this._v = z * inv;
    } else {
      const inv = 1 / az; this._face = z < 0 ? 5 : 4; this._u = x * inv; this._v = y * inv;
    }
  }

  _dirFromFace(face, u, v, out) {
    const a = face >> 1, s = (face & 1) ? -1 : 1;
    if (a === 0) out.set(s, u, v);
    else if (a === 1) out.set(u, s, v);
    else out.set(u, v, s);
    return out.normalize();
  }

  // Deterministic orthonormal tangent pair at a radial dir (into _t0,_b0).
  _tangents(dir) {
    const t0 = this._t0;
    t0.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.9) t0.set(1, 0, 0);
    t0.addScaledVector(dir, -t0.dot(dir)).normalize();
    this._b0.crossVectors(dir, t0).normalize();
  }

  // Local surface normal.y at a unit dir via heightAt central differences.
  _slopeNy(dir, t0, b0) {
    const eps = 1.5 / this.radius, e = 1.5, n = this._n;
    const hL = this.planet.heightAt(n.copy(dir).addScaledVector(t0, -eps));
    const hR = this.planet.heightAt(n.copy(dir).addScaledVector(t0, eps));
    const hD = this.planet.heightAt(n.copy(dir).addScaledVector(b0, -eps));
    const hU = this.planet.heightAt(n.copy(dir).addScaledVector(b0, eps));
    const du = hR - hL, dv = hU - hD, e2 = 2 * e;
    return e2 / Math.sqrt(du * du + e2 * e2 + dv * dv);
  }

  // Compose an ABSOLUTE planet-local instance matrix: local +Y -> radial dir,
  // random yaw about it, (sxz,sy,sxz) scale, position = dir * r.
  _place(mesh, idx, dir, yaw, sxz, sy, r) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this._T.copy(this._t0).multiplyScalar(c).addScaledVector(this._b0, s);
    this._B.crossVectors(this._T, dir);
    this._T.multiplyScalar(sxz);
    this._B.multiplyScalar(sxz);
    this._Y.copy(dir).multiplyScalar(sy);
    this._m4.makeBasis(this._T, this._Y, this._B);
    this._m4.setPosition(dir.x * r, dir.y * r, dir.z * r);
    mesh.setMatrixAt(idx, this._m4);
  }

  // --- streaming ------------------------------------------------------------

  // Rebuild all instance buffers + the node registry for the neighbourhood
  // around (face,ci,cj). Depleted keys are skipped so harvested nodes stay gone.
  _stream(face, ci, cj, groundR) {
    this._gp.copy(this._up).multiplyScalar(groundR);      // player ground point
    const cellUV = this.cellUV, sea = this.seaLevel, R = this._R;
    const cullR = RING + CELL_M * 1.6, cull2 = cullR * cullR;
    const counts = [0, 0, 0];
    this.nodes.length = 0;

    for (let dj = -R; dj <= R; dj++) {
      const cellJ = cj + dj;
      for (let di = -R; di <= R; di++) {
        const cellI = ci + di;
        // cell-centre cull (cheap: reuse the player ground radius as a proxy).
        this._dirFromFace(face, (cellI + 0.5) * cellUV, (cellJ + 0.5) * cellUV, this._cc);
        if (this._cc.multiplyScalar(groundR).distanceToSquared(this._gp) > cull2) continue;
        const rng = new RNG(hash32(this.seed, face, cellI, cellJ));

        for (let a = 0; a < 3; a++) {
          const cfg = this._arch[a];
          for (let i = 0; i < PER_CELL; i++) {
            // fixed rng draw order (stable per cell — reject after all draws).
            const u = (cellI + rng.next()) * cellUV;
            const v = (cellJ + rng.next()) * cellUV;
            const yaw = rng.next() * TAU;
            const sy = rng.range(cfg.syA, cfg.syB);
            const sxz = rng.range(cfg.sxzA, cfg.sxzB);
            const shade = rng.range(0.72, 1.05);
            const pickR = rng.next();
            const gate = rng.next();
            if (gate > this.density * cfg.prob) continue;

            const slot = a * 100 + i;
            const key = face + ':' + cellI + ':' + cellJ + ':' + slot;
            if (this._depleted.has(key)) continue;

            const dir = this._dirFromFace(face, u, v, this._dir);
            const r = this.planet.heightAt(dir);
            const alt = r - sea, lat = Math.abs(dir.y);
            const snow = 155 * (1 - lat * 0.7);
            if (alt < cfg.minAlt || alt > snow * SNOW_MARGIN) continue;
            this._pos.copy(dir).multiplyScalar(r);
            if (this._pos.distanceToSquared(this._gp) > this._ring2) continue;
            this._tangents(dir);
            if (this._slopeNy(dir, this._t0, this._b0) < SLOPE_MIN) continue;
            if (counts[a] >= cfg.cap) continue;

            const itemId = cfg.pickItem(alt, pickR);
            const instIndex = counts[a]++;
            this._place(cfg.mesh, instIndex, dir, yaw, sxz, sy, r);
            this._c.set(itemColor(itemId)).multiplyScalar(shade);
            cfg.mesh.setColorAt(instIndex, this._c);

            this.nodes.push({
              key, kind: a, meshIndex: a, instIndex,
              dir: dir.clone(), r, height: cfg.geoH * sy,
              itemId, hp: cfg.hp, hpMax: cfg.hp,
            });
          }
        }
      }
    }

    for (let a = 0; a < 3; a++) {
      const mesh = this._meshes[a];
      mesh.count = counts[a];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // --- per-frame ------------------------------------------------------------

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} playerUniPos player position (planet-centre frame)
   * @param {THREE.Vector3} [up] radial up (normalised); derived if omitted
   */
  update(dt, playerUniPos, up) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;

    // rebase our frame under the camera exactly like PlanetSphere.root.
    this.group.position.copy(this.planet.planetCenter).sub(playerUniPos);

    if (up) this._up.copy(up).normalize();
    else this._up.copy(playerUniPos).normalize();

    // no nodes from high flight: hide and force a rebuild once we descend.
    const groundR = this.planet.heightAt(this._up);
    const agl = playerUniPos.length() - groundR;
    if (agl > AGL_CUTOFF) {
      if (this._spire.count) this._spire.count = 0;
      if (this._crystal.count) this._crystal.count = 0;
      if (this._pod.count) this._pod.count = 0;
      if (this.nodes.length) this.nodes.length = 0;
      this._cFace = -1;
      return;
    }

    // re-stream only on a cell crossing.
    this._faceUV(this._up.x, this._up.y, this._up.z);
    const ci = Math.floor(this._u / this.cellUV);
    const cj = Math.floor(this._v / this.cellUV);
    if (this._face === this._cFace && ci === this._cCi && cj === this._cCj) return;
    this._cFace = this._face; this._cCi = ci; this._cCj = cj;
    this._stream(this._face, ci, cj, groundR);
  }

  // --- harvest API ----------------------------------------------------------

  /**
   * Best visible node along the aim line, or null.
   * @param {THREE.Vector3} playerUniPos
   * @param {THREE.Vector3} aimDir  world-space aim direction (camera at origin)
   * @param {number} reach          metres
   * @param {number} cosTol         min alignment (dot) to consider a hit
   * @returns {object|null}
   */
  pickAlongAim(playerUniPos, aimDir, reach, cosTol) {
    const rel = this._rel, an = this._an;
    an.copy(aimDir);
    const al = an.length();
    if (al < 1e-6) return null;
    an.multiplyScalar(1 / al);
    const reach2 = reach * reach;
    let best = null, bestAlign = -2, bestDist = Infinity;
    for (let k = 0; k < this.nodes.length; k++) {
      const node = this.nodes[k];
      rel.copy(node.dir).multiplyScalar(node.r).sub(playerUniPos);
      const d2 = rel.x * rel.x + rel.y * rel.y + rel.z * rel.z;
      if (d2 > reach2 || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const align = (rel.x * an.x + rel.y * an.y + rel.z * an.z) / d;
      if (align < cosTol) continue;
      if (align > bestAlign + 1e-6 || (Math.abs(align - bestAlign) <= 1e-6 && d < bestDist)) {
        best = node; bestAlign = align; bestDist = d;
      }
    }
    return best;
  }

  /** Beam endpoint (scene/rebased space) aimed at the node's middle. */
  nodeEndPos(node, playerUniPos, out) {
    out.copy(node.dir).multiplyScalar(node.r + node.height * 0.5).sub(playerUniPos);
    return out;
  }

  /**
   * Drain a node by `qty`. On depletion the instance is swap-removed from its
   * mesh, the node is spliced from the registry, and its key is marked depleted
   * for the session.
   * @returns {{ itemId: string, depleted: boolean }}
   */
  harvest(node, qty = 1) {
    node.hp -= qty;
    if (node.hp > 0) return { itemId: node.itemId, depleted: false };

    this._depleted.add(node.key);
    const mesh = this._meshes[node.meshIndex];
    const last = mesh.count - 1;
    const to = node.instIndex, from = last;
    if (from >= 0 && from !== to) {
      mesh.getMatrixAt(from, this._m4);
      mesh.setMatrixAt(to, this._m4);
      if (mesh.instanceColor) { mesh.getColorAt(from, this._c); mesh.setColorAt(to, this._c); }
      // fix the moved node's instIndex in the registry.
      for (let k = 0; k < this.nodes.length; k++) {
        const n = this.nodes[k];
        if (n !== node && n.meshIndex === node.meshIndex && n.instIndex === from) { n.instIndex = to; break; }
      }
    }
    mesh.count = Math.max(0, last);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const idx = this.nodes.indexOf(node);
    if (idx >= 0) this.nodes.splice(idx, 1);
    return { itemId: node.itemId, depleted: true };
  }

  dispose() {
    this.scene.remove(this.group);
    this._spire.dispose(); this._crystal.dispose(); this._pod.dispose();
    this.spireGeo.dispose(); this.crystalGeo.dispose(); this.podGeo.dispose();
    this.spireMat.dispose(); this.crystalMat.dispose(); this.podMat.dispose();
    this.nodes.length = 0;
  }
}
