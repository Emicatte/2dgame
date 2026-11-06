# SCRAPLINE 3.0 | OUTBREAK: audit, roadmap and results

Branch `outbreak` (not deployed; the public Vercel deployment is untouched). Systems reference:
[OUTBREAK.md](OUTBREAK.md).

## Phase 0: audit of the existing project (2026-11-06)

What the repository actually contained at `6b84443` (v0.4.0), checked by reading the code and
running the suites, not from older reports:

| Area | Found | Notes for 3.0 |
|---|---|---|
| PvP modes | Deathmatch, TDM, Domination, CTF, Vehicle Mayhem | kept; PvE modes are separate (`PVP_MODES` / `PVE_MODES`) |
| Vehicles | car, off-road, APC, helicopter; seats, mounted guns, run-overs | reused, not duplicated: enemies hit hulls, vehicles plough through enemies |
| Authority | one `GameSimulation` run by the dedicated `ArenaRoom` and by the browser-hosted `HostRoom` | PvE lives in the same simulation, so both transports get it |
| Deployed transport | host mode (WebRTC, Vercel + Upstash signaling); the dedicated server is not deployed | PvE authority is the host's tab in production |
| Netcode | 60 Hz prediction, 20 Hz ticks, reconciliation, 110 ms interpolation, 300 ms lag compensation | enemies are interpolated and rewound like players |
| Combat visuals | basic cross crosshair (colour only), tracers, sparks, hit marker, damage numbers | Phase 1 overhaul |
| Graphics settings | Low / High | Medium added in Phase 1 |
| Maps | 9 point-symmetric PvP maps | a dedicated, non-mirrored PvE map was needed (Halvorsen Works) |

Baseline: lint failed (one JSON file without a trailing newline), typecheck passed, unit and
integration suites passed (shared 90, server 110 + 8 skipped without PostgreSQL/TLS, web 39 + 1
real-time test that failed intermittently). The intermittent failure was a measurement race in
the test (shots counted across a counter reset), not a netcode bug: fixed by comparing shots by
input sequence. Both fixes are in the first commit of the branch.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit, baseline, fixes | ✅ |
| 1 | Combat Visual Overhaul: crosshair, aim, shot effects, damage feedback, weapon animations, quality levels | see "Phase 1" below |
| 2 | Enemy AI architecture, navigation, first enemy types | ✅ (all six types) |
| 3 | Wave Director, first waves, Survival | ✅ |
| 4 | Co-op: shared missions, downed/revive, failure, two-browser test | ✅ |
| 5 | First Contact complete | ✅ scripted and tested end to end in the simulation; first two objectives verified with two real browsers; a full run by human players not done here |
| 6 | Boss system and first boss | ✅ boss system (phases, per-phase attacks, combos, transitions, squad scaling) and The Abomination, playable as the boss of every tenth Survival wave; not yet in a mission (The Warden and Subject Zero belong to later missions) |
| 7 | Dead District, The Convoy | not started (listed in the lobby as in development, not selectable) |
| 8 | Black Site and miniboss | not started |
| 9 | Final Breach, Subject Zero | not started |
| 10 | Progression polish, balance, optimisation | PvE progression done (records, titles, unlocks, dedupe); balance needs playtests |
| 11 | Release preparation | needs your devices and your go |

## Acceptance criteria and evidence

| Criterion | Evidence | Result |
|---|---|---|
| Enemies reach targets around obstacles | `pve.test.ts`: walker from the generator room to the yard through two doorways (26.8 s) | pass |
| Enemies never cross walls | same test and the 40-enemy test check every enemy every tick against the collision world; A* paths walked in 6 px steps | pass |
| AI states and perception | idle → investigate on gunfire (no sight) → chase when seen; stalker without knowledge of an unseen player | pass |
| Telegraphs before damage | walker windup ≥ 0.45 s before the hit; damage only at the strike | pass |
| Correct damage, precision, kill credit | shots vs a brute (precision hits, health = max − dealt), exploder blast kills a walker and credits the shooter | pass |
| Two players hit the same enemy in one tick | one death, one credit, health never negative | pass |
| Valid spawns | never within 384–480 px of a player, out of sight | pass |
| Waves end | Survival waves 1 and 2 cleared in order; unreachable wave enemies culled, wave ends | pass |
| Scaling is not only health | 4 players: > 2× the enemies of one; health ×1.1 at most; specials spread | pass |
| Missions advance | First Contact from the hall to extraction in the simulation: doors, power, 3 waves, supply, keycard, gate, extraction with everyone on the pad | pass |
| Revive, interrupt, solo, bleed-out, wipe | five tests | pass |
| Vehicles vs enemies | car ploughs through a walker; a walker damages the hull of its target's car | pass |
| Rewards once per run | `pveProgress.test.ts`: a repeated run id changes nothing; stored data validated | pass |
| Host mode: sync, revive across the link, results | `hostmode.pve.test.ts` | pass |
| **Two independent browsers complete a co-op objective** | `tests/e2e-p2p/outbreak.spec.ts` (two Chrome processes, WebRTC): both reach the hall (objective 1), host restores power while the guest covers (objective 2); both screens show the mission advancing | pass (2.9 min in software rendering) |
| No PvP regressions | full unit/integration suites; PvP E2E (see TESTING) | see below |
| Performance budget | tick cost by enemy count, bandwidth | see OUTBREAK.md §8 |
| Boss changes phase, can be defeated, telegraphs every attack | `pve.test.ts` "boss" (phases at 66/33 % with roar, defeat, slam damage only after its windup, debris aimed at the player, summons, Survival wave 10 ends only when it falls, ranged fallback on a cramped map); boss E2E scenario with screenshots | pass |

Found and fixed by the new tests: an AI state timer that made investigating enemies give up at
once; a "fat" line-of-sight check that let paths graze corners; holds advancing per server tick
(a 5 s generator hold took about 12 s at software-rendering frame rates).

## Phase 1 results

Filled in after the Combat Visual Overhaul branch is merged (see the commit message and
`docs/TESTING.md`).

## Not verifiable here

Real GPUs (60 FPS target), school networks for WebRTC, a complete First Contact run by people,
balance by playtests.
