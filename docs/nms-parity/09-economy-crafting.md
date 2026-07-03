# Volume 9 — Economy, Crafting, Refining & Progression

**Document status:** Domain volume, part of the 18-volume AllMansSky → No Man's Sky parity report (see [Volume 0](./00-executive-summary.md) for methodology and the cross-volume scorecard).
**Scope:** currencies and their source/sink loops; galactic trade (economy types, wealth, supply/demand, price crashes, arbitrage routes); resource families; refining (portable/medium/large); crafting trees; cooking; salvage/scrap → nanites; guild/faction reputation; the blueprint/upgrade progression economy.
**Primary source modules examined:** `src/gameplay/trading.js`, `src/gameplay/items.js`, `src/gameplay/mining.js`, `src/gameplay/machines.js`, `src/gameplay/quests.js`, `src/gameplay/state.js`, `src/ui/tradeui.js`, `src/ui/refinerui.js`, `src/ui/inventoryui.js`, `src/ui/missionboard.js`, `src/universe/lore.js`.
**Engine-gated:** No. Every gap in this volume is data-model and systems work, not renderer/spherical-planet work — it can proceed on the current architecture in parallel with Volumes 1–3.

---

## 9.1 What No Man's Sky does

No Man's Sky's economy is three interlocking currencies, a galaxy of per-system markets with real (if simplified) supply/demand, a deep refining/crafting recipe graph numbering in the hundreds of nodes, a parallel cooking economy, a salvage-to-nanite pipeline, and a three-race guild reputation system that gates rewards and discounts. It is the largest single "spreadsheet" system in the game, tuned over a decade of updates (Foundation, Pathfinder, Atlas Rises, NEXT, Beyond, Synthesis, Origins, Frontiers, Waypoint, Fractal, Orbital, Worlds Part I/II).

### 9.1.1 Three currencies

| Currency | Primary sources | Primary sinks | Notes |
|---|---|---|---|
| **Units** (main currency, ⨂) | Selling commodities/products at trade terminals; mission/guild rewards; scrapping ships/freighters; selling salvaged tech; derelict freighter loot; farming loops (crafted trade goods sold in bulk); discovery upload micro-payouts; bounties; asteroid mining sell-off | Ship/freighter/multitool/frigate purchases; base part costs (some parts cost units, most cost resources); fuel (Starship launch fuel, Di-hydrogen); technology & upgrade module purchase; exosuit/ship/multitool inventory *slot* purchases (steep, near-exponential per-slot curve); repairs; blueprint purchases from Specialist terminals; NPC trades; teleporter-adjacent services | The economy's base layer — effectively unbounded once a player finds a good trade loop or farm, which is a known "late-game problem" NMS balances by making slots/ships/frigates cost more, not by taxing income |
| **Nanites** (tech currency, ⧖) | Scanning flora/fauna/minerals (small trickle, capped per discovery); Guild mission-board rewards; Nexus community mission rewards; salvaging derelict freighters and crashed ships; dismantling technology (recycling a module for a nanite refund); Quicksilver Synthesis Companion daily/weekly bonuses; base building & exploration milestones | Buying/upgrading **technology blueprints** from the Iteration/Specialist NPCs (Weapons, Suit, Exocraft, Scientific) — cost rises per tier; "instant max" purchase of a technology's stats; Exocraft summon-station upgrades; some cosmetic purchases | Nanites are the *tech-tree* currency — separate from Units specifically so raw wealth cannot buy raw power without also engaging exploration/combat/scanning loops |
| **Quicksilver** (cosmetic/community currency, ⌬) | Nexus weekly community missions (base-game NPC-issued, scale with participation); Quicksilver Synthesis Companion (a standing NPC at the Space Anomaly who drips Quicksilver over real time and via short fetch tasks); Expedition milestone rewards | Cosmetic-only purchases at the Quicksilver Synthesis Companion: ship/multitool/exosuit decals & skins, emotes, base parts, companion pets, banned/exclusive expedition rewards | Deliberately walled off from gameplay power — a live-service-style currency layered on top of the core two |

Units and Nanites are *earned every session through gameplay loops*; Quicksilver is *earned on a much slower, live-service cadence* and buys nothing that affects capability, only appearance and collection completeness.

### 9.1.2 Galactic economy: types, wealth, buy/sell modifiers

Every system carries an **economy type** and a **wealth level**, independently rolled, both visible on the system map/HUD before you even warp in:

| Economy type | Exports cheap | Imports dear | Flavor |
|---|---|---|---|
| Mining | Raw elements, ores | Manufactured/tech goods | Extraction outposts, refinery haze |
| Manufacturing | Processed compounds (alloys, glass, circuitry) | Raw elements | Fabrication yards consuming ore |
| Trading | Broad, deep stock at moderate spreads, biggest sell caps | — | Mercantile hub systems, best base-price arbitrage anchor |
| High Tech / Advanced Materials | Tech components, exotic compounds | Precious/raw metals | Boutique high-margin goods |
| Power Generation | Fuel elements (Di-hydrogen, Tritium-adjacent) | — | Energy-sector systems |
| Scientific | Research curiosities, catalysts | — | Rare, thin stock but high per-unit value |

Layered on economy *type* is a **wealth level** (roughly a 1–5 scale shown as currency-symbol pips, from Poor/Low to Wealthy), which scales the *magnitude* of both buy and sell prices and the depth of stock — a Wealthy Trading system buys imports at a much higher absolute price and holds far more stock than a Poor Mining outpost buying the same good. Conflict level (Low/Medium/High) is a third, separate axis that governs Sentinel/pirate aggression, not price, but strongly correlates with which economy types tend to spawn together in a region.

### 9.1.3 Galactic trade terminals: supply/demand, price crashes, restock, arbitrage

Every space station, trading post, and planetary settlement has a **Trade Terminal** listing a buy price and sell price per commodity. The prices are not static:

- **Base price** is `substance.baseValue × economyTypeModifier(item, systemEconomy) × wealthModifier(systemWealth)`.
- **Supply erosion**: selling a large stack of one item to one terminal in one visit measurably **crashes the local sell price** for that item — each unit sold nudges the price down along a diminishing curve, so dumping 9,999 units of a single farmed commodity yields sharply less per-unit than the first hundred. This is the mechanic that stops naive "sell everything at once" exploits and forces players to spread sales across systems or over time.
- **Restock/recovery**: prices (and depleted buy-side stock) recover over real/game time — historically on a rolling basis tied to server-side or local timers, effectively a "market resets after N minutes/hours" model, so a farmed loop is periodically re-sellable rather than permanently exhausted.
- **Arbitrage / trade routes**: because economy type sets which goods are cheap-to-buy in one system and dear-to-sell in another, the core "trade route" loop is: buy an export good cheap in a Mining/Manufacturing system, haul it (cargo-hold-limited) to a Trading/High-Tech system a few warps away, sell into the import-side premium. Community tooling (and later, in-game guidance) tracks known high-margin routes; some crafted "trade commodities" (goods with no use except selling — e.g., processed luxury items) exist purely to maximize this margin, since their base value is set high and their raw inputs are cheap and common.
- **Trade terminal at your own base/freighter**: the Autonomous Trading Terminal building part lets players run the same buy/sell interface without a station, and freighters have their own terminal, deepening the "compare markets, plan a haul" loop.

### 9.1.4 Resource families

NMS substances are organized into families that gate refining/crafting recipes and repeat gameplay affordances:

- **Localized earth elements** — Carbon, Oxygen, Sodium, Nitrogen and biome-tinted equivalents (e.g., frozen-biome oxygen variants), farmed directly from terrain/flora/fauna with the mining beam or by harvesting plants; these are the "always available, biome-flavored" tier feeding survival consumables and low-tier refining.
- **Catalysts** — Fungal Mould, Cactus Flesh, Mordite, Solanium and similar biological/geological byproducts used almost exclusively as refiner *inputs* to convert common elements into higher-value ones (famous community refining loops chain these).
- **Stellar/precious metals** — Copper, Cadmium, Emeril, Indium (star-class-gated "chromatic metals"), plus Gold, Silver, Platinum-equivalents, feeding both trade value and higher tech crafting.
- **Curiosities & trade goods** — Gravitino Balls, Runaway Mould, Storm Crystal, Cetus Egg, Living Glass — high base-value items either found or crafted specifically to be sold, not consumed.
- **Salvage** — Salvaged Data, Wiring Looms, Salvaged Frigate Modules, Salvaged Technology from crashed ships/derelict freighters/buried technology modules, largely destined for nanite conversion or blueprint recovery rather than the trade terminal.
- **Fuel elements** — Di-hydrogen (launch thrusters), Tritium-class elements (pulse drive), Antimatter/Warp Cells (hyperdrive; itself a crafted chain: Antimatter + Fusion Igniter → Warp Cell).

### 9.1.5 Refining: portable / medium / large refiners

Three refiner tiers exist, distinguished by input/output slot count and batch throughput, not by different recipes:

| Tier | Slots | Where | Character |
|---|---|---|---|
| Portable Refiner | 1 in / 1 out (chainable by hand) | Carried in exosuit inventory, deployed anywhere | Slow, single-stream, field use |
| Medium Refiner | up to 2 in / 1 out | Base-buildable | Faster, modest batching |
| Large Refinery | up to 3 in / 1 out | Base-buildable, requires power | Fastest, full multi-input recipes, the endgame farm engine |

Recipes number in the hundreds, defined as input-ratio → output-ratio pairs with a *processing rate* (units/second), not a fixed craft time — larger stacks simply take proportionally longer, and higher-tier refineries process faster. Both **N→1** (e.g., 2 Sodium → 1 Sodium Nitrate) and **1→N** (e.g., 1 Di-hydrogen Jelly → 2 Di-hydrogen) directions exist, and many recipes are explicitly designed to be **chained** (output of recipe A is the input of recipe B is the input of recipe C) — this chaining is the basis of the community's famous high-margin "refiner farm" loops (e.g., raw catalyst → intermediate compound → high-value tradeable, run unattended across dozens of refiners).

### 9.1.6 Crafting trees for tech/tradeables

Outside refining, a separate crafting layer builds **technology and product items** from intermediate compounds via blueprints: Circuit Boards, Electromagnetic Cores, Ionised Cobalt, Chromatic Metals feed into multitool upgrade modules, ship tech (pulse engine upgrades, hyperdrive tiers, shield/weapon modules), exocraft modules, and base building components. Each blueprint is a small DAG of its own (2–4 inputs, sometimes including other crafted intermediates), and blueprints themselves are gated behind Nanite purchases, story milestones, or salvage discovery — so the crafting tree and the progression economy (9.1.10) are the same system viewed from different angles.

### 9.1.7 Cooking (Nutrient Processor)

The **Nutrient Processor** building part (also available as a portable version) is a parallel refining surface for **food**: ingredients harvested from flora (fruit, plant matter) and fauna (milk, eggs, meat-equivalent) combine via player-discovered or NPC-taught recipes into consumable products. **Cronus**, the chef NPC at the Space Anomaly's Cantina, issues cooking quests that teach specific recipes and buys finished products at a premium; some cooked products also grant temporary stat buffs (health/stamina/hazard protection) beyond their sell value, and rare "Star Seed"-tier ingredients feed the most valuable dishes. The cooking web is intentionally separate from the mineral refining web — different machine, different NPC economy sink, different resource family (biological, not geological).

### 9.1.8 Salvage / scrap

Crashed ships (found via scan/beacon), derelict freighters (multi-room procedural dungeons), buried Technology Modules (located with a Signal Locator/Booster and dug up with the terrain manipulator), and abandoned buildings all yield **salvage**: Salvaged Data, Salvaged Technology, Wiring Looms, and — critically — direct **Nanite payouts** either on pickup or when the salvaged tech is scrapped/repaired-then-recycled at a technology merchant. This is the dominant mid/late-game nanite faucet alongside guild missions, and it is the reason exploration (not just combat or trading) stays economically relevant deep into a playthrough.

### 9.1.9 Guild & faction reputation

Every inhabited system has a dominant race — **Gek**, **Korvax**, or **Vy'keen** — and space station mission terminals post race-flavored contracts across mission archetypes (trading/haulage runs, exploration/reconnaissance, combat/mercenary bounties, mining/procurement, rescue). Completing missions raises **standing** with that race on a tiered scale; higher standing unlocks: better prices at that race's terminals (a real, wired discount, not cosmetic), access to race-specific starships/multitools/words-of-the-language, and unique cosmetic/base-part rewards at the top tiers. The Nexus (Space Anomaly's multiplayer mission board) layers a fourth, faction-agnostic reputation-and-reward track that pays Units + Nanites + Quicksilver simultaneously for community-scaled objectives.

### 9.1.10 Progression economy

Beyond moment-to-moment trading, NMS gates *capability* behind a slower economy: **milestones** (base parts placed, distance travelled, creatures scanned, systems visited, etc.) pay one-off Unit/Nanite lump sums and account-wide titles; **blueprint unlocks** are purchased from Specialist NPCs with Nanites, each tier pricier than the last, forming the tech-tree backbone; **suit/ship/multitool/freighter inventory slots** are bought with Units on a steep, near-exponential per-slot curve, making "more inventory" the single biggest long-run Unit sink in the game. Together these three sinks (blueprints, slots, and the ship/freighter/multitool acquisition market) are what keep both Units and Nanites meaningfully scarce for the entire ~80–150 hour core progression, not just the first few hours.

---

## 9.2 What we have (cite source)

AllMansSky's economy is deliberately small and lives almost entirely in three files: `src/gameplay/trading.js` (167 lines — market formulas), `src/gameplay/items.js` (51 lines — the entire item/recipe registry), and `src/gameplay/machines.js` (251 lines — the base refiner/planter timer engine). One currency, six economy types, no supply/demand state, one recipe pool per crafting surface.

**Currency.** `GameState` (`src/gameplay/state.js:27`) declares a single field, `this.lumens = 250`, mutated only through `addLumens(n)` (`state.js:92-95`), which clamps at zero and emits `inventory:changed`. There is no second or third currency field anywhere in the save schema (`state.js:12-50`) — confirmed by grep: `nanites`, `quicksilver`, `cook`, and `nutrient` do not appear anywhere under `src/`.

**Economy types & tiers.** `ECON` in `trading.js:18-51` defines six types — `subsistence`, `mining`, `agrarian`, `industrial`, `technological`, `commercial` — each with a spawn `weight`, an `exportCats`/`importCats` (and occasionally `exportIds`) list keyed to item `category`, an optional flat multiplier (`flat`), and a lore `blurb`. `economyOf(system)` (`trading.js:55-68`) deterministically derives `{ type, tier }` from a seeded RNG keyed on `system.seed`, with faction nudges (`chorale`→`technological`, `sunward`→`agrarian`/`mining`) and a tier roll of 1–3 (15% chance tier 3, 40% chance tier 2). This is a legitimate, if shallow, analog of NMS's economy-type × wealth-level model — six types stand in for NMS's ~6, and `tier` (1–3) stands in for wealth level, feeding a `tierAmp = 1 + (tier-1)*0.12` multiplier into both `priceOf` and `sellPriceOf` (`trading.js:92,104`).

**Pricing.** `priceOf(itemId, system)` (`trading.js:87-97`) and `sellPriceOf(itemId, system)` (`trading.js:100-110`) are **pure functions** — every call recomputes from `jitter()` (a per-`(system,item)` deterministic RNG multiplier on `ITEMS[id].value`), `classify()` (export/import/neutral by category membership), `tierAmp`, and a flat `SELL_MULT = 0.72` asymmetric buy/sell spread (`trading.js:14`). Critically, **there is no market state**: nothing persists how many units have been bought or sold at a given station, so price never moves in response to player trading volume, and repeated buys/sells of the same item at the same station always quote the same price forever (modulo economy re-roll, which never happens post-generation). `stationStock(system)` (`trading.js:112-132`) computes a `qty` per stocked item (`rng.int(30,90)` for exports, `rng.int(5,40)` for imports) — but a full-repo grep confirms `s.qty` from `stationStock()`'s buy-side list is **never read by the buy UI**: `src/ui/tradeui.js:100-113` iterates `this._stock` and renders name/desc/tag/price only, with `×1`/`×5` buy buttons that call `gs.addItem(s.id, q)` unconditionally — the computed stock quantity is dead data, and station buy-side inventory is effectively infinite.

**Trade routes.** `tradeRoutesFrom(system, galaxy)` (`trading.js:138-167`) is a genuine arbitrage finder: for every non-artifact item, it computes `buyHere = priceOf(...)` at the current system and, across up to 8 neighbors (`galaxy.neighborsOf(system.id, 3)`), the best `sellThere = sellPriceOf(...)`, keeping routes with `margin = (sellThere-buyHere)/buyHere > 0.25`, sorted and capped to the top 3. `src/ui/tradeui.js:134-154` (ROUTES tab) renders these with a "LOCK TARGET" button that sets `gs.quests.vesperTarget` to the destination system id for warp navigation — but nothing tracks that a haul is "in progress," enforces cargo capacity against the route, or rewards completing it beyond the normal `sellPriceOf` payout on arrival. It is a *route finder*, not a *route economy*.

**Items & resource families.** `ITEMS` (`items.js:4-27`) holds **20 items** across six categories: `element` (6: ferrox, carbyne, oxylite, silica, pyrene, voidsalt), `precious` (5: aurium, cryostal, solanite, chlorophane, voltglass), `exotic` (1: nebulite), `compound` (4: ferroweave, luminglass, weavecircuit, voidcell), `consumable` (2: stimgel, aegiscell), `artifact` (1: luminelshard). Each item is a flat record (`name, symbol, category, value, stack, color, desc`) — there is no catalyst/salvage/fuel-element family distinction beyond the six generic categories, no biome-tinted variants, and no star-class-gated metals.

**Crafting (Arcforge).** `RECIPES` (`items.js:29-38`) holds **8 recipes**, all instant (no processing time), consumed via `InventoryUI._craft()` (`src/ui/inventoryui.js:669-677`), which validates `gs.hasItems(ins)`, calls `gs.removeItems`/`gs.addItem`, and fires a notify toast. Every recipe here is N→1 except `fuel` (`carbyne ×4 → pyrene ×3`, a 1→N conversion). None of the 8 recipes chain — no recipe's *output* item id appears as another recipe's *input*, so there is no multi-step crafting tree in the data today.

**Refining (base machines).** `REFINER_RECIPES` (`src/gameplay/machines.js:20-27`) holds **6 recipes**, all N→1, each with a wall-clock `time` in seconds (45–120s). Jobs are timestamp-based (`job.started`, `refinerProgress()` at `machines.js:75-87` derives `frac`/`remainMs` from `Date.now() - started`), which is a legitimately good primitive — it survives page reloads and tab-backgrounding, unlike a per-frame countdown. `settleRefiner()` (`machines.js:95-107`) moves completed runs into an `output` hopper, blocking further settlement if the hopper holds a *different* item, and the data model supports `job.qtyRuns > 1` for batching — but `RefinerUI._start()` (`src/ui/refinerui.js:270-278`) only ever queues `qtyRuns: 1`, so batch queuing is structurally present but never exposed in UI. As with Arcforge, none of the 6 refiner recipes' outputs are inputs to another refiner recipe — no multi-step refining chain exists in the shipped recipe table (silica→voltglass, carbyne→chlorophane, pyrene→solanite, oxylite+silica→cryostal, ferrox→aurium, nebulite→voidsalt are six independent one-hop conversions). There is exactly **one refiner tier** — no portable/medium/large distinction; `RefinerUI` (`refinerui.js`) is the only refining surface besides the Arcforge fabricator.

**Cooking.** Does not exist. `machines.js` defines a second machine kind, `planter` (`CROPS`, `machines.js:30-36`), which is the closest analog — one crop (`chlorophane`, seeded by `carbyne ×2`, 180s grow time, yields 3-5) grown in a bio-planter and harvested via `RefinerUI._harvest()` (`refinerui.js:305-318`). This is a growth loop, not a cooking/recipe-combination loop, and there is no NPC chef, no Nutrient Processor, and the single crop item (`chlorophane`) is also a mineral, not a distinct food resource.

**Salvage.** Does not exist as a system. There are no crashed ships to repair-or-scrap, no derelict freighters, no buried technology modules, and no nanite-conversion path for salvage — consistent with there being no nanite currency to convert into.

**Guild & faction reputation.** `quests.js` implements a real, if unwired, reputation system: `REP_TIERS` (`quests.js:89-95`, five tiers DRIFTER→ASSOCIATE→PARTNER→ENVOY→LUMINARY at 0/50/150/400/1000 standing, each with a `discount` up to 0.12) and per-faction standing (`q.reputation = { meridian, chorale, sunward }`, `quests.js:185`) earned from board-mission rewards (`_completeBoard()`, `quests.js:293-306`, `reward.rep` added per faction). `QuestSystem.discountFor(faction)` (`quests.js:262`) computes the tier discount — but a full-repo grep shows **this method is called nowhere outside its own definition**: `trading.js`'s `priceOf`/`sellPriceOf` take no faction/reputation argument, so standing has zero effect on any price a player actually pays. `src/ui/missionboard.js:91-92` does read `gs.quests.reputation[f]` and `repTier(v)` to *display* standing progress bars, so the tier math is visible to the player, just economically inert. Faction rewards from board missions also grant items and lumens (`quests.js:298`), which is the game's only reputation-adjacent economic loop today. There is no analog to NMS's Gek/Korvax/Vy'keen race system tied to system dominance — AllMansSky's three tracked factions (Meridian Combine, Choir of Glass, Sunward Kin, per `src/universe/lore.js:67-82`) are lore factions issuing missions, not races that own stations with race-specific pricing.

**Progression economy.** `UPGRADES` (`items.js:41-48`) is the entire tech-tree analog: six tracks (`shipSpeed`, `shipShield`, `shipCargo`, `toolMine`, `toolBolt`, `suitEnergy`), each capped at level 3, cost scaling linearly (`cost(l) = base × l`, `lumens(l) = base × l`), purchased through `TradeUI`'s UPGRADES tab (`tradeui.js:195-237`). There are no blueprint unlocks gating *what* can be purchased (all six tracks are visible/purchasable from level 1 with no prerequisite), no milestone reward table, and cargo slots (`shipCargo`, `+8 slots/level`, `state.js:53`) are the closest analog to NMS's steep per-slot Unit sink but on a flat, not exponential, curve.

---

## 9.3 The gap

| # | Gap | Severity | Effort (eng-wk) |
|---|---|---|---|
| 1 | Only one currency (lumens); no Nanites, no Quicksilver, no tech/cosmetic currency separation | Structural | 2 |
| 2 | Market is stateless — `priceOf`/`sellPriceOf` are pure functions of `(itemId, system)`; no supply/demand tracking, no price impact from player trading volume, no restock timer | Structural | 3 |
| 3 | `stationStock()` computes a buy-side `qty` that is never read/enforced by `tradeui.js` — station stock is effectively infinite | Feature | 0.5 (rolled into #2) |
| 4 | Trade routes (`tradeRoutesFrom`) are a suggestion overlay only — no cargo-capacity check, no in-progress haul tracking, no completion bonus distinct from ordinary sell price | Feature | 1.5 |
| 5 | 6 economy types vs NMS's ~6 is proportionate, but no independent **wealth level** axis (tier conflates "wealth" and "spread magnitude" into one 1–3 roll) and no conflict-level axis | Feature | 1 |
| 6 | 20 items total across 6 flat categories; no earth-element/catalyst/stellar-metal/salvage/fuel-element family taxonomy, no biome-tinted or star-class-gated variants | Structural | 3 |
| 7 | One refiner tier (no portable/medium/large distinction, no throughput scaling by tier) | Feature | 1.5 |
| 8 | 6 refiner recipes + 8 Arcforge recipes, **zero chained recipes** (no recipe's output feeds another recipe's input) — no multi-step refining/crafting tree exists in data | Structural | 2 (data authoring, ongoing) |
| 9 | Batch queuing (`job.qtyRuns`) exists in the data model but is never exposed in `RefinerUI` (`_start()` hardcodes `qtyRuns: 1`) | Cosmetic | 0.5 |
| 10 | No cooking system at all — no Nutrient Processor, no chef NPC, no food resource family, no food recipes, no stat-buff consumables from cooking | Structural | 3 |
| 11 | No salvage/scrap system — no crashed ships, no derelict freighters, no buried technology modules, no nanite-conversion path | Structural | 4 (deferred pending nanites, and partially gated by Volume 6/8 wrecks) |
| 12 | Reputation tiers and `discountFor()` exist in `quests.js` but are **dead code** — never called by `trading.js`; standing has zero effect on any price | Feature | 1 |
| 13 | No race/faction system that *owns* stations with race-specific pricing (AllMansSky factions issue missions but don't gate station pricing by system dominance) | Feature | 1.5 |
| 14 | No blueprint-unlock gating — all 6 upgrade tracks are purchasable from level 1 with no prerequisite or Nanite cost; no milestone reward table | Feature | 2 |
| 15 | Upgrade/slot cost curves are flat/linear, not exponential — no long-run Unit sink pressure comparable to NMS's per-slot cost curve | Cosmetic | 0.5 |

**Total baseline effort (excluding ongoing recipe-data authoring):** ≈ 23 engineer-weeks, detailed further in §9.6.

---

## 9.4 Target design

### 9.4.1 Currencies: Nanites & Quicksilver

Extend `GameState` (`src/gameplay/state.js`) with two new balances alongside `lumens`, each with its own mutator so sinks/sources stay auditable:

```js
// state.js — add to constructor()
this.lumens = 250;
this.nanites = 0;
this.quicksilver = 0;

// mutators (mirror addLumens)
addNanites(n)     { this.nanites = Math.max(0, this.nanites + n); events.emit('inventory:changed'); }
addQuicksilver(n) { this.quicksilver = Math.max(0, this.quicksilver + n); events.emit('inventory:changed'); }
```

**Currency source/sink table (target):**

| Currency | New sources | New sinks |
|---|---|---|
| Lumens (existing) | unchanged, plus arbitrage completion bonus (§9.4.2) | unchanged, plus blueprint prerequisite lumens cost |
| Nanites | scan-discovery micro-payout (`discover()` in `state.js` already exists — add `nanites: Math.ceil(value/40)` alongside `addLumens(value)`); guild board-mission reward field `reward.nanites`; **salvage** (buried tech modules, wreck scrap — new `src/gameplay/salvage.js`); dismantling a maxed `UPGRADES` track one level for a partial refund | `UPGRADES` blueprint *unlock* cost (new prerequisite, paid once per track before lumens+item cost applies per level); new tech tiers beyond the current max-3 cap |
| Quicksilver | weekly "Nexus-style" board-mission variant (`kind: 'community'` template in `quests.js`, capped 1/week via a `lastCommunityAt` timestamp) | cosmetic-only shop: ship/suit trim palettes, Arcforge fabrication skins, base-part decals — a new `ui/cosmeticsui.js`; explicitly never a valid payment for `UPGRADES` or refiner recipes |

Nanites and Quicksilver both route through `events.emit('inventory:changed')` so all three currency displays (`tradeui.js`, `inventoryui.js`) stay reactive with no additional wiring.

### 9.4.2 Market model: supply/demand, price impact & restock

Replace the pure-function pricing in `trading.js` with a **stateful per-system market ledger**, persisted on `GameState` so it survives save/load (mirroring how `digs`/`bases` already persist mutable world state):

```js
// state.js — new field
this.markets = {};   // systemId -> { itemId -> { sold: number, bought: number, lastTickAt: number } }
```

**Price-impact formula** (replaces the flat `priceOf`/`sellPriceOf` outputs with a state-adjusted quote):

```
basePrice(item, system)   = jitter(item, system) * tierAmp(system) * econMult(item, system)   // existing formula, unchanged
sellQuote(item, system)   = basePrice * SELL_MULT * decayFactor(sold)
buyQuote(item, system)    = basePrice * growthFactor(bought)

decayFactor(sold)   = max(FLOOR, 1 - IMPACT_K * log1p(sold / SOFTNESS))     // more sold ⇒ lower sell price
growthFactor(bought) = min(CEIL,  1 + IMPACT_K * log1p(bought / SOFTNESS))  // more bought ⇒ higher buy price

FLOOR = 0.35, CEIL = 1.8, IMPACT_K = 0.22, SOFTNESS = 12   // tuned so ~10 units barely moves price, ~200 crashes it toward FLOOR
```

`log1p` gives strong early elasticity (each of the first few units moves price noticeably — matching NMS's early-crash feel) with sharply diminishing marginal impact at volume, and a hard floor/ceiling so price never hits zero or runs away. **Restock** is a decay-to-zero of `sold`/`bought` over wall-clock time, using the same `Date.now()`-delta pattern already proven in `machines.js`'s `refinerProgress()`:

```js
function settleMarket(entry, halfLifeMs = 20 * 60 * 1000) {
  const dt = Date.now() - (entry.lastTickAt ?? Date.now());
  const decay = Math.pow(0.5, dt / halfLifeMs);
  entry.sold = Math.max(0, entry.sold * decay);
  entry.bought = Math.max(0, entry.bought * decay);
  entry.lastTickAt = Date.now();
}
```

`priceOf`/`sellPriceOf` call `settleMarket()` first (lazy, on read — no ticking loop needed, same trick `settleRefiner()` uses), then apply `decayFactor`/`growthFactor` on top of the existing `jitter`/`tierAmp`/`econMult` pipeline, which is left untouched — this is additive, not a rewrite of §9.2's economy-type logic. Every `TradeUI` buy/sell action (`tradeui.js:108-126`) increments `entry.bought`/`entry.sold` by the transacted quantity before re-rendering, which is the missing feedback loop that makes over-selling visibly crash a price.

`stationStock()`'s `qty` field stops being dead data: the buy UI must clamp `×1`/`×5` buttons to `min(qty_remaining, requested)` and disable the row when `qty_remaining <= 0`, with `qty_remaining = max(0, qty - entry.bought)` decaying on the same restock timer.

**Arbitrage route economy.** `tradeRoutesFrom()` keeps its neighbor-scan/margin-sort logic unchanged (it is good code), but "LOCK TARGET" becomes "COMMIT RUN": it snapshots `{ itemId, qty: min(cargoFree, affordableQty), buyHere, sellThereQuoted, systemId, expiresAtWarp: n+1 }` onto `gs.quests.activeRoute`. Arriving at the target system and selling that exact item within the window pays `sellThereQuoted` (a locked-in quote, not the live one, protecting against another player-driven — future multiplayer — crash) **plus a flat 8% lumens "route completion" bonus**, giving arbitrage a distinct payout from ordinary selling and a concrete state object to headless-test (§9.7).

### 9.4.3 Recipe graph: unified data model for refining, crafting & cooking

Today, recipes live in three disconnected places (`items.js RECIPES`, `machines.js REFINER_RECIPES`, and no cooking table at all) with no shared schema and no chaining. Replace with one data-driven graph in a new `src/gameplay/recipes.js`, consumed by all three UIs:

```js
// src/gameplay/recipes.js
export const RECIPE_GRAPH = [
  {
    id: 'voltglass',        surface: 'refiner',  tier: 'portable',
    ins:  [{ id: 'silica', qty: 2 }],
    outs: [{ id: 'voltglass', qty: 1 }],
    timeSec: 60,
  },
  {
    id: 'weavecircuit_adv', surface: 'refiner',  tier: 'medium',
    ins:  [{ id: 'voltglass', qty: 2 }, { id: 'aurium', qty: 1 }],   // chains off voltglass above
    outs: [{ id: 'weavecircuit', qty: 3 }],
    timeSec: 140,
  },
  {
    id: 'voidcell_industrial', surface: 'refiner', tier: 'large',
    ins:  [{ id: 'weavecircuit', qty: 2 }, { id: 'voidsalt', qty: 4 }],  // chains off weavecircuit_adv
    outs: [{ id: 'voidcell', qty: 2 }],
    timeSec: 300,
  },
  {
    id: 'seared_bulb',      surface: 'cooking',  tier: 'nutrient',
    ins:  [{ id: 'starbulb', qty: 1 }, { id: 'brinewater', qty: 1 }],
    outs: [{ id: 'nutrientpaste', qty: 1 }],
    timeSec: 20,
    buff: { stat: 'oxygenMax', amount: 10, durationSec: 600 },
  },
  // ... hundreds more, data-authored incrementally
];

/** graph reachability check used by tests & by the "what can I make?" UI hint */
export function craftableChain(startItemId, graph = RECIPE_GRAPH) {
  const reached = new Set([startItemId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of graph) {
      if (reached.has(r.id)) continue;
      if (r.ins.every((i) => reached.has(i.id))) { reached.add(r.id); r.outs.forEach((o) => reached.add(o.id)); grew = true; }
    }
  }
  return reached;
}
```

Each recipe carries `surface` (`arcforge` | `refiner` | `cooking`) and `tier` (refiner: `portable`/`medium`/`large`; cooking: `nutrient`), so `RefinerUI`, `InventoryUI`'s Fabricate tab, and a new `CookingUI` all filter the *same* array instead of importing three separate constants — this is the structural fix that makes chaining possible, since nothing stops `voltglass`'s output from being `weavecircuit_adv`'s input once they share one array and `machines.js`'s existing timestamp-based `refinerProgress()`/`settleRefiner()` engine (already correct, left as-is) is generalized to key off `recipe.id` instead of a hardcoded `REFINER_RECIPES[idx]` index. Refiner *tier* gates which recipes a given placed refiner can run (`portable` recipes run anywhere; `large` recipes require a `large` refiner base piece), matching NMS's slot-count/speed tiering without needing three separate recipe tables.

### 9.4.4 Resource family expansion

Extend `ITEMS` (`items.js`) with a `family` field alongside the existing `category`, so pricing/UI logic keyed on `category` (six values, unchanged) keeps working while new systems (cooking, salvage, guild rewards) key on `family`:

| Family | Example new items | Feeds |
|---|---|---|
| `earthElement` | (existing ferrox/carbyne/oxylite/silica/pyrene/voidsalt tagged retroactively) | low-tier refining, survival |
| `catalyst` | moldspore, brinewater, glasssap | mid-tier refining multipliers |
| `stellarMetal` | starclass-tinted variants of aurium (e.g., `aurium_b`, `aurium_a`, roll by system star class) | high-tier compounds, trade goods |
| `salvage` | wiringloom, salvagedcore, techshard | nanite conversion only (§9.4.5) |
| `fuel` | (pyrene retagged) + new `warpplasma` | ship/warp sinks |
| `foodstuff` | starbulb, brinewater (shared with catalyst), gillmeat | cooking recipes only |

### 9.4.5 Guild reputation tiers & blueprint gating

Wire the already-computed `discountFor(faction)` (`quests.js:262`) into `trading.js` by threading the acting faction through the price call — the faction that "owns" a system's trade terminal is `system.faction` (already present on system records, used today by `economyOf()`'s faction nudges):

```js
// trading.js — priceOf/sellPriceOf gain an optional questSystem argument
export function priceOf(itemId, system, questSystem = null) {
  let p = /* existing pipeline, unchanged */;
  const discount = questSystem?.discountFor(system.faction) ?? 0;
  return Math.max(1, Math.round(p * (1 - discount)));   // higher standing ⇒ cheaper buys
}
export function sellPriceOf(itemId, system, questSystem = null) {
  let p = /* existing pipeline, unchanged */;
  const bonus = questSystem?.discountFor(system.faction) ?? 0;
  return Math.max(1, Math.round(p * (1 + bonus * 0.5)));  // higher standing ⇒ better sell-back, half rate
}
```

`TradeUI` already holds a `galaxy` reference; adding a `questSystem` reference at construction (`main.js` wiring, one line) closes gap #12 without touching the `REP_TIERS` table. Blueprint gating (gap #14) adds a `requiresRep: { faction, tier }` and `unlockCost: { nanites }` field to each `UPGRADES` track, checked once (persisted as `gs.upgrades[track + 'Unlocked']`) before the existing per-level lumens+item cost applies — turning today's "everything purchasable from level 1" into a real progression gate that consumes both reputation and Nanites, matching NMS's Specialist-terminal blueprint economy.

### 9.4.6 Module/file plan

| File | Status | Change |
|---|---|---|
| `src/gameplay/state.js` | modify | add `nanites`, `quicksilver`, `markets`, mutators |
| `src/gameplay/trading.js` | modify | add market-impact pricing, `settleMarket()`, `questSystem` param threading |
| `src/gameplay/recipes.js` | **new** | unified `RECIPE_GRAPH`, `craftableChain()`, tier/surface filters |
| `src/gameplay/items.js` | modify | add `family` field to `ITEMS`; keep `RECIPES`/`UPGRADES` exports as thin re-derivations of `recipes.js` for back-compat |
| `src/gameplay/machines.js` | modify | generalize refiner engine to index `RECIPE_GRAPH` by `id` + `tier` instead of `REFINER_RECIPES[idx]`; add `tier` field to refiner base pieces |
| `src/gameplay/cooking.js` | **new** | Nutrient Processor machine kind (`kind:'cooker'`), progress/settle functions mirroring `refinerProgress`/`settleRefiner` |
| `src/gameplay/salvage.js` | **new** | buried-tech-module dig sites (reuses `mining.js`'s dig raycasting), crashed-ship scrap tables, nanite payout |
| `src/ui/tradeui.js` | modify | market-impact-aware buy/sell buttons, stock clamping, "COMMIT RUN" route flow, quicksilver/nanite ledger display |
| `src/ui/refinerui.js` | modify | tier-filtered recipe list, batch `qtyRuns` control exposed |
| `src/ui/cookingui.js` | **new** | Nutrient Processor terminal, ingredient chip UI reused from `refinerui.js` patterns |
| `src/ui/cosmeticsui.js` | **new** | Quicksilver-only cosmetic shop |
| `src/gameplay/quests.js` | modify | wire `discountFor()` call site into `trading.js`; add `community` mission template (Quicksilver) |

---

## 9.5 Phases

1. **Currency & ledger foundation** — add `nanites`/`quicksilver` fields + mutators to `state.js`; surface both in `InventoryUI`'s status/cargo header next to lumens; no gameplay wiring yet. *(Unblocks everything else.)*
2. **Stateful market** — `gs.markets` ledger, `settleMarket()`, price-impact formula in `trading.js`, buy/sell buttons write back into the ledger, `stationStock()` qty enforced in `tradeui.js`. Ship the over-sell-crashes-a-price headless test (§9.7) at the end of this phase.
3. **Recipe graph unification** — introduce `recipes.js`, migrate `RECIPES`/`REFINER_RECIPES` into it with `surface`/`tier` tags, generalize `machines.js`'s engine to index by `id`; author the first real 3-step chain (voltglass → weavecircuit_adv → voidcell_industrial from §9.4.3) and ship the chain-yields-product headless test.
4. **Guild reputation wiring** — thread `discountFor()` into `priceOf`/`sellPriceOf`; add blueprint `requiresRep`/`unlockCost` gates to `UPGRADES`.
5. **Cooking** — `cooking.js` + `cookingui.js` + a Cronus-analog NPC sell path; author 15–20 starter recipes across the new `foodstuff`/`catalyst` families.
6. **Salvage** — buried tech module dig sites + crashed-ship scrap tables feeding Nanites; depends on Volume 6 (derelict/wreck placement) for full content but the conversion pipeline itself is independent.
7. **Arbitrage route economy** — "COMMIT RUN" state object, locked-quote payout, completion bonus; ship the positive-margin route headless test.
8. **Cosmetic Quicksilver sink** — `cosmeticsui.js`, first cosmetic item set.

Phases 1–4 are the highest-leverage, lowest-risk slice (≈10 of the 23 baseline weeks) and should ship as one increment; 5–8 can proceed in parallel afterward since they touch disjoint files.

---

## 9.6 Effort & risk (engineer-weeks)

| Phase | Work | Eng-wk | Key risk |
|---|---|:--:|---|
| 1 | Currency foundation | 1 | Low — pure additive state |
| 2 | Stateful market + price impact | 4 | Medium — tuning `IMPACT_K`/`SOFTNESS` for "feels fair, not punishing"; save-schema migration for existing saves without `markets` |
| 3 | Recipe graph unification + first chains | 5 | Medium — refactor of `machines.js`'s index-based job model to id-based without breaking in-flight saved jobs (needs a migration shim: old `job.recipeIdx` → new `job.recipeId`) |
| 4 | Guild reputation wiring | 2 | Low — `discountFor()` already computed, just needs a call site + blueprint gate fields |
| 5 | Cooking system | 4 | Medium — new machine kind, new NPC dialogue surface, ~20 recipes to author/balance |
| 6 | Salvage → nanites | 4 | Medium-High — best content payoff comes from wreck placement (Volume 6/8 dependency); the conversion pipeline alone is 1.5 wk, full wreck content is the rest |
| 7 | Arbitrage route economy | 2 | Low — additive state object on top of existing `tradeRoutesFrom()` |
| 8 | Cosmetic Quicksilver shop | 1.5 | Low — no new procedural art required if cosmetics reuse existing color/pattern palettes already used for ship/suit tinting |
| — | Recipe-data authoring (ongoing, beyond the first chain) | 3+ (open-ended) | Content risk, not engineering risk — hundreds of NMS recipes vs. a target of ~60–100 for AllMansSky is itself a judgment call on scope |
| **Total** | | **≈ 26.5 eng-wk** (≈ 6.5 months, 1 engineer; ≈ 3 months, 2 engineers on independent phases) | |

No item in this volume is engine-gated; all can run fully parallel to Volumes 1–3's rendering/spherical-planet rebuild. The single cross-volume dependency is salvage content (Phase 6) wanting Volume 6's wreck/derelict placement and Volume 8's base-part catalog for a "buried tech module" dig-site prop.

---

## 9.7 Acceptance criteria

All criteria are headless-verifiable the same way the existing suite verifies economy UI (`test/econ-ui-check.mjs`): boot via `index.html?state=space`, wait on `window.__AMS__.ready`, drive `window.__AMS__.game.gameState` / `.ui` directly, assert on returned state, no visual inspection required.

1. **Over-selling crashes a price.** Boot state, grant `gs.addItem('solanite', 500)`, open `TradeUI` at the current system, record `sellPriceOf('solanite', system)`, sell in five successive `×100` batches through the sell button, re-read `sellPriceOf('solanite', system)` after each. **Pass:** the final quote is ≤ `FLOOR` fraction (0.35×) of the first quote, and each successive quote is strictly ≤ the previous one (monotonic non-increase within one session, no restock elapsed).
2. **Restock recovers price.** Immediately after test 1, mutate `entry.lastTickAt` on the in-memory market ledger backward by `> halfLifeMs`, force a re-read of `sellPriceOf`. **Pass:** quote is measurably higher than the crashed value (within floor/ceiling bounds), demonstrating the decay-to-restock path independent of wall-clock waiting.
3. **A 3-step refine chain yields the product.** Boot state, grant the raw inputs for `voltglass` (from §9.4.3: `silica ×2`), place/open a refiner, start `voltglass`, fast-forward by mutating `job.started` backward past `timeSec`, call `settleRefiner()`, collect. Repeat feeding the collected `voltglass` + granted `aurium` into `weavecircuit_adv`, then the collected `weavecircuit` + granted `voidsalt` into `voidcell_industrial`. **Pass:** `gs.countItem('voidcell') >= 2` at the end, and at no point could the chain be run out of order (starting `weavecircuit_adv` without `voltglass` in inventory must fail `gs.hasItems()` and refuse to queue).
4. **Arbitrage route shows positive margin and pays it.** Call `tradeRoutesFrom(system, galaxy)`, assert `routes.length > 0` and `routes[0].marginPct > 25` (existing threshold, unchanged). Call the new "COMMIT RUN" action, assert `gs.quests.activeRoute` is populated with a locked `sellThereQuoted`. Simulate arrival at the target system (`events.emit('warp:end', activeRoute.systemId)`), sell the held item there. **Pass:** payout equals `activeRoute.sellThereQuoted * qty * 1.08` (the 8% completion bonus) and strictly exceeds what `sellPriceOf` at the *origin* system would have paid for the same stack.
5. **Currency separation holds.** Attempt to purchase an `UPGRADES` blueprint unlock with `gs.lumens` alone (zero Nanites). **Pass:** the purchase is refused (`ok === false` in the button state) even when `gs.lumens` is arbitrarily large, proving Nanites are a hard gate, not a discount.
6. **Reputation discount is live.** Set `gs.quests.reputation.meridian = 1000` (LUMINARY tier, 0.12 discount) at a Meridian-aligned system, compare `priceOf(item, system, questSystem)` against the same call with reputation reset to 0. **Pass:** the discounted quote is ≤ 0.89× the undiscounted quote (accounting for rounding), and the corresponding `sellPriceOf` bonus is ≥ 1.05×.
7. **Cooking loop closes.** Grant a `foodstuff`-family ingredient pair, run a cooking recipe through `cooking.js`'s progress/settle functions (mirroring test 3's fast-forward pattern), collect the output, and confirm `USE_INFO`-style consumption applies its declared `buff` (e.g., `oxygenMax` temporarily raised) and that the item can also be sold at a **cooking-specific** sell price distinct from the mineral market (i.e., `sellPriceOf` is not called for foodstuff items — a separate `cookingSellPrice()` path is exercised).

Each criterion maps to one `test/*.mjs` script following the existing Playwright + SwiftShader harness pattern (`chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', ...] })`), asserting on `page.evaluate()`-returned JSON rather than pixels, consistent with `test/econ-ui-check.mjs` and `test/mission-check.mjs`.
