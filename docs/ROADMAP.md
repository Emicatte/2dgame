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
- [ ] Docker image built and published (blocked here: registry not reachable)
- [ ] Deployed and verified on the public domain (needs your accounts and approval)

## Next steps (proposed)

1. **Deploy** following DEPLOYMENT.md and run the post-deploy checklist with two real devices.
2. **Playtest balance** with 4–8 people: sniper 95 dmg, shotgun close-range one-shot window,
   SMG mobility. All values are in `packages/shared/src/config/weapons.ts`.
3. **Measure FPS on real hardware** (overlay) on a low-end laptop; if needed, default to Low quality
   on weak GPUs.
4. **Bots for quick match** when only one player is online (the training-target driver is the
   starting point; needs a simple aim/move AI).
5. **Registered accounts** linking the existing guest id (email magic link or OAuth), then
   cross-device profiles.
6. **More cosmetics**: weapon skins, tracer colors, kill effects (all cosmetic).
7. **Tiled importer** for maps and a map rotation in quick match.
8. **Scaling**: Redis presence/driver when one instance is no longer enough (ARCHITECTURE.md).
9. **Observability**: export tick cost and room counts as metrics; error tracking on the client.
10. **Name and brand**: final title, trademark check, logo.
