# Volume 6 — Space Flight, Combat & Enemy AI

**Scope note up front:** this volume is explicitly NOT engine-gated. Every gap below is a
gameplay/logic-layer problem — steering math, finite-state machines, spawn budgeting, data
tables — running on top of the WebGL2 + three.js@0.160 renderer we already have. Nothing here
needs a new render path, a new physics engine, or a shader rewrite. The asteroid field already
renders as an `InstancedMesh`; the ship meshes already have engine nacelles and hardpoint-shaped
geometry; the bolt/explosion VFX pool already exists in `EffectsSystem`. What's missing is
*behavior* — AI that reasons about target motion, a director that composes encounters instead of
one hardcoded wave table, and set-piece systems (freighters, wingmen) that never got written. Per
line of code invested, this is the highest experience-per-effort volume in the whole parity
program: a working steering+FSM layer immediately upgrades every enemy in the game, ground and
space, because `GroundCombat` and `SpaceCombat` both hand-roll ad hoc movement today.

## 1. What NMS does

**Flight model.** No Man's Sky ships fly an arcade-newtonian model: momentum persists, thrusters
add acceleration rather than set velocity directly, and there's a soft velocity cap per hull
class. Pulse drive is a discrete gear players toggle in open space for a large speed multiplier
with a wind-up/spool-down and camera FOV/streak feedback; it auto-disengages near mass (planets,
asteroids, stations). Boost is a short, high-drain speed spike layered on top of normal thrust.
Atmospheric entry/exit is a distinct flight regime — the ship visibly buffets, camera shakes, and
control authority tightens as you cross the entry shell, then space's free-roll six-degrees-of-
freedom opens back up once clear.

**Weapons, shields, heat.** The player's ship carries a small loadout of distinct weapons, each
with a different damage profile and drawback: Photon Cannon (default, balanced, no special
mechanic), Phase Beam (continuous beam, bonus damage vs shields, generates heat and can overheat-
lock), Positron Ejector (high alpha-strike burst, slow reload, devastating vs hull), Infra-Knife
Accelerator (hybrid burst-fire, good all-rounder), Cyclotron Ballista (charged shot, huge damage,
purpose-built for cracking freighter/capital hull plating), plus dumb-fire Rocket Launchers for
alpha damage against grounded or shielded targets. Deflector shields absorb damage first and regen
after a no-damage grace window; hull damage below the shield floor is permanent until repaired at
a station.

**Enemy ship AI.** Pirates and Sentinel interceptors run pursuit behavior with predictive
(lead) targeting — they aim where you *will be*, not where you are — layered with evasive
maneuvers: barrel rolls, juke breaks, and disengage-when-critical logic that peels a ship out of
the fight instead of face-tanking. Difficulty scales with player standing/threat and — in
Permadeath/Survival — flatly harder aim and damage multipliers. Enemy squadrons fly in loose
formation with a leader-wingman relationship: wingmen hold offset slots around the leader during
transit and break formation independently once a target is acquired, re-forming after the
engagement.

**Pirate encounters.** Pirates interdict you mid-flight, hail you, and demand you jettison cargo
("Surrender your cargo or you will be fired upon") — refusing (or having nothing worth taking)
triggers combat. Wave size and aggression scale with the value of cargo you're hauling and the
system's conflict/security rating; killing pirates (or being caught fighting near witnesses) can
raise a bounty against you, trackable and payable at terminals. Some pirates are themselves wanted
NPCs you can hunt for bounty reward.

**Sentinel space presence.** Overmining or scanning too aggressively raises a Sentinel alert level
that escalates from Quads/turrets on the ground to space-capable interceptors, then armored
corvettes, culminating (at max heat, or in dedicated Sentinel-hostile systems) in a Sentinel
Dreadnought — a capital-scale, heavily-shielded boss encounter with area-denial weapons. Sentinels
can also scramble your pulse drive and pursue across system boundaries in high-alert states.

**Freighter fleets & space battles.** Capital freighters (yours or NPC-owned) warp into a system
trailing an escort squadron of frigates/fighters. Random events spawn a freighter under pirate
attack; joining the fight on the freighter's side (destroying attackers before the freighter's
hull depletes) grants faction standing and salvage rewards — refusing or losing has consequences.
Fighters can be disabled (shields/engines down) rather than only destroyed, opening non-lethal
capture/boarding-flavored resolutions in some encounter types. Frigates you own can be dispatched
on off-screen expeditions and can escort you in-system.

**Distress calls & random encounters.** SOS beacons, drifting derelicts, ambushes, and "convoy
under attack" events spawn organically while flying, each with its own micro-objective and reward
hook, keeping open space from feeling like a transit corridor between menus.

**Wingmen/squadron.** Players can recruit NPC pilots (at cantinas/frigate crews) and summon them
to fly escort, engage independently, and call out threats.

**Asteroid fields.** Belts are dense, instanced fields of varied-size rocks; most are trivial to
mine for common elements (including Tritium, the pulse-drive fuel resource), but larger, rarer
asteroids carry richer/more valuable payloads and are call out on the scanner. Flying through a
field at speed requires active weaving — rocks are large enough, and dense enough, to demand real
piloting, and both pirates and Sentinels will fight *inside* belts, using rocks as cover.

**Station traffic, conflict level, and on-planet response.** Stations have visible NPC traffic
lanes and landing-pad approach corridors; system maps display a Conflict Level (Low/Medium/High)
that governs pirate frequency and Sentinel aggression independent of the player's own actions.
Sentinel ships also respond in-atmosphere: high ground alert can summon a starship strafing run
even while the player is on foot.

## 2. What we have (cite source)

AllMansSky has real, working pieces of this system — just far narrower in scope than any single
NMS subsystem above.

- **Flight model** — `src/gameplay/shipcontrol.js`, `ShipController`. Mouse/keyboard steering
  drives `angVel` (pitch/yaw/roll) which is exponentially smoothed (`t = 1 - Math.exp(-8*dt)`)
  toward a target rate, then applied as a quaternion multiply each frame. Velocity is **not**
  simulated with mass/thrust/drag — it directly chases a target vector
  (`this.forward * throttle * maxSpeed * boostMult`) via `velocity.lerp(target, vt)` with
  `vt = 1 - Math.exp(-(boost ? 1.6 : 2.6) * dt)`. `BASE_SPEED = 55`, `BOOST_MULT = 3.2`,
  `PITCH_RATE/YAW_RATE/ROLL_RATE = 1.6/1.1/2.2`. There is no atmosphere-vs-space handling inside
  `ShipController` itself — that transition lives entirely in the state-switch between
  `spacestate.js` and `surfacestate.js`, with no in-flight buffet/shake regime for the crossing.
  Camera has `cockpit`/`chase` view modes with FOV kick on boost (`_updateCamera`).
- **Pulse drive** — `src/states/spacestate.js`, `SpaceState._updatePulse()`. Hold-to-charge
  (`_pulseLevel` ramps at `dt*0.7`), auto-drops within 260 units of a planet or 200 of a station
  (`nearMass`), burns `gs.ship.fuel` at `dt*0.004`, and adds `720 * lvl² * dt` along the nose on
  top of the normal flight model. This is functionally close to NMS's pulse gear, minus the
  discrete "engaged" HUD state machine and minus any Sentinel-scramble interaction.
- **Weapons** — one bolt type, everywhere. `GroundCombat` fires `PLAYER_BOLT_SPEED = 90` bolts
  from the Arcforge; `SpaceCombat` fires `SHIP_BOLT_SPEED = 420` nose bolts. No heat, no overheat,
  no weapon selection, no distinct damage-vs-shield-vs-hull profiles. Shields exist only as a flat
  `gs.ship.shield` pool drained before `gs.ship.hull` in `SpaceCombat._damagePlayer()` — no regen
  logic is implemented anywhere in the read files.
- **Enemy AI, ground** — `src/gameplay/combat.js`, `GroundCombat`. This is the most developed AI
  in the codebase: a genuine wanted-level escalation (`this.wanted`, 0-5) with contact/evade
  timers (`EVADE_TIME = 12`, `EVADE_DIST = 160`, terrain-sampled line-of-sight in `_losClear`),
  four unit types (`scout`, `aegis`, `lancer`, `colossus`) tuned via the `UNIT` table, and a real
  per-unit state machine (`patrol → alert → hostile → leaving`) driven from `_updateDrone`. The
  Colossus (`_updateColossus`, `_updateLegs`, `_solveLeg`) is a legged walker with analytic 2-bone
  IK and a genuine gait/stomp system — well beyond "space combat" scope but proof the engine can
  carry a real state machine when one is written.
- **Enemy AI, space** — `src/gameplay/combat.js`, `SpaceCombat`. One faction ("Ashen Fleet"
  pirates, reskinned `talon`-class hulls), one three-state machine per pirate
  (`approach → attack → peel`), hardcoded `cap = 1 + pirateThreat*2` (2-3 ships), a wave timer
  gated only by `system.pirateThreat > 0.12` and "no hostiles currently alive" — not cargo value,
  not conflict level, not player wanted state. Steering is a single `slerp` of the nose toward a
  `want` direction (`_q1.setFromUnitVectors(...)`, `g.quaternion.slerp(_q1, dt*1.6)`) — there is
  no separation/formation force, no obstacle avoidance, no barrel-roll/jink evasion. A **basic
  linear lead solver already exists** on both sides of the fight: pirate fire aims at
  `player.position + player.velocity * dist/PIRATE_BOLT_SPEED` with jitter, and the player's
  auto-aim-assist in `update()` does the same against the nearest pirate within a 10° cone. This
  is a real foundation to build the full quadratic intercept solver on top of — it is not starting
  from zero.
- **Ambient space life** — `src/gameplay/spacelife.js`, `SpaceLife`. Purely cosmetic traffic:
  1-3 `dray`/`swift` ships lerp back and forth along a single straight `{from, to}` lane between
  station and a random planet (`_spawnTraffic`), with a one-time comm-bark bubble when the player
  passes within 90 units. Anomalies (`derelict`, `blackhole`, `wormhole`) are static set-pieces
  with a one-shot salvage/survey payout — not AI, not combat-relevant.
- **Asteroid field** — `src/states/spacestate.js`, `SpaceState._buildBelt()`. This already exists
  and is worth crediting precisely: one ring belt per system (`rng.chance(0.35)` in
  `src/universe/starsystem.js`), 140-360 lumpy-displaced icosahedra in a single `InstancedMesh`,
  uniform size distribution (`s = 2 + rng.next()*rng.next()*9`), three possible resource types per
  rock (`voidsalt`/`silica`/`ferrox`), `hp: 3`. Mining is `src/gameplay/mining.js`,
  `SpaceMining.update()` — nose-aligned beam (`dot > 0.985`), tick-damage every 0.5s,
  `destroyAsteroid()` scales the instance matrix to ~0 (no despawn/respawn, no debris, no chunk
  streaming). There is exactly one belt radius/width per system, no rare/large asteroid tier, no
  weaving requirement (rocks are sparse relative to flight speed), and no AI ever uses the belt as
  cover.
- **Station docking** — `SpaceState._interactions()` / `_enterStation()`: proximity prompt within
  `DOCK_RANGE = 42` of `station.dockPos`, fade-transition into a separate `hangar` state. No
  traffic-control queueing, no no-fire zone enforcement.
- **Ship stats without weapons** — `src/gameplay/shipmarket.js`. Five hull classes
  (`swift`/`talon`/`dray`/`prospect`/`vanta`) × four grades (C/B/A/S) produce
  `{hullMax, shieldMax, maxSpeedMult, agility, boostMult, cargoBonus}` — there is no `weapon` or
  `weaponSlots` field anywhere in `CLASS_BASE` or `statsFor()`.
- **Reputation exists but nothing routes combat rewards through it.** `src/gameplay/quests.js`
  already tracks `gs.quests.reputation.{meridian,chorale,sunward}` and pays it out from mission-
  board bounty contracts (`kind: 'bounty'`). `SpaceCombat._hitPirate()` pays lumens and loot but
  never touches `gs.quests.reputation` — there is no plumbing from "you fought in a space battle"
  to "your standing changed," even though the reputation system it would feed already exists.
- **Not present at all:** weapon variety/heat, shield regen, wingmen, freighter fleets/capital
  ships, boarding/disabling, distress calls, formation flying, barrel-roll/evade AI, conflict-level
  per system (`pirateThreat` is the only proxy and only feeds spawn *count*, not composition or
  tactics), on-planet Sentinel-starship response.

## 3. The gap

| Area | NMS has | We have | Severity | Effort |
|---|---|---|---|---|
| Steering/AI core | Predictive pursuit, evasion, formation flying, per-archetype tactics | One `slerp`-toward-target per pirate; no lead prediction on evasion, no separation, no jink | **Structural** | 1.5 wk |
| Weapon variety | 6 distinct weapons w/ damage profiles, heat, alpha/DPS tradeoffs | 1 bolt type, fixed speed/damage, reused for player+all enemies | **Feature** | 1 wk |
| Shields | Absorb-then-hull, regen after grace window | Flat pool, drains, **no regen implemented** | **Feature** | 0.5 wk |
| Enemy composition | Faction-specific ship classes/roles (interceptor/corvette/dreadnought) | 1 faction, 1 hull (reskinned `talon`) | **Feature** | 1 wk |
| Pirate wave scaling | Scales with cargo value + system conflict + your bounty | Scales only with `pirateThreat`, timer-gated, ignores cargo | **Structural** | 1 wk |
| Demand-cargo-or-fight | Hail → countdown → fight/comply branch | Not present — pirates always just attack | **Feature** | 0.5 wk |
| Bounty system | Player wanted level for piracy/combat, payable | Ground-only wanted level (`GroundCombat.wanted`); no space equivalent | **Feature** | 0.5 wk |
| Sentinel space escalation | Interceptor → corvette → Dreadnought ladder | No Sentinel presence in space at all (Wardens are ground-only) | **Structural** | 1.5 wk |
| Capital dreadnought fight | Multi-phase boss, shield facets, subsystem targeting | Not present | **Structural** | 1.5 wk |
| Freighter fleets | Capital + escort warp-in, joinable battles, standing reward | Not present | **Structural** | 2 wk |
| Boarding/disabling | Non-lethal disable state, capture flavor | Every enemy dies or despawns; no disable state | **Feature** | 0.75 wk |
| Distress calls | SOS beacons, ambushes, convoy events | Not present (only static anomaly set-pieces) | **Feature** | 1 wk |
| Wingmen/squadron | Hire, summon, escort AI, callouts | Not present | **Feature** | 1 wk |
| Asteroid fields | Dense, weaving-required, rare large asteroids, combat cover | Sparse single ring, uniform size, no weaving, no cover use | **Feature** | 1 wk |
| Station traffic/no-fire | Queued traffic, enforced no-fire zone | Cosmetic lane traffic only (`SpaceLife`); no zone rules | **Cosmetic** | 0.5 wk |
| Conflict level per system | Explicit Low/Med/High, drives everything | Only `pirateThreat` scalar, feeds spawn count only | **Feature** | 0.25 wk |
| On-planet Sentinel starship response | Space unit responds to ground alert | `GroundCombat` and `SpaceCombat` are fully disjoint systems | **Structural** | 0.75 wk |
| Atmosphere transition feel | Buffet/shake/control-tighten crossing the entry shell | Instant state-switch, no in-flight transition | **Cosmetic** | 0.25 wk |

Total (sum of estimates, single engineer, sequential): **~16.5 engineer-weeks** — see §6 for phased/
parallelized numbers.

## 4. Target design

### 4.1 Ship AI state machine

Every combat-capable ship (pirate, Sentinel interceptor, wingman, escort) runs the same FSM;
only the tuning table and available transitions differ per archetype. This directly generalizes
the pattern `GroundCombat._updateDrone` already proves out (`patrol → alert → hostile → leaving`)
by adding prediction, evasion, and formation awareness.

```
SPAWN ──▶ PATROL ──(contact/alert)──▶ INVESTIGATE
                                          │
                          (visual acquire, dist < detectRange)
                                          ▼
                                       PURSUE ◀────────────────┐
                                          │                    │
                        (in weapon range, angle < fireCone)    │ (lost lock >
                                          ▼                    │  reacquireTime)
                                     ATTACK_RUN ────────────────┘
                                     │        │
                     (took hit /     │        │ (hp < fleeThreshold)
                      hp < evadeHp)  ▼        ▼
                                   EVADE     FLEE ──▶ WARP_OUT ──▶ DESPAWN
                                     │
                        (evade timer elapsed, still alive)
                                     ▼
                                  ATTACK_RUN (loop)

  Any state ──(hp <= 0)──▶ DEAD
  Formation members: ATTACK_RUN/PURSUE ⇄ REGROUP (return to leader-relative slot
  when leader re-enters PATROL/INVESTIGATE and this unit has no live target)
```

State responsibilities:

| State | Steering behavior | Fire? | Exit condition |
|---|---|---|---|
| `PATROL` | `wander()` around spawn/lane anchor | no | contact event (player within `detectRange` or noise event) |
| `INVESTIGATE` | `seek(lastKnownPos)` | no | reached point w/o contact → `PATROL`; visual acquire → `PURSUE` |
| `PURSUE` | `pursue(target)` (lead-predicted seek) | no | within `fireRange` and `|angleToTarget| < fireCone` → `ATTACK_RUN`; lost target `reacquireTime` → `INVESTIGATE` |
| `ATTACK_RUN` | `pursue(target)` blended with `orbit(target, standoffRadius)` per archetype (interceptors close in, corvettes orbit-strafe like today's `_updateDrone` hostile branch) | yes, per weapon cooldown/heat | took damage this frame (roll `evadeChance`) → `EVADE`; `hp < fleeThreshold*hpMax` → `FLEE` |
| `EVADE` | `evade(threatBoltOrAttacker)` + random jink axis (barrel-roll roll-rate spike) for `evadeDuration` | no | timer elapses, still alive → `ATTACK_RUN` |
| `FLEE` | `seek(warpOutPoint)` at max speed | no (unless cornered) | reached warp point → `WARP_OUT`/despawn |
| `REGROUP` | `arrive(leaderPos + slotOffset)` | no | in formation tolerance → `PATROL`/`PURSUE` (mirrors leader) |
| `DEAD` | — | — | terminal; VFX + loot + `combat:*` event, same pattern as `GroundCombat._killUnit` |

This is a strict superset of what `GroundCombat` already does for Wardens — `EVADE`,
`FLEE`/`WARP_OUT`, and `REGROUP` are the new states; `PATROL`/`INVESTIGATE`/`ATTACK_RUN`/`DEAD`
already exist in spirit as `patrol`/`alert`/`hostile`/(unit removal).

### 4.2 Steering math (Reynolds-style, minimal vector budget)

All primitives return a **desired velocity delta** (steering force), clamped to `maxForce`, added
to the ship's current velocity, then re-clamped to `maxSpeed` — this replaces `SpaceCombat`'s
direct `quaternion.slerp` toward a raw direction with something that composes.

```js
// src/gameplay/shipai.js  (NEW)
function seek(pos, vel, target, maxSpeed, maxForce, out) {
  out.copy(target).sub(pos).normalize().multiplyScalar(maxSpeed).sub(vel);
  return out.clampLength(0, maxForce);
}

function flee(pos, vel, threat, maxSpeed, maxForce, out) {
  out.copy(pos).sub(threat).normalize().multiplyScalar(maxSpeed).sub(vel);
  return out.clampLength(0, maxForce);
}

// Predictive pursuit: iterate 2-3x on time-to-intercept using the target's
// CURRENT velocity (constant-velocity assumption — matches the linear lead
// already used in SpaceCombat._spawnWave firing code, just reused for movement).
function pursue(pos, vel, target, targetVel, maxSpeed, maxForce, out, tmp) {
  const dist = tmp.copy(target).sub(pos).length();
  const t = dist / Math.max(maxSpeed, 1e-3);
  tmp.copy(target).addScaledVector(targetVel, t);       // predicted position
  return seek(pos, vel, tmp, maxSpeed, maxForce, out);
}

function evade(pos, vel, threat, threatVel, maxSpeed, maxForce, out, tmp) {
  const dist = tmp.copy(threat).sub(pos).length();
  const t = dist / Math.max(maxSpeed, 1e-3);
  tmp.copy(threat).addScaledVector(threatVel, t);
  return flee(pos, vel, tmp, maxSpeed, maxForce, out);
}

// Boid separation for formations/asteroid-field weaving — same primitive serves
// "don't collide with your wingman" and "don't fly into a rock."
function separation(pos, neighbors, radius, out) {
  out.set(0, 0, 0);
  for (const n of neighbors) {
    const d = pos.distanceTo(n.pos);
    if (d > 0 && d < radius) out.addScaledVector(tmp.copy(pos).sub(n.pos).normalize(), 1 / d);
  }
  return out;
}

function arrive(pos, vel, target, slowRadius, maxSpeed, maxForce, out, tmp) {
  const toTarget = tmp.copy(target).sub(pos);
  const dist = toTarget.length();
  const speed = dist < slowRadius ? maxSpeed * (dist / slowRadius) : maxSpeed;
  out.copy(toTarget).normalize().multiplyScalar(speed).sub(vel);
  return out.clampLength(0, maxForce);
}
```

Per-frame blend for `ATTACK_RUN` (interceptor archetype closes to knife range; corvette archetype
holds standoff — same weighted-sum pattern `GroundCombat._updateDrone`'s hostile-state orbit math
already uses, generalized):

```js
steer.set(0,0,0);
steer.addScaledVector(pursue(...), weights.pursue);
steer.addScaledVector(orbit(pos, target, standoffRadius, ...), weights.orbit);
steer.addScaledVector(separation(pos, squadmates, sepRadius, ...), weights.separation);
steer.addScaledVector(separation(pos, nearbyAsteroids, asteroidAvoidRadius, ...), weights.avoid);
velocity.add(steer.multiplyScalar(dt)).clampLength(0, maxSpeed);
// orient hull to velocity (or to target while strafing) — same slerp SpaceCombat already does
quaternion.slerp(qFromDir(velocity.length() > 0.1 ? velocity : forward), 1 - Math.exp(-turnRate*dt));
```

### 4.3 Targeting / lead solver

`SpaceCombat` already does *linear* lead (`aim = targetPos + targetVel * dist/boltSpeed`, no
iteration). Upgrade to the closed-form quadratic intercept for constant-velocity targets — exact,
one sqrt, no iteration, and it's what makes `ATTACK_RUN` fire convincingly instead of "aims at
where you were a frame ago plus a fudge factor":

```js
// src/gameplay/targeting.js  (NEW)
// Solve |Pt + Vt*t - Ps| = boltSpeed*t  for smallest positive t.
export function leadTime(shooterPos, targetPos, targetVel, boltSpeed) {
  const rel = _tmp.copy(targetPos).sub(shooterPos);
  const a = targetVel.lengthSq() - boltSpeed * boltSpeed;
  const b = 2 * rel.dot(targetVel);
  const c = rel.lengthSq();
  if (Math.abs(a) < 1e-6) return b !== 0 ? -c / b : null;       // degenerate: same speed
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;                                     // unreachable — no solution
  const sq = Math.sqrt(disc);
  const t1 = (-b + sq) / (2 * a), t2 = (-b - sq) / (2 * a);
  const t = [t1, t2].filter((t) => t > 0).sort((x, y) => x - y)[0];
  return t ?? null;
}

export function leadPoint(shooterPos, targetPos, targetVel, boltSpeed, out) {
  const t = leadTime(shooterPos, targetPos, targetVel, boltSpeed);
  if (t == null) return out.copy(targetPos);                      // fallback: aim direct
  return out.copy(targetPos).addScaledVector(targetVel, t);
}
```

`null` (unreachable intercept — target outrunning the bolt) is the signal an `ATTACK_RUN` unit
uses to fall back to `PURSUE` instead of firing into empty space, which is the exact behavioral
bug a naive linear lead can't self-correct for.

### 4.4 Encounter Director — data model

Replaces `SpaceCombat`'s hardcoded `cap = 1 + pirateThreat*2` / 90-160s timer with a budgeted
composition system keyed by three inputs the game already tracks or can trivially compute:
`cargoValue` (sum of `ITEMS[id].value * qty` in the hold — pirates want plunder), `conflictLevel`
(new field on `starsystem.js`, same shape as the existing `pirateThreat` roll), and
`wantedLevel` (new space-side counterpart to `GroundCombat.wanted`).

```js
// src/gameplay/encounterdirector.js  (NEW)
const UNIT_COST = { scout: 1, interceptor: 2, corvette: 4, dreadnought: 20 };
const FACTION_ROSTER = {
  ashen:    ['scout', 'interceptor', 'corvette'],           // pirates
  sentinel: ['scout', 'interceptor', 'corvette', 'dreadnought'],
};

export class EncounterDirector {
  constructor(system, gs, rng) {
    this.system = system;
    this.gs = gs;
    this.rng = rng;
    this.cooldown = rng.range(60, 120);     // seconds between wave rolls
    this.wantedLevel = 0;                   // space-side wanted, mirrors GroundCombat.wanted
  }

  /** Budget grows with conflict level, cargo temptation, and player heat. */
  budgetFor(faction) {
    const cargo01 = Math.min(1, this.gs.cargoValue() / 4000);
    const conflict01 = this.system.conflictLevel ?? this.system.pirateThreat ?? 0;
    const heat01 = this.wantedLevel / 5;
    const base = faction === 'sentinel' ? heat01 : conflict01 * 0.6 + cargo01 * 0.4;
    return Math.round(2 + base * 10);                        // 2..12 budget points
  }

  /** Greedy-fill composition under budget, biased toward cheap units first,
   *  capital unlocked only once total spend would exceed 70% of budget AND
   *  wantedLevel is maxed (mirrors GroundCombat: colossus only at wanted===5). */
  compose(faction) {
    let budget = this.budgetFor(faction);
    const roster = FACTION_ROSTER[faction];
    const comp = [];
    while (budget > 0) {
      const afford = roster.filter((u) => UNIT_COST[u] <= budget
        && (u !== 'dreadnought' || (faction === 'sentinel' && this.wantedLevel >= 5)));
      if (!afford.length) break;
      const pick = this.rng.pick(afford);
      comp.push(pick);
      budget -= UNIT_COST[pick];
    }
    return comp;
  }

  /** Demand-cargo-or-fight: pirates hail before opening fire when the player
   *  is carrying anything worth taking. */
  shouldDemandCargo() { return this.gs.cargoValue() > 200; }
}
```

`gs.cargoValue()` is a one-line addition to `state.js` (sum inventory `qty * ITEMS[id].value`);
`system.conflictLevel` is a one-line addition to `rollPlanetDef`'s sibling `starsystem.js`
generator, reusing the exact `clamp01(rng.range(...) + edge01*k)` idiom `pirateThreat` already
uses at `src/universe/starsystem.js:125`.

### 4.5 Asteroid field instancing (chunked, LOD-tiered, mineable)

Today's belt is one `InstancedMesh`, one ring, uniform size. Target: a chunked field so density
can scale locally (dense "field" pockets vs sparse open belt), rare large asteroids get their own
tier, and destroyed/depleted rocks free their instance slot for respawn instead of permanently
scaling to zero.

```js
// src/gameplay/asteroidfield.js  (NEW — supersedes SpaceState._buildBelt)
const TIERS = [
  { key: 'small', weight: 0.62, scale: [1.5, 4],  hp: 2, items: ['ferrox', 'silica'] },
  { key: 'med',   weight: 0.30, scale: [4, 9],    hp: 4, items: ['silica', 'voidsalt'] },
  { key: 'large', weight: 0.07, scale: [9, 16],   hp: 8, items: ['voidsalt', 'tritium'] },
  { key: 'rare',  weight: 0.01, scale: [16, 26],  hp: 14, items: ['tritium', 'luminelshard'] },
];
const CHUNK_SIZE = 400;          // world units per chunk cell
const CHUNK_CAP = 90;            // rocks per chunk InstancedMesh

class Chunk {
  constructor(cx, cz, geoByTier, mat) {
    this.key = `${cx},${cz}`;
    this.meshes = new Map();     // tier.key -> InstancedMesh
    this.rocks = [];             // { tier, index, pos, radius, hp, alive, itemId }
    this.freeSlots = new Map();  // tier.key -> [index,...] recycled on respawn
    for (const t of TIERS) {
      const inst = new THREE.InstancedMesh(geoByTier[t.key], mat, CHUNK_CAP);
      inst.count = 0;
      this.meshes.set(t.key, inst);
    }
  }
}

export class AsteroidField {
  constructor(scene, system, rng) {
    this.scene = scene;
    this.chunks = new Map();
    this.active = new Set();     // chunk keys currently added to scene (frustum/dist gated)
    this.rng = rng;
    this.beltR = system.belt.radius;
    this.beltW = system.belt.width;
    this.density = system.belt.density;
  }

  /** Called once per frame with camera/ship position — stream chunks in/out. */
  updateStreaming(shipPos, viewDist = 1400) {
    const cx0 = Math.floor((shipPos.x - viewDist) / CHUNK_SIZE);
    const cx1 = Math.floor((shipPos.x + viewDist) / CHUNK_SIZE);
    const cz0 = Math.floor((shipPos.z - viewDist) / CHUNK_SIZE);
    const cz1 = Math.floor((shipPos.z + viewDist) / CHUNK_SIZE);
    const wanted = new Set();
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        if (!this._onBelt(cx, cz)) continue;
        const key = `${cx},${cz}`;
        wanted.add(key);
        if (!this.chunks.has(key)) this.chunks.set(key, this._buildChunk(cx, cz));
        if (!this.active.has(key)) this._activate(key);
      }
    for (const key of this.active) if (!wanted.has(key)) this._deactivate(key);
  }

  /** Damage a rock; on kill, free its instance slot for a delayed respawn
   *  instead of SpaceState.destroyAsteroid's permanent zero-scale. */
  mine(rock, dmg, onDrop) {
    rock.hp -= dmg;
    if (rock.hp <= 0 && rock.alive) {
      rock.alive = false;
      this._setScale(rock, 0.001);
      onDrop?.(rock.itemId, rock.tier.key);
      rock.respawnAt = performance.now() + 45000;     // 45s field regeneration
    }
  }

  /** Steering hazard query: nearby large rocks feed AI/player separation
   *  force so both weave instead of clipping through instanced geometry. */
  nearbyObstacles(pos, radius, out) {
    out.length = 0;
    for (const key of this.active) {
      for (const rock of this.chunks.get(key).rocks) {
        if (rock.alive && rock.tier.key !== 'small' && pos.distanceTo(rock.pos) < radius) out.push(rock);
      }
    }
    return out;
  }
}
```

`nearbyObstacles()` is the load-bearing addition: it feeds the same `separation()` primitive from
§4.2 into both enemy `ATTACK_RUN` steering (so pirates weave around rocks instead of ignoring
them, and can duck behind a large one to break line-of-sight) and an optional player assist/HUD
proximity warning — one function, two consumers.

### 4.6 Module/file plan

| File | Status | Responsibility |
|---|---|---|
| `src/gameplay/shipai.js` | **NEW** | Steering primitives (§4.2) + generic FSM (§4.1), archetype-agnostic |
| `src/gameplay/targeting.js` | **NEW** | Quadratic lead solver (§4.3), shared by player aim-assist and all enemy fire |
| `src/gameplay/encounterdirector.js` | **NEW** | Wave budgeting/composition (§4.4), demand-cargo hail logic, wanted-level (space) |
| `src/gameplay/asteroidfield.js` | **NEW** | Chunked instancing (§4.5); replaces `SpaceState._buildBelt`/`destroyAsteroid` |
| `src/gameplay/wingmen.js` | **NEW** | Hire roster, summon/dismiss, `shipai.js` FSM in `REGROUP`/escort mode |
| `src/gameplay/freighterbattle.js` | **NEW** | Capital warp-in sequencer, escort spawn via `EncounterDirector`, standing payout |
| `src/gameplay/combat.js` | **MODIFY** | `SpaceCombat` rewritten on `shipai.js`/`targeting.js`; add `WEAPON` table (photon/phase/positron/infra-knife/cyclotron/rocket) with heat; shield regen timer |
| `src/render/shipmesh.js` | **MODIFY** | Turret/hardpoint sockets per hull class; capital-ship hull kit (freighter, Dreadnought) |
| `src/render/effects.js` | **MODIFY** | Continuous beam VFX (phase beam), rocket projectile+trail, heat-vent particles, disable-state sparks |
| `src/universe/starsystem.js` | **MODIFY** | Add `conflictLevel` (mirrors `pirateThreat` derivation) |
| `src/gameplay/state.js` | **MODIFY** | `gs.cargoValue()`, `gs.ship.spaceWanted` (0-5, mirrors `GroundCombat.wanted`) |
| `src/ui/hud.js` | **MODIFY** | Wave telegraph banner (reuse `combat:wanted`-style event), wingman status chips, freighter-battle scoreboard |

## 5. Phases

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | `shipai.js` steering primitives + generic FSM, unit-testable headless | — |
| 1 | `targeting.js` lead solver; wire into existing `SpaceCombat` fire code (drop-in upgrade, no behavior regression) | 0 |
| 2 | Weapon table + heat + shield regen in `combat.js` | — (parallel to 0/1) |
| 3 | `encounterdirector.js`; rewrite `SpaceCombat` pirate spawn/AI onto `shipai.js` FSM; demand-cargo-or-fight; space wanted level | 0, 1 |
| 4 | `asteroidfield.js` chunked rewrite; rare-tier asteroids; `nearbyObstacles()` wired into both AI and player HUD | 0 |
| 5 | Sentinel faction roster (`interceptor`/`corvette`/`dreadnought`) in `EncounterDirector`; Dreadnought boss fight (multi-phase, subsystem targeting) | 3 |
| 6 | `freighterbattle.js` — capital warp-in, escort composition via director, disable-state, standing payout into `gs.quests.reputation` | 3, 5 |
| 7 | `wingmen.js` — hire/summon/escort; distress-call random events; station no-fire zones; on-planet Sentinel-starship callback from `GroundCombat.wanted` | 0, 3 |

## 6. Effort & risk

**Not engine-gated.** Every item below is pure gameplay logic (vector math, FSMs, spawn tables,
event plumbing) layered on renderer primitives that already exist (`InstancedMesh`, `buildShip`,
`EffectsSystem.laserBolt`/`explosion`/`sparks`). No new shaders, no physics engine, no asset
pipeline. This is why it's the highest experience-per-effort volume in the parity program: a
single engineer can land Phases 0-4 (the AI core, weapons, encounter director, asteroid field —
the part players *feel* every single flight) in under a month, entirely inside files that already
exist or that mirror existing file shapes 1:1.

| Workstream | Engineer-weeks | Risk |
|---|---|---|
| Steering + FSM core (Phase 0) | 1.5 | Low — pure math, headless-testable before any integration |
| Lead solver + fire integration (Phase 1) | 0.5 | Low — drop-in replacement for existing linear lead |
| Weapons/heat/shield regen (Phase 2) | 1.0 | Low — data-table driven, isolated to `combat.js` |
| Encounter Director + pirate rewrite (Phase 3) | 2.0 | Medium — touches live `SpaceCombat` spawn/AI path; needs regression pass on existing pirate feel |
| Asteroid field rewrite (Phase 4) | 1.5 | Medium — chunk streaming has edge cases (belt-boundary chunks, respawn while player is mining) |
| Sentinel roster + Dreadnought (Phase 5) | 2.0 | Medium — new capital-boss content (phases, subsystem HP) is design-heavy, not just code |
| Freighter fleets + boarding (Phase 6) | 2.5 | Medium-High — warp-in choreography + standing payout is the most cross-system-touching piece (combat, quests, HUD) |
| Wingmen/squadron (Phase 7a) | 1.0 | Low — reuses `shipai.js` `REGROUP` state, mostly UI (hire/summon) |
| Distress calls + station zones + on-planet callback (Phase 7b) | 1.0 | Low — event-driven, small surface area |
| **Total** | **~13 engineer-weeks** | — |

(§3's per-row sum of 16.5 wk double-counts shared infrastructure like the lead solver and
steering core across multiple gap rows; §6's phase-based total is the real build estimate.)

Biggest risk is **feel regression** in Phase 3 — `SpaceCombat`'s current pirate AI, however thin,
has been tuned (peel distance, fire cone, approach/attack/peel timers) and shipped. Rewriting it
onto `shipai.js` needs an A/B pass (same seed, before/after wave) before it lands, not just a
unit-test green light.

## 7. Acceptance criteria (headless)

All of these must be provable with `node`-runnable tests against deterministic `RNG` seeds — no
browser, no WebGL context required, matching how `RNG`/`hash32` are already pure functions
importable outside three.js.

**7.1 — Pirate wave spawns and the AI leads/evades.**
```js
const rng = new RNG(hash32(12345, 0xa5e17));
const director = new EncounterDirector({ conflictLevel: 0.7, pirateThreat: 0.7 }, mockGs(3000), rng);
const comp = director.compose('ashen');
assert(comp.length >= 2);                      // cargoValue=3000 + conflict=0.7 → nontrivial budget
assert(comp.every((u) => ['scout','interceptor','corvette'].includes(u)));

// Lead: a ShipAI in ATTACK_RUN vs a target moving at constant lateral velocity
// must aim ahead of the target's CURRENT position, not at it.
const shooter = { pos: v3(0,0,0) };
const target = { pos: v3(100,0,0), vel: v3(0,0,40) };
const aim = leadPoint(shooter.pos, target.pos, target.vel, 420, v3());
assert(aim.z > target.pos.z);                    // solver leads into target's travel direction

// Evade: after simulateHit(ai), the FSM must transition and produce a steering
// vector with a lateral (non-forward) component exceeding a jink threshold.
const ai = new ShipAI(archetype.interceptor, rng);
ai.state = 'ATTACK_RUN'; ai.onHit();
assert.equal(ai.state, 'EVADE');
const steer = ai.computeSteering(dt, world);
assert(lateralComponent(steer, ai.forward) > EVADE_JINK_MIN);
```

**7.2 — Mine an asteroid.**
```js
const field = new AsteroidField(mockScene(), { belt: { radius: 2000, width: 300, density: 0.5 } }, rng);
field.updateStreaming(v3(2000, 0, 0));
const rock = field.nearbyObstacles(v3(2000,0,0), 500, [])[0];
const hpBefore = rock.hp;
let dropped = null;
field.mine(rock, rock.hp, (itemId) => { dropped = itemId; });
assert.equal(rock.alive, false);
assert(dropped != null);                         // itemId matches rock.tier.items
assert(rock.respawnAt > performance.now());       // scheduled respawn, not permanent removal
```

**7.3 — A freighter battle resolves and grants standing.**
```js
const battle = new FreighterBattle(mockScene(), mockGs(), { faction: 'meridian', conflictLevel: 0.5 }, rng);
battle.start();                                   // spawns capital + escort via EncounterDirector
const repBefore = battle.gs.quests.reputation.meridian ?? 0;
// headless-simulate: player contributes N kills before the freighter's hp hits 0
for (let i = 0; i < battle.escortCount(); i++) battle.resolveKill('player');
battle.tick(dt, { forceResolve: true });
assert.equal(battle.outcome, 'won');
assert(battle.gs.quests.reputation.meridian > repBefore);   // standing plumbed through, matching §2's finding that it currently isn't
```

These three specs cover the volume's headline claim end-to-end: composition scales with real
inputs (cargo/conflict), the AI provably reasons about target motion instead of aiming at stale
positions, mining is a real stateful loop (not a one-shot visual), and — closing the gap called
out in §2 — combat outcomes finally write into the reputation system that already exists in
`quests.js` but that `SpaceCombat` currently bypasses entirely.
