# Changelog

## 0.3.0 — 2026-11-05 (SCRAPLINE 2.0, phases 0–1: verification and Team Deathmatch)

Plan, feasibility and acceptance criteria for 2.0: `docs/v2/ROADMAP.md`.

### Added
- **Team Deathmatch**: Alpha vs Bravo, default 2v2 / 5 min / 15 points / no friendly fire;
  configurable 1v1–4v4, length, score limit, friendly fire. Team spawns on each team's half,
  team score and end by score or time (draws possible), Team victory XP for the winning team,
  same teams for the rematch. Shots pass through teammates when friendly fire is off.
- Lobby: mode selector, team columns with join buttons, team size and friendly fire settings,
  "Balance teams by level" (host), "Invite to <team>" links (`?join=CODE&team=N`).
- Quick match per mode on the dedicated server (Team Deathmatch 2v2 button).
- In game: team colors on player markers and name tags, team scores at the top, kill feed and
  scoreboard by team; results show the team result.
- `apps/server/src/rules/MatchRules.ts`: mode/team rules shared by the dedicated room and the
  host-mode room.
- Tests: team rules (14), TDM over real sockets (3), host-mode TDM (2), host-mode netcode at
  120 ms RTT (1), two-browser TDM E2E; host-mode E2E extended to TDM and invite links.

### Fixed
- Invite links (`?join=CODE`) put the player back in the menu right after joining (server mode)
  or with an expired seat (host mode): clearing the invite re-ran the startup effect, which
  "resumed" the room just joined by leaving it first. Present since v0.1.0.

## 0.2.0 — 2026-11-05 (host mode)

### Added
- **Host mode**: the player who creates an arena hosts it in their browser; friends join with the
  code over WebRTC, no game server needed. The host's tab runs the dedicated server's simulation,
  state mirroring and scoring unchanged, and synchronizes state with the same schema encoding and
  owner-only views. Guests reconnect within 20 s and resume after a page reload. See
  `docs/HOST_MODE.md`.
- Signaling endpoint `/api/p2p`: source `apps/web/src/p2p/signalServer.ts`, deployed as the
  generated plain-JavaScript Vercel Function `apps/web/api/p2p.js` (precaution: the project's
  TypeScript 7 has no JavaScript compiler API for a TypeScript function build to use). Upstash Redis
  free plan; in-memory store in the Vite dev/preview server. Optional TURN relays (Cloudflare or
  static credentials).
- Local profile (callsign, XP, levels, stats, loadout in `localStorage`) for host mode.
- Production builds without `VITE_SERVER_URL` default to host mode (`VITE_NET_MODE` overrides).
  The dedicated-server mode is unchanged.
- Tests: signaling and deployed function (14), host/guest rooms over in-memory links (8), two-browser WebRTC E2E
  (`pnpm test:e2e:p2p`, dev server and production build).

### Fixed
- `apps/server/test/pgTls.test.ts` crashed during collection when the TLS test variables were not
  set, failing `pnpm test` (the suite is skipped in that case, as intended).

## 0.1.1 — 2026-11-05 (technical audit)

Audit of networking, performance, security and deployment; findings, evidence and before/after
numbers are in `docs/audit/AUDIT_REPORT.md`. No gameplay, weapons or maps changed.

### Fixed
- After an uplink stall of about 1 s or more, the burst of buffered input messages exceeded the
  per-client limit (90/s) and the server disconnected the player (4002), losing the seat. Limit
  raised to 150/s and the burst bounded by a client stall guard.
- After a stall longer than 0.25 s the server kept a standing input queue for the rest of the
  session (up to +1 s input latency). Idle credit now covers the stall guard (0.75 s), backlogs
  are consumed at up to 2x real time, and a queue that never drains is trimmed.
- The client discarded unacknowledged inputs beyond 240 (guaranteed misprediction). Inputs are no
  longer discarded; without ack progress for 750 ms the client holds input and shows
  "Connection interrupted".
- After a page reload during a match the game scene could miss the resumed room (it subscribed
  after the session had joined): HUD visible, game frozen. The scene now picks up the current room.
- A reconnect presenting the token of a still-open socket (network switch) kicked the player
  instead of moving the seat to the new connection.
- After an automatic reconnect, inputs buffered by the SDK were re-sent after newer ones and
  rejected; the client now holds input while reconnecting.
- Root cause of "pending 190" in v0.1.0 screenshots documented and covered by a test: setting
  `patchRate = null` before `setTimestep` starts an extra 60 Hz clock interval, so the timestep's
  `deltaTime` under-reports real time (the screenshots came from a stale pre-fix server process).
- The network-conditions test proxy could reorder frames (separate timers with equal deadlines);
  it is now a strict FIFO per direction with a seeded RNG.

### Security
- PostgreSQL TLS is verified (`DATABASE_SSL=verify-full|verify-ca|disable`, `DATABASE_SSL_CA`);
  the previous `rejectUnauthorized: false` accepted any certificate. TLS parameters in
  `DATABASE_URL` can no longer override the policy.
- `X-Forwarded-For` is trusted only for `TRUST_PROXY` hops (default 0); with the previous fixed
  `trust proxy 1` a direct client could spoof addresses and bypass every rate limit.
- Identity tokens are verified before a room is created (static `onAuth`): unauthenticated
  matchmaking requests created real rooms (measured: 2000 rooms, 877 ms tick stalls).
- Matchmaking requests are rate limited per address; one identity cannot hold two seats in a room.
- Tokens are redacted from logs also when nested in framework errors; rate-limiter memory is
  bounded; docker-compose no longer contains a secret and binds PostgreSQL to loopback.
- Negative tests: forged/missing tokens, private rooms via matchmaking, duplicate identity,
  forged reconnection tokens, owner-only fields, sequence/view-tick manipulation, unknown message
  types, oversized batches, flooding, spoofed `X-Forwarded-For`, production configuration.

### Added
- Input pipeline metrics on client (`NetMetrics`) and server (per-player counters, logged on leave).
  Debug overlay: pending p95/max, ack age, interpolation buffer, snap count.
- `apps/server/scripts/netaudit.ts`: RTT/jitter/stall/reconnect matrix with acceptance criteria.
- E2E: input-pipeline assertions in the duel; new test for page reload, uplink stall and
  connection drop in real browsers. Runtime-controllable proxy (stall, drop, TLS, forwarded).
- `bench.html`: offline, repeatable client benchmark (1/2/8 players, High/Low) with a frame-time
  recorder; `tests/perf/run-bench.mjs` runner.
- `tests/tools/pg-tls-setup.sh` and TLS verification tests against a TLS-only PostgreSQL.
- Structured fatal log when the database is unavailable at boot.

### Changed
- `NET`: `inputStallMs` 750, `maxInputCreditSeconds` 0.75 (was 0.25), `inputCatchUpRate` 2,
  standing-queue trim (2 frames / 1 s), full queue evicts the oldest frames,
  `maxMessagesPerSecond` 150 (was 90).
- Render Blueprint sets `DATABASE_SSL=disable` (internal URL) and `TRUST_PROXY=1`.

## 0.1.0 — 2026-11-05

First playable version.

### Added
- pnpm monorepo: `apps/web` (React 19, Vite 8, Phaser 4.2), `apps/server` (Colyseus 0.18,
  Express 5, Drizzle, PostgreSQL), `packages/shared` (config, protocol, state schema, deterministic
  simulation).
- Top-down shooter gameplay: acceleration-based movement, dash, independent aim, five data-driven
  weapons (pistol, assault rifle, SMG, shotgun, sniper), bloom and movement spread, reloads, weapon
  slots, pickups (health, ammo, weapons), spawn protection, smart respawns.
- Three point-symmetric maps: Industrial Arena, Neon District, Desert Outpost.
- Authoritative multiplayer: 60 Hz client prediction, 20 Hz server ticks, reconciliation,
  interpolation with a jitter-tolerant server clock, lag-compensated hitscan, owner-only state via
  StateView, real-time input budget against speed hacks.
- Deathmatch: countdown, timer, kill limit, kill feed, Tab scoreboard, death/respawn screen,
  results with XP breakdown, rematch.
- Lobby: quick match with auto-start, public room browser, private rooms with 5-character codes and
  invite links, ready states, host settings (map, duration, kill limit, max players), kick.
- Guest identity with HMAC-signed tokens; XP, levels 1–20, cosmetic skins, career stats, leaderboard.
- Solo practice against strafing training targets (never recorded).
- Procedural art (soldiers, weapons, props, maps), lights, particles, tracers, hit markers, damage
  numbers, camera shake; Web Audio synthesized sound effects.
- Settings: volumes, quality, screen shake, crosshair color, key rebinding, FPS/network overlay.
- Reconnection (auto + after page reload), AFK removal, idle lobby closing, graceful drain on SIGTERM.
- Tests: unit, real-socket integration, PostgreSQL contract, two-browser Playwright E2E (also under
  simulated latency), load-test script, network-conditions proxy.
- Deployment: Dockerfile, docker-compose, Render Blueprint, Vercel config, documentation.

### Fixed during development
- Server processed inputs at about a third of real time because the room clock's `deltaTime` is
  shared with other timers; tick time is now measured directly.
- Phaser's smoothed delta slowed the fixed-step simulation at low frame rates; the client now
  uses real elapsed time.
- Quick matches never auto-started because unset schema numbers are `undefined`; every synchronized
  field now has an explicit default.
- Colyseus default CORS (`*`) applied to all routes; now restricted to configured origins, with
  credentials allowed only for them (the SDK requires it for matchmaking).
- Map baking took ~20 s on software renderers due to canvas blur filters; shadows are now drawn at
  1/8 resolution and upscaled (~25 ms).
