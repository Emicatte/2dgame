# Game design

## Pitch

Salvage crews settle scores in abandoned industrial yards, rain-soaked city blocks and desert
outposts. Fast top-down deathmatches: 7 minutes or 20 eliminations, 2–8 players, instant respawn,
one primary weapon of your choice plus a sidearm, map pickups for power weapons.

Design pillars, in priority order: **readable** (you always see who is where and what hit you),
**responsive** (your own movement and shots never wait for the network), **fair** (server decides
everything, symmetric maps, cosmetic-only progression), **short loop** (back in the action in
seconds).

## Player

| Property | Value |
|---|---|
| Health | 100, no regeneration; health packs restore 50 |
| Speed | 265 px/s (× weapon mobility), acceleration 2600 px/s², deceleration 2300 px/s² |
| Dash (Shift) | 760 px/s for 0.14 s, 1.6 s cooldown, direction = movement (or aim if standing) |
| Hitbox | circle, radius 18 px |
| Respawn | 3 s after elimination, at the spawn farthest from living enemies and out of their line of sight when possible; never on top of another player |
| Spawn protection | 1.5 s of invulnerability, cancelled the moment you fire |

Body and weapon rotate to the aim direction; feet step along the movement direction, so strafing
reads clearly from above.

## Weapons

Data-driven in `packages/shared/src/config/weapons.ts`. All weapons are hitscan with lag
compensation; tracers are visual only. Spread grows with sustained fire (bloom) and with movement.
Every weapon is available from level 1: progression is cosmetic only.

| Weapon | Slot | Mode | Damage | Pellets | RPM | Mag | Reserve | Reload | Spread (still / moving) | Full damage → max range | Mobility |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Warden P9 (pistol) | sidearm | semi | 26 | 1 | 400 | 12 | ∞ | 1.1 s | 1.2° / +1.5° | 450 → 950 px (60 %) | ×1.00 |
| Halberd AR (assault rifle) | primary | auto | 18 | 1 | 600 | 30 | 120 | 1.8 s | 1.0° / +2° | 700 → 1350 px (65 %) | ×0.92 |
| Wasp SMG | primary | auto | 13 | 1 | 900 | 35 | 140 | 1.5 s | 2.6° / +1° | 340 → 800 px (50 %) | ×1.06 |
| Breacher 12 (shotgun) | primary | semi | 13 × 8 | 8 | 72 | 6 | 30 | 2.3 s | 9° cone | 170 → 540 px (25 %) | ×0.95 |
| Longwatch .50 (sniper) | primary | semi | 95 | 1 | 46 | 5 | 20 | 2.6 s | 0.15° / +9° | 2400 px | ×0.86 |

Special characteristics: the pistol has infinite reserve and the fastest draw; the SMG makes you
faster; shotgun pellets spread evenly across the cone (consistent, not lottery); the sniper shows a
laser sight to everyone (counterplay) and is inaccurate on the move; 95 damage means a full-health
target survives with 5 HP, so a follow-up is always required.

Time to kill at close range with all hits: pistol 4 shots (0.45 s), rifle 6 (0.5 s), SMG 8 (0.47 s),
shotgun 1 shot within 170 px, sniper 2 shots.

Adding a weapon: add an entry to `WEAPONS` with a new stable `index`; the simulation, HUD, loadout,
sound synthesizer (parameters in `sound`) and sprite generator pick it up. Skins per weapon are a
planned extension of the cosmetic system.

### Loot chests and shields (0.7.0)

Chests on every PvP map (`packages/shared/src/maps/chests.ts`) open with E and drop their loot
on the ground next to them: a random weapon (`CHEST_WEAPONS`, weighted), a shield cell and an ammo
box; then they stay closed for 40 s. Nothing is given automatically (0.7.1):

- **Weapons** on the ground are taken with E, one per press (the nearest within reach). A weapon
  goes in the free pickup slot; with that slot taken, it replaces the held weapon (holding the
  sidearm: the pickup slot; the sidearm is never replaced). The weapon you had stays on the ground
  with the ammo it had, and anyone can take it. Same rule for the map's weapon pickups. Taking a
  weapon you already carry adds its ammo instead.
- **Shield cells** are taken by walking over them, up to 3 carried (HUD counter), and used when
  you decide with X (rebindable): +50 shield, max 100, absorbed before health. Cells are lost on
  death; with a full shield the cell is kept.
- **Ammo boxes** are taken by walking over them when something is missing.
- Items on the ground vanish after 45 s, at most 48 at once (`DROPS` in `config/weapons.ts`). Chest-only weapons (`slotKind: "loot"`, never in loadouts): Talon
Carbine (fast assault rifle), Vanguard BR (semi-automatic battle rifle), Grinder minigun (1300 rpm,
150-round drum, slow to carry), Hammer RPG (one rocket per reload, explodes on impact: up to 110
damage within 130 px, no self or team damage). Numbers are data in `config/weapons.ts`.

### Slots and pickups

Slot 1 = chosen primary, slot 2 = Warden P9, slot 3 = weapon picked up on the map (E). Weapon
crates respawn after 25–35 s; ammo boxes refill reserves; health packs restore 50 HP (only taken
when injured).

## Maps

All maps are 2560 × 1664 px and **point-symmetric**: one half is authored, the other is its 180°
rotation, so every route, cover spot, spawn and pickup has a counterpart. Automated tests check
that every spawn and pickup fits a player and is reachable on foot, that solids are inside the
bounds and that symmetry holds.

| Map | Character | Solids / spawns / pickups | Power weapons |
|---|---|---|---|
| Industrial Arena | Container yards, a hydraulic press hall, catwalk railings, a crossfire center with four diagonal entrances | 54 / 12 / 11 | Shotgun and SMG on the flanks, sniper in the center |
| Neon District | Tower blocks along the edges, 160 px streets, alleys, parked cars, a kiosk plaza; neon signs light the streets | 39 / 12 / 10 | Shotgun, SMG, two rifles around the kiosk |
| Desert Outpost | Long sightlines, ruined guard houses, rock outcrops, sandbag lines, a central water tower | 43 / 12 / 8 | Snipers inside the ruins, shotguns by the wrecks |

Maps are plain data (`packages/shared/src/maps/*.ts`): solids (rectangles with a visual kind),
decals, lights, spawns and pickups. A Tiled importer would convert an object layer of rectangles to
the same `SolidDef` list; the renderer and simulation would not change.

**Salvage Depot** (0.7.0, 2240 × 1440 px, not symmetric): the first party map, for Prop Hunt and
Hide & Seek (also Deathmatch and Gun Game). Racked warehouse, two offices, a yard and a security
booth for the seekers; 60 transformable objects, shadow zones and hiding spots
(`MapDef.party`). Maps declare the modes they support (`MapDef.modes`) or get them derived from
their features (`mapModes`).

## Modes

Competitive: Deathmatch, Team Deathmatch, Gun Game, Domination, Capture the Flag. Party: Hide &
Seek (Classic, Infection, Blackout), Prop Hunt. Co-op: Outbreak, Survival. Vehicles: Vehicle
Mayhem. Rules, numbers and the planned modes: [v4/MODES.md](v4/MODES.md); Domination, CTF and
Mayhem: [v2/SYSTEMS.md](v2/SYSTEMS.md); Outbreak: [v3/OUTBREAK.md](v3/OUTBREAK.md).

## Match rules (configurable per private room)

| Setting | Default | Range |
|---|---|---|
| Mode | Deathmatch | — |
| Duration | 7 min | 2–20 min (UI offers 3, 5, 7, 10, 15) |
| Eliminations to win | 20 | 5–100 |
| Max players | 8 | 2–8 |

Ranking: eliminations, then fewer deaths, then who reached the score first.

## Progression

Server-side only (`computeMatchXp`), never from client data.

| Source | XP |
|---|---|
| Match completed (≥ 60 s of participation) | 100 |
| Per elimination (max 30 counted) | 20 |
| Victory (2+ players) | 150 |
| Podium (top 3 with 4+ players) | 50 |
| First blood | 30 |
| Best streak ≥ 3 / ≥ 5 | 40 / 80 |
| Sharpshooter (≥ 20 shots, ≥ 40 % accuracy) | 30 |
| Cap per match | 1500 |

XP to next level: `300 + 120·(L−1) + 8·(L−1)²`. Total XP for level 20: 43 092 (about 40–60 average
matches). `MAX_LEVEL` and the formula can be raised without migrations.

Rewards (cosmetic skins): Foundry, Ash (L1), Rust (L2), Cobalt (L4), Moss (L6), Signal (L8),
Dune (L10), Neon Runner (L12), Ivory (L15), Obsidian (L18), Prism (L20).

Tracked stats: matches, wins, losses, eliminations, deaths, K/D, accuracy (shots with at least one
pellet on target / shots fired), time played, XP, level. Leaderboard by level, eliminations or wins.

## Art direction

- **Identity**: "industrial salvage sci-fi" — graphite surfaces, stencil labels, chamfered corners,
  hazard stripes, one molten-orange accent and a signal-cyan secondary. No glassmorphism, no
  decorative gradients.
- **Readability first**: players carry a ground ring (cyan = you, red = enemies) that reads on all
  three palettes; weapons have a colored stripe matching their tracer color.
- **All art is procedural**: soldiers, weapons, props and maps are drawn with Canvas 2D at boot at 2×
  resolution; static map geometry is baked into one texture (one draw call). Lights are additive
  glow sprites with optional flicker; the camera gets a vignette filter on High quality.
- **Game feel**: muzzle flash + light, streak tracers, wall sparks, armor sparks on hit (no gore),
  hit markers (white, red on kill), floating damage numbers, recoil kick, short camera shake
  (adjustable), damage direction arc, low-health vignette, spawn ring, death burst.
- **Audio**: every sound is synthesized with Web Audio from per-weapon parameters (body, crack,
  noise, decay), spatialized by distance and stereo pan, through a compressor; separate master,
  effects and interface volumes.

## UI

Menus and HUD are React DOM over the canvas, scaled for 1366×768 and up. HUD: health and dash
meter (bottom-left), ammo, weapon and slots (bottom-right), timer and scores (top), kill feed
(top-right), ping and connection state (top-left), optional FPS/network overlay, interaction
prompts, death/respawn panel, countdown, scoreboard on Tab, pause menu on Esc.
