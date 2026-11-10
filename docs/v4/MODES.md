# SCRAPLINE modes expansion (0.7.0)

Design, architecture and status of the game mode system and of the first three new modes: **Gun
Game**, **Hide & Seek** and **Prop Hunt**, plus a party map (**Salvage Depot**), a Play screen, a
next-map vote and mode career stats. Every other mode of the brief is designed here and placed on
the roadmap with what it waits for; none is shown as playable.

## 0. Audit before the work (phase 0)

What existed on `main` at 0.6.2 (`ff02d52`) and what this expansion builds on:

| System | State found | Reused for |
|---|---|---|
| Authoritative simulation `GameSimulation` (server and host-mode tab run the same code) | Inputs, rewind (lag compensation), combat, spawns, pickups, vehicles, Domination/CTF, PvE runtime | Every new mode: controllers plug into it |
| Two room implementations (`ArenaRoom` dedicated, `HostRoom` in the browser) | Same lifecycle duplicated: lobby → countdown → playing → results → lobby | Shared end rules, vote and mode sync moved into `MatchRules` / `modes/sync.ts` |
| `MatchRules` (modes and teams, shared by both rooms) | Mode switch, teams, balance, map-for-mode | Extended: role modes, variants, rounds, start blocker, end reason, map vote |
| `@colyseus/schema` StateView (per-client views) | Used only for owner-only fields | Filtered collections for hidden information |
| Modes | Deathmatch, TDM, Domination, CTF, Vehicle Mayhem, Outbreak (5 missions, 2 bosses), Survival | Kept unchanged |
| Bots | Practice bots (BotBrain) for a lonely host | Gun Game practice; never in round modes |
| Vehicles, helicopters | Complete, tested | Not used by the new modes (Vehicle Pursuit waits, see §6) |
| Bosses (The Warden, Subject Zero) | Complete in the Outbreak campaign | Boss Rush will reuse them (§6), not a second AI |
| Career | JSON career per profile (per-mode played/wins/kills/deaths, challenges) | Extended with mode counters, no schema migration |

Production runs **host mode**: the arena creator's browser is the server. Everything below runs
unchanged in both rooms; host-mode specifics are noted where they matter (§3).

## 1. The game mode system (phase 1)

**Registry, data only** — `packages/shared/src/config/modes.ts`. `MODES` describes every mode:
id, name, blurb, category (competitive, party, co-op, vehicles), structure (ffa, teams, roles,
coop), players min/max, indicative length, main rules, respawn rule, victory, scoring, weapons,
vehicles, abilities, HUD kind, rewards, events, join-in-progress and disconnect behavior, quick
match availability, release status and feature flag. `PLANNED_MODES` holds the designed modes
that are not built (status "planned", what they need). Menus, lobby and rooms read the registry.

**Controllers, one per mode** — `apps/server/src/modes/`. `ModeController` is the interface
`GameSimulation` calls; the rooms never branch on a mode id:

| Hook | Used for |
|---|---|
| `reset` (PREPARING) | sides, rounds, ladder levels, before anybody spawns |
| `spawnPoint`, `onSpawn`, `respawnDelay`, `allowJoinSpawn` | where and with what players appear; `null` respawn = out until the next round; latecomers spectate |
| `onKill`, `onLeave` | ladder progression, conversions, finds, empty sides |
| `step` | round stages, timers, exposure, hints |
| `frozen`, `body`, `obstacles` | seekers in the pen, a locked prop, a prop's collision circle and speed, objects as bodies |
| `playerTargetable`, `shotTargets`, `onObjectHits` | shots meet Prop Hunt objects instead of the prop's body; innocent-hit penalty |
| `ability` | Prop Hunt transform / lock / taunt / decoy (validated server-side) |
| `publicPose`, `eventVisible`, `allyEntries`, `objectEntries`, `canSeeAlly`, `canSeeObjects` | hidden information (§3) |
| `over`, `overtime`, `standings`, `leaderScore`, `winningTeam`, `facts`, `sync` | end, ranking, results, career counters, HUD state |

`RoundMode` holds what Hide & Seek and Prop Hunt share (sides rotating in join order, stages,
points, spectating, exposure, per-side ghosts). The modes built before this expansion
(Deathmatch, TDM, Domination, CTF, Mayhem) still run on their original paths inside
`GameSimulation`; moving them behind controllers is listed as technical debt (§7), not done here,
to avoid touching tested code without a reason.

**Lifecycle** — `LOBBY → PREPARING → COUNTDOWN → ACTIVE → OVERTIME → RESULTS → REMATCH`, mapped
onto the existing room phases so the wire protocol and both rooms keep their tested flow
(`lifecycleOf` in `modes.ts`): PREPARING is the synchronous setup at the start (controller
`reset`) and, in round modes, the hiding stage; OVERTIME is a stage inside `playing` (Gun Game);
REMATCH is the results screen's ready + next-map vote. `MatchRules.endReason` decides the end of a
match for both rooms: PvE run, controller (`ladder`, `rounds`, `opponents-left`), score limit,
then clock (a controller may ask for overtime).

**Feature flags** — `modeFlags(spec)`: every available mode is on unless switched off
(`-prophunt`); a mode in development is off unless switched on (`+name`, `*`). Client:
`VITE_MODE_FLAGS`; dedicated server: `MODE_FLAGS`. Switched-off modes disappear from the menus and
are refused by both rooms.

**Lobby integration** — modes by category (available and enabled only), the selected mode's
rules, only compatible maps, variant and round count for round modes, "Needs N players" on the
start button and a server-side refusal below the minimum, no practice bots in round modes.

**Map compatibility** — `MapDef.modes` (explicit) or `mapModes(map)` (derived: classic modes on
every PvP map, Mayhem with vehicles, Gun Game and Hide & Seek off the large maps, Prop Hunt only
with transformable objects). `MapDef.party` carries the seeker pen, hider spawns, shadow zones,
hiding spots and transformable objects; `validateMap` checks them (free, reachable, no overlap,
not on a spawn). `MapDef.players` is the recommended player count.

## 2. The modes

### Gun Game (phase 2) — available

2–8 players (1 with practice bots), free for all, ≤ 8 minutes.

- Ladder `pistol → SMG → rifle → shotgun → sniper → pistol` (`GUN_GAME.ladder`, data). Five
  hand-held weapons exist, so the final level is the sidearm again rather than an invented weapon.
- An elimination with the current ladder weapon gives the next one at once; an elimination with
  the final weapon wins. Killed by somebody on a lower level: back one level (catch-up rule).
- The ladder weapon only, endless reserve; weapon pickups and vehicles off; health pickups on.
- Respawn 1.5 s with 1.5 s protection. At time out with a tie on the top level: 60 s overtime, the
  first player to stand alone on the top level wins.
- HUD: the ladder with the current level, top level, overtime badge, level-up banner and sound.

### Hide & Seek (phase 3) — available

2–8 players, rounds of 30 s hiding + 3 min search (rounds: 1–8, default 4).

- One seeker per five players, chosen in join order and rotating every round; the others hide.
- The seeker waits in the pen (Salvage Depot: the security booth; other maps: a spawn far from the
  hiders), frozen, behind a blindfold screen; the server publishes no hider position meanwhile.
- Seekers carry an SMG and a pistol; hiders are unarmed with 60 health and keep their dash.
- A hider is visible to the seeking side only while a seeker can actually see them: inside the
  screen box (1600×900 + look-ahead), in line of sight, within 150 px in a shadow zone, 60 px under
  a hiding spot; seen by one seeker = seen by the side. A "spot" alert reaches the seekers and the
  hider. Hold 0.6 s after the sight line breaks (no flicker).
- Variants: **Classic** (found = out until the next round, spectating), **Infection** (found
  hiders join the seekers), **Blackout** (lights out 14 s of every 36: the seeker sees only inside a
  28° flashlight cone up to 560 px or within 110 px; the client draws the same cone with the co-op
  light map).
- Points: hiders +1 per 10 s hidden, +5 for surviving the round; seekers +3 per hider found. Most
  points after the rounds wins.

### Prop Hunt (phase 4) — available

2–8 players, Salvage Depot, rounds of 30 s + 3 min (sides swap: one hunter per three players).

- Props turn into objects present on the map: crate, barrel, chair, cardboard box, bin, cooler
  box, potted plant, tire stack, traffic cone, vending machine (`DISGUISES`: collision radius,
  health, speed). Q opens the picker, E copies the object in front. Each object has the radius
  it is drawn with: a vending machine does not fit where a chair does (refused with a message).
- Lock position (C), taunt (T, +2 points, positional sound, 10 s cooldown), decoy (G, an innocent
  copy for 20 s, 30 s cooldown), quick transform during the hunt (8 s cooldown).
- Hunters: shotgun and pistol. A shot that hits only innocent objects costs 6 health (it can
  kill: no spraying); finding a prop heals 20.
- Most spots (85 %) get a real object each round, slightly moved and turned. When the hunt starts
  every object gets a fresh random id and the list is reshuffled; hunters receive all objects at
  that moment, none before. An undisguised prop is turned into a random object at hunt start.
- Hints at 1:30, 2:15 and 2:40 into the hunt: a circle that contains each remaining prop and is
  never centred on it (420, 300, 200 px). Standing still for 40 s earns that prop its own wide
  ping (360 px): an incentive to move, not a forced reveal.
- Points: props +1 per 10 s alive, +2 per taunt, +5 surviving the round; hunters +4 per find.

### Salvage Depot — the first party map

2240×1440 px: a racked warehouse (eight shelf runs, pallets), two offices (desks, chairs,
plants, a vending machine), a yard (containers, barrels, tires, cones, a generator), the security
booth where seekers wait. 60 transformable objects, 5 shadow zones, 5 hiding spots (tarps,
curtain, bushes), 12 spawns, 6 hider spawns, 4 pen spots. Modes: Deathmatch, Gun Game, Hide &
Seek, Prop Hunt (not symmetric, so no team modes).

## 3. Hidden information and anti-cheat

The server decides roles, objective state, transformations, health, damage, eliminations,
conversions, points, rounds, timers, rewards and victory; clients send inputs and ability
requests, validated with Zod (`abilitySchema`, `voteSchema`).

Secrets are kept off the wire, not hidden by the interface:

- **Masked poses.** A hidden player's public `x / y / aim` stay at the last pose the other side was
  allowed to see (`PlayerState.masked`). Their real pose travels in `MatchState.allies`, a
  filtered collection: each entry is added to the StateView of that player and their side only,
  so the encoder never writes it into anybody else's patches. The owner's prediction reconciles
  from its own ghost.
- **Per-recipient events.** In these modes gameplay events go out per client: spawn, dash, reload,
  pickup and shot events of a masked player reach their side only; "spot" reaches seekers and the
  hider; a hit on a prop reaches the shooter and the props.
- **Prop Hunt objects** are one anonymous entity type for real objects, decoys and disguised
  players (`DisguiseState`: kind, x, y, rotation — nothing else), filtered so hunters receive them
  only when the hunt starts. A prop's body is never targetable or published.
- **Verified on the wire**: unit tests decode what each client receives through real StateViews
  (`apps/server/test/partymodes.test.ts`); host-mode tests decode what a guest receives over the
  host's pipe (`apps/web/test/hostmode.partymodes.test.ts`); the two-browser E2E reads the
  seeking guest's received state over WebRTC (`tests/e2e-p2p/partymodes.spec.ts`).

Residual exposure, stated plainly:

- **Host mode host.** The host's tab runs the simulation and holds the full state; it draws only
  what its side may see, but a host who opens the developer tools can read everything. Between
  friends this is the accepted trade-off of host mode; the dedicated server enforces the rules for
  every client (`docs/HOST_MODE.md`).
- **Prop Hunt motion.** A modified client receives every object's position during the hunt, so it
  can notice an object moving anywhere on the map, where an honest player notices it only on
  screen. It cannot read who an object is, its health, or whether it is a decoy. Per-viewer
  interest management for moving objects is listed in §7.
- **Map knowledge.** The map file lists the object spots; real objects are moved and turned a
  little and 15 % of spots stay empty each round, so "not on a listed spot" is no proof, but an
  object far from any spot remains as suspicious as it is to an attentive player.

## 4. Lobby, matchmaking, progression

- Play screen (main menu → Play): categories as tabs (arrow keys, Home/End), one card per mode with
  players, length, compatible maps, main rules and real actions (quick match where offered,
  private room / arena); planned modes show "Planned" and what they need, with no button.
- Quick match offers Deathmatch, TDM and Gun Game; party and co-op modes run in private rooms.
- Joining a running round mode: spectate until the next round (sides rotate in join order).
  A seeker leaving ends the round; one human left ends the match ("opponents-left", not counted as
  completed); disconnected seats are held 20 s as everywhere.
- Rematch: results screen ready button plus a vote among the current map and up to two other
  compatible maps (current map wins ties).
- Career counters (stored in the career JSON, no migration): Gun Game wins and levels, seconds
  hidden, Hide & Seek rounds survived, hiders found, Prop Hunt wins, prop rounds survived, props
  found. Two daily challenges added (survive a party round, climb 8 Gun Game levels).
- XP: levels climbed (15 each), rounds survived (40), finds (25), capped at 400 per match and only
  for completed matches with the usual minimum participation (60 s); practice and abandoned matches
  give nothing. Nothing can be bought.

## 5. Measurements

Server tick cost and downstream bandwidth, 8 simulated players with random movement and fire for
60 s per mode, through the full room path (simulation, state mirroring, per-viewer encoding):
`pnpm --filter @scrapline/server exec tsx scripts/modebench.ts`. Measured 2026-11-09 on a 2-vCPU
Intel Xeon 2.1 GHz container:

| Mode (map) | Tick avg | Tick p99 | Tick max | Down per client |
|---|---|---|---|---|
| Deathmatch (Industrial Arena), baseline | 0.073 ms | 0.43 ms | 1.4 ms | 2.29 KB/s |
| Gun Game (Industrial Arena) | 0.104 ms | 0.90 ms | 12.4 ms | 2.34 KB/s |
| Hide & Seek (Salvage Depot) | 0.131 ms | 0.63 ms | 8.3 ms | 1.67 KB/s |
| Prop Hunt (Salvage Depot) | 0.262 ms | 3.63 ms | 4.6 ms | 1.88 KB/s |

The tick budget is 50 ms (20 Hz). Maxima include garbage collection and round restarts (all
objects granted at once at hunt start). Rendering frame rate was **not** measured on real GPUs
(this environment has only software rendering): run `/bench.html` on target hardware before
claiming 60 FPS.

## 6. Roadmap of the remaining modes (phases 5–10)

| Phase | Mode / work | Reuses | What it needs first | Status |
|---|---|---|---|---|
| 5 | **Infection** (survivors vs infected, dynamic sides) | RoundMode sides and conversion (already used by the Hide & Seek Infection variant), event filtering | Infected movement profile and melee against players (a melee weapon path in the shared sim), supply drops, shrinking safe zones | Built in 0.8.0 (§8): claws as a short-range weapon; no supply drops or safe zones |
| 6 | **Sabotage 2v2** (rounds, no respawn, plant / defuse on two sites) | RoundMode rounds and side swap, Domination capture holds for plant/defuse | Compact symmetric maps with two sites; round economy kept off (no pay-to-win) | Built in 0.8.0 (§8) |
| 6 | **Bounty Hunt** (marked target, periodic approximate pings) | Prop Hunt hint pings (approximate, never centred), FFA standings | Ping cadence and target rotation rules | Built in 0.8.0 (§8) |
| 7 | **Extraction** (PvE first, then PvP) | Outbreak missions (carried objective, extraction steps, vehicles), WaveDirector | A carried-object mechanic for players (drop/pick up) | Built in 0.8.0 (§8) |
| 7 | **Chaos Arena** (timed modifiers) | Mode controller hooks (body, frozen, loadout) | A modifier system with a compatibility matrix and guaranteed reset of every modified state | Built in 0.8.0 (§8) |
| 8 | **Vehicle Pursuit / Convoy** | Vehicle system (complete, tested), The Convoy's escorted truck | Checkpoints and road routes on the large maps; helicopter balance rules | Built in 0.8.0 (§8) |
| 8 | **Boss Rush** | The Warden and Subject Zero (Outbreak), PvE runtime | An arena sequence and between-fight supply rules; no second AI system | Built in 0.8.0 (§8) |
| 9 | More party maps, effects, balance passes | Salvage Depot pattern (`MapDef.party`) | Real playtests with 4–8 people | Open |
| 10 | Release: benchmarks on real GPUs, security review, deploy | `/bench.html`, `modebench.ts` | Your hardware and your approval to deploy | Open |

Original modes evaluated (§12 of the brief): **Zone Shift** (moving Domination point: small, reuses
Domination entirely — best next candidate), **Hot Potato** (device with countdown: needs a
carried-object mechanic, same as Extraction), **Last Light** (generators keeping the lights on:
reuses the Blackout light map and Outbreak generators), **Double Agent** (secret objectives: hard
to make readable and verifiable, not recommended).

## 7. Known limits and technical debt

- The five classic modes still live inside `GameSimulation`, not behind controllers.
- Prop Hunt: no per-viewer interest management for moving objects (§3); objects do not block
  bullets differently by size beyond their circle; props cannot sit on top of each other.
- Hide & Seek on maps without party data uses line of sight only (no shadows or hiding spots) and a
  spawn as the pen.
- Balance (hider health, hint timings, penalty, points) is untested with real players.
- Host mode: the host can read secrets with developer tools (§3).

## 8. The 0.8 modes (Infection, Chaos Arena, Bounty Hunt, Sabotage, Vehicle Pursuit, Convoy)

First, deliberately simple versions on the existing machinery. Tuning in
`packages/shared/src/config/extraModes.ts`; controllers in `apps/server/src/modes/`.

| Mode | Controller | Rules as built |
|---|---|---|
| Infection | `Infection.ts` (extends `RoundMode`) | 1 infected per 8 players (rotates), claws only (`claws`: 3 short rays, 72 px, +12 % speed via the weapon's move multiplier, so prediction stays exact); survivors: loadout + sidearm, endless reserve; fallen survivor → infected after 2 s; infected cannot be hurt in the pen; the round goes on while anybody is infected; last survivor pinged every 4 s; prep 8 s, round 150 s |
| Chaos Arena | `Chaos.ts` | Free-for-all to the elimination limit; one of 11 rules every 30–45 s (damage ×2/×3, a weapon for everyone, vampire 50 %, regeneration, full shields); pickups of weapons and chests off during weapon rules; weapons carried before a weapon rule are given back |
| Bounty Hunt | `Bounty.ts` | Target = the leader standing (first player at the start); +1 / 2 s alive, +5 for the bounty, +1 per other elimination; ping every 5 s, 220 px ring offset from the target; first to the point limit (default 60) |
| Sabotage | `Sabotage.ts` (extends `TeamRounds.ts`) | Sites = the map's Domination A and C points; plant 3 s, defuse 5 s, fuse 35 s, round 100 s; no respawns in a round; elimination wins a round (after a plant the defenders must still defuse); sides swap at half; a team with more than half the rounds wins early |
| Vehicle Pursuit / Convoy | `Pursuit.ts` (extends `TeamRounds.ts`) | Route from the attackers' flag stand: centre point, far point, destination at the defenders' flag stand; Pursuit counts any runner (on foot or driving), Convoy only the truck (the parked ground vehicle nearest the escorts' base, made armored when it fits); respawn 4 s; round 150 s (Convoy 180 s); sides swap every round |

Shared additions: `MatchState.marks` (objective markers: kind, position, radius, team colour,
progress, label, and a "hold E" prompt shown to one team inside the radius), `MatchState.modeText`
(one status line), the `announce` event (banner for everybody), controller hooks `damageScale`,
`onDamage`, `markEntries`, `statusText`, `vehicleSpawns`; `TeamRounds` for round-based team modes
(round clock and number in the team HUD, rounds won as the team score).

Co-op operations are Outbreak missions (`chapter: 0`) with their own Play card: **Extraction**
(three cargo cases, then the helipad under a horde) and **Boss Rush** (the three bosses as wave
leaders in the Final Breach atrium, a supply drop after each). Both are played through in
`apps/server/test/operations.test.ts`.

Not done, stated plainly: no balance from real playtests; bots do not plant, defuse, drive the
truck or chase the bounty (they only fight); Pursuit routes are derived from the map's objective
points, not hand-authored roads; the infected have no special vision or abilities.
