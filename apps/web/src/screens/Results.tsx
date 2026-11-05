import { useEffect } from "react";
import { Button, formatClock, Panel } from "../components/ui.tsx";
import { useStore } from "../lib/store.ts";
import { session, sessionStore } from "../net/session.ts";
import { refreshProfile } from "../state/profile.ts";

export function Results() {
  const s = useStore(sessionStore);
  const r = s.results;
  const win = s.winnerId === s.selfId;
  const self = s.players.find((p) => p.id === s.selfId);
  const backIn = s.phaseEndTick > 0 ? (s.phaseEndTick - s.tick) / (s.tickRate || 20) : 0;
  const rows =
    r?.rows ??
    [...s.players]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map((p, i) => ({
        id: p.id,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
        placement: i + 1,
        accuracy: null,
      }));

  useEffect(() => {
    if (r?.personal?.persisted) void refreshProfile();
  }, [r]);

  return (
    <div className="screen screen--dim">
      <div className="results" data-testid="results">
        <div>
          <span className="stencil">Match over</span>
          <h1 className={`results__title ${win ? "is-win" : ""}`}>{win ? "Victory" : "Defeat"}</h1>
        </div>
        <div className="grid-2" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
          <Panel title="Final standings">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th className="num">Elims</th>
                  <th className="num">Deaths</th>
                  <th className="num">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={row.id === s.selfId ? "is-self" : ""}>
                    <td className="mono">{row.placement}</td>
                    <td>{row.name}</td>
                    <td className="num">{row.kills}</td>
                    <td className="num">{row.deaths}</td>
                    <td className="num">
                      {row.accuracy === null ? "—" : `${Math.round(row.accuracy * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Experience">
            {!r?.personal && <p className="field__hint">Calculating rewards…</p>}
            {r?.personal && (
              <div className="stack">
                <div className="xp-lines">
                  {r.personal.xpLines.map((l) => (
                    <div className="xp-line" key={l.reason}>
                      <span>{l.reason}</span>
                      <b>+{l.xp}</b>
                    </div>
                  ))}
                  {r.personal.xpLines.length === 0 && <span className="field__hint">No XP this time.</span>}
                </div>
                <div className="divider" />
                <div className="xp-line">
                  <span>Total</span>
                  <b data-testid="xp-total">+{r.personal.xpGained} XP</b>
                </div>
                {r.personal.leveledUp && (
                  <span className="badge badge--accent">Level up! Now level {r.personal.level}</span>
                )}
                {r.personal.unlocked.length > 0 && (
                  <span className="badge badge--good">Unlocked: {r.personal.unlocked.join(", ")}</span>
                )}
                {!r.personal.persisted && (
                  <span className="field__hint">
                    Progress could not be saved this time (server storage unavailable).
                  </span>
                )}
              </div>
            )}
          </Panel>
        </div>
        <div className="row">
          <span className="field__hint">Back to the lobby in {formatClock(backIn)}</span>
          <span className="spacer" />
          <Button variant="danger" onClick={() => void session.leave()}>
            Leave room
          </Button>
          <Button
            variant="primary"
            onClick={() => session.setReady(true)}
            disabled={self?.ready}
            data-testid="play-again"
          >
            {self?.ready ? "Ready for next match" : "Play again"}
          </Button>
        </div>
      </div>
    </div>
  );
}
