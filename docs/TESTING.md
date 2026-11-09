# Testing

Passing tests are evidence of correctness, not of performance: frame-rate and network numbers come
from the dedicated tools below and are reported with the environment they were measured in.

## How to run

```bash
pnpm lint && pnpm typecheck                 # Biome; tsc for every package and the E2E sources
pnpm test                                   # unit + integration (in-memory store)

# + PostgreSQL contract (drops and recreates the `public` schema of that database!)
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/scrapline_test pnpm test
# + PostgreSQL TLS verification against a TLS-only server with a private CA (Debian/Ubuntu, root)
sudo tests/tools/pg-tls-setup.sh /tmp/pgtls          # prints the three variables below
TEST_PG_TLS_URL=postgres://scrapline:scrapline@localhost:5433/scrapline_tls_test \
TEST_PG_TLS_CA_FILE=/tmp/pgtls/ca.crt TEST_PG_TLS_WRONG_CA_FILE=/tmp/pgtls/wrong-ca.crt pnpm test

pnpm test:e2e                                         # two Chrome processes, real server, via proxy
E2E_LATENCY_MS=120 E2E_JITTER_MS=30 E2E_SPIKE_RATE=0.01 pnpm test:e2e
E2E_LATENCY_MS=250 E2E_JITTER_MS=50 pnpm test:e2e
CHROME_PATH=/path/to/chrome pnpm test:e2e             # if Chrome is not at /usr/bin/google-chrome
```

### Netcode matrix (`apps/server/scripts/netaudit.ts`)

Two headless clients run the real client netcode (`Predictor`, `ServerClock`, `NetMetrics` from
`apps/web`) against a real server process through the network-conditions proxy:

```bash
ENABLE_DEBUG_ROUTES=true PORT=2600 pnpm --filter @scrapline/server exec tsx src/index.ts
node tests/tools/netem-proxy.mjs --listen 2610 --target http://localhost:2600 --latency 0
pnpm --filter @scrapline/server netaudit -- --server http://localhost:2600 \
     --proxy http://localhost:2610 --out netaudit.json [--only stall]
```

Scenarios: RTT 0/40/120/250 ms with jitter (and 1 % 150 ms stalls) at 60 and 13 FPS; uplink stalls
of 0.4/1/1.5/2.5 s (one at 250 ms RTT), a 1 s downlink stall, a 1.5 s stall in both directions,
an abrupt connection drop (SDK auto-reconnect) and a page reload (new connection with the stored
token and a fresh predictor). Acceptance criteria, per client:

| Criterion | Steady state | After a disturbance |
|---|---|---|
| pending p95 / max ≤ bound = ⌈(RTT + 2·jitter + 2·tick + 2·frame) / 16.7 ms⌉ + 2 | yes (max + stall allowance with spikes) | pending back under the bound (recovery time reported) |
| server `overflow`, `duplicate` | 0 | reported |
| standing server queue after recovery | — | ≤ ⌈frame / 16.7 ms⌉ + 3 |
| snap corrections without a respawn, correction size | 0, ≤ 1 px | reported |
| predicted shots = shots fired by the server | equal | reported |
| after releasing input: ack = last sequence, prediction = server position (≤ 0.01 px), ammo equal | yes | yes |
| stale acks, removals from the room | 0 | 0 |

### Network-conditions proxy (`tests/tools/netem-proxy.mjs`)

Delays HTTP and WebSocket frames (latency, uniform jitter, occasional stalls) in strict FIFO order
per direction, as TCP does, with a seeded RNG. Runtime control on the same port:
`GET/POST /__netem` (settings), `POST /__netem/stall {ms, dir}`, `POST /__netem/drop`. Optional
TLS termination (`--tls-cert/--tls-key`) and `X-Forwarded-For` (`--forwarded`) emulate a PaaS load
balancer. Before the audit the proxy scheduled every frame with its own `setTimeout`, which can
fire out of order: latency results from v0.1.0 included reordered frames (audit finding T1).

### Client benchmark (`apps/web/bench.html`)

Offline and repeatable: the real game scene and HUD render a real match simulation
(`apps/web/src/bench/LocalRoom.ts` runs the server's `GameSimulation` in the page) with 1, 2 and 8
players at High and Low quality, driven by a scripted local player. It reports FPS, frame-time
percentiles, CPU time for update and render submission, long frames, JS heap, texture memory and
the WebGL renderer string (software renderers are flagged).

```bash
pnpm --filter @scrapline/web build && pnpm --filter @scrapline/web preview &
node tests/perf/run-bench.mjs --url http://localhost:4173/bench.html --out bench.json \
     [--gpu] [--width 1920 --height 1080] [--query "players=8&quality=high&seconds=30"]
```

On real hardware open `/bench.html` in a maximised window with the tab in front (a background tab
is throttled) and keep the JSON shown under the table.

### Host mode (`docs/HOST_MODE.md`)

```bash
pnpm --filter @scrapline/web test                 # includes signaling + host/guest room tests
pnpm test:e2e:p2p                                 # two Chrome processes, real WebRTC, dev server
E2E_P2P_PREVIEW=1 pnpm test:e2e:p2p               # same against the production build
```

### Team Deathmatch and SCRAPLINE 2.0 phases

```bash
pnpm --filter @scrapline/server exec vitest run test/teams.test.ts test/teams.integration.test.ts
pnpm --filter @scrapline/web exec vitest run test/hostmode.teams.test.ts test/hostmode.netcode.test.ts
pnpm test:e2e teams.spec                          # two browsers, TDM on the real server
```

Phase-by-phase acceptance criteria and results: `docs/v2/ROADMAP.md`.

### Vehicles, modes, progression (0.4.0)

```bash
pnpm --filter @scrapline/shared exec vitest run test/vehicle.test.ts test/career.test.ts
pnpm --filter @scrapline/server exec vitest run test/vehicles.test.ts test/modes.test.ts test/soak.test.ts test/security.v2.test.ts
pnpm --filter @scrapline/web exec vitest run test/hostmode.vehicles.test.ts test/hostmode.load.test.ts
pnpm test:e2e vehicles.spec modes.spec             # two browsers on the real server
pnpm test:e2e:p2p vehicles.spec                    # two browsers over WebRTC (host mode)
# PostgreSQL contract incl. the career migration (any throwaway database):
TEST_DATABASE_URL=postgres://postgres@localhost:55432/scrapline_test pnpm --filter @scrapline/server exec vitest run test/repository.test.ts
```

### Outbreak and Combat Visual Overhaul (0.5.0)

```bash
pnpm --filter @scrapline/shared exec vitest run test/pveProgress.test.ts test/maps.test.ts
pnpm --filter @scrapline/server exec vitest run test/pve.test.ts test/pve.integration.test.ts
pnpm --filter @scrapline/web exec vitest run test/hostmode.pve.test.ts test/combat.*.test.ts test/settings.migrate.test.ts
pnpm test:e2e:p2p outbreak.spec                   # two Chrome processes over WebRTC: co-op objectives + boss
E2E_SHOTS_DIR=/tmp/shots pnpm test:e2e:p2p outbreak.spec   # same, keeping screenshots
```

Acceptance criteria and results by phase: `docs/v3/ROADMAP.md`; systems and budgets:
`docs/v3/OUTBREAK.md`.

### Modes expansion (0.7.0)

```bash
pnpm --filter @scrapline/shared exec vitest run test/maps.test.ts test/career.test.ts
pnpm --filter @scrapline/server exec vitest run test/partymodes.test.ts      # rules + what each client decodes
pnpm --filter @scrapline/web exec vitest run test/hostmode.partymodes.test.ts # real HostRoom + guest
pnpm test:e2e:p2p partymodes.spec                 # two Chrome processes over WebRTC
E2E_SHOTS_DIR=/tmp/shots pnpm test:e2e:p2p partymodes.spec   # same, keeping screenshots
pnpm --filter @scrapline/server exec tsx scripts/modebench.ts  # tick cost and bandwidth per mode
```

## Results (last run: 2026-11-09, v0.7.0 modes expansion, branch `modes-expansion`)

| Suite | Count | Result |
|---|---|---|
| Lint (Biome), typecheck (tsc strict, E2E sources included), production build | — | clean (one warning that predates this branch) |
| `packages/shared` unit (+ map compatibility, Salvage Depot party data, mode career counters) | 112 + 1 skipped | pass |
| `apps/web` unit (+ host mode: Gun Game start, a seeking guest never decodes the hidden host's pose / events / ghost, Prop Hunt abilities as messages and objects only at hunt start, round modes refuse to start alone, a hiding guest reconnects and gets its ghost back) | 143 | pass |
| `apps/server` unit + integration (+ 31 mode tests: ladder, demotion, overtime, results; roles, pen, exposure, shadows, hiding spots, event filtering, rounds and rotation, Infection, Blackout, leaving players, latecomers; transform, fit, ids renewed at hunt start, hits, penalty, finds, lock, taunt, decoy, cooldown, hints; per-viewer encoding decoded for each client) | 211 + 8 skipped | pass |
| E2E host mode, two Chrome processes over WebRTC: Play screen + Gun Game; Hide & Seek secrecy (the seeking guest's received state); Prop Hunt (picker, objects only at hunt start, lock) | 3 | pass |
| E2E host mode regressions: TDM + invite + reload + host close; practice bots; crosshair; vehicles | 4 | pass, after fixing a regression found here: the Create arena dialog (10 maps) put its button below a 720 px window; dialogs now scroll |
| E2E dedicated server (`pnpm test:e2e`, 7 specs) | 7 | 3 pass (reconnect/stall, TDM, helicopter on a second run); 4 fail (CTF, Domination, deathmatch exchange, car). **The untouched 0.6.2 baseline fails 6 of 7 in the same environment** (same four plus TDM and reconnect): the specs time out walking to targets at ~5 FPS software rendering. Not a regression of this branch; not fixed here |

Mode benchmark (8 simulated players, 60 s per mode, full room path): `docs/v4/MODES.md` §5. Not run:
Outbreak E2E (unchanged code paths; covered by unit and host-mode tests), netcode matrix,
PostgreSQL contract (the career stays JSON: no migration), GPU frame rate on real hardware.

## Results (2026-11-06, v0.5.0 Outbreak and Combat Visual Overhaul, branch `outbreak`)

| Suite | Count | Result |
|---|---|---|
| Lint (Biome), typecheck (tsc strict, E2E sources included) | — | clean |
| `packages/shared` unit (+ PvE progression, maps incl. Halvorsen Works, flow fields against a reference Dijkstra on every map and class) | 96 | pass |
| `apps/web` unit (+ 61 combat visual tests, host-mode Outbreak: sync, revive, results, rejoin, wipe → Deathmatch) | 103 | pass |
| `apps/server` unit + integration (+ 40 PvE simulation tests, Outbreak over real sockets), without PostgreSQL/TLS variables | 153 + 8 skipped | pass |
| E2E host mode (WebRTC, two Chrome processes): TDM + invite + reload + host close | 1 | pass |
| E2E host mode: Outbreak, two browsers complete the first two objectives of First Contact together | 1 | pass (2.3–2.9 min) |
| E2E host mode: Survival boss scenario (health bar, phase, telegraphs; screenshots) | 1 | pass |
| E2E host mode: vehicles (guest drives, host shoots from the window, fight on foot) | 1 | pass, twice, after a fix in the spec (below) |

The vehicle spec failed three times out of three in this environment, on this branch and on the
untouched v0.4.0 tree: at 5 FPS (software rendering) the burst from the car window lasted long
enough to empty the rifle and its reserve, and the two players left the car on opposite sides,
so the car stood between them and took every shot (found with a diagnostic copy of the spec:
positions, HUD, screenshot). The spec now switches to the sidearm and steps both players out of
the car's shadow; it logs the positions it fights from.

Not run for 0.5.0: the dedicated-server E2E suite (`pnpm test:e2e`), the netcode matrix and the
PostgreSQL contract; the dedicated-server PvE path is covered by the real-socket integration
test. Performance figures: `docs/v3/OUTBREAK.md` §8.

## Results (2026-11-05, v0.4.0 vehicles, modes, maps, progression)

| Suite | Count | Result |
|---|---|---|
| `packages/shared` unit (vehicle model 19, career/progression 6, maps for 9 maps, …) | 90 | pass |
| `apps/web` unit (+ host-mode vehicle netcode at 120 ms RTT, host load 8 players / 6 vehicles) | 40 | pass |
| `apps/server` unit + integration with PostgreSQL 16 (vehicles 19, modes 9, soak 2, protocol 3, repository contract on memory and PostgreSQL) | 115 + 7 skipped (TLS variables) | pass |
| Netcode matrix after phases 2–7 (`docs/audit/data/netaudit-v2-phase7.json`) | 15 scenarios | 15/15 |
| E2E dedicated server: duel, reload/stall/drop, TDM, car (driver + shooting passenger, fight on foot), helicopter (pilot + gunner), CTF, Domination | 7 | pass |
| E2E host mode (WebRTC): TDM + invite + reload + host close; car with the guest driving and the host shooting from the window | 2 | pass (the vehicle spec once found the guest's ready click lost while its lobby was still settling; the spec now retries it) |
| Production build | — | pass |

## Results (v0.3.0 Team Deathmatch)

| Suite | Count | Result |
|---|---|---|
| `packages/shared` unit | 41 | pass |
| `apps/web` unit (netcode 13, signaling 14, host mode 8, host-mode TDM 2, host-mode netcode at 120 ms RTT 1) | 38 | pass |
| `apps/server` unit + integration (team rules 14, TDM over real sockets 3), without PostgreSQL/TLS variables | 76 + 8 skipped | pass |
| Netcode matrix before (Phase 0) and after Phase 1 (`docs/audit/data/netaudit-v2-phase{0,1}.json`) | 15 scenarios | 15/15 and 15/15 |
| E2E dedicated server: duel, reload/stall/drop, Team Deathmatch | 3 | pass (the TDM spec failed once in four runs at SwiftShader frame rates: no kill within its 20 s aiming window; the window is now 35 s and the spec logs positions/health/ammo when it fails) |
| E2E host mode (WebRTC): TDM + invite link + play + reload + host close, dev / production build | 1 / 1 | pass / pass |

## Results (v0.2.0 host mode; audit figures below unchanged)

| Suite | Count | Result |
|---|---|---|
| `apps/web` unit (netcode 13, signaling + deployed function 14, host mode 8) | 35 | pass |
| `packages/shared` unit | 41 | pass |
| `apps/server` unit + integration, without PostgreSQL/TLS variables | 59 + 8 skipped | pass |
| E2E host mode, two Chrome, real WebRTC: dev server / production build | 1 / 1 | pass (join 6–8 s incl. ICE gathering; guest: 0 corrections, 0 stale acks, no stall) |
| E2E dedicated server (regression after the session changes), localhost | 2 | pass |
| Lint, typecheck | — | clean |

## Results (audit run: 2026-11-05)

Environment: cloud VM, 2 vCPU Intel Xeon, Ubuntu 24.04, Node 22.23, Chrome with SwiftShader
(software WebGL; no GPU), PostgreSQL 16.

| Suite | Count | Result |
|---|---|---|
| `packages/shared` unit | 41 | pass |
| `apps/web` unit (prediction, interpolation, clock, metrics, stall guard) | 13 | pass |
| `apps/server` unit + integration (incl. PostgreSQL 16 and TLS) | 70 | pass, 0 skipped |
| Netcode matrix (`netaudit`) | 15 scenarios | 15/15 pass (`docs/audit/data/netaudit-after.json`) |
| E2E, two browsers: duel + reload/stall/drop, localhost | 2 | pass |
| E2E, same, 120 ms RTT + 30 ms jitter + 1 % 150 ms stalls | 2 | pass |
| E2E, same, 250 ms RTT + 50 ms jitter | 2 | pass |
| Lint (Biome), typecheck (tsc strict, E2E included) | — | clean |
| Production builds (web incl. benchmark page, server bundle) | — | pass |
| Docker image build + run (stand-in base image, see below) | manual | pass: healthy, user `node`, migrations, SIGTERM drain, verified TLS, WSS behind a TLS proxy |
| Client benchmark, SwiftShader | manual | see AUDIT_REPORT.md P1 (software rendering, not representative of a GPU) |

What the E2E checks besides gameplay: pending max under the bound for the measured frame time, no
stale acks, snap corrections only for respawns, zero server-side duplicate/overflow/trimmed frames,
every frame sent was received and processed (minus frames in flight), and after a reload, a 1.5 s
uplink stall ("Connection interrupted" shown and cleared) and an abrupt drop: same seat, no stale
acks, prediction equal to the server position.

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
| 10 | Disconnection | integration › seat kept on drop; malformed sender removed; netaudit drop |
| 11 | Reconnection | integration › reconnect, stale-socket takeover; E2E reload + drop; netaudit |
| 12 | Match end | integration › ends by time, results message |
| 13 | XP calculation | progression.test; integration › XP results |
| 14 | Stats persistence | repository.test (memory + PostgreSQL); integration › persisted stats |
| 15 | Message validation | integration › malformed, unknown type, oversized batch, replay, sequence/view-tick manipulation |
| — | Determinism / prediction | sim.test › determinism; netcode.test › converges, long stall; netaudit convergence |
| — | Input pipeline under latency | netaudit matrix; E2E netcode assertions |
| — | Lag compensation | simulation.test › rewind hits, rewind cap; E2E under latency |
| — | Anti speed-hack | simulation.test › real-time budget, bounded bank, catch-up rate, flood |
| — | Security | security.test (client IP, limiter, tokens, production config); integration › negative paths; pgTls.test |

## Not run, and why

| Item | Reason |
|---|---|
| `docker build` with the official `node:22-bookworm-slim` | Every registry is blocked from the audit environment (Docker Hub, ECR Public, GCR mirror, GHCR: 403). The image was built with a stand-in base providing the same Node 22 binary, corepack and `node` user; run one build in CI or on your machine. |
| Deployment to Render/Vercel, post-deploy checks | Needs your accounts and creates billable resources (not authorised). |
| 60 FPS on a real GPU | No GPU here. The benchmark page is ready; results from real hardware are still missing (AUDIT_REPORT.md P1). |
| Two physically different devices over the Internet | Only localhost with simulated latency, jitter, stalls and drops. |
| Host mode on real networks (school Wi-Fi, NAT, client isolation) and TURN relays | Needs real networks and a TURN account; the E2E runs both browsers on one machine. |
| Firefox / Safari | Only Chrome is installed here. |
| Packet loss | WebSockets run on TCP: loss appears as stalls, which the proxy simulates. |
