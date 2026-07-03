// Quests: the Vesper Signal main chain (lore transmissions that pull the
// Wayfarer deeper into the Reach) plus procedural side contracts that track
// themselves through gameplay events.
//
// CONTRACT: new QuestSystem(gameState, galaxy) → .init() .update(dt)
//   gameState.quests.vesperTarget — systemId the Signal points to (J-warp).
import { events } from '../core/events.js';
import { RNG, hash32, hashString } from '../core/rng.js';
import { ITEMS } from './items.js';
import { FACTIONS } from '../universe/lore.js';
import { audio } from '../audio/audio.js';

// The Signal's story, told in fragments at increasing warp depth.
const VESPER_BEATS = [
  { depth: 1, title: 'First Clarity', reward: { lumens: 300 }, text: 'The Signal resolves for a heartbeat: not a beacon, not a distress call. A voice, counting. It has been counting for eleven thousand years, and it has just noticed you listening.' },
  { depth: 3, title: 'The Listener', reward: { lumens: 500, items: [['voidcell', 1]] }, text: 'Three jumps deep, the count grows louder. Between the numbers now: a name. Yours. The Luminel folded themselves into light — but light must be witnessed to exist, and the Reach has been dark so long.' },
  { depth: 5, title: 'What The Wardens Keep', reward: { lumens: 800 }, text: 'The Wardens do not guard the ruins. They guard the silence. Every crystal you cut rings like a bell in a cathedral no one prays in, and the machines remember when the music stopped.' },
  { depth: 8, title: 'The Last Chorister', reward: { lumens: 1200, items: [['voidcell', 1]] }, text: 'One of them stayed behind. When the Luminel became light, one voice remained to keep the count — to remember the shape of every soul that left. The Vesper Signal is not calling you somewhere. It is calling you SOMEONE.' },
  { depth: 12, title: 'The Shape Of The Reach', reward: { lumens: 1600, items: [['nebulite', 6]] }, text: 'Chart your jumps and see: the path the Signal draws is a spiral, tightening. At its center, the galaxy keeps a room no star has entered. The Chorister is there, still counting. It is nearly done.' },
  { depth: 16, title: 'Witness', reward: { lumens: 2400, items: [['luminelshard', 3]] }, text: 'The count ends with you. The Chorister asked for a witness, and the Reach sent a Wayfarer with dust on their boots and someone else\'s ship. It is enough. Somewhere behind the light, eleven thousand years of held breath release. The Signal does not stop — but now, it sings.' },
];

// side-contract templates: each tracks an event and a count
const CONTRACT_TEMPLATES = [
  {
    kind: 'prospect',
    make: (rng, resources) => {
      const id = rng.pick(resources ?? ['ferrox', 'carbyne', 'silica']);
      const n = rng.int(10, 30);
      return {
        title: `Prospect: ${ITEMS[id]?.name ?? id} ×${n}`,
        desc: `The Meridian Combine pays for raw ${ITEMS[id]?.name ?? id}.`,
        event: 'resource:mined', filterId: id, need: n,
        reward: { lumens: n * (ITEMS[id]?.value ?? 6) * 2 },
      };
    },
  },
  {
    kind: 'cartograph',
    make: (rng) => {
      const n = rng.int(2, 4);
      return {
        title: `Cartograph: scan ${n} lifeforms`,
        desc: 'The Choir of Glass catalogues every voice in the Reach.',
        event: 'discovery:new', filterKind: 'creatures', need: n,
        reward: { lumens: 600, items: [['chlorophane', 3]] },
      };
    },
  },
  {
    kind: 'pilgrimage',
    make: () => ({
      title: 'Pilgrimage: commune with a ruin',
      desc: 'Find a Luminel ruin or beacon and listen.',
      event: 'discovery:new', filterKind: 'ruins', need: 1,
      reward: { lumens: 500, items: [['voidsalt', 2]] },
    }),
  },
  {
    kind: 'purge',
    make: (rng) => {
      const n = rng.int(2, 4);
      return {
        title: `Purge: destroy ${n} Wardens`,
        desc: 'The Sunward Kin pay for every custodian scrapped.',
        event: 'combat:wardenKilled', need: n,
        reward: { lumens: 900, items: [['solanite', 2]] },
      };
    },
  },
  {
    kind: 'bounty',
    make: (rng) => {
      const n = rng.int(1, 3);
      return {
        title: `Bounty: down ${n} Ashen raider${n > 1 ? 's' : ''}`,
        desc: 'The Combine insures its lanes in blood money.',
        event: 'combat:pirateKilled', need: n,
        reward: { lumens: 1100 },
      };
    },
  },
];

const MAX_ACTIVE = 3;
const MAX_BOARD = 3;

// ---------------------------------------------------------------- reputation --
const REP_TIERS = [
  { at: 0, name: 'DRIFTER', discount: 0 },
  { at: 50, name: 'ASSOCIATE', discount: 0.03 },
  { at: 150, name: 'PARTNER', discount: 0.06 },
  { at: 400, name: 'ENVOY', discount: 0.09 },
  { at: 1000, name: 'LUMINARY', discount: 0.12 },
];

/** reputation tier for a standing value → { name, discount, next } */
export function repTier(v) {
  let cur = REP_TIERS[0], next = null;
  for (let i = 0; i < REP_TIERS.length; i++) {
    if (v >= REP_TIERS[i].at) { cur = REP_TIERS[i]; next = REP_TIERS[i + 1] ?? null; }
  }
  return { ...cur, next };
}

// board mission templates — each posts under a faction and pays standing.
const BOARD_TEMPLATES = [
  { kind: 'prospect', faction: 'meridian', make: (rng, ctx) => {
    const id = rng.pick(ctx.resources ?? ['ferrox', 'silica']); const n = rng.int(15, 40);
    return { title: `Haulage: ${ITEMS[id]?.name ?? id} ×${n}`, desc: 'The Combine needs raw stock and pays a finder\'s fee.',
      event: 'resource:mined', filterId: id, need: n, reward: { lumens: n * (ITEMS[id]?.value ?? 6) * 2, rep: 18 } };
  } },
  { kind: 'cartograph', faction: 'chorale', make: (rng) => {
    const n = rng.int(2, 5);
    return { title: `Field Survey: catalogue ${n} lifeforms`, desc: 'The Choir of Glass records every voice in the Reach.',
      event: 'discovery:new', filterKind: 'creatures', need: n, reward: { lumens: 700, items: [['chlorophane', 3]], rep: 22 } };
  } },
  { kind: 'pilgrimage', faction: 'chorale', make: () => ({
    title: 'Pilgrimage: commune with a ruin', desc: 'Stand where the Luminel stood and listen.',
    event: 'discovery:new', filterKind: 'ruins', need: 1, reward: { lumens: 600, rep: 20 } }) },
  { kind: 'purge', faction: 'sunward', make: (rng) => {
    const n = rng.int(2, 5);
    return { title: `Culling: scrap ${n} Wardens`, desc: 'The Sunward Kin buy custodian wreckage by the tonne.',
      event: 'combat:wardenKilled', need: n, reward: { lumens: 1000, items: [['solanite', 2]], rep: 26 } };
  } },
  { kind: 'bounty', faction: 'meridian', make: (rng) => {
    const n = rng.int(1, 3);
    return { title: `Bounty: down ${n} Ashen raider${n > 1 ? 's' : ''}`, desc: 'The Combine insures its lanes in blood money.',
      event: 'combat:pirateKilled', need: n, reward: { lumens: 1100, rep: 24 } };
  } },
  { kind: 'courier', faction: 'meridian', make: (rng) => {
    const id = rng.pick(['ferroweave', 'luminglass', 'oxylite', 'carbyne']); const n = rng.int(6, 18);
    return { title: `Courier: deliver ${ITEMS[id]?.name ?? id} ×${n}`, desc: 'Bring the goods to any board and claim payment.',
      event: 'courier', filterId: id, need: n, reward: { lumens: n * (ITEMS[id]?.value ?? 10) * 3, rep: 20 } };
  } },
  { kind: 'survey', faction: 'sunward', make: (rng, ctx) => {
    const target = ctx.neighbor;
    if (!target) return null;
    return { title: `Scout run: reach ${target.name}`, desc: 'The Kin want eyes on a neighbouring system.',
      event: 'survey', target: target.id, need: 1, reward: { lumens: 900, items: [['voidsalt', 2]], rep: 22 } };
  } },
];

/** deterministic board offers for a system (needs the system + galaxy for survey targets) */
export function boardMissionsFor(system, gs, galaxy) {
  const done = gs.quests?.completedBoard?.length ?? 0;
  const rng = new RNG(hash32(hashString(String(system.id)), done, 0x804d));
  let resources = null, neighbor = null;
  try { resources = galaxy?.getSystem(system.id)?.planets?.[0]?.resources; } catch { /* fine */ }
  try { const ns = galaxy?.neighborsOf(system.id, 3) ?? []; neighbor = ns[rng.int(0, Math.max(0, ns.length - 1))]; } catch { /* fine */ }
  const ctx = { resources, neighbor };
  const out = [];
  const pool = [...BOARD_TEMPLATES];
  let guard = 0;
  const count = rng.int(4, 6);
  while (out.length < count && guard++ < 24 && pool.length) {
    const tpl = rng.pick(pool);
    const m = tpl.make(rng.fork(`b${out.length}${guard}`), ctx);
    if (!m) continue;
    m.id = `${system.id}:${done}:${out.length}`;
    m.kind = tpl.kind;
    m.faction = tpl.faction;
    m.have = 0; m.done = false;
    if (out.some((o) => o.title === m.title)) continue;
    out.push(m);
  }
  return out;
}

export class QuestSystem {
  constructor(gs, galaxy) {
    this.gs = gs;
    this.galaxy = galaxy;
    this._offs = [];
  }

  init() {
    const q = this.gs.quests;
    q.active ??= [];
    q.completed ??= [];
    q.vesperDepth ??= 0;
    q.beatsSeen ??= [];
    q.board ??= [];
    q.completedBoard ??= [];
    q.reputation ??= { meridian: 0, chorale: 0, sunward: 0 };

    this._retarget();
    this._refill();

    this._offs.push(events.on('warp:end', (systemId) => {
      this.gs.quests.vesperDepth += 1;
      this._retarget();
      this._checkBeats();
      this._refill();
      // survey board missions complete on arrival at their target system
      this._progressBoard('survey', (m) => (m.target === systemId ? 1 : 0));
    }));

    // generic contract progress
    this._offs.push(events.on('resource:mined', ({ id, amount }) => {
      this._progress('resource:mined', (c) => (c.filterId === id ? amount : 0));
    }));
    this._offs.push(events.on('discovery:new', ({ kind }) => {
      this._progress('discovery:new', (c) => (c.filterKind === kind ? 1 : 0));
    }));
    this._offs.push(events.on('combat:wardenKilled', () => {
      this._progress('combat:wardenKilled', () => 1);
    }));
    this._offs.push(events.on('combat:pirateKilled', () => {
      this._progress('combat:pirateKilled', () => 1);
    }));

    // surface first-beat: the Signal introduces itself on a fresh game
    // (skipped in ?state= debug boots so tests see the world, not the modal)
    const debugBoot = typeof location !== 'undefined' && new URLSearchParams(location.search).has('state');
    if (!debugBoot && this.gs.quests.vesperDepth === 0 && !this.gs.quests.beatsSeen.includes('prologue')) {
      this.gs.quests.beatsSeen.push('prologue');
      setTimeout(() => {
        events.emit('lore:show', {
          title: 'The Vesper Signal',
          text: 'It woke you from cryo-drift with a sound like a struck glass. Every chart you own marks this arm of the galaxy VACANT. The Signal disagrees. Follow it — one warp at a time — and find out which of you is lying.',
        });
      }, 12000);
    }
  }

  _progress(eventName, countFn) {
    const q = this.gs.quests;
    let changed = false;
    for (const c of q.active) {
      if (c.event !== eventName || c.done) continue;
      const inc = countFn(c);
      if (!inc) continue;
      c.have = Math.min(c.need, (c.have ?? 0) + inc);
      changed = true;
      if (c.have >= c.need) {
        c.done = true;
        this._complete(c);
      }
    }
    if (changed) events.emit('quest:updated');
    // accepted board missions track on the same events
    this._progressBoard(eventName, countFn);
  }

  _progressBoard(eventName, countFn) {
    const q = this.gs.quests;
    if (!q.board?.length) return;
    let changed = false;
    for (const m of q.board) {
      if (m.event !== eventName || m.done) continue;
      const inc = countFn(m);
      if (!inc) continue;
      m.have = Math.min(m.need, (m.have ?? 0) + inc);
      changed = true;
      if (m.have >= m.need) { m.done = true; this._completeBoard(m); }
    }
    if (changed) events.emit('quest:updated');
  }

  /** reputation-tier trade discount for a faction (0..0.12) */
  discountFor(faction) { return repTier(this.gs.quests.reputation?.[faction] ?? 0).discount; }

  acceptBoard(m) {
    const q = this.gs.quests;
    if ((q.board?.length ?? 0) >= MAX_BOARD) { events.emit('notify', { text: 'MISSION LOG FULL (3 max)', tone: 'warn' }); audio.sfx('deny'); return false; }
    if (q.board.some((x) => x.id === m.id)) return false;
    q.board.push({ ...m, have: 0, done: false, accepted: true });
    audio.sfx('confirm');
    events.emit('notify', { text: `MISSION ACCEPTED — ${m.title}`, tone: 'info' });
    events.emit('quest:updated');
    return true;
  }

  abandonBoard(m) {
    const q = this.gs.quests;
    q.board = q.board.filter((x) => x.id !== m.id);
    audio.sfx('click');
    events.emit('quest:updated');
  }

  /** courier missions complete by handing over held cargo at any board */
  claimCourier(m) {
    const gs = this.gs;
    if (m.kind !== 'courier') return false;
    if (gs.countItem(m.filterId) < m.need) { events.emit('notify', { text: 'YOU LACK THE CARGO TO DELIVER', tone: 'warn' }); audio.sfx('deny'); return false; }
    gs.removeItem(m.filterId, m.need);
    m.done = true;
    this._completeBoard(m);
    return true;
  }

  _completeBoard(m) {
    const gs = this.gs;
    gs.quests.board = gs.quests.board.filter((x) => x.id !== m.id);
    gs.quests.completedBoard.push(m.title);
    if (m.reward?.lumens) gs.addLumens(m.reward.lumens);
    for (const [id, qty] of m.reward?.items ?? []) gs.addItem(id, qty);
    if (m.reward?.rep && m.faction) {
      gs.quests.reputation[m.faction] = (gs.quests.reputation[m.faction] ?? 0) + m.reward.rep;
    }
    audio.sfx('discovery');
    const fac = FACTIONS[m.faction]?.name ?? m.faction;
    events.emit('notify', { text: `MISSION COMPLETE — ${m.title} (+${m.reward?.lumens ?? 0} ⌾ · +${m.reward?.rep ?? 0} ${fac} STANDING)`, tone: 'good' });
    events.emit('quest:updated');
  }

  _complete(c) {
    const gs = this.gs;
    gs.quests.active = gs.quests.active.filter((x) => x !== c);
    gs.quests.completed.push(c.title);
    if (c.reward?.lumens) gs.addLumens(c.reward.lumens);
    for (const [id, qty] of c.reward?.items ?? []) gs.addItem(id, qty);
    audio.sfx('discovery');
    events.emit('notify', {
      text: `CONTRACT COMPLETE — ${c.title}  (+${c.reward?.lumens ?? 0} ⌾)`,
      tone: 'good',
    });
    this._refill();
    events.emit('quest:updated');
  }

  _refill() {
    const gs = this.gs;
    const q = gs.quests;
    const rng = new RNG(hash32(hashString(gs.currentSystemId ?? 'x'), q.completed.length, q.active.length));
    let guard = 0;
    while (q.active.length < MAX_ACTIVE && guard++ < 10) {
      const tpl = rng.pick(CONTRACT_TEMPLATES);
      // current system's first planet resources flavor prospect contracts
      let resources = null;
      try { resources = this.galaxy.getSystem(gs.currentSystemId)?.planets?.[0]?.resources; } catch { /* fine */ }
      const c = tpl.make(rng.fork(`c${q.active.length}${guard}`), resources);
      if (q.active.some((a) => a.title === c.title)) continue;
      c.have = 0;
      c.done = false;
      c.kind = tpl.kind;
      q.active.push(c);
    }
    events.emit('quest:updated');
  }

  _checkBeats() {
    const q = this.gs.quests;
    for (const beat of VESPER_BEATS) {
      if (q.vesperDepth >= beat.depth && !q.beatsSeen.includes(beat.title)) {
        q.beatsSeen.push(beat.title);
        if (beat.reward?.lumens) this.gs.addLumens(beat.reward.lumens);
        for (const [id, qty] of beat.reward?.items ?? []) this.gs.addItem(id, qty);
        events.emit('lore:show', { title: beat.title, text: beat.text });
        events.emit('notify', { text: `THE VESPER SIGNAL — ${beat.title} (+${beat.reward?.lumens ?? 0} ⌾)`, tone: 'info' });
        audio.sfx('discovery');
        break; // one beat per jump — savor it
      }
    }
  }

  _retarget() {
    // the Signal points one hop deeper: the unvisited neighbor furthest from
    // the galactic origin
    try {
      const neighbors = this.galaxy.neighborsOf(this.gs.currentSystemId, 3) ?? [];
      const unvisited = neighbors.filter((n) => !this.gs.visitedSystems.includes(n.id));
      const pick = (unvisited.length ? unvisited : neighbors)
        .sort((a, b) => b.pos.length() - a.pos.length())[0];
      this.gs.quests.vesperTarget = pick?.id ?? null;
    } catch { this.gs.quests.vesperTarget = null; }
  }

  update(dt) {}

  dispose() { for (const off of this._offs) off?.(); }
}
