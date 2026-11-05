import { GAME_TITLE, type GameMode, MAP_IDS, MAPS, type MapId } from "@scrapline/shared";
import { type FormEvent, useState } from "react";
import { Button, LevelChip } from "../components/ui.tsx";
import { useStore } from "../lib/store.ts";
import { HOST_MODE } from "../net/api.ts";
import { session } from "../net/session.ts";
import { currentLoadout, profileStore } from "../state/profile.ts";

export type MenuView =
  | "main"
  | "browse"
  | "join"
  | "create"
  | "loadout"
  | "profile"
  | "leaderboard"
  | "settings";

export function MainMenu({
  onNavigate,
  busy,
  setBusy,
}: {
  onNavigate: (v: MenuView) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const { profile } = useStore(profileStore);
  const [error, setError] = useState<string | null>(null);

  async function quick(mode: GameMode = "deathmatch") {
    setBusy(true);
    setError(null);
    try {
      await session.quickMatch(currentLoadout(), mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Matchmaking failed");
    } finally {
      setBusy(false);
    }
  }

  const progress = profile && profile.xpForNext > 0 ? profile.xpIntoLevel / profile.xpForNext : 1;

  return (
    <div className="screen screen--menu">
      <div className="menu">
        <div className="brand">
          <span className="stencil">Top-down arena shooter · up to 8 players</span>
          <h1 className="brand__name">
            {GAME_TITLE.slice(0, 5)}
            <span>{GAME_TITLE.slice(5)}</span>
          </h1>
        </div>

        {profile && (
          <button type="button" className="profile-strip" onClick={() => onNavigate("profile")}>
            <LevelChip level={profile.level} />
            <span className="profile-strip__name">{profile.nickname}</span>
            <span className="spacer" />
            <span
              className="progress"
              role="progressbar"
              aria-label="Level progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <span className="progress__fill" style={{ width: `${progress * 100}%` }} />
            </span>
          </button>
        )}

        <nav className="menu__nav" aria-label="Main menu">
          {HOST_MODE ? (
            <>
              {/* Host mode: the arena runs on the creator's computer, friends join with the code. */}
              <Button
                variant="primary"
                size="lg"
                onClick={() => onNavigate("create")}
                disabled={busy}
                data-testid="create-room"
              >
                Create arena
                <kbd>you host</kbd>
              </Button>
              <Button onClick={() => onNavigate("join")} disabled={busy} data-testid="join-room">
                Join with code
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                size="lg"
                onClick={() => void quick()}
                disabled={busy}
                data-testid="quick-match"
              >
                {busy ? "Finding a match…" : "Quick match"}
                <kbd>2–8 players</kbd>
              </Button>
              <Button onClick={() => void quick("tdm")} disabled={busy} data-testid="quick-tdm">
                Team Deathmatch
                <kbd>2v2</kbd>
              </Button>
              <Button onClick={() => onNavigate("browse")} disabled={busy}>
                Play · browse rooms
              </Button>
              <div className="menu__row">
                <Button onClick={() => onNavigate("create")} disabled={busy} data-testid="create-room">
                  Create private room
                </Button>
                <Button onClick={() => onNavigate("join")} disabled={busy} data-testid="join-room">
                  Join with code
                </Button>
              </div>
            </>
          )}
          <div className="divider" />
          <div className="menu__row">
            <Button variant="ghost" onClick={() => onNavigate("loadout")}>
              Loadout
            </Button>
            <Button variant="ghost" onClick={() => onNavigate("profile")}>
              Profile
            </Button>
          </div>
          <div className="menu__row">
            {!HOST_MODE && (
              <Button variant="ghost" onClick={() => onNavigate("leaderboard")}>
                Leaderboard
              </Button>
            )}
            <Button variant="ghost" onClick={() => onNavigate("settings")}>
              Settings
            </Button>
          </div>
        </nav>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <footer className="menu__footer">
          <span>WASD move · Mouse aim · Click fire · Shift dash</span>
        </footer>
      </div>
    </div>
  );
}

export function JoinDialog({ onClose, initialCode = "" }: { onClose: () => void; initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length !== 5) {
      setError("Codes are 5 characters long");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await session.joinByCode(clean, currentLoadout());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="join-title">
      <form className="panel" style={{ width: "min(420px, 100%)" }} onSubmit={submit}>
        <h3 className="panel__title" id="join-title">
          Join a private room
        </h3>
        <div className="stack">
          <div className="field">
            <label htmlFor="code">Room code</label>
            <input
              id="code"
              className="input input--code"
              autoFocus
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              aria-invalid={!!error}
              data-testid="room-code-input"
            />
            <span className="field__error" role="alert">
              {error}
            </span>
          </div>
          <div className="row">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <span className="spacer" />
            <Button variant="primary" type="submit" disabled={busy} data-testid="join-submit">
              {busy ? "Joining…" : "Join"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function CreateDialog({ onClose }: { onClose: () => void }) {
  const [map, setMap] = useState<MapId>("industrial");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await session.createPrivate(currentLoadout(), map);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create room");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-title">
      <div className="panel" style={{ width: "min(560px, 100%)" }}>
        <h3 className="panel__title" id="create-title">
          {HOST_MODE ? "Create an arena" : "Create a private room"}
        </h3>
        <div className="stack">
          <span className="field__hint">
            {HOST_MODE
              ? "The arena runs on this computer: keep this tab open and in front while you play. Choose the map, then share the code with your friends."
              : "You will be the host: choose the map, length and score, then share the code."}
          </span>
          <div className="grid-3" role="radiogroup" aria-label="Map">
            {MAP_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="choice"
                aria-pressed={map === id}
                onClick={() => setMap(id)}
              >
                <span className="choice__title">{MAPS[id].name}</span>
                <span className="choice__meta">{MAPS[id].tagline}</span>
              </button>
            ))}
          </div>
          <span className="field__error" role="alert">
            {error}
          </span>
          <div className="row">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <span className="spacer" />
            <Button variant="primary" onClick={create} disabled={busy} data-testid="create-submit">
              {busy ? "Creating…" : HOST_MODE ? "Create arena" : "Create room"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
