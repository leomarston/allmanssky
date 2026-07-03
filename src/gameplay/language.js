// Luminel language: knowledge stones and monoliths teach words one at a time.
// Ruin/beacon lore is rendered through gloss(), so texts start mostly alien and
// grow readable as your vocabulary fills — the Choir of Glass's whole purpose.
import { events } from '../core/events.js';
import { RNG, hashString } from '../core/rng.js';
import { audio } from '../audio/audio.js';

// ~96 words. Phonology: soft open syllables (sel, vae, orim, thal, iske, lune,
// ael, sor, mir, oth) — built to feel like one language, not random noise.
export const LEXICON = [
  ['vaelor', 'light'], ['selathi', 'wayfarer'], ['orim', 'warning'], ['thalasse', 'ocean'],
  ['iskevar', 'warp'], ['lune', 'moon'], ['aelis', 'star'], ['sorae', 'sun'],
  ['mireth', 'memory'], ['othan', 'silence'], ['veth', 'and'], ['sel', 'the'],
  ['naru', 'water'], ['korr', 'stone'], ['ael', 'sky'], ['thren', 'deep'],
  ['isa', 'we'], ['ysha', 'you'], ['oma', 'they'], ['vael', 'to see'],
  ['seru', 'to hear'], ['thala', 'to hold'], ['orin', 'to leave'], ['mirae', 'to remember'],
  ['sova', 'to sing'], ['neth', 'to fold'], ['kael', 'to fall'], ['luth', 'to rise'],
  ['essa', 'home'], ['varn', 'ship'], ['delu', 'gift'], ['morre', 'death'],
  ['illa', 'life'], ['sael', 'child'], ['thovar', 'ancestor'], ['runel', 'machine'],
  ['veyra', 'guardian'], ['ossa', 'bone'], ['lira', 'song'], ['noth', 'no'],
  ['aya', 'yes'], ['veru', 'true'], ['fael', 'false'], ['ilun', 'first'],
  ['othun', 'last'], ['saren', 'many'], ['enu', 'one'], ['duva', 'two'],
  ['thae', 'here'], ['vora', 'there'], ['nael', 'now'], ['pella', 'then'],
  ['orra', 'sound'], ['vissa', 'colour'], ['thurn', 'cold'], ['sella', 'warm'],
  ['darae', 'dark'], ['brith', 'bright'], ['maren', 'traveller'], ['vaeth', 'path'],
  ['sunei', 'dream'], ['korran', 'mountain'], ['thalun', 'river'], ['aelor', 'wind'],
  ['esse', 'breath'], ['nira', 'hand'], ['solae', 'eye'], ['othen', 'voice'],
  ['reth', 'without'], ['vael-ai', 'witness'], ['iskun', 'distance'], ['omael', 'gathering'],
  ['seluth', 'promise'], ['thovae', 'grief'], ['mirath', 'name'], ['lunareth', 'eternity'],
  ['sorenth', 'daylight'], ['vethun', 'together'], ['naerin', 'stranger'], ['korrae', 'ground'],
  ['illun', 'living'], ['morren', 'dead'], ['delae', 'given'], ['orenn', 'gone'],
  ['vaelun', 'seen'], ['serun', 'heard'], ['thelun', 'held'], ['saeth', 'seeker'],
  ['ombra', 'shadow'], ['luael', 'dawn'], ['vespa', 'evening'], ['korien', 'threshold'],
  ['aemir', 'echo'], ['sovar', 'chorus'], ['thelae', 'still'], ['runeth', 'awake'],
];

const KNOWN_SET = new Set(LEXICON.map(([, en]) => en.toLowerCase()));
// stopwords never glossed (keeps sentences legible even at 0 vocabulary)
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'is', 'it', 'and', 'you', 'that', 'for', 'was', 'are', 'has', 'not', 'but', 'its', 'now', 'one']);

export class Language {
  constructor(gs) {
    this.gs = gs;
    gs.language ??= { known: [] };
  }

  /** learn one new word (seeded by how many you already know); null if all learned */
  learnRandom() {
    const known = new Set(this.gs.language.known);
    const pool = LEXICON.filter(([lum]) => !known.has(lum));
    if (!pool.length) {
      events.emit('notify', { text: 'YOU HAVE LEARNED ALL THE LUMINEL LEFT TO TEACH', tone: 'info' });
      return null;
    }
    const rng = new RNG(hashString(`${this.gs.galaxySeed}:lex:${this.gs.language.known.length}`));
    const [lum, en] = rng.pick(pool);
    this.gs.language.known.push(lum);
    events.emit('notify', { text: `LUMINEL WORD LEARNED — '${lum.toUpperCase()}' means "${en}"`, tone: 'good' });
    audio.sfx('discovery');
    return { luminel: lum, english: en };
  }

  knows(luminel) { return this.gs.language.known.includes(luminel); }
  fraction() { return this.gs.language.known.length / LEXICON.length; }
  count() { return this.gs.language.known.length; }

  /**
   * Render an English lore string as mixed Luminel/English. Words whose English
   * you've learned show in English; others show as Luminel wrapped in a
   * .lum-unknown span. Deterministic per input text + current vocabulary.
   */
  gloss(text) {
    const knownEnglish = new Set(this.gs.language.known
      .map((lum) => LEXICON.find(([l]) => l === lum)?.[1]?.toLowerCase())
      .filter(Boolean));
    // map english→luminel for substitution
    const en2lum = new Map(LEXICON.map(([l, e]) => [e.toLowerCase(), l]));
    const rng = new RNG(hashString(text));
    return text.replace(/[A-Za-z][A-Za-z'-]*/g, (word) => {
      const lower = word.toLowerCase();
      if (word.length <= 3 || STOP.has(lower)) return word;   // keep it legible
      // only words that HAVE a luminel form are candidates for alienising
      const lum = en2lum.get(lower);
      if (!lum) return word;                                   // no translation → plain
      if (knownEnglish.has(lower)) return word;                // you know this word → English
      // unknown: show the luminel, matching the source word's capitalisation
      const cap = word[0] === word[0].toUpperCase();
      const shown = cap ? lum[0].toUpperCase() + lum.slice(1) : lum;
      return `<span class="lum-unknown">${shown}</span>`;
    });
  }
}
