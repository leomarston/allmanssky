// Item & recipe registry — the economy's single source of truth.
// Colors drive procedural icons, node tinting, and beam colors.

export const ITEMS = {
  // -- elements --
  ferrox:      { name: 'Ferrox',       symbol: 'Fe', category: 'element',  value: 4,   stack: 250, color: '#b8722c', desc: 'Rust-gold structural metal. The Reach is built from it.' },
  carbyne:     { name: 'Carbyne',      symbol: 'Cb', category: 'element',  value: 3,   stack: 250, color: '#5fd068', desc: 'Living carbon lattice harvested from flora.' },
  oxylite:     { name: 'Oxylite',      symbol: 'Ox', category: 'element',  value: 6,   stack: 200, color: '#ff5f5f', desc: 'Breathable crystal. Crush to refill your suit.' },
  silica:      { name: 'Silica',       symbol: 'Si', category: 'element',  value: 4,   stack: 250, color: '#e8dcc0', desc: 'Glassmaker’s dust, common in dry worlds.' },
  pyrene:      { name: 'Pyrene',       symbol: 'Py', category: 'element',  value: 8,   stack: 200, color: '#ffd04a', desc: 'Volatile launch fuel. Handle warm.' },
  voidsalt:    { name: 'Voidsalt',     symbol: 'Vs', category: 'element',  value: 22,  stack: 120, color: '#9d7bff', desc: 'Precipitate of folded space. Warp-reactive.' },
  aurium:      { name: 'Aurium',       symbol: 'Au', category: 'precious', value: 60,  stack: 80,  color: '#ffc94d', desc: 'Luminel currency-metal. Still glows faintly.' },
  cryostal:    { name: 'Cryostal',     symbol: 'Cr', category: 'precious', value: 48,  stack: 80,  color: '#7de8ff', desc: 'Ice that refuses every sun.' },
  solanite:    { name: 'Solanite',     symbol: 'So', category: 'precious', value: 48,  stack: 80,  color: '#ff8c3a', desc: 'Compressed stellar ember from volcanic seams.' },
  chlorophane: { name: 'Chlorophane',  symbol: 'Ch', category: 'precious', value: 44,  stack: 80,  color: '#8cff5f', desc: 'Photosynthetic mineral. It is technically alive.' },
  voltglass:   { name: 'Voltglass',    symbol: 'Vg', category: 'precious', value: 52,  stack: 80,  color: '#5fb4ff', desc: 'Lightning fossilized mid-strike.' },
  nebulite:    { name: 'Nebulite',     symbol: 'Ne', category: 'exotic',   value: 140, stack: 40,  color: '#ff6fd8', desc: 'Condensed nebula. Wardens bleed it.' },
  // -- compounds --
  ferroweave:  { name: 'Ferroweave',   symbol: 'Fw', category: 'compound', value: 30,  stack: 100, color: '#d29a5b', desc: 'Woven metal-carbon composite.' },
  luminglass:  { name: 'Lumin Glass',  symbol: 'Lg', category: 'compound', value: 40,  stack: 100, color: '#fff3b8', desc: 'Glass that stores daylight.' },
  weavecircuit:{ name: 'Weave Circuit',symbol: 'Wc', category: 'compound', value: 90,  stack: 60,  color: '#6fffd8', desc: 'Self-routing logic lattice.' },
  voidcell:    { name: 'Void Cell',    symbol: 'Vc', category: 'compound', value: 160, stack: 20,  color: '#b58cff', desc: 'One charge of folded distance. Warp fuel.' },
  stimgel:     { name: 'Stim Gel',     symbol: 'Sg', category: 'consumable', value: 35, stack: 30, color: '#7dffb4', desc: 'Restores 50 health.' },
  aegiscell:   { name: 'Aegis Cell',   symbol: 'Ac', category: 'consumable', value: 45, stack: 30, color: '#7de8ff', desc: 'Restores shields fully.' },
  // -- artifacts --
  luminelshard:{ name: 'Luminel Shard', symbol: 'Ls', category: 'artifact', value: 320, stack: 10, color: '#ffffff', desc: 'A splinter of someone who became light.' },
};

export const RECIPES = [
  { id: 'ferroweave',   out: 'ferroweave',   qty: 1, ins: [{ id: 'ferrox', qty: 2 }, { id: 'carbyne', qty: 1 }] },
  { id: 'luminglass',   out: 'luminglass',   qty: 1, ins: [{ id: 'silica', qty: 2 }, { id: 'pyrene', qty: 1 }] },
  { id: 'weavecircuit', out: 'weavecircuit', qty: 1, ins: [{ id: 'silica', qty: 1 }, { id: 'voltglass', qty: 1 }] },
  { id: 'weavecircuit2',out: 'weavecircuit', qty: 1, ins: [{ id: 'silica', qty: 1 }, { id: 'aurium', qty: 1 }] },
  { id: 'voidcell',     out: 'voidcell',     qty: 1, ins: [{ id: 'voidsalt', qty: 2 }, { id: 'luminglass', qty: 1 }] },
  { id: 'stimgel',      out: 'stimgel',      qty: 2, ins: [{ id: 'chlorophane', qty: 1 }, { id: 'carbyne', qty: 2 }] },
  { id: 'aegiscell',    out: 'aegiscell',    qty: 1, ins: [{ id: 'voltglass', qty: 1 }, { id: 'ferrox', qty: 2 }] },
  { id: 'fuel',         out: 'pyrene',       qty: 3, ins: [{ id: 'carbyne', qty: 4 }] },
];

/** upgrade tracks purchasable at stations / crafted from blueprints */
export const UPGRADES = {
  shipSpeed:  { name: 'Vector Coils',   max: 3, cost: (l) => [{ id: 'weavecircuit', qty: 2 * l }, { id: 'solanite', qty: 3 * l }], lumens: (l) => 800 * l },
  shipShield: { name: 'Aegis Lattice',  max: 3, cost: (l) => [{ id: 'weavecircuit', qty: 2 * l }, { id: 'voltglass', qty: 4 * l }], lumens: (l) => 700 * l },
  shipCargo:  { name: 'Hold Extender',  max: 3, cost: (l) => [{ id: 'ferroweave', qty: 4 * l }], lumens: (l) => 600 * l },
  toolMine:   { name: 'Focus Crystals', max: 3, cost: (l) => [{ id: 'cryostal', qty: 3 * l }], lumens: (l) => 500 * l },
  toolBolt:   { name: 'Arc Chamber',    max: 3, cost: (l) => [{ id: 'solanite', qty: 3 * l }], lumens: (l) => 500 * l },
  suitEnergy: { name: 'Dawn Battery',   max: 3, cost: (l) => [{ id: 'luminglass', qty: 3 * l }], lumens: (l) => 400 * l },
};

export function itemName(id) { return ITEMS[id]?.name ?? id; }
export function itemColor(id) { return ITEMS[id]?.color ?? '#9adcff'; }
