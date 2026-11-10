import {
  EXPERIENCE_CATEGORIES,
  EXPERIENCES,
  type ExperienceCategory,
  type ExperienceDef,
  experienceById,
  FEATURED_EXPERIENCES,
  MAPS,
  playableExperience,
  titleForLevel,
} from "@scrapline/shared";
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mapThumbLater } from "../components/mapThumbs.ts";
import { Button, LevelChip } from "../components/ui.tsx";
import { MODE_FLAGS } from "../lib/modeFlags.ts";
import { recentExperiences } from "../lib/recent.ts";
import { useStore } from "../lib/store.ts";
import { api, HOST_MODE } from "../net/api.ts";
import { gameEvents, session } from "../net/session.ts";
import { currentLoadout, profileStore } from "../state/profile.ts";
import { RoomList } from "./Sheets.tsx";

/**
 * Home: five destinations, each reached from exactly one place in the top bar. Play (landing:
 * spotlight, recently played, featured), Discover (the whole catalog by category), Rooms (join
 * with a code, open a private room, public rooms on the dedicated server), Profile and Settings
 * (sheets over the home). Choosing an experience opens its card; the card opens a lobby (or a
 * quick match). Maps are never picked here: the lobby owns map, mode and rules.
 */
export type HomeView = "play" | "discover" | "rooms" | "profile" | "settings" | "loadout" | "leaderboard";

const CAT_NAME = Object.fromEntries(EXPERIENCE_CATEGORIES.map((c) => [c.id, c.name])) as Record<
  ExperienceCategory,
  string
>;

const playable = (e: ExperienceDef) => playableExperience(e, MODE_FLAGS);

/** Experiences shown in this build: playable ones and the roadmap; switched-off modes are hidden. */
const CATALOG = EXPERIENCES.filter((e) => e.status !== "available" || playable(e));

function playersLabel(e: ExperienceDef): string {
  const { min, max } = e.players;
  const n = min === max ? `${min}` : `${min}–${max}`;
  return e.status === "available" ? `${n} players` : `Target ${n} players`;
}

/** Opens a lobby for the experience, or joins / creates a matchmade room ("quick"). */
async function start(e: ExperienceDef, how: "quick" | "lobby"): Promise<void> {
  const l = e.launch;
  if (!l || !playable(e)) throw new Error("This experience is not playable yet");
  if (how === "quick") return session.quickMatch(currentLoadout(), l.mode);
  if (l.mode === "outbreak") return session.createCoop(currentLoadout(), l.mission);
  await session.createWithMode(currentLoadout(), l.mode);
  if (l.variant) session.updateSettings({ variant: l.variant });
}

/** Runs one start action at a time and keeps its label / error for the button that fired it. */
function useStarter() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
      setBusy(null);
    }
  }, []);
  return { busy, error, run };
}

const quickOffered = (e: ExperienceDef) => !HOST_MODE && e.quick;
const lobbyLabel = HOST_MODE ? "Create arena" : "Create lobby";

export function Home({
  view,
  onNavigate,
  inviteCode,
}: {
  view: HomeView;
  onNavigate: (v: HomeView) => void;
  inviteCode: string;
}) {
  const { profile } = useStore(profileStore);
  const [open, setOpen] = useState<ExperienceDef | null>(null);
  const [category, setCategory] = useState<ExperienceCategory | "all">("all");
  const [online, setOnline] = useState<{ rooms: number; players: number } | null>(null);
  const onTotals = useCallback((rooms: number, players: number) => setOnline({ rooms, players }), []);

  // Dedicated server only: live totals of the public rooms (host mode has no such data to show).
  useEffect(() => {
    if (HOST_MODE) return;
    let alive = true;
    const load = () =>
      api
        .rooms()
        .then(
          (list) =>
            alive &&
            onTotals(
              list.length,
              list.reduce((n, r) => n + r.players, 0),
            ),
        )
        .catch(() => alive && setOnline(null));
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [onTotals]);
  const progress = profile && profile.xpForNext > 0 ? profile.xpIntoLevel / profile.xpForNext : 1;
  const page = view === "discover" || view === "rooms" ? view : "play";
  const sheet = view === "profile" || view === "loadout" || view === "leaderboard" ? "profile" : view;

  const nav: { id: HomeView; label: string }[] = [
    { id: "play", label: "Play" },
    { id: "discover", label: "Discover" },
    { id: "rooms", label: "Rooms" },
  ];

  return (
    <div className="screen home">
      <header className="topbar">
        <span className="topbar__brand" aria-hidden="true">
          SCRAP<span>LINE</span>
        </span>
        <nav className="topbar__nav" aria-label="Main">
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              className="topbar__item"
              aria-current={page === n.id && sheet !== "profile" && sheet !== "settings" ? "page" : undefined}
              onClick={() => onNavigate(n.id)}
              data-testid={`nav-${n.id}`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        {online && (
          <span className="live-chip" title="Public rooms on this server, refreshed every few seconds">
            <span className="live-chip__dot" aria-hidden="true" />
            {online.players} in public rooms
          </span>
        )}
        {profile && (
          <button
            type="button"
            className="topbar__profile"
            aria-current={sheet === "profile" ? "page" : undefined}
            onClick={() => onNavigate("profile")}
            data-testid="nav-profile"
            aria-label={`Profile: ${profile.nickname}, level ${profile.level}`}
          >
            <LevelChip level={profile.level} />
            <span className="topbar__who">
              <span className="topbar__name">{profile.nickname}</span>
              <span className="topbar__rank">{titleForLevel(profile.level)}</span>
            </span>
            <span className="progress" aria-hidden="true">
              <span className="progress__fill" style={{ width: `${progress * 100}%` }} />
            </span>
          </button>
        )}
        <button
          type="button"
          className="topbar__item"
          aria-current={sheet === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
          data-testid="nav-settings"
        >
          Settings
        </button>
      </header>

      <main className="home__main" key={page} data-testid={`home-${page}`}>
        {page === "play" && (
          <PlayView
            onOpen={setOpen}
            onBrowse={(c) => {
              setCategory(c);
              onNavigate("discover");
            }}
          />
        )}
        {page === "discover" && (
          <DiscoverView category={category} setCategory={setCategory} onOpen={setOpen} />
        )}
        {page === "rooms" && <RoomsView initialCode={inviteCode} onTotals={onTotals} />}
      </main>

      {open && <ExperienceDialog e={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ Play (landing)

function PlayView({
  onOpen,
  onBrowse,
}: {
  onOpen: (e: ExperienceDef) => void;
  onBrowse: (c: ExperienceCategory) => void;
}) {
  const recent = useMemo(
    () =>
      recentExperiences()
        .map((id) => experienceById(id))
        .filter((e): e is ExperienceDef => !!e && playable(e)),
    [],
  );
  const featured = useMemo(
    () =>
      FEATURED_EXPERIENCES.map((id) => experienceById(id)).filter(
        (e): e is ExperienceDef => !!e && playable(e),
      ),
    [],
  );
  const spot = recent[0] ?? featured[0];
  const { busy, error, run } = useStarter();

  // The live map behind the home is the spotlight's own map (real game render, slowly panning).
  useEffect(() => {
    if (spot?.thumbnail) gameEvents.emit("menuMap", spot.thumbnail);
  }, [spot]);

  const counts = EXPERIENCE_CATEGORIES.map((c) => {
    const all = CATALOG.filter((e) => e.category === c.id);
    return { ...c, ready: all.filter(playable).length, planned: all.filter((e) => !playable(e)).length };
  });
  const how = spot && quickOffered(spot) ? "quick" : "lobby";

  return (
    <div className="home-play">
      {spot && (
        <section className="hero" aria-labelledby="hero-title">
          <span className="stencil">
            {recent[0] ? "Continue" : "Featured"} · {CAT_NAME[spot.category]}
          </span>
          <h1 className="hero__title" id="hero-title">
            {spot.name}
          </h1>
          <p className="hero__blurb">{spot.blurb}</p>
          <p className="hero__facts">
            <span>{playersLabel(spot)}</span>
            <span>{spot.durationLabel}</span>
            <span>
              {spot.maps.length} {spot.maps.length === 1 ? "map" : "maps"}
            </span>
          </p>
          <div className="hero__actions">
            <Button
              variant="primary"
              size="lg"
              className="hero__play"
              disabled={!!busy}
              onClick={() => void run("hero", () => start(spot, how))}
              data-testid="hero-play"
            >
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  {how === "quick" ? "Finding a match…" : "Opening the lobby…"}
                </>
              ) : (
                <>
                  Play
                  <kbd>{how === "quick" ? "quick match" : HOST_MODE ? "you host" : "private lobby"}</kbd>
                </>
              )}
            </Button>
            <Button variant="ghost" onClick={() => onOpen(spot)} data-testid="hero-details">
              Details
            </Button>
          </div>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}

      <div className="home-rows">
        {recent.length > 1 && <Row title="Recently played" items={recent.slice(1)} onOpen={onOpen} />}
        <Row title="Featured" items={featured.filter((e) => e !== spot)} onOpen={onOpen} />
        <section className="home-row" aria-labelledby="cats-title">
          <h2 className="home-row__title" id="cats-title">
            Browse by category
          </h2>
          <div className="cat-grid">
            {counts.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`cat-tile cat-tile--${c.id}`}
                onClick={() => onBrowse(c.id)}
                data-testid={`cat-${c.id}`}
              >
                <span className="cat-tile__name">{c.name}</span>
                <span className="cat-tile__blurb">{c.blurb}</span>
                <span className="cat-tile__count">
                  {c.ready > 0 ? `${c.ready} to play` : "Coming"}
                  {c.planned > 0 && c.ready > 0 ? ` · ${c.planned} planned` : ""}
                </span>
              </button>
            ))}
          </div>
        </section>
        <footer className="home-footer">
          WASD move · Mouse aim · Click fire · Shift dash · E interact / vehicle · F seat
        </footer>
      </div>
    </div>
  );
}

function Row({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: ExperienceDef[];
  onOpen: (e: ExperienceDef) => void;
}) {
  if (items.length === 0) return null;
  const id = `row-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="home-row" aria-labelledby={id}>
      <h2 className="home-row__title" id={id}>
        {title}
      </h2>
      <div className="xp-row">
        {items.map((e) => (
          <XpCard key={e.id} e={e} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ cards and the experience card

/** Card image: the experience's real map, rendered in idle time (it takes a moment per map). */
function Thumb({ e }: { e: ExperienceDef }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!e.thumbnail) return;
    let alive = true;
    void mapThumbLater(e.thumbnail).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [e.thumbnail]);
  return (
    <span className={`xp-thumb xp-thumb--${e.category}`}>
      {src ? (
        <img src={src} alt="" />
      ) : e.thumbnail ? (
        <span className="xp-thumb__loading" />
      ) : (
        <span className="xp-thumb__ph">{CAT_NAME[e.category]}</span>
      )}
    </span>
  );
}

function XpCard({ e, onOpen }: { e: ExperienceDef; onOpen: (e: ExperienceDef) => void }) {
  const ok = playable(e);
  return (
    <button
      type="button"
      className={`xp-card xp-card--${e.category} ${ok ? "" : "is-planned"}`}
      onClick={() => onOpen(e)}
      data-testid={`xp-${e.id}`}
    >
      <Thumb e={e} />
      <span className="xp-card__body">
        <span className="xp-card__cat">
          {CAT_NAME[e.category]}
          {e.gameplay === "noncombat" && " · no combat"}
        </span>
        <span className="xp-card__name">{e.name}</span>
        <span className="xp-card__meta">
          {playersLabel(e)}
          {e.durationLabel && ` · ${e.durationLabel}`}
        </span>
      </span>
      {!ok && (
        <span className="badge badge--warn xp-card__badge">
          {e.status === "development" ? "In development" : "Planned"}
        </span>
      )}
    </button>
  );
}

function ExperienceDialog({ e, onClose }: { e: ExperienceDef; onClose: () => void }) {
  const ok = playable(e);
  const { busy, error, run } = useStarter();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const maps =
    e.maps.length > 4 ? `${e.maps.length} maps` : e.maps.map((m) => MAPS[m].name).join(", ") || "—";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside is a mouse shortcut; Escape and Close cover the keyboard
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="panel xp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="xp-title"
        data-testid="xp-dialog"
      >
        <Thumb e={e} />
        <div className="xp-dialog__body">
          <span className="stencil">
            {CAT_NAME[e.category]} · {e.gameplay === "combat" ? "Combat" : "No combat"}
          </span>
          <h3 className="xp-dialog__title" id="xp-title">
            {e.name}
          </h3>
          <p className="xp-dialog__blurb">{e.blurb}</p>
          <dl className="play-card__facts">
            <dt>Players</dt>
            <dd>{playersLabel(e)}</dd>
            {e.durationLabel && (
              <>
                <dt>Length</dt>
                <dd>{e.durationLabel}</dd>
              </>
            )}
            {ok && (
              <>
                <dt>Maps</dt>
                <dd>{maps}</dd>
              </>
            )}
          </dl>
          {e.rules.length > 0 && (
            <ul className="play-card__rules">
              {e.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {ok ? (
            <p className="field__hint">You pick the map and the rules in the lobby.</p>
          ) : (
            <p className="play-card__needs">
              <strong>{e.status === "development" ? "In development." : "Planned."}</strong> Needs: {e.needs}
            </p>
          )}
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <div className="row xp-dialog__actions">
            <Button variant="ghost" onClick={onClose} data-autofocus={ok ? undefined : true}>
              Close
            </Button>
            <span className="spacer" />
            {ok && quickOffered(e) && (
              <Button
                disabled={!!busy}
                onClick={() => void run("quick", () => start(e, "quick"))}
                data-testid="xp-quick"
              >
                {busy === "quick" ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Finding a match…
                  </>
                ) : (
                  "Quick match"
                )}
              </Button>
            )}
            {ok && (
              <Button
                variant="primary"
                disabled={!!busy}
                onClick={() => void run("lobby", () => start(e, "lobby"))}
                data-autofocus
                data-testid="xp-create"
              >
                {busy === "lobby" ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Opening…
                  </>
                ) : (
                  lobbyLabel
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Discover

function DiscoverView({
  category,
  setCategory,
  onOpen,
}: {
  category: ExperienceCategory | "all";
  setCategory: (c: ExperienceCategory | "all") => void;
  onOpen: (e: ExperienceDef) => void;
}) {
  const tabs: (ExperienceCategory | "all")[] = ["all", ...EXPERIENCE_CATEGORIES.map((c) => c.id)];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const ready = CATALOG.filter(playable).length;

  function onKey(ev: KeyboardEvent<HTMLButtonElement>) {
    const i = tabs.indexOf(category);
    const n = tabs.length;
    const next =
      ev.key === "ArrowRight"
        ? (i + 1) % n
        : ev.key === "ArrowLeft"
          ? (i + n - 1) % n
          : ev.key === "Home"
            ? 0
            : ev.key === "End"
              ? n - 1
              : -1;
    if (next < 0) return;
    ev.preventDefault();
    setCategory(tabs[next]!);
    refs.current[next]?.focus();
  }

  const sections = EXPERIENCE_CATEGORIES.filter((c) => category === "all" || c.id === category)
    .map((c) => ({
      ...c,
      // Playable first, the roadmap after.
      items: CATALOG.filter((e) => e.category === c.id).sort(
        (a, b) => Number(playable(b)) - Number(playable(a)),
      ),
    }))
    .filter((c) => c.items.length > 0);

  return (
    <div className="home-page">
      <header className="view-head">
        <h2>Discover</h2>
        <p>
          {ready} experiences to play now
          {CATALOG.length > ready ? `, ${CATALOG.length - ready} on the roadmap` : ""}. Not everything here is
          about shooting.
        </p>
      </header>
      <div className="chips" role="tablist" aria-label="Categories">
        {tabs.map((t, i) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={category === t}
            tabIndex={category === t ? 0 : -1}
            className="chip"
            onClick={() => setCategory(t)}
            onKeyDown={onKey}
            data-testid={`discover-${t}`}
          >
            {t === "all" ? "All" : CAT_NAME[t]}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={category === "all" ? "All experiences" : CAT_NAME[category]}>
        {sections.map((c) => (
          <section key={c.id} className="home-row" aria-labelledby={`sec-${c.id}`}>
            <h3 className="home-row__title" id={`sec-${c.id}`}>
              {c.name} <small>{c.blurb}</small>
            </h3>
            <div className="xp-grid">
              {c.items.map((e) => (
                <XpCard key={e.id} e={e} onOpen={onOpen} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Rooms

function RoomsView({
  initialCode,
  onTotals,
}: {
  initialCode: string;
  onTotals: (rooms: number, players: number) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const { busy, error, run } = useStarter();
  const base =
    recentExperiences()
      .map((id) => experienceById(id))
      .find((e): e is ExperienceDef => !!e && playable(e) && e.launch?.mode !== "outbreak") ??
    experienceById("deathmatch")!;

  async function join(ev: FormEvent) {
    ev.preventDefault();
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length !== 5) {
      setJoinError("Codes are 5 characters long");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      await session.joinByCode(clean, currentLoadout());
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not join");
      setJoining(false);
    }
  }

  return (
    <div className="home-page">
      <header className="view-head">
        <h2>Play with friends</h2>
        <p>
          {HOST_MODE
            ? "An arena runs on the computer of whoever creates it. Friends join with its 5-letter code."
            : "Private rooms have a code to share. Public rooms are open to anyone."}
        </p>
      </header>
      <div className="rooms-grid">
        <form className="panel stack" onSubmit={join} aria-labelledby="join-title">
          <h3 className="panel__title" id="join-title">
            Join with a code
          </h3>
          <div className="field">
            <label htmlFor="code">Room code</label>
            <input
              id="code"
              className="input input--code"
              maxLength={7}
              autoComplete="off"
              value={code}
              onChange={(ev) => setCode(ev.target.value.toUpperCase())}
              aria-invalid={!!joinError}
              aria-describedby="code-error"
              data-testid="room-code-input"
            />
            <span className="field__error" id="code-error" role="alert">
              {joinError}
            </span>
          </div>
          <Button variant="primary" type="submit" disabled={joining} data-testid="join-submit">
            {joining ? "Joining…" : "Join"}
          </Button>
        </form>
        <section className="panel stack" aria-labelledby="create-title">
          <h3 className="panel__title" id="create-title">
            {HOST_MODE ? "Host an arena" : "Create a private room"}
          </h3>
          <p className="field__hint">
            Opens with {base.name}. In the lobby you can switch mode, pick the map and set the rules, then
            share the code.
            {HOST_MODE && " Keep this tab open and in front while you play."}
          </p>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <Button
            disabled={!!busy}
            onClick={() => void run("create", () => start(base, "lobby"))}
            data-testid="create-room"
          >
            {busy ? "Opening…" : HOST_MODE ? "Create arena" : "Create private room"}
          </Button>
        </section>
      </div>
      {!HOST_MODE && <RoomList onTotals={onTotals} />}
    </div>
  );
}
