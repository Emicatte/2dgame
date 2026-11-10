import {
  COOP_OPERATIONS,
  type CoopOperation,
  type GameMode,
  MAPS,
  MODE_CATEGORIES,
  MODES,
  type ModeDef,
  mapsForMode,
  missionById,
  modeEnabled,
  PLANNED_MODES,
  type PlannedMode,
  SURVIVAL_MAPS,
} from "@scrapline/shared";
import { type KeyboardEvent, useRef, useState } from "react";
import { Button, SheetHeader } from "../components/ui.tsx";
import { MODE_FLAGS } from "../lib/modeFlags.ts";
import { HOST_MODE } from "../net/api.ts";
import { session } from "../net/session.ts";
import { currentLoadout } from "../state/profile.ts";

type Card =
  | { kind: "mode"; def: ModeDef }
  | { kind: "op"; def: CoopOperation }
  | { kind: "planned"; def: PlannedMode };

function cardsFor(categoryModes: readonly string[]): Card[] {
  const out: Card[] = [];
  for (const id of categoryModes) {
    if (id in MODES) {
      const def = MODES[id as GameMode];
      // Switched off in this build: not shown at all (nothing to offer).
      if (def.status === "available" && !modeEnabled(def.id, MODE_FLAGS)) continue;
      out.push({ kind: "mode", def });
    } else {
      const op = COOP_OPERATIONS.find((o) => o.id === id);
      if (op && modeEnabled("outbreak", MODE_FLAGS)) out.push({ kind: "op", def: op });
      const planned = PLANNED_MODES.find((p) => p.id === id);
      if (planned) out.push({ kind: "planned", def: planned });
    }
  }
  return out;
}

function mapNames(mode: GameMode): string {
  if (mode === "outbreak") return "Campaign missions";
  if (mode === "survival") return SURVIVAL_MAPS.map((m) => MAPS[m].name).join(", ");
  const maps = mapsForMode(mode);
  if (maps.length > 4) return `${maps.length} maps`;
  return maps.map((m) => MAPS[m].name).join(", ");
}

/**
 * Play screen: every mode by category, with its rules, players, length and maps. Available modes
 * start a real match (quick match where offered, otherwise a private room / arena set to the
 * mode); planned modes show their status and what they wait for, with no button.
 */
export function PlayScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const category = MODE_CATEGORIES[tab]!;
  const cards = cardsFor(category.modes);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
      setBusy(null);
    }
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const n = MODE_CATEGORIES.length;
    let next = tab;
    if (e.key === "ArrowRight") next = (tab + 1) % n;
    else if (e.key === "ArrowLeft") next = (tab + n - 1) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    setTab(next);
    tabs.current[next]?.focus();
  }

  return (
    <div className="screen screen--dim">
      <div className="sheet sheet--wide" data-testid="play-screen">
        <SheetHeader title="Play" onBack={onBack} />
        <div className="sheet__body">
          <div className="play-tabs" role="tablist" aria-label="Mode categories">
            {MODE_CATEGORIES.map((c, i) => (
              <button
                key={c.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`play-tab-${c.id}`}
                aria-selected={i === tab}
                aria-controls="play-panel"
                tabIndex={i === tab ? 0 : -1}
                className="play-tab"
                onClick={() => setTab(i)}
                onKeyDown={onTabKey}
                data-testid={`play-tab-${c.id}`}
              >
                {c.name}
              </button>
            ))}
          </div>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <div
            className="play-grid"
            id="play-panel"
            role="tabpanel"
            aria-labelledby={`play-tab-${category.id}`}
          >
            {cards.map((c) =>
              c.kind === "mode" ? (
                <article key={c.def.id} className="play-card" data-testid={`play-card-${c.def.id}`}>
                  <header className="play-card__head">
                    <h3>{c.def.name}</h3>
                    <span className="badge badge--good">Available</span>
                  </header>
                  <p className="play-card__blurb">{c.def.blurb}</p>
                  <dl className="play-card__facts">
                    <dt>Players</dt>
                    <dd>
                      {c.def.players.min === c.def.players.max
                        ? c.def.players.min
                        : `${c.def.players.min}–${c.def.players.max}`}
                    </dd>
                    <dt>Length</dt>
                    <dd>{c.def.durationLabel}</dd>
                    <dt>Maps</dt>
                    <dd>{mapNames(c.def.id)}</dd>
                  </dl>
                  <ul className="play-card__rules">
                    {c.def.rules.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <div className="play-card__actions">
                    {!HOST_MODE && c.def.quick && (
                      <Button
                        variant="primary"
                        disabled={!!busy}
                        onClick={() =>
                          void run(`q-${c.def.id}`, () => session.quickMatch(currentLoadout(), c.def.id))
                        }
                        data-testid={`play-quick-${c.def.id}`}
                      >
                        {busy === `q-${c.def.id}` ? "Finding…" : "Play"}
                      </Button>
                    )}
                    <Button
                      variant={HOST_MODE || !c.def.quick ? "primary" : "default"}
                      disabled={!!busy}
                      onClick={() =>
                        void run(`p-${c.def.id}`, () =>
                          c.def.id === "outbreak"
                            ? session.createCoop(currentLoadout())
                            : session.createWithMode(currentLoadout(), c.def.id),
                        )
                      }
                      data-testid={`play-private-${c.def.id}`}
                    >
                      {busy === `p-${c.def.id}` ? "Creating…" : HOST_MODE ? "Create arena" : "Private room"}
                    </Button>
                  </div>
                </article>
              ) : c.kind === "op" ? (
                <article key={c.def.id} className="play-card" data-testid={`play-card-${c.def.id}`}>
                  <header className="play-card__head">
                    <h3>{c.def.name}</h3>
                    <span className="badge badge--good">Available</span>
                  </header>
                  <p className="play-card__blurb">{c.def.blurb}</p>
                  <dl className="play-card__facts">
                    <dt>Players</dt>
                    <dd>
                      {c.def.players.min}–{c.def.players.max}
                    </dd>
                    <dt>Map</dt>
                    <dd>{MAPS[missionById(c.def.mission)?.map ?? "works"].name}</dd>
                  </dl>
                  <p className="play-card__blurb">{missionById(c.def.mission)?.brief}</p>
                  <div className="play-card__actions">
                    <Button
                      variant="primary"
                      disabled={!!busy}
                      onClick={() =>
                        void run(`p-${c.def.id}`, () => session.createCoop(currentLoadout(), c.def.mission))
                      }
                      data-testid={`play-private-${c.def.id}`}
                    >
                      {busy === `p-${c.def.id}` ? "Creating…" : HOST_MODE ? "Create arena" : "Private room"}
                    </Button>
                  </div>
                </article>
              ) : (
                <article
                  key={c.def.id}
                  className="play-card is-planned"
                  aria-disabled="true"
                  data-testid={`play-card-${c.def.id}`}
                >
                  <header className="play-card__head">
                    <h3>{c.def.name}</h3>
                    <span className="badge badge--warn">
                      {c.def.status === "development" ? "In development" : "Planned"}
                    </span>
                  </header>
                  <p className="play-card__blurb">{c.def.blurb}</p>
                  <dl className="play-card__facts">
                    <dt>Players</dt>
                    <dd>
                      {c.def.players.min}–{c.def.players.max}
                    </dd>
                  </dl>
                  <p className="play-card__needs">{c.def.needs}</p>
                </article>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
