import { PLAYER, PVE_STATUS } from "@scrapline/shared";
import { useEffect, useState } from "react";
import { pveHudStore } from "../game/pve/pveHud.ts";
import { useStore } from "../lib/store.ts";

/**
 * Outbreak / Survival HUD. Everything sits at the edges (objective top-left, squad left, feed
 * right, prompt bottom-centre above the weapon panel) so the centre of the fight stays clear.
 */
export function PveHud() {
  const h = useStore(pveHudStore);
  const [hint, setHint] = useState<{ text: string; id: number } | null>(null);
  const [banner, setBanner] = useState<{ text: string; tone: string; id: number } | null>(null);

  useEffect(() => {
    if (!h.hint) return;
    setHint(h.hint);
    const t = setTimeout(() => setHint((cur) => (cur?.id === h.hint?.id ? null : cur)), 7000);
    return () => clearTimeout(t);
  }, [h.hint]);
  useEffect(() => {
    if (!h.banner) return;
    setBanner(h.banner);
    const done = h.banner.tone === "good" || h.banner.tone === "bad";
    const t = setTimeout(
      () => setBanner((cur) => (cur?.id === h.banner?.id ? null : cur)),
      done ? 4000 : 2600,
    );
    return () => clearTimeout(t);
  }, [h.banner]);

  if (!h.active) return null;
  const me = h.me;
  const waveLine =
    h.wave > 0 && h.left > 0
      ? `Wave ${h.wave} · ${h.left} infected left`
      : h.nextWaveSec !== null
        ? `Next wave in ${Math.ceil(h.nextWaveSec)}s`
        : null;

  return (
    <div className="pve-hud" data-testid="pve-hud">
      <section className="pve-objective hud-box" aria-label="Objective" data-testid="pve-objective">
        <header>
          <span className="pve-objective__mission">{h.missionName}</span>
          <span className="pve-objective__diff">{h.difficulty}</span>
          {h.mode === "outbreak" && h.steps > 0 && (
            <span className="pve-objective__step mono">
              {Math.min(h.step + 1, h.steps)}/{h.steps}
            </span>
          )}
        </header>
        <p className="pve-objective__text" data-testid="pve-objective-text">
          {h.objective}
          {h.countMax > 0 && h.mode === "outbreak" && (
            <span className="mono">
              {" "}
              ({h.count}/{h.countMax})
            </span>
          )}
        </p>
        {h.prog > 0 && h.prog < 1 && (
          <div className="pve-bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${h.prog})` }} />
          </div>
        )}
        {waveLine && (
          <p className="pve-objective__wave mono" data-testid="pve-wave">
            {waveLine}
          </p>
        )}
        {h.mode === "survival" && <p className="pve-objective__wave mono">Infected eliminated: {h.kills}</p>}
      </section>

      <ul className="pve-squad" aria-label="Squad" data-testid="pve-squad">
        {h.squad.map((m) => (
          <li
            key={m.id}
            className={`${m.you ? "is-you" : ""} ${m.downed ? "is-downed" : ""} ${m.dead ? "is-dead" : ""}`}
          >
            <span className="pve-squad__name">{m.you ? "You" : m.name}</span>
            <span className="pve-squad__state mono">
              {m.dead ? "out" : m.downed ? `DOWN ${Math.ceil(m.bleedSec)}s` : m.hp}
            </span>
            <span className="pve-squad__bar" aria-hidden="true">
              <span
                style={{
                  transform: `scaleX(${m.dead ? 0 : m.downed ? m.bleedSec / 40 : m.hp / PLAYER.maxHealth})`,
                }}
              />
            </span>
          </li>
        ))}
      </ul>

      {h.feed.length > 0 && (
        <div className="pve-feed" aria-live="polite">
          {h.feed.map((f) => (
            <div key={f.id} className={`pve-feed__item is-${f.tone}`}>
              {f.text}
            </div>
          ))}
        </div>
      )}

      {hint && (
        <div className="pve-hint" role="status" key={hint.id} data-testid="pve-hint">
          <span className="pve-hint__tag">Tip</span>
          {hint.text}
        </div>
      )}

      {banner && (
        <div
          className={`pve-banner is-${banner.tone}`}
          role="status"
          key={banner.id}
          data-testid="pve-banner"
        >
          {banner.text}
        </div>
      )}

      {h.marker && !h.marker.onScreen && h.status === PVE_STATUS.RUNNING && (
        <div
          className="pve-marker"
          style={{ left: h.marker.x, top: h.marker.y }}
          role="img"
          aria-label={`Objective, ${h.marker.distM} metres`}
          data-testid="pve-marker"
        >
          <span className="pve-marker__arrow" style={{ transform: `rotate(${h.marker.angle}rad)` }} />
          <span className="pve-marker__dist mono">{h.marker.distM}m</span>
        </div>
      )}
      {h.marker?.onScreen && h.status === PVE_STATUS.RUNNING && (
        <div className="pve-marker is-on" style={{ left: h.marker.x, top: h.marker.y }} aria-hidden="true">
          <span className="pve-marker__diamond" />
        </div>
      )}
      {h.allies
        .filter((a) => !a.onScreen)
        .map((a) => (
          <div
            key={a.label}
            className={`pve-ally ${a.downed ? "is-downed" : ""}`}
            style={{ left: a.x, top: a.y }}
            role="img"
            aria-label={`${a.label}${a.downed ? " (down)" : ""}, ${a.distM} metres`}
          >
            <span className="pve-ally__arrow" style={{ transform: `rotate(${a.angle}rad)` }} />
            <span className="pve-ally__name">
              {a.label}
              {a.downed ? " · DOWN" : ""}
            </span>
          </div>
        ))}

      {h.prompt && (
        <div className={`pve-prompt ${h.prompt.blocked ? "is-blocked" : ""}`} data-testid="pve-prompt">
          <span>{h.prompt.text}</span>
          {h.prompt.progress > 0 && (
            <span className="pve-bar pve-bar--prompt" aria-hidden="true">
              <span style={{ transform: `scaleX(${h.prompt.progress})` }} />
            </span>
          )}
        </div>
      )}

      {me?.downed && (
        <>
          <div className="pve-downed-vignette" aria-hidden="true" />
          <div className="center-msg">
            <div className="death pve-downed" role="status" data-testid="pve-downed">
              <span className="death__title">Downed</span>
              <span className="mono">Bleeding out in {Math.ceil(me.bleedSec)}s</span>
              {me.revive > 0 ? (
                <span className="pve-bar">
                  <span style={{ transform: `scaleX(${me.revive})` }} />
                </span>
              ) : h.squad.length === 1 ? (
                <span>{h.selfRevives > 0 ? "Getting back up…" : "No self-revives left"}</span>
              ) : (
                <span>Crawl to a teammate: they hold E to revive you</span>
              )}
            </div>
          </div>
        </>
      )}
      {me?.dead && (
        <div className="center-msg">
          <div className="death" role="status">
            <span className="death__title">Bled out</span>
            <span>Back with the squad at the next checkpoint or wave</span>
          </div>
        </div>
      )}
    </div>
  );
}
