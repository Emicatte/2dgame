import { MAP_IDS, MAPS, MATCH_LIMITS, skinById } from "@scrapline/shared";
import { useState } from "react";
import { mapThumb } from "../components/mapThumbs.ts";
import { Button, formatClock, hexColor, LevelChip, Panel } from "../components/ui.tsx";
import { useStore } from "../lib/store.ts";
import { session, sessionStore } from "../net/session.ts";

const DURATIONS = [180, 300, 420, 600, 900];
const KILL_LIMITS = [10, 15, 20, 30, 50];

export function Lobby({ onOpenLoadout }: { onOpenLoadout: () => void }) {
  const s = useStore(sessionStore);
  const [copied, setCopied] = useState(false);
  const self = s.players.find((p) => p.id === s.selfId);
  const isHost = s.hostId === s.selfId;
  const isPrivate = s.kind === "private";
  const others = s.players.filter((p) => p.id !== s.hostId);
  const allReady = others.every((p) => p.ready);
  const startsIn = s.phaseEndTick > 0 ? (s.phaseEndTick - s.tick) / (s.tickRate || 20) : null;
  const inviteUrl = `${location.origin}${location.pathname}?join=${s.code}`;

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="screen screen--dim">
      <div className="lobby">
        <div className="stack">
          <Panel title={isPrivate ? "Private room" : "Quick match lobby"}>
            <div className="lobby__code">
              <div className="stack" style={{ gap: 0 }}>
                <span className="stencil">Room code</span>
                <span className="lobby__code-value" data-testid="room-code">
                  {s.code}
                </span>
              </div>
              <span className="spacer" />
              <Button size="sm" onClick={copyInvite}>
                {copied ? "Link copied" : "Copy invite link"}
              </Button>
            </div>
          </Panel>

          <Panel title={`Players ${s.players.length}/${s.maxPlayers}`}>
            <div className="player-list" data-testid="lobby-players">
              {s.players.map((p) => {
                const skin = skinById(p.skin);
                const host = p.id === s.hostId;
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
                      {!p.connected && <span className="badge badge--warn">Reconnecting</span>}
                    </span>
                    <span className={`badge ${p.ready || (host && isPrivate) ? "badge--good" : ""}`}>
                      {host && isPrivate ? "Host" : p.ready ? "Ready" : "Not ready"}
                    </span>
                    {isHost && isPrivate && p.id !== s.selfId ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => session.kick(p.id)}
                        aria-label={`Kick ${p.name}`}
                      >
                        Kick
                      </Button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
              {Array.from({ length: Math.max(0, Math.min(3, s.maxPlayers - s.players.length)) }, (_, i) => (
                <div key={`empty-${i}`} className="player-row player-row--empty">
                  <span className="player-row__avatar" style={{ borderColor: "var(--line-2)" }} />
                  <span className="field__hint">Waiting for player…</span>
                  <span />
                  <span />
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Match">
            <div className="stack">
              <div className="grid-3">
                {MAP_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="map-card"
                    aria-pressed={s.mapId === id}
                    disabled={!isHost || !isPrivate}
                    onClick={() => session.updateSettings({ map: id })}
                    title={MAPS[id].tagline}
                  >
                    <img className="map-card__preview" src={mapThumb(id)} alt="" />
                    <span className="map-card__label">{MAPS[id].name}</span>
                  </button>
                ))}
              </div>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <span className="badge">Deathmatch</span>
                <span className="badge">{formatClock(s.durationSec)} min</span>
                <span className="badge">{s.killLimit} eliminations</span>
              </div>
              {isHost && isPrivate && (
                <div className="stack">
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
                  <div className="setting-row">
                    <span>Eliminations to win</span>
                    <select
                      className="input"
                      value={s.killLimit}
                      onChange={(e) => session.updateSettings({ killLimit: Number(e.target.value) })}
                    >
                      {KILL_LIMITS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>
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
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <div className="stack">
              {!isPrivate && (
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
              {isPrivate && isHost ? (
                <Button
                  variant="primary"
                  size="lg"
                  block
                  disabled={!allReady}
                  onClick={() => session.startMatch()}
                  data-testid="start-match"
                >
                  {allReady
                    ? s.players.length < 2
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
                <Button variant="danger" onClick={() => void session.leave()}>
                  Leave
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
