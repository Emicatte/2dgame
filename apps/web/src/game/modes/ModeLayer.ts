import {
  type AllyState,
  type Circle,
  DISGUISES,
  disguiseDef,
  GUN_GAME,
  gunGameWeapon,
  isMapId,
  MAPS,
  type MapDef,
  type MatchState,
  type MazeDef,
  type NetEvent,
  PROP_HUNT,
  ROLE,
  roleText,
  TEAMS,
  WEAPONS,
} from "@scrapline/shared";
import Phaser from "phaser";
import { session } from "../../net/session.ts";
import { propCanvas, propTextureKey } from "../art/propArt.ts";
import { sfx } from "../audio/sfx.ts";
import type { Effects } from "../effects/Effects.ts";
import type { InputManager } from "../input/InputManager.ts";
import type { Lightmap } from "../pve/lightmap.ts";
import { sightWorld } from "../pve/visibility.ts";
import { modeHudStore, showBanner, showToast } from "./modeHud.ts";

interface ObjSnap {
  tick: number;
  objs: Map<string, { x: number; y: number; r: number; k: number }>;
}

/** A pose a remote player may be drawn at, or hidden. */
export interface DrawPose {
  x: number;
  y: number;
  aim: number;
  hidden: boolean;
}

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "Chakra Petch, sans-serif",
  fontSize: "12px",
  color: "#9fe7ff",
  stroke: "#0b0c0e",
  strokeThickness: 4,
};

const roleName = (mode: string, role: number) =>
  role === ROLE.SEEKER ? roleText(mode).seeker : role === ROLE.HIDER ? roleText(mode).hider : "Spectator";

/** Ring colour of a mode marker: its team, or amber for neutral ones. */
/** Marks the maze draws itself (no ring). */
const MAZE_KINDS = new Set(["trap", "door", "key", "switch", "plate", "pit", "sweeper", "terminal"]);

const markColor = (c: number) => (c === 1 || c === 2 ? TEAMS[c].color : 0xffc53d);

const MARK_LABEL: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "Chakra Petch, sans-serif",
  fontSize: "13px",
  color: "#ffffff",
  stroke: "#0b0c0e",
  strokeThickness: 4,
};

/**
 * Client side of Gun Game, Hide & Seek and Prop Hunt: presentation only. It draws what the
 * synchronized state holds (the server already left out what this player may not see), keeps a
 * host's own tab to the same rules (the host's local state is complete), and turns the mode keys
 * into ability messages. ArenaScene calls it at a few points; nothing here decides gameplay.
 */
export class ModeLayer {
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();
  private readonly snaps: ObjSnap[] = [];
  private readonly pingGfx: Phaser.GameObjects.Graphics;
  private readonly markGfx: Phaser.GameObjects.Graphics;
  /** Mode objective markers (MatchState.marks) and their labels. */
  private readonly objGfx: Phaser.GameObjects.Graphics;
  private readonly objLabels = new Map<string, Phaser.GameObjects.Text>();
  private readonly spots = new Map<string, number>();
  private readonly bubbles: { text: Phaser.GameObjects.Text; until: number }[] = [];
  private darkOn = false;
  private hudAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly effects: Effects,
    private readonly lightmap: Lightmap,
  ) {
    this.pingGfx = scene.add.graphics().setDepth(31);
    this.markGfx = scene.add.graphics().setDepth(48);
    this.objGfx = scene.add.graphics().setDepth(32);
    for (const def of DISGUISES) {
      const key = propTextureKey(def.index);
      if (!scene.textures.exists(key))
        scene.textures.addImage(key, propCanvas(def) as unknown as HTMLImageElement);
    }
  }

  /** The baked map keeps its objects except in Prop Hunt (they are drawn live there). */
  static mapProps(mode: string): boolean {
    return mode !== "prophunt";
  }

  private me(state: MatchState, selfId: string) {
    return state.players.get(selfId);
  }

  private myRole(state: MatchState, selfId: string): number {
    return this.me(state, selfId)?.role ?? 0;
  }

  /** The ghost of a masked player, if this client may draw it (its own, or its side's). */
  private ghostFor(state: MatchState, id: string, selfId: string): AllyState | undefined {
    const g = state.allies.get(id);
    if (!g) return undefined;
    if (id === selfId) return g;
    // A host's own tab holds every ghost: draw only the ones of its own side.
    return this.myRole(state, selfId) === ROLE.HIDER && g.t === ROLE.HIDER ? g : undefined;
  }

  /**
   * Where a remote player is drawn this snapshot. Masked players without a visible ghost are
   * hidden (not frozen at their public pose); Prop Hunt props are drawn as their object instead.
   */
  pose(state: MatchState, id: string, selfId: string): DrawPose {
    const ps = state.players.get(id)!;
    if (state.mode === "prophunt" && ps.role === ROLE.HIDER && ps.alive) {
      const g = this.ghostFor(state, id, selfId);
      // Undisguised (hiding time): their side sees the person, nobody else anything.
      if (g && g.k < 0) return { x: g.x, y: g.y, aim: g.a, hidden: false };
      return { x: ps.x, y: ps.y, aim: ps.aim, hidden: true };
    }
    if (!ps.masked) return { x: ps.x, y: ps.y, aim: ps.aim, hidden: false };
    const g = this.ghostFor(state, id, selfId);
    if (g) return { x: g.x, y: g.y, aim: g.a, hidden: false };
    return { x: ps.x, y: ps.y, aim: ps.aim, hidden: true };
  }

  /** The local player's real pose for the prediction when their public pose is masked. */
  ownPose(state: MatchState, selfId: string): { x: number; y: number; aim: number } | null {
    const ps = this.me(state, selfId);
    if (!ps?.masked) return null;
    const g = state.allies.get(selfId);
    return g ? { x: g.x, y: g.y, aim: g.a } : null;
  }

  /** Prop Hunt: the body the local player moves as (radius / speed), as the server applies it. */
  ownBody(state: MatchState, selfId: string): { radius: number; speed: number } | null {
    const g = state.allies.get(selfId);
    const def = g && g.k >= 0 ? disguiseDef(g.k) : undefined;
    return def ? { radius: def.radius, speed: def.speed } : null;
  }

  /** Movement locked (seekers in the pen, a locked prop, round break): the prediction holds still. */
  ownFrozen(state: MatchState, selfId: string): boolean {
    const ps = this.me(state, selfId);
    return !!ps?.frozen || !!state.allies.get(selfId)?.lk;
  }

  /** Prop Hunt objects the local player cannot walk through (as interpolated). */
  obstacles(state: MatchState, selfId: string, renderTick: number): Circle[] {
    if (state.mode !== "prophunt" || state.disguises.size === 0) return [];
    const own = state.allies.get(selfId)?.d ?? "";
    const out: Circle[] = [];
    for (const [id, o] of this.sampleObjects(renderTick)) {
      if (id === own) continue;
      out.push({ x: o.x, y: o.y, r: disguiseDef(o.k)?.radius ?? 16 });
    }
    return out;
  }

  onPatch(state: MatchState, tick: number, inMatch: boolean): void {
    if (!inMatch) {
      this.snaps.length = 0;
      return;
    }
    const objs = new Map<string, { x: number; y: number; r: number; k: number }>();
    state.disguises.forEach((o, id) => {
      objs.set(id, { x: o.x, y: o.y, r: (o.r / 256) * Math.PI * 2, k: o.k });
    });
    this.snaps.push({ tick, objs });
    if (this.snaps.length > 12) this.snaps.shift();
  }

  private sampleObjects(renderTick: number): Map<string, { x: number; y: number; r: number; k: number }> {
    const n = this.snaps.length;
    if (n === 0) return new Map();
    let i = n - 1;
    while (i > 0 && this.snaps[i]!.tick > renderTick) i--;
    const a = this.snaps[i]!;
    const b = this.snaps[i + 1];
    if (!b || a.tick > renderTick) return b && a.tick > renderTick ? a.objs : (b?.objs ?? a.objs);
    const t = Math.max(0, Math.min(1, (renderTick - a.tick) / Math.max(1, b.tick - a.tick)));
    const out = new Map<string, { x: number; y: number; r: number; k: number }>();
    for (const [id, ob] of b.objs) {
      const oa = a.objs.get(id);
      if (!oa || Math.hypot(ob.x - oa.x, ob.y - oa.y) > 160) out.set(id, ob);
      else
        out.set(id, {
          x: oa.x + (ob.x - oa.x) * t,
          y: oa.y + (ob.y - oa.y) * t,
          r: Phaser.Math.Angle.RotateTo(oa.r, ob.r, Math.abs(Phaser.Math.Angle.Wrap(ob.r - oa.r)) * t),
          k: ob.k,
        });
    }
    return out;
  }

  /**
   * Party mode keys. G is the role ability: sonar for seekers and hunters, a noise decoy (thrown
   * at the crosshair) for Hide & Seek hiders, a decoy object for props. Props also: Q picker, E
   * copy what you look at, C lock, T taunt, V swap with a real object.
   */
  handleInput(
    controls: InputManager,
    state: MatchState,
    selfId: string,
    aimAt: () => { x: number; y: number },
  ): void {
    if (state.mode !== "prophunt" && state.mode !== "hideseek") return;
    const ps = this.me(state, selfId);
    const role = ps?.alive ? ps.role : ROLE.NONE;
    const g = controls.consume("decoy");
    if (state.mode === "hideseek") {
      if (g && role === ROLE.SEEKER) session.ability({ a: "sonar" });
      if (g && role === ROLE.HIDER) {
        const t = aimAt();
        session.ability({ a: "noise", x: Math.round(t.x), y: Math.round(t.y) });
      }
      return;
    }
    const isProp = role === ROLE.HIDER;
    const picker = controls.consume("propMenu");
    const lock = controls.consume("lock");
    const taunt = controls.consume("taunt");
    const swap = controls.consume("swap");
    const copy = controls.consume("interact");
    if (g && role === ROLE.SEEKER) session.ability({ a: "sonar" });
    if (!isProp) {
      if (modeHudStore.get().pickerOpen) modeHudStore.patch({ pickerOpen: false });
      return;
    }
    if (picker) modeHudStore.patch({ pickerOpen: !modeHudStore.get().pickerOpen });
    if (lock) session.ability({ a: "lock" });
    if (taunt) session.ability({ a: "taunt" });
    if (g) session.ability({ a: "decoy" });
    if (swap) session.ability({ a: "swap" });
    if (copy) session.ability({ a: "transform" });
  }

  /** Who the camera follows while the local player is out of the round (null: themselves). */
  spectateTarget(state: MatchState, selfId: string): string | null {
    const ps = this.me(state, selfId);
    if (!ps || ps.alive || state.round.stage === "" || ps.respawnTick > 0) return null;
    let pick: string | null = null;
    state.players.forEach((p, id) => {
      if (pick || id === selfId || !p.alive) return;
      const pose = this.pose(state, id, selfId);
      if (pose.hidden) return;
      if (p.role === ps.role || ps.role === 0) pick = id;
    });
    if (!pick)
      state.players.forEach((p, id) => {
        if (!pick && id !== selfId && p.alive && !this.pose(state, id, selfId).hidden) pick = id;
      });
    return pick;
  }

  update(
    state: MatchState,
    selfId: string,
    renderTick: number,
    serverTick: number,
    dtSec: number,
    local: { x: number; y: number; aim: number } | null,
    cam: Phaser.Cameras.Scene2D.Camera,
    map: MapDef,
  ): void {
    const role = this.myRole(state, selfId);
    const now = performance.now();
    this.drawObjects(state, selfId, renderTick, local, role);
    this.drawPings(state, serverTick);
    this.drawObjectiveMarks(state, cam);
    this.drawMarks(state, selfId, renderTick, now);
    this.updateDark(state, selfId, local, cam, map, dtSec);
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]!;
      if (now >= b.until) {
        b.text.destroy();
        this.bubbles.splice(i, 1);
      } else b.text.setAlpha(Math.min(1, (b.until - now) / 400));
    }
    if (now - this.hudAt > 100) {
      this.hudAt = now;
      this.updateHud(state, selfId, serverTick);
    }
  }

  private drawObjects(
    state: MatchState,
    selfId: string,
    renderTick: number,
    local: { x: number; y: number; aim: number } | null,
    role: number,
  ): void {
    // Hunters are blindfolded during the hiding time (a host's own tab holds the objects).
    const show = state.mode === "prophunt" && !(role === ROLE.SEEKER && state.round.stage === "prep");
    const objs = show ? this.sampleObjects(renderTick) : new Map();
    const own = state.allies.get(selfId);
    const owners = new Map<string, string>();
    if (role === ROLE.HIDER)
      state.allies.forEach((g, pid) => {
        if (g.d && pid !== selfId && g.t === ROLE.HIDER) owners.set(g.d, state.players.get(pid)?.name ?? "");
      });
    for (const [id, o] of objs) {
      let img = this.sprites.get(id);
      if (!img) {
        img = this.scene.add.image(o.x, o.y, propTextureKey(o.k)).setScale(0.5).setDepth(20);
        this.sprites.set(id, img);
      }
      const key = propTextureKey(o.k);
      if (img.texture.key !== key) img.setTexture(key);
      let x = o.x;
      let y = o.y;
      let r = o.r;
      if (own && own.d === id && local) {
        x = local.x;
        y = local.y;
        if (!own.lk) r = local.aim;
        img.setDepth(21);
      }
      img.setPosition(x, y).setRotation(r).setVisible(true);
      const owner = owners.get(id);
      if (owner) {
        let label = this.labels.get(id);
        if (!label) {
          label = this.scene.add.text(x, y, owner, LABEL_STYLE).setOrigin(0.5, 1).setDepth(47);
          this.labels.set(id, label);
        }
        label.setPosition(x, y - (disguiseDef(o.k)?.radius ?? 16) - 6).setVisible(true);
      }
    }
    for (const [id, img] of this.sprites) {
      if (!objs.has(id)) {
        img.destroy();
        this.sprites.delete(id);
      }
    }
    for (const [id, label] of this.labels) {
      if (!objs.has(id) || !owners.has(id)) {
        label.destroy();
        this.labels.delete(id);
      }
    }
  }

  private drawPings(state: MatchState, serverTick: number): void {
    const g = this.pingGfx;
    g.clear();
    if (state.pings.size === 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    state.pings.forEach((p) => {
      if (p.until < serverTick) return;
      g.lineStyle(3, 0xffc53d, 0.45 + pulse * 0.35);
      g.strokeCircle(p.x, p.y, p.r);
      g.fillStyle(0xffc53d, 0.06 + pulse * 0.04);
      g.fillCircle(p.x, p.y, p.r);
    });
  }

  /**
   * Mode objective markers: a ring with a label and a progress arc, and an arrow at the screen
   * edge when the marker is off screen.
   */
  private drawObjectiveMarks(state: MatchState, cam: Phaser.Cameras.Scene2D.Camera): void {
    const g = this.objGfx;
    g.clear();
    const seen = new Set<string>();
    const view = cam.worldView;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    const maze = isMapId(state.mapId) ? MAPS[state.mapId].maze : undefined;
    state.marks.forEach((m, id) => {
      seen.add(id);
      if (maze && this.drawMazeMark(g, m, id, maze, pulse)) {
        this.objLabels.get(id)?.setVisible(m.l !== "");
        if (m.l === "") return;
      }
      const color = markColor(m.c);
      const dim = m.k === "checkpoint" && m.p < 100;
      const alpha = dim ? 0.35 : 0.85;
      const own = maze && MAZE_KINDS.has(m.k);
      if (!own) {
        g.lineStyle(m.k === "target" ? 3 : 4, color, alpha * (m.k === "device" ? 0.6 + pulse * 0.4 : 1));
        g.strokeCircle(m.x, m.y, m.r);
        g.fillStyle(color, m.k === "target" ? 0.05 + pulse * 0.05 : 0.08);
        g.fillCircle(m.x, m.y, m.r);
      }
      if (m.p > 0 && m.p < 100) {
        g.lineStyle(6, 0xffffff, 0.9);
        g.beginPath();
        g.arc(m.x, m.y, m.r + 8, -Math.PI / 2, -Math.PI / 2 + (m.p / 100) * Math.PI * 2);
        g.strokePath();
      }
      let label = this.objLabels.get(id);
      if (!label) {
        label = this.scene.add.text(m.x, m.y, m.l, MARK_LABEL).setOrigin(0.5, 1).setDepth(47);
        this.objLabels.set(id, label);
      }
      if (label.text !== m.l) label.setText(m.l);
      label.setPosition(m.x, m.y - m.r - 6).setAlpha(dim ? 0.6 : 1);
      // Off screen: an arrow at the edge pointing to it (never in a maze: finding the way is the game).
      const inView = view.contains(m.x, m.y);
      if (!inView && !dim && !maze) {
        const cx = view.centerX;
        const cy = view.centerY;
        const a = Math.atan2(m.y - cy, m.x - cx);
        const hw = view.width / 2 - 34;
        const hh = view.height / 2 - 34;
        const k = Math.min(Math.abs(hw / Math.cos(a)), Math.abs(hh / Math.sin(a)));
        const ax = cx + Math.cos(a) * k;
        const ay = cy + Math.sin(a) * k;
        const s = 14;
        g.fillStyle(color, 0.95);
        g.fillTriangle(
          ax + Math.cos(a) * s,
          ay + Math.sin(a) * s,
          ax + Math.cos(a + 2.4) * s,
          ay + Math.sin(a + 2.4) * s,
          ax + Math.cos(a - 2.4) * s,
          ay + Math.sin(a - 2.4) * s,
        );
      }
    });
    for (const [id, label] of this.objLabels) {
      if (seen.has(id)) continue;
      label.destroy();
      this.objLabels.delete(id);
    }
    // Bounty: a red marker over the target when visible.
    if (state.mode === "bounty")
      state.players.forEach((p) => {
        if (p.role !== 1 || !p.alive) return;
        const y = p.y - 50;
        g.fillStyle(0xff4d4d, 0.95);
        g.fillTriangle(p.x - 9, y - 16, p.x + 9, y - 16, p.x, y);
        g.lineStyle(2, 0xff4d4d, 0.8);
        g.strokeCircle(p.x, p.y, 30);
      });
  }

  /**
   * Maze pieces drawn from their marks: closed gates (from the map's gate rects), keys on the floor
   * or carried, switches, floor traps (live: red). Returns true when the mark was drawn here.
   */
  private drawMazeMark(
    g: Phaser.GameObjects.Graphics,
    m: { k: string; x: number; y: number; r: number; p: number },
    id: string,
    maze: MazeDef,
    pulse: number,
  ): boolean {
    if (m.k === "trap") {
      const live = m.p >= 100;
      g.fillStyle(0xff3b30, live ? 0.32 + pulse * 0.18 : 0.06);
      g.fillRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
      g.lineStyle(live ? 3 : 2, 0xff5a52, live ? 0.95 : 0.35);
      g.strokeRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
      // Spikes: a grid of small triangles, raised when live.
      const n = 4;
      const step = (m.r * 2) / n;
      g.fillStyle(live ? 0xffd2cc : 0x5a2b28, live ? 0.9 : 0.6);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const cx = m.x - m.r + step * (i + 0.5);
          const cy = m.y - m.r + step * (j + 0.5);
          const h = live ? step * 0.32 : step * 0.14;
          g.fillTriangle(cx - h, cy + h, cx + h, cy + h, cx, cy - h);
        }
      return true;
    }
    if (m.k === "pit") {
      const q = maze.pits?.find((x) => x.id === id);
      if (!q) return true;
      g.fillStyle(0x050506, 0.95);
      g.fillRect(q.x, q.y, q.w, q.h);
      g.lineStyle(3, 0xffc53d, 0.8);
      g.strokeRect(q.x, q.y, q.w, q.h);
      return true;
    }
    if (m.k === "sweeper") {
      const q = maze.sweepers?.find((x) => x.id === id);
      const w = q?.w ?? 30;
      const h = q?.h ?? m.r * 2;
      g.fillStyle(0xff5a52, 0.9);
      g.fillRect(m.x - w / 2, m.y - h / 2, w, h);
      g.lineStyle(2, 0xffd2cc, 0.9);
      g.strokeRect(m.x - w / 2, m.y - h / 2, w, h);
      return true;
    }
    if (m.k === "terminal") {
      g.fillStyle(0x1b1d21, 1);
      g.fillRect(m.x - 26, m.y - 18, 52, 36);
      g.lineStyle(2, 0x7dffb0, 0.6 + pulse * 0.4);
      g.strokeRect(m.x - 26, m.y - 18, 52, 36);
      return true;
    }
    const gateId = id.replace(/-(key|switch|p\d|s\d)$/, "");
    const gate = maze.gates.find((x) => x.id === gateId);
    if (!gate) return false;
    if (m.k === "door") {
      g.fillStyle(gate.color, 0.85);
      g.fillRect(gate.x, gate.y, gate.w, gate.h);
      g.lineStyle(2, 0x111214, 0.9);
      const horizontal = gate.w > gate.h;
      for (let t = 10; t < (horizontal ? gate.w : gate.h); t += 18) {
        if (horizontal) g.lineBetween(gate.x + t, gate.y, gate.x + t - 8, gate.y + gate.h);
        else g.lineBetween(gate.x, gate.y + t, gate.x + gate.w, gate.y + t - 8);
      }
      g.lineStyle(3, gate.color, 1);
      g.strokeRect(gate.x, gate.y, gate.w, gate.h);
      return true;
    }
    if (m.k === "key") {
      const s = m.p >= 100 ? 0.7 : 1 + pulse * 0.12;
      if (m.p < 100) {
        g.fillStyle(gate.color, 0.12 + pulse * 0.1);
        g.fillCircle(m.x, m.y, m.r + 10);
      }
      g.lineStyle(4 * s, gate.color, 1);
      g.strokeCircle(m.x - 10 * s, m.y, 8 * s);
      g.lineBetween(m.x - 2 * s, m.y, m.x + 18 * s, m.y);
      g.lineBetween(m.x + 12 * s, m.y, m.x + 12 * s, m.y + 7 * s);
      g.lineBetween(m.x + 18 * s, m.y, m.x + 18 * s, m.y + 9 * s);
      return true;
    }
    if (m.k === "plate") {
      const on = m.p >= 100;
      g.fillStyle(gate.color, on ? 0.7 : 0.18);
      g.fillRect(m.x - 34, m.y - 34, 68, 68);
      g.lineStyle(3, gate.color, on ? 1 : 0.6);
      g.strokeRect(m.x - 34, m.y - 34, 68, 68);
      return true;
    }
    if (m.k === "switch") {
      g.fillStyle(0x1b1d21, 1);
      g.fillRect(m.x - 18, m.y - 18, 36, 36);
      g.lineStyle(3, gate.color, 0.6 + pulse * 0.4);
      g.strokeRect(m.x - 18, m.y - 18, 36, 36);
      g.lineStyle(5, gate.color, 1);
      g.lineBetween(m.x, m.y + 8, m.x + 10, m.y - 12);
      g.lineStyle(2, gate.color, 0.25);
      g.strokeCircle(m.x, m.y, m.r);
      return true;
    }
    return false;
  }

  /** "Hold E" prompt of the marker the local player stands in (Sabotage plant / defuse). */
  prompt(
    state: MatchState,
    selfId: string,
    local: { x: number; y: number } | null,
  ): { text: string; progress: number } | null {
    const me = state.players.get(selfId);
    if (!me?.alive || !local) return null;
    let out: { text: string; progress: number } | null = null;
    state.marks.forEach((m) => {
      if (out || !m.a || m.c !== me.team) return;
      if ((local.x - m.x) ** 2 + (local.y - m.y) ** 2 > m.r * m.r) return;
      out = { text: m.a, progress: m.p / 100 };
    });
    return out;
  }

  /** "!" over hiders who were just spotted (seekers' view). */
  private drawMarks(state: MatchState, selfId: string, _renderTick: number, now: number): void {
    const g = this.markGfx;
    g.clear();
    for (const [id, until] of this.spots) {
      if (now > until) {
        this.spots.delete(id);
        continue;
      }
      if (id === selfId) continue;
      const ps = state.players.get(id);
      const pose = ps ? this.pose(state, id, selfId) : null;
      if (!ps || !pose || pose.hidden) continue;
      const y = pose.y - 52;
      g.fillStyle(0xff4d4d, 0.95);
      g.fillTriangle(pose.x - 7, y - 18, pose.x + 7, y - 18, pose.x, y);
      g.fillCircle(pose.x, y + 6, 3);
    }
  }

  /** Blackout: darkness with the seekers' flashlights, from the same light map as co-op. */
  private updateDark(
    state: MatchState,
    selfId: string,
    local: { x: number; y: number; aim: number } | null,
    cam: Phaser.Cameras.Scene2D.Camera,
    map: MapDef,
    dtSec: number,
  ): void {
    const dark = (state.mode === "hideseek" || state.mode === "prophunt") && state.round.dark;
    if (dark !== this.darkOn) {
      this.darkOn = dark;
      this.lightmap.setActive(dark);
      if (dark) this.lightmap.setWorld(sightWorld(map.solids));
    }
    if (!dark) return;
    const role = this.myRole(state, selfId);
    const allies: { x: number; y: number; aim: number; downed: boolean }[] = [];
    state.players.forEach((p, id) => {
      if (id === selfId || p.role !== ROLE.SEEKER || !p.alive) return;
      allies.push({ x: p.x, y: p.y, aim: p.aim, downed: false });
    });
    const eye = local ?? { x: cam.midPoint.x, y: cam.midPoint.y };
    this.lightmap.update({
      cam,
      eye,
      me: role === ROLE.SEEKER && local ? { x: local.x, y: local.y, aim: local.aim, downed: false } : null,
      allies,
      headlights: [],
      lamps: [],
      brightness: 0.32,
      flicker: 1,
      danger: 0,
      dtSec,
    });
  }

  /** Mode events: feedback only (the state already holds the outcome). */
  onEvent(
    ev: NetEvent,
    state: MatchState,
    selfId: string,
    spatial: (x: number, y: number) => { distance: number; pan: number },
  ): void {
    switch (ev.t) {
      case "gg": {
        if (ev.p === selfId) {
          sfx.levelChange(!ev.d);
          const w = WEAPONS[gunGameWeapon(ev.l)];
          const last = ev.l >= GUN_GAME.ladder.length - 1;
          showBanner(
            ev.d ? `Back to level ${ev.l + 1}` : last ? "Final weapon" : `Level ${ev.l + 1}`,
            last ? `${w.name}: one more elimination wins` : w.name,
            ev.d ? "warn" : "good",
          );
        }
        break;
      }
      case "round": {
        const role = this.myRole(state, selfId);
        const name = roleName(state.mode, role);
        const text = roleText(state.mode);
        if (ev.s === "prep")
          showBanner(
            `Round ${ev.n}`,
            role === ROLE.SEEKER
              ? text.seekerPrep || `You are a ${name}`
              : role === ROLE.HIDER
                ? text.hiderPrep
                : "Spectating until the next round",
          );
        else if (ev.s === "hunt") showBanner(text.huntBanner, "", "warn");
        else if (ev.s === "break")
          showBanner(
            ev.w === ROLE.SEEKER ? text.seekerWin : text.hiderWin,
            "",
            ev.w === role ? "good" : "info",
          );
        break;
      }
      case "spot": {
        this.spots.set(ev.p, performance.now() + 1600);
        if (ev.p === selfId) {
          sfx.spotted(true);
          modeHudStore.patch({ spottedAt: performance.now() });
        } else sfx.spotted(false);
        break;
      }
      case "found": {
        const v = state.players.get(ev.p)?.name ?? "?";
        const by = state.players.get(ev.by)?.name ?? "";
        const infection = state.mode === "infection";
        if (ev.p === selfId)
          showBanner(infection ? "You were infected" : "You were found", by ? `by ${by}` : "", "warn");
        else if (infection) showToast(by ? `${by} infected ${v}` : `${v} was infected`);
        else showToast(by ? `${by} found ${v}` : `${v} is out`);
        break;
      }
      case "sonar": {
        const s = spatial(ev.x, ev.y);
        sfx.sonar(s.distance, s.pan);
        const ring = this.scene.add.circle(ev.x, ev.y, 10).setStrokeStyle(4, 0x6bd0ff, 0.9).setDepth(46);
        this.scene.tweens.add({
          targets: ring,
          radius: ev.r,
          alpha: 0,
          duration: 900,
          ease: "Cubic.easeOut",
          onComplete: () => ring.destroy(),
        });
        break;
      }
      case "poof": {
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const puff = this.scene.add
            .circle(ev.x, ev.y, 9 + (i % 3) * 3, 0xc9c2b4, 0.7)
            .setDepth(46)
            .setBlendMode(Phaser.BlendModes.NORMAL);
          this.scene.tweens.add({
            targets: puff,
            x: ev.x + Math.cos(a) * 34,
            y: ev.y + Math.sin(a) * 34,
            scale: 1.8,
            alpha: 0,
            duration: 650,
            ease: "Quad.easeOut",
            onComplete: () => puff.destroy(),
          });
        }
        break;
      }
      case "taunt": {
        const s = spatial(ev.x, ev.y);
        sfx.taunt(ev.v, s.distance, s.pan);
        const text = this.scene.add
          .text(ev.x, ev.y - 30, "♪", { ...LABEL_STYLE, fontSize: "22px", color: "#ffc53d" })
          .setOrigin(0.5)
          .setDepth(48);
        this.bubbles.push({ text, until: performance.now() + 1400 });
        break;
      }
      case "dhit":
        this.effects.impact(ev.x, ev.y, 0);
        break;
      case "penalty":
        if (ev.p === selfId) {
          modeHudStore.patch({ penaltyAt: performance.now() });
          showToast(`Innocent object: −${ev.dmg} health`);
        }
        break;
      case "hint":
        showToast(
          this.myRole(state, selfId) === ROLE.SEEKER
            ? "Hint: the props are somewhere in the highlighted areas"
            : "The hunters got a hint about your area",
        );
        break;
      case "msg":
        if (ev.p === selfId) showToast(ev.s);
        break;
      case "announce": {
        const mine = this.me(state, selfId)?.team ?? 0;
        showBanner(ev.s, ev.d ?? "", ev.w ? (ev.w === mine ? "good" : "warn") : "info");
        break;
      }
    }
  }

  private updateHud(state: MatchState, selfId: string, serverTick: number): void {
    const ps = this.me(state, selfId);
    const r = state.round;
    const role = ps?.role ?? 0;
    const tr = state.tickRate || 20;
    const ally = state.allies.get(selfId);
    const left = (tick: number) => Math.max(0, (tick - serverTick) / tr);
    let leader: { name: string; level: number; you: boolean } | null = null;
    if (state.mode === "gungame") {
      state.players.forEach((p, id) => {
        if (!leader || p.gg > leader.level) leader = { name: p.name, level: p.gg, you: id === selfId };
      });
    }
    const kinds =
      state.mode === "prophunt"
        ? DISGUISES.filter((d) => mapKinds(state.mapId).has(d.kind)).map((d) => ({
            index: d.index,
            name: d.name,
            kind: d.kind,
          }))
        : [];
    const prev = modeHudStore.get();
    modeHudStore.patch({
      mode: state.mode,
      ggLevel: ps?.gg ?? 0,
      ggLeader: leader,
      overtime: state.mode === "gungame" && r.stage === "overtime",
      role,
      stage: r.stage,
      stageLeftSec: r.end ? left(r.end) : 0,
      round: r.num,
      rounds: r.of,
      variant: r.variant,
      dark: r.dark,
      seekers: r.seekers,
      hiders: r.hiders,
      points: ps?.pts ?? 0,
      spectating: (() => {
        const id = this.spectateTarget(state, selfId);
        return id ? (state.players.get(id)?.name ?? null) : null;
      })(),
      disguise: ally && ally.k >= 0 ? (disguiseDef(ally.k)?.name ?? null) : null,
      locked: !!ally?.lk,
      transformInSec: ally ? left(ally.cdT) : 0,
      tauntInSec: ally ? left(ally.cdS) : 0,
      decoyInSec: ally ? left(ally.cdD) : 0,
      swapInSec: ally ? left(ally.cdW) : 0,
      abilityInSec: ps ? left(ps.abl) : 0,
      kinds: sameKinds(prev.kinds, kinds) ? prev.kinds : kinds,
      ...(role !== ROLE.HIDER || state.mode !== "prophunt" ? { pickerOpen: false } : {}),
    });
  }

  reset(): void {
    for (const img of this.sprites.values()) img.destroy();
    this.sprites.clear();
    for (const l of this.labels.values()) l.destroy();
    this.labels.clear();
    this.snaps.length = 0;
    this.spots.clear();
    this.pingGfx.clear();
    this.markGfx.clear();
    this.objGfx.clear();
    for (const l of this.objLabels.values()) l.destroy();
    this.objLabels.clear();
    if (this.darkOn) {
      this.darkOn = false;
      this.lightmap.setActive(false);
    }
    modeHudStore.patch({ pickerOpen: false, banner: null, toast: null, spectating: null });
  }
}

/** Kinds of objects present on a map (what a prop may become). */
const kindCache = new Map<string, Set<string>>();
function mapKinds(mapId: string): Set<string> {
  let k = kindCache.get(mapId);
  if (!k) {
    k = new Set((MAPS[mapId as keyof typeof MAPS]?.party?.props ?? []).map((p) => p.kind));
    kindCache.set(mapId, k);
  }
  return k;
}

function sameKinds(a: { index: number }[], b: { index: number }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.index === b[i]!.index);
}

/** Exposed for the HUD: the prop key reminders. */
export const PROP_KEYS_HELP = `Q choose · E copy · C lock · T taunt · G decoy (${PROP_HUNT.decoySec}s) · V swap with a nearby object`;
