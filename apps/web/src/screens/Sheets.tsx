import {
  accuracy,
  isMapId,
  kdRatio,
  type LeaderboardEntry,
  MAPS,
  MAX_LEVEL,
  MODE_NAMES,
  PRIMARY_WEAPONS,
  type RoomListing,
  SKINS,
  WEAPONS,
  type WeaponId,
} from "@scrapline/shared";
import { useCallback, useEffect, useState } from "react";
import { Button, hexColor, LevelChip, Panel, SheetHeader } from "../components/ui.tsx";
import { ACTION_LABELS, type Action, DEFAULT_SETTINGS, keyLabel, settingsStore } from "../lib/settings.ts";
import { useStore } from "../lib/store.ts";
import { api } from "../net/api.ts";
import { session } from "../net/session.ts";
import { currentLoadout, profileStore, refreshProfile, saveLoadout } from "../state/profile.ts";

// ------------------------------------------------------------------ room browser

export function RoomBrowser({ onBack }: { onBack: () => void }) {
  const [rooms, setRooms] = useState<RoomListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRooms(await api.rooms());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load rooms");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function join(roomId: string) {
    setJoining(roomId);
    try {
      await session.joinById(roomId, currentLoadout());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join");
      setJoining(null);
    }
  }

  async function quick() {
    setJoining("quick");
    try {
      await session.quickMatch(currentLoadout());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Matchmaking failed");
      setJoining(null);
    }
  }

  return (
    <div className="screen screen--dim">
      <div className="sheet">
        <SheetHeader title="Public rooms" onBack={onBack}>
          <Button variant="primary" onClick={quick} disabled={!!joining}>
            Quick match
          </Button>
        </SheetHeader>
        <div className="sheet__body">
          <Panel title={rooms ? `${rooms.length} open rooms` : "Loading…"}>
            {error && (
              <p className="field__error" role="alert">
                {error}
              </p>
            )}
            {rooms && rooms.length === 0 && (
              <p className="field__hint">
                No public rooms right now. Quick match creates one and others will join you.
              </p>
            )}
            {rooms && rooms.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>Map</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th className="num">Players</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((r) => (
                    <tr key={r.roomId}>
                      <td>{isMapId(r.map) ? MAPS[r.map].name : r.map}</td>
                      <td>{r.mode === "tdm" ? MODE_NAMES.tdm : MODE_NAMES.deathmatch}</td>
                      <td>
                        <span className={`badge ${r.phase === "playing" ? "badge--accent" : "badge--good"}`}>
                          {r.phase === "playing" ? "In match" : r.phase}
                        </span>
                      </td>
                      <td className="num">
                        {r.players}/{r.maxPlayers}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Button size="sm" onClick={() => join(r.roomId)} disabled={!!joining}>
                          {joining === r.roomId ? "Joining…" : "Join"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ loadout

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="statbar">
      <span>{label}</span>
      <span className="statbar__track">
        <span
          className="statbar__fill"
          style={{ width: `${Math.max(4, Math.min(100, value * 100))}%`, display: "block" }}
        />
      </span>
    </div>
  );
}

export function Loadout({ onBack }: { onBack: () => void }) {
  const { profile } = useStore(profileStore);
  const initial = currentLoadout();
  const [primary, setPrimary] = useState<WeaponId>(initial.primary);
  const [skin, setSkin] = useState(initial.skin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const level = profile?.level ?? 1;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveLoadout({ primary, skin });
      session.setLoadout({ primary, skin });
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen screen--dim">
      <div className="sheet">
        <SheetHeader title="Loadout" onBack={onBack}>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save loadout"}
          </Button>
        </SheetHeader>
        <div className="sheet__body stack">
          <Panel title="Primary weapon · the Warden P9 sidearm is always carried">
            <div className="grid-2">
              {PRIMARY_WEAPONS.map((id) => {
                const w = WEAPONS[id];
                const dps = (w.damage * w.pellets * w.rpm) / 60;
                return (
                  <button
                    type="button"
                    key={id}
                    className="choice"
                    aria-pressed={primary === id}
                    onClick={() => setPrimary(id)}
                  >
                    <span className="row">
                      <span className="choice__title">{w.name}</span>
                      <span className="spacer" />
                      <span className="badge">{w.fireMode}</span>
                    </span>
                    <span className="choice__meta">{w.blurb}</span>
                    <span className="statbars">
                      <StatBar label="Damage" value={(w.damage * w.pellets) / 104} />
                      <StatBar label="Fire rate" value={w.rpm / 900} />
                      <StatBar label="DPS" value={dps / 210} />
                      <StatBar label="Range" value={w.falloffStartPx / 1400} />
                      <StatBar label="Mobility" value={(w.moveSpeedMult - 0.8) / 0.28} />
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>
          <Panel title={`Skins · cosmetic only · unlocked by level (you are level ${level})`}>
            <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
              {SKINS.map((s) => {
                const locked = s.unlockLevel > level;
                return (
                  <button
                    type="button"
                    key={s.id}
                    className="choice"
                    aria-pressed={skin === s.id}
                    disabled={locked}
                    onClick={() => setSkin(s.id)}
                  >
                    <span className="swatch">
                      <span
                        className="swatch__dot"
                        style={
                          {
                            background: hexColor(s.primary),
                            borderColor: hexColor(s.accent),
                            "--visor": hexColor(s.visor),
                          } as React.CSSProperties
                        }
                      />
                    </span>
                    <span className="choice__title">{s.name}</span>
                    <span className="choice__meta">
                      {locked ? `Unlocks at level ${s.unlockLevel}` : "Unlocked"}
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ profile

export function Profile({ onBack }: { onBack: () => void }) {
  const { profile } = useStore(profileStore);
  const [name, setName] = useState(profile?.nickname ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void refreshProfile();
  }, []);

  if (!profile) return null;
  const s = profile.stats;
  const acc = accuracy(s);
  const hours = Math.floor(s.playtimeSec / 3600);
  const mins = Math.floor((s.playtimeSec % 3600) / 60);

  async function rename() {
    try {
      await saveLoadout({ nickname: name });
      setMsg("Callsign updated");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not rename");
    }
  }

  const stats: [string, string][] = [
    ["Matches", String(s.matchesPlayed)],
    ["Wins", String(s.wins)],
    ["Losses", String(s.losses)],
    ["Eliminations", String(s.kills)],
    ["Deaths", String(s.deaths)],
    ["K/D", kdRatio(s.kills, s.deaths).toFixed(2)],
    ["Accuracy", acc === null ? "—" : `${Math.round(acc * 100)}%`],
    ["Time played", `${hours}h ${mins}m`],
  ];

  return (
    <div className="screen screen--dim">
      <div className="sheet">
        <SheetHeader title="Profile" onBack={onBack} />
        <div className="sheet__body stack">
          <Panel title="Pilot">
            <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
              <LevelChip level={profile.level} />
              <strong style={{ fontSize: 24 }}>{profile.nickname}</strong>
              <span className="spacer" />
              <span className="mono">
                {profile.level >= MAX_LEVEL
                  ? "MAX LEVEL"
                  : `${profile.xpIntoLevel} / ${profile.xpForNext} XP`}
              </span>
            </div>
            <div className="progress" style={{ marginTop: 12 }}>
              <span
                className="progress__fill"
                style={{
                  width: `${profile.xpForNext ? (profile.xpIntoLevel / profile.xpForNext) * 100 : 100}%`,
                }}
              />
            </div>
          </Panel>
          <Panel title="Career stats">
            <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
              {stats.map(([k, v]) => (
                <div key={k} className="stack" style={{ gap: 2 }}>
                  <span className="stencil">{k}</span>
                  <span className="mono" style={{ fontSize: 26 }}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Callsign">
            <div className="row">
              <input
                className="input"
                value={name}
                maxLength={16}
                onChange={(e) => setName(e.target.value)}
              />
              <Button onClick={rename}>Rename</Button>
            </div>
            <p className="field__hint">
              {msg ?? "Your profile lives on this browser. Registered accounts are planned."}
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ leaderboard

export function Leaderboard({ onBack }: { onBack: () => void }) {
  const [sort, setSort] = useState<"xp" | "kills" | "wins">("xp");
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { profile } = useStore(profileStore);

  useEffect(() => {
    setRows(null);
    api
      .leaderboard(sort)
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Unavailable"));
  }, [sort]);

  return (
    <div className="screen screen--dim">
      <div className="sheet">
        <SheetHeader title="Leaderboard" onBack={onBack}>
          <fieldset className="seg" aria-label="Sort by">
            {(["xp", "kills", "wins"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSort(s)}>
                {s === "xp" ? "Level" : s}
              </button>
            ))}
          </fieldset>
        </SheetHeader>
        <div className="sheet__body">
          <Panel title="Top 50">
            {error && <p className="field__error">{error}</p>}
            {rows && rows.length === 0 && (
              <p className="field__hint">Nobody has finished a match yet. Be the first.</p>
            )}
            {rows && rows.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Pilot</th>
                    <th className="num">Lvl</th>
                    <th className="num">Elims</th>
                    <th className="num">Wins</th>
                    <th className="num">K/D</th>
                    <th className="num">Matches</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rank} className={r.nickname === profile?.nickname ? "is-self" : ""}>
                      <td className="mono">{r.rank}</td>
                      <td>{r.nickname}</td>
                      <td className="num">{r.level}</td>
                      <td className="num">{r.kills}</td>
                      <td className="num">{r.wins}</td>
                      <td className="num">{r.kd.toFixed(2)}</td>
                      <td className="num">{r.matchesPlayed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ settings

export function SettingsSheet({ onBack }: { onBack: () => void }) {
  const s = useStore(settingsStore);
  const [listening, setListening] = useState<Action | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") {
        settingsStore.patch({ bindings: { ...settingsStore.get().bindings, [listening]: e.code } });
      }
      setListening(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [listening]);

  const slider = (key: "masterVolume" | "sfxVolume" | "uiVolume" | "screenShake", label: string, max = 1) => (
    <div className="setting-row">
      <label htmlFor={key}>{label}</label>
      <div className="row">
        <input
          id={key}
          className="slider"
          type="range"
          min={0}
          max={max}
          step={0.05}
          value={s[key]}
          onChange={(e) => settingsStore.patch({ [key]: Number(e.target.value) } as never)}
        />
        <span className="mono" style={{ width: 42, textAlign: "right" }}>
          {Math.round((s[key] / max) * 100)}%
        </span>
      </div>
    </div>
  );

  const bindings = s.bindings;
  const conflicts = new Set(Object.values(bindings).filter((code, i, arr) => arr.indexOf(code) !== i));

  return (
    <div className="screen screen--dim">
      <div className="sheet">
        <SheetHeader title="Settings" onBack={onBack}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => settingsStore.set(structuredClone(DEFAULT_SETTINGS))}
          >
            Reset defaults
          </Button>
        </SheetHeader>
        <div className="sheet__body grid-2">
          <div className="stack">
            <Panel title="Audio">
              {slider("masterVolume", "Master volume")}
              {slider("sfxVolume", "Effects volume")}
              {slider("uiVolume", "Interface volume")}
            </Panel>
            <Panel title="Graphics">
              <div className="setting-row">
                <span>Quality</span>
                <fieldset className="seg" aria-label="Graphics quality">
                  {(["low", "high"] as const).map((q) => (
                    <button
                      key={q}
                      type="button"
                      aria-pressed={s.quality === q}
                      onClick={() => settingsStore.patch({ quality: q })}
                    >
                      {q}
                    </button>
                  ))}
                </fieldset>
              </div>
              {slider("screenShake", "Screen shake", 1.5)}
              <div className="setting-row">
                <label htmlFor="xh">Crosshair color</label>
                <input
                  id="xh"
                  type="color"
                  value={s.crosshairColor}
                  onChange={(e) => settingsStore.patch({ crosshairColor: e.target.value })}
                />
              </div>
              <div className="setting-row">
                <label htmlFor="dbg">Show FPS / network overlay</label>
                <input
                  id="dbg"
                  type="checkbox"
                  checked={s.showDebug}
                  onChange={(e) => settingsStore.patch({ showDebug: e.target.checked })}
                />
              </div>
            </Panel>
          </div>
          <Panel title="Controls · click a key, then press the new one (Esc cancels)">
            {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
              <div className="setting-row" key={a}>
                <span>
                  {ACTION_LABELS[a]}
                  {conflicts.has(bindings[a]) && (
                    <span className="badge badge--warn" style={{ marginLeft: 8 }}>
                      conflict
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn--sm keybind"
                  data-listening={listening === a}
                  onClick={() => setListening(a)}
                >
                  {listening === a ? "Press a key…" : keyLabel(bindings[a])}
                </button>
              </div>
            ))}
            <div className="setting-row">
              <span>Fire / aim</span>
              <span className="mono">Left mouse / cursor</span>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
