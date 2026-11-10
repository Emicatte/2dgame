import type {
  AbilityMessage,
  Circle,
  GameMode,
  HitTarget,
  MatchState,
  NetEvent,
  PickupKind,
  VehicleSpawnDef,
} from "@scrapline/shared";
import type { GameSimulation, ServerPlayer } from "../simulation/GameSimulation.ts";

/** One shot's hits on mode objects (Prop Hunt), resolved after the pellets were traced. */
export interface ObjectHit {
  id: string;
  dmg: number;
  x: number;
  y: number;
}

/** What a mode contributes to a player's results (XP lines and career counters). */
export interface ModeFacts {
  /** Points shown in the results table (round modes) or the ladder level reached (Gun Game). */
  points: number;
  gunGameLevels?: number;
  roundsSurvived?: number;
  finds?: number;
  extra: Record<string, number>;
}

/** Real pose of a masked player as their own side receives it (MatchState.allies). */
export interface AllyData {
  x: number;
  y: number;
  a: number;
  t: number;
  d: string;
  k: number;
  lk: boolean;
  cdT: number;
  cdS: number;
  cdD: number;
}

/** A Prop Hunt object as published (MatchState.disguises). */
export interface ObjectData {
  k: number;
  x: number;
  y: number;
  r: number;
}

/** An objective marker as published (MatchState.marks). */
export interface MarkData {
  k: string;
  x: number;
  y: number;
  r: number;
  c: number;
  p: number;
  l: string;
  a: string;
}

/** The pose the other side is allowed to see of a player, or null when the real pose is public. */
export interface PublicPose {
  x: number;
  y: number;
  aim: number;
}

/**
 * Behavior of one game mode on the authoritative side. GameSimulation calls these hooks; the rooms
 * (dedicated ArenaRoom and browser-hosted HostRoom) never branch on a mode id themselves. Both run
 * the same controller code, so a mode cannot behave differently in host mode.
 *
 * Lifecycle: reset() at PREPARING (sides, rounds, loadouts) → step() every live tick (round
 * stages, timers, visibility) → over() asks for the end of the match → overtime() may extend it.
 */
export interface ModeController {
  readonly mode: GameMode;
  /**
   * Some positions are secret: player poses are masked for the other side, gameplay events are
   * filtered per recipient (eventVisible), filtered collections are granted per viewer.
   */
  readonly hiddenInfo: boolean;
  /** Vehicles parked on the map are spawned. */
  readonly vehicles: boolean;
  /** The room's score limit ends the match (otherwise the mode decides through over()). */
  readonly usesScoreLimit: boolean;

  pickupAllowed(kind: PickupKind): boolean;
  /** New match: sides, rounds, ladder levels. Runs before every player spawns. */
  reset(): void;
  spawnPoint(p: ServerPlayer): { x: number; y: number } | null;
  /** After a spawn: loadout and health. */
  onSpawn(p: ServerPlayer): void;
  /** Seconds before a respawn, or null: out until the next round. */
  respawnDelay(victim: ServerPlayer, killer: ServerPlayer | null): number | null;
  onKill(victim: ServerPlayer, killer: ServerPlayer | null, weapon: number): void;
  /** A player joining a running match may spawn now (false: spectates until the next round). */
  allowJoinSpawn(p: ServerPlayer): boolean;
  onLeave(p: ServerPlayer): void;
  /** Live tick, after inputs were applied. */
  step(): void;
  /** Cannot move or act this tick (seekers in the pen, a locked prop). */
  frozen(p: ServerPlayer): boolean;
  /** Body used by the movement of `p` (Prop Hunt disguises), null = the normal player. */
  body(p: ServerPlayer): { radius: number; speed: number } | null;
  /** Extra bodies `p` cannot walk through. */
  obstacles(p: ServerPlayer): Circle[];
  /** Whether shots can hit `p`'s player circle (a disguised prop is hit through its object). */
  playerTargetable(p: ServerPlayer): boolean;
  /** Mode objects shots can hit (ids "d:<id>"), as the shooter saw them at `viewTick`. */
  shotTargets(shooter: ServerPlayer, viewTick: number): HitTarget[];
  onObjectHits(shooter: ServerPlayer, hits: ObjectHit[]): void;
  ability(p: ServerPlayer, msg: AbilityMessage): void;
  /** Real pose hidden from the other side: the pose they may see, else null. */
  publicPose(p: ServerPlayer): PublicPose | null;
  /** Whether a gameplay event may reach `viewerId`. */
  eventVisible(viewerId: string, ev: NetEvent): boolean;
  /** Ends the match ("ladder", "rounds", "opponents-left"…), or null to continue. */
  over(): string | null;
  /** Called when the match clock runs out: seconds of overtime, or 0 to end now. */
  overtime(): number;
  standings(): ServerPlayer[] | null;
  leaderScore(): number;
  winningTeam(): number;
  facts(p: ServerPlayer): ModeFacts;
  /** Mirrors the mode's public state into the synchronized state (rounds, pings, poses). */
  sync(state: MatchState): void;
  /** Filtered collections: may `viewerId` see the real pose of masked player `ownerId`? */
  canSeeAlly(viewerId: string, ownerId: string): boolean;
  /** Filtered collections: may `viewerId` receive the Prop Hunt objects right now? */
  canSeeObjects(viewerId: string): boolean;
  /** Real poses of the masked players (each granted to canSeeAlly viewers only). */
  allyEntries(): Map<string, AllyData>;
  /** Prop Hunt objects (granted to canSeeObjects viewers only). */
  objectEntries(): Map<string, ObjectData>;
  /** Lobby settings that matter to the mode (round count, variant). */
  configure(opts: { rounds: number; variant: string }): void;
  /** Multiplier on the damage `attacker` deals to `target` (Chaos rules). */
  damageScale(attacker: ServerPlayer | null, target: ServerPlayer): number;
  /** After damage was applied (Chaos vampire). */
  onDamage(target: ServerPlayer, attacker: ServerPlayer | null, dmg: number): void;
  /** Objective markers (MatchState.marks), visible to everybody. */
  markEntries(): Map<string, MarkData>;
  /** One public status line (MatchState.modeText). */
  statusText(): string;
  /** Vehicles parked for this mode (Convoy's truck), or null for the map's own. */
  vehicleSpawns(): readonly VehicleSpawnDef[] | null;
}

/** Defaults: an open free-for-all with nothing hidden. Modes override what they change. */
export abstract class BaseMode implements ModeController {
  abstract readonly mode: GameMode;
  readonly hiddenInfo: boolean = false;
  readonly vehicles: boolean = false;
  readonly usesScoreLimit: boolean = false;

  constructor(protected readonly sim: GameSimulation) {}

  pickupAllowed(_kind: PickupKind): boolean {
    return true;
  }
  reset(): void {}
  spawnPoint(_p: ServerPlayer): { x: number; y: number } | null {
    return null;
  }
  onSpawn(_p: ServerPlayer): void {}
  respawnDelay(_victim: ServerPlayer, _killer: ServerPlayer | null): number | null {
    return 3;
  }
  onKill(_victim: ServerPlayer, _killer: ServerPlayer | null, _weapon: number): void {}
  allowJoinSpawn(_p: ServerPlayer): boolean {
    return true;
  }
  onLeave(_p: ServerPlayer): void {}
  step(): void {}
  frozen(_p: ServerPlayer): boolean {
    return false;
  }
  body(_p: ServerPlayer): { radius: number; speed: number } | null {
    return null;
  }
  obstacles(_p: ServerPlayer): Circle[] {
    return [];
  }
  playerTargetable(_p: ServerPlayer): boolean {
    return true;
  }
  shotTargets(_shooter: ServerPlayer, _viewTick: number): HitTarget[] {
    return [];
  }
  onObjectHits(_shooter: ServerPlayer, _hits: ObjectHit[]): void {}
  ability(_p: ServerPlayer, _msg: AbilityMessage): void {}
  publicPose(_p: ServerPlayer): PublicPose | null {
    return null;
  }
  eventVisible(_viewerId: string, _ev: NetEvent): boolean {
    return true;
  }
  over(): string | null {
    return null;
  }
  overtime(): number {
    return 0;
  }
  standings(): ServerPlayer[] | null {
    return null;
  }
  leaderScore(): number {
    return 0;
  }
  winningTeam(): number {
    return 0;
  }
  facts(_p: ServerPlayer): ModeFacts {
    return { points: 0, extra: {} };
  }
  sync(_state: MatchState): void {}
  canSeeAlly(viewerId: string, ownerId: string): boolean {
    return viewerId === ownerId;
  }
  canSeeObjects(_viewerId: string): boolean {
    return true;
  }
  allyEntries(): Map<string, AllyData> {
    return new Map();
  }
  objectEntries(): Map<string, ObjectData> {
    return new Map();
  }
  configure(_opts: { rounds: number; variant: string }): void {}
  damageScale(_attacker: ServerPlayer | null, _target: ServerPlayer): number {
    return 1;
  }
  onDamage(_target: ServerPlayer, _attacker: ServerPlayer | null, _dmg: number): void {}
  markEntries(): Map<string, MarkData> {
    return new Map();
  }
  statusText(): string {
    return "";
  }
  vehicleSpawns(): readonly VehicleSpawnDef[] | null {
    return null;
  }

  /** Players taking part in the match (not those who left it and wait in the room). */
  protected players(): ServerPlayer[] {
    return [...this.sim.players.values()].filter((p) => !p.away);
  }

  protected emit(ev: NetEvent): void {
    this.sim.pushEvent(ev);
  }
}
