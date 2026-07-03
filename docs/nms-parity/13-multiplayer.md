# Volume 13 — Multiplayer & Networking

## Scope and headline verdict

This volume scores **0/10** in the Volume 0 scorecard, and it is the one score in the whole report that is not a matter of degree. AllMansSky has no network transport, no session concept, no player identity, no server-side data store, and no code path that ever sends a byte to another human's browser. `grep -riE "WebSocket|RTCPeerConnection|multiplayer|socket\.io|BroadcastChannel"` across all of `src/` returns **zero matches**. `server.mjs` — the only server-side code in the repository — is 100 lines of static file serving with no game logic whatsoever. Every other volume in this report describes a *gap* between a shipped-but-shallow AllMansSky system and its NMS counterpart; this volume describes a system that must be built **entirely from nothing**, on a stack (browser JS, WebGL2, no build step, zero runtime dependencies beyond `three@0.160`) that has no precedent elsewhere in the codebase to extend.

The one structural advantage we start with, and it is significant: **AllMansSky's universe is already 100% deterministic and seed-derived** (`src/universe/galaxy.js`, `src/core/rng.js`). No Man's Sky's multiplayer netcode leans on exactly this property — clients never transmit terrain, star positions, or planet shapes, because every client can regenerate the identical universe from a shared seed. We inherit that advantage for free. What must be built is comparatively narrow: player presence and transforms, edits (terrain digs, base placement), a discovery registry, and a social hub — not a general-purpose world-state replication engine. This volume specifies that build in full.

---

## 1) What NMS does

No Man's Sky shipped single-player-only at launch (2016) and added multiplayer incrementally starting with the **NEXT** update (2018), expanding through **Abyss**, **Origins**, **Next Generation**, **Frontiers**, **Companions**, **Waypoint**, and beyond into a persistent, cross-platform, session-based co-op game layered on top of a fundamentally single-player save model.

**Session/instance model and group sizes.** Players exist in **instances** — a shared simulation bubble scoped to "wherever you currently are" (a planet, a space station, the Space Anomaly, a freighter interior). Within an instance NMS distinguishes a tight **squad** (historically up to 4 players who fully sync — shared HUD markers, can warp together, can build/mine in the same base in real time, see full-fidelity animation and interaction) from a looser **instance/lobby** population (up to roughly 32 players who can co-occupy the same space — visible, nameplated, chattable — without the full squad-level simulation guarantees). This two-tier model is deliberate: full bidirectional physics-grade sync for a handful of close collaborators is tractable; loose presence sync for dozens in a hub like the Anomaly is not the same engineering problem and is treated differently.

**Drop-in/out co-op.** Players join a friend's game (or a public/community session) through in-game menus without either party reloading their save from scratch; the joining player's own save/progression stays theirs (NMS is not a shared-world MMO — it is many private universes that players temporarily co-inhabit). Leaving is equally frictionless: a player can warp away, log off, or simply be left behind, and the remaining players' session continues.

**The Space Anomaly as social hub.** The Anomaly is a procedurally-themed capital-ship instance every player can summon (via a Quantum Translator/Anomaly Detector item or teleporter network) that historically holds the highest concurrent player counts of any location. Inside it:
- **Presence** — every player who has warped in appears as a fully animated, appearance-customized avatar walking the concourse; nameplates identify them.
- **The Nexus mission board** — a rotating slate of procedurally generated multiplayer missions (combat, exploration, mining, hauling) that any player in the instance can accept; other players' in-progress missions can be joined via matchmaking, turning a solo errand into an ad-hoc co-op run with shared objective progress and reward split.
- **Quicksilver Synthesis Companion** — an NPC vendor selling cosmetic and utility items for **Quicksilver**, a currency earned primarily through Nexus missions and expedition milestones — a live-ops-style secondary economy layered on top of the primary in-galaxy trade economy (Volume 9).
- **Appearance & emotes** — character customization (species/suit/helmet cosmetics, some earned via multiplayer-only activities) is visible to other players in real time, and an emote wheel lets players communicate non-verbally (wave, dance, sit, salute) — the primary social expressiveness layer, since dialogue is not voice-acted between players.
- **Matchmaking into others' missions** — the Nexus explicitly supports joining a mission already in progress, not just accepting a fresh one, which requires server-side session/party formation independent of "who is physically standing near me."

**Shared discoveries — a server-backed registry.** Scanning and naming a system, planet, mineral, or piece of flora/fauna does not just update your local save; it is uploaded to a central **Discovery Service**. The first player to discover a given system/planet/species (globally, across all players who have ever played, subject to the boundaries of online mode/game version) gets **first-discoverer credit** — their chosen name is attached to that object for every subsequent player who visits it, and it appears in their personal Discoveries catalogue and (historically) on Hello Games' companion web app. Later visitors see "Discovered by <name>" instead of being offered to name it themselves. This is a genuinely MMO-scale piece of infrastructure bolted onto an otherwise single-player game: it requires a server that can answer "has planet `(galaxy, x, y, z, i)` already been named, and by whom" for a keyspace on the order of 10^18 possible bodies, at low latency, for millions of concurrent players, without ever hosting the planet's actual geometry (which every client still generates locally from the seed).

**Base sharing & visiting.** Players can **download** other players' bases via a base signal booster / uploaded base glyph and have it materialize (respecting local terrain) on a planet in their own save; Hello Games curates and rotates a **Featured Bases** list highlighting exceptional builds, discoverable in-game. Base part counts are capped per base (a limit that has been raised several times via patches and via difficulty-setting toggles — early caps were roughly 400, later raised into the low thousands, with an "unlimited" option on Creative-flavored settings) — this cap exists specifically because NMS bases are ordinary game objects replicated and persisted like anything else, and unbounded part counts blow both save size and multiplayer sync cost. Visiting a friend's base in a live multiplayer session shows their build in real time, including any of *their* placed/animated elements (NPC villagers in settlements, powered lighting, machinery mid-cycle).

**Freighter multiplayer.** A player's owned freighter is an ownership-scoped instance; friends who warp into the same system can be **invited aboard**, walk its interior, and interact with its rooms (fabricators, farming rooms) — while frigate expeditions themselves remain a per-save (not shared-progress) meta-loop layered on top.

**PvP toggle & combat.** A player-controlled **stance** (historically labeled Passive/Aggressive, later folded into per-mode and per-zone rules) governs whether ship and multitool damage lands on other players. Certain locations — the Anomaly, a player's own claimed base, and most of normal/exploration-mode space — are effectively non-PvP safe zones regardless of stance; specific modes and later structured content (expedition-tied PvP arenas) carve out explicit combat zones. This is a **social safety feature** as much as a mechanic: it lets NMS support open-world co-op without every encounter risking griefing.

**Voice: proximity chat.** In-game proximity voice chat is supported (opt-in, typically push-to-talk), attenuated by in-world distance so a conversation on the Anomaly concourse doesn't broadcast to the whole instance — layered alongside (not replacing) each platform's native party/voice chat.

**Cross-platform play.** NMS supports crossplay across PC (Steam, GOG, Microsoft Store, Epic), PlayStation, Xbox, Nintendo Switch (initially via a cloud-streaming release), and its VR mode — all in the same session, with unified friend-finding and matchmaking that is understood to run through Hello Games' own backend layered *on top of* each platform's native networking/identity SDK rather than relying on any single platform's first-party multiplayer stack. This is widely regarded as one of the more impressive infrastructure feats from a small independent studio: five-plus first-party platform ecosystems, each with their own certification, voice, and friends-list requirements, unified into one player-visible experience.

**Netcode model.** Hello Games has not published a full technical breakdown, but the observable behavior and their public commentary point to a **peer/relay hybrid** rather than dedicated per-instance authoritative game servers running the full simulation: because the world itself is procedurally regenerated identically on every client from a shared seed (exactly the same trick this codebase already has), the network only needs to carry *player* state — transforms, animation state, tool/weapon events, inventory-relevant interactions, chat/voice, and edits (terrain changes, placed base parts) — which is a much smaller payload than a traditional multiplayer FPS/MMO that must stream world geometry. Presence, session/instance formation, matchmaking (including "join a stranger's in-progress Nexus mission"), the Discovery Service, Nexus mission generation, and Quicksilver transactions are centrally backed (Hello Games' servers, since these require a single source of truth no client can locally regenerate); moment-to-moment position/animation/interaction sync between the players actually co-located in an instance is understood to be lower-latency peer-to-peer where NAT allows, falling back to relay when it doesn't — the standard shape for a title without dedicated simulation servers at planetary/galactic scale.

**Persistence split.** The core save file remains **local-first per platform** (with platform-level cloud sync — Steam Cloud, PSN, Xbox Live — keeping one player's own progress portable across their own devices); this is why multiplayer in NMS is "many private universes visited together," not a shared authoritative MMO world. What *is* centrally, persistently server-backed regardless of any individual save file: the Discovery registry, friends/social graph, Nexus mission pool and completion state, and Quicksilver balance/purchases — the pieces that are meaningless without a cross-player source of truth.

**Anti-cheat / validation.** NMS is not a hardened anti-cheat title — PC saves have a long, well-documented history of local save editing, inventory duplication glitches, and third-party save editors, and Hello Games' response has generally been patch-and-move-on rather than aggressive server-side save validation, consistent with a design that treats the save as the player's own local property. Server-side validation is understood to be concentrated specifically where a shared/global resource is at stake: Discovery Service writes (can't let a save-edited player globally rename a system twice or claim a discovery with an impossible timestamp), Nexus mission reward grants, Quicksilver transactions, and periodically-patched exploits in those systems (several "impossible reward" and duplication exploits tied to multiplayer/Nexus rewards have been identified and hot-fixed across the game's life). This is a useful, honest data point for us: even NMS does not attempt full server-authoritative anti-cheat over the whole simulation — it protects the narrow slice of state that is shared/global and leaves local-save integrity to the player.

---

## 2) What we have (cite source — this is greenfield)

**`server.mjs` — a static file server, nothing else.** `createServer` (line 40) does exactly three things: (1) answer `GET /version` by regexing the build id out of `src/core/version.js` (lines 44–51); (2) resolve any other path inside `ROOT` with traversal protection (`resolve(join(ROOT, normalize(rel))).startsWith(resolve(ROOT))`, lines 53–57) and stream the file back, gzip-compressing text assets over 1 KB when the client accepts it (`COMPRESSIBLE`, lines 79–86) and issuing `304`s off `If-Modified-Since` (lines 67–72); (3) apply a cache policy that long-caches `vendor/` (pinned three.js) and `no-cache`s everything else so deploys are picked up immediately (`cacheHeader`, lines 35–38). There is no `req.method` branching beyond implicit `GET`, no request body parsing, no in-memory session/player table, no `WebSocket`/`upgrade` handling, no database or file-backed store beyond the static tree itself, and no authentication of any kind. It listens on `process.env.PORT` for Railway/Docker deployment (line 12) and is otherwise indistinguishable from `npx serve`. **This is the entire server-side footprint of the project today.**

**`src/core/events.js` — an in-process pub/sub bus, not a network protocol.** `EventBus` (lines 4–31) is a `Map<string, Set<function>>` with synchronous `emit()` (iterates a snapshot of the handler set, `try/catch`-wraps each handler so one thrower doesn't break the others). It is explicitly documented (lines 35–49) as a fixed catalogue of well-known local events — `state:change`, `player:damage`, `player:death`, `inventory:changed`, `resource:mined`, `discovery:new`, `quest:updated`, `notify`, `ship:landed`/`ship:takeoff`, `warp:begin`/`warp:end`, `combat:hit`, `audio:play`. Every payload is a live JS object/closure reference, never serialized. This bus cannot cross a `postMessage` boundary, a `BroadcastChannel`, or a socket without a wire-format rewrite of every event — it decouples *modules within one tab*, nothing more. It is nonetheless the correct **seam** to hang a network layer off: a `NetSync` module can subscribe to `discovery:new`, `combat:hit`, `ship:landed/takeoff`, `warp:begin/end`, and inventory/state deltas the same way any other UI module does today (see §4.5).

**`src/gameplay/state.js` — a single mutable per-player record with no multi-writer concept.** `GameState` (lines 12–185) holds everything that would need to become either authoritative-shared or replicated in multiplayer:
- `discoveries = { systems: {}, planets: {}, creatures: {}, flora: {}, ruins: {} }` (line 43) — each a `key → {name, at}` dict. `discover(kind, key, name, value)` (lines 98–105) is first-write-wins **only against this one player's own dict** (`if (!book || book[key]) return false`) — there is no shared registry, so two different browsers independently discovering the same seed-derived planet will each believe *they* were first. This is precisely the gap the Discovery Registry service (§4.4) closes.
- `bases = []` (line 45): `{systemId, planetIndex, pieces:[{kind,x,y,z,rotY}]}` — a clean, already-serializable shape (see `src/gameplay/basebuilding.js:22-32` for the piece catalogue), but never leaves the local save; there is no upload/download path, no part-count-driven network cost model, and no "visit someone else's base" concept.
- `digs = {}` (line 46): planet-keyed terrain-edit deltas (see Volume 3) — another already-delta-shaped structure that today never leaves `localStorage`.
- `inventory`, `ship`, `tool`, `health/shield/oxygen/energy`, `location` — the moment-to-moment player state that a co-op session must replicate at interactive rates; none of it currently has a wire format, a tick/sequence number, or any concept of "this field belongs to a specific remote player."
- **Persistence** (`save()`, lines 108–115; `load()`, lines 166–179) is `JSON.stringify(this)` into one of three `localStorage` slots (`SLOT_KEY`, line 8) keyed only by slot number — no player id, no auth, no server round-trip, no conflict resolution if two tabs write the same slot. `GameState.hasSave`/`listSaves`/`latestSlot` are all synchronous `localStorage` scans. This is a **local single-writer key-value store**, the polar opposite of NMS's local-save-plus-server-backed-shared-state split described in §1.

**`src/main.js` — a single client is the sole state authority, full stop.** `Game.bindWorld(gameState)` (lines 117–159) constructs exactly one `Galaxy` from `gameState.galaxySeed` (line 119) — **the client regenerates the entire universe locally**, which is the one piece of NMS-grade infrastructure we already have "for free" (see §2 closing note) — and wires up exactly one `GameState`, one UI stack, one `QuestSystem`. `switchState()` (lines 161–176) drives a single state machine (`SpaceState ⇄ SurfaceState ⇄ HangarState`) with **no concept of a remote peer's state**: no second player entity, no reconciliation step, no network tick separate from the render tick. `_loop()` (lines 287–330) is a plain `requestAnimationFrame` loop calling `this.state.update(dt)` — classic single-player client-authoritative simulation, where "authoritative" is trivially true because there is exactly one authority and it *is* the renderer. There is no server round-trip anywhere in the frame loop, no input buffer meant for replay/reconciliation, and no separation between "simulate" and "present" that a netcode layer could insert itself into without real surgery (see §4 for where that surgery goes).

**Net assessment:** every piece of scaffolding multiplayer needs — transport, session/instance model, player identity, entity replication, a shared registry, presence, a social space, voice, matchmaking, base sharing, anti-cheat boundaries — is **absent in code**, not merely thin. The one asset genuinely worth crediit is architectural, not code-level: the deterministic seed model (`hash32`/`hashString`/`RNG.fork`, `src/core/rng.js:5-65`, consumed by `Galaxy.starsInSector`/`getSystem`, `src/universe/galaxy.js:60-120`) means two clients given the same `galaxySeed` and `starId` will independently generate byte-identical terrain, star systems, and creature roster **without any network traffic**, exactly the property NMS's own netcode leans on. We do not have to invent that advantage; we already have it, and Volume 4/16 document it in more depth. This volume's entire target design (§4) is built around spending that advantage: sync players and edits and discoveries; never sync world geometry.

---

## 3) The gap

| Feature | NMS | Ours | Severity | Effort |
|---|---|---|---|---|
| Network transport | Custom peer/relay hybrid + platform SDKs | **None** — `server.mjs` is HTTP GET-only, no `upgrade`/WebSocket handling | **Structural** | Medium |
| Session/instance model | Squad (≤4 full sync) + instance/lobby (≤32 loose presence) | **None** — single local `GameState`, no session concept at all | **Structural** | Large |
| Player identity/auth | Platform account + friends graph | **None** — no accounts, no player id, `localStorage` slots only | **Structural** | Medium |
| Drop-in/out co-op join flow | In-menu join, no save reload for either party | **None** | **Structural** | Medium |
| Entity replication (transform/anim/tool use) | Continuous, interpolated, per-instance | **None** — `main.js` drives exactly one player entity | **Structural** | Large |
| Deterministic-world advantage | Leaned on (terrain never synced) | **Already have it** (`galaxy.js`, `rng.js`) — an asset, not a gap | — (advantage) | — |
| Social hub (Anomaly analog) | Dedicated instance, avatars, appearance, emotes | **None** — `hangarstate.js` is a solo walkable station scene | **Feature** | Large |
| Nexus mission board / matchmaking into missions | Server-pooled multiplayer missions, join-in-progress | Local-only `MissionBoard`/`boardMissionsFor` (`ui/missionboard.js`, `gameplay/quests.js`) — single-player contracts | **Structural** | Large |
| Quicksilver vendor / secondary currency | Server-tracked currency + cosmetic shop | **None** — one currency (`lumens`), fully local | **Feature** | Medium |
| Appearance customization visible to others | Real-time avatar cosmetics | **None** — no avatar customization system exists at all (any-player) | **Feature** | Medium |
| Emotes | Emote wheel, networked animation | **None** | **Feature** | Small–Medium |
| Discovery registry (server, first-finder credit) | Global DB keyed by planet/species address, first-discoverer name persists for all | `GameState.discover()` is local-only, first-write-wins **against yourself only** (`state.js:98-105`) | **Structural** | Medium |
| Discovery upload/download/visit counts | Central service, browsable catalogue, web companion | **None** | **Structural** | Medium |
| Base upload/download | Signal booster/glyph download, Featured Bases | `gs.bases` never leaves local save (`state.js:45`, `basebuilding.js`) — already serializable, never networked | **Structural** | Medium |
| Base part-count network/limit policy | Tiered caps (hundreds→thousands, "unlimited" option) | No network cost concept; local build has no multiplayer-driven cap at all | **Feature** | Small |
| Freighter multiplayer (invite aboard) | Ownership-scoped shared instance | No freighter object of any kind exists yet (Volume 7 gap) | **Structural** | Large (blocked on Vol. 7) |
| PvP toggle & combat | Stance system + safe-zone rules | No PvP exists — single-player only, `gameplay/combat.js` targets NPCs only | **Structural** | Medium |
| Voice: proximity chat | In-world distance-attenuated voice | **None** — no `getUserMedia`/WebRTC audio anywhere | **Feature** | Medium |
| Text chat | Implicit via voice + platform party text | **None** | **Feature** | Small |
| Cross-platform play | 5+ platforms, unified backend | N/A — browser-only distribution; but any-browser-to-any-browser is trivially "cross-platform" once transport exists | **Structural** | — (byproduct of transport) |
| NAT traversal | STUN/TURN-equivalent, relay fallback | **None** | **Structural** | Medium |
| Snapshot/delta compression | Implied by low-bandwidth-at-scale design | **None** | **Structural** | Medium |
| Anti-cheat / server validation boundary | Narrow: only shared/global writes validated (Discovery, Nexus, Quicksilver) | **None** — no server-side validation exists because no server-side game logic exists | **Structural** | Medium |
| Persistence split (local save + server-backed shared state) | Explicit architecture | Fully local (`localStorage` only, `state.js:108-181`) | **Structural** | Medium |

**Read on severity:** every single row is Structural or Feature-that-depends-on-a-Structural-prerequisite; there are zero Cosmetic or pure-Engine rows, because this domain has no existing implementation to be graphically/architecturally "behind" — it has no implementation. This is the one volume in the report where "Engine" severity (blocked on the spherical-planet rebuild) barely applies: multiplayer as specified here rides on top of the *current* flat-world/state-machine architecture just fine, because it never needs to synchronize terrain geometry at all (§2 closing note, §4.1).

---

## 4) Target design

### 4.1 Guiding principle: sync players and deltas, never sync the world

Because `Galaxy(seed).getSystem(starId)` (`src/universe/galaxy.js:112-120`) is a pure function of `(seed, starId)`, and `TerrainField`/creature/flora placement are themselves seed-derived (Volumes 3, 5), **the wire protocol never needs to carry a single triangle, height sample, or spawn table.** Two clients holding the same `galaxySeed` and the same `starId` already agree on the planet's shape, the star's color, and which creature species live there, with zero bytes exchanged. What must cross the network is exactly the state that is *not* a pure function of the seed:

1. **Ephemeral, high-frequency:** player transforms, animation state, tool/weapon fire events, ship flight state — this is the "entity replication" problem, classic real-time netcode (§4.3).
2. **Persistent, low-frequency, additive:** terrain edits (`gs.digs`/Volume 3's `terrainEdits`), placed base parts, discoveries — these are **append-only deltas against a known deterministic base**, exactly the shape `TerrainField.addDig` and `gs.bases` already have locally (§2). Syncing them is "replicate a small ordered list," not "replicate a world."
3. **Global, server-arbitrated:** first-discoverer credit, Nexus-equivalent mission pool, base directory, presence/session directory — these need one source of truth no client can locally regenerate, i.e., an actual backend service (§4.4, §4.6).

### 4.2 Protocol & transport

**Transport choice: WebSocket, not raw WebRTC DataChannels, for v1.** `server.mjs` already runs `node:http`; a WebSocket relay is the smallest structural addition (`http.Server`'s `upgrade` event, or the `ws` package) and every browser supports it natively with no signaling/ICE complexity. WebRTC DataChannels (lower latency, UDP-like, peer-to-peer) are the correct upgrade for tight ≤4-player "squad" sync once the relay-based v1 is proven (§5 Phase 3) — WebSocket-through-relay for presence/hub/chat/discoveries stays regardless, matching NMS's own split between server-backed shared state and peer-ish player sync.

```
Client  ──WebSocket──▶  Relay/Session Server (extends server.mjs)
  │                            │
  │  JSON control messages     │  routes by instanceId
  │  (join, presence, chat,    │  broadcasts entity snapshots to
  │   discovery, mission)      │  all sockets in the same instance
  │                            │
  └── binary snapshot frames ──┘  (Float32Array-packed transforms,
                                   see §4.3)
```

**Message envelope (JSON control plane):**

```jsonc
// client -> server
{ "t": "join",       "seed": 1337, "instanceId": "system:22:0:6:2", "player": { "name": "Wayfarer-7f2a", "appearance": {...} } }
{ "t": "leave" }
{ "t": "chat",       "text": "warping to the ring nebula" }
{ "t": "discover",   "kind": "planet", "key": "22:0:6:2#3", "name": "Verdant Hollow", "seed": 1337 }
{ "t": "edit",       "kind": "terrainDig", "planetId": "22:0:6:2#3", "prim": {"x":4,"z":-2,"r":2.8,"d":1.05}, "seq": 118 }
{ "t": "base:upload", "base": { "systemId": "...", "planetIndex": 3, "pieces": [...] } }
{ "t": "base:download", "baseId": "b_7f2a91" }
{ "t": "mission:accept", "missionId": "nexus_x91" }
{ "t": "pvp:stance", "value": "passive" | "aggressive" }
{ "t": "emote",      "id": "wave" }

// server -> client
{ "t": "welcome",    "playerId": "p_...", "instanceId": "...", "roster": [ {playerId, name, appearance, pos}, ... ] }
{ "t": "presence",   "join"|"leave", "player": {...} }
{ "t": "chat",       "from": "p_...", "text": "..." }
{ "t": "discover:ack",   "accepted": true, "firstDiscoverer": "Wayfarer-7f2a" }
{ "t": "discover:taken", "firstDiscoverer": "Nomad-1188", "at": 1782384930123 }
{ "t": "edit",       "from": "p_...", "planetId": "...", "prim": {...}, "seq": 118 }
{ "t": "mission:offer",  "missions": [ {id, kind, faction, need, reward, party: [...]} ] }
{ "t": "base:list",  "bases": [ {baseId, owner, systemId, planetIndex, pieceCount, featured}, ... ] }
```

**Binary snapshot plane** (high-frequency, avoids JSON parse/stringify cost and payload bloat): one `Float32Array`-backed frame per tick, packed per-entity as `[playerId16, x,y,z, qx,qy,qz,qw, animState8, toolState8]` (44 bytes/entity), batched per instance and broadcast at a fixed server tick (e.g. 20 Hz) regardless of individual clients' render framerates — this is the same design space as any FPS/co-op title's snapshot layer, nothing NMS-specific, and it is the piece of this volume closest to "well-trodden real-time-multiplayer engineering" rather than anything bespoke to AllMansSky.

### 4.3 Entity replication & client-side interpolation

```js
// src/net/replication.js (new)
class RemotePlayer {
  constructor(id) {
    this.id = id;
    this.buffer = [];         // ring of {t, pos, quat} snapshots, ~200ms window
    this.mesh = buildRemoteAvatar();   // reuses render/creature.js-style procedural rig
  }
  ingest(snapshot, serverT) { this.buffer.push({ t: serverT, ...snapshot }); prune(this.buffer); }
  // render-time interpolation: render `now - INTERP_DELAY` behind the latest
  // snapshot stream, so we're always interpolating between two known points
  // instead of extrapolating past unknown future state (standard snapshot
  // interpolation, e.g. Valve's Source netcode model)
  sampleAt(renderT) {
    const target = renderT - INTERP_DELAY;   // ~100ms
    const [a, b] = bracket(this.buffer, target);
    if (!a) return null;
    if (!b) return a;                        // fall back to latest known (light extrapolation ok <50ms)
    const t = (target - a.t) / (b.t - a.t);
    return { pos: lerpVec3(a.pos, b.pos, t), quat: slerp(a.quat, b.quat, t) };
  }
}
```

Local player input remains fully client-authoritative for feel (no input-delay penalty for the driving player, matching NMS's own "your own ship/character is instantly responsive, other players are interpolated" feel) — this session is **not** attempting lockstep or full server-authoritative physics; it is **presentation-authoritative for others, input-authoritative for self**, with server-side plausibility bounds (§4.6) rather than full server simulation, which is the same trust model this report attributes to NMS in §1 (no full server-side physics, narrow validation on shared/global writes only).

### 4.4 Discovery Registry service

```js
// server/discovery-service.mjs (new) — the one piece of state that MUST be a
// real source of truth, since two clients can independently "discover" the
// same seed-derived body and only one gets to be first.
// Storage: SQLite (zero-ops, file-based, fits Railway/Docker deployment
// already used for server.mjs) keyed by a fully-qualified body id.

// bodyId = `${galaxySeed}:${starId}:${kind}:${localKey}`
// e.g.   "1337:22:0:6:2:planet:3"  or  "1337:22:0:6:2:creature:whisker-4"

CREATE TABLE discoveries (
  body_id      TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,          -- system|planet|creature|flora|ruins
  name         TEXT NOT NULL,
  discoverer   TEXT NOT NULL,          -- player display name (not auth identity, v1)
  discovered_at INTEGER NOT NULL,      -- server-side ms epoch, NOT client-supplied
  visits       INTEGER DEFAULT 0
);

// POST /api/discover  { bodyId, kind, name, playerName }
//   -> INSERT OR IGNORE; the UNIQUE constraint on body_id is the entire
//      "first discoverer" arbitration -- SQLite's atomicity gives us
//      first-write-wins for free, no explicit locking needed.
//   -> return the row that actually landed (yours, or the existing one)
function handleDiscover(req) {
  const { bodyId, kind, name, playerName } = req.body;
  db.run(
    `INSERT INTO discoveries (body_id, kind, name, discoverer, discovered_at, visits)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(body_id) DO UPDATE SET visits = visits + 1`,
    [bodyId, kind, name, playerName, Date.now()]
  );
  return db.get(`SELECT * FROM discoveries WHERE body_id = ?`, [bodyId]);
}
```

Client-side hookup point is `GameState.discover()` (`state.js:98-105`): instead of only writing the local dict, it also fires `events.emit('discovery:new', {kind, name, value})` (already does, line 103) which `src/net/netclient.js` (new) subscribes to and forwards as a `{"t":"discover", ...}` message; the server's ack (`discover:ack` / `discover:taken`) updates the local `book[key]` entry's `name`/`discoverer` fields so a "sniped" discovery correctly displays the actual first-finder's name rather than the local player's own attempted name — a one-line change to `discover()`'s local-write path to accept an authoritative override.

### 4.5 Social hub (Anomaly analog)

New `HubState` (sibling to `SpaceState`/`SurfaceState`/`HangarState` in `src/main.js`'s `switchState`), reusing `HangarState`'s walkable-station scene assets (`src/states/hangarstate.js`) as its shell — same low-poly interior kit, same locomotion — but bound to a *shared* `instanceId` rather than a solo scene. Populated with `RemotePlayer` avatars (§4.3) driven by the snapshot plane, a `MissionBoard`-derived `NexusBoard` UI that additionally requests `{"t":"mission:offer"}` from the server (pooled multiplayer missions, joinable mid-progress via `{"t":"mission:accept","missionId":...,"join":true}`), a `QuicksilverVendor` UI transacting a new `gs.quicksilver` currency field validated server-side (§4.6), and an `EmoteWheel` broadcasting `{"t":"emote"}` events that remote clients play back as one-shot animation clips on the corresponding `RemotePlayer.mesh`.

### 4.6 Server-side validation boundary (anti-cheat)

Mirroring the honest NMS model from §1 (no full server simulation; narrow validation only where shared/global state is at stake):

| Write path | Validated how |
|---|---|
| `discover` | Server-side `Date.now()` timestamp (never trust client-supplied time); `UNIQUE(body_id)` arbitrates first-finder atomically |
| `edit` (terrain/base) | Bounds-check `prim.r`/`prim.d` against server-known max tool radius/depth (mirrors `mining.js`'s existing client-side R=2.8/D=1.05 constants promoted to a server-known allowlist); reject `seq` values that aren't monotonic per-player-per-planet |
| `mission:accept`/complete | Reward grant only fires server-side on a server-tracked mission-progress counter, never on a client-asserted "I finished it" message |
| `quicksilver` balance | Server-authoritative integer column, debited/credited only by server-validated mission/vendor transactions — client never writes the balance directly |
| Player transform snapshots | **Not** hard-validated in v1 (matching NMS's own light touch here) — implausible-speed snapshots are clamped/smoothed client-side on remote peers (a rubber-banding guard) rather than rejected, since over-aggressive movement validation is a common source of false-positive netcode bugs and this is explicitly not a competitive PvP-first title |

### 4.7 Module/file plan

| File | Role |
|---|---|
| `server.mjs` (extend) | Add `upgrade` handling for a `/ws` WebSocket endpoint alongside existing static serving; unaffected static-file code path stays as-is |
| `server/session-server.mjs` (new) | Instance/room registry (`instanceId → Set<socket>`), presence broadcast, chat relay, snapshot-plane batching/broadcast at fixed tick |
| `server/discovery-service.mjs` (new) | SQLite-backed Discovery Registry (§4.4), REST + WS-message dual interface |
| `server/mission-service.mjs` (new) | Nexus-equivalent mission pool generation/persistence, join-in-progress bookkeeping |
| `server/base-directory.mjs` (new) | Base upload/list/download/featured-flag storage (SQLite blob or JSON column of the existing `bases` piece array — already serializable per §2) |
| `src/net/netclient.js` (new) | Owns the WebSocket, (re)connect/backoff, message (de)serialization, subscribes to `events` (`discovery:new`, `combat:hit`, `ship:landed/takeoff`, inventory deltas) to forward outbound, emits new inbound events (`net:presence`, `net:snapshot`, `net:discovery`, `net:chat`) onto the same `events` bus so existing UI modules can consume them the way they already consume everything else |
| `src/net/replication.js` (new) | `RemotePlayer` class + interpolation buffer (§4.3), owns the pool of remote avatar meshes per instance |
| `src/net/snapshot.js` (new) | Binary pack/unpack for the high-frequency transform plane |
| `src/states/hubstate.js` (new) | Anomaly-analog state, reuses `hangarstate.js` shell + `RemotePlayer`s + `NexusBoard`/`QuicksilverVendor`/`EmoteWheel` UI |
| `src/ui/nexusboard.js` (new) | Multiplayer mission UI, sibling to existing `ui/missionboard.js`, backed by `mission-service.mjs` instead of local `quests.js` |
| `src/gameplay/state.js` (extend) | Add `playerId`, `playerName`, `quicksilver`, `pvpStance` fields; `discover()` gains an authoritative-override path (§4.4) |
| `src/gameplay/basebuilding.js` (extend) | Add `uploadBase()`/`downloadBase(baseId)` calling into `netclient.js`, reusing the existing `{kind,x,y,z,rotY}` piece format unchanged |
| `src/gameplay/combat.js` (extend) | PvP stance check gate before applying damage to a `RemotePlayer` entity, safe-zone check (hub/own-base = always non-PvP) |
| `src/audio/voice.js` (new) | WebRTC `getUserMedia` + per-remote-player `RTCPeerConnection` audio-only channel, gain node scaled by in-world distance to that `RemotePlayer` (proximity attenuation) — separate signaling path (via the same `/ws` control plane, SDP/ICE candidates as message types) from the DataChannel-free WebSocket-only v1 data plane |

---

## 5) Phases

| Phase | Deliverable | Depends on |
|---|---|---|
| **1. Relay transport + 2-player presence** | `server.mjs` `/ws` upgrade, `session-server.mjs` instance registry, `netclient.js`, `replication.js`; two browser tabs joining the same `instanceId` see each other's avatar move via snapshot interpolation | none |
| **2. Discovery Registry** | `discovery-service.mjs` (SQLite), `GameState.discover()` hookup, discovery-taken UI feedback | Phase 1 (transport) |
| **3. Terrain edit & base sync (≤4-player squad)** | `edit` message type wired to `TerrainField.addDig`/Volume 3's `EditStore`; `base:upload`/`download` wired to `basebuilding.js`; squad-scoped (small `instanceId`, full sync) | Phase 1, 2 |
| **4. Text chat + emotes** | Chat relay, `EmoteWheel`, remote avatar one-shot animation playback | Phase 1 |
| **5. Social hub (`HubState`)** | Shared instance reusing `hangarstate.js` shell, presence-populated, entry/exit flow from `SpaceState` | Phase 1, 4 |
| **6. Nexus mission board + matchmaking** | `mission-service.mjs`, `NexusBoard` UI, join-in-progress | Phase 5 |
| **7. Quicksilver vendor + appearance/cosmetics** | New currency column (server-authoritative), avatar customization system (net-new — no appearance system exists at all today, single-player or otherwise), vendor UI | Phase 5, 6 |
| **8. Base directory: download others' bases + Featured Bases** | `base-directory.mjs` browsing/search UI, curation flag | Phase 3 |
| **9. PvP toggle & combat** | Stance message, safe-zone gating in `combat.js`, damage application to `RemotePlayer` | Phase 1, 3 |
| **10. Proximity voice chat (WebRTC)** | `audio/voice.js`, SDP/ICE signaling over the existing `/ws` control plane, distance-attenuated gain | Phase 1 (can parallel 2–9) |
| **11. WebRTC DataChannel upgrade for squad-tier sync** | Replace WS snapshot plane with DataChannels for ≤4-player squads (lower latency), keep WS for hub/chat/discovery/mission (matches NMS's own server-backed-vs-peer split, §1) | Phase 3 stable in production |
| **12. Freighter multiplayer (invite aboard)** | **Blocked**: no freighter object exists at all yet (Volume 7 gap) — this phase cannot start until a freighter entity/interior exists single-player-first | Volume 7 freighter work, then Phase 1, 5 |

Phase ordering deliberately front-loads the two capabilities the acceptance criteria (§7) demand — presence/movement sync and discovery sync — before any hub/social/voice work, so the hardest and most novel engineering (a real-time transport layer where today there is none) is proven on the smallest possible surface first.

---

## 6) Effort & risk

| Phase | Engineer-weeks | Primary risk |
|---|---|---|
| 1. Relay transport + presence | 3–4 | First real-time networking code in this codebase; interpolation/jitter tuning is iterative |
| 2. Discovery Registry | 1.5–2 | Low — SQLite `UNIQUE` constraint does the hard arbitration work for free |
| 3. Terrain edit & base sync | 3–4 | Reconciling two players' `EditStore`/`digs` when both edit overlapping terrain near-simultaneously (last-write-wins per §4.2's `seq` field is the v1 answer; true CRDT-style merge is a stretch goal, not required for parity) |
| 4. Chat + emotes | 1 | Low |
| 5. Social hub | 2–3 | Reuses `hangarstate.js` scene, so mostly netcode wiring, not new art/geometry work |
| 6. Nexus mission board | 3–4 | Server-side mission generation/pool design is new game-design surface, not just plumbing |
| 7. Quicksilver + appearance | 4–5 | **Avatar customization does not exist in any form today** — this is a net-new rendering feature (procedural cosmetic variation on the player rig), not just a netcode item; likely the most underestimated line in this table |
| 8. Base directory | 2 | Low — storage/UI problem, format already exists |
| 9. PvP toggle & combat | 2–3 | `combat.js` currently only targets NPCs; routing damage to a `RemotePlayer` entity + safe-zone gating is a moderate but well-scoped change |
| 10. Proximity voice | 3–4 | WebRTC signaling/ICE/TURN is a genuinely fiddly protocol surface even at small scale; browser autoplay/mic-permission UX adds friction |
| 11. DataChannel upgrade | 3–5 | NAT traversal without a dedicated STUN/TURN budget is the single biggest "works on my LAN, fails in the field" risk in this volume |
| 12. Freighter multiplayer | Not estimated here (blocked) | Depends entirely on Volume 7 freighter scope, itself unscoped today |
| **Total (Phases 1–10, excl. 11–12)** | **~25–33 engineer-weeks (≈6–8 engineer-months)** | |
| **+ Phase 11 (DataChannel upgrade)** | **+3–5 weeks** | Optional for MVP parity; WebSocket-relay-only ships a fully functional co-op experience |

**Server infrastructure & ops cost (new, since `server.mjs` today has none):** a persistent WebSocket relay process (not stateless-request-friendly like the current static file server) needs an always-on host rather than pure static hosting — budget a small always-on container (the existing Railway/Docker deployment target already implies this is acceptable) plus SQLite-on-disk (or a managed Postgres once discovery/base-directory row counts grow past what a single SQLite file comfortably serves under concurrent write load — a realistic migration trigger, not a v1 requirement). Bandwidth cost per instance scales with `players² × tick_rate × snapshot_size` for the naive broadcast-to-all approach in §4.2 — at 4 players/20 Hz/44 bytes this is trivial (~14 KB/s aggregate); at 32 players in the hub it is `32×31×44×20 ≈ 875 KB/s` per full instance if done naively, which is why §4.5's hub uses a lower snapshot rate and/or interest-management (broadcast full-rate only to nearby avatars, low-rate elsewhere) rather than reusing the squad-tier snapshot plane unchanged — call this out explicitly as a tuning item in Phase 5, not a rewrite.

**Security note:** the Discovery Registry and base directory are the two write paths most exposed to abuse (namespotting, offensive names, base-part-count DoS via absurd uploads) — basic profanity/length filtering on `name` fields and a hard server-side piece-count ceiling on `base:upload` (mirroring NMS's own tiered caps, §1) are cheap, load-bearing guardrails that belong in Phase 2/8, not deferred.

**The determinism advantage, quantified:** the counterfactual — a netcode design that *didn't* have a seed-derived universe — would need to additionally replicate or stream every planet's terrain mesh, every creature spawn table, and every star system's layout, which is a different and dramatically larger engineering problem (this is, in effect, what Volume 3's voxel/chunk-streaming rebuild would have to also solve for multiplayer if the universe weren't deterministic). Because `Galaxy`/`TerrainField`/creature placement are already pure functions of `(seed, ...)`, this volume's entire scope is bounded to "players + deltas + a thin set of server-arbitrated shared records" — realistically a **quarter to a third** of what full world-state netcode would cost. This is the one place in the whole 18-volume report where AllMansSky's existing architecture is a genuine, quantifiable head start rather than a debt.

---

## 7) Acceptance criteria

Headless (Playwright + two browser contexts against a real running `server.mjs`+`session-server.mjs`) checks, matching this project's existing test posture (`test/smoke.mjs`, Playwright/SwiftShader):

1. **Two clients see each other move.**
   - Launch two Playwright browser contexts, both `?state=space&system=<fixedId>&seed=<fixedSeed>` (reusing `main.js`'s existing debug-boot query params, `start()` lines 200-231), both configured to `netclient.join({instanceId: 'test-instance', seed})`.
   - Drive client A's ship to a known waypoint via the existing debug input harness.
   - Assert client B's `replication.js` roster contains a `RemotePlayer` for A whose `sampleAt(now)` position is within a small epsilon of A's actual position, accounting for `INTERP_DELAY` — i.e., poll until `t > INTERP_DELAY` past the move, then assert convergence.
   - Assert the reverse (B's movement visible to A) to rule out a one-directional wiring bug.

2. **A discovery uploaded by client A is visible to client B.**
   - Client A calls `gameState.discover('planet', '<key>', 'Verdant Hollow', 500)` (the existing `state.js:98` method, unmodified call signature) while connected.
   - Assert the server's `discoveries` table (or a `GET /api/discover/:bodyId` introspection endpoint) now has exactly one row for that `bodyId` with `discoverer` matching client A's player name.
   - Client B, **without ever calling `discover()` itself**, requests the same body's discovery state (e.g. on approach/scan) and asserts it receives `discover:taken` with A's name and the same `name` string — proving cross-client propagation through the server, not just local optimism.
   - Regression guard: have client B *also* attempt `discover()` on the same key concurrently-ish; assert the server returns `accepted:false` with A's name (first-write-wins holds under the `UNIQUE(body_id)` constraint, §4.4), and that B's **local** `gs.discoveries.planets[key].name` gets overwritten to A's name rather than retaining B's own attempted name — this is the specific "sniped discovery" UX correctness check.

3. **An edit syncs.**
   - Client A performs a terrain dig (`manipulator.subtract`/legacy `addDig`) at a known `(x,z)` on a planet both clients are present on (same `instanceId`, same `planetId`).
   - Assert the server relays an `edit` message and client B's local `TerrainField`/`EditStore` for that planet receives the same primitive (assert via `field.height(x,z)` or `density(p)` before/after on B's side matching A's side within epsilon, mirroring Volume 3's own §7 acceptance-criteria pattern for edit correctness).
   - Disconnect and reconnect client B mid-session; assert on rejoin it receives the full current edit-delta list for that planet (a "late join" backfill, not just live deltas from that point forward) — proving the server holds durable per-planet edit state, not just a pass-through relay.
   - As a base-sync analog: client A places a base piece via `basebuilding.js`, calls `uploadBase()`; assert client B, on requesting `base:download` for that `baseId`, receives an identical `pieces` array and can materialize it via the existing `buildPiece(kind)` renderer (`basebuilding.js:54`) unmodified — proving the wire format round-trips through the exact same rendering code path single-player bases already use, with zero special-casing for "this base came from the network."

Each of these is scriptable against a real (not mocked) WebSocket server process and two real browser contexts, consistent with the project's existing Playwright-based headless verification approach — no manual two-human playtesting is required to prove baseline parity on the three capabilities the brief calls out explicitly.
