# Changelog

## 0.6.0 — 2026-11-09 (the full Outbreak campaign: Dead District, The Convoy, Black Site, Final Breach)

### Added
- **Dead District** (campaign chapter 2, unlocked by First Contact): a new city map and a
  six-step mission (apartments, radio, clinic supplies, defence from several streets, the
  survivors' truck across the city, the checkpoint). New step kind `drive`, props medical and
  radio. See `docs/v3/OUTBREAK.md` §6b.
- **The Convoy** (chapter 3, unlocked by Dead District): Kessler Road map, an escorted armored
  carrier (one drives, one on the roof gun, playable solo), keys that unlock it, an engine
  repair under fire on the truck itself, the bridge and the airfield. New: triggers `lock` /
  `unlock` for vehicles, props `attach`ed to a vehicle, a horde on `interact` steps,
  `MissionDef.escort` (mission fails when the escort is destroyed) and its HUD hull bar. See
  `docs/v3/OUTBREAK.md` §6c.
- **Black Site** (chapter 4, unlocked by The Convoy): an underground lab with automatic doors,
  a containment lockdown, decontamination vents on a timer, a blackout during the breach, three
  waves of specials, research to recover and **The Warden**, an armoured miniboss: shoot its
  glowing back while a teammate holds its gaze, or everyone when it vents. See
  `docs/v3/OUTBREAK.md` §6d.
- **Final Breach** (chapter 5, the end of the campaign): infiltration through the maintenance
  tunnels, three waves in the atrium, a decryption rig to keep alive, and **Subject Zero**: three
  phases, acid that stays on the floor, a hall whose vents wake up as it weakens, a blackout at
  the end. Its death starts a timed escape and the last stand at the evac hangar. See
  `docs/v3/OUTBREAK.md` §6e.
- Signaling: TURN keys are stripped of pasted spaces, newlines and quotes; the health endpoint
  reports the key id's shape (`turnKey`).

## 0.5.1 — 2026-11-06 (co-op dread pass, TURN diagnostics)

### Added
- **Dread pass for co-op** (client only, PvE only): darkness as a light map with line-of-sight
  shadows, a flashlight where you aim, teammates' flashlights, headlights, lamps, gunfire and
  explosions lighting the dark, glinting eyes of enemies in sight but unlit, telegraphs always
  above the dark, stalker flashlight stutter, low-health red vignette; adaptive procedural
  score (drone, dissonance, heartbeat, boss drums, stingers) and positional dread cues;
  settings "Music volume" and "Co-op brightness". See `docs/v3/OUTBREAK.md` §5b.
- Tests: line of sight and shadow quads, tension and flicker (11), score mix rules (21),
  settings migration; E2E asserts the darkness in co-op and its absence in PvP.

### Fixed
- Host mode: a refused or unreachable Cloudflare TURN key fell back to STUN without a trace.
  `GET /api/p2p` now reports `turn` (none / static / cloudflare / cloudflare-error:<status> /
  cloudflare-unreachable), never a credential, and failures are logged.

## 0.5.0 — 2026-11-06 (SCRAPLINE 3.0 | OUTBREAK, phases 0–6: combat visual overhaul, co-op PvE)

Systems reference: `docs/v3/OUTBREAK.md`. Audit, roadmap and evidence: `docs/v3/ROADMAP.md`.
Deployed to production (Vercel project `2dgame-8ds5`, host mode) on 2026-11-06 from `main` at `7264341`, after the E2E suite passed against the production build.

### Added
- **Combat Visual Overhaul** (client only, no gameplay value changed): crosshair styles dot /
  cross / circle / tactical / minimal with size, colour, opacity, thickness, outline and dynamic
  spread (the gap is the real spread cone), live preview in the settings; hit / crit / armour /
  kill markers; tracers per weapon family, muzzle flash variants, impacts by surface (metal,
  masonry, map edge), hull sparks; weapon animations (recoil, shotgun pump, sniper bolt, reload
  dip, swap raise); graphics quality Low / Medium / High with one particle and pool budget.
- **Outbreak (co-op, 1–4 players)**: missions with objectives, steps, doors, props, checkpoints,
  integrated tutorial hints; **First Contact** on the new Halvorsen Works map (enter the hall,
  restore power, hold the courtyard for 3 waves, find the keycard, open the gate, hold the
  helipad until extraction). The other four campaign missions are listed as in development and
  cannot be selected.
- **Survival Endless**: waves following the design table, then a growing horde with specials;
  supply crates; a boss every tenth wave. On Halvorsen Works, Industrial Arena, Tactical Facility.
- **Enemies**: Walker, Runner, Brute, Spitter, Stalker, Exploder; boss **The Abomination**
  (three phases, slam, charge, lobbed debris, summons, roar transitions). Every significant
  attack is telegraphed (arcs, lanes, blast and landing circles).
- **AI**: navigation grid with clearance classes, flow fields (Dial), A* with line-of-sight
  smoothing; eight AI states; sight and hearing (gunfire, loud props, blasts); stalkers without
  knowledge of unseen players; crowd separation; tiered decision rates; stuck handling.
- **Wave Director**: composition scaled by squad and difficulty (density, pace, specials,
  directions, not only health), valid out-of-sight spawns, guaranteed termination.
- **Co-op**: downed / crawl / revive (hold E), solo self-revives, bleed-out and return at the
  next checkpoint, mission failed when nobody is standing; squad HUD, off-screen objective and
  ally markers, prompts, banners, feed, downed overlay; difficulty Recruit / Veteran / Nightmare.
- Vehicles in PvE: enemies attack the hull of their target's vehicle; vehicles plough through
  enemies; wreck blasts hurt them.
- **PvE progression**, kept apart from PvP stats: mission records (best time per difficulty),
  Survival records, titles, unlocks; a run is recorded once (run id).
- Lobby: competitive and co-op modes, campaign list, briefing, difficulty, Survival maps; main
  menu "Outbreak · co-op".
- Tests: 40 PvE simulation tests (12 of them regressions from the independent review),
  dedicated-server integration (real sockets), host-mode integration (peer links), PvE
  progression, flow fields against a reference Dijkstra on every map, 61 combat visual tests,
  **two-browser WebRTC E2E** completing co-op objectives, single-browser boss scenario.

### Fixed
- The crosshair was drawn off the cursor and off the shot ray when the camera zoomed (up to
  80 px at the edge of a 1280×720 window).
- Found by an independent review of the PvE code (each reproduced before the fix, see
  `docs/v3/ROADMAP.md`): the downed flag stayed set in the next PvP match after a failed co-op
  run (client mispredicted a crawl); two revivers cancelled each other; the dedicated server
  recorded players leaving a PvE run as PvP matches (zombie kills in PvP stats); the boss could
  be culled by outrunning it; a brief disconnect failed the run; leaving and rejoining was a free
  revive; placed and ambient enemies could starve a wave; vehicles rammed an enemy once per input
  frame; the last downed player of a shrinking squad got no self-revive, and hits could bleed a
  player out before a pending self-revive; boss phase speeds unused; summons above the 48-enemy
  cap; downed hits without the attacker id; roar telegraph without its radius; tick cost measured
  with standing players only (4.8 ms avg with moving players, now 1.3–2.2 ms); the dedicated
  server applied room size and length to co-op rooms; the countdown used up Survival's opening
  grace and counted in run times.
- `tests/e2e-p2p/vehicles.spec.ts` failed at its last step in software rendering (on this branch
  and on the untouched v0.4.0 tree, three runs out of three) for two reasons in the test, not in
  the game: the burst fired from the car emptied the rifle and its reserve (0 / 0), and driver
  and passenger left the car on opposite sides, so the car stood between them and took every
  shot. The spec now switches to the sidearm and steps both players out of the car's shadow
  (two passes out of two after the change).
- Lint failed on `docs/audit/data/netaudit-v2-phase7.json` (missing trailing newline).
- `apps/web/test/hostmode.netcode.test.ts` failed now and then: shots were counted across a
  counter reset (measurement race in the test); shots are now compared by input sequence.

## 0.4.0 — 2026-11-05 (SCRAPLINE 2.0, phases 2–7: vehicles, helicopters, modes, maps, progression)

Systems reference: `docs/v2/SYSTEMS.md`. Phase results and measurements: `docs/v2/ROADMAP.md`.

### Added
- **Vehicles**: Hatch (car), Rover (off-road), Bulwark APC (light armored, MG turret) and
  Kestrel (helicopter, chin gun). Shared deterministic model (grip and handbrake drift,
  speed-dependent steering, multi-circle hull collisions); the driver predicts and reconciles,
  everybody else interpolates. Health, armor, wall and vehicle-vs-vehicle crashes, destruction
  with blast damage and credit, burning wrecks, respawn on a clear spot.
- **Seats**: driver/pilot, gunner, passengers with fire arcs and exposure; E enter/exit, F change
  seat; atomic seat claims; passengers shoot from moving vehicles (lag-compensated from the seat
  as they saw it); mounted guns; disconnected occupants leave at once.
- **Run-overs and collisions**: damage from closing speed along the contact normal, mass and
  ramming factor; knockback; per-contact cooldown; spawn protection and team rules respected;
  credit to the driver ("Roadkill" in the kill feed).
- **Helicopter**: take-off/landing on Shift, rotor spin-up, altitude with shadow, flight over low
  cover, landing only on a clear footprint, auto-landing without a pilot; ground/air shot layers.
- **Modes**: Domination, Capture the Flag, Vehicle Mayhem (besides Deathmatch and Team
  Deathmatch); lobby mode picker with rules, per-mode score limits; objective HUD and markers.
- **Maps** (9 total): Urban Warfare, Military Airbase, Harbor Conflict, Downtown, Mountain
  Outpost, Tactical Facility; the three original arenas are unchanged. Water and fences stop
  movement but not bullets. Large maps render as tiles.
- **Progression**: level cap 50 (levels 1–20 unchanged), ten new skins and rank titles (cosmetic
  only), XP for objective play and wrecked vehicles, per-mode career stats, three daily
  challenges. PostgreSQL migration `0001_career` (one jsonb column).
- Vehicle HUD panel, entry prompts, engine/rotor sound, explosion/crash/dust effects, camera lead
  and gentle zoom in vehicles.
- Tests: vehicle model, vehicles and modes in the simulation, career/progression, repository
  contract on PostgreSQL 16, host-mode vehicle netcode (120 ms RTT), host load (8 players,
  6 vehicles), simulated 10-minute soaks, two-browser E2E for car, helicopter, CTF and
  Domination (server) and car (WebRTC host mode).

### Changed
- Map textures are registered as plain images (no full pixel read-back) and baked one frame
  after joining, so the lobby appears before the map is ready.

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
