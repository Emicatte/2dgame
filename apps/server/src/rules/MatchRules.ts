import {
  type Difficulty,
  defaultVariant,
  FIRST_CONTACT,
  type GameMode,
  isDifficulty,
  isPveMode,
  isRoleMode,
  isRoundMode,
  isTeamMode,
  MAPS,
  MATCH_LIMITS,
  type MapId,
  type MatchState,
  MODE_DEFAULTS,
  MODE_VARIANTS,
  MODES,
  mapSupportsMode,
  mapsForMode,
  missionById,
  PVE_SQUAD,
  ROUND_LIMITS,
  SURVIVAL_MAPS,
  TEAM_ALPHA,
  TEAM_BRAVO,
  TEAM_SIZE,
} from "@scrapline/shared";
import type { PveConfig } from "../pve/PveController.ts";
import { pveOver } from "../pve/pveRoom.ts";
import type { GameSimulation, ServerPlayer } from "../simulation/GameSimulation.ts";

/**
 * Mode and team rules shared by both room implementations (dedicated server ArenaRoom and the
 * browser-hosted HostRoom), so they cannot drift apart. The simulation is the source of truth for
 * teams and team scores; `sync()` mirrors them into the synchronized state.
 *
 * Practice targets (bots) never count toward team sizes and always play against the humans.
 */
export class MatchRules {
  constructor(
    private readonly sim: GameSimulation,
    private readonly state: MatchState,
    private readonly isBot: (id: string) => boolean,
  ) {}

  get teamMode(): boolean {
    return isTeamMode(this.state.mode);
  }

  /** Co-op PvE (Outbreak, Survival): every human on team 1, no friendly fire, no practice targets. */
  get pveMode(): boolean {
    return isPveMode(this.state.mode);
  }

  /** Hide & Seek, Prop Hunt: sides assigned at match start, no practice targets, rounds. */
  get roleMode(): boolean {
    return isRoleMode(this.state.mode);
  }

  /** Practice bots fill a lonely room in this mode (never in co-op or the round modes). */
  get practiceAllowed(): boolean {
    return !this.pveMode && !this.roleMode && MODES[this.state.mode as GameMode]?.weapons !== "None";
  }

  humans(): ServerPlayer[] {
    return [...this.sim.players.values()].filter((p) => !this.isBot(p.id));
  }

  /** Humans per team, indexed by team id. */
  counts(): [number, number, number] {
    const c: [number, number, number] = [0, 0, 0];
    for (const p of this.humans()) if (p.team === 1 || p.team === 2) c[p.team]++;
    return c;
  }

  /**
   * Applies a mode with its default length, score limit and size (room creation, or the host
   * switching mode in the lobby). Team sizes grow if needed so nobody present is pushed out.
   */
  setMode(mode: GameMode): void {
    const d = MODE_DEFAULTS[mode];
    const humans = this.humans().length;
    this.state.mode = mode;
    this.state.durationSec = d.durationSec;
    this.state.killLimit = d.scoreLimit;
    this.state.friendlyFire = d.friendlyFire;
    if (isPveMode(mode)) {
      this.state.teamSize = 0;
      this.state.maxPlayers = Math.max(PVE_SQUAD.max, humans);
      if (mode === "outbreak" && !missionById(this.state.pve.mission))
        this.state.pve.mission = FIRST_CONTACT.id;
      if (mode === "survival") this.state.pve.mission = "";
      if (!isDifficulty(this.state.pve.difficulty)) this.state.pve.difficulty = "veteran";
      for (const p of this.sim.players.values()) p.team = 1;
    } else if (isRoleMode(mode)) {
      this.state.teamSize = 0;
      this.state.maxPlayers = Math.max(MODES[mode].players.max, humans);
      const variants = MODE_VARIANTS[mode] ?? [];
      if (!variants.some((v) => v.id === this.state.round.variant))
        this.state.round.variant = defaultVariant(mode);
      for (const p of this.sim.players.values()) p.team = 0;
    } else if (isTeamMode(mode)) {
      const size = Math.min(TEAM_SIZE.max, Math.max(d.teamSize, Math.ceil(humans / 2)));
      this.state.teamSize = size;
      this.state.maxPlayers = size * 2;
      this.balance();
    } else {
      this.state.teamSize = 0;
      this.state.maxPlayers = Math.max(d.maxPlayers, humans);
      for (const p of this.sim.players.values()) p.team = 0;
    }
    this.applyCombatRules();
  }

  /** Team modes: 1v1 … 4v4. Refused when the players already present would not fit. */
  setTeamSize(size: number): boolean {
    if (!this.teamMode) return false;
    const humans = this.humans().length;
    if (size < TEAM_SIZE.min || size > TEAM_SIZE.max || size * 2 < humans) return false;
    this.state.teamSize = size;
    this.state.maxPlayers = Math.max(MATCH_LIMITS.maxPlayers.min, size * 2);
    // A team now larger than the new size gives its newest members to the other team.
    for (const team of [TEAM_ALPHA, TEAM_BRAVO]) {
      const members = this.humans()
        .filter((p) => p.team === team)
        .sort((a, b) => a.joinedTick - b.joinedTick);
      for (const p of members.slice(size)) p.team = team === TEAM_ALPHA ? TEAM_BRAVO : TEAM_ALPHA;
    }
    return true;
  }

  setFriendlyFire(on: boolean): void {
    this.state.friendlyFire = on;
    this.applyCombatRules();
  }

  applyCombatRules(): void {
    if (this.roleMode) {
      // Sides are teams during the match: seekers never hurt seekers.
      this.sim.rules = { teams: true, friendlyFire: false };
      if (this.sim.mode !== this.state.mode) this.sim.setMode(this.state.mode as GameMode);
      return;
    }
    if (this.pveMode) {
      // One squad: shots pass through teammates.
      this.sim.rules = { teams: true, friendlyFire: false };
      if (this.sim.mode !== this.state.mode) this.sim.setMode(this.state.mode as GameMode);
      return;
    }
    this.sim.rules = { teams: this.teamMode, friendlyFire: this.teamMode && this.state.friendlyFire };
    if (this.sim.mode !== this.state.mode) this.sim.setMode(this.state.mode as GameMode);
  }

  /**
   * The map a mode must be played on instead of `mapId`, or null when `mapId` is fine: Vehicle
   * Mayhem needs a map with vehicles (the first one is used).
   */
  static mapForMode(mode: string, mapId: MapId, mission?: string): MapId | null {
    if (mode === "outbreak") {
      const m = missionById(mission ?? "") ?? FIRST_CONTACT;
      return mapId === m.map ? null : m.map;
    }
    if (mode === "survival") return SURVIVAL_MAPS.includes(mapId) ? null : SURVIVAL_MAPS[0]!;
    // Every other mode: the map's compatibility metadata (never a PvE map, vehicles for Mayhem,
    // party data for Prop Hunt). See mapModes.
    if (mapSupportsMode(MAPS[mapId], mode)) return null;
    return mapsForMode(mode)[0] ?? "industrial";
  }

  /** Round modes: variant (validated against MODE_VARIANTS). */
  setVariant(variant: string): boolean {
    const list = MODE_VARIANTS[this.state.mode as GameMode];
    if (!list?.some((v) => v.id === variant)) return false;
    this.state.round.variant = variant;
    return true;
  }

  /** Round modes: number of rounds (stored in the score limit). */
  setRounds(n: number): boolean {
    if (!isRoundMode(this.state.mode) || n < ROUND_LIMITS.min || n > ROUND_LIMITS.max) return false;
    this.state.killLimit = n;
    return true;
  }

  /**
   * Results: offers the current map and up to two other maps compatible with the mode for the
   * next match (co-op modes follow their missions: no vote).
   */
  openVote(rng: () => number = Math.random): void {
    for (const ps of this.state.players.values()) ps.vote = "";
    if (this.pveMode) {
      this.state.voteMaps = "";
      return;
    }
    const current = this.state.mapId as MapId;
    const others = mapsForMode(this.state.mode).filter((id) => id !== current);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [others[i], others[j]] = [others[j]!, others[i]!];
    }
    this.state.voteMaps = [current, ...others.slice(0, 2)].join(",");
  }

  vote(id: string, map: MapId): boolean {
    const ps = this.state.players.get(id);
    if (!ps || !this.state.voteMaps.split(",").includes(map)) return false;
    ps.vote = map;
    return true;
  }

  /** Closes the vote: the most voted map (the current one wins ties), or null to stay. */
  closeVote(): MapId | null {
    const options = this.state.voteMaps.split(",").filter(Boolean) as MapId[];
    this.state.voteMaps = "";
    const tally = new Map<string, number>();
    for (const ps of this.state.players.values()) {
      if (ps.vote) tally.set(ps.vote, (tally.get(ps.vote) ?? 0) + 1);
      ps.vote = "";
    }
    const current = this.state.mapId as MapId;
    let best: MapId = current;
    let bestVotes = tally.get(current) ?? 0;
    for (const id of options) {
      const n = tally.get(id) ?? 0;
      if (n > bestVotes) {
        best = id;
        bestVotes = n;
      }
    }
    return best !== current && this.mapAllowed(best) ? best : null;
  }

  /** Why the host cannot start now (too few humans for the mode), or null. */
  startBlocker(): string | null {
    const def = MODES[this.state.mode as GameMode];
    const humans = this.humans().length;
    if (def && humans < def.players.min) return `${def.name} needs at least ${def.players.min} players`;
    return null;
  }

  /**
   * Why the running match ends at `tick`, or null. Shared by both room implementations: the
   * PvE run, the mode controller (ladder won, rounds played, a side left empty), the score limit,
   * then the clock (a mode may ask for overtime instead).
   */
  endReason(tick: number): string | null {
    if (this.pveMode) {
      if (pveOver(this.sim)) return "pve";
      return tick >= this.state.phaseEndTick ? "time" : null;
    }
    const byMode = this.sim.modeOver();
    if (byMode) return byMode;
    const ctl = this.sim.ctl;
    if ((!ctl || ctl.usesScoreLimit) && this.sim.leaderScore() >= this.state.killLimit) return "score-limit";
    if (tick >= this.state.phaseEndTick) {
      const extra = ctl?.overtime() ?? 0;
      if (extra > 0) {
        this.state.phaseEndTick = tick + this.sim.secToTicks(extra);
        return null;
      }
      return "time";
    }
    return null;
  }

  /** PvE: the run configuration for the next match (null in competitive modes). */
  pveConfig(): PveConfig | null {
    if (!this.pveMode) return null;
    const difficulty: Difficulty = isDifficulty(this.state.pve.difficulty)
      ? this.state.pve.difficulty
      : "veteran";
    if (this.state.mode === "survival") return { mode: "survival", difficulty };
    return { mode: "outbreak", mission: missionById(this.state.pve.mission) ?? FIRST_CONTACT, difficulty };
  }

  /** A map the host may pick under the current mode. */
  mapAllowed(mapId: MapId): boolean {
    return MatchRules.mapForMode(this.state.mode, mapId, this.state.pve.mission) === null;
  }

  /**
   * Team for a newcomer: the preferred team if it has room, otherwise the smaller team (Alpha on a
   * tie). Returns 0 outside team modes, and -1 when both teams are full.
   */
  assign(id: string, preferred?: number): number {
    const p = this.sim.players.get(id);
    if (!p) return -1;
    if (this.pveMode) {
      p.team = 1;
      return 1;
    }
    if (!this.teamMode) {
      // Round modes: no side until the match starts (or the next round, for latecomers).
      p.team = 0;
      return 0;
    }
    if (this.isBot(id)) {
      p.team = this.botTeam();
      return p.team;
    }
    p.team = 0;
    const c = this.counts();
    const size = this.state.teamSize;
    let team: number;
    if ((preferred === TEAM_ALPHA || preferred === TEAM_BRAVO) && c[preferred] < size) team = preferred;
    else if (c[TEAM_ALPHA] <= c[TEAM_BRAVO] && c[TEAM_ALPHA] < size) team = TEAM_ALPHA;
    else if (c[TEAM_BRAVO] < size) team = TEAM_BRAVO;
    else if (c[TEAM_ALPHA] < size) team = TEAM_ALPHA;
    else return -1;
    p.team = team;
    return team;
  }

  /** Practice targets play for the team the (single) human is not on. */
  botTeam(): number {
    const human = this.humans().find((p) => p.team === TEAM_ALPHA || p.team === TEAM_BRAVO);
    return human?.team === TEAM_BRAVO ? TEAM_ALPHA : TEAM_BRAVO;
  }

  /** A player asks to move to another team (lobby/results only, target must have room). */
  switchTeam(id: string, team: number): boolean {
    const p = this.sim.players.get(id);
    if (!p || !this.teamMode || this.isBot(id)) return false;
    if (team !== TEAM_ALPHA && team !== TEAM_BRAVO) return false;
    if (p.team === team) return true;
    if (this.counts()[team] >= this.state.teamSize) return false;
    p.team = team;
    this.retargetBots();
    return true;
  }

  /**
   * Even teams by level: players sorted by level (then join order) are dealt in a snake order
   * (A B B A A B …), which keeps both the sizes and the level sums close.
   */
  balance(): void {
    if (!this.teamMode) return;
    const humans = this.humans().sort((a, b) => b.level - a.level || a.joinedTick - b.joinedTick);
    humans.forEach((p, i) => {
      const round = Math.floor(i / 2);
      const first = round % 2 === 0 ? TEAM_ALPHA : TEAM_BRAVO;
      p.team = i % 2 === 0 ? first : first === TEAM_ALPHA ? TEAM_BRAVO : TEAM_ALPHA;
    });
    this.retargetBots();
  }

  /**
   * Before a match starts: everybody has a team, and with two or more humans neither team is
   * empty (otherwise there is nobody to fight) — in that case teams are rebalanced.
   */
  prepareMatch(): void {
    if (this.sim.ctl) {
      this.applyCombatRules();
      this.sim.ctl.configure({ rounds: this.state.killLimit, variant: this.state.round.variant });
    }
    if (this.roleMode) return;
    if (this.pveMode) {
      for (const p of this.sim.players.values()) p.team = 1;
      this.applyCombatRules();
      return;
    }
    if (!this.teamMode) return;
    const humans = this.humans();
    for (const p of humans) if (p.team !== TEAM_ALPHA && p.team !== TEAM_BRAVO) this.assign(p.id);
    const c = this.counts();
    if (humans.length >= 2 && (c[TEAM_ALPHA] === 0 || c[TEAM_BRAVO] === 0)) this.balance();
    this.retargetBots();
  }

  private retargetBots(): void {
    const t = this.botTeam();
    for (const p of this.sim.players.values()) if (this.isBot(p.id)) p.team = this.teamMode ? t : 0;
  }

  /** Mirrors teams and scores into the synchronized state. */
  sync(): void {
    for (const [id, p] of this.sim.players) {
      const ps = this.state.players.get(id);
      if (ps && ps.team !== p.team) ps.team = p.team;
    }
    this.state.scoreA = this.sim.teamScores[TEAM_ALPHA];
    this.state.scoreB = this.sim.teamScores[TEAM_BRAVO];
  }
}
