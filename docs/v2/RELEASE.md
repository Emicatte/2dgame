# 0.4.0 release checklist (Phase 8)

Everything below the line "on your devices" cannot be done from the build machine. The public
deployment (`main` on Vercel) still runs 0.3.0 (Team Deathmatch); 0.4.0 lives on the branch
`scrapline-2`, whose Vercel **preview** deployment is the place to test it.

## Done on the build machine

- [x] Lint, typecheck, unit + integration suites (shared 90, web 40, server 115 with PostgreSQL 16)
- [x] Netcode matrix 15/15 (`docs/audit/data/netaudit-v2-phase7.json`)
- [x] Two-browser E2E: server (7 specs) and WebRTC host mode (2 specs)
- [x] Production build
- [x] Migration `0001_career` applied and tested on PostgreSQL 16 (only needed if you run the
      dedicated server with a database; host mode has no database)

## On your devices (preview URL of `scrapline-2`)

1. Two computers, two different networks (e.g. home Wi-Fi + phone hotspot): create an arena on
   one, join with the code on the other.
2. Urban Warfare, Team Deathmatch or Vehicle Mayhem: one drives the Hatch, the other rides in
   the front passenger seat and shoots out of the window while moving; then both get out.
3. Military Airbase: one pilots the Kestrel (Shift = take off / land), the other takes the
   gunner seat (F to change seat) and fires the chin gun.
4. Capture the Flag and Domination, one round each.
5. Turn on the network/performance overlay (Settings) and watch the FPS on the large maps with
   vehicles moving: it should stay near your screen's refresh rate. Note the join time on Urban Warfare (lobby → map visible).
6. At school: the same as step 1 on the school network (WebRTC may be blocked there, see
   `docs/HOST_MODE.md`).

## Publish (only after the checks above, and with your go)

Merging `scrapline-2` into `main` makes Vercel build and publish production:

```bash
git checkout main && git merge --ff-only scrapline-2 && git push origin main
```

Rollback: promote the previous production deployment (0.3.0) in the Vercel dashboard, or
`git revert` the merge and push.
