# SCRAPLINE NEXT · progress

Platform roadmap (multiplayer 2D browser platform). Short on purpose: update at checkpoints only.

**Current phase:** 1 done (home + navigation + catalog). Next: 2 (platform architecture).
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

## Open issues
- Lobby map grid still renders its thumbnails synchronously (pre-existing; cache is warmed by
  the home cards).
- No friends system: "Rooms" covers private rooms and codes.

## Roadmap
| Phase | Scope | Status |
|---|---|---|
| 0 | Audit | done |
| 1 | Home, navigation, catalog | done |
| 2 | Experience registry wiring, lifecycle, shared interaction system | next |
| 3 | Arena maps ×2 surface | — |
| 4 | Bot AI 2.0 (perception, memory, utility AI) | — |
| 5 | Graphics overhaul + LOW/MEDIUM/HIGH | — |
| 6 | Non-combat: Classic Maze, Horror Maze, Parkour, Escape Room | — |
| 7 | Horror overhaul (lighting, audio, monster AI, director) | — |
| 8–10 | Battle Royale foundation, gameplay, scaling 8→50 (measured) | — |
| 11 | Racing, Hide & Seek+, Hot Potato, Puzzle Race, Free Roam | — |
| 12 | Polish & release | — |
