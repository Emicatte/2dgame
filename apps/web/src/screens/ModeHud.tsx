import { GUN_GAME, gunGameWeapon, MODE_VARIANTS, ROLE, roleText, WEAPONS } from "@scrapline/shared";
import { useEffect, useState } from "react";
import { formatClock } from "../components/ui.tsx";
import { PROP_KEYS_HELP } from "../game/modes/ModeLayer.ts";
import { modeHudStore } from "../game/modes/modeHud.ts";
import { useStore } from "../lib/store.ts";
import { session, sessionStore } from "../net/session.ts";

const BANNER_MS = 2600;
const TOAST_MS = 2400;

/** Re-renders while a timed element (banner, toast, flash) is on screen. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function GunGameHud() {
  const m = useStore(modeHudStore);
  const level = m.ggLevel;
  return (
    <div className="mode-hud" data-testid="gungame-hud">
      <ol className="ladder" aria-label="Weapon ladder">
        {GUN_GAME.ladder.map((w, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: the ladder repeats weapons; the level is the key
            key={i}
            className={`ladder__step ${i < level ? "is-done" : ""} ${i === level ? "is-current" : ""} ${
              i === GUN_GAME.ladder.length - 1 ? "is-final" : ""
            }`}
            aria-current={i === level ? "step" : undefined}
          >
            <span className="mono">{i + 1}</span>
            <small>{WEAPONS[w].name}</small>
          </li>
        ))}
      </ol>
      <div className="mode-hud__line">
        <span data-testid="gg-level">
          Level {level + 1}/{GUN_GAME.ladder.length} · {WEAPONS[gunGameWeapon(level)].name}
        </span>
        {m.ggLeader && !m.ggLeader.you && (
          <span className="mode-hud__muted">
            Leader {m.ggLeader.name} · level {m.ggLeader.level + 1}
          </span>
        )}
        {m.overtime && <span className="badge badge--warn">Overtime: next level-up wins</span>}
      </div>
    </div>
  );
}

function roleLabel(mode: string, role: number): string {
  if (role === ROLE.SEEKER) return roleText(mode).seeker;
  if (role === ROLE.HIDER) return roleText(mode).hider;
  return "Spectator";
}

function stageLabel(mode: string, stage: string): string {
  if (stage === "prep") return roleText(mode).prep;
  if (stage === "hunt") return roleText(mode).hunt;
  if (stage === "break") return "Round over";
  return "";
}

function PropAbilities() {
  const m = useStore(modeHudStore);
  const cd = (s: number) => (s > 0.05 ? `${Math.ceil(s)}s` : "ready");
  return (
    <div className="prop-bar" data-testid="prop-abilities">
      <div className="prop-bar__item">
        <kbd>Q</kbd>
        <span>{m.disguise ?? "Not disguised"}</span>
        {m.stage === "hunt" && m.disguise && <small>{cd(m.transformInSec)}</small>}
      </div>
      <div className={`prop-bar__item ${m.locked ? "is-on" : ""}`}>
        <kbd>C</kbd>
        <span>{m.locked ? "Locked" : "Lock"}</span>
      </div>
      <div className="prop-bar__item">
        <kbd>T</kbd>
        <span>Taunt</span>
        <small>{cd(m.tauntInSec)}</small>
      </div>
      <div className="prop-bar__item">
        <kbd>G</kbd>
        <span>Decoy</span>
        <small>{cd(m.decoyInSec)}</small>
      </div>
      <div className="prop-bar__item" data-testid="ability-swap">
        <kbd>V</kbd>
        <span>Swap</span>
        <small>{cd(m.swapInSec)}</small>
      </div>
      <span className="prop-bar__help">{PROP_KEYS_HELP}</span>
    </div>
  );
}

/** G for seekers and hunters (sonar) and for Hide & Seek hiders (noise decoy at the crosshair). */
function RoleAbility({ seeker }: { seeker: boolean }) {
  const m = useStore(modeHudStore);
  if (m.stage !== "hunt") return null;
  const left = m.abilityInSec;
  return (
    <div className="prop-bar" data-testid="role-ability">
      <div className="prop-bar__item">
        <kbd>G</kbd>
        <span>{seeker ? "Sonar" : "Noise decoy"}</span>
        <small>{left > 0.05 ? `${Math.ceil(left)}s` : "ready"}</small>
      </div>
      <span className="prop-bar__help">
        {seeker
          ? "Pings everyone hiding around you"
          : "Throws a fake ping where you aim: send the seekers the wrong way"}
      </span>
    </div>
  );
}

/** Q: the objects of this map a prop can turn into (click, or press the number). */
function PropPicker() {
  const m = useStore(modeHudStore);
  useEffect(() => {
    if (!m.pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= m.kinds.length) {
        session.ability({ a: "transform", k: m.kinds[n - 1]!.index });
        modeHudStore.patch({ pickerOpen: false });
        e.preventDefault();
      } else if (e.key === "Escape") modeHudStore.patch({ pickerOpen: false });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [m.pickerOpen, m.kinds]);
  if (!m.pickerOpen) return null;
  return (
    <div className="prop-picker" role="dialog" aria-label="Choose an object" data-testid="prop-picker">
      <span className="stencil">Turn into · objects of this map</span>
      <div className="prop-picker__grid">
        {m.kinds.map((k, i) => (
          <button
            key={k.index}
            type="button"
            className="prop-picker__item"
            onClick={() => {
              session.ability({ a: "transform", k: k.index });
              modeHudStore.patch({ pickerOpen: false });
            }}
            data-testid={`prop-kind-${k.kind}`}
          >
            <kbd>{i + 1}</kbd>
            {k.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function RoundHud() {
  const m = useStore(modeHudStore);
  const s = useStore(sessionStore);
  const blind = m.role === ROLE.SEEKER && m.stage === "prep" && roleText(s.mode).blind;
  const now = useNow(true);
  const spotted = now - m.spottedAt < 1800;
  const penalty = now - m.penaltyAt < 500;
  const variant = MODE_VARIANTS[s.mode as "hideseek"]?.find((v) => v.id === m.variant);
  return (
    <>
      <div className="hud__top" data-testid="round-hud">
        <div className="hud-box hud__score">
          <b className="mono" data-testid="round-points">
            {m.points}
          </b>
          <small>Your points</small>
        </div>
        <div
          className={`hud-box hud__timer ${m.stageLeftSec < 20 && m.stage === "hunt" ? "is-low" : ""}`}
          data-testid="round-timer"
        >
          {formatClock(m.stageLeftSec)}
          <small className="hud__timer-sub">
            {stageLabel(s.mode, m.stage)} · round {m.round}/{m.rounds}
          </small>
        </div>
        <div className="hud-box hud__score">
          <b className="mono">
            {m.hiders} / {m.seekers}
          </b>
          <small>{roleText(s.mode).sides}</small>
        </div>
      </div>
      <div className={`role-chip role-chip--${m.role}`} data-testid="role-chip">
        {roleLabel(s.mode, m.role)}
        {variant && variant.id !== "classic" && <small> · {variant.name}</small>}
        {m.dark && <small> · lights out</small>}
      </div>
      {m.spectating && <div className="spectating">Watching {m.spectating}</div>}
      {spotted && m.role === ROLE.HIDER && (
        <div className="spotted" role="alert">
          You have been spotted
        </div>
      )}
      {penalty && <div className="penalty-flash" aria-hidden="true" />}
      {s.mode === "prophunt" && m.role === ROLE.HIDER && <PropAbilities />}
      {s.mode === "prophunt" && m.role === ROLE.SEEKER && <RoleAbility seeker />}
      {s.mode === "hideseek" && (m.role === ROLE.SEEKER || m.role === ROLE.HIDER) && (
        <RoleAbility seeker={m.role === ROLE.SEEKER} />
      )}
      <PropPicker />
      {blind && (
        <div className="blindfold" data-testid="blindfold">
          <span className="stencil">{s.mode === "prophunt" ? "Hunter" : "Seeker"}</span>
          <b>{s.mode === "prophunt" ? "The props are hiding" : "Count to thirty"}</b>
          <span className="mono blindfold__time">{Math.ceil(m.stageLeftSec)}</span>
          <small>You are released when the timer ends.</small>
        </div>
      )}
    </>
  );
}

/** Banners (round flow, level ups) and short toasts, for every mode with a controller. */
function ModeMessages() {
  const m = useStore(modeHudStore);
  const now = useNow(!!m.banner || !!m.toast);
  const banner = m.banner && now - m.banner.at < BANNER_MS ? m.banner : null;
  const toast = m.toast && now - m.toast.at < TOAST_MS ? m.toast : null;
  return (
    <>
      {banner && (
        <div
          key={banner.id}
          className={`pve-banner mode-banner ${banner.tone === "good" ? "is-good" : banner.tone === "warn" ? "is-bad" : ""}`}
          role="status"
          data-testid="mode-banner"
        >
          {banner.title}
          {banner.sub && <small>{banner.sub}</small>}
        </div>
      )}
      {toast && (
        <div key={toast.id} className="mode-toast" role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}

export function ModeHud({ kind }: { kind: "gungame" | "roles" }) {
  return (
    <>
      {kind === "gungame" ? <GunGameHud /> : <RoundHud />}
      <ModeMessages />
    </>
  );
}
