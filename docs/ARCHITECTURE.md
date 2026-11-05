# Architecture

## Stack (versions installed and verified on 2026-11-05)

| Layer | Choice | Version | Why |
|---|---|---|---|
| Language | TypeScript, strict | 7.0.2 | Shared types across client, server and simulation |
| Client shell | React + Vite | 19.3 / 8.3 | Menus, lobby, HUD as accessible DOM; fast builds |
| Game engine | Phaser | 4.2.1 | WebGL renderer with Canvas fallback (`Phaser.AUTO`), filters, particles |
| Realtime | Colyseus (`@colyseus/core`, `ws-transport`, `schema`) | 0.18.26 / 5.0.45 | Rooms, matchmaking, binary delta state sync |
| Client SDK | `@colyseus/sdk` | 0.18.9 | Auto-reconnect, typed state decoding |
| HTTP | Express (inside Colyseus) | 5.3 | `/health`, `/api/*` |
| Database | PostgreSQL + Drizzle ORM + node-postgres | 16 local / 17 on Render; drizzle 0.45 | Pure-TS migrations (see below) |
| Validation | Zod | 4.6 | Standard Schema: Colyseus validates every message with it |
| Logs | pino | 10.4 | JSON lines for log drains |
| Tests | Vitest, Playwright | 5.1, 1.64 | Unit/integration; two real browsers |
| Lint/format | Biome | 2.6 | One fast tool for TS, TSX, CSS, JSON |

**Prisma vs Drizzle.** The brief allowed "Prisma or equivalent". Prisma 7 needs a schema-engine
binary downloaded at install/migrate time, which is blocked in many CI and sandboxed environments
(including the one this was built in); Drizzle is plain TypeScript and is also what Colyseus 0.18's
own `@colyseus/database` builds on.

**Colyseus 0.18 netcode primitives.** 0.18 introduced `defineInput`, `setFixedTimestep`,
`allowRewindState` and a client `Predict` API. Their public docs do not yet document signatures,
and the built-in model couples input rate to tick rate (one input per server tick). This project
implements its own, fully tested netcode in `packages/shared` instead; migrating later is possible.

**Colyseus `applySimulatedLatency` is not used**: in 0.18.4 of the ws transport it converts frames
with `Array.from`, which corrupted traffic in our tests. `tests/tools/netem-proxy.mjs` simulates
latency, jitter and stalls outside the server instead.

## Topology

```text
Browser ──HTTPS──> Vercel (static: React shell + Phaser bundle)
   │
   ├──HTTPS──> api host: /api/* (profiles, rooms, leaderboard), /matchmake/* (seat reservation)
   └──WSS────> api host: room connection (inputs up, state patches + events down)
                    │
                    └── PostgreSQL (profiles, stats, match history)
```

One Node.js process runs Colyseus, the HTTP API and all rooms. Each room is a lobby that hosts
repeated matches on one map.

## Netcode

Shared deterministic simulation (`packages/shared/src/sim/player.ts`) runs on both sides:

1. **Fixed input step, 60 Hz on the client.** Each step samples keys/mouse into an `InputFrame`
   (`seq`, movement axes, aim, buttons, weapon slot, view tick), quantized exactly as it will be
   encoded, applies it to the local predicted state immediately and queues it for sending.
   Frames are sent once per rendered frame in batches (≤ 6 per message).
2. **Server tick, 20 Hz (configurable `NET.serverTickRate`).** Each tick consumes queued inputs
   at most at real-time rate: credit accrues with measured elapsed time, idle time can be banked
   only up to 0.25 s. This blocks speed hacks and lets a stalled server catch up without a
   permanent backlog. Duplicate/out-of-order sequences are dropped; queues are bounded.
3. **One snapshot per tick.** Automatic patching is disabled (`patchRate = null`); the room calls
   `broadcastPatch()` at the end of every tick, so each patch corresponds to exactly one tick
   number used for timing. Owner-only fields (velocity, timers, ammo, last acknowledged input)
   are tagged `.view()` and reach only their owner via `StateView`.
4. **Reconciliation.** On every patch the client resets its predicted state to the server's owner
   view for the acknowledged input and replays the unacknowledged ones. Because every discrete
   gameplay timer counts integer steps (fire interval, reload, swap, dash), float rounding on the
   wire cannot change whether a shot happens; residual position error is blended out visually.
5. **Interpolation.** Other players are rendered 110 ms in the past by blending the two snapshots
   around the render time. `ServerClock` maps snapshot ticks to local time using the least-delayed
   arrival over a 2 s window, adjusting by at most 1 ms per snapshot (no visible time warps).
6. **Lag compensation.** Weapons are hitscan. Each input carries the tick the client was rendering;
   the server rewinds other players to that time from a position history (max 300 ms) and traces
   the shot there. Pellet spread is derived from a deterministic hash of (shooter seed, input
   sequence, pellet), so predicted tracers match the authoritative ones.
7. **Events.** Shots, hits, kills, spawns, pickups, reloads and dashes are broadcast once per tick.
   Feedback about your own actions (hit markers, damage taken) is immediate; other players'
   visuals are played when the interpolation timeline reaches the event's tick, so tracers leave
   the gun where you see it.

Bandwidth measured with 8 bots: ~3.6 KB/s downstream per client, ~1.5 KB/s upstream.

## Authority and security

The client never decides health, damage, ammo, position, kills, XP or stats. It sends intentions;
the server simulates.

- Every message is validated with Zod (`onMessage(type, schema, handler)`); a malformed message
  disconnects the sender (Colyseus `WITH_ERROR`), no seat is held for it.
- `maxMessagesPerSecond = 90` per client; input queues bounded; view ticks clamped to the rewind
  window; slot/axis/buttons ranges enforced by schema.
- Host-only actions (settings, start, kick) are checked server-side.
- Identity: `POST /api/guest` creates a profile and returns `base64url(payload).HMAC-SHA256`.
  The server trusts the player id only after verifying the signature (timing-safe compare,
  expiry, version). Stats are credited only to verified ids. The same id can later be attached to
  a registered account. Guest creation is rate limited per IP.
- CORS: only `ALLOWED_ORIGINS` receive CORS headers, for both the API and Colyseus matchmaking
  (Colyseus' default `*` is removed).
- Production refuses to boot without `TOKEN_SECRET` (32+ chars) and `DATABASE_URL`, or with debug
  routes enabled.
- Practice matches (solo with training targets) never touch persistent stats or XP.

## Persistence

`Repository` interface with two implementations: `PgRepository` (Drizzle) and `MemoryRepository`
(local development and tests). Match results are written in one transaction; counters are
incremented in SQL so concurrent matches of the same player never lose updates. Migrations live in
`apps/server/drizzle/` and run automatically at boot.

Tables: `players` (profile, XP, level, career counters, cosmetics), `matches`, `match_players`.

## Room lifecycle

`lobby → countdown (5 s, frozen) → playing → results (14 s) → lobby`. Quick rooms auto-start
12 s after two players are present (3 s when everyone is ready). Private rooms start when the host
presses Start and all others are ready. Players can join a match in progress (spawn after 1 s).
Disconnects keep the seat for 20 s (`allowReconnection`); the client also stores the reconnection
token in `sessionStorage` to resume after a page reload. Empty rooms are disposed; private lobbies
idle for 30 minutes close; players idle for 120 s in a live match are removed. On SIGTERM the
server can drain (`SHUTDOWN_DRAIN_SEC`): rooms are locked and notified, running matches finish.

## Scaling

**Current limit: one process.** Room codes are looked up through `matchMaker.query`, so they keep
working with a shared driver. To scale out:

1. Add `@colyseus/redis-presence` + `@colyseus/redis-driver` (Redis only becomes necessary here).
2. Run N game-server instances behind a load balancer that supports WebSockets, with each
   instance reachable by its public address (`publicAddress`) so seat reservations route clients
   to the process that owns the room.
3. Move the per-IP rate limiter to Redis.
4. Keep PostgreSQL as is (connection pool per instance).

Each room is single-threaded inside its process; measured cost is ~0.3 ms per tick for an 8-player
room, so one vCPU has headroom for many rooms. Watch `tickCostMs.max` and `maxIntervalMs` on
`/api/debug/rooms` (debug builds) or add metrics before scaling.

## Code map

| Path | Responsibility |
|---|---|
| `packages/shared/src/config` | Game constants, weapons (data-driven), progression and skins |
| `packages/shared/src/maps` | Map data (mirrored halves), validation, collision world cache |
| `packages/shared/src/sim` | Collision, raycasts, deterministic player simulation, hitscan, RNG |
| `packages/shared/src/protocol` | Wire input encoding, message schemas, API types |
| `packages/shared/src/state.ts` | Colyseus schema (synchronized state) |
| `apps/server/src/simulation` | `GameSimulation`: inputs, rewind, combat, spawns, pickups |
| `apps/server/src/rooms/ArenaRoom.ts` | Phases, message handling, mirroring sim → state, persistence |
| `apps/server/src/api` | HTTP routes |
| `apps/web/src/game` | Phaser scenes, procedural art, effects, audio, netcode client |
| `apps/web/src/screens` | Menus, lobby, HUD, results |
