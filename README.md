# SCRAPLINE (provisional name)

Top-down 2D multiplayer shooter for desktop browsers. 2–8 players on nine original maps, five
weapon classes, cars, off-roaders, an APC and a helicopter with seats you can shoot from, five
modes (Deathmatch, Team Deathmatch, Domination, Capture the Flag, Vehicle Mayhem),
server-authoritative netcode with client prediction, persistent XP to level 50 with cosmetic
unlocks and daily challenges, and private rooms you can share with a link.

> The name is a working title and has not been checked for trademarks.

## Status

| Area | State |
|---|---|
| Gameplay (movement, dash, aim, 5 weapons, pickups, health, respawn) | Done, unit-tested |
| Authoritative multiplayer (prediction, reconciliation, interpolation, lag compensation) | Done; audited under 0–250 ms RTT, jitter, stalls, drops and page reloads (netcode matrix + 2-browser E2E) |
| Deathmatch flow (countdown, timer, kill limit, kill feed, scoreboard, results, rematch) | Done |
| Team Deathmatch (Alpha/Bravo, 1v1–4v4, default 2v2), team lobby, invite to team, balance | Done (v0.3.0), unit + integration + two-browser E2E on both transports |
| Vehicles (car, off-road, APC, helicopter), seats, shooting from vehicles, run-overs, destruction | Done (v0.4.0), unit + simulation + host-mode netcode + two-browser E2E (server and WebRTC): [docs/v2/SYSTEMS.md](docs/v2/SYSTEMS.md) |
| Modes: Domination, Capture the Flag, Vehicle Mayhem | Done (v0.4.0), rule tests + two-browser E2E (CTF, Domination) |
| Maps: Industrial Arena, Neon District, Desert Outpost + Urban Warfare, Military Airbase, Harbor Conflict, Downtown, Mountain Outpost, Tactical Facility | Done, validated (spawns, vehicles, reachability, symmetry) |
| SCRAPLINE 2.0 roadmap and results | [docs/v2/ROADMAP.md](docs/v2/ROADMAP.md) (phases 0–7 done, phase 8 = release on your devices) |
| Lobby: quick match, room browser, private rooms with code/link, ready, host controls, kick | Done |
| Guest identity (signed tokens), XP, levels 1–50, ranks, cosmetic unlocks, career stats per mode, daily challenges, leaderboard | Done, persisted in PostgreSQL (tested against a real database) and in the browser in host mode |
| Solo practice with training targets (never recorded) | Done |
| Host mode: the arena creator's browser hosts the match, friends join over WebRTC; deploys on Vercel alone | Done (v0.2.0), unit + two-browser WebRTC E2E; real school networks not tested: see [docs/HOST_MODE.md](docs/HOST_MODE.md) |
| Deployment config: Dockerfile, Render Blueprint, Vercel config, docs | Done; client deployed on Vercel by the owner; dedicated server image built and run in the audit, **not deployed** |
| Performance | CPU cost per frame measured (small); **60 FPS on a real GPU not yet verified**: run `/bench.html` on target hardware |

Details and the test record: [docs/TESTING.md](docs/TESTING.md). Open items: [docs/ROADMAP.md](docs/ROADMAP.md).
Technical audit (findings, evidence, residual risks, conditions for publication):
[docs/audit/AUDIT_REPORT.md](docs/audit/AUDIT_REPORT.md).

## Quick start (local)

Requirements: Node.js 22+, pnpm 10 (`corepack enable`). PostgreSQL is optional locally.

```bash
pnpm install
pnpm dev            # game server on :2567 + web client on :5173
```

Open http://localhost:5173 in two browser windows (or two machines on your LAN: the client
connects to `<same host>:2567` unless `VITE_SERVER_URL` is set), pick a callsign, create a private
room in one window and join with the code in the other.

Without `DATABASE_URL` the server keeps profiles in memory (lost on restart). With PostgreSQL:

```bash
export DATABASE_URL=postgres://scrapline:scrapline@localhost:5432/scrapline
pnpm dev:server     # migrations run automatically at boot
```

`docker compose up` starts PostgreSQL and the production server image together.

## Controls

| Input | Action |
|---|---|
| W A S D | Move |
| Mouse | Aim |
| Left click | Fire (hold for automatic weapons) |
| R | Reload |
| Shift | Dash |
| 1 / 2 / 3 | Primary / sidearm / picked-up weapon |
| E | Pick up weapon · enter / leave a vehicle |
| F | Change seat in a vehicle |
| W / S, A / D (driving) | Throttle / brake-reverse, steer; Shift = handbrake |
| W A S D, mouse (flying) | Move, nose follows the mouse; Shift = take off / land |
| Tab (hold) | Scoreboard |
| Esc | Menu |

All keys can be rebound in Settings (bindings use physical key positions, so AZERTY works).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Server (tsx watch) + client (Vite) |
| `pnpm build` | Production builds: `apps/web/dist`, `apps/server/dist` |
| `pnpm typecheck` | TypeScript (strict) in every package |
| `pnpm lint` | Biome lint + format check |
| `pnpm test` | Unit + integration tests (Vitest); set `TEST_DATABASE_URL` to include PostgreSQL |
| `pnpm test:e2e` | Two independent Chrome instances play against a real server (Playwright) |
| `E2E_LATENCY_MS=120 E2E_JITTER_MS=30 pnpm test:e2e` | Same, through the network-conditions proxy |
| `pnpm --filter @scrapline/server loadtest -- --bots 8` | Headless bot load test (needs `ENABLE_DEBUG_ROUTES=true`, `TRUST_PROXY=1`) |
| `pnpm --filter @scrapline/server netaudit` | Netcode matrix: RTT/jitter/stall/reconnect scenarios with acceptance criteria (docs/TESTING.md) |
| `/bench.html` (dev or deployed client) | Offline client benchmark, 1/2/8 players, High/Low; `node tests/perf/run-bench.mjs` automates it |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations |

## Repository layout

```text
apps/
  web/        React 19 + Vite 8 shell (menus, lobby, HUD) and the Phaser 4 game (src/game)
  server/     Colyseus 0.18 game server, HTTP API, persistence (Drizzle + PostgreSQL)
packages/
  shared/     Config (weapons, maps, rules, progression), wire protocol, synchronized state,
              deterministic simulation used by BOTH client prediction and the server
tests/
  e2e/        Playwright two-browser test
  tools/      netem-proxy.mjs (latency/jitter for WebSockets)
docker/       server.Dockerfile
docs/         ARCHITECTURE, GAME_DESIGN, DEPLOYMENT, ROADMAP, TESTING
render.yaml   Render Blueprint (server + PostgreSQL)
```

Why the layout differs slightly from the brief: persistence lives in `apps/server/src/persistence`
instead of a separate `packages/database`, because the server is its only consumer; the
synchronized state schema lives in `packages/shared` so the client decodes typed state.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — stack, netcode, security, scaling
- [Game design](docs/GAME_DESIGN.md) — weapons, maps, progression, art direction
- [Deployment](docs/DEPLOYMENT.md) — Vercel, Render, Scaleway, DNS
- [Testing](docs/TESTING.md) — what is tested, results, what was not run
- [Roadmap](docs/ROADMAP.md) — phase checklist and next steps
- [Audit report](docs/audit/AUDIT_REPORT.md) — v0.1.1 technical audit (Italian)
- [Changelog](CHANGELOG.md)

## Assets and licenses

All sprites, maps and sounds are generated in code at runtime (no third-party art or audio).
Fonts: Chakra Petch and JetBrains Mono via @fontsource, both SIL Open Font License 1.1.
