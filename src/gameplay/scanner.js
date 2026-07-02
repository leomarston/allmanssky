// Scanner: V-key pulse that catalogues nearby life and landmarks for Lumens.
// CONTRACT: new Scanner(gameState); .scan(surfaceState)
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

const COOLDOWN = 3.5;

export class Scanner {
  constructor(gs) {
    this.gs = gs;
    this._last = -99;
  }

  scan(surface) {
    const now = performance.now() / 1000;
    if (now - this._last < COOLDOWN) return;
    this._last = now;
    audio.sfx('scan');
    events.emit('scanner:pulse');

    setTimeout(() => {
      let found = 0;
      const creature = surface.creatures.scanNearest?.(surface.player.position, 120);
      if (creature) {
        const key = `${surface.def.id}:${creature.name}`;
        if (this.gs.discover('creatures', key, creature.name, 90)) {
          this.gs.stats.creaturesScanned += 1;
          found++;
        }
      }
      // catalog the local flora family once per planet
      const floraKey = `${surface.def.id}:flora`;
      if (surface.def.floraDensity > 0.05 && this.gs.discover('flora', floraKey, `${surface.def.name} flora`, 45)) found++;

      audio.sfx('scanDone');
      if (!found) events.emit('notify', { text: 'SCAN COMPLETE — nothing new catalogued', tone: 'info' });
    }, 900);
  }
}
