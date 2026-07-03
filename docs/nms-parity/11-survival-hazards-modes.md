# Volume 11 — Weather, Hazards, Survival & Game Modes

**Document status:** Domain volume 11 of 18 in the AllMansSky → No Man's Sky parity report.
**Subject version:** AllMansSky (WebGL2 + three.js@0.160, ~22,900 lines under `src/`, all-procedural, zero external assets).
**Scope:** No Man's Sky's full survival loop (hazard protection, life support, extreme weather, storm crystals, sentinel frenzy, shelters, stamina/jetpack, drowning, death/respawn) and its game-mode matrix (Creative/Normal/Survival/Relaxed/Permadeath/Custom), measured against what `src/gameplay/survival.js`, `src/render/weather.js`, `src/render/underwater.js`, `src/universe/biomes.js`, `src/gameplay/state.js`, and `src/ui/screens.js` actually implement today.

**Headline verdict:** AllMansSky has a real, working, single-tier hazard/oxygen drain model — it is not a stub. But it is a *scalar*, not a *system*: one combined "hazard" number per planet drains one "energy" meter, with no per-channel protection (thermal/toxic/radioactive are not tracked separately), no resource-driven recharge loop beyond a single manual oxygen consumable, no discrete storm events (weather is a continuous ambient VFX cycle, never an emergency), no storm crystals, no sentinel-frenzy escalation, no shelter/cave detection, no stamina meter, and — critically — **no game-mode system exists at all**. There is one implicit difficulty: whatever `src/gameplay/survival.js` hardcodes. Death always fully restores every vital and respawns you with zero loss. This volume is the parity spec for turning that scalar into NMS's resource web and building the mode/difficulty layer NMS ships as a first-class settings surface.

---

## 1) What NMS does

No Man's Sky's survival loop is a resource-management minigame layered on top of exploration, tuned per game mode. Its major parts:

**1.1 Hazard protection (four independent channels).** The exosuit tracks a single "Hazard Protection" meter in Normal mode that is depleted by whichever environmental hazard is currently active — Extreme Cold, Extreme Heat, Toxicity, or Radioactivity — and is recharged by consuming or crafting specific resources: **Sodium** (and refined **Sodium Nitrate**) is the general hazard-protection fuel; hazard-specific upgrades (Cold/Heat/Tox/Rad Protection modules) reduce drain rate for their specific hazard type. When the meter hits zero, the hazard bypasses it and drains **Health** directly (with a shield/health-cell buffer on top). Later NMS versions (Waypoint+) split this into up-front separate meters conceptually tied to suit upgrades, but the resource sink (Sodium/Di-hydrogen family) and the "one shared bar, hazard-specific drain rate" behavior is the throughline.

**1.2 Life support.** A separate meter drains continuously (faster with jetpack/sprint use) and is recharged with **Oxygen** (harvested from Oxygen flora/Gravitino Balls historically, now refined from various sources) or fixed with **Life Support Gel**. Zero life support does not itself kill — it disables sprint/jetpack regen and, underwater, becomes the oxygen-for-breathing meter (see 1.7). Ship/Exocraft have parallel fuel systems (Starship launch thrusters need Di-hydrogen, etc.) that are thematically the same "meter + resource sink" pattern.

**1.3 Extreme weather events.** Each planet has a weather *profile*, not a single fixed condition: baseline (calm/overcast/rain/snow) plus periodic **extreme weather** windows — firestorms, blizzards/freezing nights, toxic rainstorms, radioactive storms, and sandstorms — telegraphed by a UI warning ("Extreme weather incoming") before hazard multipliers spike 2–4×. During an extreme storm, **Storm Crystals** (mode-dependent: "Storm Crystals" on Lush/temperate worlds during weather events) spawn as harvestable, lit-up formations that reward exploring during the danger window; on some worlds, extreme weather is paired with a **Sentinel frenzy** (heightened Sentinel aggression/spawn rate — most associated with high-Sentinel-activity planets rather than a strict weather↔frenzy coupling, but community-documented as correlated on Sentinel-hostile worlds). Storms end as abruptly as they start, with a cooldown before the next.

**1.4 Shelters.** Caves, overhangs, crashed ship husks, buildings, and the player's own base interior are all "sheltered" — hazard drain drops to near zero indoors regardless of the storm outside. This gives storms a spatial counterplay: run to shelter rather than tank the drain.

**1.5 Day–night temperature swing.** Independent of storms, many biomes (frozen especially) apply a *cold* hazard only or mostly at night — daytime is temperate, nightfall drops temperature below the suit's passive tolerance. This is a second, slower-period hazard oscillation layered under the storm system.

**1.6 Per-biome weather/hazard profiles.** Each of NMS's dozen-plus biome archetypes (Lush, Frozen, Scorched/Hot, Toxic, Irradiated, Barren/Dead, Exotic/Anomaly, Volcanic, Marsh/Swamp, Weird, Infested, etc.) has a *characteristic* baseline hazard, a characteristic extreme-weather type, and characteristic flora/fauna hostility, so "which biome am I on" is legible from the hazard HUD alone.

**1.7 Underwater survival.** Submerging swaps the life-support meter into an oxygen-for-breathing role; a distinct set of upgrades (Fishmouth mask etc.) slow this specific drain. Depth itself is not directly lethal (no crush depth in base survival), but running out of breath underwater damages health exactly like vacuum suffocation, and returning to the surface (or finding an air pocket) resets it.

**1.8 Planetary hazards beyond weather.** Aggressive Sentinel factions (from passive to "Frenzied"/Corrupted, with drones/quads/walkers/titans escalating on repeated scanning/mining/killing — NMS's real analog to a "wanted level"), hazardous flora (spore pods, spitting plants that damage on touch/proximity), and predator creatures (aggressive fauna that hunt the player) stack on top of the ambient hazard drain.

**1.9 Stamina, sprint, jetpack.** Sprint has no separate stamina bar in modern NMS (life support covers it) but jetpack fuel is its own meter, drained by boosted flight and dodge-rolls, replenished on landing or via a Jetpack Tank upgrade region. Swimming stamina is folded into the life-support/oxygen meter above.

**1.10 Death & respawn.** On death, the player exosuit "reboots" and respawns at the last save/checkpoint (ship, base, or save beacon); a **grave marker ("Your grave")** is left at the death location holding a portion of dropped Units and inventory items, recoverable by walking back to it (with a decay timer in some modes). Permadeath is the exception (1.11).

**1.11 Game modes.** NMS ships discrete presets plus granular sliders:
- **Normal** — full survival loop as described above, moderate resource scarcity, death has minor inventory/currency loss recoverable from a grave, unlimited lives.
- **Survival** — sharply harsher hazard/life-support drain rates, sparser resource nodes, tougher combat, permadeath-adjacent stakes (death drops *more*, grave harder to reach in time before decay), no free fast-travel crutches.
- **Permadeath ("Perma")** — one life; death deletes/ends that save file outright, no respawn.
- **Creative** — all survival mechanics disabled (no hazard/life-support drain, infinite resources/inventory space, free crafting), pure building/exploration sandbox.
- **Relaxed** — survival drains present but slow/forgiving, generous resources, aimed at low-stress play.
- **Custom** — a full slider matrix exposed at game creation, letting players independently tune: survival damage taken, hazard/life-support drain rates, resource scarcity/abundance, crafting costs, currency/economy multipliers, fetch/fishing yields, damage given/taken, Sentinel aggression, fuel use, death consequences (drop nothing / drop some / drop all / restart save), and more — effectively a superset that can reconstruct any of the named presets or something entirely bespoke (e.g., "Creative combat, Survival resources").

This mode/slider system is exposed at the **main menu → new save** flow, is locked in per-save (can't be changed mid-playthrough for most sliders, though some can loosen), and is persisted in the save file so HUD/UI, drain formulas, and death handling all read from it at runtime.

---

## 2) What we have (cite source)

**2.1 A real hazard/oxygen model, but single-channel.** `src/gameplay/survival.js` — `Survival.update(dt, ctx)` (lines 19–62) runs two independent drains every frame:

- **Oxygen** (lines 24–38): `breathable = ctx.submerged ? 0 : def ? min(1, def.atmosphere.density*1.6) * (def.hazard.toxic>0.6 ? 0.3 : 1) : 0`. `O2_DRAIN = 100/210` (≈3.5 min full-tank vacuum life), multiplied by `(1 - breathable)` and by `1.6` while sprinting. At `oxygen<=0` it calls `_damageOverTime(6*dt, 'suffocation')`; under 20 it throttled-warns ("OXYGEN LOW — refine Oxylite") via `_warnGate`. Off-hazard, oxygen regens at a flat `6*dt`. **This same code path is what "drowning" is** — `ctx.submerged` forces `breathable=0`, so underwater O2 drains exactly like vacuum, with no distinct underwater tank, no depth/pressure term, no faster-drowning multiplier.
- **Hazard/energy** (lines 42–56): a **single combined scalar** — `hazard = max(heat, cold, def.hazard.toxic, def.hazard.rad) * storm`, where `heat = isNight ? 0 : def.hazard.heat`, `cold = isNight ? max(cold, cold>0?0.15:0) : cold*0.5` (day/night swing exists, but only as a multiplier on the biome-baked scalar, not a real temperature curve), and `storm = 1 + (ctx.storm ?? 0) * 1.6` reads `WeatherSystem.intensity` passed in from `SurfaceState`. Above `hazard>0.2`, `gs.energy` drains at `hazard*2.4*dt`; at zero energy, `_damageOverTime(hazard*5*dt, 'hazard')` bites health directly. There is **no per-hazard-type meter** — heat, cold, toxic, and radioactive protection are not separable; whichever is numerically largest wins and there is only one shared "energy" pool, with only one regen path (passive `+1.5*dt` when `hazard<0.2`, i.e., *no resource ever recharges it* — no Sodium analog for hazard protection at all).
- **Shield & damage**: `applyDamage(amount, type)` (lines 64–76) absorbs into `gs.shield` first, then `gs.health`, emits `player:damage`/`player:death`; shield regenerates (`SHIELD_REGEN=8/s` after `SHIELD_DELAY=4s` untouched) independent of survival hazards.

**2.2 One resource-sink precedent, not a web.** `src/ui/inventoryui.js` line 642 (`_use('oxylite')`) is the *only* consumable that feeds a survival meter: crushing Oxylite adds flat `+25` to `gs.oxygen`. `aegiscell` (line ~634) fully restores shield; `stimgel` restores 50 health. **No item restores `gs.energy` (hazard protection) at all** — the only way to refill it is passive regen out of hazard, or paying lumens at a station (`src/ui/tradeui.js` line 180: 60 lumens → full oxygen+energy+shield). `src/gameplay/items.js` defines the resource palette (`ferrox, carbyne, oxylite, silica, pyrene, voidsalt, aurium, cryostal, solanite, voltglass, nebulite`) but none besides Oxylite is wired to a vital.

**2.3 Weather is ambient VFX on a slow sine wave, not a discrete event.** `src/render/weather.js`: `WeatherSystem` picks one fixed `kind` per planet from `planetDef.weather` (rolled once in `rollPlanetDef`, `src/universe/biomes.js` line 474) — `rain | toxicrain | snow | sandstorm | ashfall | thunder | clear`. `update(dt, playerPos, sunElevation)` (lines 114–160) computes `intensity` as `clamp(sin(t/cyclePeriod * 2π) * 1.4 + 0.35, 0, 1)` with `cyclePeriod` seeded per-planet in `[500,900]` seconds — a **continuous, never-ending oscillation** between calm and heavy, with no start/end event, no warning telegraph, no cooldown, no distinct "extreme" tier, and no player-visible state machine. `thunder` worlds get a `DirectionalLight` flash (`_flash`) firing on a random `[7,22]`s interval scaled by `intensity`, paired with an `explosion` SFX — cosmetic lightning only, not a hazard multiplier by itself. `intensity` feeds `Survival.update` only via `ctx.storm = this.weather.intensity` (`src/states/surfacestate.js` line 291) as the `storm` multiplier on the single combined hazard scalar (2.1) — there is no "Extreme Weather Incoming" warning, no storm-crystal spawn, and no sentinel-frenzy coupling anywhere in the codebase (confirmed: no `shelter`, `cave`, or storm-crystal token exists in `src/`, and Warden aggression in `src/gameplay/combat.js` is driven purely by mining/kill "wanted level," never by `weather.intensity`).

**2.4 Biome hazard bake, not a sampled environment field.** `src/universe/biomes.js`: each of the 11 `BIOMES` (`lush, swamp, desert, frozen, volcanic, toxic, irradiated, ocean, crystal, barren, exotic`) declares a `hazard: {heat,cold,toxic,rad}` roll range and one `weatherSet` array. `rollPlanetDef` (lines 405–531) rolls one `hazard` object and one `weather` string **per planet at generation time** (lines 466–474) — fixed for the planet's lifetime, not a function of position or real-time. `climate.c/w` (a Gaussian center/width in Kelvin, e.g. `lush: {c:288,w:42}`, `volcanic: {c:620,w:180}`) is used only to *weight biome selection* (`pickBiome`, lines 378–392) and to nudge `hazard.heat/cold` by how far `tempK` sits from `340`/`215` K thresholds (lines 469–470) — there is no `temperature(pos, t)` sample function; `isNight` is the only time-varying input `Survival` receives.

**2.5 Underwater is a rendering/life layer, correctly wired to the O2 drain, but has no distinct survival mechanics.** `src/render/underwater.js` (947 lines) is a serious system — pooled fog override (`_cacheFog/_applyFog/_restoreFog`), kelp streaming (`_updateKelp`/`_genKelpCell`), 4-school boids-lite fish (`_rescanSchools`/`_updateFish`), bubble particles (player stream + seafloor vents, `_updateBubbles`), caustics + god-ray shafts — and exposes `get submerged()` used by `SurfaceState` to set `ctx.submerged` for `Survival` (2.1's drowning path). But the file itself contains **zero gameplay/hazard code**: no pressure/depth hazard, no crush depth, no distinct underwater breath meter, no upgrade hooks. Depth only affects `d01 = clamp(camDepth/22, 0, 1)`, a purely visual fog/tint/glow interpolant.

**2.6 State model has the vitals but no mode/difficulty field.** `src/gameplay/state.js`: `GameState` constructor (lines 22–27) sets `healthMax/health=100`, `shieldMax/shield=50`, `oxygenMax/oxygen=100`, `energyMax/energy=100` ("suit power (hazard protection)"), `jetpack=1`, `lumens=250`. Nothing in the class references a mode, difficulty, or slider set — `save()`/`load()` (lines 108–179) serialize the whole object via `JSON.stringify(this)`/`Object.assign`, so a difficulty field *could* round-trip trivially if added, but none exists today.

**2.7 No game-mode UI exists.** `src/ui/screens.js` (341 lines) is the entire menu surface: `mainMenu()` (line 98) offers `Continue / Load Voyage / New Voyage / Settings`; `New Voyage` (`buildSeed`, line 146) only asks for a universe seed string, then `buildSlotPick` (line 161) only asks which of 3 save slots to write — **no difficulty/mode choice anywhere in the new-game flow**. `settings()` (line 208) exposes exactly three sliders/toggles: `volume`, `sensitivity`, `bloom` (`SETTINGS_DEFAULTS`, line 9) — no survival/damage/economy sliders. `dead()` (line 265) is a single "SIGNAL LOST … Return to the Light" screen with one button that always just closes and lets `main.js`'s `_onDeath()` handle it.

**2.8 Death has zero stakes.** `src/main.js` `_onDeath()` (lines 178–198): on `player:death`, it plays the `dead()` screen, then unconditionally does `gs.health=healthMax; gs.shield=shieldMax; gs.oxygen=oxygenMax; gs.energy=energyMax; gs.ship.hull=hullMax`, and respawns in-place (surface: same planet/landing pos; space: same system). **No inventory loss, no currency loss, no grave marker, no save deletion, no mode branching whatsoever** — every death today behaves like NMS's most forgiving Creative-adjacent setting, regardless of anything.

**2.9 Jetpack fuel exists; no stamina meter.** `src/gameplay/player.js`: `this.jetpack = 1` (line 33, 0..1, saved on `GameState.jetpack`), drained by `JET_DRAIN` while airborne-and-holding-jump (lines 102–110), regenerated by `JET_REGEN*dt` on ground (line 137) or a flat `0.1*dt` in a secondary movement mode (line 208). Sprint (line 79: `input.action('sprint') && fz>0` → `WALK_SPEED*SPRINT_MULT`) has **no separate stamina drain** — its only cost is the 1.6× oxygen-drain multiplier inside `Survival.update` (2.1); a player can sprint indefinitely in a breathable atmosphere for free.

**2.10 Adjacent systems worth noting.** `src/gameplay/combat.js` implements a real NMS-Sentinel-analog: "Wardens" with a `wanted` level 0–5, escalating waves (`scout → aegis → lancer → colossus`), a 12s evade timer (`EVADE_TIME`), triggered by sustained mining/killing Wardens (`onMined`) — this is the closest thing to "aggressive Sentinels" in the codebase, but it is entirely decoupled from weather/storms (no frenzy-on-storm coupling) and is a Volume 6 (Combat & AI) topic more than a survival one; it is cited here only because Target Design §4.6 proposes wiring it to storm state.

---

## 3) The gap

| # | Gap | NMS behavior | AllMansSky today | Severity | Effort |
|---|---|---|---|---|---|
| G1 | Hazard protection is one scalar, not 4 channels | Separate Cold/Heat/Toxic/Rad protection meters (or at least independently tracked drains), each with dedicated upgrades/resources | `Survival.update` line 46: `hazard = max(heat,cold,toxic,rad)*storm` into one `gs.energy` | Structural | 1.5 wk |
| G2 | No resource recharge loop for hazard protection | Sodium/Sodium Nitrate (and per-type modules) refill/slow the meter | `gs.energy` only passively regens (`+1.5*dt` when `hazard<0.2`); zero items restore it | Feature | 1 wk |
| G3 | No environment sample function (temperature/toxicity/rad/pressure/O2 by position+time) | Continuous field a suit/HUD reads anywhere, any time | Hazard is a fixed scalar baked once at `rollPlanetDef` time (`biomes.js` 466–474); only `isNight` varies at runtime | Structural | 2 wk |
| G4 | Weather is a perpetual ambient sine wave, never a discrete event | Calm baseline + periodic telegraphed "Extreme Weather Incoming" storms with start/peak/end and cooldown | `WeatherSystem.intensity = sin(t/cyclePeriod*2π)*1.4+0.35`, endless, no telegraph, no discrete states (`weather.js` 120–125) | Feature | 1.5 wk |
| G5 | No storm crystals | Harvestable lit formations spawn during extreme weather as a risk/reward hook | Absent entirely — no spawn logic, no item | Feature | 1 wk |
| G6 | No sentinel/Warden frenzy coupling to storms | Some worlds pair extreme weather with heightened Sentinel aggression | `combat.js` `wanted` level driven only by mining/kills; `weather.intensity` never read by combat | Feature | 0.5 wk |
| G7 | No shelter/cave detection | Indoors (caves, bases, ship husks) hazard drain ≈ 0 | No `shelter`/`cave` concept anywhere in `src/`; hazard drains identically indoors or out (bases have no hazard-canceling volume check) | Structural | 1.5 wk |
| G8 | Day–night swing is a crude multiplier, not a real curve | Smooth diurnal temperature curve driving hazard continuously | Binary `isNight` flips `heat→0` / `cold*0.5→max(cold,0.15)` instantly at `sunElev<-0.08` (`surfacestate.js` 287) | Cosmetic/Feature | 0.5 wk |
| G9 | No per-biome weather *profile* variety within a biome | Multiple plausible weather types per biome, extreme-weather archetype named per biome (firestorm/blizzard/toxic downpour/radstorm/sandstorm) | One `weather` string rolled once from `weatherSet` per planet (`biomes.js` 474); no firestorm/blizzard/radstorm kinds exist, only the 6 `KIND_CONF` entries in `weather.js` | Feature | 1 wk |
| G10 | No underwater-specific survival differentiation | Distinct breath meter, depth is not just cosmetic in some contexts, Fishmouth-style upgrades | `ctx.submerged` just zeroes `breathable` inside the same O2 formula (`survival.js` 26); `underwater.js`'s `d01` depth term is visual-only | Feature | 0.5 wk |
| G11 | No stamina meter | Jetpack fuel *and* an implicit "you can't sprint forever without cost" (folded into life support in NMS) | Sprint is functionally free besides a 1.6× O2 multiplier (`survival.js` 28); no separate meter | Cosmetic | 0.5 wk |
| G12 | Death has zero consequence | Grave marker with recoverable items/currency; mode-gated severity | `main.js` `_onDeath()` lines 184–189 fully restores every vital, no inventory/currency loss, no grave | Structural | 1 wk |
| G13 | No game-mode system at all | Creative/Normal/Survival/Relaxed/Permadeath presets, chosen at new-game | No mode field in `GameState`; `screens.js` `buildSeed`/`buildSlotPick` never asks | Structural | 1.5 wk |
| G14 | No Permadeath (save deletion on death) | One life; death ends/deletes the save | `_onDeath()` always respawns; `GameState.clearSave` exists but is never called from death | Structural | 0.5 wk |
| G15 | No Custom difficulty slider matrix | Independent sliders: survival drain, damage taken/given, resource scarcity, economy, crafting cost, fishing/fetch yield, death severity | `screens.js` `settings()` has exactly 3 unrelated sliders (volume/sensitivity/bloom); no difficulty UI | Structural | 2 wk |
| G16 | No difficulty config plumbed into drain formulas | Every drain/rate reads live from the mode/slider config | All constants in `survival.js` (`O2_DRAIN`, the `2.4`/`5`/`1.5`/`6` multipliers) are hardcoded module-level literals | Structural | 1 wk (bundled with G13/G15) |
| G17 | Hazardous flora / predator fauna hazard contribution | Touch/proximity damage from hostile flora; hunting predators add to survival pressure | Not covered by `survival.js`; predators are a Volume 5 (Fauna/AI) topic, not wired to hazard meters here | Feature | (tracked in Vol. 5; noted for completeness) |
| G18 | No "OXYGEN LOW"-style warning for hazard protection specifically | Clear UI telegraph per hazard channel | `survival.js` `_warnGate('energy',14)` gives one generic "SUIT POWER LOW" message, not channel-specific | Cosmetic | bundled with G1 |

---

## 4) Target design

### 4.1 Unified environment model

Replace the "bake hazard once per planet" model with a **sampled environment function** callable anywhere, anytime, taking position and world-time, returning a full physical vector. This is the load-bearing primitive everything else in this volume reads from.

```js
// src/gameplay/environment.js
// EnvSample: { tempC, toxicity01, radiation01, pressureAtm, o2Frac, stormPhase, sheltered }

/**
 * Sample the local environment at a world position and time.
 * Deterministic given (planetDef, x,z,t) — safe to call from anywhere
 * (survival tick, HUD, scanner, scripted events) without side effects.
 */
export function sampleEnvironment(planetDef, worldField, x, z, t, stormState) {
  const def = planetDef;
  const alt = worldField ? worldField.height(x, z) : 0;

  // -- temperature: diurnal sine + altitude lapse + biome baseline --
  const dayPhase = (t / def.dayLength) % 1;                 // 0..1
  const diurnal = Math.sin(dayPhase * Math.PI * 2 - Math.PI / 2); // -1 night .. +1 noon
  const baseC = def.climate.tempC0;                          // biome-rolled baseline °C
  const swingC = def.climate.diurnalRangeC;                  // per-planet swing amplitude
  const lapseC = -alt * 0.0065;                               // -6.5°C/km, standard lapse
  const tempC = baseC + diurnal * swingC * 0.5 + lapseC;

  // -- toxicity / radiation: biome baseline + storm multiplier + noise texture --
  const noise = fbmNoise2D(x * 0.004, z * 0.004, def.seed);   // 0..1, cheap 3-octave value noise
  const stormMul = 1 + stormState.intensity01 * stormState.hazardMul;
  const toxicity01 = clamp01(def.hazard.toxic * (0.7 + 0.6 * noise) * stormMul);
  const radiation01 = clamp01(def.hazard.rad * (0.7 + 0.6 * noise) * stormMul);

  // -- pressure: sea-level atm scaled by atmosphere density, altitude-fallen --
  const pressureAtm = def.atmosphere.density * Math.exp(-alt / 8500);

  // -- breathable O2 fraction (feeds Survival's O2 drain, replaces the old inline calc) --
  const o2Frac = Math.min(1, pressureAtm * 1.6) * (toxicity01 > 0.6 ? 0.3 : 1);

  return { tempC, toxicity01, radiation01, pressureAtm, o2Frac, stormPhase: stormState.phase };
}
```

This subsumes the old `breathable` inline calc and the `heat/cold/toxic/rad` max in `survival.js`, and gives every consumer (HUD gauges, scanner overlay, weather VFX, storm-crystal spawner) one source of truth instead of each recomputing its own approximation.

### 4.2 Four-channel hazard protection

Split `gs.energy` into a `hazardProtection` record with four independently-drained meters, each recharged by its own resource sink (mirrors NMS's Sodium-for-general / module-for-specific pattern, reusing AllMansSky's existing element roster rather than inventing new items):

```js
// GameState addition
this.hazardProtection = { cold: 100, heat: 100, toxic: 100, rad: 100 };
this.hazardProtectionMax = { cold: 100, heat: 100, toxic: 100, rad: 100 };

// resource → channel recharge map (reuses existing ITEMS; see items.js)
const HAZARD_RECHARGE = {
  cold: { item: 'cryostal', restore: 30 },   // ice that "refuses every sun" — thematically cold-tech
  heat: { item: 'solanite', restore: 30 },   // compressed stellar ember
  toxic: { item: 'carbyne', restore: 30 },   // living lattice, organic filter media
  rad:  { item: 'voidsalt', restore: 30 },   // folded-space precipitate, rad-shielding fluff
};
```

```js
// Survival.update, per-channel version (replaces the single `hazard` block)
for (const ch of ['cold', 'heat', 'toxic', 'rad']) {
  const level01 = env[ch === 'cold' ? 'coldSeverity' : ch === 'heat' ? 'heatSeverity'
                : ch === 'toxic' ? 'toxicity01' : 'radiation01'];
  if (ctx.sheltered) continue;                        // §4.5 — indoors bypasses drain entirely
  if (level01 > cfg.hazardThreshold) {
    const drain = level01 * cfg.hazardDrainRate[ch] * dt;   // cfg from DifficultyConfig, §4.7
    gs.hazardProtection[ch] = Math.max(0, gs.hazardProtection[ch] - drain);
    if (gs.hazardProtection[ch] <= 0) this._damageOverTime(level01 * cfg.hazardDamageRate * dt, ch);
    else if (gs.hazardProtection[ch] < 25) this._warnChannel(ch);
  } else {
    gs.hazardProtection[ch] = Math.min(gs.hazardProtectionMax[ch], gs.hazardProtection[ch] + cfg.hazardPassiveRegen * dt);
  }
}
```

Manual recharge (mirrors the existing `oxylite` pattern in `inventoryui.js` line 642, generalized):

```js
function useHazardItem(gs, channel) {
  const { item, restore } = HAZARD_RECHARGE[channel];
  if (!gs.removeItem(item, 1)) return false;
  gs.hazardProtection[channel] = Math.min(gs.hazardProtectionMax[channel], gs.hazardProtection[channel] + restore);
  events.emit('notify', { text: `${ITEMS[item].name.toUpperCase()} USED — ${channel.toUpperCase()} PROTECTION +${restore}`, tone: 'good' });
  return true;
}
```

### 4.3 Life support (oxygen) unchanged in spirit, generalized in code

Keep `gs.oxygen` as the life-support/breath meter exactly as today conceptually, but route its input through `sampleEnvironment().o2Frac` instead of the inline formula, and unify the underwater "drowning" case as a *distinct* rate rather than a side effect of `breathable=0`:

```js
const inWater = ctx.submerged;
const o2Rate = inWater
  ? cfg.drowningRate * (ctx.sprinting ? 1.3 : 1)                 // §4.6, faster & upgrade-able separately
  : O2_DRAIN * (1 - env.o2Frac) * (ctx.sprinting ? 1.6 : 1);
```

### 4.4 Storm event state machine

Promote weather from "ambient sine wave" to a discrete finite-state machine layered on top of the existing `WeatherSystem.intensity` cycle (kept for cosmetic baseline weather), owned by a new `StormDirector`:

```
States: CALM → BUILDING → TELEGRAPH → PEAK → WANING → COOLDOWN → (CALM)

CALM      : baseline WeatherSystem VFX only; stormHazardMul = 1
BUILDING  : intensity ramps 0→0.6 over 8-20s (seeded), no hazard mul yet
TELEGRAPH : emit 'notify' "EXTREME WEATHER INCOMING" + HUD klaxon icon; 4-8s warning window
PEAK      : hazard multiplier 2.5-4x (per DifficultyConfig.stormHazardMul), storm-kind VFX
            intensifies (KIND_CONF particle count *1.6, sway *1.4); storm-crystal spawn
            roll every 6-10s (§4.5); frenzy roll for combat (§4.6); duration 30-90s (seeded)
WANING    : hazard multiplier eases back to 1 over 10-20s
COOLDOWN  : guaranteed CALM for 90-240s (seeded) before another BUILDING can trigger
```

```js
// src/gameplay/stormdirector.js
export class StormDirector {
  constructor(planetDef, seed) {
    this.state = 'CALM';
    this.t = 0;
    this.rng = new RNG(hash32(seed, 0x57ea));
    this._next = this.rng.range(90, 300);           // seconds until first BUILDING roll
    this.intensity01 = 0;
    this.hazardMul = 1;
    this.eligible = ['rain', 'toxicrain', 'snow', 'sandstorm', 'thunder'].includes(planetDef.weather);
  }
  update(dt, weatherSystem) {
    this.t += dt;
    if (!this.eligible) return;
    switch (this.state) {
      case 'CALM':
        if ((this._next -= dt) <= 0) this._enter('BUILDING');
        break;
      case 'BUILDING':
        this.intensity01 = Math.min(0.6, this.intensity01 + dt / this._dur);
        if (this.intensity01 >= 0.6) this._enter('TELEGRAPH');
        break;
      case 'TELEGRAPH':
        if ((this._timer -= dt) <= 0) this._enter('PEAK');
        break;
      case 'PEAK':
        this.hazardMul = 1 + 3 * Math.min(1, (this._peakT - this._timer) / 2); // quick ramp-in
        this._crystalAcc = (this._crystalAcc ?? 0) + dt;
        if (this._crystalAcc > this.rng.range(6, 10)) { this._crystalAcc = 0; events.emit('storm:crystalSpawn'); }
        if ((this._timer -= dt) <= 0) this._enter('WANING');
        break;
      case 'WANING':
        this.hazardMul = Math.max(1, this.hazardMul - dt * 0.3);
        this.intensity01 = Math.max(0, this.intensity01 - dt / 15);
        if (this.hazardMul <= 1) this._enter('COOLDOWN');
        break;
      case 'COOLDOWN':
        if ((this._next -= dt) <= 0) this._enter('CALM');
        break;
    }
  }
  _enter(next) {
    this.state = next;
    if (next === 'TELEGRAPH') { this._timer = this.rng.range(4, 8); events.emit('notify', { text: 'EXTREME WEATHER INCOMING', tone: 'danger' }); events.emit('audio:play', 'notify'); }
    if (next === 'PEAK') { this._timer = this._peakT = this.rng.range(30, 90); events.emit('storm:peak', { kind: this.weatherKind }); }
    if (next === 'COOLDOWN') { this._next = this.rng.range(90, 240); this.hazardMul = 1; }
    if (next === 'CALM') { this._next = this.rng.range(90, 300); this.intensity01 = 0; }
    if (next === 'BUILDING') this._dur = this.rng.range(8, 20);
  }
}
```

`Survival.update` reads `ctx.storm = weatherSystem.intensity` today (a cosmetic 0..1); it should instead read `ctx.stormHazardMul = stormDirector.hazardMul` for the actual gameplay multiplier, keeping `weatherSystem.intensity` purely visual.

### 4.5 Storm crystals & shelter detection

**Storm crystals**: on `'storm:crystalSpawn'`, pick a point within `[20,60]`m of the player on navigable terrain (reuse `TerrainField.height`), instantiate a lit crystal prop (extend `src/render/props.js`'s existing crystal palette) that despawns with `STORM.state !== 'PEAK'` or after a 4-minute timer, and grants a resource bundle (`crystalDensity`-biased) on mine — same interaction path as existing mineable props, just gated on storm state and time-limited.

**Shelter**: rather than true occlusion raycasting (expensive, and the flat-heightfield engine has no interior volumes to raycast against per Volume 3), use a cheap proxy: `sheltered = insideBaseVolume(playerPos, gs.bases) || underOverhang(playerPos, field) || inShip`. `insideBaseVolume` checks player XZ/Y against any placed base's AABB with a roof piece present (bases already track `pieces:[{kind,x,y,z,rotY}]` in `GameState.bases`, `state.js` line 45 — a roof/wall piece census is a cheap lookup). `underOverhang` samples `field.height` at 4 points around the player at increasing radius and flags shelter if a point directly above (from terrain carving/caves, once Volume 3's voxel caves land) occludes the sky; until caves exist, this degrades gracefully to "bases only," which is still a strict improvement over G7's "no shelter exists at all."

### 4.6 Sentinel/Warden frenzy coupling

Minimal, additive hook into the existing `GroundCombat` (`combat.js`) rather than a rewrite: expose `GroundCombat.setFrenzy(active)` that, when `active`, multiplies scout/aegis spawn chance and halves `fireMin/fireMax` cooldowns for the duration; `SurfaceState` calls `combat.setFrenzy(stormDirector.state === 'PEAK' && planetDef.frenzyOnStorm)`, where `frenzyOnStorm` is a new per-planet boolean rolled in `rollPlanetDef` biased by biome (irradiated/toxic biomes more likely, mirroring NMS's correlation between hostile-Sentinel worlds and their storms).

### 4.7 DifficultyConfig schema and mode presets

```js
// src/gameplay/difficulty.js
export const DIFFICULTY_PRESETS = {
  creative: {
    survivalEnabled: false, damageTakenMul: 0, damageGivenMul: 1,
    hazardDrainRate: { cold: 0, heat: 0, toxic: 0, rad: 0 }, o2DrainMul: 0, drowningRate: 0,
    resourceYieldMul: 3, craftCostMul: 0, economyMul: 1, fishingYieldMul: 2,
    stormHazardMul: 1, deathConsequence: 'none', permadeath: false, freeInventorySpace: true,
  },
  normal: {
    survivalEnabled: true, damageTakenMul: 1, damageGivenMul: 1,
    hazardDrainRate: { cold: 2.4, heat: 2.4, toxic: 2.4, rad: 2.4 }, o2DrainMul: 1, drowningRate: 8,
    resourceYieldMul: 1, craftCostMul: 1, economyMul: 1, fishingYieldMul: 1,
    stormHazardMul: 3, deathConsequence: 'drop-partial', permadeath: false, freeInventorySpace: false,
  },
  survival: {
    survivalEnabled: true, damageTakenMul: 1.6, damageGivenMul: 0.85,
    hazardDrainRate: { cold: 4.2, heat: 4.2, toxic: 4.2, rad: 4.2 }, o2DrainMul: 1.8, drowningRate: 14,
    resourceYieldMul: 0.6, craftCostMul: 1.3, economyMul: 0.7, fishingYieldMul: 0.7,
    stormHazardMul: 4, deathConsequence: 'drop-most', permadeath: false, freeInventorySpace: false,
  },
  relaxed: {
    survivalEnabled: true, damageTakenMul: 0.5, damageGivenMul: 1.2,
    hazardDrainRate: { cold: 1.2, heat: 1.2, toxic: 1.2, rad: 1.2 }, o2DrainMul: 0.6, drowningRate: 5,
    resourceYieldMul: 1.5, craftCostMul: 0.7, economyMul: 1.3, fishingYieldMul: 1.3,
    stormHazardMul: 2, deathConsequence: 'drop-none', permadeath: false, freeInventorySpace: false,
  },
  permadeath: {
    ...'normal-derived, see below', permadeath: true, deathConsequence: 'delete-save',
  },
  custom: null, // built from a base preset + slider overrides, see buildCustomConfig()
};

export function buildCustomConfig(baseKey, overrides) {
  return { ...DIFFICULTY_PRESETS[baseKey ?? 'normal'], ...overrides, custom: true };
}
```

`GameState` gains `this.difficulty = { preset: 'normal', config: DIFFICULTY_PRESETS.normal }` (serialized as part of the save, so it survives `save()`/`load()` unchanged via the existing `JSON.stringify(this)` path — no new persistence code needed). Every hardcoded literal currently in `survival.js` (`O2_DRAIN`, `2.4`, `5`, `1.5`, `6`, the `0.2` threshold) becomes a `cfg.*` lookup: `Survival.update(dt, ctx, cfg)` takes the active `gs.difficulty.config` as a third argument (or reads `this.gs.difficulty.config` directly, keeping the existing 2-arg contract for callers that don't care).

### 4.8 Menu & death integration

`Screens.mainMenu()`'s `buildSeed()` step (currently seed-input-only) gains a mode picker before `buildSlotPick`:

```js
const buildMode = (seed) => {
  menu.textContent = '';
  for (const key of ['normal', 'survival', 'relaxed', 'permadeath', 'creative', 'custom']) {
    this._button(menu, MODE_LABEL[key], () => key === 'custom' ? buildCustomSliders(seed) : buildSlotPick(seed, DIFFICULTY_PRESETS[key]));
  }
  this._button(menu, 'Back', () => buildSeed());
};
// buildCustomSliders(seed): reuses the existing slider() helper from settings()
// for each DifficultyConfig field, then calls buildSlotPick(seed, buildCustomConfig('normal', picked))
```

`_onDeath()` in `main.js` branches on `gs.difficulty.config.deathConsequence`:

```js
async _onDeath() {
  ...
  const cfg = gs.difficulty.config;
  if (cfg.permadeath || cfg.deathConsequence === 'delete-save') {
    GameState.clearSave(gs.slot);
    await this.screens.dead?.({ permadeath: true });   // "YOUR VOYAGE ENDS HERE" variant
    return this.switchState('mainmenu-boot');            // hard return to title, no respawn
  }
  await this.screens.dead?.();
  if (cfg.deathConsequence !== 'none') dropGrave(gs, cfg.deathConsequence); // §below
  gs.health = gs.healthMax; gs.shield = gs.shieldMax; gs.oxygen = gs.oxygenMax;
  Object.keys(gs.hazardProtection).forEach(k => gs.hazardProtection[k] = gs.hazardProtectionMax[k]);
  ...
}

function dropGrave(gs, severity) {
  const frac = severity === 'drop-most' ? 0.75 : severity === 'drop-partial' ? 0.35 : 0;
  if (frac <= 0) return;
  const dropped = gs.inventory.map(s => ({ id: s.id, qty: Math.round(s.qty * frac) })).filter(s => s.qty > 0);
  dropped.forEach(({ id, qty }) => gs.removeItem(id, qty));
  const lumensLost = Math.round(gs.lumens * frac);
  gs.addLumens(-lumensLost);
  gs.graves = gs.graves ?? [];
  gs.graves.push({ pos: { ...gs.location.pos }, systemId: gs.currentSystemId, items: dropped, lumens: lumensLost, at: Date.now() });
}
```

### 4.9 Module/file plan

| File | Change |
|---|---|
| `src/gameplay/environment.js` | **New.** `sampleEnvironment()` (§4.1), `fbmNoise2D` helper |
| `src/gameplay/difficulty.js` | **New.** `DIFFICULTY_PRESETS`, `buildCustomConfig()` (§4.7) |
| `src/gameplay/stormdirector.js` | **New.** `StormDirector` state machine (§4.4) |
| `src/gameplay/survival.js` | Rewrite `update()` for 4-channel hazard, env-sourced O2, `cfg`-driven rates, distinct `drowningRate` (§4.2–4.3) |
| `src/gameplay/state.js` | Add `hazardProtection`, `hazardProtectionMax`, `difficulty`, `graves` fields |
| `src/gameplay/combat.js` | Add `setFrenzy(active)` (§4.6) |
| `src/render/weather.js` | No structural change; `intensity` stays cosmetic-only, driven by `StormDirector.intensity01` instead of its own sine (thin edit) |
| `src/render/props.js` | Add storm-crystal prop variant (§4.5) |
| `src/universe/biomes.js` | Add `climate.tempC0/diurnalRangeC`, per-biome `weatherKinds:{calm,extreme}` (firestorm/blizzard/toxic-downpour/radstorm/sandstorm naming), `frenzyOnStorm` bias (§4.4, G9) |
| `src/ui/screens.js` | `buildMode()`/`buildCustomSliders()` in `mainMenu()`; `dead()` gains permadeath variant (§4.8) |
| `src/ui/hud.js` | 4-channel hazard gauge cluster replacing single "energy" bar |
| `src/ui/inventoryui.js` | Generalize `_use()` hazard-item branch via `HAZARD_RECHARGE` map (§4.2) |
| `src/gameplay/items.js` | No new items required — existing `cryostal/solanite/carbyne/voidsalt` repurposed as channel recharges |

---

## 5) Phases

1. **Foundation (no visible behavior change):** `environment.js` (`sampleEnvironment`), `difficulty.js` (presets + `GameState.difficulty` field, defaulted to `normal` so existing saves load unaffected), wire `Survival.update` to accept `cfg` with fallback to today's hardcoded literals when `cfg` is absent (keeps the 2-arg contract alive for any caller not yet updated).
2. **Four-channel hazard protection:** split `gs.energy` → `gs.hazardProtection{cold,heat,toxic,rad}`, `HAZARD_RECHARGE` map, HUD gauge cluster, per-channel warning gate.
3. **Storm state machine:** `StormDirector`, wire `Survival.update`'s `stormHazardMul` to it instead of raw `weather.intensity`; keep `WeatherSystem.intensity` cosmetic; add TELEGRAPH notification.
4. **Storm crystals + shelter:** crystal prop + spawn/despawn on `storm:crystalSpawn`/state exit; `insideBaseVolume`/`underOverhang` shelter proxy wired into the hazard drain gate.
5. **Sentinel frenzy hook:** `GroundCombat.setFrenzy`, `frenzyOnStorm` biome bias, `SurfaceState` wiring.
6. **Death consequences + graves:** `dropGrave()`, `gs.graves`, grave recovery interaction (walk to grave → reclaim), permadeath branch (`GameState.clearSave` + title-return).
7. **Menu/mode UI:** `buildMode()` + `buildCustomSliders()` in `screens.js`, mode badge in HUD/pause screen.
8. **Biome weather-profile expansion:** per-biome `weatherKinds.extreme` naming (firestorm/blizzard/etc.), diurnal temperature curve (`climate.tempC0/diurnalRangeC`) replacing the binary `isNight` swing.
9. **Underwater differentiation:** distinct `drowningRate` in `cfg`, optional Fishmouth-analog upgrade slot.
10. **Headless test pass:** acceptance criteria below, automated via existing Playwright harness.

---

## 6) Effort & risk (engineer-weeks)

| Phase | Work | Weeks | Risk |
|---|---|---|---|
| 1 | Environment sampler + difficulty scaffolding | 1.5 | Low — additive, no behavior change |
| 2 | Four-channel hazard protection | 1.5 | Medium — HUD real-estate, balancing 4 drains vs. 1 |
| 3 | Storm state machine | 1.5 | Medium — tuning BUILDING/PEAK/COOLDOWN durations for "feels eventful, not spammy" |
| 4 | Storm crystals + shelter proxy | 1.5 | Medium — shelter proxy is a heuristic without real occlusion (caves depend on Volume 3 voxel terrain); may false-negative under legitimate overhangs until then |
| 5 | Sentinel frenzy hook | 0.5 | Low — thin `combat.js` addition |
| 6 | Death consequences + graves | 1.5 | Medium — grave persistence across sessions, recovery UX, permadeath save-delete must be unmistakably confirmed (no accidental data loss) |
| 7 | Menu/mode UI | 2 | Low-Medium — mostly `screens.js` pattern reuse, but custom-slider UI needs real design pass |
| 8 | Biome weather profiles + diurnal curve | 1 | Low |
| 9 | Underwater differentiation | 0.5 | Low |
| 10 | Headless acceptance tests | 1 | Low |
| **Total** | | **~12.5 wk** | — |

**Key risks:** (a) True shelter detection is capped by the engine's flat-heightfield terrain (Volume 3) — real caves don't exist yet, so §4.5's shelter proxy is a stopgap that will need revisiting once voxel caves land; (b) balancing 4 independent hazard channels against the current single-scalar difficulty curve risks a "too easy" or "too grindy" regression — needs playtesting, not just formula porting; (c) permadeath's save-delete must be race-safe against the existing 3-slot `localStorage` save system (`state.js` `SLOT_KEY`) — deleting mid-write could corrupt an unrelated slot if not carefully scoped to `gs.slot` only.

---

## 7) Acceptance criteria

All headlessly verifiable via the existing Playwright + SwiftShader harness, asserting on `GameState` fields and emitted `events` rather than pixels:

1. **Cold-night thermal drain:** spawn on a `frozen`-biome planet, force `ctx.isNight = true` for 60 simulated seconds with the player unsheltered → `gs.hazardProtection.cold` strictly decreases each tick and reaches `<25` before 60s elapses (asserts G1/G3/G8 are wired, not just present).
2. **Shelter halts drain:** repeat test 1 but with the player inside a placed base volume with a roof piece (`insideBaseVolume` returns `true`) → `gs.hazardProtection.cold` does not decrease over the same 60s window (asserts G7).
3. **Resource recharge:** with `gs.hazardProtection.toxic = 10`, call `useHazardItem(gs, 'toxic')` while holding 1 `carbyne` → `gs.hazardProtection.toxic` increases by exactly the configured `restore` amount and `carbyne` count decrements by 1 (asserts G2).
4. **Storm telegraph → peak → cooldown cycle:** advance a `StormDirector` on a `sandstorm`-eligible planet for its full seeded `BUILDING+TELEGRAPH+PEAK+WANING+COOLDOWN` duration → assert the emitted event sequence is exactly `['storm:building'(impl.), 'notify'(EXTREME WEATHER INCOMING), 'storm:peak', ...'storm:crystalSpawn' at least once during PEAK..., ] ` and that `hazardMul` returns to exactly `1` after WANING (asserts G4).
5. **Storm crystal spawns only during PEAK:** assert `storm:crystalSpawn` never fires while `stormDirector.state !== 'PEAK'` across a full multi-cycle simulated run (asserts G5).
6. **Frenzy coupling:** on a `frenzyOnStorm:true` planet, assert `GroundCombat._frenzy === true` exactly during `StormDirector.state === 'PEAK'` and `false` otherwise (asserts G6).
7. **Permadeath deletes the save:** create a save in slot 2 with `difficulty.config.permadeath = true`, drive `gs.health` to 0 → assert `GameState.hasSave(2) === false` immediately after `player:death` resolves, and that the app transitions to the title screen rather than respawning (asserts G12/G14).
8. **Normal-mode death drops a partial grave, no save deletion:** same test with `preset:'normal'` → assert `GameState.hasSave(slot) === true` after death, `gs.graves.length === 1` with `items` totaling ≈35% of pre-death inventory, and `gs.health/oxygen/hazardProtection.*` are fully restored post-respawn (asserts G12 without regressing existing full-restore behavior for Normal).
9. **Creative disables drain entirely:** with `preset:'creative'`, force maximum hazard (`toxicity01=1`, unsheltered, storm PEAK) for 30s → assert all four `gs.hazardProtection` channels and `gs.oxygen` remain unchanged (asserts G13/G16, Creative branch).
10. **Custom slider changes drain rate measurably:** build two `buildCustomConfig('normal', { hazardDrainRate: { cold: 8 } })` vs. default `normal` (`cold: 2.4`) configs, run both through test 1's 10-second window → assert the custom run's `gs.hazardProtection.cold` delta is within 5% of `8/2.4 ≈ 3.33×` the default run's delta (asserts G15/G16 — the slider actually reaches the formula, not just the UI).
11. **Underwater drowning uses a distinct rate:** submerge the player (`ctx.submerged=true`) on an ocean planet and compare `gs.oxygen` depletion rate against the same player in hard vacuum (`def=null`) for an identical 10s window → assert the two rates differ by the `drowningRate` vs. `O2_DRAIN` ratio specified in `cfg`, not identical (asserts G10 — currently they are numerically identical, which this test would fail against today's code).
12. **Diurnal curve is continuous, not binary:** sample `sampleEnvironment` at 24 evenly-spaced `t` values across one `dayLength` on a `frozen` planet → assert `tempC` is monotonically non-increasing then non-decreasing (single trough), never jumps by more than the per-tick max slope (asserts G8 — rules out the old instant `isNight` step function).
