// The 11 biomes of the Aurelia Reach and the planet-definition roller.
// This file is the single source of truth for PlanetDef shapes (ARCHITECTURE.md).
//
// Palette philosophy: every planet's ten palette colors are built from ONE
// base hue drawn from the biome's range, with per-key hue offsets (dh) or
// deliberate absolute hues (h) for water/accents — never independent random
// RGB — so each world reads as a harmonious, art-directed color script.
import { hash32 } from '../core/rng.js';
import { planetName } from './lore.js';

/** Fixed palette key order (also the roll order — keeps RNG streams stable). */
const PALETTE_KEYS = ['deepWater', 'shallowWater', 'shore', 'low', 'mid', 'high', 'peak', 'cliff', 'accent', 'glow'];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const r2 = (v) => Math.round(v * 100) / 100;
const R = (rng, [a, b]) => rng.range(a, b);

/** HSL → '#rrggbb' (h degrees, s/l 0..1). */
function hslHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp01(s); l = clamp01(l);
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// key recipe: { dh:[..] hue offset from base } OR { h:[..] absolute hue }, plus s/l ranges.
const K = (hueSpec, s, l) => ({ ...hueSpec, s, l });
const dh = (a, b) => ({ dh: [a, b] });
const ah = (a, b) => ({ h: [a, b] });

/**
 * All 11 biome definitions. Contract keys: name, weight, paletteRanges,
 * hazard {heat,cold,toxic,rad} ([min,max] roll ranges), weatherSet,
 * floraDensity [min,max], faunaDensity [min,max], resourceBias, terrain
 * (param roll ranges incl. seaBias). Internal extras: climate (preferred
 * equilibrium temperature gaussian, K), atmo, clouds, crystal, ruinBonus.
 */
export const BIOMES = {
  lush: {
    name: 'Verdant', weight: 8,
    climate: { c: 288, w: 42 },
    paletteRanges: {
      baseHue: [85, 150],
      keys: {
        deepWater: K(ah(205, 222), [0.55, 0.75], [0.16, 0.26]),
        shallowWater: K(ah(188, 205), [0.6, 0.85], [0.34, 0.46]),
        shore: K(ah(42, 58), [0.38, 0.58], [0.58, 0.7]),
        low: K(dh(-6, 6), [0.45, 0.65], [0.3, 0.4]),
        mid: K(dh(-10, 10), [0.42, 0.6], [0.42, 0.52]),
        high: K(dh(8, 20), [0.22, 0.38], [0.52, 0.62]),
        peak: K(dh(0, 15), [0.05, 0.14], [0.82, 0.93]),
        cliff: K(dh(-25, -10), [0.1, 0.22], [0.28, 0.4]),
        accent: K(dh(140, 200), [0.65, 0.9], [0.55, 0.68]),
        glow: K(dh(160, 190), [0.85, 1], [0.6, 0.72]),
      },
    },
    hazard: { heat: [0, 0.1], cold: [0, 0.1], toxic: [0, 0.05], rad: [0, 0.05] },
    weatherSet: ['clear', 'rain', 'thunder'],
    floraDensity: [0.6, 1], faunaDensity: [0.4, 0.9],
    resourceBias: ['chlorophane', 'carbyne', 'oxylite'],
    terrain: { relief: [0.3, 0.55], roughness: [0.3, 0.5], warp: [0.4, 0.7], plateau: [0, 0.3], crater: [0, 0.1], canyon: [0, 0.25], seaBias: [0.15, 0.35] },
    atmo: { density: [0.7, 1], skyHue: [195, 215] },
    clouds: { coverage: [0.35, 0.75], light: [0.78, 0.92] },
    crystal: [0.02, 0.12], ruinBonus: 0.05,
  },

  swamp: {
    name: 'Mire', weight: 6.5,
    climate: { c: 305, w: 50 },
    paletteRanges: {
      baseHue: [68, 110],
      keys: {
        deepWater: K(dh(35, 60), [0.35, 0.55], [0.1, 0.18]),
        shallowWater: K(dh(25, 45), [0.4, 0.6], [0.22, 0.32]),
        shore: K(dh(-35, -20), [0.25, 0.4], [0.3, 0.42]),
        low: K(dh(-8, 8), [0.35, 0.55], [0.24, 0.34]),
        mid: K(dh(-5, 12), [0.35, 0.5], [0.32, 0.42]),
        high: K(dh(5, 18), [0.2, 0.35], [0.42, 0.52]),
        peak: K(dh(0, 12), [0.1, 0.2], [0.6, 0.72]),
        cliff: K(dh(-30, -15), [0.12, 0.22], [0.22, 0.32]),
        accent: K(ah(165, 190), [0.75, 0.95], [0.55, 0.68]),
        glow: K(ah(150, 175), [0.9, 1], [0.62, 0.75]),
      },
    },
    hazard: { heat: [0, 0.2], cold: [0, 0.1], toxic: [0.1, 0.35], rad: [0, 0.05] },
    weatherSet: ['rain', 'thunder', 'clear'],
    floraDensity: [0.5, 0.9], faunaDensity: [0.3, 0.7],
    resourceBias: ['chlorophane', 'carbyne', 'oxylite'],
    terrain: { relief: [0.15, 0.3], roughness: [0.3, 0.5], warp: [0.5, 0.8], plateau: [0, 0.2], crater: [0, 0.05], canyon: [0, 0.1], seaBias: [0.2, 0.4] },
    atmo: { density: [0.7, 1], skyHue: [85, 135] },
    clouds: { coverage: [0.5, 0.9], light: [0.6, 0.78] },
    crystal: [0.02, 0.12], ruinBonus: 0.05,
  },

  desert: {
    name: 'Dune', weight: 11,
    climate: { c: 420, w: 110 },
    paletteRanges: {
      baseHue: [22, 44],
      keys: {
        deepWater: K(ah(185, 200), [0.5, 0.7], [0.24, 0.34]),
        shallowWater: K(ah(172, 188), [0.55, 0.8], [0.4, 0.52]),
        shore: K(dh(8, 18), [0.45, 0.6], [0.66, 0.78]),
        low: K(dh(-2, 8), [0.5, 0.7], [0.5, 0.62]),
        mid: K(dh(-8, 4), [0.5, 0.68], [0.4, 0.5]),
        high: K(dh(-14, -4), [0.45, 0.6], [0.3, 0.4]),
        peak: K(dh(2, 12), [0.25, 0.4], [0.68, 0.8]),
        cliff: K(dh(-18, -8), [0.4, 0.55], [0.22, 0.32]),
        accent: K(ah(168, 190), [0.6, 0.85], [0.5, 0.62]),
        glow: K(ah(35, 50), [0.9, 1], [0.6, 0.7]),
      },
    },
    hazard: { heat: [0.3, 0.6], cold: [0, 0.15], toxic: [0, 0.05], rad: [0, 0.1] },
    weatherSet: ['clear', 'sandstorm'],
    floraDensity: [0.05, 0.25], faunaDensity: [0.1, 0.4],
    resourceBias: ['silica', 'pyrene', 'ferrox'],
    terrain: { relief: [0.35, 0.6], roughness: [0.3, 0.55], warp: [0.5, 0.9], plateau: [0.2, 0.6], crater: [0, 0.2], canyon: [0.2, 0.6], seaBias: [0, 0.06] },
    atmo: { density: [0.3, 0.7], skyHue: [25, 45] },
    clouds: { coverage: [0.05, 0.35], light: [0.7, 0.85] },
    crystal: [0.03, 0.15], ruinBonus: 0.08,
  },

  frozen: {
    name: 'Glacial', weight: 11,
    climate: { c: 150, w: 70 },
    paletteRanges: {
      baseHue: [192, 225],
      keys: {
        deepWater: K(dh(4, 14), [0.6, 0.8], [0.14, 0.22]),
        shallowWater: K(dh(-4, 8), [0.55, 0.8], [0.3, 0.42]),
        shore: K(dh(-8, 4), [0.15, 0.3], [0.72, 0.84]),
        low: K(dh(-6, 6), [0.2, 0.38], [0.6, 0.72]),
        mid: K(dh(-4, 8), [0.18, 0.32], [0.68, 0.8]),
        high: K(dh(-8, 4), [0.1, 0.2], [0.78, 0.88]),
        peak: K(dh(-6, 6), [0.03, 0.1], [0.9, 0.97]),
        cliff: K(dh(6, 18), [0.2, 0.35], [0.32, 0.45]),
        accent: K(ah(275, 320), [0.5, 0.8], [0.6, 0.75]),
        glow: K(ah(160, 185), [0.8, 1], [0.65, 0.8]),
      },
    },
    hazard: { heat: [0, 0], cold: [0.45, 0.85], toxic: [0, 0.05], rad: [0, 0.1] },
    weatherSet: ['snow', 'clear', 'thunder'],
    floraDensity: [0.02, 0.15], faunaDensity: [0.05, 0.3],
    resourceBias: ['cryostal', 'oxylite', 'ferrox'],
    terrain: { relief: [0.4, 0.75], roughness: [0.45, 0.7], warp: [0.3, 0.6], plateau: [0, 0.25], crater: [0.1, 0.3], canyon: [0.1, 0.35], seaBias: [0, 0.2] },
    atmo: { density: [0.3, 0.7], skyHue: [200, 225] },
    clouds: { coverage: [0.2, 0.55], light: [0.8, 0.92] },
    crystal: [0.15, 0.4], ruinBonus: 0.08,
  },

  volcanic: {
    name: 'Ember', weight: 9,
    climate: { c: 620, w: 180 },
    paletteRanges: {
      baseHue: [4, 26],
      keys: {
        deepWater: K(dh(-4, 6), [0.9, 1], [0.22, 0.32]),      // magma deeps
        shallowWater: K(dh(6, 16), [0.95, 1], [0.48, 0.58]),  // molten shoreline
        shore: K(dh(-6, 4), [0.15, 0.3], [0.16, 0.24]),       // charcoal
        low: K(dh(-6, 8), [0.12, 0.25], [0.1, 0.18]),         // basalt flats
        mid: K(dh(-4, 10), [0.25, 0.45], [0.18, 0.28]),
        high: K(dh(-2, 8), [0.08, 0.18], [0.34, 0.46]),       // ash slopes
        peak: K(dh(0, 10), [0.05, 0.12], [0.5, 0.62]),
        cliff: K(dh(-8, 4), [0.15, 0.3], [0.07, 0.14]),
        accent: K(dh(8, 20), [0.95, 1], [0.55, 0.65]),        // ember seams
        glow: K(dh(14, 30), [1, 1], [0.58, 0.68]),
      },
    },
    hazard: { heat: [0.65, 1], cold: [0, 0], toxic: [0, 0.2], rad: [0, 0.1] },
    weatherSet: ['ashfall', 'clear', 'thunder'],
    floraDensity: [0, 0.08], faunaDensity: [0, 0.15],
    resourceBias: ['solanite', 'pyrene', 'ferrox'],
    terrain: { relief: [0.65, 0.95], roughness: [0.55, 0.85], warp: [0.4, 0.7], plateau: [0, 0.2], crater: [0.2, 0.5], canyon: [0.4, 0.8], seaBias: [0, 0.15] },
    atmo: { density: [0.4, 0.8], skyHue: [8, 26] },
    clouds: { coverage: [0.25, 0.6], light: [0.3, 0.45] },
    crystal: [0.1, 0.3], ruinBonus: 0,
  },

  toxic: {
    name: 'Blight', weight: 7.5,
    climate: { c: 400, w: 160 },
    paletteRanges: {
      baseHue: [72, 105],
      keys: {
        deepWater: K(dh(-18, -6), [0.7, 0.9], [0.18, 0.26]),
        shallowWater: K(dh(-10, 2), [0.8, 0.95], [0.36, 0.48]),
        shore: K(dh(-25, -12), [0.4, 0.55], [0.42, 0.54]),
        low: K(dh(-8, 6), [0.4, 0.6], [0.28, 0.38]),
        mid: K(dh(-4, 10), [0.45, 0.6], [0.36, 0.46]),
        high: K(dh(4, 16), [0.3, 0.45], [0.46, 0.56]),
        peak: K(dh(0, 12), [0.15, 0.3], [0.62, 0.74]),
        cliff: K(dh(-30, -16), [0.25, 0.4], [0.22, 0.32]),
        accent: K(ah(270, 300), [0.6, 0.85], [0.55, 0.68]),
        glow: K(dh(-6, 8), [0.9, 1], [0.6, 0.72]),
      },
    },
    hazard: { heat: [0, 0.25], cold: [0, 0.1], toxic: [0.55, 0.95], rad: [0, 0.15] },
    weatherSet: ['toxicrain', 'clear', 'thunder'],
    floraDensity: [0.2, 0.5], faunaDensity: [0.1, 0.35],
    resourceBias: ['carbyne', 'pyrene', 'aurium'],
    terrain: { relief: [0.3, 0.6], roughness: [0.4, 0.7], warp: [0.5, 0.8], plateau: [0.1, 0.4], crater: [0.1, 0.3], canyon: [0.1, 0.4], seaBias: [0.05, 0.3] },
    atmo: { density: [0.7, 1], skyHue: [70, 100] },
    clouds: { coverage: [0.5, 0.95], light: [0.55, 0.7] },
    crystal: [0.05, 0.2], ruinBonus: 0.05,
  },

  irradiated: {
    name: 'Scourfield', weight: 6.5,
    climate: { c: 380, w: 260 },
    paletteRanges: {
      baseHue: [18, 42],
      keys: {
        deepWater: K(ah(95, 130), [0.5, 0.75], [0.2, 0.3]),
        shallowWater: K(ah(85, 115), [0.6, 0.85], [0.35, 0.47]),
        shore: K(dh(-6, 8), [0.25, 0.4], [0.44, 0.56]),
        low: K(dh(-6, 8), [0.3, 0.5], [0.3, 0.4]),
        mid: K(dh(-10, 6), [0.35, 0.5], [0.38, 0.48]),
        high: K(dh(-14, -2), [0.25, 0.4], [0.46, 0.58]),
        peak: K(dh(0, 12), [0.12, 0.25], [0.6, 0.72]),
        cliff: K(dh(-16, -6), [0.3, 0.45], [0.2, 0.3]),
        accent: K(ah(140, 170), [0.8, 1], [0.55, 0.68]),
        glow: K(ah(130, 160), [0.9, 1], [0.6, 0.72]),
      },
    },
    hazard: { heat: [0.05, 0.3], cold: [0, 0.15], toxic: [0, 0.2], rad: [0.55, 0.95] },
    weatherSet: ['clear', 'thunder', 'sandstorm'],
    floraDensity: [0.03, 0.2], faunaDensity: [0.05, 0.25],
    resourceBias: ['voidsalt', 'aurium', 'ferrox'],
    terrain: { relief: [0.35, 0.6], roughness: [0.5, 0.8], warp: [0.3, 0.6], plateau: [0.2, 0.5], crater: [0.3, 0.6], canyon: [0.2, 0.5], seaBias: [0, 0.12] },
    atmo: { density: [0.2, 0.5], skyHue: [45, 70] },
    clouds: { coverage: [0.1, 0.4], light: [0.55, 0.72] },
    crystal: [0.1, 0.35], ruinBonus: 0.12,
  },

  ocean: {
    name: 'Pelagic', weight: 7.5,
    climate: { c: 290, w: 55 },
    paletteRanges: {
      baseHue: [188, 230],
      keys: {
        deepWater: K(dh(4, 16), [0.65, 0.85], [0.14, 0.22]),
        shallowWater: K(dh(-8, 4), [0.6, 0.85], [0.34, 0.48]),
        shore: K(ah(44, 58), [0.35, 0.5], [0.66, 0.78]),
        low: K(ah(150, 175), [0.4, 0.6], [0.34, 0.44]),
        mid: K(dh(-20, -5), [0.35, 0.55], [0.42, 0.52]),
        high: K(dh(-10, 5), [0.2, 0.35], [0.56, 0.68]),
        peak: K(dh(-5, 8), [0.05, 0.15], [0.84, 0.94]),
        cliff: K(dh(8, 20), [0.25, 0.4], [0.28, 0.4]),
        accent: K(ah(8, 28), [0.7, 0.95], [0.58, 0.7]),
        glow: K(ah(165, 185), [0.85, 1], [0.62, 0.75]),
      },
    },
    hazard: { heat: [0, 0.1], cold: [0, 0.2], toxic: [0, 0.05], rad: [0, 0.05] },
    weatherSet: ['rain', 'clear', 'thunder'],
    floraDensity: [0.3, 0.6], faunaDensity: [0.3, 0.7],
    resourceBias: ['chlorophane', 'oxylite', 'silica'],
    terrain: { relief: [0.1, 0.3], roughness: [0.2, 0.4], warp: [0.4, 0.7], plateau: [0, 0.15], crater: [0, 0.05], canyon: [0, 0.15], seaBias: [0.32, 0.45] },
    atmo: { density: [0.7, 1], skyHue: [195, 220] },
    clouds: { coverage: [0.4, 0.85], light: [0.8, 0.93] },
    crystal: [0.02, 0.1], ruinBonus: 0.03,
  },

  crystal: {
    name: 'Prism', weight: 5,
    climate: { c: 190, w: 120 },
    paletteRanges: {
      baseHue: [170, 330],
      keys: {
        deepWater: K(dh(-30, -15), [0.6, 0.85], [0.18, 0.28]),
        shallowWater: K(dh(-20, -5), [0.7, 0.9], [0.38, 0.5]),
        shore: K(dh(-10, 5), [0.3, 0.5], [0.55, 0.68]),
        low: K(dh(-8, 8), [0.35, 0.55], [0.3, 0.42]),
        mid: K(dh(-5, 10), [0.45, 0.65], [0.42, 0.54]),
        high: K(dh(0, 15), [0.5, 0.7], [0.55, 0.65]),
        peak: K(dh(5, 20), [0.35, 0.55], [0.72, 0.84]),
        cliff: K(dh(-20, -8), [0.4, 0.6], [0.22, 0.32]),
        accent: K(dh(150, 210), [0.75, 0.95], [0.55, 0.7]),
        glow: K(dh(-10, 15), [0.95, 1], [0.65, 0.78]),
      },
    },
    hazard: { heat: [0, 0.1], cold: [0.1, 0.4], toxic: [0, 0.05], rad: [0.05, 0.3] },
    weatherSet: ['clear', 'thunder'],
    floraDensity: [0.1, 0.35], faunaDensity: [0.05, 0.3],
    resourceBias: ['voltglass', 'cryostal', 'silica'],
    terrain: { relief: [0.45, 0.7], roughness: [0.5, 0.8], warp: [0.2, 0.5], plateau: [0.2, 0.5], crater: [0, 0.2], canyon: [0.2, 0.5], seaBias: [0, 0.1] },
    atmo: { density: [0.1, 0.4], skyHue: [230, 280] },
    clouds: { coverage: [0, 0.25], light: [0.75, 0.9] },
    crystal: [0.6, 1], ruinBonus: 0.1,
  },

  barren: {
    name: 'Husk', weight: 14,
    climate: { c: 330, w: 300 },
    paletteRanges: {
      baseHue: [18, 45],
      keys: {
        deepWater: K(ah(200, 220), [0.15, 0.3], [0.14, 0.2]),
        shallowWater: K(ah(190, 210), [0.2, 0.35], [0.26, 0.36]),
        shore: K(dh(-5, 8), [0.08, 0.18], [0.4, 0.5]),
        low: K(dh(-6, 8), [0.06, 0.16], [0.3, 0.4]),
        mid: K(dh(-8, 6), [0.08, 0.18], [0.38, 0.48]),
        high: K(dh(-10, 4), [0.05, 0.14], [0.48, 0.58]),
        peak: K(dh(0, 10), [0.03, 0.1], [0.62, 0.74]),
        cliff: K(dh(-12, 0), [0.08, 0.18], [0.2, 0.3]),
        accent: K(dh(-20, 10), [0.3, 0.5], [0.42, 0.55]),
        glow: K(ah(195, 225), [0.5, 0.8], [0.6, 0.72]),
      },
    },
    hazard: { heat: [0, 0.2], cold: [0.15, 0.5], toxic: [0, 0], rad: [0.05, 0.35] },
    weatherSet: ['clear'],
    floraDensity: [0, 0.05], faunaDensity: [0, 0.08],
    resourceBias: ['ferrox', 'silica', 'aurium'],
    terrain: { relief: [0.3, 0.55], roughness: [0.4, 0.6], warp: [0.2, 0.4], plateau: [0.1, 0.3], crater: [0.5, 0.9], canyon: [0, 0.2], seaBias: [0, 0] },
    atmo: { density: [0, 0.15], skyHue: [220, 240] },
    clouds: { coverage: [0, 0.08], light: [0.6, 0.75] },
    crystal: [0.02, 0.12], ruinBonus: 0.12,
  },

  exotic: {
    name: 'Anomalous', weight: 3,
    climate: { c: 300, w: 5000 },
    paletteRanges: {
      baseHue: [0, 360],
      keys: {
        deepWater: K(dh(80, 140), [0.7, 0.95], [0.16, 0.28]),
        shallowWater: K(dh(70, 120), [0.8, 1], [0.4, 0.55]),
        shore: K(dh(30, 60), [0.5, 0.8], [0.6, 0.75]),
        low: K(dh(-10, 10), [0.6, 0.9], [0.3, 0.45]),
        mid: K(dh(10, 40), [0.55, 0.85], [0.42, 0.56]),
        high: K(dh(-40, -15), [0.4, 0.7], [0.55, 0.68]),
        peak: K(dh(-20, 20), [0.15, 0.5], [0.78, 0.92]),
        cliff: K(dh(150, 200), [0.35, 0.6], [0.2, 0.34]),
        accent: K(dh(90, 150), [0.85, 1], [0.55, 0.7]),
        glow: K(dh(170, 190), [0.95, 1], [0.62, 0.78]),
      },
    },
    hazard: { heat: [0, 0.5], cold: [0, 0.5], toxic: [0, 0.4], rad: [0, 0.6] },
    weatherSet: ['clear', 'thunder', 'ashfall', 'snow'],
    floraDensity: [0.1, 0.8], faunaDensity: [0.05, 0.6],
    resourceBias: ['nebulite', 'voidsalt', 'aurium'],
    terrain: { relief: [0.1, 0.9], roughness: [0.2, 0.9], warp: [0.3, 0.95], plateau: [0, 0.7], crater: [0, 0.5], canyon: [0, 0.7], seaBias: [0, 0.45] },
    atmo: { density: [0, 1], skyHue: [0, 360] },
    clouds: { coverage: [0, 0.9], light: [0.5, 0.9] },
    crystal: [0.2, 0.7], ruinBonus: 0.15,
  },
};

const COMMON_RESOURCES = ['ferrox', 'silica', 'carbyne', 'oxylite', 'pyrene'];

/** In-place Fisher–Yates shuffle driven by the given RNG. */
function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Roll a 10-key harmonious palette from a biome's recipes. Returns {palette, baseHue}. */
function rollPalette(rng, biome) {
  const pr = biome.paletteRanges;
  const baseHue = rng.range(pr.baseHue[0], pr.baseHue[1]);
  const palette = {};
  for (const key of PALETTE_KEYS) {
    const spec = pr.keys[key];
    const hue = spec.h ? rng.range(spec.h[0], spec.h[1]) : baseHue + rng.range(spec.dh[0], spec.dh[1]);
    palette[key] = hslHex(hue, rng.range(spec.s[0], spec.s[1]), rng.range(spec.l[0], spec.l[1]));
  }
  return { palette, baseHue };
}

/** Weighted biome pick given equilibrium temperature (K) — outer planets freeze, inner ones burn. */
function pickBiome(rng, tempK) {
  let total = 0;
  const weights = [];
  for (const key of Object.keys(BIOMES)) {
    const b = BIOMES[key];
    const d = tempK - b.climate.c;
    const affinity = Math.exp(-(d * d) / (2 * b.climate.w * b.climate.w)) + 0.015;
    const w = b.weight * affinity;
    weights.push([key, w]);
    total += w;
  }
  let t = rng.next() * total;
  for (const [key, w] of weights) { t -= w; if (t <= 0) return key; }
  return 'barren';
}

/**
 * Roll one complete PlanetDef (ARCHITECTURE.md shape — the exact contract every
 * renderer/gameplay system consumes). Deterministic in (rng, systemCtx, index).
 *
 * @param {import('../core/rng.js').RNG} rng dedicated planet RNG (fork per planet)
 * @param {{id?:string, seed?:number, name?:string, faction?:string,
 *          starClass?:string, starTemp?:number, starLum?:number,
 *          planetCount?:number, edge01?:number}} systemCtx
 * @param {number} index orbital slot (0 = innermost)
 * @returns {object} PlanetDef
 */
export function rollPlanetDef(rng, systemCtx = {}, index = 0) {
  const ctx = {
    id: 'sys', seed: 0, faction: 'none', starClass: 'G',
    starLum: 1, planetCount: 3, edge01: 0.35, ...systemCtx,
  };

  // -- orbit & equilibrium temperature (coherent with star class + distance) --
  const dAU = 0.34 * Math.pow(1.52, index) * rng.range(0.86, 1.16);
  const orbitRadius = Math.round(dAU * 900);
  const tempK = 278 * Math.pow(Math.max(ctx.starLum, 0.05), 0.25) / Math.sqrt(dAU) + rng.range(-25, 25);

  const biomeKey = pickBiome(rng, tempK);
  const b = BIOMES[biomeKey];

  const name = planetName(rng);
  const radius = Math.round(rng.range(40, 90));
  // gravity tracks planet size (mass proxy) with a little scatter
  const gravity = r2(Math.min(1.8, Math.max(0.4, 0.35 + ((radius - 40) / 50) * 1.15 + rng.gaussian(0, 0.12))));

  const dayLength = Math.round(rng.range(300, 1200));
  const axialTilt = r2(Math.min(0.85, Math.abs(rng.gaussian(0.18, 0.16))));
  const orbitPhase = r2(rng.next());
  const orbitSpeed = r2(rng.range(0.6, 1.4) * 0.05 / Math.pow(index + 1, 1.2) * 100) / 100;

  const seaRoll = R(rng, b.terrain.seaBias);
  const seaLevel = seaRoll < 0.03 ? 0 : r2(Math.min(0.45, seaRoll));

  const { palette, baseHue } = rollPalette(rng, b);

  // -- atmosphere (hue keyed to the biome's sky, lightness keyed to density) --
  const skyH = R(rng, b.atmo.skyHue);
  const density = r2(R(rng, b.atmo.density));
  const dl = 0.35 + 0.65 * density;
  const atmosphere = {
    density,
    colorHex: hslHex(skyH, rng.range(0.5, 0.8), rng.range(0.5, 0.62)),
    skyColorHex: hslHex(skyH, rng.range(0.45, 0.7), rng.range(0.5, 0.68) * dl),
    fogColorHex: hslHex(skyH + rng.range(-6, 6), rng.range(0.25, 0.45), rng.range(0.6, 0.78) * (0.5 + 0.5 * dl)),
  };

  let clouds = null;
  const coverage = R(rng, b.clouds.coverage);
  if (coverage >= 0.07 && density >= 0.15) {
    clouds = {
      coverage: r2(coverage),
      colorHex: hslHex(skyH + rng.range(-8, 8), rng.range(0.15, 0.4), R(rng, b.clouds.light)),
    };
  }

  // -- rings: rarer close in, common for outer giants --
  let rings = null;
  if (rng.chance(0.07 + index * 0.075 + (radius > 75 ? 0.05 : 0))) {
    const innerR = r2(radius * rng.range(1.35, 1.75));
    rings = {
      innerR,
      outerR: r2(innerR + radius * rng.range(0.4, 1.1)),
      colorHex: hslHex(baseHue + rng.range(-18, 12), rng.range(0.12, 0.35), rng.range(0.55, 0.75)),
      opacity: r2(rng.range(0.35, 0.75)),
    };
  }

  // -- hazards: biome baseline sharpened by real temperature --
  const hazard = {};
  for (const k of ['heat', 'cold', 'toxic', 'rad']) hazard[k] = R(rng, b.hazard[k]);
  hazard.heat = r2(clamp01(hazard.heat + Math.max(0, (tempK - 340) / 650)));
  hazard.cold = r2(clamp01(hazard.cold + Math.max(0, (215 - tempK) / 260)));
  hazard.toxic = r2(clamp01(hazard.toxic));
  hazard.rad = r2(clamp01(hazard.rad));

  const weather = rng.chance(0.4) ? b.weatherSet[0] : rng.pick(b.weatherSet);

  // -- resources: 3–5, biome bias first, commons fill --
  const biased = shuffle(rng, [...b.resourceBias]);
  const commons = shuffle(rng, [...COMMON_RESOURCES]);
  const resourceCount = rng.int(3, 5);
  const nBias = rng.int(2, 3);
  const resources = [];
  for (const id of [...biased.slice(0, nBias), ...commons]) {
    if (!resources.includes(id)) resources.push(id);
    if (resources.length >= resourceCount) break;
  }

  const floraDensity = r2(R(rng, b.floraDensity));
  const faunaDensity = r2(R(rng, b.faunaDensity));
  const crystalDensity = r2(R(rng, b.crystal));

  const hasRuins = rng.chance(0.3 + (b.ruinBonus ?? 0));
  const hasOutpost = rng.chance(ctx.faction !== 'none' ? 0.3 : 0.12);

  const t = b.terrain;
  const terrain = {
    relief: r2(R(rng, t.relief)),
    roughness: r2(R(rng, t.roughness)),
    warp: r2(R(rng, t.warp)),
    plateau: r2(R(rng, t.plateau)),
    crater: r2(R(rng, t.crater)),
    canyon: r2(R(rng, t.canyon)),
  };

  return {
    id: `${ctx.id}:p${index}`,
    seed: hash32(ctx.seed, index, 0x9e37),
    name,
    biome: biomeKey,
    radius,
    orbitRadius,
    orbitPhase,
    orbitSpeed,
    axialTilt,
    dayLength,
    gravity,
    seaLevel,
    atmosphere,
    clouds,
    rings,
    hazard,
    weather,
    palette,
    resources,
    floraDensity,
    faunaDensity,
    crystalDensity,
    hasRuins,
    hasOutpost,
    terrain,
  };
}
