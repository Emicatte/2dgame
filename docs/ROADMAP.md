# Roadmap and progress checklist

## Phases

| Phase | Result | Status |
|---|---|---|
| 1 Foundations | Monorepo, client with menu and game scene, server, shared package | Done |
| 2 Local gameplay | Movement, camera, aim, weapons, hitscan, collisions, health, Industrial Arena, effects; solo practice with training targets | Done |
| 3 Multiplayer | Rooms, WebSocket, authoritative sim, prediction, reconciliation, interpolation, lag-compensated combat, respawn | Done (tested in two browsers) |
| 4 Full matches | Deathmatch, timer, kill feed, scoreboard, win conditions, results, rematch | Done |
| 5 Content | Neon District, Desert Outpost, all five weapons, procedural audio, animations | Done; balance needs real playtests |
| 6 Lobby and progression | Main menu, quick match, room browser, private rooms with code/link, nicknames, profiles, XP, levels, stats, persistence | Done |
| 7 Hardening | Validation, reconnect, debug overlay, latency/jitter tests, load test, E2E | Done (see TESTING.md for what was not run) |
| 8 Deployment | Dockerfile, Render Blueprint, Vercel config, env, HTTPS/WSS, CORS, drain on deploy, DNS docs | Prepared, not deployed |
| Audit 0.1.1 | Networking, performance, security, build/deploy audit with fixes and tests (docs/audit/AUDIT_REPORT.md) | Done, except the items marked "not verified" below |

## Definition of done

- [x] The site opens in the browser
- [x] The menu works
- [x] The player enters a lobby
- [x] Two or more people join the same match (two independent browsers, E2E)
- [x] Players see each other's movement
- [x] Collisions work
- [x] Weapons fire
- [x] The server computes damage
- [x] Players are eliminated and respawn
- [x] The scoreboard updates
- [x] Matches end correctly (time or kill limit)
- [x] Three maps
- [x] Five weapon classes
- [x] XP and levels
- [x] Stats persist for players with a valid identity (PostgreSQL tested)
- [x] Private rooms work (code and invite link)
- [x] Consistent, usable interface
- [x] Production build passes
- [x] Essential tests pass
- [x] Backend ready for Render (Blueprint) or Scaleway (Docker)
- [x] Frontend ready for Vercel
- [x] Input pipeline measured under 0–250 ms RTT, jitter, stalls, drops and reloads (netaudit, E2E)
- [x] PostgreSQL TLS verified against a real TLS server (right CA, wrong CA, hostname, downgrade)
- [x] Docker image built and run (with a stand-in base image: registries blocked here)
- [ ] Docker image built from the official `node:22-bookworm-slim` base (CI or your machine)
- [ ] 60 FPS confirmed on real hardware with `bench.html` (no GPU here: not verified)
- [ ] Deployed and verified on the public domain (needs your accounts and approval)

## Next steps (proposed)

0. **Before publishing** (from the audit): run `bench.html` on the target hardware (at least one
   mid-range laptop with integrated graphics and one desktop), build the image from the official
   base in CI, and walk the post-deploy checklist. See AUDIT_REPORT.md, "Conditions for publication".
1. **Deploy** following DEPLOYMENT.md and run the post-deploy checklist with two real devices.
2. **Playtest balance** with 4–8 people: sniper 95 dmg, shotgun close-range one-shot window,
   SMG mobility. All values are in `packages/shared/src/config/weapons.ts`.
3. **Render scale for weak GPUs**: on software rendering frame time scales with pixel count
   (37 FPS at 640x360, 12 at 1366x768, 5 at 1920x1080 on SwiftShader). If real low-end devices
   miss 60 FPS, add a render-resolution option rather than removing effects (High vs Low differs
   by only ~5-10 % there).
4. **Bots for quick match** when only one player is online (the training-target driver is the
   starting point; needs a simple aim/move AI).
5. **Registered accounts** linking the existing guest id (email magic link or OAuth), then
   cross-device profiles.
6. **More cosmetics**: weapon skins, tracer colors, kill effects (all cosmetic).
7. **Tiled importer** for maps and a map rotation in quick match.
8. **Scaling**: Redis presence/driver when one instance is no longer enough (ARCHITECTURE.md).
9. **Observability**: export tick cost, room counts and the per-session input counters (already
   logged) as metrics; error tracking on the client.
11. **Image size**: the runtime image carries `typescript` and `@types/*` (~35 MB) pulled in as
    peer dependencies; prune them in the deploy step.
10. **Name and brand**: final title, trademark check, logo.
