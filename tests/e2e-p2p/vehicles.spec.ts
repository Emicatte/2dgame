import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Vehicles in host mode (the arena runs in A's tab, B connects over a real WebRTC DataChannel):
 * the guest drives (its vehicle prediction is reconciled against the host over the network), the
 * host rides as a passenger and shoots out of the window while the car moves; the damage is
 * recorded by the host's simulation and both screens agree; then both fight on foot.
 */

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

interface Hooks {
  selfId(): string | null;
  phase(): string | null;
  players(): { id: string; x: number; y: number; alive: boolean; hp: number }[];
  rendered(id: string): { x: number; y: number; visible: boolean } | null;
  toScreen(x: number, y: number): { x: number; y: number };
  createDebugRoom(
    spawns: { x: number; y: number }[],
    map?: string,
    vehicles?: { kind: string; x: number; y: number; angle: number }[],
  ): Promise<void>;
  vehicles(): { id: string; x: number; y: number; hp: number; seats: string[] }[];
  mount(): { vehicle: string; seat: number } | null;
  renderedVehicle(id: string): { x: number; y: number } | null;
  net(): { corrections: number; snaps: number; correctionMax: number; fps: number };
}

const hooks = <T>(page: Page, fn: (h: Hooks) => T) =>
  page.evaluate((src) => {
    const h = (window as unknown as { __scrapline: unknown }).__scrapline;
    return new Function("h", `return (${src})(h);`)(h);
  }, fn.toString()) as Promise<T>;

async function onboard(page: Page, name: string) {
  await page.goto("/");
  await page.fill("#nick", name);
  await page.click("button[type=submit]");
  await expect(page.getByTestId("hero-play")).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(() => !!(window as unknown as { __scrapline?: unknown }).__scrapline);
}

async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function pressUntil(page: Page, done: () => Promise<boolean>, tries = 10) {
  for (let i = 0; i < tries; i++) {
    if (await done()) return true;
    await hold(page, "e", 120);
    await page.waitForTimeout(300);
  }
  return done();
}

const vehicle = (page: Page, id: string) =>
  hooks(page, (h) => h.vehicles()).then((list) => list.find((v) => v.id === id)!);

async function aimAtTarget(page: Page) {
  const r = await hooks(page, (h) => h.renderedVehicle("dbg-1"));
  if (!r) return;
  const s = await page.evaluate(
    ([x, y]) => (window as unknown as { __scrapline: Hooks }).__scrapline.toScreen(x!, y!),
    [r.x, r.y],
  );
  await page.mouse.move(s.x, s.y);
}

let browsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of browsers) await b.close();
  browsers = [];
});

test("host mode: the guest drives, the host rides and shoots while moving, then both fight on foot", async () => {
  browsers = await Promise.all(
    [0, 1].map(() => chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })),
  );
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const b = await (await browsers[1]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  for (const p of [a, b]) p.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await onboard(a, "Host");
  await onboard(b, "Guest");

  await a.evaluate(() =>
    (window as unknown as { __scrapline: Hooks }).__scrapline.createDebugRoom(
      [
        { x: 700, y: 1330 },
        { x: 700, y: 1230 },
      ],
      "urban",
      [
        { kind: "car", x: 700, y: 1280, angle: 0 },
        { kind: "armored", x: 1184, y: 1460, angle: Math.PI / 2 },
      ],
    ),
  );
  await expect(a.getByTestId("host-hint")).toBeVisible({ timeout: 20_000 });
  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  await b.goto(`/?join=${code}`);
  await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 45_000 });
  // The ready toggle can be clicked while the guest's lobby is still settling over WebRTC: retry
  // until the host sees it.
  await expect(async () => {
    if (!(await a.getByTestId("start-match").isEnabled())) await b.getByTestId("ready-toggle").click();
    await expect(a.getByTestId("start-match")).toBeEnabled({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await a.getByTestId("start-match").click();
  for (const p of [a, b]) {
    await p.waitForFunction(
      () => (window as unknown as { __scrapline: Hooks }).__scrapline.phase() === "playing",
      null,
      {
        timeout: 25_000,
      },
    );
  }
  const aId = (await hooks(a, (h) => h.selfId()))!;
  const bId = (await hooks(b, (h) => h.selfId()))!;
  await a.waitForTimeout(500);

  // The guest takes the wheel, the host gets in as passenger.
  expect(await pressUntil(b, async () => (await hooks(b, (h) => h.mount()))?.vehicle === "dbg-0")).toBe(true);
  expect(await pressUntil(a, async () => (await hooks(a, (h) => h.mount()))?.vehicle === "dbg-0")).toBe(true);
  expect(await hooks(b, (h) => h.mount())).toEqual({ vehicle: "dbg-0", seat: 0 });
  expect(await hooks(a, (h) => h.mount())).toEqual({ vehicle: "dbg-0", seat: 1 });
  for (const p of [a, b]) expect((await vehicle(p, "dbg-0")).seats.slice(0, 2)).toEqual([bId, aId]);

  const x0 = (await vehicle(a, "dbg-0")).x;
  const hp0 = (await vehicle(a, "dbg-1")).hp;
  await b.keyboard.down("w");
  const fire = (async () => {
    await aimAtTarget(a);
    await a.mouse.down();
    for (let i = 0; i < 14; i++) {
      await aimAtTarget(a);
      await a.waitForTimeout(80);
    }
    await a.mouse.up();
  })();
  await expect.poll(async () => (await vehicle(a, "dbg-0")).x, { timeout: 8000 }).toBeGreaterThan(x0 + 150);
  await fire;
  await b.keyboard.up("w");
  await hold(b, "s", 700);
  await expect.poll(async () => (await vehicle(a, "dbg-1")).hp).toBeLessThan(hp0);
  await expect.poll(async () => (await vehicle(b, "dbg-1")).hp).toBeLessThan(hp0);

  // The guest's predicted car matches the host's authoritative one once it has stopped.
  await b.waitForTimeout(800);
  const host = await vehicle(a, "dbg-0");
  const guestView = await hooks(b, (h) => h.renderedVehicle("dbg-0"));
  expect(Math.hypot(guestView!.x - host.x, guestView!.y - host.y)).toBeLessThan(30);
  const net = await hooks(b, (h) => h.net());
  console.log(
    `[p2p vehicles] guest driver corrections ${net.corrections}, max ${net.correctionMax}px, snaps ${net.snaps}, fps ${net.fps}`,
  );

  // Out, and a fight on foot: the host shoots the guest.
  expect(await pressUntil(a, async () => !(await hooks(a, (h) => h.mount()))?.vehicle)).toBe(true);
  expect(await pressUntil(b, async () => !(await hooks(b, (h) => h.mount()))?.vehicle)).toBe(true);
  // At software-rendering frame rates the burst from the window lasts long enough to empty the
  // rifle and its reserve (seen as 0 / 0 in the HUD): fight with the sidearm, whose reserve is
  // infinite, so this step measures the fight and not the ammo left over from the ride.
  await a.keyboard.press("2");
  // Driver and passenger leave the car on opposite sides, so the car stands between them and
  // takes every shot: both step out of its shadow, same direction, same time.
  await Promise.all([hold(a, "d", 900), hold(b, "d", 900)]);
  const car = await vehicle(a, "dbg-0");
  const [ha, hb] = await Promise.all([
    hooks(a, (h) => h.players()).then((l) => l.find((p) => p.id !== bId)!),
    hooks(a, (h) => h.players()).then((l) => l.find((p) => p.id === bId)!),
  ]);
  console.log(
    `[p2p vehicles] on foot: host ${ha.x.toFixed(0)},${ha.y.toFixed(0)} guest ${hb.x.toFixed(0)},${hb.y.toFixed(0)} car ${car.x.toFixed(0)},${car.y.toFixed(0)}`,
  );
  const deadline = Date.now() + 25_000;
  let hurt = false;
  while (Date.now() < deadline && !hurt) {
    const t = await a.evaluate((id) => {
      const h = (window as unknown as { __scrapline: Hooks }).__scrapline;
      const r = h.rendered(id);
      return r ? h.toScreen(r.x, r.y) : null;
    }, bId);
    if (t) await a.mouse.move(t.x, t.y);
    await a.mouse.down();
    await a.waitForTimeout(250);
    await a.mouse.up();
    hurt = (await hooks(b, (h) => h.players())).some((p) => p.id === bId && (p.hp < 100 || !p.alive));
  }
  expect(hurt).toBe(true);
});
