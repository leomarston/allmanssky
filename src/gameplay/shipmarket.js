// Sunward Kin ship market — deterministic ship offers, C→S grades, pricing,
// trade-in credit, and the purchase swap. Pure gameplay data: no THREE, no
// DOM, importable from node. The shipyard UI (src/ui/shipyardui.js) renders
// these offers; the integrator decides where a market spawns (station dock
// menu, planet outposts).
//
// gs.ship gains an OPTIONAL `stats` record on purchase (states should read
// gs.ship.stats?.X ?? current defaults):
//   stats = { class, grade:'C'|'B'|'A'|'S', maxSpeedMult, hullMax, shieldMax,
//             cargoBonus (0|4|8), agility, boostMult }
import { RNG, hash32, hashString } from '../core/rng.js';
import { shipName } from '../universe/lore.js';

/**
 * In-fiction flavor for the five hull classes (DESIGN.md: Sunward Kin are the
 * Reach's nomad shipwrights — "every hull has a name, and every name a debt").
 */
export const SHIP_CLASS_INFO = {
  swift: {
    label: 'Swift',
    role: 'Explorer',
    blurb: 'The Kin’s long-road runner. Balanced hull, honest engines, and a nose that always points one warp deeper.',
  },
  talon: {
    label: 'Talon',
    role: 'Fighter',
    blurb: 'Forward-swept and short-tempered. Twin bolt throats under the wing roots; agility bought with cabin space.',
  },
  dray: {
    label: 'Dray',
    role: 'Hauler',
    blurb: 'A working hull with pod rails for days. Slow to turn, impossible to discourage, paid off in three seasons of freight.',
  },
  prospect: {
    label: 'Prospect',
    role: 'Miner',
    blurb: 'Saddle tanks, beam arms, and a dorsal truss that shrugs off grit. The Reach gives; the Prospect carries it home.',
  },
  vanta: {
    label: 'Vanta',
    role: 'Exotic',
    blurb: 'An asymmetric rumor of Luminel geometry. No two fly alike, and every one flies like a held breath let go.',
  },
};

/** Grade ladder, common → rare. */
export const GRADES = ['C', 'B', 'A', 'S'];

// Baseline stats + sticker price (lumens) per class at grade C.
const CLASS_BASE = {
  swift:    { price: 8000,  hullMax: 100, shieldMax: 60,  maxSpeedMult: 1.00, agility: 1.00, boostMult: 1.00, cargoBonus: 0 },
  talon:    { price: 11000, hullMax: 90,  shieldMax: 85,  maxSpeedMult: 1.08, agility: 1.30, boostMult: 1.20, cargoBonus: 0 },
  dray:     { price: 9000,  hullMax: 170, shieldMax: 70,  maxSpeedMult: 0.82, agility: 0.70, boostMult: 0.88, cargoBonus: 8 },
  prospect: { price: 10000, hullMax: 130, shieldMax: 65,  maxSpeedMult: 0.90, agility: 0.82, boostMult: 0.95, cargoBonus: 4 },
  vanta:    { price: 25000, hullMax: 140, shieldMax: 110, maxSpeedMult: 1.22, agility: 1.18, boostMult: 1.35, cargoBonus: 4 },
};

// Hull/shield scale by the full grade multiplier; handling stats (speed,
// agility, boost) by a softened half-step so an S ship feels superior without
// breaking flight tuning.
const GRADE_STAT_MULT = { C: 1.0, B: 1.11, A: 1.22, S: 1.35 };
const GRADE_PRICE_MULT = { C: 1.0, B: 1.55, A: 2.5, S: 4.0 };
const TRADE_IN_RATE = 0.30;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function round2(v) { return Math.round(v * 100) / 100; }
function round5(v) { return Math.round(v / 5) * 5; }

/**
 * Weighted grade roll. Station tier pushes the table toward the high end;
 * S stays rare (~1% at tier 0, ~5.5% at tier 1, ~3% typical).
 * @param {RNG} rng
 * @param {number} t tier 0..1
 * @returns {'C'|'B'|'A'|'S'}
 */
function rollGrade(rng, t) {
  const wS = 0.012 + 0.045 * t;
  const wA = 0.07 + 0.16 * t;
  const wB = 0.24 + 0.14 * t;
  const r = rng.next();
  if (r < wS) return 'S';
  if (r < wS + wA) return 'A';
  if (r < wS + wA + wB) return 'B';
  return 'C';
}

/**
 * Weighted class roll; the exotic Vanta only really shows at high-tier yards.
 * @param {RNG} rng
 * @param {number} t tier 0..1
 * @returns {keyof typeof CLASS_BASE}
 */
function rollClass(rng, t) {
  const weights = [
    ['swift', 0.28], ['talon', 0.22], ['dray', 0.21], ['prospect', 0.21],
    ['vanta', 0.02 + 0.10 * t],
  ];
  let total = 0;
  for (const [, w] of weights) total += w;
  let r = rng.next() * total;
  for (const [cls, w] of weights) { r -= w; if (r <= 0) return cls; }
  return 'swift';
}

/** Resolved stat block for a class at a grade. */
function statsFor(cls, grade) {
  const b = CLASS_BASE[cls];
  const m = GRADE_STAT_MULT[grade] ?? 1;
  const soft = 1 + (m - 1) * 0.5;
  return {
    class: cls,
    grade,
    maxSpeedMult: round2(b.maxSpeedMult * soft),
    hullMax: round5(b.hullMax * m),
    shieldMax: round5(b.shieldMax * m),
    cargoBonus: b.cargoBonus,
    agility: round2(b.agility * soft),
    boostMult: round2(b.boostMult * soft),
  };
}

/**
 * One deterministic ship offer.
 * @param {number} seedInt any 32-bit integer; also the buildShip() visual seed
 * @param {number} [tier01=0.5] station tier 0..1 — raises grade/class odds
 * @returns {{ seed: number, class: string, name: string,
 *   stats: { class: string, grade: 'C'|'B'|'A'|'S', maxSpeedMult: number,
 *     hullMax: number, shieldMax: number, cargoBonus: 0|4|8,
 *     agility: number, boostMult: number },
 *   price: number }} price in lumens (base by class × grade mult ± 15% seeded)
 */
export function generateOffer(seedInt, tier01 = 0.5) {
  const seed = seedInt >>> 0;
  const t = clamp01(tier01);
  const rng = new RNG(hash32(seed, hashString('ship-offer')));
  const cls = rollClass(rng.fork('class'), t);
  const grade = rollGrade(rng.fork('grade'), t);
  const name = shipName(rng.fork('name'));
  const jitter = 1 + rng.fork('price').range(-0.15, 0.15);
  const price = Math.max(500,
    Math.round((CLASS_BASE[cls].price * GRADE_PRICE_MULT[grade] * jitter) / 25) * 25);
  return { seed, class: cls, name, stats: statsFor(cls, grade), price };
}

/**
 * Deterministic offer list for a named location (station id, outpost key...).
 * Same key → same hangar, forever.
 * @param {string} locationKey
 * @param {number} [count=4]
 * @returns {ReturnType<typeof generateOffer>[]}
 */
export function offersFor(locationKey, count = 4) {
  const key = hashString(String(locationKey));
  const tier = new RNG(hash32(key, hashString('shipyard-tier'))).next();
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(generateOffer(hash32(key, hashString('offer'), i), tier));
  }
  return out;
}

/**
 * Resolve a full stat block for any gs.ship record — uses ship.stats when the
 * ship was bought here, else falls back to class baselines (grade C) and the
 * legacy hullMax/shieldMax fields.
 * @param {object} ship gs.ship
 * @returns stat block shaped like offer.stats
 */
export function currentShipStats(ship) {
  const cls = CLASS_BASE[ship?.class] ? ship.class : 'swift';
  const base = CLASS_BASE[cls];
  const s = ship?.stats ?? {};
  return {
    class: cls,
    grade: GRADES.includes(s.grade) ? s.grade : 'C',
    maxSpeedMult: s.maxSpeedMult ?? base.maxSpeedMult,
    hullMax: s.hullMax ?? ship?.hullMax ?? base.hullMax,
    shieldMax: s.shieldMax ?? ship?.shieldMax ?? base.shieldMax,
    cargoBonus: s.cargoBonus ?? base.cargoBonus,
    agility: s.agility ?? base.agility,
    boostMult: s.boostMult ?? base.boostMult,
  };
}

/**
 * Trade-in credit for the ship currently flown: 30% of an equivalent offer's
 * un-jittered price for that class/grade (grade C when unknown).
 * @param {object} ship gs.ship
 * @returns {number} lumens credited toward any purchase
 */
export function tradeInValue(ship) {
  const s = currentShipStats(ship);
  return Math.round(CLASS_BASE[s.class].price * (GRADE_PRICE_MULT[s.grade] ?? 1) * TRADE_IN_RATE);
}

/**
 * Buy `offer`: afford-check against (price − trade-in), deduct lumens, swap
 * gs.ship (fuel fraction and warp cells carry over; hull/shield start full at
 * the new stats; the offer's name comes with the hull), then gs.save().
 * @param {object} gs GameState (needs .ship, .lumens; uses .addLumens/.save when present)
 * @param {ReturnType<typeof generateOffer>} offer
 * @returns {boolean} true if the transfer completed
 */
export function applyShipPurchase(gs, offer) {
  if (!gs?.ship || !offer?.stats) return false;
  const cost = Math.max(0, offer.price - tradeInValue(gs.ship));
  if ((gs.lumens ?? 0) < cost) return false;
  if (typeof gs.addLumens === 'function') gs.addLumens(-cost);
  else gs.lumens = Math.max(0, (gs.lumens ?? 0) - cost);
  gs.ship = {
    class: offer.class,
    seed: offer.seed,
    name: offer.name,
    hullMax: offer.stats.hullMax, hull: offer.stats.hullMax,
    shieldMax: offer.stats.shieldMax, shield: offer.stats.shieldMax,
    fuel: clamp01(gs.ship.fuel ?? 1),
    warpCells: gs.ship.warpCells ?? 0,
    stats: { ...offer.stats },
  };
  gs.save?.();
  return true;
}
