// Base building — STUB pending fan-out #2.
// CONTRACT (states depend on this):
//   new BaseBuilder(scene, field, gameState, systemId, planetIndex)
//     .update(dt, camera, player)  — B toggles build mode: ghost preview snapped
//       to terrain, LMB places, costs resources, persists to gameState.bases,
//       and rebuilds saved pieces for this planet on construction.
//     .dispose()
// Piece kinds: 'foundation'|'wall'|'roof'|'door'|'window'|'pad'|'storage'|'light'

export class BaseBuilder {
  constructor(scene, field, gs, systemId, planetIndex) {
    this.scene = scene;
    this.field = field;
    this.gs = gs;
    this.systemId = systemId;
    this.planetIndex = planetIndex;
  }
  update(dt, camera, player) {}
  dispose() {}
}
