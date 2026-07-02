// Quests & the Vesper Signal — STUB pending fan-out #2.
// CONTRACT:
//   new QuestSystem(gameState, galaxy)
//     .init()        — ensure the Vesper Signal quest chain exists; listens to
//                      events (warp:end, resource:mined, discovery:new) to
//                      advance procedural quests.
//     .update(dt)
//   gameState.quests.vesperTarget — systemId the Signal currently points to;
//     shown on galaxy map, preferred by J-warp.
import { events } from '../core/events.js';

export class QuestSystem {
  constructor(gs, galaxy) {
    this.gs = gs;
    this.galaxy = galaxy;
  }

  init() {
    this._retarget();
    events.on('warp:end', () => {
      this.gs.quests.vesperDepth += 1;
      this._retarget();
      if ([3, 7, 12].includes(this.gs.quests.vesperDepth)) {
        events.emit('notify', { text: 'THE VESPER SIGNAL GROWS CLEARER…', tone: 'info' });
      }
    });
  }

  _retarget() {
    // the Signal always points one hop deeper: pick the unvisited neighbor
    // furthest from the galactic origin (deeper into the Reach)
    try {
      const neighbors = this.galaxy.neighborsOf(this.gs.currentSystemId, 3) ?? [];
      const unvisited = neighbors.filter((n) => !this.gs.visitedSystems.includes(n.id));
      const pick = (unvisited.length ? unvisited : neighbors)
        .sort((a, b) => b.pos.length() - a.pos.length())[0];
      this.gs.quests.vesperTarget = pick?.id ?? null;
    } catch { this.gs.quests.vesperTarget = null; }
  }

  update(dt) {}
}
