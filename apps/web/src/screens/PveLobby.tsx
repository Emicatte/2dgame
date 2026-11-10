import {
  CAMPAIGN_PLAN,
  DIFFICULTIES,
  DIFFICULTY,
  isDifficulty,
  MAPS,
  MISSIONS,
  missionById,
  PVE_SQUAD,
  SURVIVAL_MAPS,
  ZOMBIES,
} from "@scrapline/shared";
import { mapThumb } from "../components/mapThumbs.ts";
import { formatClock } from "../components/ui.tsx";
import { useStore } from "../lib/store.ts";
import { session, sessionStore } from "../net/session.ts";
import { localProfile } from "../state/localProfile.ts";

/**
 * Co-op lobby: mission (Outbreak) or map (Survival), difficulty, squad size and the briefing. The
 * host picks; everybody sees the same briefing.
 */
export function PveMatchSettings({ canHost }: { canHost: boolean }) {
  const s = useStore(sessionStore);
  const progress = localProfile.pve();
  const difficulty = isDifficulty(s.difficulty) ? s.difficulty : "veteran";
  const mission = missionById(s.mission);
  const humans = s.players.filter((p) => !p.id.startsWith("bot:")).length;

  return (
    <div className="stack pve-lobby" data-testid="pve-settings">
      {s.mode === "outbreak" ? (
        <>
          <ol className="campaign" aria-label="Campaign">
            {CAMPAIGN_PLAN.map((c) => {
              const m = MISSIONS.find((x) => x.chapter === c.chapter);
              // Every chapter is open: the campaign order is a suggestion, not a lock.
              const unlocked = !!m;
              const best = m ? progress.missions[m.id]?.best[difficulty] : undefined;
              const selected = !!m && s.mission === m.id;
              return (
                <li key={c.chapter}>
                  <button
                    type="button"
                    className={`campaign__mission ${m ? "" : "is-planned"}`}
                    aria-pressed={selected}
                    disabled={!canHost || !m || !unlocked}
                    onClick={() => m && session.updateSettings({ mission: m.id })}
                    data-testid={m ? `mission-${m.id}` : `mission-planned-${c.chapter}`}
                    title={m ? m.setting : "In development: not playable yet"}
                  >
                    <span className="campaign__chapter mono">{String(c.chapter).padStart(2, "0")}</span>
                    <span className="campaign__name">{c.name}</span>
                    <small>
                      {m
                        ? best
                          ? `Best ${formatClock(best)} on ${DIFFICULTY[difficulty].name}`
                          : c.setting
                        : "In development"}
                    </small>
                  </button>
                </li>
              );
            })}
          </ol>
          <ol className="campaign" aria-label="Operations">
            {MISSIONS.filter((m) => m.chapter === 0).map((m) => {
              const best = progress.missions[m.id]?.best[difficulty];
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className="campaign__mission"
                    aria-pressed={s.mission === m.id}
                    disabled={!canHost}
                    onClick={() => session.updateSettings({ mission: m.id })}
                    data-testid={`mission-${m.id}`}
                    title={m.setting}
                  >
                    <span className="campaign__chapter mono">OP</span>
                    <span className="campaign__name">{m.name}</span>
                    <small>
                      {best ? `Best ${formatClock(best)} on ${DIFFICULTY[difficulty].name}` : m.setting}
                    </small>
                  </button>
                </li>
              );
            })}
          </ol>
          {mission && (
            <div className="briefing" data-testid="briefing">
              <img className="briefing__map" src={mapThumb(mission.map)} alt="" />
              <div>
                <h4 className="briefing__title">{mission.name}</h4>
                <p className="briefing__setting">{mission.setting}</p>
                <p>{mission.brief}</p>
                <p className="briefing__enemies">
                  Infected:{" "}
                  {[
                    ...new Set([
                      ...mission.groups.flatMap((g) => g.enemies.map((e) => e.kind)),
                      ...mission.steps.flatMap((st) =>
                        st.kind === "waves"
                          ? st.waves.flatMap((w) => [
                              ...(w.boss ? [w.boss] : []),
                              ...(Object.keys(w.enemies) as (keyof typeof ZOMBIES)[]),
                            ])
                          : [],
                      ),
                    ]),
                  ]
                    .map((k) => ZOMBIES[k].name)
                    .join(", ")}
                </p>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="grid-3">
          {SURVIVAL_MAPS.map((id) => (
            <button
              key={id}
              type="button"
              className="map-card"
              aria-pressed={s.mapId === id}
              disabled={!canHost}
              onClick={() => session.updateSettings({ map: id })}
              data-testid={`map-${id}`}
              title={MAPS[id].tagline}
            >
              <img className="map-card__preview" src={mapThumb(id)} alt="" />
              <span className="map-card__label">{MAPS[id].name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="setting-row">
        <span>Difficulty</span>
        <fieldset className="seg" aria-label="Difficulty" data-testid="difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={difficulty === d}
              disabled={!canHost}
              onClick={() => session.updateSettings({ difficulty: d })}
              data-testid={`difficulty-${d}`}
            >
              {DIFFICULTY[d].name}
            </button>
          ))}
        </fieldset>
      </div>
      <p className="mode-blurb">{DIFFICULTY[difficulty].blurb}</p>
      <div className="row" style={{ flexWrap: "wrap" }} data-testid="match-rules">
        <span className="badge">
          Squad {humans}/{PVE_SQUAD.max}
        </span>
        <span className="badge">Revive: hold E on a downed teammate</span>
        {humans === 1 && (
          <span className="badge">
            Solo: {DIFFICULTY[difficulty].selfRevives} self-revive
            {DIFFICULTY[difficulty].selfRevives === 1 ? "" : "s"}
          </span>
        )}
        {s.mode === "survival" && progress.survivalBest[difficulty] ? (
          <span className="badge">Your record: wave {progress.survivalBest[difficulty]}</span>
        ) : null}
      </div>
    </div>
  );
}
