import {
  type GameMode,
  isPveMode,
  isRoleMode,
  isTeamMode,
  MAPS,
  MATCH_LIMITS,
  MODE_BLURBS,
  MODE_CATEGORIES,
  MODE_NAMES,
  MODE_SCORE_UNIT,
  MODE_VARIANTS,
  MODES,
  mapSupportsMode,
  modeEnabled,
  PVP_MAP_IDS,
  ROUND_LIMITS,
  skinById,
  TEAM_SIZE,
  TEAMS,
} from "@scrapline/shared";
import { useState } from "react";
import { mapThumb } from "../components/mapThumbs.ts";
import { Button, formatClock, hexColor, LevelChip, Panel } from "../components/ui.tsx";
import { MODE_FLAGS } from "../lib/modeFlags.ts";
import { useStore } from "../lib/store.ts";
import { HOST_MODE } from "../net/api.ts";
import { type LobbyPlayer, session, sessionStore } from "../net/session.ts";
import { PveMatchSettings } from "./PveLobby.tsx";

const DURATIONS = [180, 300, 420, 600, 900];
const EMPTY_SLOT_KEYS = ["empty-a", "empty-b", "empty-c", "empty-d"];
const KILL_LIMITS = [10, 15, 20, 30, 50];
/** Score limits offered per mode (the current value is always offered too). */
const SCORE_LIMITS: Record<GameMode, number[]> = {
  deathmatch: KILL_LIMITS,
  tdm: KILL_LIMITS,
  dom: [50, 100, 150, 200],
  ctf: [1, 2, 3, 5],
  mayhem: [20, 30, 50, 80],
  gungame: [],
  hideseek: [],
  prophunt: [],
  outbreak: [],
  survival: [],
};

export function Lobby({ onOpenLoadout }: { onOpenLoadout: () => void }) {
  const s = useStore(sessionStore);
  const [copied, setCopied] = useState<"room" | "team" | null>(null);
  const self = s.players.find((p) => p.id === s.selfId);
  const isHost = s.hostId === s.selfId;
  const isPrivate = s.kind === "private";
  const teams = isTeamMode(s.mode);
  const others = s.players.filter((p) => p.id !== s.hostId);
  const allReady = others.every((p) => p.ready);
  const startsIn = s.phaseEndTick > 0 ? (s.phaseEndTick - s.tick) / (s.tickRate || 20) : null;
  const origin =
    typeof __PUBLIC_ORIGIN__ === "string" && __PUBLIC_ORIGIN__ ? __PUBLIC_ORIGIN__ : location.origin;
  const inviteUrl = `${origin}${location.pathname}?join=${s.code}`;
  const myTeam = self?.team === 1 || self?.team === 2 ? self.team : null;
  // Left the running match: waits here (settings read-only, no ready/start) until the next one.
  const waiting = s.phase !== "lobby";
  const canHost = isHost && isPrivate && !waiting;

  async function copy(kind: "room" | "team") {
    const url = kind === "team" && myTeam ? `${inviteUrl}&team=${myTeam}` : inviteUrl;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }

  const row = (p: LobbyPlayer) => {
    const skin = skinById(p.skin);
    const host = p.id === s.hostId;
    const bot = p.id.startsWith("bot:");
    return (
      <div key={p.id} className={`player-row ${p.id === s.selfId ? "is-self" : ""}`}>
        <span
          className="player-row__avatar"
          style={{ background: hexColor(skin.primary), borderColor: hexColor(skin.accent) }}
          aria-hidden="true"
        />
        <span className="player-row__name">
          <LevelChip level={p.level} />
          <span>{p.name}</span>
          {host && isPrivate && <span className="badge badge--accent">Host</span>}
          {bot && <span className="badge">Bot</span>}
          {!p.connected && <span className="badge badge--warn">Reconnecting</span>}
        </span>
        <span className={`badge ${p.ready || (host && isPrivate) ? "badge--good" : ""}`}>
          {host && isPrivate ? "Host" : p.ready ? "Ready" : "Not ready"}
        </span>
        {canHost && p.id !== s.selfId && !bot ? (
          <Button size="sm" variant="danger" onClick={() => session.kick(p.id)} aria-label={`Kick ${p.name}`}>
            Kick
          </Button>
        ) : (
          <span />
        )}
      </div>
    );
  };

  const emptyRows = (n: number, prefix: string) =>
    EMPTY_SLOT_KEYS.slice(0, Math.max(0, Math.min(EMPTY_SLOT_KEYS.length, n))).map((key) => (
      <div key={`${prefix}-${key}`} className="player-row player-row--empty">
        <span className="player-row__avatar" style={{ borderColor: "var(--line-2)" }} />
        <span className="field__hint">Waiting for player…</span>
        <span />
        <span />
      </div>
    ));

  const humans = s.players.filter((p) => !p.id.startsWith("bot:"));
  const def = MODES[s.mode];
  const roles = isRoleMode(s.mode);
  /** The mode has its own end rule (ladder, rounds): no score limit to pick. */
  const ownEnd = s.mode === "gungame" || roles;
  const tooFew = humans.length < def.players.min;
  /** Modes a host can pick here, by category (co-op last). */
  const pickable = MODE_CATEGORIES.map((c) => ({
    ...c,
    modes: c.modes.filter(
      (m): m is GameMode =>
        m in MODES && MODES[m as GameMode].status === "available" && modeEnabled(m, MODE_FLAGS),
    ),
  })).filter((c) => c.modes.length > 0);

  return (
    <div className="screen screen--dim">
      <div className="lobby">
        <div className="stack">
          <Panel
            title={isPrivate ? (HOST_MODE ? "Arena" : "Private room") : `Quick match · ${MODE_NAMES[s.mode]}`}
          >
            <div className="lobby__code">
              <div className="stack" style={{ gap: 0 }}>
                <span className="stencil">Room code</span>
                <span className="lobby__code-value" data-testid="room-code">
                  {s.code}
                </span>
              </div>
              <span className="spacer" />
              <Button size="sm" onClick={() => void copy("room")}>
                {copied === "room" ? "Link copied" : "Copy invite link"}
              </Button>
              {teams && myTeam && (
                <Button size="sm" onClick={() => void copy("team")} data-testid="invite-team">
                  {copied === "team" ? "Link copied" : `Invite to ${TEAMS[myTeam].name}`}
                </Button>
              )}
            </div>
            {HOST_MODE && isHost && (
              <p className="field__hint" style={{ marginTop: 8 }} data-testid="host-hint">
                This arena runs on your computer: keep this tab open and in front until everyone is done.
              </p>
            )}
          </Panel>

          {teams ? (
            <div className="team-columns" data-testid="lobby-players">
              {([1, 2] as const).map((t) => {
                const members = s.players.filter((p) => p.team === t);
                const humansIn = members.filter((p) => !p.id.startsWith("bot:")).length;
                const full = humansIn >= s.teamSize;
                return (
                  <Panel
                    key={t}
                    className={`team-panel team-panel--${t}`}
                    title={
                      <span className="team-title" style={{ color: TEAMS[t].css }}>
                        Team {TEAMS[t].name}{" "}
                        <span className="mono">
                          {humansIn}/{s.teamSize}
                        </span>
                      </span>
                    }
                  >
                    <div className="player-list" data-testid={`team-${t}`}>
                      {members.map(row)}
                      {/* Practice targets fill slots visually; they leave when a second human joins. */}
                      {emptyRows(s.teamSize - members.length, `t${t}`)}
                    </div>
                    {myTeam !== t && (
                      <Button
                        size="sm"
                        block
                        disabled={full}
                        onClick={() => session.setTeam(t)}
                        data-testid={`join-team-${t}`}
                        style={{ marginTop: 8 }}
                      >
                        {full ? "Team full" : `Join ${TEAMS[t].name}`}
                      </Button>
                    )}
                  </Panel>
                );
              })}
            </div>
          ) : (
            <Panel title={`Players ${s.players.length}/${s.maxPlayers}`}>
              <div className="player-list" data-testid="lobby-players">
                {s.players.map(row)}
                {emptyRows(Math.min(3, s.maxPlayers - s.players.length), "ffa")}
              </div>
            </Panel>
          )}
        </div>

        <div className="stack">
          <Panel title="Match">
            <div className="stack">
              {canHost && (
                <div className="stack" data-testid="mode-select" style={{ gap: 6 }}>
                  {pickable.map((c) => (
                    <fieldset
                      key={c.id}
                      className={`mode-grid ${c.id === "coop" ? "mode-grid--coop" : ""}`}
                      aria-label={`${c.name} modes`}
                    >
                      <legend className="stencil mode-grid__legend">{c.name}</legend>
                      {c.modes.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`mode-card ${c.id === "coop" ? "mode-card--coop" : ""}`}
                          aria-pressed={s.mode === m}
                          onClick={() => session.updateSettings({ mode: m })}
                          data-testid={`mode-${m}`}
                        >
                          {MODE_NAMES[m]}
                          <small>
                            {MODES[m].players.min === MODES[m].players.max
                              ? MODES[m].players.min
                              : `${MODES[m].players.min}–${MODES[m].players.max}`}{" "}
                            players
                          </small>
                        </button>
                      ))}
                    </fieldset>
                  ))}
                </div>
              )}
              <p className="mode-blurb" data-testid="mode-blurb">
                {MODE_BLURBS[s.mode]}
              </p>
              {(ownEnd || !canHost) && (
                <ul className="mode-rules" data-testid="mode-rules">
                  {def.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {isPveMode(s.mode) ? (
                <PveMatchSettings canHost={canHost} />
              ) : (
                <>
                  <div className="grid-3">
                    {PVP_MAP_IDS.filter((id) => mapSupportsMode(MAPS[id], s.mode) || id === s.mapId).map(
                      (id) => (
                        <button
                          key={id}
                          type="button"
                          className="map-card"
                          aria-pressed={s.mapId === id}
                          disabled={!canHost}
                          onClick={() => session.updateSettings({ map: id })}
                          title={
                            MAPS[id].players
                              ? `${MAPS[id].tagline} Best with ${MAPS[id].players!.min}–${MAPS[id].players!.max} players.`
                              : MAPS[id].tagline
                          }
                          data-testid={`map-${id}`}
                        >
                          <img className="map-card__preview" src={mapThumb(id)} alt="" />
                          <span className="map-card__label">
                            {MAPS[id].name}
                            {MAPS[id].vehicleSpawns && def.vehicles && (
                              <span className="map-card__tag">Vehicles</span>
                            )}
                            {MAPS[id].party && <span className="map-card__tag">Party</span>}
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                  <div className="row" style={{ flexWrap: "wrap" }} data-testid="match-rules">
                    <span className="badge">{MODE_NAMES[s.mode]}</span>
                    {teams && (
                      <span className="badge">
                        {s.teamSize}v{s.teamSize}
                      </span>
                    )}
                    {roles ? (
                      <>
                        <span className="badge">{s.killLimit} rounds</span>
                        <span className="badge" data-testid="variant-badge">
                          {MODE_VARIANTS[s.mode]?.find((v) => v.id === s.round.variant)?.name ?? "Classic"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="badge">{formatClock(s.durationSec)} min</span>
                        {!ownEnd && (
                          <span className="badge">
                            {s.killLimit} {MODE_SCORE_UNIT[s.mode]}
                          </span>
                        )}
                      </>
                    )}
                    <span className="badge">
                      {def.players.min}–{def.players.max} players
                    </span>
                    {teams && <span className="badge">Friendly fire {s.friendlyFire ? "on" : "off"}</span>}
                  </div>
                </>
              )}
              {canHost && !isPveMode(s.mode) && (
                <div className="stack">
                  {teams && (
                    <div className="setting-row">
                      <span>Team size</span>
                      <select
                        className="input"
                        value={s.teamSize}
                        onChange={(e) => session.updateSettings({ teamSize: Number(e.target.value) })}
                        data-testid="team-size"
                      >
                        {Array.from(
                          { length: TEAM_SIZE.max - TEAM_SIZE.min + 1 },
                          (_, i) => i + TEAM_SIZE.min,
                        ).map((n) => (
                          <option key={n} value={n} disabled={n * 2 < humans.length}>
                            {n}v{n}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {roles && (
                    <>
                      <div className="setting-row">
                        <span>Variant</span>
                        <select
                          className="input"
                          value={s.round.variant}
                          onChange={(e) => session.updateSettings({ variant: e.target.value })}
                          data-testid="variant"
                        >
                          {(MODE_VARIANTS[s.mode] ?? []).map((v) => (
                            <option key={v.id} value={v.id} title={v.blurb}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="setting-row">
                        <span>Rounds</span>
                        <select
                          className="input"
                          value={s.killLimit}
                          onChange={(e) => session.updateSettings({ rounds: Number(e.target.value) })}
                          data-testid="rounds"
                        >
                          {Array.from(
                            { length: ROUND_LIMITS.max - ROUND_LIMITS.min + 1 },
                            (_, i) => i + ROUND_LIMITS.min,
                          ).map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  {!roles && (
                    <div className="setting-row">
                      <span>Duration</span>
                      <select
                        className="input"
                        value={s.durationSec}
                        onChange={(e) => session.updateSettings({ durationSec: Number(e.target.value) })}
                      >
                        {DURATIONS.filter(
                          (d) => d >= MATCH_LIMITS.durationSec.min && d <= MATCH_LIMITS.durationSec.max,
                        ).map((d) => (
                          <option key={d} value={d}>
                            {d / 60} minutes
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {!ownEnd && (
                    <div className="setting-row">
                      <span>
                        {MODE_SCORE_UNIT[s.mode].charAt(0).toUpperCase() + MODE_SCORE_UNIT[s.mode].slice(1)}{" "}
                        to win
                      </span>
                      <select
                        className="input"
                        value={s.killLimit}
                        onChange={(e) => session.updateSettings({ killLimit: Number(e.target.value) })}
                      >
                        {[...new Set([...SCORE_LIMITS[s.mode], s.killLimit])]
                          .sort((a, b) => a - b)
                          .map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                  {teams ? (
                    <div className="setting-row">
                      <span>Friendly fire</span>
                      <fieldset className="seg" aria-label="Friendly fire">
                        {[false, true].map((on) => (
                          <button
                            key={String(on)}
                            type="button"
                            aria-pressed={s.friendlyFire === on}
                            onClick={() => session.updateSettings({ friendlyFire: on })}
                          >
                            {on ? "On" : "Off"}
                          </button>
                        ))}
                      </fieldset>
                    </div>
                  ) : (
                    <div className="setting-row">
                      <span>Max players</span>
                      <select
                        className="input"
                        value={s.maxPlayers}
                        onChange={(e) => session.updateSettings({ maxPlayers: Number(e.target.value) })}
                      >
                        {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                          <option key={n} value={n} disabled={n < s.players.length}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {teams && humans.length >= 2 && (
                    <Button size="sm" onClick={() => session.balanceTeams()} data-testid="balance-teams">
                      Balance teams by level
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <div className="stack">
              {waiting && (
                <div className="countdown-banner" data-testid="away-banner">
                  <span>Match in progress: you are back in for the next one</span>
                </div>
              )}
              {!isPrivate && !waiting && (
                <div className="countdown-banner" aria-live="polite">
                  {startsIn !== null ? (
                    <>
                      <span>Match starts in</span>
                      <span className="mono">{Math.max(0, Math.ceil(startsIn))}s</span>
                    </>
                  ) : (
                    <span>Waiting for at least 2 players…</span>
                  )}
                </div>
              )}
              {waiting ? null : canHost ? (
                <Button
                  variant="primary"
                  size="lg"
                  block
                  disabled={!allReady || tooFew}
                  onClick={() => session.startMatch()}
                  data-testid="start-match"
                >
                  {tooFew
                    ? `Needs ${def.players.min} players`
                    : allReady
                      ? isPveMode(s.mode)
                        ? s.mode === "survival"
                          ? "Start survival"
                          : "Start mission"
                        : s.players.length < 2
                          ? "Start practice"
                          : "Start match"
                      : "Waiting for ready…"}
                </Button>
              ) : (
                <Button
                  variant={self?.ready ? "default" : "primary"}
                  size="lg"
                  block
                  onClick={() => session.setReady(!self?.ready)}
                  data-testid="ready-toggle"
                >
                  {self?.ready ? "Not ready" : "Ready"}
                </Button>
              )}
              <div className="row">
                <Button variant="ghost" onClick={onOpenLoadout}>
                  Loadout
                </Button>
                <span className="spacer" />
                <Button variant="danger" onClick={() => void session.leave()} data-testid="leave-arena">
                  Leave arena
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
