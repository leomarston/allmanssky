// Names, factions, and Luminel lore — the voice of the Aurelia Reach.
// Every generator is a pure function of the RNG passed in: same seed, same words.
// Tone bible (DESIGN.md): luminous, melancholy wonder. The Luminel folded
// themselves into light; everything they left behind is a held breath.

// ---------------------------------------------------------------------------
// syllable banks
// ---------------------------------------------------------------------------

const SYS_ONSET = [
  'Vel', 'Kar', 'Ora', 'Ash', 'Tha', 'Ser', 'Nym', 'Cal', 'Ith', 'Zeph',
  'Mar', 'Sol', 'Ere', 'Lum', 'Vey', 'Quor', 'Hal', 'Ost', 'Bel', 'Dra',
  'Ael', 'Cyn', 'Ryn', 'Ume', 'Ver', 'Oph', 'Tess', 'Ilm', 'Nav', 'Ked',
];
const SYS_MID = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ei', 'ara', 'eve', 'ilo', 'una', 'ori'];
const SYS_END = [
  'ris', 'thos', 'mir', 'dan', 'lith', 'vane', 'sar', 'nis', 'dral', 'pex',
  'shar', 'von', 'tis', 'rem', 'gard', 'lior', 'phon', 'crest', 'uel', 'mor',
  'deen', 'holm', 'na', 'ra', 'wick',
];
const SYS_PREFIX = ['Tau', 'Sigma', 'Delta', 'Rho', 'Kappa', 'Ultima', 'Pale', 'Deep', 'Outer', 'Twin'];
const SYS_SUFFIX = ['Prime', 'Major', 'Minor', 'Reach', 'Verge', 'Drift', 'Deep', 'Gate', 'Choir', 'Wound'];

const GEO_A = [
  'Marrow', 'Cinder', 'Fen', 'Hollow', 'Vale', 'Dun', 'Karst', 'Mor', 'Sable',
  'Bright', 'Rime', 'Thorn', 'Gale', 'Loam', 'Slate', 'Ember', 'Frost', 'Mire',
  'Coral', 'Basalt', 'Amber', 'Salt', 'Iron', 'Dusk', 'Lark', 'Reed', 'Tarn', 'Howl',
];
const GEO_B = [
  'fall', 'reach', 'mere', 'holm', 'crag', 'moor', 'weald', 'strand', 'barrow',
  'deep', 'rise', 'veil', 'watch', 'shear', 'garde', 'row', 'helm', 'coast',
  'spire', 'fold', 'field', 'run', 'shade', 'wake',
];
const PLANET_ONSET = ['Ca', 'Ve', 'Tho', 'Ny', 'Se', 'Ol', 'Ira', 'Mo', 'Du', 'Pha', 'Kel', 'Ba', 'Yri', 'Anda'];
const PLANET_END = [
  'rin', 'lassa', 'dume', 'veth', 'ric', 'sara', 'nia', 'dral', 'myr', 'thea',
  'cor', 'lune', 'vast', 'mara', 'goth', 'phel', 'speria', 'wyn',
];
const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'IX', 'XI'];

const GEN_A = ['Vex', 'Mor', 'Cal', 'Thy', 'Bra', 'Glo', 'Ser', 'Nex', 'Umb', 'Fla', 'Cry', 'Pel', 'Dro', 'Sca', 'Lum', 'Tri'];
const GEN_B = ['ilus', 'odon', 'aptor', 'emys', 'ophis', 'ax', 'urus', 'elle', 'ivora', 'opsis', 'ander', 'ith', 'ornis', 'ella'];
const SPECIES = [
  'errans', 'cryptans', 'luminis', 'pallida', 'viridis', 'tacita', 'ferox',
  'mitis', 'nivalis', 'cinerea', 'vagans', 'echoens', 'dolens', 'aurata',
  'umbrae', 'stellaris',
];

const FIRST_NAMES = [
  'Aster', 'Brann', 'Cole', 'Dessa', 'Eirin', 'Fenn', 'Galen', 'Hollis', 'Imre',
  'Juno', 'Kest', 'Lyra', 'Maren', 'Noor', 'Odile', 'Pax', 'Quill', 'Ryn',
  'Sable', 'Tomas', 'Ursa', 'Vada', 'Wren', 'Yusuf', 'Zephyrine',
];

const SHIP_ADJ = ['Pale', 'Long', 'Last', 'Quiet', 'Gilded', 'Errant', 'Sable', 'Northern', 'Patient', 'Hollow', 'Second', 'Wandering'];
const SHIP_NOUN = ['Meridian', 'Lantern', 'Cormorant', 'Answer', 'Reckoning', 'Furrow', 'Compass', 'Vesper', 'Sparrow', 'Argument', 'Tide', 'Promise', 'Ember', 'Mercy'];

// ---------------------------------------------------------------------------
// factions
// ---------------------------------------------------------------------------

/**
 * The four organized powers of the Aurelia Reach. Colors follow DESIGN.md UI
 * discipline: amber for commerce/warning, cyan for the glass mystics, hot
 * orange for the shipwright clans, red for the raiders.
 */
export const FACTIONS = {
  meridian: {
    name: 'Meridian Combine',
    blurb: 'Industrial trade cartel. Contracts, credits, customs seals — and ledgers that outlive everyone who signs them.',
    colorHex: '#ffb454',
  },
  chorale: {
    name: 'Choir of Glass',
    blurb: 'Mystics who listen at the Luminel Beacons and sing the coordinates back to the dark. They trade in lore, not lumens.',
    colorHex: '#7de8ff',
  },
  sunward: {
    name: 'Sunward Kin',
    blurb: 'Nomad clans and shipwrights. Home is a hull, every hull has a name, and every name is owed a story.',
    colorHex: '#ff8c3a',
  },
  ashen: {
    name: 'The Ashen Fleet',
    blurb: 'Raiders burning the Reach from its edges inward. They say the galaxy is already a pyre — they are only honest about it.',
    colorHex: '#ff5470',
  },
};

const STATION_NOUNS = {
  meridian: ['Exchange', 'Anchorage', 'Freightyard', 'Terminal', 'Concourse', 'Ledger', 'Customs House', 'Bazaar'],
  chorale: ['Reliquary', 'Listening Post', 'Sanctum', 'Archive', 'Choir Loft', 'Vigil', 'Oratory'],
  sunward: ['Drydock', 'Forgeway', 'Slipway', 'Caravanserai', 'Hearthold', 'Mooring', 'Wayfort'],
  ashen: ['Roost', 'Holdfast', 'Scar', 'Emberden', 'Gallows'],
  none: ['Waystation', 'Relay', 'Outpost', 'Beaconhold'],
};

const SURNAMES = {
  meridian: ['Vance', 'Ledger', 'Okoro', 'Marsh', 'Tallow', 'Greaves', 'Sung', 'Ferris'],
  chorale: ['Glasswright', 'Cantor', 'Hymnal', 'Psalter', 'of the Ninth Verse', 'of the Long Echo'],
  sunward: ['Hullborn', 'Windwright', 'of Clan Ember', 'of Clan Vega', 'Kinship-Varo', 'Sunward'],
  ashen: ['the Charred', 'Redwake', 'Cinderjack', 'Grinshaw', 'of the Burnt Line'],
  none: ['Drifter', 'Farhail', 'Solo', 'of No Banner'],
};

const GREETINGS = {
  meridian: [
    'Manifest and credit line, Wayfarer — in that order.',
    'The Combine honors all contracts. Eventually.',
    "Fuel's cheap today. Trust isn't.",
    "Everything here is for sale. Even the view.",
    'Sign nothing you have not read twice.',
  ],
  chorale: [
    'The Choir heard your engines. They sing off-key.',
    'Glass remembers, traveler. So do we.',
    'Have you listened to a Beacon? Truly listened?',
    'The Luminel left the doors open. We only dust the frames.',
    'Hush. The Reach is mid-sentence.',
  ],
  sunward: [
    'Fair winds, hullborn. The Kin keep the forges lit.',
    "Your ship's seen weather. Good. Ships should.",
    'Land, eat, argue about engines — in Kin order.',
    'Every hull has a name, and every name a debt.',
    'Weld first, apologize after.',
  ],
  ashen: [
    'Wrong system, spark. Pay the toll or feed the fire.',
    "The Reach burns from the edges in. We're just early.",
    'Cargo or cinders. Choose.',
    'Run fast, little lantern.',
  ],
  none: [
    "Signal's clean. State your business.",
    'Long roads, Wayfarer. Longer silences.',
    'Not much out here but rock and patience.',
    'You hear it too, don’t you? The pointing star.',
  ],
};

// ---------------------------------------------------------------------------
// name generators
// ---------------------------------------------------------------------------

/**
 * Star-system name — stellar-catalog cadence with occasional prefix/suffix.
 * @param {import('../core/rng.js').RNG} rng
 * @returns {string} e.g. "Velaris", "Tau Kedmir", "Orathos Reach"
 */
export function systemName(rng) {
  let core = rng.pick(SYS_ONSET);
  if (rng.chance(0.55)) core += rng.pick(SYS_MID);
  core += rng.pick(SYS_END);
  const r = rng.next();
  if (r < 0.16) return `${rng.pick(SYS_PREFIX)} ${core}`;
  if (r < 0.36) return `${core} ${rng.pick(SYS_SUFFIX)}`;
  return core;
}

/**
 * Planet name — geographic, weathered, place-like.
 * @param {import('../core/rng.js').RNG} rng
 * @returns {string} e.g. "Rimefall", "Velune", "Cadral III"
 */
export function planetName(rng) {
  let name;
  if (rng.chance(0.5)) {
    const a = rng.pick(GEO_A);
    let b = rng.pick(GEO_B);
    if (a.toLowerCase().endsWith(b.slice(0, 2))) b = GEO_B[(GEO_B.indexOf(b) + 3) % GEO_B.length];
    name = a + b;
  } else {
    name = rng.pick(PLANET_ONSET) + rng.pick(PLANET_END);
  }
  if (rng.chance(0.14)) name += ` ${rng.pick(ROMAN)}`;
  return name;
}

/**
 * Creature binomial — biological, latin-ish.
 * @param {import('../core/rng.js').RNG} rng
 * @returns {string} e.g. "Vexodon luminis"
 */
export function creatureName(rng) {
  return `${rng.pick(GEN_A)}${rng.pick(GEN_B)} ${rng.pick(SPECIES)}`;
}

/**
 * Station name — industrial, faction-flavored.
 * @param {import('../core/rng.js').RNG} rng
 * @param {'meridian'|'chorale'|'sunward'|'ashen'|'none'} faction
 * @returns {string} e.g. "Velaris Anchorage", "Drydock KV-7"
 */
export function stationName(rng, faction = 'none') {
  const noun = rng.pick(STATION_NOUNS[faction] ?? STATION_NOUNS.none);
  if (rng.chance(0.55)) {
    let proper = rng.pick(SYS_ONSET);
    if (rng.chance(0.5)) proper += rng.pick(SYS_MID);
    proper += rng.pick(SYS_END);
    return `${proper} ${noun}`;
  }
  const letters = 'KVRTHXLMNS';
  const tag = `${letters[rng.int(0, letters.length - 1)]}${letters[rng.int(0, letters.length - 1)]}-${rng.int(2, 19)}`;
  return `${noun} ${tag}`;
}

/**
 * NPC name — first name plus a faction-marked surname or epithet.
 * @param {import('../core/rng.js').RNG} rng
 * @param {'meridian'|'chorale'|'sunward'|'ashen'|'none'} faction
 * @returns {string} e.g. "Maren Glasswright"
 */
export function npcName(rng, faction = 'none') {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES[faction] ?? SURNAMES.none)}`;
}

/**
 * Ship name — the kind of name a pilot paints on by hand.
 * @param {import('../core/rng.js').RNG} rng
 * @returns {string} e.g. "The Pale Lantern", "Wren's Reckoning"
 */
export function shipName(rng) {
  const r = rng.next();
  if (r < 0.45) return `The ${rng.pick(SHIP_ADJ)} ${rng.pick(SHIP_NOUN)}`;
  if (r < 0.7) return `${rng.pick(FIRST_NAMES)}'s ${rng.pick(SHIP_NOUN)}`;
  return `${rng.pick(SHIP_NOUN)} of ${rng.pick(GEO_A)}${rng.pick(GEO_B)}`;
}

// ---------------------------------------------------------------------------
// Luminel ruin lore
// ---------------------------------------------------------------------------

const LORE_TITLES = [
  'Beacon Fragment', 'Chorus Stone', 'Fold Record', 'Vigil Inscription',
  'Litany Shard', 'Testament Verse', 'Echo Tablet', 'Cartographer’s Lament',
];
const WE_DID = [
  'charted', 'sang to', 'counted', 'named', 'tended', 'carried', 'loved',
  'feared', 'followed', 'forgave',
];
const THINGS = [
  'ten thousand suns', 'the slow rivers of dust', 'every shore of this world',
  'the engines of morning', 'the gardens between stars', 'the last cold harbors',
  'the folded roads', 'our own reflections in the dark', 'the small rains of this place',
];
const UNTIL = [
  'until the light asked us to follow', 'before the Vesper rose',
  'while the Reach still answered', 'until counting lost its meaning',
  'before we learned what waiting costs', 'until the doors of dawn stood open',
  'while there was still a difference between us and the glow',
];
const REMAINS = [
  'this beacon', 'a doorway of glass', 'only the shape of our joy',
  'a map with one road', 'the hush after the chord', 'what the light could not carry',
  'an unfinished list of names',
];
const CLOSINGS = [
  'Listen, and go deeper', 'Do not grieve for us; we are the shining you steer by',
  'Take what we left and be kinder than we were',
  'The signal is not a summons — it is a welcome', 'We did not vanish; we arrived',
  'Follow, Wayfarer, when you are ready',
  'What you call stars, we called home — briefly, brightly',
];

/** Roman numeral for lore titles (1–99). */
function roman(n) {
  const table = [[90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}

/**
 * A two-sentence Luminel beacon fragment — templated grammar, melancholy tone,
 * thousands of distinct combinations.
 * @param {import('../core/rng.js').RNG} rng
 * @returns {{title: string, text: string}}
 */
export function ruinLore(rng) {
  const title = `${rng.pick(LORE_TITLES)} ${roman(rng.int(2, 89))}`;
  const did = rng.pick(WE_DID), thing = rng.pick(THINGS), until = rng.pick(UNTIL);
  let s1;
  const p1 = rng.next();
  if (p1 < 0.34) s1 = `We ${did} ${thing} ${until}.`;
  else if (p1 < 0.62) s1 = `Here we ${did} ${thing}, and here we set it down.`;
  else if (p1 < 0.84) s1 = `Once, ${thing} knew our voices; we ${did} them ${until}.`;
  else s1 = `This world held us while we ${did} ${thing}.`;

  const remain = rng.pick(REMAINS), close = rng.pick(CLOSINGS);
  let s2;
  const p2 = rng.next();
  if (p2 < 0.34) s2 = `What remains is ${remain}. ${close}.`;
  else if (p2 < 0.62) s2 = `${remain[0].toUpperCase()}${remain.slice(1)} is all we kept. ${close}.`;
  else if (p2 < 0.84) s2 = `We leave you ${remain}. ${close}.`;
  else s2 = `${close} — and when you find ${remain}, you will understand.`;

  return { title, text: `${s1} ${s2}` };
}

/**
 * A short NPC bark line in the speaker's faction voice.
 * @param {import('../core/rng.js').RNG} rng
 * @param {'meridian'|'chorale'|'sunward'|'ashen'|'none'} faction
 * @returns {string}
 */
export function greeting(rng, faction = 'none') {
  return rng.pick(GREETINGS[faction] ?? GREETINGS.none);
}
