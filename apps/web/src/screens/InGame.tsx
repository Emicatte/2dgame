import {
  GUN_GAME,
  isPveMode,
  isRoundMode,
  isTeamMode,
  KILL_BY_EXPLOSION,
  KILL_BY_VEHICLE,
  MODE_NAMES,
  MODES,
  type NetEvent,
  PLAYER,
  SHIELD,
  TEAMS,
  weaponByIndex,
} from "@scrapline/shared";
import { useEffect, useRef, useState } from "react";
import { Button, formatClock, Panel } from "../components/ui.tsx";
import { type HudObjective, type HudVehicle, hudStore, uiStore } from "../game/hudStore.ts";
import { modeHudStore } from "../game/modes/modeHud.ts";
import { pveHudStore } from "../game/pve/pveHud.ts";
import { keyLabel, settingsStore } from "../lib/settings.ts";
import { useStore } from "../lib/store.ts";
import { gameEvents, session, sessionStore } from "../net/session.ts";
import { ModeHud } from "./ModeHud.tsx";
import { PveHud } from "./PveHud.tsx";

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

function killCause(w: number): string {
  if (w === KILL_BY_VEHICLE) return "Roadkill";
  if (w === KILL_BY_EXPLOSION) return "Explosion";
  return weaponByIndex(w)?.name ?? "";
}

const ROLE_LABEL: Record<string, string> = {
  driver: "Driver",
  pilot: "Pilot",
  gunner: "Gunner",
  passenger: "Passenger",
};

/** Vehicle panel: what you are in, your seat, health, occupants and the controls that apply. */
function VehiclePanel({
  v,
  keys,
}: {
  v: HudVehicle;
  keys: { interact: string; seat: string; dash: string };
}) {
  const hpFrac = Math.max(0, v.hp / v.maxHp);
  const driving = v.role === "driver" || v.role === "pilot";
  return (
    <section
      className="vehicle-panel"
      aria-label={`${v.name}, ${ROLE_LABEL[v.role] ?? v.role}`}
      data-testid="vehicle-panel"
    >
      <header className="vehicle-panel__head">
        <span className="vehicle-panel__name">{v.name}</span>
        <span className="vehicle-panel__role" data-testid="vehicle-role">
          {ROLE_LABEL[v.role] ?? v.role}
        </span>
        <span className="vehicle-panel__hp mono" data-testid="vehicle-hp">
          {Math.ceil(v.hp)}
          <span className="vehicle-panel__max">/{v.maxHp}</span>
        </span>
      </header>
      <div className={`vehicle-panel__bar ${hpFrac < 0.3 ? "is-low" : ""}`} aria-hidden="true">
        <span style={{ transform: `scaleX(${hpFrac})` }} />
      </div>
      {driving && (
        <div className="vehicle-panel__gauges mono">
          <span data-testid="vehicle-speed">
            {v.speedKmh}
            <small> km/h</small>
          </span>
          {v.altitude !== null && (
            <span data-testid="vehicle-alt">
              ALT {v.altitude}
              <small>%</small>
            </span>
          )}
          {v.altitude !== null && (
            <span className={v.lift ? "is-on" : ""}>{v.lift ? "Lift on" : "Landing"}</span>
          )}
          {v.landBlocked && <span className="is-warn">Cannot land here</span>}
        </div>
      )}
      <ul className="vehicle-panel__seats" aria-label={`Seats: ${v.seats - v.freeSeats} of ${v.seats} taken`}>
        {Array.from({ length: v.seats }, (_, i) => ({
          seat: i,
          o: v.occupants.find((x) => x.seat === i),
        })).map(({ seat: i, o }) => {
          return (
            <li key={`seat-${i}`} className={`${o ? "is-taken" : ""} ${o?.you ? "is-you" : ""}`}>
              <span className="vehicle-panel__dot" aria-hidden="true">
                {o ? "●" : "○"}
              </span>
              <span className="vehicle-panel__seat-role">
                {ROLE_LABEL[v.seatRoles[i] ?? ""] ?? `Seat ${i + 1}`}
              </span>
              <span className="vehicle-panel__seat-name">{o ? (o.you ? "You" : o.name) : "free"}</span>
            </li>
          );
        })}
      </ul>
      {!driving && (
        <p className={`vehicle-panel__fire ${v.canFire && !v.inSector ? "is-warn" : ""}`}>
          {!v.canFire
            ? "This seat cannot fire"
            : v.mounted
              ? "Mounted gun"
              : v.inSector
                ? "Firing arc clear"
                : "Aim through your window to fire"}
        </p>
      )}
      <p className="vehicle-panel__keys">
        <span>
          <kbd>{keys.interact}</kbd>
          {v.canExit ? "Exit" : "Exit (slow down first)"}
        </span>
        {v.freeSeats > 0 && (
          <span>
            <kbd>{keys.seat}</kbd>Change seat
          </span>
        )}
        {v.role === "driver" && (
          <span>
            <kbd>{keys.dash}</kbd>Handbrake
          </span>
        )}
        {v.role === "pilot" && (
          <span>
            <kbd>{keys.dash}</kbd>
            {v.lift ? "Land" : "Take off"}
          </span>
        )}
      </p>
    </section>
  );
}

/** Domination points (owner + who is turning them) or CTF flags (where each flag is). */
function ObjectiveStrip({ items, myTeam }: { items: HudObjective[]; myTeam: number }) {
  if (items.length === 0) return null;
  const teamLabel = (t: number) => (t === 1 || t === 2 ? TEAMS[t].name : "Neutral");
  return (
    <ul className="objectives" aria-label="Objectives" data-testid="objectives">
      {items.map((o) => {
        if (o.kind === "point") {
          const turning = Math.abs(o.progress) > 0.001 && Math.abs(o.progress) < 0.999;
          const toward = o.progress > 0 ? 1 : 2;
          return (
            <li
              key={o.id}
              className={`objective objective--${o.team || "n"}`}
              data-testid={`objective-${o.id}`}
              aria-label={`Point ${o.id}: ${teamLabel(o.team)}${turning ? `, ${teamLabel(toward)} capturing` : ""}`}
            >
              <b>{o.id}</b>
              <small>
                {o.team ? teamLabel(o.team) : turning ? `${Math.round(Math.abs(o.progress) * 100)}%` : "Free"}
              </small>
            </li>
          );
        }
        const status = o.carrier
          ? o.carriedByYou
            ? "You carry it"
            : `Taken by ${o.carrier}`
          : o.home
            ? "Home"
            : "Dropped";
        return (
          <li
            key={o.id}
            className={`objective objective--${o.team} objective--flag`}
            data-testid={`flag-${o.team}`}
            aria-label={`${teamLabel(o.team)} flag: ${status}`}
          >
            <b>
              {teamLabel(o.team)} flag{o.team === myTeam ? " (yours)" : ""}
            </b>
            <small>{status}</small>
          </li>
        );
      })}
    </ul>
  );
}

function objectiveLine(e: Extract<NetEvent, { t: "obj" }>, name: (id: string) => string): string {
  const team = (t: number) => (t === 1 || t === 2 ? TEAMS[t].name : "");
  switch (e.k) {
    case "capture":
      return `${team(e.team)} captured ${e.o}`;
    case "neutral":
      return `${e.o} is neutral`;
    case "take":
      return `${name(e.p)} took the ${team(e.team)} flag`;
    case "drop":
      return `${team(e.team)} flag dropped`;
    case "return":
      return `${team(e.team)} flag returned`;
    case "score":
      return `${name(e.p)} captured a flag for ${team(e.team)}`;
  }
}

function KillFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const counter = useRef(0);
  useEffect(() => {
    const off = gameEvents.on("net", ({ events }) => {
      const kills = events.filter((e): e is Extract<NetEvent, { t: "kill" }> => e.t === "kill");
      const objectives = events.filter((e): e is Extract<NetEvent, { t: "obj" }> => e.t === "obj");
      if (kills.length === 0 && objectives.length === 0) return;
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
            killer: k.k ? name(k.k) : "",
            victim: name(k.v),
            killerTeam: team(k.k),
            victimTeam: team(k.v),
            weapon: killCause(k.w),
            self: k.k === s.selfId || k.v === s.selfId,
            at: now,
          })),
          ...objectives.map((o) => ({
            id: ++counter.current,
            killer: "",
            victim: "",
            killerTeam: 0,
            victimTeam: 0,
            weapon: objectiveLine(o, name),
            self: o.p === s.selfId,
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
          {i.killer && (
            <strong className={i.killerTeam ? `team-tag--${i.killerTeam}` : undefined}>{i.killer}</strong>
          )}
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
          <Button
            onClick={() => {
              session.leaveMatch();
              onClose();
            }}
            data-testid="leave-match"
          >
            Leave match
          </Button>
          <Button variant="danger" onClick={() => void session.leave()} data-testid="leave-arena">
            Leave arena
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InGame({ onSettings }: { onSettings: () => void }) {
  const hud = useStore(hudStore);
  const mode = useStore(modeHudStore);
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

  const bounty = s.mode === "bounty";
  const leader = [...s.players].sort((a, b) => (bounty ? b.pts - a.pts : b.kills - a.kills))[0];
  const myPts = s.players.find((p) => p.id === s.selfId)?.pts ?? 0;
  const teams = isTeamMode(s.mode);
  // Team round modes (Sabotage, Pursuit, Convoy): the clock shows the round, not the match cap.
  const roundClock = isRoundMode(s.mode) && !!mode.stage;
  const clock = roundClock ? mode.stageLeftSec : hud.timeLeftSec;
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
              `fx live     ${hud.debug.fxDetail}`,
            ].join("\n")}
          </div>
        )}

        {isPveMode(s.mode) && <PveHud />}
        <ObjectiveStrip items={hud.objectives} myTeam={myTeam} />
        {hud.objectives.some((o) => o.carriedByYou) && (
          <div className="carrier-banner" role="status">
            You have the enemy flag: bring it to your flag stand
          </div>
        )}
        {MODES[s.mode]?.hud === "gungame" && <ModeHud kind="gungame" />}
        {isPveMode(s.mode) ? null : MODES[s.mode]?.hud === "roles" ? (
          <ModeHud kind="roles" />
        ) : teams ? (
          <div className="hud__top" data-testid="team-scores">
            {([1, 2] as const).map((t, i) => (
              <div
                key={t}
                className="hud-box hud__score"
                style={{ order: i === 0 ? 0 : 2, borderColor: TEAMS[t].css }}
              >
                <b className={`mono team-tag--${t}`} data-testid={`team-score-${t}`}>
                  {t === 1 ? s.scoreA : s.scoreB}
                  {roundClock ? "" : `/${s.killLimit}`}
                </b>
                <small>
                  {TEAMS[t].name}
                  {myTeam === t ? " · you" : ""}
                </small>
              </div>
            ))}
            <div
              className={`hud-box hud__timer ${clock < 30 && s.phase === "playing" ? "is-low" : ""}`}
              style={{ order: 1 }}
            >
              {formatClock(clock)}
              {roundClock && (
                <small className="hud__timer-sub">
                  Round {mode.round}/{mode.rounds}
                </small>
              )}
            </div>
          </div>
        ) : (
          <div className="hud__top">
            {s.mode !== "maze" && (
              <div className="hud-box hud__score">
                <b className="mono" data-testid="hud-kills">
                  {bounty ? myPts : hud.kills}
                </b>
                <small>{bounty ? "Your points" : "Your elims"}</small>
              </div>
            )}
            <div
              className={`hud-box hud__timer ${hud.timeLeftSec < 30 && s.phase === "playing" ? "is-low" : ""}`}
            >
              {formatClock(hud.timeLeftSec)}
            </div>
            {s.mode === "maze" || s.mode === "battleroyale" ? null : s.mode === "gungame" ? (
              <div className="hud-box hud__score">
                <b className="mono">
                  {Math.max(0, ...s.players.map((p) => p.gg)) + 1}/{GUN_GAME.ladder.length}
                </b>
                <small>Top level</small>
              </div>
            ) : (
              <div className="hud-box hud__score">
                <b className="mono">
                  {(bounty ? leader?.pts : leader?.kills) ?? 0}/{s.killLimit}
                </b>
                <small>Leader</small>
              </div>
            )}
          </div>
        )}

        {s.modeText && s.phase === "playing" && (
          <div className="mode-status" data-testid="mode-status">
            {s.modeText}
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
                {hud.shield > 0 && (
                  <div className="health__bar shield__bar" data-testid="hud-shield">
                    <div
                      className="shield__fill"
                      style={{ width: `${Math.min(1, hud.shield / SHIELD.max) * 100}%` }}
                    />
                  </div>
                )}
                {hud.cells > 0 && (
                  <div className="shield-cells" data-testid="hud-cells">
                    <kbd>{keyLabel(settings.bindings.shield)}</kbd>
                    <span className="stencil">Shield cells</span>
                    <span className="mono">
                      {hud.cells}/{SHIELD.maxCells}
                    </span>
                  </div>
                )}
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
            {/* Unarmed (hiders, props): no ammo or slots to show. */}
            {hud.slots.some((sl) => sl.weaponId) && (
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
            )}
          </>
        )}

        {hud.interactPrompt &&
          hud.alive &&
          !hud.vehicle &&
          !(isPveMode(s.mode) && pveHudStore.get().prompt) && (
            <div className="interact" data-testid="interact-prompt">
              {/* Prompts that name their own key ("SPACE: jump") show it instead of interact's. */}
              {/^[A-Z]+: /.test(hud.interactPrompt) ? (
                <>
                  <kbd>{hud.interactPrompt.split(":")[0]}</kbd>
                  {hud.interactPrompt.slice(hud.interactPrompt.indexOf(":") + 2)}
                </>
              ) : (
                <>
                  <kbd>{interactKey}</kbd>
                  {hud.interactPrompt}
                </>
              )}
            </div>
          )}

        {hud.vehicle && hud.alive && (
          <VehiclePanel
            v={hud.vehicle}
            keys={{
              interact: interactKey,
              seat: keyLabel(settings.bindings.seat),
              dash: keyLabel(settings.bindings.dash),
            }}
          />
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
