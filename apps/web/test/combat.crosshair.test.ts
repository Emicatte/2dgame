import {
  createPlayerSim,
  currentSpreadDeg,
  fireIntervalSteps,
  PLAYER,
  type PlayerSim,
  secToSteps,
  WEAPONS,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import {
  CRIT_DAMAGE,
  type CrosshairFrame,
  type CrosshairLook,
  CrosshairModel,
  type CrosshairSink,
  classifyHit,
  crosshairFrame,
  crosshairGap,
  drawCrosshair,
  HIT_MS,
  KICK_MAX,
  KILL_RING_MS,
  lookFromSettings,
  MARKER_COLORS,
  MIN_GAP,
  parseHexColor,
  STATIC_GAP,
  screenSpaceTransform,
  trueSpreadGapPx,
} from "../src/game/combat/crosshairModel.ts";
import { CROSSHAIR_STYLES, type CrosshairStyle, DEFAULT_SETTINGS } from "../src/lib/settings.ts";

type Shape =
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; w: number; c: number; a: number }
  | { k: "ring"; x: number; y: number; r: number; w: number; c: number; a: number }
  | { k: "arc"; x: number; y: number; r: number; s: number; e: number; w: number; c: number; a: number }
  | { k: "dot"; x: number; y: number; r: number; c: number; a: number };

function record(): { sink: CrosshairSink; shapes: Shape[] } {
  const shapes: Shape[] = [];
  return {
    shapes,
    sink: {
      line: (x1, y1, x2, y2, w, c, a) => shapes.push({ k: "line", x1, y1, x2, y2, w, c, a }),
      ring: (x, y, r, w, c, a) => shapes.push({ k: "ring", x, y, r, w, c, a }),
      arc: (x, y, r, s, e, w, c, a) => shapes.push({ k: "arc", x, y, r, s, e, w, c, a }),
      dot: (x, y, r, c, a) => shapes.push({ k: "dot", x, y, r, c, a }),
    },
  };
}

const look = (over: Partial<CrosshairLook> = {}): CrosshairLook => ({
  ...lookFromSettings(DEFAULT_SETTINGS),
  outline: false,
  ...over,
});

const frame = (over: Partial<CrosshairFrame> = {}): CrosshairFrame => ({
  x: 400,
  y: 300,
  mode: "active",
  trueGapPx: 20,
  reload: null,
  cooldown: null,
  ...over,
});

const idle = { kick: 0, hit: null, hitLife: 0, killLife: 0 };

/** Smallest distance from the centre of any spread-carrying shape (excluding the centre dot). */
function innerRadius(shapes: Shape[], cx: number, cy: number): number {
  let r = Number.POSITIVE_INFINITY;
  for (const s of shapes) {
    if (s.k === "line") {
      r = Math.min(r, Math.hypot(s.x1 - cx, s.y1 - cy), Math.hypot(s.x2 - cx, s.y2 - cy));
    } else if (s.k === "ring" || s.k === "arc") {
      r = Math.min(r, s.r);
    }
  }
  return r;
}

function simAt(over: Partial<PlayerSim> = {}): PlayerSim {
  return Object.assign(createPlayerSim(100, 100, "rifle"), over);
}

describe("crosshair frame (from the predicted sim)", () => {
  const rifle = WEAPONS.rifle;
  const input = (sim: PlayerSim, seat: { canFire: boolean; inSector: boolean } | null = null) => ({
    screenX: 640,
    screenY: 360,
    worldX: sim.x + 400,
    worldY: sim.y,
    zoom: 0.8,
    sim,
    def: rifle,
    seat,
  });

  it("standing: gap is the base cone at the cursor distance", () => {
    const sim = simAt();
    const f = crosshairFrame(input(sim));
    expect(f.mode).toBe("active");
    expect(f.trueGapPx).toBeCloseTo(Math.tan((rifle.spreadDeg * Math.PI) / 180) * 400 * 0.8, 6);
    expect(f.x).toBe(640);
    expect(f.y).toBe(360);
  });

  it("moving and blooming widen the gap exactly like firing does", () => {
    const still = crosshairFrame(input(simAt()));
    const moving = simAt({ vx: PLAYER.maxSpeed, bloom: 2 });
    const f = crosshairFrame(input(moving));
    const expected = currentSpreadDeg(moving, rifle);
    expect(expected).toBeCloseTo(rifle.spreadDeg + 2 + rifle.movingSpreadDeg, 6);
    expect(f.trueGapPx).toBeCloseTo(trueSpreadGapPx(expected, 400, 0.8), 6);
    expect(f.trueGapPx).toBeGreaterThan(still.trueGapPx);
  });

  it("passenger seat: same spread as the shot (seated sims never move on their own)", () => {
    const sim = simAt({ bloom: 1 });
    const f = crosshairFrame(input(sim, { canFire: true, inSector: true }));
    expect(f.mode).toBe("active");
    expect(f.trueGapPx).toBeCloseTo(trueSpreadGapPx(rifle.spreadDeg + 1, 400, 0.8), 6);
    const out = crosshairFrame(input(sim, { canFire: true, inSector: false }));
    expect(out.mode).toBe("blocked");
  });

  it("drivers / pilots and empty hands get the neutral disabled state", () => {
    const sim = simAt();
    expect(crosshairFrame(input(sim, { canFire: false, inSector: true })).mode).toBe("disabled");
    expect(crosshairFrame({ ...input(sim), def: undefined }).mode).toBe("disabled");
    expect(crosshairFrame(input(sim, { canFire: false, inSector: true })).trueGapPx).toBe(0);
  });

  it("reload ring from the predicted timer, cooldown ring only for slow weapons", () => {
    const total = secToSteps(rifle.reloadSec);
    const f = crosshairFrame(input(simAt({ reload: Math.round(total / 4) })));
    expect(f.reload).toBeCloseTo(1 - Math.round(total / 4) / total, 6);
    expect(f.cooldown).toBeNull();
    expect(crosshairFrame(input(simAt({ cooldown: 2 }))).cooldown).toBeNull();
    const sniper = WEAPONS.sniper;
    const interval = fireIntervalSteps(sniper);
    const s = crosshairFrame({ ...input(simAt({ cooldown: interval / 2 })), def: sniper });
    expect(s.cooldown).toBeCloseTo(0.5, 6);
  });

  it("reuses the output object", () => {
    const out = {} as CrosshairFrame;
    expect(crosshairFrame(input(simAt()), out)).toBe(out);
  });
});

describe("crosshair truth: never smaller than the true cone", () => {
  for (const style of CROSSHAIR_STYLES) {
    it(`${style}: drawn spread >= true spread, kick only adds`, () => {
      for (const trueGapPx of [0, 3, 12, 60, 250]) {
        for (const kick of [0, 5, KICK_MAX]) {
          const f = frame({ trueGapPx });
          const l = look({ style });
          const { sink, shapes } = record();
          drawCrosshair(sink, l, f, { ...idle, kick });
          const gap = crosshairGap(l, f, { kick });
          expect(gap).toBeGreaterThanOrEqual(trueGapPx);
          expect(gap).toBeCloseTo(Math.max(trueGapPx, MIN_GAP * l.size) + kick, 9);
          if (style !== "dot") expect(innerRadius(shapes, f.x, f.y)).toBeGreaterThanOrEqual(trueGapPx - 1e-9);
          else if (gap > 6) {
            const ring = shapes.find((s) => s.k === "ring");
            expect(ring && ring.k === "ring" ? ring.r : 0).toBeGreaterThanOrEqual(trueGapPx);
          }
        }
      }
    });
  }

  it("dynamic spread off: fixed gap, no kick", () => {
    const l = look({ dynamicSpread: false, size: 1.5 });
    expect(crosshairGap(l, frame({ trueGapPx: 80 }), { kick: 10 })).toBe(STATIC_GAP * 1.5);
  });

  it("every shape is centred on the cursor", () => {
    for (const style of CROSSHAIR_STYLES) {
      const { sink, shapes } = record();
      drawCrosshair(sink, look({ style }), frame({ x: 123, y: 77 }), idle);
      for (const s of shapes) {
        if (s.k === "line") {
          // Arms are radial or axis-aligned around the centre.
          const onAxis = Math.abs(s.x1 - 123) < 1e-9 || Math.abs(s.y1 - 77) < 1e-9;
          expect(onAxis).toBe(true);
        } else {
          expect(s.x).toBe(123);
          expect(s.y).toBe(77);
        }
      }
    }
  });
});

describe("crosshair look", () => {
  it("outline pass draws dark, wider strokes first", () => {
    const { sink, shapes } = record();
    drawCrosshair(sink, look({ outline: true, style: "cross" }), frame(), idle);
    const half = shapes.length / 2;
    expect(Number.isInteger(half)).toBe(true);
    for (let i = 0; i < half; i++) {
      expect(shapes[i]!.c).toBe(0x0b0c0e);
      const a = shapes[i]!;
      const b = shapes[i + half]!;
      if (a.k === "line" && b.k === "line") expect(a.w).toBe(b.w + 2);
      if (a.k === "dot" && b.k === "dot") expect(a.r).toBe(b.r + 1);
    }
    const plain = record();
    drawCrosshair(plain.sink, look({ outline: false, style: "cross" }), frame(), idle);
    expect(plain.shapes.length).toBe(half);
  });

  it("colour, opacity, thickness and size settings reach the strokes", () => {
    const { sink, shapes } = record();
    drawCrosshair(sink, look({ color: 0x123456, opacity: 0.5, thickness: 3, size: 2 }), frame(), idle);
    const arms = shapes.filter((s) => s.k === "line");
    expect(arms).toHaveLength(4);
    for (const a of arms) {
      expect(a.c).toBe(0x123456);
      expect(a.a).toBe(0.5);
      expect(a.w).toBe(3);
      if (a.k === "line") expect(Math.hypot(a.x2 - a.x1, a.y2 - a.y1)).toBeCloseTo(14, 9);
    }
  });

  it("styles are distinct", () => {
    const sig = (style: CrosshairStyle) => {
      const { sink, shapes } = record();
      drawCrosshair(sink, look({ style }), frame(), idle);
      return shapes.map((s) => s.k).join(",");
    };
    const all = CROSSHAIR_STYLES.map(sig);
    expect(new Set(all).size).toBe(all.length);
    expect(sig("dot")).not.toContain("line");
    expect(sig("minimal")).not.toContain("dot");
  });

  it("disabled state is neutral grey with no spread; blocked is dimmed", () => {
    const d = record();
    drawCrosshair(d.sink, look(), frame({ mode: "disabled", trueGapPx: 90 }), idle);
    expect(d.shapes.every((s) => s.c === 0x8c877d)).toBe(true);
    expect(d.shapes.some((s) => s.k === "line")).toBe(false);
    const b = record();
    drawCrosshair(b.sink, look({ opacity: 1 }), frame({ mode: "blocked" }), idle);
    expect(b.shapes.every((s) => s.a <= 0.45 + 1e-9)).toBe(true);
  });

  it("reload ring shows progress from 12 o'clock", () => {
    const { sink, shapes } = record();
    drawCrosshair(sink, look(), frame({ reload: 0.25 }), idle);
    const arc = shapes.find((s) => s.k === "arc" && s.c === 0xffd27a);
    expect(arc).toBeDefined();
    if (arc?.k === "arc") {
      expect(arc.s).toBeCloseTo(-Math.PI / 2, 9);
      expect(arc.e - arc.s).toBeCloseTo(Math.PI / 2, 9);
    }
  });

  it("parses settings colours", () => {
    expect(parseHexColor("#7dffb0")).toBe(0x7dffb0);
    expect(parseHexColor("nope", 0x111111)).toBe(0x111111);
    expect(lookFromSettings({ ...DEFAULT_SETTINGS, crosshairColor: "#ff0000" }).color).toBe(0xff0000);
  });
});

describe("hit markers and kick", () => {
  it("classifies hits", () => {
    expect(classifyHit({ dmg: 20, lethal: false })).toBe("hit");
    expect(classifyHit({ dmg: CRIT_DAMAGE, lethal: false })).toBe("crit");
    expect(classifyHit({ dmg: 95, lethal: true })).toBe("kill");
    expect(classifyHit({ dmg: 5, lethal: false, armored: true })).toBe("armor");
    expect(classifyHit({ dmg: 5, lethal: false, weakSpot: true })).toBe("crit");
  });

  it("a kill is never hidden by a later plain hit, and has its own ring", () => {
    const m = new CrosshairModel();
    m.registerHit("kill");
    m.registerHit("hit");
    expect(m.hit).toBe("kill");
    expect(m.killLife).toBe(KILL_RING_MS);
    m.update(HIT_MS.kill + 1);
    expect(m.hit).toBeNull();
    expect(m.killLife).toBeGreaterThan(0);
    m.update(KILL_RING_MS);
    expect(m.killLife).toBe(0);
    m.registerHit("hit");
    m.registerHit("crit");
    expect(m.hit).toBe("crit");
  });

  it("each marker kind draws in its own colour", () => {
    for (const kind of ["hit", "crit", "kill", "armor"] as const) {
      const m = new CrosshairModel();
      m.registerHit(kind);
      const { sink, shapes } = record();
      drawCrosshair(sink, look(), frame(), m);
      expect(shapes.some((s) => s.c === MARKER_COLORS[kind])).toBe(true);
    }
    const m = new CrosshairModel();
    m.registerHit("kill");
    const { sink, shapes } = record();
    drawCrosshair(sink, look(), frame(), m);
    expect(shapes.some((s) => s.k === "ring" && s.c === MARKER_COLORS.kill)).toBe(true);
  });

  it("kick expands per shot, is capped and recovers", () => {
    const m = new CrosshairModel();
    m.onShot(6);
    expect(m.kick).toBe(6);
    for (let i = 0; i < 20; i++) m.onShot(6);
    expect(m.kick).toBe(KICK_MAX);
    m.update(90);
    expect(m.kick).toBeCloseTo(KICK_MAX / Math.E, 6);
    m.update(2000);
    expect(m.kick).toBe(0);
  });
});

describe("screen-space transform (camera zoom compensation)", () => {
  it("a point drawn at the cursor shows at the cursor under any zoom, at true pixel size", () => {
    for (const zoom of [0.5, 0.8, 1, 1.2, 2]) {
      const origin = { x: 640, y: 360 };
      const t = screenSpaceTransform(zoom, origin.x, origin.y);
      // Phaser: local -> object transform (position + scale) -> camera zoom about its origin.
      const show = (sx: number) => origin.x + (t.x + sx * t.scale - origin.x) * zoom;
      const showY = (sy: number) => origin.y + (t.y + sy * t.scale - origin.y) * zoom;
      expect(show(1040)).toBeCloseTo(1040, 9);
      expect(showY(180)).toBeCloseTo(180, 9);
      expect(show(1050) - show(1040)).toBeCloseTo(10, 9);
    }
  });
});
