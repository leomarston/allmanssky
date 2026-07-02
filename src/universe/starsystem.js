// Star-system generator: one star, 1–6 planets, optional belt / station /
// anomaly, faction ownership and pirate pressure. Deterministic in
// (stub.seed, galaxySeed) — the same stub always yields the same system.
import { RNG, hash32 } from '../core/rng.js';
import { rollPlanetDef } from './biomes.js';
import { systemName, stationName } from './lore.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Stellar classification table (single source of truth — galaxy.js weights
 * star spawns from it, generateSystem derives radius/temperature/luminosity).
 * weight: relative rarity (M common → O rare, exotic ~0.5%);
 * radius in space-scene units; temp in K; lum relative solar.
 */
export const STAR_CLASSES = {
  M: { name: 'Red Dwarf', weight: 41.5, colors: ['#ff8e5a', '#ff9d68', '#ff7b4d'], temp: [2600, 3800], radius: [95, 150], lum: [0.22, 0.42] },
  K: { name: 'Orange Dwarf', weight: 22, colors: ['#ffb46b', '#ffab5e', '#ffc07d'], temp: [3900, 5200], radius: [130, 185], lum: [0.5, 0.8] },
  G: { name: 'Yellow Dwarf', weight: 14, colors: ['#ffe3a3', '#ffd98c', '#fff0bd'], temp: [5300, 6000], radius: [165, 225], lum: [0.9, 1.2] },
  F: { name: 'Yellow-White', weight: 9, colors: ['#fff4d6', '#fff8e6'], temp: [6000, 7300], radius: [205, 265], lum: [1.4, 2.0] },
  A: { name: 'White', weight: 6, colors: ['#eef2ff', '#e2ecff'], temp: [7300, 10000], radius: [240, 330], lum: [2.0, 2.8] },
  B: { name: 'Blue-White', weight: 4.5, colors: ['#c2d6ff', '#b3ccff'], temp: [10000, 25000], radius: [300, 430], lum: [2.8, 4.0] },
  O: { name: 'Blue Giant', weight: 2.5, colors: ['#9fbdff', '#8fb2ff'], temp: [25000, 42000], radius: [380, 560], lum: [4.0, 5.5] },
  exotic: { name: 'Exotic', weight: 0.5, colors: ['#c66bff', '#6bffd4', '#ff6bcb', '#aef2ff'], temp: [1200, 60000], radius: [60, 620], lum: [0.15, 5.0] },
};

/** Weighted faction roll; the Ashen Fleet claims more of the galactic rim. */
function rollFaction(rng, edge01) {
  const weights = [
    ['none', 30],
    ['meridian', 24 * (1.25 - edge01 * 0.7)],
    ['sunward', 15],
    ['chorale', 12],
    ['ashen', 5 + 26 * edge01],
  ];
  let total = 0;
  for (const w of weights) total += w[1];
  let t = rng.next() * total;
  for (const [k, w] of weights) { t -= w; if (t <= 0) return k; }
  return 'none';
}

/** Planet-count roll: most systems hold 3–5 worlds. */
function rollPlanetCount(rng) {
  const weights = [8, 16, 22, 24, 18, 12]; // counts 1..6
  let total = 0;
  for (const w of weights) total += w;
  let t = rng.next() * total;
  for (let i = 0; i < weights.length; i++) { t -= weights[i]; if (t <= 0) return i + 1; }
  return 3;
}

/**
 * Generate a full StarSystem from a StarStub (ARCHITECTURE.md shape).
 * @param {{id?:string, seed:number, name?:string, pos?:{x:number,y:number,z:number},
 *          starClass?:string, starColorHex?:string}} stub
 * @param {number} galaxySeed
 * @returns {object} StarSystem
 */
export function generateSystem(stub, galaxySeed = 0) {
  const seed = hash32(stub.seed >>> 0, galaxySeed | 0, 0x57a7);
  const rng = new RNG(seed);

  const cls = STAR_CLASSES[stub.starClass] ? stub.starClass : 'G';
  const c = STAR_CLASSES[cls];
  const star = {
    class: cls,
    colorHex: stub.starColorHex ?? c.colors[0],
    radius: Math.round(rng.range(c.radius[0], c.radius[1])),
    temperature: Math.round(rng.range(c.temp[0], c.temp[1])),
  };
  const starLum = rng.range(c.lum[0], c.lum[1]);

  // 0 at the galactic core, 1 at the rim (~60 sectors out)
  const edge01 = stub.pos
    ? clamp01(Math.hypot(stub.pos.x ?? 0, stub.pos.z ?? 0) / 60)
    : 0.35;

  const id = stub.id ?? `sys:${seed}`;
  const name = stub.name ?? systemName(rng.fork('name'));
  const faction = rollFaction(rng, edge01);
  const planetCount = rollPlanetCount(rng);

  const ctx = {
    id, seed, name, faction,
    starClass: cls, starTemp: star.temperature, starLum,
    planetCount, edge01,
  };
  const planets = [];
  for (let i = 0; i < planetCount; i++) {
    planets.push(rollPlanetDef(rng.fork(`planet${i}`), ctx, i));
  }

  const belt = rng.chance(0.35)
    ? {
        radius: Math.round(rng.range(1600, 2600)),
        width: Math.round(rng.range(180, 420)),
        density: Math.round(rng.range(0.2, 1) * 100) / 100,
      }
    : null;

  // stations are common in claimed space, rare in Ashen burn zones; unclaimed
  // systems that do host one fly Meridian colors (DESIGN.md: Meridian stations)
  let station = null;
  if (rng.chance(faction === 'ashen' ? 0.25 : 0.45)) {
    const stationFaction = faction === 'none' ? 'meridian' : faction;
    station = {
      name: stationName(rng, stationFaction),
      faction: stationFaction,
      orbitRadius: Math.round(rng.range(400, 900)),
      angle: Math.round(rng.range(0, Math.PI * 2) * 1000) / 1000,
    };
  }

  let anomaly = null;
  if (rng.chance(0.08)) {
    const roll = rng.next();
    anomaly = {
      kind: roll < 0.5 ? 'derelict' : roll < 0.8 ? 'wormhole' : 'blackhole',
      orbitRadius: Math.round(rng.range(1200, 3800)),
      angle: Math.round(rng.range(0, Math.PI * 2) * 1000) / 1000,
    };
  }

  const pirateThreat = Math.round(clamp01(
    rng.range(0.03, 0.22) + edge01 * 0.45 + (faction === 'ashen' ? 0.32 : 0),
  ) * 100) / 100;

  return { id, seed, name, faction, star, planets, belt, station, anomaly, pirateThreat };
}
