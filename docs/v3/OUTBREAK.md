# SCRAPLINE 3.0 · Outbreak systems reference

Co-op PvE for 1–4 players: Outbreak missions and Survival Endless. Every number below is data in
`packages/shared/src/config/zombies.ts` and `packages/shared/src/pve/missions.ts`; the simulation
only reads those values.

## 1. Authority and where the code lives

| Piece | Code | Runs on |
|---|---|---|
| Enemy types, difficulty, squad scaling | `packages/shared/src/config/zombies.ts` | everywhere (data) |
| Navigation: grid, flow fields, A* | `packages/shared/src/sim/nav.ts` | authority (and tests) |
| Missions, Survival waves | `packages/shared/src/pve/missions.ts` | everywhere (data) |
| Door-aware collision worlds | `packages/shared/src/pve/world.ts` | authority and every client (same worlds) |
| PvE progression (campaign, records, dedupe) | `packages/shared/src/pve/progress.ts` | recorder (host-mode browser profile) |
| Enemies: perception, AI, steering, attacks, projectiles, hazards | `apps/server/src/pve/ZombieWorld.ts` | authority |
| Waves | `apps/server/src/pve/WaveDirector.ts` | authority |
| Mission script, co-op rules, props, loot, results | `apps/server/src/pve/PveController.ts` | authority |
| Room rules (settings, end, results) | `apps/server/src/pve/pveRoom.ts`, `MatchRules` | both rooms |
| State mirroring | `syncPve` in `apps/server/src/simulation/stateSync.ts` | both rooms |
| Rendering, telegraphs, HUD | `apps/web/src/game/pve/*`, `screens/PveHud.tsx`, `PveLobby.tsx` | client |

"Authority" is the dedicated server's `ArenaRoom` or, in host mode (the current Vercel
deployment), the arena creator's tab (`HostRoom`). Both run the same `GameSimulation`, which owns
the `PveController`: spawns, AI decisions, positions, collisions, attacks, damage, deaths, mission
steps and rewards are decided there only. Clients render, interpolate, animate and play sound.

## 2. Navigation

- **Grid**: 24 px cells. Each cell stores the largest clearance class whose circle fits at its
  centre: class 1 = bodies up to 16 px (walker, runner, spitter, stalker), class 2 = up to 26 px
  (brute, exploder). A brute never plans through a gap only a walker fits.
- **Flow fields**: multi-source Dijkstra with Dial's bucket queue (integer costs 10/14,
  8-connected, no corner cutting). One field per chased player and class; rebuilt only when that
  player changes cell, at most two rebuilds per tick, round-robin. Measured: 134 × 94 cells
  (Halvorsen Works) in about 1.4 ms per field (Node in this container).
- **Steering along a field**: walk downhill up to 5 cells and head for the farthest cell the
  body reaches in a straight line (three parallel rays at the full radius: solids are ≥ 24 px
  thick, so none slips between the rays).
- **A***: individual goals (investigating a noise, wandering, flanking, retreating), octile
  heuristic, line-of-sight string pulling, 4 searches per tick at most.
- **Doors**: a mission door is a solid while closed. Opening one updates only the affected cells
  of the grid and invalidates cached fields and paths.
- Movement is always resolved against the collision world (`resolveCircle`), whatever the
  navigation says. Tests walk every path in 6 px steps and check every enemy every tick for
  overlap with solids.

## 3. Enemy AI

States (synchronized as `ZombieState.st`): Idle, Wander, Alert, Investigate, Chase, Attack,
Stunned, Dead.

- **Perception**: sight needs line of sight within range (×0.75 while unaware); gunfire, loud
  props (generator, gate panel) and blasts emit noise; enemies within `noise radius × hearing`
  turn Alert (a visible "!") and Investigate the spot. Being shot alerts an enemy to the shooter.
- **Wave enemies** (horde) follow the flow field to the nearest reachable player (standing
  players preferred over downed ones, with hysteresis). **Stalkers never get this knowledge**:
  they hunt by sight and sound, prefer the player farthest from teammates, circle to a point
  behind the prey, break line of sight when looked at, and pounce from the side or behind.
  After 15 s without a target they pick up the scent of the most isolated player.
- **Spitters** keep their preferred range (strafe, back away if rushed); **runners** weave;
  **exploders** walk in on a lit fuse.
- **Decision rate**: 10 Hz within 900 px of a player, 4 Hz to 1800 px, 2 Hz beyond, staggered
  by id. Movement every tick. Crowd separation with a spatial hash (heavier bodies shove
  lighter ones). Enemies never push players (no client misprediction from crowds); attacks do
  (knockback goes through reconciliation like run-overs).
- **Stuck handling**: no progress for 2 s → repath and jitter. Wave enemies that stayed more
  than 1200 px from every player for 22 s are culled (waves always end).

### Telegraphed attacks

Every significant attack has a windup the client draws from `act`/`at`/`tx`/`ty`:

| Enemy | Attack | Windup | Telegraph | Punish window |
|---|---|---|---|---|
| Walker | melee 12 | 0.45 s | red arc in front, growing | 0.7 s recover |
| Runner | melee 8 | 0.28 s | red arc | 0.5 s |
| Brute | melee 28 + knockback | 0.7 s | red arc | 1 s |
| Brute | charge 35 + knockback (170–460 px, every 6 s) | 0.85 s | red lane with a filling bar | wall hit: stunned 1.6 s, takes ×1.6 damage |
| Spitter | acid 14 + puddle (12 dps, 3.5 s) | 0.65 s | dotted line + target ring | 1.7 s |
| Stalker | pounce 30 | 0.4 s | dotted red line | 1.3 s; wall hit: stunned 0.8 s |
| Exploder | blast 55 (radius 125, 35 % at the edge) | 0.9 s | blast circle filling up | dies on detonation; also detonates when killed (hurts other enemies ×2) |

Damage numbers are Veteran; difficulty multiplies them. Precision hits (pellet within 40 % of
the radius from the centre) deal ×1.5 and show as critical.

### Boss: The Abomination (`ZOMBIES.abomination`, BossController in `ZombieWorld`)

Bosses are data: health thresholds split the fight into phases, each with its own attack set,
speed and windup multiplier (windups get shorter, never disappear). The boss picks the first
ready attack whose distance band fits; attacks have per-attack cooldowns; a phase transition is
a roar (shove, no damage; the boss takes 10 % damage meanwhile).

| Phase | Health | Attacks (windup) | Changes |
|---|---|---|---|
| 1 | 100–66 % | slam r 170 (1.1 s), charge lane (1.0 s), melee | — |
| 2 | 66–33 % | + lobbed debris on marked circles (0.77 s), summons 4 walkers | speed ×1.15, windups ×0.85 |
| 3 | < 33 % | slam → charge combo, three-piece debris volley, summons 4 runners | speed ×1.25, windups ×0.75 |

A charge into a wall stuns it for 2.4 s (×2 damage taken): the intended punish. Health scales
with the squad (× 1 + 0.45 per extra player), unlike regular infected. On maps narrower than its
body it follows the large-body field and slides along walls; if it is still cut off it keeps
throwing debris. HUD: boss bar with phase notches; telegraphs come from the synchronized attack
kind, windup length and radius. It leads every tenth Survival wave; the wave ends when it falls.

## 4. Waves

`WaveDirector` turns a wave definition (counts for one Veteran player) into a queue:

- Walkers and runners × squad density × difficulty density; specials (spitter, stalker,
  exploder) at least 1 each, scaled more gently and by the special bonus; brutes +30 % per extra
  player. Specials are spread through the queue, never front-loaded.
- Batches every `1.8 s × squad pace × difficulty pace`, `1 + fronts + players/2` enemies per
  batch, each from a different zone of the `fronts` (1 for one player, 3 for four).
- Simultaneous cap: squad table × difficulty density, never above 48 (performance budget).
- Valid spawns: a cell the body fits, at least 480 px from every player and out of their line of
  sight unless 1050 px away, not on another enemy; mission zones first, then generic candidates.
- Termination: stragglers culled (above); after `45 s + 2.5 s × enemies` the survivors are
  enraged (faster, hunt directly).

Squad scaling (health grows only a little; pressure comes from numbers, pace and directions):

| Players | Density | Max alive | Pace | Enemy HP | Specials | Supplies | Fronts |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 18 | 1 | 1 | +0 | 1 | 1 |
| 2 | 1.55 | 26 | 0.82 | 1 | +0.04 | 1.3 | 2 |
| 3 | 2.05 | 34 | 0.7 | 1.05 | +0.08 | 1.6 | 2 |
| 4 | 2.5 | 42 | 0.62 | 1.1 | +0.12 | 1.9 | 3 |

Difficulty: Recruit (damage ×0.7, HP ×0.85, density ×0.8, bleed-out 40 s, 2 solo self-revives),
Veteran (×1, 30 s, 1), Nightmare (damage ×1.35, HP ×1.2, density ×1.25, bleed-out 20 s, none).

**Survival Endless**: waves 1–5 follow the design table (8 walkers; 12 walkers + 3 runners;
mixed + supply; mixed + brute; brute pack); afterwards the horde grows by 3 per wave and
spitters, exploders and stalkers unlock; every 5th wave is a brute pack; a supply crate every 3
waves; 15 s intermission. Offered on Halvorsen Works (doors open), Industrial Arena and Tactical
Facility (with its vehicles).

## 5. Co-op rules

- All humans are on one side (team 1); shots pass through teammates. No practice targets.
- **Downed** instead of dead: crawl at 28 % speed, cannot fire, reload or switch; hits while
  downed shorten the bleed-out. A teammate holds E within 60 px for 3.2 s (a 0.35 s release
  resets it) → back up with 40 HP (Veteran) and 1.5 s of protection.
- **Solo**: one self-revive on Veteran (two on Recruit, none on Nightmare), 6 s after going down.
- Bled-out players return at the next checkpoint (mission step completed, wave cleared), next to
  a standing teammate or at the step's checkpoint.
- **Mission failed** when nobody is standing for 1.5 s (a pending self-revive keeps the run).
- Holds (revive, generator, keycard, gate panel, supply crates) advance by input frames
  (1/60 s), so a low frame rate or bursty link neither slows nor speeds them.
- Loot: enemies drop ammo (7 %) and health (3.5 %) × supply factor; supply crates refill
  ammo and health once per player.
- Vehicles: enemies attack the hull of the vehicle their target sits in; vehicles plough through
  enemies (credited to the driver), a brute dents the hull; wreck explosions hurt enemies.

## 6. First Contact (Halvorsen Works)

Steps, each with an integrated tutorial hint:

1. **Enter the main hall** (walkers wander the yard and idle in the hall).
2. **Restore power at the generator**: hold E 5 s; it is loud (noise every second). Power on,
   alarm on, generator shutter opens, courtyard group appears.
3. **Hold the courtyard**: 3 waves (walkers; + runners, supply crate; + runners and an exploder).
4. **Find the security keycard in the offices** (the office door opens; a brute guards it).
5. **Open the security gate**: hold E 3 s at the panel, keycard required.
6. **Reach the helipad and hold until extraction**: everyone alive must be on the pad for 15 s
   (progress decays when someone is off it) while a horde swarms the gate.

Ambient trickle (walkers, runners) outside scripted waves. Mission XP 900 × difficulty, title
"First Responder" on the first completion. The rest of the campaign is listed in the lobby as
in development and cannot be selected (no placeholder missions).

## 7. Network protocol additions

All additions use the existing channels (state patches, event batch per tick):

- `MatchState.zombies` (`ZombieState`: kind index, x/y int16, facing uint8 in 1/256 turns, hp,
  max hp, AI state, attack phase + start tick + telegraph target, attack kind + windup ticks +
  area radius), `hazards`, `props` (mission
  props, supply crates, loot), `pve` (`PveState`: mission, difficulty, step, progress, counters,
  wave, enemies left, next wave tick, status, power, alarm, open doors, flags, self-revives,
  kills, boss id). `PlayerState`: `downed`, `bleed` (tenths of a second), `revive`, `revives`.
- Events: `zhit` (damage to an enemy, precision/armor flags), `zdie`, `zatk` (attack lands),
  `proj` / `projx` (acid or lobbed debris: flight and landing; debris carries its landing point
  and radius `tx`/`ty`/`r`, drawn as a warning circle during the flight), `boom`,
  `down`, `revive`, `bleed`, `pve` (step, wave, clear, hint, door, prop, supply, bossPhase,
  complete, failed). A player hit by an enemy gets the usual `hit` with `p = "z:<id>"`.
- Settings: `mission`, `difficulty` (host only, validated: unknown missions are refused).
- Results: `ResultsMessage.pve` (squad summary) and `PersonalResult.record.pve` with a `runId`.
  The receiving browser records a run once per id; PvP stats (kills, deaths, wins, career) are
  not touched by PvE.
- Measured: 40 moving enemies ≈ 288 B per tick, 5.6 KB/s per client.

## 8. Budgets and measurements (this container, Node 22, not real devices)

| Metric | Budget | Measured |
|---|---|---|
| Authoritative tick, 4 players, 40 enemies chasing | p99 < 25 ms | avg 0.47 ms, p99 3.5 ms |
| Same, 10 / 20 / 30 / 40 / 48 enemies | p99 < 25 ms | avg 0.34–0.48 ms, p99 1.2–7.1 ms (first runs include JIT warm-up) |
| Flow field, whole mission map | < 25 ms | 1.4 ms |
| Downstream per client, 40 moving enemies | < 20 KB/s | 5.6 KB/s |
| Simultaneous enemies | ≤ 48 | enforced |

Not measured here: rendering cost on real GPUs (the test browser renders in software, its FPS is
not representative), WebRTC on school networks, a full First Contact run by human players.
