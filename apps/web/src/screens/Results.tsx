import { DIFFICULTY, isDifficulty, isTeamMode, missionById, type PveResult, TEAMS } from "@scrapline/shared";
import { useEffect } from "react";
import { Button, formatClock, Panel } from "../components/ui.tsx";
import { useStore } from "../lib/store.ts";
import { session, sessionStore } from "../net/session.ts";
import { refreshProfile } from "../state/profile.ts";

export function Results() {
  const s = useStore(sessionStore);
  const r = s.results;
  const self = s.players.find((p) => p.id === s.selfId);
  const teams = isTeamMode(s.mode);
  const winnerTeam = r?.winnerTeam ?? s.winnerTeam;
  const scores = r?.teamScores ?? [s.scoreA, s.scoreB];
  const myTeam = self?.team ?? 0;
  const win = teams ? winnerTeam > 0 && winnerTeam === myTeam : s.winnerId === s.selfId;
  const draw = teams && winnerTeam === 0;
  const backIn = s.phaseEndTick > 0 ? (s.phaseEndTick - s.tick) / (s.tickRate || 20) : 0;
  const rows =
    r?.rows ??
    [...s.players]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map((p, i) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        kills: p.kills,
        deaths: p.deaths,
        placement: i + 1,
        accuracy: null,
      }));

  useEffect(() => {
    if (r?.personal?.persisted) void refreshProfile();
  }, [r]);

  if (r?.pve) return <PveResults r={r.pve} />;

  return (
    <div className="screen screen--dim">
      <div className="results" data-testid="results">
        <div>
          <span className="stencil">Match over</span>
          <h1 className={`results__title ${win ? "is-win" : ""}`} data-testid="results-title">
            {draw ? "Draw" : win ? "Victory" : "Defeat"}
          </h1>
          {teams && (
            <p className="team-score mono" data-testid="results-teams">
              <span className="team-tag team-tag--1">
                {TEAMS[1].name} {scores[0]}
              </span>
              <span>–</span>
              <span className="team-tag team-tag--2">
                {scores[1]} {TEAMS[2].name}
              </span>
            </p>
          )}
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
                    <td className={teams && row.team ? `team-tag--${row.team}` : undefined}>{row.name}</td>
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
                {r.personal.practice && (
                  <span className="field__hint">Practice match: progress and stats are not recorded.</span>
                )}
                {!r.personal.persisted && !r.personal.practice && (
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

/** End of an Outbreak mission or a Survival run: the squad's summary and this player's rewards. */
function PveResults({ r }: { r: PveResult }) {
  const s = useStore(sessionStore);
  const res = s.results;
  const self = s.players.find((p) => p.id === s.selfId);
  const backIn = s.phaseEndTick > 0 ? (s.phaseEndTick - s.tick) / (s.tickRate || 20) : 0;
  const mission = missionById(r.mission);
  const diff = isDifficulty(r.difficulty) ? DIFFICULTY[r.difficulty].name : r.difficulty;
  const me = r.squad.find((x) => x.id === s.selfId);
  const totalShots = me?.accuracy ?? null;
  const personal = res?.personal;
  return (
    <div className="screen screen--dim">
      <div className="results" data-testid="results">
        <div>
          <span className="stencil">
            {r.mode === "survival" ? "Survival" : (mission?.name ?? "Outbreak")} · {diff}
          </span>
          <h1 className={`results__title ${r.completed ? "is-win" : ""}`} data-testid="results-title">
            {r.mode === "survival"
              ? `Survived ${r.progress} wave${r.progress === 1 ? "" : "s"}`
              : r.completed
                ? "Mission complete"
                : "Mission failed"}
          </h1>
          {!r.completed && r.reason && <p className="field__hint">{r.reason}</p>}
          <p className="team-score mono" data-testid="pve-summary">
            <span>Time {formatClock(r.timeSec)}</span>
            <span>·</span>
            <span>{r.kills} infected eliminated</span>
            {r.mode === "outbreak" && (
              <>
                <span>·</span>
                <span>
                  Objectives {r.progress}/{r.steps}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="grid-2" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
          <Panel title="Squad">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Elims</th>
                  <th className="num">Damage</th>
                  <th className="num">Revives</th>
                  <th className="num">Downed</th>
                  <th className="num">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {r.squad.map((row) => (
                  <tr key={row.id} className={row.id === s.selfId ? "is-self" : ""}>
                    <td>{row.name}</td>
                    <td className="num">{row.kills}</td>
                    <td className="num">{row.damage}</td>
                    <td className="num">{row.revives}</td>
                    <td className="num">{row.downs}</td>
                    <td className="num">
                      {row.accuracy === null ? "—" : `${Math.round(row.accuracy * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Rewards">
            {!personal && <p className="field__hint">Calculating rewards…</p>}
            {personal && (
              <div className="stack">
                <div className="xp-lines">
                  {personal.xpLines.map((l) => (
                    <div className="xp-line" key={l.reason}>
                      <span>{l.reason}</span>
                      <b>+{l.xp}</b>
                    </div>
                  ))}
                  {personal.xpLines.length === 0 && <span className="field__hint">No XP this time.</span>}
                </div>
                <div className="divider" />
                <div className="xp-line">
                  <span>Total</span>
                  <b data-testid="xp-total">+{personal.xpGained} XP</b>
                </div>
                {personal.leveledUp && (
                  <span className="badge badge--accent">Level up! Now level {personal.level}</span>
                )}
                {(personal.pveTitles ?? []).map((t) => (
                  <span key={t} className="badge badge--good" data-testid="pve-title">
                    Title unlocked: {t}
                  </span>
                ))}
                {(personal.pveUnlocked ?? []).map((id) => (
                  <span key={id} className="badge badge--good">
                    Mission unlocked: {missionById(id)?.name ?? id}
                  </span>
                ))}
                {personal.pvePersonalBest && <span className="badge badge--accent">Personal best</span>}
                {!personal.persisted && (
                  <span className="field__hint">
                    {personal.record?.pve
                      ? "This run was already recorded."
                      : "Progress could not be saved this time."}
                  </span>
                )}
                {totalShots !== null && (
                  <span className="field__hint">Your accuracy: {Math.round(totalShots * 100)}%</span>
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
            {self?.ready ? "Ready" : "Play again"}
          </Button>
        </div>
      </div>
    </div>
  );
}
