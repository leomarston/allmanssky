// Station-hangar crowd: a handful of procedural humanoid NPCs that wander the
// deck between waypoints, idle, and turn to face you when you draw near. Each
// carries a generated name, a role, and a spoken line. Zero external assets —
// low-poly figures built from primitives, faction-tinted flight suits, a simple
// two-phase walk cycle. Deterministic from (seed, faction).
// CONTRACT: new NPCCrowd(scene, hangar, seed, faction)
//   .update(dt, playerPos) → animates + returns nothing
//   .talkables → [{ position, radius, npc }]  (npc = { name, role, line, faceToward })
//   .dispose()
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';
import { FACTIONS, npcName, GREETINGS } from '../universe/lore.js';

const ROLES = {
  meridian: ['Broker', 'Freight Agent', 'Assessor', 'Ledger-Keeper', 'Customs Officer'],
  chorale: ['Archivist', 'Cantor', 'Vigil-Keeper', 'Glasswright', 'Listener'],
  sunward: ['Deckhand', 'Hull-Smith', 'Forgewright', 'Quartermaster', 'Kin-Elder'],
  ashen: ['Enforcer', 'Toll-Taker', 'Scavenger', 'Firewatch'],
  none: ['Drifter', 'Wanderer', 'Trader', 'Mechanic'],
};

// short role-flavored asides layered on top of the faction greeting pool
const ASIDES = [
  'Mind the pad — thruster wash will take your hat off.',
  'Long haul in from the Reach. My knees know it.',
  'They say a Beacon woke up two systems over. Rumors.',
  'Cheapest fuel this side of the belt. Do not tell the Combine I said so.',
  'You fly that? Brave. Or broke. Usually both.',
  'Keep your cells charged out there. The dark is patient.',
  'Another wayfarer. The doors never do stay shut.',
  'Careful past the mouth — the field only holds the air, not the cold.',
];

/** Build one low-poly humanoid; returns { group, legs, arms, head }. */
function buildFigure(rng, suitColor) {
  const g = new THREE.Group();
  const skin = new THREE.Color().setHSL(rng.range(0.03, 0.09), rng.range(0.35, 0.6), rng.range(0.42, 0.72));
  const suit = suitColor.clone().lerp(new THREE.Color(0x2a2f37), rng.range(0.25, 0.55));
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, metalness: 0.25, roughness: 0.72 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: suitColor, emissiveIntensity: 1.1,
  });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, metalness: 0.05, roughness: 0.85 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.4, roughness: 0.6 });
  const owned = [suitMat, trimMat, skinMat, bootMat];
  const track = (geo) => { owned.push(geo); return geo; };
  const mk = (geo, mat, parent = g) => {
    const m = new THREE.Mesh(track(geo), mat);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const scale = rng.range(0.92, 1.08);
  // torso
  const torso = mk(new THREE.CapsuleGeometry(0.19, 0.42, 4, 8), suitMat);
  torso.position.y = 1.16;
  torso.scale.z = 0.7;
  // chest trim light
  const chip = mk(new THREE.BoxGeometry(0.12, 0.05, 0.02), trimMat);
  chip.position.set(0, 1.28, 0.15);
  // pelvis
  mk(new THREE.CapsuleGeometry(0.17, 0.16, 4, 8), suitMat).position.y = 0.86;
  // head + collar
  mk(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 10), suitMat).position.y = 1.44;
  const head = mk(new THREE.SphereGeometry(0.15, 12, 10), skinMat);
  head.position.y = 1.63;
  head.scale.set(0.92, 1.05, 0.95);
  // hair/cap cap
  const cap = mk(new THREE.SphereGeometry(0.152, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), suitMat);
  cap.position.y = 1.66;

  // arms (pivoted at shoulder for the swing)
  const arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.26, 1.34, 0);
    g.add(pivot);
    const upper = mk(new THREE.CapsuleGeometry(0.06, 0.44, 4, 6), suitMat, pivot);
    upper.position.y = -0.24;
    const hand = mk(new THREE.SphereGeometry(0.06, 8, 6), skinMat, pivot);
    hand.position.y = -0.5;
    arms.push(pivot);
  }
  // legs (pivoted at hip)
  const legs = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.1, 0.82, 0);
    g.add(pivot);
    const thigh = mk(new THREE.CapsuleGeometry(0.08, 0.5, 4, 6), suitMat, pivot);
    thigh.position.y = -0.3;
    const boot = mk(new THREE.BoxGeometry(0.13, 0.1, 0.26), bootMat, pivot);
    boot.position.set(0, -0.6, 0.04);
    legs.push(pivot);
  }

  g.scale.setScalar(scale);
  g.userData._owned = owned;
  return { group: g, legs, arms, head };
}

export class NPCCrowd {
  constructor(scene, hangar, seed, faction = 'none') {
    this.scene = scene;
    this.hangar = hangar;
    const rng = new RNG(hash32(seed | 0, hashString('crowd'), hashString(faction)));
    const factionColor = new THREE.Color(FACTIONS[faction]?.colorHex ?? '#9ab8c8');
    const greetPool = GREETINGS[faction] ?? GREETINGS.none;
    const rolePool = ROLES[faction] ?? ROLES.none;
    const b = hangar.bounds;

    // walkable waypoints: scatter on the deck, away from the pad and the ship lane
    const wps = [];
    let guard = 0;
    while (wps.length < 10 && guard++ < 200) {
      const x = rng.range(b.minX + 2, b.maxX - 2);
      const z = rng.range(b.minZ + 3, b.maxZ - 5);
      if (hangar.floorY(x, z) !== 0) continue;         // skip pad / walls
      if (Math.abs(x - 2.5) < 2.4) continue;           // keep the ship lane clear
      wps.push(new THREE.Vector3(x, 0, z));
    }
    this.waypoints = wps.length ? wps : [new THREE.Vector3(-3, 0, -18)];

    this.npcs = [];
    this.talkables = [];
    const count = 4 + rng.int(0, 2);
    for (let i = 0; i < count && this.waypoints.length; i++) {
      const fig = buildFigure(rng.fork('fig' + i), factionColor);
      const start = rng.pick(this.waypoints);
      fig.group.position.copy(start);
      fig.group.rotation.y = rng.range(0, Math.PI * 2);
      scene.add(fig.group);
      const line = rng.chance(0.5) ? rng.pick(greetPool) : rng.pick(ASIDES);
      const npc = {
        fig,
        name: npcName(rng.fork('name' + i), faction),
        role: rng.pick(rolePool),
        line,
        target: rng.pick(this.waypoints).clone(),
        speed: rng.range(1.1, 1.8),
        phase: rng.range(0, Math.PI * 2),
        wait: rng.range(0, 3),
        heading: fig.group.rotation.y,
        _facing: false,
      };
      // expose a talk hotspot the state can query
      const t = { position: fig.group.position, radius: 2.6, npc };
      npc.faceToward = (p) => { npc._faceP = p; };
      this.npcs.push(npc);
      this.talkables.push(t);
    }
    this._t = rng.range(0, 100);
  }

  update(dt, playerPos) {
    this._t += dt;
    for (const npc of this.npcs) {
      const g = npc.fig.group;
      const pos = g.position;

      // face the player when close enough to talk; otherwise walk waypoints
      const near = playerPos && pos.distanceTo(playerPos) < 3.0;
      let moving = false;
      if (near) {
        const want = Math.atan2(playerPos.x - pos.x, playerPos.z - pos.z);
        npc.heading = this._turnToward(npc.heading, want, dt * 3.2);
      } else if (npc.wait > 0) {
        npc.wait -= dt;
      } else {
        const dx = npc.target.x - pos.x, dz = npc.target.z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          npc.target = this._pickTarget(npc);
          npc.wait = 0.6 + Math.random() * 2.4;   // brief idle; harmless non-determinism
        } else {
          const want = Math.atan2(dx, dz);
          npc.heading = this._turnToward(npc.heading, want, dt * 2.6);
          const step = npc.speed * dt;
          pos.x += (dx / d) * step;
          pos.z += (dz / d) * step;
          moving = true;
        }
      }
      g.rotation.y = npc.heading;
      g.position.y = 0;

      // walk cycle: swing legs + arms, subtle torso bob
      if (moving) {
        npc.phase += dt * npc.speed * 4.4;
        const s = Math.sin(npc.phase) * 0.6;
        npc.fig.legs[0].rotation.x = s;
        npc.fig.legs[1].rotation.x = -s;
        npc.fig.arms[0].rotation.x = -s * 0.7;
        npc.fig.arms[1].rotation.x = s * 0.7;
        g.position.y = Math.abs(Math.sin(npc.phase)) * 0.03;
      } else {
        // ease limbs back to rest + breathe
        for (const l of npc.fig.legs) l.rotation.x *= (1 - Math.min(1, dt * 6));
        const breathe = Math.sin(this._t * 1.5 + npc.phase) * 0.05;
        npc.fig.arms[0].rotation.x = breathe;
        npc.fig.arms[1].rotation.x = -breathe;
      }
    }
  }

  _pickTarget(npc) {
    // choose a different waypoint than the current position
    let best = npc.target;
    for (let i = 0; i < 4; i++) {
      const c = this.waypoints[(Math.random() * this.waypoints.length) | 0];
      if (c.distanceTo(npc.fig.group.position) > 4) { best = c; break; }
      best = c;
    }
    return best.clone();
  }

  _turnToward(cur, want, maxStep) {
    let d = want - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) <= maxStep) return want;
    return cur + Math.sign(d) * maxStep;
  }

  dispose() {
    for (const npc of this.npcs) {
      const g = npc.fig.group;
      g.removeFromParent();
      for (const o of npc.fig.group.userData._owned ?? []) o.dispose?.();
      g.traverse?.((m) => { m.material?.dispose?.(); m.geometry?.dispose?.(); });
    }
    this.npcs.length = 0;
    this.talkables.length = 0;
  }
}
