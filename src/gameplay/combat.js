// Combat systems — STUB pending fan-out #2.
// CONTRACT (states depend on these exact shapes):
//   new GroundCombat(scene, effects, gameState, surfaceState)
//     .update(dt, camera, player)  — wardens patrol/aggro; player bolt caster
//       fires on LMB when gameState.tool.mode==='bolt'
//     .onMined(position)           — mining heat: called to raise warden alert
//     .dispose()
//   new SpaceCombat(scene, effects, gameState, system, shipCtl)
//     .update(dt, camera)          — pirate spawns by system.pirateThreat;
//       player lasers on LMB (handled here, not mining, when targets hostile)
//     .dispose()
// Full implementation lands in fan-out #2. This stub keeps states runnable.

export class GroundCombat {
  constructor(scene, effects, gs, surface) {
    this.scene = scene;
    this.effects = effects;
    this.gs = gs;
  }
  update(dt, camera, player) {}
  onMined(position) {}
  dispose() {}
}

export class SpaceCombat {
  constructor(scene, effects, gs, system, shipCtl) {
    this.scene = scene;
    this.effects = effects;
    this.gs = gs;
    this.system = system;
    this.shipCtl = shipCtl;
  }
  update(dt, camera) {}
  dispose() {}
}
