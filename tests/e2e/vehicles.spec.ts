import { type Browser, expect, type Page, test } from "@playwright/test";
import { type Hooks, hooks, launch, onboard } from "./helpers.ts";

/**
 * Vehicles with two independent browsers on the real server (both clients predict, the server
 * decides everything):
 *  1. Car on Urban Warfare: A drives, B rides as a passenger and shoots out of the window while
 *     the car moves; the server records the damage on the target; both screens see the same
 *     vehicle, seats and damage; then B steps out and fights A on foot.
 *  2. Helicopter on Military Airbase: A pilots (take-off, flight, landing), B mans the chin gun
 *     and hits a ground target from the air; both screens see the altitude; B steps out after
 *     landing.
 */

type V = { kind: string; x: number; y: number; angle: number };

async function startRoom(a: Page, b: Page, map: string, spawns: { x: number; y: number }[], vehicles: V[]) {
  await a.evaluate(
    ([s, m, v]) =>
      (window as unknown as { __scrapline: Hooks }).__scrapline.createDebugRoom(
        s as { x: number; y: number }[],
        m as string,
        v as V[],
      ),
    [spawns, map, vehicles] as const,
  );
  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  await b.getByTestId("nav-rooms").click();
  await b.getByTestId("room-code-input").fill(code);
  const t0 = Date.now();
  await b.getByTestId("join-submit").click();
  await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 30_000 });
  console.log(`[vehicles] ${map}: join took ${Date.now() - t0} ms`);
  await b.getByTestId("ready-toggle").click();
  await expect(a.getByTestId("start-match")).toBeEnabled();
  await a.getByTestId("start-match").click();
  for (const p of [a, b]) {
    await p.waitForFunction(
      () => (window as unknown as { __scrapline: Hooks }).__scrapline.phase() === "playing",
      null,
      {
        timeout: 20_000,
      },
    );
  }
  const aId = (await hooks(a, (h) => h.selfId()))!;
  const bId = (await hooks(b, (h) => h.selfId()))!;
  return { aId, bId };
}

/** Holds a key for `ms`. */
async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** Presses E until the server seats (or unseats) the player as wanted. */
async function pressUntil(page: Page, key: string, done: () => Promise<boolean>, tries = 8) {
  for (let i = 0; i < tries; i++) {
    if (await done()) return true;
    await hold(page, key, 120);
    await page.waitForTimeout(250);
  }
  return done();
}

/** Screen position of a world point on that page (for aiming the mouse). */
async function screenOf(page: Page, x: number, y: number) {
  return page.evaluate(
    ([wx, wy]) => (window as unknown as { __scrapline: Hooks }).__scrapline.toScreen(wx!, wy!),
    [x, y],
  );
}

/** Moves the mouse onto the target vehicle (always "dbg-1" in these scenarios). */
async function aimAtTarget(page: Page) {
  const r = await hooks(page, (h) => h.renderedVehicle("dbg-1"));
  if (!r) return;
  const s = await screenOf(page, r.x, r.y);
  await page.mouse.move(s.x, s.y);
}

const vehicle = (page: Page, id: string) =>
  hooks(page, (h) => h.vehicles()).then((list) => list.find((v) => v.id === id)!);

async function closeAll(...browsers: Browser[]) {
  for (const b of browsers) await b.close();
}

test("car: driver + passenger shooting while moving, server-recorded damage, then a fight on foot", async ({
  baseURL,
}) => {
  const browserA = await launch();
  const browserB = await launch();
  try {
    const a = await browserA.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    const b = await browserB.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    await onboard(a, "Alpha");
    await onboard(b, "Bravo");
    // Car on the central avenue facing east; an APC as the target south-east of it.
    const { aId, bId } = await startRoom(
      a,
      b,
      "urban",
      [
        { x: 700, y: 1330 },
        { x: 700, y: 1230 },
      ],
      [
        { kind: "car", x: 700, y: 1280, angle: 0 },
        { kind: "armored", x: 1184, y: 1460, angle: Math.PI / 2 },
      ],
    );
    await a.waitForTimeout(400);

    // Both see the car ready and the prompt to enter it.
    await expect.poll(() => hooks(a, (h) => h.enterTarget())).toBe("dbg-0");
    await expect(a.getByTestId("interact-prompt")).toContainText("Enter Hatch");

    // A takes the wheel first, then B gets in: the next free seat (front passenger).
    expect(
      await pressUntil(a, "e", async () => (await hooks(a, (h) => h.mount()))?.vehicle === "dbg-0"),
    ).toBe(true);
    expect(
      await pressUntil(b, "e", async () => (await hooks(b, (h) => h.mount()))?.vehicle === "dbg-0"),
    ).toBe(true);
    expect(await hooks(a, (h) => h.mount())).toEqual({ vehicle: "dbg-0", seat: 0 });
    expect(await hooks(b, (h) => h.mount())).toEqual({ vehicle: "dbg-0", seat: 1 });
    // Seats as both screens see them (no seat is ever shared).
    for (const p of [a, b]) expect((await vehicle(p, "dbg-0")).seats.slice(0, 2)).toEqual([aId, bId]);
    await expect(a.getByTestId("vehicle-role")).toHaveText("Driver");
    await expect(b.getByTestId("vehicle-role")).toHaveText("Passenger");

    // Drive east while B fires through the right-hand window at the APC.
    const x0 = (await vehicle(a, "dbg-0")).x;
    const apcHp0 = (await vehicle(b, "dbg-1")).hp;
    await a.keyboard.down("w");
    const fire = (async () => {
      await aimAtTarget(b);
      await b.mouse.down();
      for (let i = 0; i < 12; i++) {
        await aimAtTarget(b);
        await b.waitForTimeout(80);
      }
      await b.mouse.up();
    })();
    // Under software rendering a frame can take long: drive until the car has really moved.
    await expect.poll(async () => (await vehicle(a, "dbg-0")).x, { timeout: 6000 }).toBeGreaterThan(x0 + 150);
    await fire;
    await a.keyboard.up("w");
    await hold(a, "s", 700);

    // The server recorded the damage: both screens show the APC below full health.
    await expect.poll(async () => (await vehicle(a, "dbg-1")).hp).toBeLessThan(apcHp0);
    await expect.poll(async () => (await vehicle(b, "dbg-1")).hp).toBeLessThan(apcHp0);

    // Both screens agree on where the car is (A predicts it, B interpolates it).
    await a.waitForTimeout(500);
    const ra = await hooks(a, (h) => h.renderedVehicle("dbg-0"));
    const rb = await hooks(b, (h) => h.renderedVehicle("dbg-0"));
    const server = await vehicle(a, "dbg-0");
    expect(Math.hypot(ra!.x - server.x, ra!.y - server.y)).toBeLessThan(40);
    expect(Math.hypot(rb!.x - server.x, rb!.y - server.y)).toBeLessThan(40);
    // B (exposed window seat) is drawn on the car on A's screen.
    const bOnA = await hooks(a, (h) => h.rendered(h.players().find((p) => p.id !== h.selfId())!.id));
    expect(bOnA?.visible).toBe(true);
    expect(Math.hypot(bOnA!.x - ra!.x, bOnA!.y - ra!.y)).toBeLessThan(40);

    // Out of the car: B steps out, then A; B fights A on foot.
    expect(await pressUntil(b, "e", async () => !(await hooks(b, (h) => h.mount()))?.vehicle)).toBe(true);
    expect(await pressUntil(a, "e", async () => !(await hooks(a, (h) => h.mount()))?.vehicle)).toBe(true);
    await expect(b.getByTestId("vehicle-panel")).toHaveCount(0);
    const deadline = Date.now() + 25_000;
    let hurt = false;
    while (Date.now() < deadline && !hurt) {
      const target = await b.evaluate((id) => {
        const h = (window as unknown as { __scrapline: Hooks }).__scrapline;
        const r = h.rendered(id);
        return r ? h.toScreen(r.x, r.y) : null;
      }, aId);
      if (target) await b.mouse.move(target.x, target.y);
      await b.mouse.down();
      await b.waitForTimeout(250);
      await b.mouse.up();
      hurt = (await hooks(a, (h) => h.players())).some((p) => p.id === aId && (p.hp < 100 || !p.alive));
    }
    expect(hurt).toBe(true);
    await expect
      .poll(async () => (await hooks(b, (h) => h.players())).find((p) => p.id === aId)!.hp)
      .toBeLessThan(100);
  } finally {
    await closeAll(browserA, browserB);
  }
});

test("helicopter: pilot takes off and lands, the gunner hits a ground target from the air", async ({
  baseURL,
}) => {
  const browserA = await launch();
  const browserB = await launch();
  try {
    const a = await browserA.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    const b = await browserB.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    await onboard(a, "Pilot");
    await onboard(b, "Gunner");
    await startRoom(
      a,
      b,
      "airbase",
      [
        { x: 700, y: 1076 },
        { x: 700, y: 972 },
      ],
      [
        { kind: "heli", x: 700, y: 1024, angle: 0 },
        { kind: "car", x: 1120, y: 1024, angle: Math.PI / 2 },
      ],
    );
    await a.waitForTimeout(400);
    expect(
      await pressUntil(a, "e", async () => (await hooks(a, (h) => h.mount()))?.vehicle === "dbg-0"),
    ).toBe(true);
    expect(
      await pressUntil(b, "e", async () => (await hooks(b, (h) => h.mount()))?.vehicle === "dbg-0"),
    ).toBe(true);
    expect(await hooks(a, (h) => h.mount())).toEqual({ vehicle: "dbg-0", seat: 0 });
    expect(await hooks(b, (h) => h.mount())).toEqual({ vehicle: "dbg-0", seat: 1 });
    await expect(a.getByTestId("vehicle-role")).toHaveText("Pilot");
    await expect(b.getByTestId("vehicle-role")).toHaveText("Gunner");
    await expect(b.getByTestId("hud")).toContainText("Kestrel chin gun");

    // Pilot keeps the nose on the target and takes off.
    await aimAtTarget(a);
    await hold(a, "Shift", 150);
    await expect.poll(async () => (await vehicle(a, "dbg-0")).alt, { timeout: 8000 }).toBeGreaterThan(0.95);
    await expect.poll(async () => (await vehicle(b, "dbg-0")).alt, { timeout: 4000 }).toBeGreaterThan(0.95);
    await expect(a.getByTestId("vehicle-alt")).toContainText("ALT 100");
    // The gunner cannot step out in the air.
    await hold(b, "e", 120);
    await b.waitForTimeout(400);
    expect((await hooks(b, (h) => h.mount()))?.vehicle).toBe("dbg-0");

    // Gunner fires the chin gun at the car on the runway.
    const hp0 = (await vehicle(a, "dbg-1")).hp;
    await aimAtTarget(b);
    await b.mouse.down();
    for (let i = 0; i < 10; i++) {
      await aimAtTarget(a);
      await aimAtTarget(b);
      await b.waitForTimeout(80);
    }
    await b.mouse.up();
    await expect.poll(async () => (await vehicle(a, "dbg-1")).hp).toBeLessThan(hp0);
    await expect.poll(async () => (await vehicle(b, "dbg-1")).hp).toBeLessThan(hp0);

    // Fly a little, then land; both screens see it touch down.
    await hold(a, "w", 500);
    await hold(a, "Shift", 150);
    await expect.poll(async () => (await vehicle(a, "dbg-0")).alt, { timeout: 8000 }).toBe(0);
    await expect.poll(async () => (await vehicle(b, "dbg-0")).alt, { timeout: 4000 }).toBe(0);
    await b.waitForTimeout(600);
    expect(await pressUntil(b, "e", async () => !(await hooks(b, (h) => h.mount()))?.vehicle)).toBe(true);
    await expect(b.getByTestId("vehicle-panel")).toHaveCount(0);
  } finally {
    await closeAll(browserA, browserB);
  }
});
