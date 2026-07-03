# Volume 12 — Audio & Generative Music

## Scope and headline verdict

AllMansSky's entire audio layer — every sound effect, every note of the ambient score, the ship engine drone, the discovery fanfare — is synthesized live by two files, `src/audio/audio.js` (458 lines) and `src/audio/music.js` (378 lines), totaling under 900 lines and zero bytes of audio asset. No Man's Sky's audio layer is built on an authored, multi-hundred-track score by 65daysofstatic recombined by a bespoke generative system ("Pulse"), a sampled SFX library covering dozens of weapon/tool/vehicle/UI categories, procedurally *varied but sample-based* creature vocalizations, and a full 3-D positional mix with HRTF panning, distance rolloff, occlusion, and per-environment convolution reverb (station/cave/underwater). These are not two implementations of the same feature at different quality tiers — one is a curated recombination of professionally recorded and composed material, the other is oscillators and filtered noise running through envelopes. That gap is real, it is partly closeable with better synthesis engineering, and it is partly *not* closeable without authored material at all — this volume says explicitly where each applies, credits what the current ~900 lines already do well (a real bus graph, a real generative chord-walk engine, deterministic seeding), and specifies the target system: deepen the synthesis (spatialization, material-aware SFX, creature vocal synthesis, layered adaptive music, mix ducking) while recommending a **hybrid path** — a small authored stem/sample pack, still generatively recombined by the existing engine — as the only credible way to approach NMS's audio quality bar.

---

## 1) What NMS does

**The Pulse generative music engine.** No Man's Sky's soundtrack is not a looping playlist. British post-rock band 65daysofstatic composed hundreds of short, modular musical fragments — stems, loops, one-shots, transition stingers — architected from the outset to be recombined at runtime rather than played linearly. Hello Games' in-house generative system ("Pulse," publicly discussed by the studio and the band around the 2016 launch and expanded through NEXT/Beyond/Origins) selects and layers these fragments based on live game state: current biome mood, whether the player is on foot, in a ship, in space, in a station, or in combat; a rolling "tension" value driven by danger, hostility, and recent events; and macro context like first-discovery moments, cinematic beats (warp, pulse-drive, landing), or menu/idle states. Layers fade in and out on musically-aware boundaries (bar/phrase-locked crossfades, not raw gain ramps) so the result feels composed even though no two players ever hear quite the same arrangement twice. A separate ambient "soundscape" generator runs underneath the music proper — biome-specific drones, textures, and atmosphere beds that persist even when the musical layer thins out, so silence never actually means silence.

**SFX library.** A broad sampled-effects catalogue: distinct weapon/tool report and impact sounds per multitool mode (mining laser, bolt caster, plasma launcher, scatter blaster, geology cannon, etc.) with separate charge/fire/impact/overheat layers; separate ground-combat and space-combat weapon sets; UI sounds for every menu/inventory interaction; mining and scanning stingers (analysis-visor "ping," discovery confirmation chimes tiered by rarity); footsteps that change by surface material (rock, sand, snow, mud, metal deck, foliage, shallow water) and by suit/exosuit state; ship engine, thruster, boost, pulse-drive-charge, and warp-drive sounds, each with distinct spectral character and a submix that reacts to throttle; exocraft (Nomad, Roamer, Colossus, Pilgrim, Minotaur, Nautilon) each with a unique engine timbre, not a reused ship loop; door/terminal/interact stings; and discovery stingers tiered by object type (planet, creature, flora, mineral, point of interest) and rarity.

**Creature vocalizations.** Because creature bodies themselves are procedurally assembled from parametric parts, their calls are procedurally varied too: pitch register, formant/timbre character, and call rhythm are derived from the creature's generated body parameters (size, diet/temperament archetype, body-plan family) and layered onto a bank of source vocal samples, producing calls that plausibly "belong" to a given beast's silhouette — a large quadruped grunts low and slow, a small skittish hopper chirps high and fast — without every individual creature needing a bespoke hand-authored recording.

**Ambience beds.** Each biome carries a continuous ambient bed (wind character, insect/atmosphere texture, biome-flavored drone) layered under the music, and weather states (rain, storms with thunder, sandstorms, blizzards) add their own looping/one-shot layers on top, with intensity tracking the weather system's strength value. Caves get a distinct damp/resonant bed with drip one-shots; underwater sequences apply a heavy lowpass/muffling filter to the whole mix plus bubble/current textures.

**3-D spatial audio.** Positional sound sources are panned and attenuated in 3-D relative to the player/camera, with HRTF-style directional cues, distance-based rolloff, and geometric occlusion (a gunshot around a corner or through a wall reads as duller/quieter than one in the open). Reverb is environment-aware via convolution or algorithmic zones: outdoor opens are near-dry, caves are wet and resonant, stations and ship interiors have their own tight metallic reverb character, and underwater applies its own filtered, diffuse character.

**Dynamic mix.** The mix ducks and re-balances contextually — ambient/music bed drops under combat stingers and important dialogue/UI reads, then recovers; scene transitions (warp, loading, landing) get dedicated musical/SFX stinger treatment rather than an abrupt cut.

**Accessibility.** All vocalized alien/NPC dialogue and important narrative beats are subtitled; damage and threat cues have accompanying visual indicators (screen-edge damage flash, HUD threat markers) so audio-only information isn't required to play safely.

---

## 2) What we have (cite source)

**Bus graph and lifecycle — `src/audio/audio.js`.** `audio.init()` (`audio.js:358-386`) lazily constructs a single `AudioContext` on first user gesture, builds a `DynamicsCompressor` (threshold −16 dB, ratio 5, attack 4 ms, release 280 ms — `audio.js:367-372`) between master and destination, and three fixed sub-buses off a shared master gain: `musicBus` (0.75), `sfxBus` (1.0), `engineBus` (0.8) (`audio.js:375-378`). This is a real, sensible three-bus mix architecture — genuinely a strength, not a placeholder — but the bus gains are static constants set once at init; nothing in the codebase ever writes to `musicBus.gain` or `sfxBus.gain` again after construction, so there is no ducking, no mix automation, and no per-context (combat/menu/cave) mix profile.

**SFX synthesis — the `SFX` table (`audio.js:168-289`).** Twenty-two named one-shot generators (`footstep, click, hover, confirm, deny, scan, scanDone, mine, mineHit, collect, craft, laser, boltHit, explosion, hurt, jetpack, land, takeoff, warp, dock, notify, discovery, death`), each a short function `(t, out) => …` that schedules oscillators (`tone()`, `audio.js:63-99`) and/or filtered noise bursts (`noise()`, `audio.js:102-136`) with hand-tuned envelopes. Two helper primitives — `bellNote()` (`audio.js:139-142`, a sine + quiet 2nd-partial pluck) and `echoTail()` (`audio.js:148-163`, a one-shot self-disconnecting feedback-delay send) — are reused across several entries (`scan`, `scanDone`, `collect`, `craft`, `discovery`, `warp`, `death`) to keep the palette coherent. `audio.sfx(name, opts)` (`audio.js:407-426`) dispatches by name onto `sfxBus`, optionally wrapping in a per-call `GainNode` for `opts.volume` and a `StereoPannerNode` for `opts.pan` — **`opts.pan` exists in the API but is never passed by any of the ~90 call sites in `src/gameplay`, `src/states`, or `src/ui`** (confirmed by exhaustive grep); it is dead capability, not a gap in intent but a gap in wiring, and there is no code anywhere that derives a pan value from world position.

**Continuous engine loop — `ensureEngineLoop()`/`audio.engine()` (`audio.js:295-336, 433-445`).** A lazily-built, always-looping brown-noise bed plus a detuned sawtooth pair (42 Hz / 42.5 Hz+9¢) through a shared lowpass, with a slow LFO wobbling both oscillators' detune for a "living machine" feel. `audio.engine(level0to1)` (`audio.js:433-445`) maps throttle to output gain, filter cutoff, oscillator base frequency, and noise playback rate via `setTargetAtTime` smoothing — a well-engineered single continuous voice. It is called from `src/states/spacestate.js:202` (ship throttle) and reused verbatim for the ground rover in `src/gameplay/rover.js:156` and for the hover-thruster passes in `src/states/surfacestate.js:401,433,457` — **the same timbre serves ship and exocraft**; there is no distinct engine voice per vehicle class.

**Generative music — `src/audio/music.js`.** `MOODS` (`music.js:26-33`) defines six presets (`menu, space, surface, lush, frozen, volcanic`) each with a scale (dorian/pentatonic/phrygian/lydian table, `music.js:13-19`), root frequency, chord-change interval range, oscillator waveform pair, detune spread, lowpass cutoff + LFO depth, sub-drone gain, bell-motif chance/level/octave, and a `pulse` baseline (only `volcanic` has a nonzero built-in tension floor). `BIOME_TO_MOOD` (`music.js:36-42`) maps the game's 11 biomes onto those 6 presets (e.g. `swamp`/`ocean` → `lush`; `toxic`/`irradiated` → `volcanic`; `desert`/`barren` → `surface`). `SceneLayer` (`music.js:53-273`) is one active mood instance: a shared breathing lowpass with its own slow LFO, a pad bus with amplitude-shimmer LFO, a sine sub-drone that glides to each new chord root (`_subFreq`, `music.js:132-135`), and a **danger pulse** — a filtered square oscillator whose gain is driven continuously by `setDanger(d)` (`music.js:248-253`), `d` coming straight from `mood.danger` at the `setScene` call site (e.g. `spacestate.js:101` passes `this.system.pirateThreat`). Chords are chosen by a seeded random walk over scale degrees (`_scheduleChord`, `music.js:147-184`) — deterministic per `RNG(hashString('ams-music:'+key+':'+biome))` (`music.js:57`), so the same scene key + biome always produces the same chord sequence, matching the codebase's broader determinism ethos. A shared `MusicEngine` FX chain (`music.js:282-342`) wraps the dry signal in a long feedback delay (0.46 s, 0.42 feedback, lowpassed repeats) and a 5-tap fake reverb (stereo-panned taps, `music.js:322-338`) — **algorithmic, not convolution-based, and applied only to the music bus**, never to SFX or to any per-environment zone. `setScene(kind, mood)` (`music.js:350-365`) crossfades a new `SceneLayer` in over 3 s while the old one fades out over 3 s (`start()`/`stop()`, `music.js:240-265`); same-mood calls just update `setDanger`. A voice-budget guard (`this._live`, `music.js:124,188,203,215,232-234`) caps concurrent oscillators (drops to 1-osc pads above 10 live voices, refuses new bell voices above 13), documented as "<12 sustained voices" in the file's header comment — genuinely careful engineering for a browser audio thread.

**Event integration — `src/core/events.js`.** The bus documents one audio-relevant event, `'audio:play' (sfxName, opts?)` (`events.js:49`), wired in `src/main.js:158` and `audio.js:458` (`events.on('audio:play', (name, opts) => audio.sfx(name, opts || {}))`). In practice only three call sites actually route through the event bus (`player.js:97,128`, `survival.js:34,73,85`); the remaining ~85 call sites across `gameplay/`, `states/`, and `ui/` import `audio` directly and call `audio.sfx()`/`audio.setScene()`/`audio.engine()` — the documented decoupled pattern exists but is a minority path, not the norm.

**What is entirely absent from both files.** No `PannerNode` or `AudioListener` anywhere in the codebase (confirmed by grep across `src/`) — no automatic positional panning, no distance attenuation, no HRTF. No `ConvolverNode` anywhere — the only reverb is the algorithmic delay/tap network on the music bus. No creature audio of any kind: `src/gameplay/creatures.js` is explicitly documented in its own header as a "pure system: emits no events" and contains zero `audio` imports or calls — every creature in the game is silent. No material variation in `SFX.footstep` (`audio.js:169-175`): it is one brown-noise "regolith crunch" whose only variance is per-call `Math.random()` jitter on filter cutoff and playback rate, called from `player.js:147` with volume scaled by movement speed but never by biome, terrain material, or wet/dry surface state. No weather ambience loop: `src/render/weather.js` imports `audio` solely to fire the `explosion` one-shot on lightning strikes (`weather.js:150`) — there is no continuous wind/rain bed, and weather `intensity` (already computed and exposed by `WeatherSystem`) drives zero audio parameters. No mix ducking anywhere — bus gains are set once and never touched again. No subtitles, captions, or visualized audio-cue system in any `ui/` module.

---

## 3) The gap

| # | Feature | NMS | Ours | Severity | Effort |
|---|---|---|---|---|---|
| 1 | Music source material | Authored stems/loops by 65daysofstatic, hundreds of fragments | 100% live synthesis, zero samples | **Structural** (honestly borderline unclosable at parity without assets — see §6) | Very Large / N/A without hybrid |
| 2 | Adaptive music layering | Discrete stem layers add/remove on musical (bar/phrase) boundaries per tension tier & context | One continuous `SceneLayer` per mood + a single scalar "danger pulse" gain (`music.js:248-253`) — no discrete layers, no phrase-locked transitions | **Structural** | Medium–Large |
| 3 | Mood/biome coverage | Per-region, per-POI, per-activity (combat/menu/cinematic) distinct musical treatments | 6 `MOODS` presets mapped from 11 biomes via `BIOME_TO_MOOD` (`music.js:26-42`) — solid foundation, coarse granularity | Feature | Medium |
| 4 | Ambient "soundscape" generator (separate from music) | Persistent biome atmosphere bed independent of musical layer | Absent — ambience is only the music pad itself; no separate atmosphere layer | Structural | Medium |
| 5 | SFX library breadth | Dozens of weapon/tool/vehicle/UI categories, sampled | 22 synthesized one-shots covering a comparable *event* list but each event has exactly one timbre variant | Feature | Medium–Large |
| 6 | Footsteps: surface-material aware | Distinct sample per material (rock/sand/snow/mud/metal/foliage/water) | One generic brown-noise crunch, `Math.random()` jitter only (`audio.js:169-175`) | Feature | Small–Medium |
| 7 | Creature vocalizations | Sample-based calls, procedurally varied by body parameters | **Absent entirely** — `creatures.js` fires zero audio (confirmed: "emits no events") | **Structural** | Large |
| 8 | Positional 3-D panning | HRTF `PannerNode` per source, listener bound to camera | Dead `opts.pan` parameter on `audio.sfx()` (`audio.js:413-422`); zero call sites use it; no `PannerNode`/`AudioListener` anywhere | Structural | Medium |
| 9 | Distance attenuation / rolloff | Native to `PannerNode` distance model | Absent — every SFX plays at fixed loudness regardless of emitter distance | Structural | Small (bundled with #8) |
| 10 | Occlusion (line-of-sight muffling) | Geometry-aware lowpass/attenuation behind cover | Absent | Structural | Large (even approximate raycast version is nontrivial) |
| 11 | Environment reverb zones (cave/station/underwater) | Convolution or algorithmic zone reverb, source-aware | One global algorithmic reverb on the *music* bus only (`music.js:314-338`); SFX and engine buses are always dry | Structural | Medium–Large |
| 12 | Underwater muffling | Full-mix lowpass + bubble/current texture when submerged | Absent — no submersion-state audio hook exists | Feature | Small |
| 13 | Weather ambience (wind/rain/storm loop) | Continuous bed scaled to weather intensity | Only a single `explosion` one-shot on thunder strikes (`weather.js:150`); `WeatherSystem.intensity` drives zero audio | Feature | Small–Medium |
| 14 | Ship engine/thruster/boost/pulse/warp differentiation | Distinct spectral character per propulsion mode | One continuous engine voice (`ensureEngineLoop`) plus one-shot `takeoff`/`warp`/`dock`; no distinct boost or pulse-drive-charge layer | Cosmetic/Feature | Small |
| 15 | Exocraft-distinct engine timbre | Each vehicle (Nomad/Roamer/Colossus/Nautilon…) has its own engine voice | Rover reuses the identical ship `audio.engine()` loop (`rover.js:156`) | Feature | Small |
| 16 | Dynamic mix ducking | Music/ambience ducks under combat/dialogue, recovers | Bus gains (`musicBus 0.75, sfxBus 1.0, engineBus 0.8`) set once at `init()` (`audio.js:375-378`) and never touched again | Feature | Medium |
| 17 | Discovery/rarity-tiered stingers | Multiple fanfare tiers by object type & rarity | Single `discovery` arpeggio + separate `notify`/`confirm`/`scanDone` — no rarity tiering | Feature | Small |
| 18 | Bus architecture / master compression | Deep mix-bus + snapshot system | 3-bus + compressor, reasonable and *already working* (`audio.js:367-378`) | Cosmetic (strength) | — |
| 19 | Determinism of generative content | Seeded, reproducible per scene | Already seeded (`RNG(hashString(...))`, `music.js:57`) — genuine strength, worth preserving in every extension | Cosmetic (strength) | — |
| 20 | Event-bus decoupling for gameplay→audio | (N/A — internal architecture only) | Documented pattern (`events.js:49`) used by only 3 of ~90 call sites; direct-import is the de facto norm | Cosmetic | Small (doc/consistency cleanup) |
| 21 | Accessibility: subtitles / visualized audio cues | Full dialogue subtitling, HUD threat/damage cue redundancy | Absent | Feature | Medium |

**Read on severity.** Two rows are tagged Structural-and-effectively-unclosable (#1, #7 leaning Large-not-Impossible) — these are the ones this volume is most honest about: matching 65daysofstatic's authored score or NMS's sample-based creature vocal bank with *zero* assets is not a synthesis-quality problem, it's a content-source problem. Everything else — spatialization (#8–12), material-aware SFX (#5–6), mix ducking (#16), layered adaptive tension (#2) — is squarely inside what WebAudio's native node graph (`PannerNode`, `ConvolverNode`, `AudioListener`, automated `GainNode`s) can deliver with zero new assets and disciplined engineering. The two strengths (#18, #19) are worth stating plainly: the bus graph and the deterministic-seed generative-chord engine are not toy code, they are a legitimate foundation the target design extends rather than replaces.

---

## 4) Target design

### 4.1 Spatial / reverb routing graph

Every emitting source (one-shot SFX, creature voice, continuous engine loop) gets its own `PannerNode`; the listener tracks the active `THREE.Camera` every frame. Reverb becomes source-routable and environment-selectable instead of a single always-on music-bus effect.

```
AudioListener  ← updated every frame from camera.matrixWorld (position + forward + up)

[SFX one-shot]───┐
[creature voice]─┼─▶ PannerNode (HRTF, distance model) ─┬─▶ dry send ──▶ sfxBus ─┐
[engine loop]─────┘   (position set at trigger / per-frame)  └─▶ wet send ──▶ ZoneConvolver[zone] ─┘
                                                                                  │
[music SceneLayer] ──────────────────────────────▶ musicBus (unpanned, always-on FX chain, unchanged) ─┤
                                                                                                          ▼
                                                                                              DuckBus (GainNode, sidechain-style automation)
                                                                                                          ▼
                                                                                              master ──▶ DynamicsCompressor ──▶ destination

ZoneConvolver[zone] ∈ { outdoor: near-dry short IR, cave: long wet resonant IR,
                         station: tight metallic IR, underwater: diffuse IR + mix-wide lowpass }
  — IRs are synthesized once at init (noise burst shaped by an exponential decay
    envelope per zone, rendered into an OfflineAudioContext buffer and fed to
    ConvolverNode.buffer) — this keeps the zero-asset constraint intact; a
    convolution reverb does not require a *recorded* impulse response, only a
    plausible one, and a synthesized decaying-noise IR is a well-known technique.
```

`updateListener(camera)` runs once per render frame from the main loop (alongside existing per-frame calls like `audio.engine(throttle)`); `PannerNode` positions for *moving* emitters (creatures, other ships) update every frame, while short one-shot SFX (footsteps, weapon fire) set position once at trigger time — cheaper, and audibly indistinguishable for sounds under ~300 ms. Zone selection (`outdoor`/`cave`/`station`/`underwater`) is driven by existing state the game already tracks (current `states/*.js` scene, and a new `player.submerged` flag derived from `field.seaY` comparison already computed in `player.js`) — no new detection system required, just a routing switch.

### 4.2 Music-layer state model

Replace the single continuous `SceneLayer` + scalar `danger` pulse with a **discrete layer stack** keyed by tension tier, still generated by the same seeded chord-walk engine (`_scheduleChord`) so the compositional logic in `music.js` is extended, not rewritten:

```
LayerStack (per active mood key):
  tiers = [
    { id: 'bed',    minTension: 0.00, gain: 1.0,  content: 'sub-drone + slow pad (existing SceneLayer)' },
    { id: 'mid',    minTension: 0.20, gain: 0.8,  content: 'add faster arpeggiated pad voice, tighter filter' },
    { id: 'drive',  minTension: 0.45, gain: 0.9,  content: 'add rhythmic pulse (existing pulseOsc, now gated not just loud)' },
    { id: 'tense',  minTension: 0.70, gain: 1.0,  content: 'add dissonant upper drone + faster bell motif retrigger' },
    { id: 'crisis', minTension: 0.90, gain: 1.0,  content: 'add distorted low pulse + arrhythmic sting layer' },
  ]

  setTension(t):                          // t = existing mood.danger, 0..1
    for tier in tiers:
      target = t >= tier.minTension ? tier.gain : 0
      tier.node.gain.setTargetAtTime(target, now, tier.active ? 0.6 : 2.5)
                                           // fast fade-out, slow "musical" fade-in
      if target > 0 and !tier.active: scheduleNextLayerEntry(tier, quantizeToNextChordBoundary())
      tier.active = target > 0

  // layers only ever fade IN at the next chord-change boundary (reuses
  // this._nextT from SceneLayer, music.js:127-129) so entries feel musically
  // timed rather than snapping mid-phrase — this is the single change that
  // buys the most perceived "adaptive-music" quality for the least code.
```

`debugLayerCount()` exposes `tiers.filter(t => t.active).length` for the acceptance-criteria check in §7 (layer count should rise monotonically as `danger` crosses tier thresholds).

### 4.3 Param → creature-vocal synthesis sketch

Creature vocalizations reuse the existing `tone()`/`noise()` primitives plus a small formant filter bank (2–3 stacked bandpass filters approximating a vocal tract), driven entirely by the `profile` object `CreatureSystem` already produces (`profile.size, profile.speed, profile.temperament, profile.diet, profile.bodyType` — `creatures.js:794-801`, no new data needed):

```
function creatureVoice(ctx, out, profile, callType, seed) {
  const rng = new RNG(hashString('voice:' + seed + ':' + callType));

  // 1. base pitch: inverse to size (bigger body → lower resonant cavity)
  const basePitch = clamp(340 / Math.pow(profile.size, 0.65), 60, 1400);

  // 2. formant centers scale with size too (smaller throat → higher formants);
  //    body-type picks a formant "shape" family
  const formantShape = {
    quadruped: [1.0, 2.6, 4.1],   // grunt/bleat
    hopper:    [1.4, 3.2, 5.5],   // high chirp
    hexapod:   [2.0, 4.5, 7.0],   // clicky/insectoid
    serpent:   [0.7, 1.6, 2.4],   // hiss + low tone
    floater:   [0.9, 1.8, 2.2],   // airy pad-like moan
    flyer:     [1.6, 3.6, 6.0],   // glissando chirp
  }[profile.bodyType].map(k => basePitch * k);

  // 3. timbre/roughness from diet+temperament
  const roughness  = profile.diet === 'predator' ? 0.6 : 0.15;      // growl vs clean tone
  const pitchBend  = profile.temperament === 'skittish' ? 1.4 :
                      profile.temperament === 'territorial' ? 0.3 : 0.7;  // Hz/s glide rate
  const callRate   = 2.4 - profile.speed * 0.15;                    // faster critters, faster call bursts

  // 4. source: oscillator (clean species) blended with noise (roughness) per diet
  const src = mix(sawOrSine(basePitch), noiseBurst(), roughness);

  // 5. formant filter bank: 3 bandpass biquads in parallel, Q~4-6, centered
  //    on formantShape, summed — approximates vocal-tract resonance without
  //    needing an actual physical model
  for (f of formantShape) bandpass(src, f, Q=5) -> sum -> ampEnvelope(callType) -> out;

  // callType ('idle'|'alert'|'flee'|'territorial') selects envelope shape +
  // repeat count, reusing tone()/noise() envelope params already in audio.js
}
```

Calls are triggered by `CreatureSystem._think()` state transitions (`creatures.js:181-266` already has the exact hooks: entering `'flee'`, `'circle'`, or on `'idle'`→`'wander'` roll) rather than every frame, keeping voice count bounded the same way `music.js`'s `_live` counter already does. Determinism matches the codebase's existing ethos: same creature `seed` → same `basePitch`/`formantShape` every time, so a given beast always "sounds like itself."

### 4.4 Material-aware footsteps

```
FOOTSTEP_MATERIAL = {
  rock:   { buf: 'brown', f0: [520,720], q: 1.1, tau: 0.02, click: true  },
  sand:   { buf: 'white', f0: [300,500], q: 0.6, tau: 0.05, click: false },
  snow:   { buf: 'white', f0: [900,1400],q: 0.4, tau: 0.06, click: false },
  mud:    { buf: 'brown', f0: [180,300], q: 0.8, tau: 0.09, wet: true   },
  metal:  { buf: 'white', f0: [1800,2600], q: 2.5, tau: 0.015, click: true, ring: 1200 },
  water:  { buf: 'white', f0: [400,900], q: 0.5, tau: 0.04, splash: true },
}
// materialAt(x,z) already resolvable from existing per-vertex biome ramp
// (terrain.js:_colorFor) — extend that lookup to return a material id instead
// of / alongside a color, reusing the same biome-driven data, zero new content.
```

### 4.5 Mix bus & ducking

```
DuckBus wraps musicBus:
  events.on('combat:hit', () => duck(musicBus, -6dB, attack=0.05, hold=0.4, release=1.2))
  events.on('discovery:new', () => duck(sfxBus ambience layer, -3dB, ...))
  duck(bus, db, attack, hold, release):
    g = dbToGain(db)
    bus.gain.setTargetAtTime(g, now, attack)
    setTimeout(() => bus.gain.setTargetAtTime(1, now+hold, release), hold*1000)
```

### 4.6 Module / file plan

| File | Change |
|---|---|
| `src/audio/audio.js` | Add `updateListener(camera)`, per-emitter `PannerNode` wiring in `sfx()`/`engine()`, `ZoneConvolver` bank + synthesized-IR generation at `init()`, `DuckBus` wrapper on `musicBus`/`sfxBus`, expanded `SFX` table (material-keyed footsteps, per-weapon variants), submersion/underwater filter hook |
| `src/audio/music.js` | `SceneLayer` → `LayerStack` (§4.2): discrete tiers replace scalar pulse gain; `debugLayerCount()` for test introspection; keep `MOODS`/`BIOME_TO_MOOD`/chord-walk unchanged |
| `src/audio/creaturevoice.js` **(new)** | `creatureVoice(ctx, out, profile, callType, seed)` per §4.3; small formant-bank helper reused from `tone()`/`noise()` |
| `src/gameplay/creatures.js` | Call `creatureVoice(...)` on state-transition hooks already present in `_think()`; pass creature world position for panning |
| `src/render/terrain.js` | Extend `_colorFor`-adjacent material lookup to expose a material id for footstep mapping (§4.4) |
| `src/render/weather.js` | Drive a new `audio.weatherBed(kind, intensity)` continuous layer from existing `this.intensity` |
| `src/ui/subtitles.js` **(new)** | Minimal caption/cue overlay for accessibility (§4, row 21) |

### 4.7 Hybrid-asset recommendation

Rows #1 and #7 in §3 are the honest exception to "keep everything procedural." A **small, licensed or commissioned authored stem/sample pack** — realistically 20–40 short musical fragments (ambient pads, a handful of rhythmic/tension stems, a few transition stingers; ballpark 5–15 MB compressed as Ogg/Opus) plus a compact creature-vocal sample bank (10–20 source growls/chirps/calls spanning register and roughness, pitch-shifted/formant-filtered at runtime by §4.3's parameters instead of purely synthesized) — recombined by the *exact same* `LayerStack`/chord-walk/creature-voice-parameter machinery already designed above, would close most of the perceptual gap without abandoning the generative architecture. This is not "add a music player": the stems still get selected, layered, crossfaded, and pitch/timbre-varied procedurally — only the raw waveform source changes from `OscillatorNode` to a cached `AudioBufferSourceNode`. Practically: fetch-and-cache via the browser's Cache API (respecting the "no build step" constraint — plain static files, lazy-fetched on first scene of each mood, never blocking `init()`), with pure-synthesis as the permanent fallback path if the fetch fails or the user is offline — so the zero-asset mode keeps working, it just stops being the *only* mode. Sourcing must be either an original commission or a properly licensed royalty-free ambient/foley library; NMS's stems and 65daysofstatic's catalogue are Hello Games' commissioned IP and must not be sampled, referenced audibly, or stylistically cloned closely enough to invite a claim — "hybrid" means "small authored library," not "recreate 65dos."

---

## 5) Phases

| Phase | Deliverable | Depends on |
|---|---|---|
| P1 | Spatialization retrofit: `AudioListener` + `PannerNode` on all existing SFX/engine emitters, wire dead `opts.pan` path to real 3-D position, distance rolloff | None — pure `audio.js` change |
| P2 | Synthesized-IR `ZoneConvolver` bank (outdoor/cave/station/underwater) + zone routing + `DuckBus` mix ducking | P1 (shares routing plumbing) |
| P3 | Expanded SFX table: material-aware footsteps (§4.4), per-weapon-mode variants, rarity-tiered discovery stingers, distinct exocraft engine voice | Independent of P1/P2 |
| P4 | Creature vocal synthesis engine (`creaturevoice.js`, §4.3) wired into `CreatureSystem._think()` state hooks | P1 (needs panner for positioned calls) |
| P5 | `LayerStack` adaptive-tension music model (§4.2) replacing scalar pulse; weather ambience bed (`audio.weatherBed`) | None — isolated to `music.js`/`weather.js` |
| P6 | Accessibility layer: subtitles/caption overlay, HUD audio-cue redundancy | Independent |
| P7 (optional, recommended) | Hybrid authored stem/sample pack: fetch/cache pipeline, `AudioBufferSourceNode` path alongside synthesis fallback (§4.7) | P5 (stems plug into `LayerStack`), P4 (samples plug into `creatureVoice`) |

P1–P3 are independent and can run in parallel; P4 and P5 both build on P1's listener/panner plumbing but not on each other; P6 is fully independent and cheap, worth doing early for genuine accessibility value regardless of audio-fidelity work; P7 is the only phase that breaks the zero-asset constraint and should be scoped and greenlit as a separate decision, not bundled silently into "just shipping better audio."

---

## 6) Effort & risk

| Phase | Engineer-weeks | Key risk |
|---|---|---|
| P1 — Spatialization retrofit | 1.5–2 | `PannerNode` distance model tuning against the game's actual world scale (metres vs. NMS's much larger draw distances) needs playtesting, not just correctness |
| P2 — Reverb zones + ducking | 2–3 | Synthesized-IR quality (a noise-burst-with-decay IR is a good approximation but not a "real" space) may need multiple iterations to sound convincing rather than washy; zone-boundary transitions (walking in/out of a cave mouth) need crossfade smoothing to avoid audible pops |
| P3 — Expanded SFX + material footsteps | 2–3 | Mostly content-authoring-in-code (tuning many `tone()`/`noise()` envelopes) — low technical risk, time-consuming by volume |
| P4 — Creature vocal synthesis | 3–4 | Formant-bank synthesis is a known-hard problem to make sound "alive" rather than "buzzy"; may need 1–2 extra weeks of iteration on the filter bank design before it's convincing; DSP-literate engineer strongly preferred for this phase specifically |
| P5 — Adaptive `LayerStack` music | 2–3 | Musical-boundary quantization (only fading layers in on `_nextT` chord changes) is the subtle part; get it wrong and transitions feel arbitrary rather than "composed" |
| P6 — Accessibility (subtitles/cues) | 1–1.5 | Low technical risk; needs a content pass (writing/tagging cue text) more than engineering |
| P7 — Hybrid stem/sample pack (optional) | 2–3 engineering **+ separate, uncapped composer/licensing cost** | **This is the load-bearing caveat of the whole volume**: engineering effort for the fetch/cache/playback plumbing is modest (2–3 weeks), but it does *not* include commissioning or licensing the actual audio content, which is a different budget line (composer day-rate or library license fee) and a different kind of risk (creative quality, not code correctness) that this report — an engineering parity document — is not positioned to estimate. Treat P7's audio-content cost as external and separately scoped. |

**Total engineering estimate, P1–P6 (pure synthesis path, no assets): ~12–17 engineer-weeks** (roughly 3–4 engineer-months), executable by one DSP-comfortable engineer or split across two with P4 (creature voices) as the specialist track. **P7 adds ~2–3 engineer-weeks of plumbing plus an open-ended, non-engineering content-acquisition cost** and is the only path that meaningfully closes rows #1 and #7 from §3 — everything else in this volume can reach a strong, honest 7–8/10 parity score with pure synthesis; those two rows realistically cap the *synthesis-only* ceiling below what a stem-based system can reach, no matter how much DSP engineering is applied. That ceiling is the single most important sentence in this volume: don't let phase P4's formant-bank cleverness or P5's layer-quantization polish be mistaken for closing the gap that only a composer or a sample library actually closes.

---

## 7) Acceptance criteria

Standard headless CI (jsdom, no real `AudioContext`, no speakers) cannot verify that anything *sounds* correct. The checks below verify the **graph topology and automation behavior** are correct, which is the testable proxy for "the feature exists and reacts to game state" — pair with a `standardized-audio-context` or `web-audio-test-api`-style AudioContext shim in Node, or a small in-browser Playwright smoke test that inspects the real graph via injected debug hooks.

1. **Node-count/topology snapshot.** Expose `audio.debugGraph()` returning `{ musicBus, sfxBus, engineBus, panners: [...], convolvers: [...] }` node references; assert one `PannerNode` exists per currently-active spatialized emitter (SFX in flight, each live creature voice, the engine loop) and that it disappears after the emitter's envelope completes (no leaked nodes across 100 sequential `audio.sfx('mine')` calls — regression guard against the exact class of bug `echoTail`'s `setTimeout` self-disconnect (`audio.js:148-163`) already guards against elsewhere).
2. **PannerNode positions track the camera/emitter.** Drive a fake `THREE.Camera` through two distinct positions across two `updateListener(camera)` calls; assert `AudioListener.positionX/Y/Z` (or the legacy `setPosition` shim) differ between calls by the expected delta. Separately, move a creature's `group.position` between two `update(dt, playerPos)` ticks and assert its `PannerNode.positionX/Y/Z` moved by the same delta — proves positional wiring is live, not a one-time set-and-forget.
3. **Distance attenuation is monotonic.** With a fixed emitter position, sample the effective gain (via `PannerNode`'s distance-model parameters, or a test-only linear-gain fallback) at listener distances 1 m, 10 m, 50 m; assert strictly decreasing.
4. **Music layer count rises with danger.** Call `music.setScene('surface', { biome: 'volcanic', danger: d })` for `d ∈ [0, 0.3, 0.6, 0.95]` and assert `music.debugLayerCount()` (§4.2) is non-decreasing across that sequence, and strictly greater at `d=0.95` than at `d=0`. This is the single most direct automatable check that "adaptive tension layering" (not just a louder pulse) actually exists.
5. **Zone reverb routes correctly.** Assert that a `ConvolverNode` per zone (`outdoor/cave/station/underwater`) exists after `init()`, and that switching `audio.setZone('cave')` reconnects (or re-gains) the wet send graph such that the previously-active zone's convolver wet gain goes to 0 and the new one's goes to its target — inspect via `debugGraph()`, not by listening.
6. **Ducking triggers and recovers.** Emit `events.emit('combat:hit', {...})`; assert `musicBus.gain.value` (or its scheduled target) drops within the expected attack window and returns to its pre-duck value after `hold+release` has elapsed (fake-timer-driven, no real wall-clock wait needed).
7. **SFX/event coverage lint.** A static test iterates every documented gameplay event in `events.js` plus every string literal passed to `audio.sfx(...)` across `src/gameplay`, `src/states`, `src/ui` (already enumerable via the same grep this volume used for §2) and asserts each resolves to a key present in the `SFX` table — catches typo'd or orphaned sound names before they ship silent.
8. **Footstep material determinism.** Call the material-lookup path (§4.4) with fixed `(x,z)` coordinates on a fixed seeded planet for each biome; assert the same `(x,z)` always resolves to the same material id, and that at least 4 of the 6 material presets are reachable across the 11 biomes (guards against a lookup table that accidentally collapses to one default).
9. **Creature vocal determinism.** Instantiate `creatureVoice` parameters (not the live audio nodes — the pure parameter-derivation function) with a fixed `seed` and `profile`; assert `basePitch`/`formantShape`/`roughness` are bit-identical across two calls, and that two different `bodyType` values with otherwise-identical `profile` fields produce different `formantShape` arrays — proves the param→timbre mapping in §4.3 is both deterministic and actually parameter-sensitive, not a constant table indexed by name alone.
10. **Muted state and lifecycle safety.** Assert `audio.setMuted(true)` ramps `master.gain` toward 0 without throwing when called before `init()` (already true today per `_muted` being module-level state, `audio.js:16,375,451-454`) — a regression guard to keep while adding all of the above, since every new subsystem (panners, convolvers, duck bus) must degrade gracefully through the same pre-`init()`-safe pattern the existing code already establishes.

---

**Summary verdict for the parity scorecard:** current state is a genuinely competent, zero-dependency WebAudio synthesis layer (~900 lines, real bus graph, real deterministic generative chords, careful voice budgeting) that is nonetheless thin on exactly the dimensions that make NMS's audio feel expensive: 3-D spatialization, environment-aware reverb, creature life, and — most fundamentally — a hand-composed score. Phases P1–P6 (12–17 engineer-weeks) can honestly reach a strong synthesis-only parity tier; closing the last, most audible gap requires the P7 hybrid path and a content budget this volume deliberately does not attempt to price.
