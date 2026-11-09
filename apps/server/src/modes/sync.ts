import type { StateView } from "@colyseus/schema";
import { AllyState, DisguiseState, type MatchState } from "@scrapline/shared";
import type { GameSimulation } from "../simulation/GameSimulation.ts";

/** Entries of the filtered collections a view currently holds ("a:<id>", "d:<id>"). */
const grants = new WeakMap<StateView, Set<string>>();

/**
 * Mirrors the mode controller into the synchronized state and applies the hidden-information
 * rules per viewer. Shared by ArenaRoom (one StateView per client) and HostRoom (one per guest;
 * the host's own tab reads the full local state and filters what it draws by the same rules).
 *
 * - `allies`: the real pose of each masked player, granted to the players allowed to see it
 *   (themselves and their side). Nobody else's StateView ever holds the entry, so the encoder
 *   never writes it into their patches.
 * - `disguises`: Prop Hunt objects, granted only to viewers allowed to see them (hunters get
 *   them when the hunt starts, all at once).
 */
export function syncModeState(
  state: MatchState,
  sim: GameSimulation,
  viewers: Iterable<readonly [string, StateView]>,
): void {
  const ctl = sim.ctl;
  if (ctl) ctl.sync(state);
  else if (state.round.stage !== "" || state.round.num !== 0) {
    state.round.stage = "";
    state.round.num = 0;
    state.round.end = 0;
    state.round.dark = false;
  }
  if (!ctl) {
    for (const ps of state.players.values()) {
      if (ps.role !== 0) ps.role = 0;
      if (ps.frozen) ps.frozen = false;
      if (ps.masked) ps.masked = false;
      if (ps.pts !== 0) ps.pts = 0;
      if (ps.gg !== 0) ps.gg = 0;
    }
  }
  if (state.pings.size > 0 && ctl?.mode !== "prophunt") state.pings.clear();

  const allies = ctl?.allyEntries() ?? new Map();
  for (const id of [...state.allies.keys()]) if (!allies.has(id)) state.allies.delete(id);
  for (const [id, a] of allies) {
    let s = state.allies.get(id);
    if (!s) {
      s = new AllyState();
      state.allies.set(id, s);
    }
    if (s.x !== a.x) s.x = a.x;
    if (s.y !== a.y) s.y = a.y;
    if (s.a !== a.a) s.a = a.a;
    if (s.t !== a.t) s.t = a.t;
    if (s.d !== a.d) s.d = a.d;
    if (s.k !== a.k) s.k = a.k;
    if (s.lk !== a.lk) s.lk = a.lk;
    if (s.cdT !== a.cdT) s.cdT = a.cdT;
    if (s.cdS !== a.cdS) s.cdS = a.cdS;
    if (s.cdD !== a.cdD) s.cdD = a.cdD;
  }

  const objects = ctl?.objectEntries() ?? new Map();
  for (const id of [...state.disguises.keys()]) if (!objects.has(id)) state.disguises.delete(id);
  for (const [id, o] of objects) {
    let s = state.disguises.get(id);
    if (!s) {
      s = new DisguiseState();
      state.disguises.set(id, s);
    }
    if (s.k !== o.k) s.k = o.k;
    if (s.x !== o.x) s.x = o.x;
    if (s.y !== o.y) s.y = o.y;
    if (s.r !== o.r) s.r = o.r;
  }

  for (const [viewerId, view] of viewers) {
    let held = grants.get(view);
    if (!held) {
      held = new Set();
      grants.set(view, held);
    }
    for (const key of [...held]) {
      const id = key.slice(2);
      if (key.startsWith("a:") ? !state.allies.has(id) : !state.disguises.has(id)) held.delete(key);
    }
    for (const [id, s] of state.allies) {
      const key = `a:${id}`;
      const want = !!ctl && ctl.canSeeAlly(viewerId, id);
      if (want && !held.has(key)) {
        view.add(s);
        held.add(key);
      } else if (!want && held.has(key)) {
        view.remove(s);
        held.delete(key);
      }
    }
    const objectsOk = !!ctl && ctl.canSeeObjects(viewerId);
    for (const [id, s] of state.disguises) {
      const key = `d:${id}`;
      if (objectsOk && !held.has(key)) {
        view.add(s);
        held.add(key);
      } else if (!objectsOk && held.has(key)) {
        view.remove(s);
        held.delete(key);
      }
    }
  }
}
