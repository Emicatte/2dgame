import { DROP, type MapDef, type MatchState } from "@scrapline/shared";
import type Phaser from "phaser";
import { createStore } from "../../lib/store.ts";

/** What the HUD minimap draws (Battle Royale), refreshed a few times a second. */
export interface BrMinimap {
  on: boolean;
  w: number;
  h: number;
  zone: { x: number; y: number; r: number };
  next: { x: number; y: number; r: number };
  me: { x: number; y: number } | null;
  bus: { x0: number; y0: number; x1: number; y1: number } | null;
  pois: { x: number; y: number; name: string }[];
}

export const brMinimapStore = createStore<BrMinimap>({
  on: false,
  w: 1,
  h: 1,
  zone: { x: 0, y: 0, r: 0 },
  next: { x: 0, y: 0, r: 0 },
  me: null,
  bus: null,
  pois: [],
});

/** What a player view exposes to the layer (its root container). */
interface ViewLike {
  root: Phaser.GameObjects.Container;
}

const STORM = 0x7a3cff;

/**
 * Battle Royale on the client: the bus on its line, the storm (outside darkened and tinted, the
 * edge animated, the next circle outlined), district names, and players in the air (bigger, a
 * shadow on the ground, the canopy once the parachute is open). Everything comes from the synced
 * state (BrState, PlayerState.alt / chute), the local player's altitude from the prediction.
 */
export class BrLayer {
  private readonly storm: Phaser.GameObjects.Graphics;
  private readonly air: Phaser.GameObjects.Graphics;
  private readonly busGfx: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private labelsFor = "";
  private scaled = new Set<string>();
  private miniAt = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.storm = scene.add.graphics().setDepth(44);
    this.air = scene.add.graphics().setDepth(49);
    this.busGfx = scene.add.graphics().setDepth(50);
  }

  /** Altitude of the local player (prediction) for the camera: 0..1. */
  static altFrac(alt: number): number {
    return Math.max(0, Math.min(1, alt / DROP.startAlt));
  }

  update(
    state: MatchState,
    map: MapDef,
    views: ReadonlyMap<string, ViewLike>,
    selfId: string,
    localAlt: number,
    tickF: number,
  ): void {
    const on = state.mode === "battleroyale";
    this.storm.clear();
    this.air.clear();
    this.busGfx.clear();
    this.setLabels(on ? map : null);
    if (!on) {
      for (const id of this.scaled) views.get(id)?.root.setScale(1);
      this.scaled.clear();
      if (brMinimapStore.get().on) brMinimapStore.patch({ on: false });
      return;
    }
    const br = state.br;
    const now = performance.now();
    if (now - this.miniAt > 150) {
      this.miniAt = now;
      const me = views.get(selfId)?.root;
      brMinimapStore.set({
        on: true,
        w: map.width,
        h: map.height,
        zone: { x: br.cx, y: br.cy, r: br.r },
        next: { x: br.ncx, y: br.ncy, r: br.nr },
        me: me ? { x: me.x, y: me.y } : null,
        bus: br.busEnd > 0 ? { x0: br.bx0, y0: br.by0, x1: br.bx1, y1: br.by1 } : null,
        pois: (map.pois ?? []).map((p) => ({ x: p.x, y: p.y, name: p.name })),
      });
    }
    const t = performance.now() / 1000;

    // Storm: a wide ring whose inner edge is the safe circle darkens and tints everything outside.
    if (br.r > 0 || br.phase > 0) {
      const r = br.r;
      this.storm.lineStyle(9000, STORM, 0.28);
      this.storm.strokeCircle(br.cx, br.cy, r + 4500);
      this.storm.lineStyle(6, 0xc9a7ff, 0.75 + 0.25 * Math.sin(t * 4));
      this.storm.strokeCircle(br.cx, br.cy, r);
      if (br.nr > 0 && (br.ncx !== br.cx || br.ncy !== br.cy || br.nr !== br.r)) {
        this.storm.lineStyle(3, 0xffffff, 0.55);
        this.storm.strokeCircle(br.ncx, br.ncy, br.nr);
      }
    }

    // Bus: the line and the bus on it while anyone is aboard.
    if (br.busEnd > 0) {
      const k = Math.max(0, Math.min(1, (tickF - br.busStart) / Math.max(1, br.busEnd - br.busStart)));
      const x = br.bx0 + (br.bx1 - br.bx0) * k;
      const y = br.by0 + (br.by1 - br.by0) * k;
      const a = Math.atan2(br.by1 - br.by0, br.bx1 - br.bx0);
      this.busGfx.lineStyle(4, 0xffffff, 0.25);
      this.busGfx.lineBetween(br.bx0, br.by0, br.bx1, br.by1);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const pt = (u: number, v: number) => ({ x: x + c * u - s * v, y: y + s * u + c * v });
      const body = [pt(-90, -34), pt(90, -34), pt(110, 0), pt(90, 34), pt(-90, 34)];
      this.busGfx.fillStyle(0x000000, 0.25);
      this.busGfx.fillPoints(body.map((p) => ({ x: p.x + 60, y: p.y + 80 })) as Phaser.Math.Vector2[], true);
      this.busGfx.fillStyle(0xff7a2e, 1);
      this.busGfx.fillPoints(body as Phaser.Math.Vector2[], true);
      this.busGfx.fillStyle(0x1a0d04, 0.8);
      for (let i = -2; i <= 2; i++) {
        const w = pt(i * 32, -22);
        this.busGfx.fillRect(w.x - 8, w.y - 6, 16, 12);
      }
      // Rotors spinning on top.
      for (const u of [-55, 55]) {
        const h = pt(u, 0);
        this.busGfx.lineStyle(3, 0xece8e0, 0.8);
        const ra = t * 18;
        this.busGfx.lineBetween(
          h.x - Math.cos(ra) * 48,
          h.y - Math.sin(ra) * 48,
          h.x + Math.cos(ra) * 48,
          h.y + Math.sin(ra) * 48,
        );
      }
    }

    // Players in the air.
    state.players.forEach((ps, id) => {
      const view = views.get(id);
      if (!view) return;
      const alt = id === selfId ? localAlt : ps.alt;
      const riding = ps.frozen && alt > 0;
      if (riding) {
        view.root.setVisible(false);
        return;
      }
      if (!view.root.visible && ps.alive) view.root.setVisible(true);
      if (alt <= 0) {
        if (this.scaled.delete(id)) view.root.setScale(1);
        return;
      }
      const f = BrLayer.altFrac(alt);
      view.root.setScale(1 + f * 0.8);
      this.scaled.add(id);
      const gx = view.root.x + f * 40;
      const gy = view.root.y + f * 70;
      this.air.fillStyle(0x000000, 0.35 - f * 0.15);
      this.air.fillEllipse(gx, gy, 34 - f * 10, 20 - f * 6);
      if (ps.chute || (id === selfId && alt <= DROP.autoChuteAlt)) {
        const cx = view.root.x;
        const cy = view.root.y - 46 - f * 20;
        this.air.fillStyle(0xff7a2e, 0.95);
        this.air.slice(cx, cy + 24, 52 + f * 20, Math.PI, 0, false);
        this.air.fillPath();
        this.air.lineStyle(1.5, 0xece8e0, 0.7);
        this.air.lineBetween(cx - 46, cy + 24, cx, view.root.y);
        this.air.lineBetween(cx + 46, cy + 24, cx, view.root.y);
      }
    });
  }

  /** District names, painted once per map. */
  private setLabels(map: MapDef | null): void {
    const key = map?.pois ? map.id : "";
    if (key === this.labelsFor) return;
    for (const l of this.labels) l.destroy();
    this.labels = [];
    this.labelsFor = key;
    for (const p of map?.pois ?? [])
      this.labels.push(
        this.scene.add
          .text(p.x, p.y, p.name.toUpperCase(), {
            fontFamily: "Chakra Petch, sans-serif",
            fontSize: "44px",
            fontStyle: "700",
            color: "#ece8e0",
          })
          .setOrigin(0.5)
          .setAlpha(0.22)
          .setDepth(43),
      );
  }
}
