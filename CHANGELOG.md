# Changelog

## 0.1.0 — 2026-11-05

First playable version.

### Added
- pnpm monorepo: `apps/web` (React 19, Vite 8, Phaser 4.2), `apps/server` (Colyseus 0.18,
  Express 5, Drizzle, PostgreSQL), `packages/shared` (config, protocol, state schema, deterministic
  simulation).
- Top-down shooter gameplay: acceleration-based movement, dash, independent aim, five data-driven
  weapons (pistol, assault rifle, SMG, shotgun, sniper), bloom and movement spread, reloads, weapon
  slots, pickups (health, ammo, weapons), spawn protection, smart respawns.
- Three point-symmetric maps: Industrial Arena, Neon District, Desert Outpost.
- Authoritative multiplayer: 60 Hz client prediction, 20 Hz server ticks, reconciliation,
  interpolation with a jitter-tolerant server clock, lag-compensated hitscan, owner-only state via
  StateView, real-time input budget against speed hacks.
- Deathmatch: countdown, timer, kill limit, kill feed, Tab scoreboard, death/respawn screen,
  results with XP breakdown, rematch.
- Lobby: quick match with auto-start, public room browser, private rooms with 5-character codes and
  invite links, ready states, host settings (map, duration, kill limit, max players), kick.
- Guest identity with HMAC-signed tokens; XP, levels 1–20, cosmetic skins, career stats, leaderboard.
- Solo practice against strafing training targets (never recorded).
- Procedural art (soldiers, weapons, props, maps), lights, particles, tracers, hit markers, damage
  numbers, camera shake; Web Audio synthesized sound effects.
- Settings: volumes, quality, screen shake, crosshair color, key rebinding, FPS/network overlay.
- Reconnection (auto + after page reload), AFK removal, idle lobby closing, graceful drain on SIGTERM.
- Tests: unit, real-socket integration, PostgreSQL contract, two-browser Playwright E2E (also under
  simulated latency), load-test script, network-conditions proxy.
- Deployment: Dockerfile, docker-compose, Render Blueprint, Vercel config, documentation.

### Fixed during development
- Server processed inputs at about a third of real time because the room clock's `deltaTime` is
  shared with other timers; tick time is now measured directly.
- Phaser's smoothed delta slowed the fixed-step simulation at low frame rates; the client now
  uses real elapsed time.
- Quick matches never auto-started because unset schema numbers are `undefined`; every synchronized
  field now has an explicit default.
- Colyseus default CORS (`*`) applied to all routes; now restricted to configured origins, with
  credentials allowed only for them (the SDK requires it for matchmaking).
- Map baking took ~20 s on software renderers due to canvas blur filters; shadows are now drawn at
  1/8 resolution and upscaled (~25 ms).
