# Testing

## How to run

```bash
pnpm lint && pnpm typecheck
pnpm test                                   # unit + integration (in-memory store)
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/scrapline_test pnpm test   # + PostgreSQL contract
pnpm test:e2e                               # two real Chrome instances vs a real server
E2E_LATENCY_MS=120 E2E_JITTER_MS=30 pnpm test:e2e     # same, through the netem proxy
CHROME_PATH=/path/to/chrome pnpm test:e2e   # if Chrome is not at /usr/bin/google-chrome
```

The PostgreSQL contract test **drops and recreates the `public` schema** of the database it is
given: point it at a dedicated test database only.

## Results (last run: 2026-11-05)

| Suite | Count | Result |
|---|---|---|
| `packages/shared` unit | 41 | pass |
| `apps/web` unit (netcode client) | 8 | pass |
| `apps/server` unit + integration (incl. PostgreSQL 16) | 35 | pass |
| E2E, two browsers, localhost | 1 | pass |
| E2E, two browsers, 120 ms RTT + 30 ms jitter + 1 % 150 ms stalls | 1 | pass |
| Lint (Biome), typecheck (tsc strict) | — | clean |
| Production builds (web, server bundle) | — | pass |
| Production bundle run against PostgreSQL (`node dist/index.js`) | manual | pass: migrations, `/health`, guest creation, CORS |
| `pnpm deploy --prod` output runs standalone (what the Docker image contains) | manual | pass |
| Load test, 8 bot clients, 25 s | manual | tick cost avg 0.33 ms / max 4.4 ms (budget 50 ms), max tick interval 51 ms, 0 dropped inputs, ~3.6 KB/s down per client |
| SIGTERM drain | manual | players notified, server exits after the drain window |

## Coverage by requirement

| # | Requirement | Where |
|---|---|---|
| 1 | Movement (accel/decel, diagonal, dash) | `packages/shared/test/sim.test.ts` › movement |
| 2 | Collisions | sim.test › stops at walls; collision and hitscan; maps.test |
| 3 | Damage and health | `apps/server/test/simulation.test.ts`; integration › damage and kills |
| 4 | Fire rate | sim.test › respects fire rate, semi-auto trigger |
| 5 | Ammo and reload | sim.test › auto-reload, reload cancel, pistol infinite reserve |
| 6 | Elimination and respawn | simulation.test › kills then respawns with protection; E2E |
| 7 | Valid spawns | maps.test (all spawns free + reachable); simulation.test › spawn selection |
| 8 | Room creation | integration › private room + code lookup; quick match |
| 9 | Multiplayer join | integration (real sockets); E2E (two browsers) |
| 10 | Disconnection | integration › seat kept on drop; malformed sender removed |
| 11 | Reconnection | integration › reconnect restores state |
| 12 | Match end | integration › ends by time, results message |
| 13 | XP calculation | progression.test; integration › XP results |
| 14 | Stats persistence | repository.test (memory + PostgreSQL); integration › persisted stats |
| 15 | Message validation | integration › malformed disconnects, replays ignored; HTTP security |
| — | Determinism / prediction | sim.test › determinism; web netcode.test › Predictor converges |
| — | Lag compensation | simulation.test › rewind hits, rewind cap; E2E under latency |
| — | Anti speed-hack | simulation.test › real-time input budget, no idle banking |
| — | Security (CORS, tokens, nicknames) | integration › HTTP security |

## The two-browser E2E

`tests/e2e/multiplayer.spec.ts` launches **two separate Chrome processes** (not two tabs), both
loading the real client from Vite and connecting to a real server process:

1. Both create guest profiles through the UI.
2. Browser A creates a private room (debug-only fixed spawns so the duel is deterministic).
3. Browser B joins by typing the room code shown in A's lobby, readies up; A sees it and starts.
4. B moves; A's interpolated view of B moves (state sync + interpolation).
5. A aims at where it *sees* B and fires until the **server** reports an elimination.
6. Both browsers agree on kills/deaths, A's HUD shows 1 elimination, B sees the death screen, B
   respawns.

Fixed spawns are accepted only when `ENABLE_DEBUG_ROUTES=true`, which production refuses.

## Network conditions

`tests/tools/netem-proxy.mjs` sits between clients and server and delays HTTP requests and
WebSocket frames (`--latency` RTT, `--jitter`, `--spike-rate`/`--spike` for retransmission-like
stalls) while preserving order, as TCP does. Use it manually too:

```bash
node tests/tools/netem-proxy.mjs --listen 2610 --target http://localhost:2567 --latency 150 --jitter 40
VITE_SERVER_URL=http://localhost:2610 pnpm dev:web
```

Enable **Settings → Show FPS / network overlay** to see ping, interpolation delay, jitter,
pending (unacknowledged) inputs, last correction in pixels, bandwidth in/out and message rate.

## Not run, and why

| Item | Reason |
|---|---|
| `docker build` of `docker/server.Dockerfile` | Docker Hub is not reachable from the build environment (403 on `registry-1.docker.io`). The steps inside the image (install, bundle, `pnpm deploy --prod`, run) were executed outside Docker and pass. Run `docker build -f docker/server.Dockerfile .` once on your machine or in CI. |
| Deployment to Render/Vercel and post-deploy checks | Needs your accounts; applying the Blueprint creates billable resources. |
| 60 FPS on real hardware | Headless Chrome here renders WebGL in software (SwiftShader): 10–30 FPS, not representative of a desktop GPU. The FPS overlay is in place to measure on real machines. |
| Two physically different devices over the Internet | Only localhost (+ simulated latency/jitter) was available. Use the post-deploy checklist in DEPLOYMENT.md. |
| Firefox / Safari | Only Chrome is installed here. The client uses standard WebGL, Web Audio and WebSocket APIs. |
| Packet loss | WebSockets run on TCP: loss appears as stalls, which the proxy simulates; true UDP-style loss does not apply. |
