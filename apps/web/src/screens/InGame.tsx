import { isTeamMode, MODE_NAMES, type NetEvent, PLAYER, TEAMS, weaponByIndex } from "@scrapline/shared";
import { useEffect, useRef, useState } from "react";
import { Button, formatClock, Panel } from "../components/ui.tsx";
import { hudStore, uiStore } from "../game/hudStore.ts";
import { keyLabel, settingsStore } from "../lib/settings.ts";
import { useStore } from "../lib/store.ts";
import { gameEvents, session, sessionStore } from "../net/session.ts";

interface FeedItem {
  id: number;
  killer: string;
  victim: string;
  /** Team modes: team of killer and victim (0 otherwise), for the name colors. */
  killerTeam: number;
  victimTeam: number;
  weapon: string;
  self: boolean;
  at: number;
}

function KillFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const counter = useRef(0);
  useEffect(() => {
    const off = gameEvents.on("net", ({ events }) => {
      const kills = events.filter((e): e is Extract<NetEvent, { t: "kill" }> => e.t === "kill");
      if (kills.length === 0) return;
      const s = sessionStore.get();
      const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? "?";
      const teams = isTeamMode(s.mode);
      const team = (id: string) => (teams ? (s.players.find((p) => p.id === id)?.team ?? 0) : 0);
      const now = performance.now();
      setItems((prev) =>
        [
          ...prev,
          ...kills.map((k) => ({
            id: ++counter.current,
            killer: name(k.k),
            victim: name(k.v),
            killerTeam: team(k.k),
            victimTeam: team(k.v),
            weapon: weaponByIndex(k.w)?.name ?? "",
            self: k.k === s.selfId || k.v === s.selfId,
            at: now,
          })),
        ].slice(-6),
      );
    });
    const t = setInterval(() => {
      const now = performance.now();
      setItems((prev) =>
        prev.some((i) => now - i.at > 6000) ? prev.filter((i) => now - i.at <= 6000) : prev,
      );
    }, 500);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);
  return (
    <div className="killfeed" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className={`killfeed__item ${i.self ? "is-self" : ""}`}>
          <strong className={i.killerTeam ? `team-tag--${i.killerTeam}` : undefined}>{i.killer}</strong>
          <span className="killfeed__weapon">{i.weapon}</span>
          <span className={i.victimTeam ? `team-tag--${i.victimTeam}` : undefined}>{i.victim}</span>
        </div>
      ))}
    </div>
  );
}

export function Scoreboard() {
  const s = useStore(sessionStore);
  const teams = isTeamMode(s.mode);
  const sorted = [...s.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const groups = teams
    ? ([1, 2] as const).map((t) => ({ team: t, rows: sorted.filter((p) => p.team === t) }))
    : [{ team: 0, rows: sorted }];
  const title = teams
    ? `${MODE_NAMES[s.mode]} · ${TEAMS[1].name} ${s.scoreA} – ${s.scoreB} ${TEAMS[2].name} · first to ${s.killLimit}`
    : `Deathmatch · first to ${s.killLimit}`;
  return (
    <div className="scoreboard" role="dialog" aria-label="Scoreboard">
      <Panel title={title}>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th className="num">Elims</th>
              <th className="num">Deaths</th>
              <th className="num">K/D</th>
              <th className="num">Ping</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              g.team ? (
                <tr key={`team-${g.team}`} className="scoreboard__team-head">
                  <td colSpan={6} className={`team-tag--${g.team}`}>
                    Team {TEAMS[g.team as 1 | 2].name} · {g.team === 1 ? s.scoreA : s.scoreB}
                  </td>
                </tr>
              ) : null,
              ...g.rows.map((p, i) => (
                <tr key={p.id} className={p.id === s.selfId ? "is-self" : ""}>
                  <td className="mono">{i + 1}</td>
                  <td>
                    <span className={p.team && teams ? `team-tag--${p.team}` : undefined}>{p.name}</span>{" "}
                    {!p.connected && <span className="badge badge--warn">offline</span>}
                  </td>
                  <td className="num">{p.kills}</td>
                  <td className="num">{p.deaths}</td>
                  <td className="num">{(p.deaths ? p.kills / p.deaths : p.kills).toFixed(2)}</td>
                  <td className="num">{p.ping || "—"}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function PauseMenu({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Pause menu">
      <div className="panel pause">
        <h3 className="panel__title">Menu</h3>
        <p className="field__hint">The match keeps running while this menu is open.</p>
        <div className="stack">
          <Button variant="primary" onClick={onClose} autoFocus>
            Resume
          </Button>
          <Button onClick={onSettings}>Settings</Button>
          <Button variant="danger" onClick={() => void session.leave()}>
            Leave match
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InGame({ onSettings }: { onSettings: () => void }) {
  const hud = useStore(hudStore);
  const ui = useStore(uiStore);
  const s = useStore(sessionStore);
  const settings = useStore(settingsStore);
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    if (hud.damageFlash > 0) setFlashKey(hud.damageFlash);
  }, [hud.damageFlash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        uiStore.patch({ menuOpen: !uiStore.get().menuOpen });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      uiStore.patch({ menuOpen: false, scoreboard: false });
    };
  }, []);

  const leader = [...s.players].sort((a, b) => b.kills - a.kills)[0];
  const teams = isTeamMode(s.mode);
  const myTeam = s.players.find((p) => p.id === s.selfId)?.team ?? 0;
  const hpFrac = hud.hp / PLAYER.maxHealth;
  const statusClass = s.status === "reconnecting" || hud.stalled ? "is-bad" : hud.ping > 150 ? "is-warn" : "";
  const interactKey = keyLabel(settings.bindings.interact);

  return (
    <>
      <div className="hud" data-testid="hud">
        <div className="netstat">
          <span className={`netstat__dot ${statusClass}`} />
          <span className="mono">
            {s.status === "reconnecting"
              ? "Reconnecting…"
              : hud.stalled
                ? "Connection interrupted"
                : `${hud.ping} ms`}
          </span>
          {settings.showDebug && <span className="mono">{hud.fps} fps</span>}
        </div>
        {settings.showDebug && (
          <div className="debug" data-testid="debug-overlay">
            {[
              `tick        ${hud.debug.tick}`,
              `fps         ${hud.fps}`,
              `ping        ${hud.ping} ms`,
              `interp      ${hud.debug.renderLag} ms delay, ${hud.debug.interpBuffer} ms buffered`,
              `jitter      ${hud.debug.jitter} ms`,
              `pending     ${hud.debug.pending} (p95 ${hud.debug.pendingP95}, max ${hud.debug.pendingMax})`,
              `ack age     ${hud.debug.ackAge} ms`,
              `last corr   ${hud.debug.correction} px`,
              `corrections ${hud.debug.corrections} (${hud.debug.snaps} snaps)`,
              `net in      ${hud.debug.kbIn} KB/s`,
              `net out     ${hud.debug.kbOut} KB/s (${hud.debug.msgsOut} msg/s)`,
              `objects     ${hud.debug.entities}  fx ${hud.debug.fx}`,
            ].join("\n")}
          </div>
        )}

        {teams ? (
          <div className="hud__top" data-testid="team-scores">
            {([1, 2] as const).map((t, i) => (
              <div
                key={t}
                className="hud-box hud__score"
                style={{ order: i === 0 ? 0 : 2, borderColor: TEAMS[t].css }}
              >
                <b className={`mono team-tag--${t}`} data-testid={`team-score-${t}`}>
                  {t === 1 ? s.scoreA : s.scoreB}/{s.killLimit}
                </b>
                <small>
                  {TEAMS[t].name}
                  {myTeam === t ? " · you" : ""}
                </small>
              </div>
            ))}
            <div
              className={`hud-box hud__timer ${hud.timeLeftSec < 30 && s.phase === "playing" ? "is-low" : ""}`}
              style={{ order: 1 }}
            >
              {formatClock(hud.timeLeftSec)}
            </div>
          </div>
        ) : (
          <div className="hud__top">
            <div className="hud-box hud__score">
              <b className="mono" data-testid="hud-kills">
                {hud.kills}
              </b>
              <small>Your elims</small>
            </div>
            <div
              className={`hud-box hud__timer ${hud.timeLeftSec < 30 && s.phase === "playing" ? "is-low" : ""}`}
            >
              {formatClock(hud.timeLeftSec)}
            </div>
            <div className="hud-box hud__score">
              <b className="mono">
                {leader?.kills ?? 0}/{s.killLimit}
              </b>
              <small>Leader</small>
            </div>
          </div>
        )}

        <KillFeed />

        {hud.alive && (
          <>
            <div className="hud__bottom-left">
              <div className="health">
                <div className="health__row">
                  <span className="health__value mono" data-testid="hud-hp">
                    {hud.hp}
                  </span>
                  <span className="stencil">Integrity</span>
                  {hud.protected && <span className="badge badge--good">Shielded</span>}
                </div>
                <div className="health__bar">
                  <div
                    className={`health__fill ${hpFrac < 0.35 ? "is-low" : ""}`}
                    style={{ width: `${hpFrac * 100}%` }}
                  />
                </div>
              </div>
              <div className={`dash-meter ${hud.dashProgress >= 1 ? "is-ready" : ""}`}>
                <span>Dash</span>
                <span className="dash-meter__bar">
                  <span
                    className="dash-meter__fill"
                    style={{ width: `${hud.dashProgress * 100}%`, display: "block" }}
                  />
                </span>
              </div>
            </div>
            <div className="hud__bottom-right">
              {hud.reloading && <span className="reload-tag">Reloading</span>}
              <div className="ammo">
                <span className={`ammo__mag ${hud.mag === 0 ? "is-empty" : ""}`} data-testid="hud-ammo">
                  {hud.mag}
                </span>
                <span className="ammo__reserve">/ {hud.reserve < 0 ? "∞" : hud.reserve}</span>
              </div>
              <span className="weapon-name">{hud.weaponName}</span>
              <div className="slots">
                {hud.slots.map((sl) => (
                  <div
                    key={sl.key}
                    className={`slot ${sl.active ? "is-active" : ""} ${sl.weaponId ? "" : "is-empty"}`}
                  >
                    <kbd>{sl.key}</kbd>
                    <span>{sl.weaponId ? sl.name : "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {hud.interactPrompt && hud.alive && (
          <div className="interact">
            <kbd>{interactKey}</kbd>Take {hud.interactPrompt}
          </div>
        )}

        {hud.alive && hpFrac < 0.3 && <div className="low-hp" />}
        <div key={`v-${flashKey}`} className={`damage-vignette ${flashKey ? "is-on" : ""}`} />
        <div className="damage-dir">
          <div
            key={`d-${flashKey}`}
            className={`damage-dir__arc ${flashKey ? "is-on" : ""}`}
            style={{ transform: `rotate(${hud.damageAngle + Math.PI / 2}rad)` }}
          />
        </div>

        {s.phase === "countdown" && (
          <div className="center-msg">
            <div>
              <div className="center-msg__big mono">{Math.max(1, Math.ceil(hud.countdownSec))}</div>
              <div className="center-msg__sub">Get ready</div>
            </div>
          </div>
        )}

        {s.phase === "playing" && !hud.alive && hud.respawnInSec !== null && (
          <div className="center-msg">
            <div className="death" role="status">
              <span className="death__title">Eliminated</span>
              {hud.killedBy && <span>by {hud.killedBy}</span>}
              <span className="mono">Redeploying in {hud.respawnInSec.toFixed(1)}s</span>
            </div>
          </div>
        )}
      </div>

      {ui.scoreboard && !ui.menuOpen && <Scoreboard />}
      {ui.menuOpen && (
        <PauseMenu
          onClose={() => uiStore.patch({ menuOpen: false })}
          onSettings={() => {
            uiStore.patch({ menuOpen: false });
            onSettings();
          }}
        />
      )}
    </>
  );
}
