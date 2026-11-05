# SCRAPLINE 2.0: feasibility and roadmap

Status on 2026-11-05: **Phase 0 and Phase 1 done** (verified, see the bottom of this file).
Phases 2–8 are planned below with acceptance criteria; nothing of them is implemented yet.

## 1. Feasibility: what is reused, what is extended

The v0.2 code base was built to be extended this way. The parts below are reused unchanged, and
new systems plug into them instead of running beside them.

| Existing part | Reused for 2.0 as | Notes |
|---|---|---|
| Input pipeline (60 Hz fixed-step frames, server credit/catch-up/trim, stall guard) | Vehicle and seat input | `InputFrame` already carries two axes, aim, buttons (INTERACT = E) and a one-shot slot command: throttle/steer map onto the axes, enter/exit/seat change onto INTERACT + slot. No second input channel. |
| Reconciliation + replay (`Predictor`) | Prediction of the vehicle you drive | Requires the vehicle model in deterministic shared code (like `sim/player.ts`), stepped per input frame (60 Hz) on both sides. Passengers do not predict the vehicle: they see it interpolated. |
| Interpolation (110 ms) + lag compensation (300 ms rewind) | Remote vehicles, shots from/at vehicles | The rewind history stores positions per entity; vehicles join it. Shots from a seat originate from the rewound seat position. |
| `GameSimulation` (authoritative), `NetEvent`s | Vehicles, impacts, destruction, environment events | One simulation, one tick; new entity kinds and event types. |
| State schema with owner-only views | `VehicleState` map; per-viewer filtering for big maps | Colyseus `StateView` (and the host-mode encoder) already filter per client: the same mechanism gives interest management (send only what is near). |
| Collision world (AABB solids + uniform grid) | Vehicle collisions | Vehicles need oriented boxes (OBB vs AABB, OBB vs circle): new shared collision functions, same grid. |
| Data-driven maps (mirrored halves, spawns, pickups, theme) | Nine maps, team spawns, points of interest | `teamSpawns` (Phase 1) and new optional fields (vehicle spawns, zones, heights). |
| `MatchRules` (Phase 1), results/XP pipeline | Domination, CTF, Vehicle Mayhem, practice | Modes are data + rule functions shared by both room implementations. |
| Two transports: dedicated Colyseus server, host mode (WebRTC) | Both keep working | Every new rule lives in shared/simulation code; both rooms call it. Host mode costs CPU on the host's computer: measured per phase. |

What is genuinely new work:

1. **Vehicle model** (Phase 2): arcade "bicycle" model per input frame: throttle, brake/reverse,
   steering scaled by speed, lateral grip (controlled drift), drag; per-type stats (car,
   off-road, light armored) as data. Deterministic, quantized like player movement.
2. **Seats** (Phase 2, from the start): per-vehicle seat table (role, offset, fire sector, weapon
   rules); server-owned occupancy with atomic claim; seat changes and exits validated against
   free, safe positions.
3. **Impacts** (Phase 4): vehicle vs player damage from relative speed, mass, angle, protection;
   knockback; per-pair cooldown so a persistent contact cannot repeat damage; no damage in spawn
   protection; kill credit to the driver.
4. **Altitude** (Phase 5): helicopters have a discrete altitude state (ground / low / high) and a
   shadow; solids get a height class (low cover, building) to decide what blocks flight and fire.
5. **Large maps** (Phase 3+): camera bounds, render culling, network interest management,
   collision broad-phase already grid based.

Risks to measure, not assume: host-mode CPU with vehicles (the host's browser runs everything),
bandwidth with many moving vehicles at 20 Hz, prediction error for the driven vehicle under
120–250 ms RTT, tunnelling at high speed (sub-steps at 60 Hz are already the input rate).

## 2. Roadmap and acceptance criteria

Each phase ships only after its criteria pass on both transports (dedicated server and host
mode) and the previous phases' suites still pass. "E2E" always means two independent browser
processes.

| Phase | Scope | Acceptance criteria |
|---|---|---|
| **0** ✅ | Verify the existing multiplayer | All unit/integration suites pass; netcode matrix 15/15 (0–250 ms RTT, jitter, 13 FPS, stalls up to 2.5 s, drop, reload); E2E duel + reload/stall/drop on the server; host-mode E2E (WebRTC) dev + production build; host-mode netcode at 120 ms RTT within the same bounds. |
| **1** ✅ | Team Deathmatch (2v2 default, 1v1–4v4), lobby, scores | See "Phase 1 results" below. |
| 2 | Vehicle core: car, off-road, light armored; seats (driver + passengers, gunner on armored); enter/exit/seat change; driving; collisions with world and between vehicles; vehicle health and destruction; respawn of vehicles | Deterministic vehicle sim unit tests (same inputs → same state; no tunnelling at max speed through 16 px walls); seat claim race (two clients press E on the same seat in the same tick: exactly one wins); exit always to a free, reachable spot; driver prediction converges ≤ 1 px after release at 0/120/250 ms RTT; driver disconnect: vehicle brakes to a stop, seat held 20 s; E2E: A drives, B rides as passenger, B shoots while moving, both see the same vehicle and occupants, B exits and fights on foot. Host tick cost with 4 players + 6 vehicles measured and reported. |
| 3 | Urban Warfare map (first vehicle map): roads, buildings, alleys, vehicle spawns, larger bounds, culling | Map validation tests (spawns free and reachable on foot, vehicle spawns on roads, team spawns balanced); FPS benchmark on the bench page vs the existing maps; interest management keeps per-client bandwidth within budget (target set after measuring Phase 2). |
| 4 | Run-overs and collision damage; knockback; impact FX; spawn-kill and no-vehicle-zone protections | Unit tests for the damage formula (speed, mass, angle, protection), per-pair cooldown (resting contact deals damage once), no damage under spawn protection, kill credit to the driver; integration test over sockets; E2E run-over with two browsers. |
| 5 | Helicopter (pilot + gunner + 2 passengers) on a dedicated test map: altitude states, take-off/landing, mounted gun, counter-play from the ground | Unit tests: what blocks flight and fire at each altitude; take-off/landing state machine; destruction consequences for occupants. E2E: A pilots, B is gunner and fires while flying; both see rotors/shadow/altitude consistently; server records the damage. |
| 6 | Modes (Domination, Vehicle Mayhem, CTF), remaining maps (Airbase, Harbor, Downtown, Mountain, Tactical Facility), progression to level 50 with documented curve, per-mode stats, periodic challenges (cosmetic rewards only) | Per-mode rule tests on both rooms; map validation; XP curve table in docs and tests; migration tested on PostgreSQL. |
| 7 | Balance, performance, hardening | Bench and netcode matrix extended to vehicles; soak test (30 min, 8 players, bots); security negative paths for every new message. |
| 8 | Release preparation | Changelog, docs, real-device test on the target networks, then a validated public deploy. |

## 3. Phase 0 results (2026-11-05)

| Check | Result |
|---|---|
| Unit + integration (shared 41, web 35, server 59 + 8 skipped without PostgreSQL/TLS variables) | pass |
| Netcode matrix, dedicated server, 15 scenarios (`docs/audit/data/netaudit-v2-phase0.json`) | 15/15 pass; the pending-input accumulation found in v0.1.0 does not recur: pending max stays under the bound in every steady scenario and recovers after stalls (e.g. 2.5 s uplink stall: recovery 523 ms, 0 overflow/trim/duplicate) |
| E2E dedicated server: duel + reload/stall/drop | pass |
| E2E host mode (WebRTC between two Chrome processes): dev and production build | pass |
| Host-mode netcode, 120 ms RTT, real time (new test `hostmode.netcode.test.ts`) | pending max 8 (bound 18), 0 corrections after warm-up, predicted shots = host shots (9/9), exact convergence after release |
| Two physical devices on different networks | **Not verifiable here.** Needs your devices: dedicated server not deployed; host mode needs the Upstash store connected on Vercel |

Known, accepted: one small correction (≈ 20 px) can occur at the countdown → match transition when
a direction is held during the countdown (the client predicted those inputs as frozen; the host
or server applies the late ones live). It is blended out visually and excluded from the matrix
by its warm-up, as in v0.1.1.

## 4. Phase 1 results (2026-11-05)

Delivered: `tdm` mode with configurable team size (1v1–4v4, default 2v2), duration (default 5 min),
score limit (default 15), friendly fire (default off); Alpha (blue) / Bravo (orange) colors on
markers, name tags, lobby, kill feed, scoreboard and results; team spawns on each team's half with
spawn protection; shots pass through teammates without friendly fire (server and client tracer);
team score, end by score or time, draw; Team victory XP for the whole winning team; same teams
for the rematch; quick match per mode (`Team Deathmatch 2v2` button, server mode); host controls
for mode, team size, friendly fire and "Balance teams by level" (snake draft); team switching;
"Invite to <team>" link (`?join=CODE&team=N`) honored when the team has room. One shared module
(`apps/server/src/rules/MatchRules.ts`) drives both the dedicated room and the host-mode room.

| Test | Result |
|---|---|
| `apps/server/test/teams.test.ts` (14): friendly fire on/off, pass-through, team score, team kill scores nothing, team spawns, assignment/preference/capacity, switching, team size changes, snake balance, empty-side rebalance, practice targets, sync, team results/XP | pass |
| `apps/server/test/teams.integration.test.ts` (3, real sockets): quick matchmaking per mode, private room TDM with invite/switch/full/3v3/balance/back to DM, 1v1 to 5 points with results, persisted win/loss, rematch keeps teams | pass |
| `apps/web/test/hostmode.teams.test.ts` (2): same rules in host mode, refusal of the fifth player, guest cannot change settings | pass |
| `tests/e2e/teams.spec.ts`: two browsers, server mode: TDM, invite to my team, switch team, kill → team score on both screens | pass |
| `tests/e2e-p2p/hostmode.spec.ts` (extended): two browsers, WebRTC: TDM + invite link + play + reload/resume + host close | pass |
| Regressions: all previous suites, netcode matrix after Phase 1 | see TESTING.md |

Bug found by the new E2E and fixed (present since v0.1.0): after joining through an invite link,
the startup effect ran a second time (clearing the invite re-triggered it) and the page "resumed"
the room it had just joined, leaving it first, so the player ended up back in the menu (server
mode) or with an expired seat (host mode).
