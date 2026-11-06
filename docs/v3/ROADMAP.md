# SCRAPLINE 3.0 | OUTBREAK: audit, roadmap and results

Released as 0.5.0: merged into `main` and deployed to production (https://2dgame-8ds5.vercel.app, host mode) on 2026-11-06, after the host-mode E2E passed against the production build. Systems reference:
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
| 1 | Combat Visual Overhaul: crosshair, aim, shot effects, damage feedback, weapon animations, quality levels | ✅ (see "Phase 1 results") |
| 2 | Enemy AI architecture, navigation, first enemy types | ✅ (all six types) |
| 3 | Wave Director, first waves, Survival | ✅ |
| 4 | Co-op: shared missions, downed/revive, failure, two-browser test | ✅ |
| 5 | First Contact complete | ✅ scripted and tested end to end in the simulation; first two objectives verified with two real browsers; a full run by human players not done here |
| 6 | Boss system and first boss | ✅ boss system (phases, per-phase attacks, combos, transitions, squad scaling) and The Abomination, playable as the boss of every tenth Survival wave; not yet in a mission (The Warden and Subject Zero belong to later missions) |
| 7 | Dead District, The Convoy | ✅ both scripted and tested: Dead District (map, script, `drive` step; full run in the simulation with the truck driven; browser scenario to the radio); The Convoy (escorted truck, lock/unlock, engine repair attached to the truck under fire; solo full run with the truck driven; failure on destruction; browser scenario to the warehouse district). Full runs by human players not done here |
| 8 | Black Site and miniboss | not started |
| 9 | Final Breach, Subject Zero | not started |
| 10 | Progression polish, balance, optimisation | PvE progression done (records, titles, unlocks, dedupe); balance needs playtests |
| 11 | Release preparation | 0.5.0 deployed on your go (2026-11-06); checks on real devices and GPUs still to do |

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
| **Two independent browsers complete a co-op objective** | `tests/e2e-p2p/outbreak.spec.ts` (two Chrome processes, WebRTC): both reach the hall (objective 1), host restores power while the guest covers (objective 2); both screens show the mission advancing | pass (2.3–2.9 min in software rendering; rerun after the Phase 1 merge) |
| No PvP regressions | full unit/integration suites; host-mode E2E: TDM (invite, reload, host close) and vehicles (guest drives, host shoots from the window, fight on foot) | pass; the vehicle spec first failed here on this branch **and on the untouched v0.4.0 tree** because of the test itself (empty rifle after the ride, car between the two players): fixed in the spec, see TESTING "Results 0.5.0" |
| Performance budget | tick cost by enemy count, bandwidth | see OUTBREAK.md §8 |
| Boss changes phase, can be defeated, telegraphs every attack | `pve.test.ts` "boss" (phases at 66/33 % with roar, defeat, slam damage only after its windup, debris aimed at the player, summons, Survival wave 10 ends only when it falls, ranged fallback on a cramped map); boss E2E scenario with screenshots | pass |

Found and fixed by the new tests: an AI state timer that made investigating enemies give up at
once; a "fat" line-of-sight check that let paths graze corners; holds advancing per server tick
(a 5 s generator hold took about 12 s at software-rendering frame rates).

## Phase 1 results

Built on a separate branch (`combat-visuals`, commit `f1f7b57`) and merged into `outbreak` in
`45a4513`. Client-only: no simulation, netcode or gameplay value changed, so PvP balance and the
server are untouched.

| Criterion | Evidence | Result |
|---|---|---|
| Crosshair styles dot / cross / circle / tactical / minimal; size, colour, opacity, thickness, outline, dynamic | `combat.crosshair.test.ts` (pure model, 20 tests); settings panel with a live preview drawn by the same geometry; screenshots of every style | pass |
| The crosshair shows the real spread | the gap is the weapon's current spread cone (`currentSpreadDeg`) plus a cosmetic kick, never smaller than the cone | pass |
| Crosshair aligned with the server trajectory | **bug found and fixed**: the camera zoom scaled the screen-space crosshair about the screen centre, drawing it up to 80 px off the cursor (and off the shot ray) at the edge of a 1280×720 window; verified by screenshot before and after, test on the transform | pass |
| Weapon, tracer and ray agree | weapon sprite on the aim axis (3 px offset removed); tracers start on the real ray at the point nearest the drawn barrel tip (`combat.weapons.test.ts`) | pass, sub-step residue documented in `combat/aim.ts` |
| Shot feedback: tracers per family, muzzle flash variants, impacts by surface (metal sparks, masonry dust and chips, map-edge dust), hull sparks | `combat.surfaces.test.ts` classifies impacts with real hitscan on real maps (6 tests); screenshots | pass |
| Hit / crit / armour / kill markers, merged damage numbers | `registerHit(kind)` API used by PvP and by enemy hits in Outbreak | pass |
| Weapon animations per category (recoil, shotgun pump, sniper bolt with casing, reload dip, swap raise) | `combat.weapons.test.ts` (15 tests); screenshots | pass |
| Quality Low / Medium / High, particle caps, pooling | `combat.budget.test.ts` (11 tests: one cap table, coalescing of impacts per frame, allocation-free bursts); live counts in the debug overlay | pass |
| Old settings keep working | `settings.migrate.test.ts` (4 tests: validated, clamped, legacy values) | pass |
| No PvP regressions after the merge | full suites; PvP host-mode E2E (TDM, invite link, reload, host close) | pass |

61 new tests in 5 files. Not verifiable here: how the effects look and cost on a real GPU (the
budgets are measured in software rendering only).

## Independent review of the PvE code

A separate agent, which had not written the code, reviewed the server-side PvE (read-only) and
reproduced each finding with scripts against the real `GameSimulation` (and, for one, the real
dedicated server). All 13 findings were confirmed and fixed; each fix has a regression test that
fails on the code before the fix and passes after it (checked by reverting the sources).

| # | Finding | Severity | Fix | Test |
|---|---|---|---|---|
| 1 | `downed` stayed set in the synced state after a failed run, so the next PvP match predicted a crawl and no shots | high | cleared when no PvE controller runs | `pve.test` + host-mode test (wipe → lobby → Deathmatch) |
| 2 | Two teammates holding E reset each other's revive | medium-high | one reviver at a time | `pve.test` |
| 3 | Dedicated server recorded PvE leavers as PvP matches (zombie kills into PvP stats and XP) | medium | leavers recorded for PvP only | `pve.integration.test` (real sockets) |
| 4 | The boss could be deleted by outrunning it | medium | bosses are relocated, never culled | `pve.test` |
| 5 | A brief disconnect failed the run in 1.5 s | medium | a seated, standing player still counts | `pve.test` |
| 6 | Leaving and rejoining was a free revive | low-medium | mid-run joiners enter at the next checkpoint | `pve.test` + host-mode test |
| 7 | Placed / ambient enemies at the cap could starve a wave | low-medium | minimum wave presence within the hard cap | `pve.test` |
| 8 | A vehicle rammed an enemy once per input frame (≈ 2.5× damage) | low-medium | per-enemy ram cooldown | `pve.test` |
| 9 | Last downed player of a shrinking squad got no self-revive; hits could beat a pending self-revive | low | decided while downed; bleed-out waits for it | `pve.test` (2) |
| 10 | Code vs doc: boss phase speed unused, squad supply factor unused, summons above 48, downed hits without attacker id, roar radius 0 | low | applied / removed from the doc / capped / fixed / synced | `pve.test`: summon cap, roar radius, attacker id (the phase speed multiplier has no test of its own) |
| 11 | Tick cost measured with standing players (fields cached): 4.8 ms avg, p99 12.5 ms with moving players | low | fields only for classes in use, allocation-free build (3–4× faster) | perf tests now strafe; flow fields vs reference Dijkstra on every map |
| 12 | Dedicated server applied room size and length to co-op rooms | low | ignored in PvE; co-op refused with more than 4 humans | `pve.integration.test` |
| 13 | Countdown used up Survival's start grace and counted in run times | low | run clocks start at the first live tick | `pve.test` |

The reviewer also confirmed as sound: settings validation against malicious guests, holds that
cannot be sped up by input bursts, identical door worlds on authority and clients, one kill
credit per enemy (chains, same-tick double hits), PvP paths with no PvE controller, reachability
of every spawn zone under every door state.

## Not verifiable here

Real GPUs (60 FPS target), school networks for WebRTC, a complete First Contact run by people,
balance by playtests.
