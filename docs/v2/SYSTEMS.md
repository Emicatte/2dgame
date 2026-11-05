# SCRAPLINE 2.0 systems: vehicles, maps, modes, progression

Reference for what phases 2–6 added. Every number below is data in `packages/shared/src/config/`
(vehicles, weapons, modes, progression, career); the simulation reads only those values, so
balancing never touches game code. Tests pin the behaviour, not the numbers.

## 1. Vehicles

### 1.1 Model (`packages/shared/src/sim/vehicle.ts`)

One deterministic step per 60 Hz input frame, the same code on the server and on the driver's
client (prediction + reconciliation, like player movement).

- **Ground vehicles**: the body turns first (yaw rate grows with forward speed up to
  `turnSpeedRef`, so nothing spins on the spot; reversing flips the steering), the velocity stays
  in world space and is split into forward and lateral parts. Throttle/brake/reverse act on the
  forward part, tyre grip bleeds off the lateral part (`grip`; the handbrake lowers it to
  `handbrakeGrip` for a controlled drift), rolling resistance (`coastDrag`) stops a coasting
  vehicle.
- **Collision**: the hull is 2–3 circles on its axis, resolved with the existing
  circle-vs-rectangle resolver against walls and against other vehicles (as obstacles). The
  normal velocity is removed with a small bounce; glancing hits at the nose or tail twist the
  body. Top speed is 9.3 px per step against 18 px circles and 24+ px walls: no tunnelling
  (tested at full speed into a wall).
- **Helicopter**: Shift (the dash key) toggles take-off/landing on its press; the rotor spins up
  (1.4 s), then it climbs to cruise altitude (1.6 s). Thrust needs altitude; WASD move in screen
  axes, the nose turns towards the pilot's aim. In the air (altitude ≥ 0.35) it collides only with
  **tall** solids (buildings, pillars, fuel tanks) and the map edge. Landing needs a clear
  footprint: over walls, crates or another vehicle it keeps hovering ("Cannot land here").
  Without a pilot it lands by itself where it can.

### 1.2 Types (`packages/shared/src/config/vehicles.ts`)

| | Hatch (car) | Rover (off-road) | Bulwark APC (light armored) | Kestrel (helicopter) |
|---|---|---|---|---|
| Hull (length × width, px) | 72 × 36 | 78 × 40 | 88 × 48 | 92 × 40 |
| Health | 420 | 520 | 900 | 600 |
| Bullet damage taken | 100 % | 90 % | 40 % | 75 % |
| Top speed (px/s, ≈ km/h) | 560 (≈ 100) | 500 (≈ 90) | 330 (≈ 60) | 430 (≈ 77) |
| Mass (ramming, collisions) | 1.0 | 1.3 | 2.4 | 1.6 |
| Seats | driver + 3 passengers | driver + 3 passengers (2 in the open bed) | driver + **gunner** (MG turret, 360°) + 2 enclosed passengers | **pilot** + **gunner** (chin gun, front arc) + 2 door passengers |
| Respawn after destruction | 25 s | 25 s | 40 s | 45 s |

### 1.3 Seats

Seats are data: role, position in the vehicle frame, fire sector (centre + half-width), exposure
(how much of a bullet that reaches the occupant gets through; 0 = protected, not a target) and an
optional mounted weapon.

- **E** enters the nearest vehicle within reach: the driver's/pilot's seat if free, otherwise the
  first free seat. Allowed while the vehicle moves slower than its entry limit (helicopter: only
  on the ground). Never into a vehicle held by the other team. Flag carriers stay on foot.
- **F** moves to the next free seat. **E** inside leaves, to a free spot beside the seat (then
  the other side, the back, the front); refused while too fast or a helicopter is above 20 %
  altitude.
- Seats are claimed one input at a time on the server, so two players can never hold the same
  seat (tested with two presses in the same tick).
- Drivers and pilots cannot fire. Passengers fire their own weapons, only inside their window's
  arc: the client strips the trigger outside the arc (so prediction and the server agree), the
  server re-checks with a small tolerance. Gunners use the mounted gun (it replaces the pickup
  slot while seated and the previous weapon comes back on leaving).
- Shots from a seat leave from the seat **as the shooter saw the vehicle** (the server rewinds
  the vehicle to the shooter's view tick, like it rewinds targets).
- A player who disconnects is taken out of the vehicle at once (a frozen driver must not hold the
  car); the vehicle coasts to a stop.

### 1.4 Damage

| Event | Rule |
|---|---|
| Bullet on the hull | damage × the vehicle's bullet factor; credited to the shooter |
| Bullet on an exposed occupant | damage × the seat's exposure; a pellet that crosses an exposed occupant hits them, not the hull around them |
| Wall crash | above 260 px/s into a wall: (speed − 260) × 0.35 to the vehicle, no credit |
| Vehicle vs vehicle | above 150 px/s closing: (speed − 150) × 0.4 to each, scaled by √(mass ratio) (the lighter takes more); momentum pushes the other body; credit to the other driver |
| Run-over | contact with a player on foot pushes them aside; above the vehicle's minimum ramming speed (90–110 px/s) the closing speed along the contact normal (so a glancing touch hurts less than head-on) deals (speed − min) × ramming factor (0.3 car … 0.55 APC). Credit to the driver (or the last driver for 3 s). One hit per vehicle/target pair every 0.6 s (a resting contact cannot repeat damage). Spawn-protected players and, without friendly fire, teammates are pushed but not hurt. Kill feed: "Roadkill" |
| Destruction | the hull becomes a burning wreck for 5 s (still an obstacle), occupants are thrown out and take 60–120 damage, players on foot within 130 px take up to 70; credited to whoever last damaged it in the previous 10 s. Kill feed: "Explosion". Respawn on its spawn once that spot is clear |

### 1.5 Two heights

Shots between the ground and the air, or within the air, are stopped only by tall solids; shots
on the ground by every solid except the shoot-through ones (water, fences). The client computes
predicted tracers with the same rules.

### 1.6 Client

The driver predicts the vehicle (reconciled every snapshot from the vehicle state, which is the
state after the driver's acknowledged input); everybody else interpolates it 110 ms in the past;
seated players are drawn on the rendered hull, so a passenger never drifts from their seat.
Procedural art (no external assets), rotor and altitude shadow, damage smoke, wreck fire, skid
dust, engine/rotor sound, camera that leads along the direction of travel and widens slightly with
speed and altitude, vehicle panel (name, seat, health, speed/altitude, occupants, free seats,
firing arc, controls), entry prompt with the seat you would get.

Measured: guest driving a scripted course (throttle, braking, reversing, drifts, a wall crash)
over a 120 ms RTT link: **0 corrections, exact convergence** (`apps/web/test/hostmode.vehicles.test.ts`).

## 2. Maps

| Map | Size | Vehicles per team | Character |
|---|---|---|---|
| Industrial Arena, Neon District, Desert Outpost | 2560 × 1664 | — | the original arenas, unchanged |
| Urban Warfare | 3584 × 2560 | car, rover, APC | avenues for vehicles, blocks and alleys for infantry, central roundabout |
| Military Airbase | 3072 × 2048 | helicopter, car, rover | runway between hangar rows; the helicopter test map |
| Harbor Conflict | 3584 × 2304 | car, rover, APC | quay, piers into the water, warehouses, container yard |
| Downtown | 3328 × 2560 | car, rover | tight blocks, long streets, alleys only infantry fits through |
| Mountain Outpost | 3328 × 2304 | rover, APC, helicopter | boulder fields, dirt tracks, a fortified outpost in the middle |
| Tactical Facility | 3072 × 2048 | car, APC | fenced compound, gates, a four-block facility with cross corridors |

All maps are authored as one half and point-mirrored (fair by construction, tested). Validation
(tested for every map): every spawn, pickup and vehicle spawn is free and reachable on foot, ids
are unique, every solid is inside the bounds. Large maps are baked once and sliced into
1024 px textures (a single texture would exceed many GPUs' size limit); their floor grain uses
small repeating patterns, which keeps the bake fast. Objective positions (Domination points,
CTF flag stands) are derived from the team spawns the same way on every machine, symmetric on
symmetric maps.

## 3. Modes (`packages/shared/src/config/modes.ts`)

| Mode | Teams | Default | Score |
|---|---|---|---|
| Deathmatch | — | 8 players, 7 min, 20 | eliminations |
| Team Deathmatch | 2v2 (1v1–4v4) | 5 min, 15 | eliminations of the other team |
| Domination | 2v2 (1v1–4v4) | 8 min, 100 | every owned point scores 1 every 5 s |
| Capture the Flag | 2v2 (1v1–4v4) | 10 min, 3 | captures |
| Vehicle Mayhem | 2v2 (1v1–4v4), vehicle maps only | 6 min, 30 | elimination 1, wrecking a crewed enemy vehicle 2; vehicles respawn twice as fast |

- **Domination**: points A, B (centre), C. The only team inside a point (radius 120 px) turns it:
  6 s alone, faster with more players (up to 3). Contested points freeze. A point changes owner
  when fully captured and becomes neutral when the progress crosses the middle. A helicopter in
  the air does not hold ground. Eliminations do not score.
- **Capture the Flag**: touch the enemy flag to carry it (carriers travel on foot); touch your
  own dropped flag to send it home; bring the enemy flag to your stand while your own flag is
  home to score. A dropped flag returns by itself after 20 s. Eliminations do not score.
- **Practice**: a private room with one human fills with training targets; on vehicle maps the
  vehicles are there to practise driving, flying and shooting from a seat.

## 4. Progression (`packages/shared/src/config/progression.ts`, `career.ts`)

Rewards are cosmetic only (skins, rank titles). There is nothing to buy.

### 4.1 XP curve

Levels 1–20 keep the original curve, `300 + 120(l−1) + 8(l−1)²` per level, so no existing
profile changes level; from 20 on each level costs 300 more than the previous one.

| Level | XP to next | Total XP to reach | ≈ matches (470 XP) |
|---|---|---|---|
| 1 | 300 | 0 | 0 |
| 5 | 908 | 2,032 | 4 |
| 10 | 2,028 | 8,652 | 18 |
| 15 | 3,548 | 21,672 | 46 |
| 20 | 5,352 | 43,092 | 92 |
| 25 | 6,852 | 72,852 | 155 |
| 30 | 8,352 | 110,112 | 234 |
| 35 | 9,852 | 154,872 | 330 |
| 40 | 11,352 | 207,132 | 441 |
| 45 | 12,852 | 266,892 | 568 |
| 50 | — | 334,152 | 711 |

Match XP (server-side from authoritative counters, max 2000 per match): completed 100,
elimination 20 (max 30), win 150, podium 50, first blood 30, streaks 40/80, sharpshooter 30,
point capture 25 (max 8), flag capture 100, flag return 15 (max 6), vehicle wrecked 40 (max 5).

### 4.2 Unlocks

Skins at 2, 4, 6, 8, 10, 12, 15, 18, 20, 22, 25, 28, 31, 34, 37, 40, 43, 46, 50; ranks Recruit
(1), Private (5), Corporal (10), Sergeant (15), Lieutenant (20), Captain (25), Major (30),
Colonel (35), Commander (40), Warlord (45), Legend (50). Never more than three levels without
something new after 20.

### 4.3 Career stats and daily challenges

Per mode: matches played, wins, eliminations, deaths; totals of points captured, flags captured
and returned, vehicles wrecked. Three daily challenges per UTC day, the same for everybody,
drawn from a fixed pool by the date (finish 3 matches, win 2, 15 or 40 eliminations, capture 3
points, capture a flag, return 2 flags, wreck 2 vehicles, finish a Vehicle Mayhem match, win a
team match); each pays its XP once. One pure implementation (`applyMatchToCareer`) is used by the
in-memory store, PostgreSQL (`players.career` jsonb, migration `0001_career`) and the host-mode
local profile; stored data is validated on read.
