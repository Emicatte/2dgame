# SCRAPLINE NEXT · progress

Platform roadmap (multiplayer 2D browser platform). Short on purpose: update at checkpoints only.

**Current phase:** 2, 4, 6a, 7a, 8–9 (first scale) done. Next: 10 (Battle Royale scaling:
interest management, then real-player tests on a dedicated server) and 3 (arena maps ×2).
**Branch:** `platform-home` (base `main` 0.8.1). Not deployed; production untouched.

## Phase 0 · audit (2026-11-10)
- `main` = 0.8.0: 16 room modes in `MODES` (shared), one server controller per mode
  (`apps/server/src/modes`, same code in host mode), lobby settings validated server-side
  (`ArenaRoom.handleSettings`, host only). Co-op: Outbreak campaign (5 chapters) + Extraction,
  Boss Rush; Survival Endless. Practice bots (`BotBrain`), vehicles, 15 PvP/party maps.
- Not present: Battle Royale, maze, horror modes, parkour, racing, escape room, free roam,
  2D lighting system, tension director, shared interaction system, perception-based bot AI 2.0.
- Home before: host mode 4 + 3 buttons, server mode 7 + 4. Duplicates: "Outbreak · co-op" =
  Play → Co-op; "Team Deathmatch" = Play → TDM; "Create arena" asked for a map, then the lobby
  asked again; Browse rooms / Quick match / Play overlapped.
- Baseline tests: shared 118, web 145, server 235 pass; lint clean (1 old warning).

## Phase 1 · home overhaul (done)
- Experience catalog `packages/shared/src/config/experiences.ts`: 8 categories (Action,
  Survival, Horror, Party, Adventure, Challenge, Racing, Social), derived from `MODES` +
  co-op operations + 10 planned experiences (never startable, labelled with what they need).
- Home `apps/web/src/screens/Home.tsx`: top bar with one entry per destination (Play, Discover,
  Rooms, Profile, Settings). Play = spotlight (last played or featured, live map behind it) +
  one-click Play, recently played, featured, categories. Discover = full catalog with category
  tabs. Experience card → Create lobby / Quick match (server mode). Rooms = join with code,
  create a room, public rooms (server mode, real counts only).
- Map is chosen only in the lobby. Lobby: current mode header, "Change mode" picker (grouped
  like the catalog), map grid, rules; guests see "the host picks…".
- Removed: `MainMenu.tsx` (incl. map-picking Create dialog), `PlayScreen.tsx`, Room browser sheet.
- Tests: `tests/e2e-p2p/home.spec.ts` (nav, no map before lobby, back, dialog, continue);
  catalog unit tests; all e2e specs moved to the new testids. Results in `docs/TESTING.md`.

## Phase 2 + 6a · interactions + Classic Maze (done)
- Architecture already there and kept: `MODES` registry, one `ModeController` per mode with a
  standard lifecycle (reset → spawn → step → over → standings/facts), same code in host mode.
- Shared interaction pieces, generic instead of mission-only: map doors (`pveWorlds` + the
  open-door list in `PveState.doors`, used by Outbreak and now by maze gates; the client predicts
  with the same doors), objective marks (`MatchState.marks`) for keys, switches, checkpoints,
  traps, exit; interact (E) prompts.
- Seeded maps: `maps/maze.ts` generates a perfect maze from `maze-<s|m|l>-<seed>`; any seed is a
  valid map id (lazy `MAPS`), the lobby shows one card per size and "New maze" draws a seed.
  Amber gate (key in a branch before it), cyan gate (switch between the gates), checkpoint after
  each gate, timed floor traps, exit = farthest cell. Solvability tested over 30 seeds.
- `MazeMode` (server, shared by host mode): no weapons, no practice bots, key carry, switch (E),
  traps → last checkpoint (carried key dropped), finish times, match ends when everyone is out.
  Results show times (DNF), no combat columns; HUD hides elims/leader.

## Phase 7a · Horror Maze (done)
- `MazeMonster`: one stalker run by the existing Outbreak enemy AI (`ZombieWorld`: sight with
  line of sight, hearing, memory of the last position, investigate, wander), outside the PvE
  runtime through a small `ZombieHost`. Never told where players are; always walks (tested).
- Director (server, 1 Hz): running/dashing footsteps and gates/traps make noise; after ~28 s
  without a chase it makes a sound 320–480 px from the player furthest ahead (investigate
  near them, not on them). Caught → back to the checkpoint.
- Client: the PvE layer (darkness, flashlight with wall shadows, enemy rendering, dread) turns
  on for the horror variant; maze gates block light. Card "Horror Maze" in Horror; lobby has a
  Variant setting for the maze.
- Known limit: the creature's position is sent to every client (a modified client could see it).

## Phase 4 · bot AI 2.0 (done, on top of BotBrain from 0.6.1)
- Already there: line of sight, reaction 0.3–0.55 s, imperfect aim that settles, bursts,
  weapon distance with strafing, cover when hurt/reloading, medkits, last-seen memory.
- Added: field of view (130°, 240 px near sense, 360° for 1.5 s after an unseen hit); hearing
  of gunshots (1300–1600 px by personality) → investigate; no more knowing where the nearest
  enemy is (idle bots patrol spawns or loot); team radio (teammates share the last sighting,
  ≤ 3 s old); personalities aggressive / tactical (flanks) / cautious / explorer (loot) /
  support (stays with the most hurt teammate) as weights on the same decisions; outnumbered
  retreat for cautious, tactical and support.
- Cost measured: 17 µs per bot per tick (3 bots, 90 s on Industrial, unit test log).

## Phase 8–9 · Battle Royale, first scale (done, up to 16 players)
- Map: Scrapline Isle (`maps/island.ts`), 4096², 16 named districts (city, houses, yards,
  docks, fort, lab, farms, woods, villages) with roads, 4 chests + medkit + ammo per district.
- `BattleRoyaleMode`: flying bus on a random straight line (BrState), jump with SPACE / dash
  when over the island, forced drop before it leaves; land unarmed, loot chests and pickups;
  storm in 6 phases (wait → shrink to a new circle inside the old one, 2→20 dps outside);
  no respawns; last one standing; practice bots ride, jump at random and loot when unarmed.
- Drop in the shared player sim (`PlayerSim.alt`/`chute`, `stepAir`): freefall 400 px/s,
  parachute (SPACE or automatic at 300) 230 px/s, no collisions or weapons in the air,
  landing pushes out of solids; synced and predicted like walking.
- Client `BrLayer`: bus with rotors on its line, storm (tinted outside, animated edge, next
  circle), district names, bigger players + ground shadow + canopy in the air, camera widens
  with altitude, "SPACE: jump / open the parachute" prompts.
- Measured (simulated random players, server tick + filtered encoding only, `modebench.ts`,
  90 s): 8 → 0.07 ms/tick, 2.5 KB/s per client; 16 → 0.14 ms, 4.8 KB/s; 32 → 0.22 ms,
  9.1 KB/s; 50 → 0.39 ms (p99 1.5 ms), 13.9 KB/s. Not a real-player test; no interest
  management yet (every client receives every player); the room is capped at 16.
- Hosting note: in host mode the host's browser uploads to every guest (50 × 13.9 KB/s ≈
  0.7 MB/s before WebRTC overhead): 32–50 players need the dedicated server, not host mode.

## Open issues
- Lobby map grid still renders its thumbnails synchronously (pre-existing; cache is warmed by
  the home cards).
- No friends system: "Rooms" covers private rooms and codes.

## Roadmap
| Phase | Scope | Status |
|---|---|---|
| 0 | Audit | done |
| 1 | Home, navigation, catalog | done |
| 2 | Experience registry wiring, lifecycle, shared interaction system | done (with 6a) |
| 3 | Arena maps ×2 surface | — |
| 4 | Bot AI 2.0 (perception, memory, personalities, team radio) | done |
| 5 | Graphics overhaul + LOW/MEDIUM/HIGH | — |
| 6 | Non-combat: Classic Maze ✓, Horror Maze ✓, Parkour, Escape Room | in progress |
| 7 | Horror overhaul: Horror Maze creature + director ✓; Haunted Facility, Night Hunt | in progress |
| 8–9 | Battle Royale map, bus, drop, loot, storm, victory (≤16) | done (first scale) |
| 10 | BR scaling 8→50: interest management, real-player tests, dedicated server | measured sim only |
| 11 | Racing, Hide & Seek+, Hot Potato, Puzzle Race, Free Roam | — |
| 12 | Polish & release | — |
