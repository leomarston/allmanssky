// Trading economy: each star system has an economy TYPE and TIER that shape
// what it sells cheap (exports) and buys dear (imports). Price gaps between
// neighbouring economies create profitable trade routes.
//
// CONTRACT:
//   priceOf(itemId, system)          → buy price here (economy-adjusted)
//   sellPriceOf(itemId, system)      → what the station pays you here
//   stationStock(system)             → [{ id, qty, price }] seeded per system
//   economyOf(system)                → { type, tier, label, blurb }
//   tradeRoutesFrom(system, galaxy)  → up to 3 profitable { itemId, ... } routes
import { ITEMS } from './items.js';
import { RNG, hashString } from '../core/rng.js';

const SELL_MULT = 0.72;

// Economy definitions: which item categories/ids each type exports (sells
// cheap) and imports (buys dear). Weight sets rarity in the galaxy.
const ECON = {
  subsistence: {
    weight: 5, label: 'Subsistence', flat: 1.1,
    exportCats: [], importCats: [],
    blurb: 'A frontier holdfast trading scraps to stay lit. Everything runs dear here.',
  },
  mining: {
    weight: 4, label: 'Mining', label2: 'Extraction',
    exportCats: ['element', 'precious'], importCats: ['compound', 'consumable'],
    blurb: 'Ore haulers and refinery smoke. Raw metals and crystal are cheap; finished goods are not.',
  },
  agrarian: {
    weight: 4, label: 'Agrarian',
    exportCats: ['consumable'], exportIds: ['carbyne', 'chlorophane', 'oxylite'],
    importCats: ['compound', 'exotic'],
    blurb: 'Hydroponic terraces and bio-vats. Organics and medicine flow out; circuitry flows in.',
  },
  industrial: {
    weight: 3, label: 'Industrial',
    exportCats: ['compound'], importCats: ['element'],
    blurb: 'Fabrication yards that eat raw element and breathe out weave and glass.',
  },
  technological: {
    weight: 2, label: 'Technological',
    exportCats: [], exportIds: ['weavecircuit', 'voidcell', 'aegiscell', 'luminglass'],
    importCats: ['precious'],
    blurb: 'The Choir\'s workshops. Warp cells and logic-lattice are cheapest here; they hunger for precious metals.',
  },
  commercial: {
    weight: 3, label: 'Commercial', flat: 0.92, bigStock: true,
    exportCats: [], importCats: [],
    blurb: 'A crossroads market. Deep shelves, keen prices, and a cut taken from every hand.',
  },
};
const ECON_KEYS = Object.keys(ECON);

/** deterministic economy for a system */
export function economyOf(system) {
  const seed = (system.seed ?? hashString(String(system.id))) >>> 0;
  const rng = new RNG(seed ^ 0xec0);
  // weighted pick
  const total = ECON_KEYS.reduce((s, k) => s + ECON[k].weight, 0);
  let r = rng.range(0, total), type = ECON_KEYS[0];
  for (const k of ECON_KEYS) { r -= ECON[k].weight; if (r <= 0) { type = k; break; } }
  // faction nudges: chorale leans technological, sunward agrarian/mining
  if (system.faction === 'chorale' && rng.chance(0.5)) type = 'technological';
  if (system.faction === 'sunward' && rng.chance(0.4)) type = rng.pick(['agrarian', 'mining']);
  const tier = rng.chance(0.15) ? 3 : rng.chance(0.4) ? 2 : 1;
  const def = ECON[type];
  return { type, tier, label: def.label, blurb: def.blurb };
}

/** classify an item at a system: 'export' (cheap) | 'import' (dear) | 'neutral' */
export function classify(itemId, system) {
  const econ = economyOf(system);
  const def = ECON[econ.type];
  const cat = ITEMS[itemId]?.category;
  if (def.exportIds?.includes(itemId) || def.exportCats.includes(cat)) return 'export';
  if (def.importCats.includes(cat)) return 'import';
  return 'neutral';
}

function jitter(itemId, system) {
  const base = ITEMS[itemId]?.value ?? 10;
  const rng = new RNG(hashString(`${system.id}:${itemId}:price`));
  return base * rng.range(0.85, 1.25);
}

/** buy price here, economy-adjusted */
export function priceOf(itemId, system) {
  const econ = economyOf(system);
  const def = ECON[econ.type];
  const kind = classify(itemId, system);
  let p = jitter(itemId, system);
  const tierAmp = 1 + (econ.tier - 1) * 0.12;
  if (kind === 'export') p *= 0.72 / tierAmp;     // exports are cheap to buy
  else if (kind === 'import') p *= 1.3 * tierAmp; // imports are dear to buy
  if (def.flat) p *= def.flat;
  return Math.max(1, Math.round(p));
}

/** what the station pays you when selling here */
export function sellPriceOf(itemId, system) {
  const econ = economyOf(system);
  const def = ECON[econ.type];
  const kind = classify(itemId, system);
  const tierAmp = 1 + (econ.tier - 1) * 0.12;
  let p = jitter(itemId, system) * SELL_MULT;
  if (kind === 'import') p *= 1.32 * tierAmp;     // they pay well for what they lack
  else if (kind === 'export') p *= 0.82;          // no one buys coal in a coal town
  if (def.flat) p *= (2 - def.flat);              // commercial pays a hair more
  return Math.max(1, Math.round(p));
}

export function stationStock(system) {
  const econ = economyOf(system);
  const def = ECON[econ.type];
  const rng = new RNG(hashString(`${system.id}:stock`));
  const pool = Object.keys(ITEMS).filter((id) => ITEMS[id].category !== 'artifact');
  // exports are plentiful, imports scarce or absent
  const count = (def.bigStock ? 3 : 0) + rng.int(6, 10) + econ.tier;
  const stock = [];
  const seen = new Set();
  let guard = 0;
  while (stock.length < count && guard++ < 60 && pool.length) {
    const id = pool[rng.int(0, pool.length - 1)];
    if (seen.has(id)) continue;
    const kind = classify(id, system);
    if (kind === 'import' && rng.chance(0.7)) continue;   // rarely stock imports
    seen.add(id);
    const baseQty = kind === 'export' ? rng.int(30, 90) : rng.int(5, 40);
    stock.push({ id, qty: baseQty, price: priceOf(id, system), kind });
  }
  return stock;
}

/**
 * Profitable routes from `system`: buy an export here, sell it as an import
 * at a nearby system. Returns up to 3, best margin first.
 */
export function tradeRoutesFrom(system, galaxy) {
  const out = [];
  let neighbors = [];
  try { neighbors = galaxy.neighborsOf(system.id, 3) ?? []; } catch { neighbors = []; }
  const targets = neighbors.slice(0, 8).map((stub) => {
    try { return galaxy.getSystem(stub.id); } catch { return null; }
  }).filter(Boolean);

  const items = Object.keys(ITEMS).filter((id) => ITEMS[id].category !== 'artifact');
  for (const id of items) {
    const buyHere = priceOf(id, system);
    let best = null;
    for (const t of targets) {
      const sellThere = sellPriceOf(id, t);
      const margin = (sellThere - buyHere) / buyHere;
      if (margin > 0.25 && (!best || margin > best.margin)) {
        best = { margin, sellThere, systemName: t.name, systemId: t.id };
      }
    }
    if (best) {
      out.push({
        itemId: id, buyHere, sellThere: best.sellThere,
        systemName: best.systemName, systemId: best.systemId,
        marginPct: Math.round(best.margin * 100),
      });
    }
  }
  out.sort((a, b) => b.marginPct - a.marginPct);
  return out.slice(0, 3);
}
