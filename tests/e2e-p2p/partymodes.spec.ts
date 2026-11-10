import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Party modes end to end in host mode (what production runs): two separate Chrome processes, real
 * WebRTC between them. Checks what each browser actually received, not just what it draws.
 */

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

interface ModeInfo {
  mode: string;
  stage: string;
  round: number;
  dark: boolean;
  allies: string[];
  ally: { x: number; y: number; d: string; k: number; lk: boolean } | null;
  disguises: number;
  pings: number;
  players: { id: string; role: number; masked: boolean; x: number; y: number; gg: number; pts: number }[];
  body: { radius: number; speed: number } | null;
  objects: { id: string; x: number; y: number; k: number }[];
  abl: number;
  tick: number;
}

interface Hooks {
  selfId(): string | null;
  phase(): string | null;
  rendered(id: string): { x: number; y: number; visible: boolean } | null;
  mode(): ModeInfo | null;
  partyDebug(op: string, a?: string, b?: string, x?: number, y?: number): boolean;
}

const hooks = <T>(page: Page, fn: (h: Hooks) => T) =>
  page.evaluate((src) => {
    const h = (window as unknown as { __scrapline: unknown }).__scrapline;
    return new Function("h", `return (${src})(h);`)(h);
  }, fn.toString()) as Promise<T>;

const SHOTS = process.env.E2E_SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function onboard(page: Page, name: string) {
  await page.goto("/");
  await page.fill("#nick", name);
  await page.click("button[type=submit]");
  await expect(page.getByTestId("hero-play")).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(() => !!(window as unknown as { __scrapline?: unknown }).__scrapline);
}

const phaseIs = (page: Page, phase: string, timeout = 30_000) =>
  page.waitForFunction(
    (p) => (window as unknown as { __scrapline?: Hooks }).__scrapline?.phase() === p,
    phase,
    { timeout },
  );

const stageIs = (page: Page, stage: string, timeout = 60_000) =>
  page.waitForFunction(
    (s) => (window as unknown as { __scrapline?: Hooks }).__scrapline?.mode()?.stage === s,
    stage,
    { timeout },
  );

let browsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of browsers) await b.close();
  browsers = [];
});

async function twoPlayers() {
  browsers = await Promise.all(
    [0, 1].map(() => chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })),
  );
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const b = await (await browsers[1]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  for (const p of [a, b]) p.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await onboard(a, "Alpha");
  await onboard(b, "Bravo");
  return { a, b };
}

/** A picks the experience in Discover and creates an arena already set to `mode`; B joins with the code. */
async function arenaFor(a: Page, b: Page, mode: string) {
  await a.getByTestId("nav-discover").click();
  await a.getByTestId("discover-all").click();
  await a.getByTestId(`xp-${mode}`).click();
  await a.getByTestId("xp-create").click();
  await expect(a.getByTestId("host-hint")).toBeVisible({ timeout: 15_000 });
  await expect(a.getByTestId(`mode-${mode}`)).toHaveAttribute("aria-pressed", "true");
  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  await b.goto(`/?join=${code}`);
  await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 45_000 });
  const aId = (await hooks(a, (h) => h.selfId()))!;
  const bId = (await hooks(b, (h) => h.selfId()))!;
  return { aId, bId };
}

async function startMatch(a: Page, b: Page) {
  await b.getByTestId("ready-toggle").click();
  await expect(a.getByTestId("start-match")).toBeEnabled();
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing");
  await phaseIs(b, "playing");
}

test("Discover: categories by keyboard, party modes playable; Gun Game ladder over WebRTC", async () => {
  const { a, b } = await twoPlayers();
  await a.getByTestId("nav-discover").click();
  // Keyboard navigation between categories: All → Action → Survival → Horror → Party.
  await a.getByTestId("discover-all").focus();
  for (let i = 0; i < 4; i++) await a.keyboard.press("ArrowRight");
  await expect(a.getByTestId("discover-party")).toHaveAttribute("aria-selected", "true");
  await expect(a.getByTestId("xp-prophunt")).toBeVisible();
  await expect(a.getByTestId("xp-deathmatch")).toHaveCount(0);
  // Party modes are playable: their card opens with a working create button.
  await a.getByTestId("xp-prophunt").click();
  await expect(a.getByTestId("xp-create")).toBeEnabled();
  await shot(a, "discover-party");
  await a.keyboard.press("Escape");
  await expect(a.getByTestId("xp-dialog")).toHaveCount(0);
  await a.getByTestId("nav-play").click();

  const { aId, bId } = await arenaFor(a, b, "gungame");
  await startMatch(a, b);
  await expect(a.getByTestId("gungame-hud")).toBeVisible();
  await expect(b.getByTestId("gg-level")).toContainText("Level 1/6");
  // The host credits A with an elimination: A moves to the SMG, B's client sees A's level.
  expect(
    await a.evaluate(
      ({ v, k }) => (window as unknown as { __scrapline: Hooks }).__scrapline.partyDebug("eliminate", v, k),
      { v: bId, k: aId },
    ),
  ).toBe(true);
  await expect(a.getByTestId("gg-level")).toContainText("Level 2/6", { timeout: 5000 });
  await a.waitForFunction(
    (id) =>
      (window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.players.find((p) => p.id === id)
        ?.gg === 1,
    aId,
  );
  await b.waitForFunction(
    (id) =>
      (window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.players.find((p) => p.id === id)
        ?.gg === 1,
    aId,
  );
  await shot(a, "gungame-level2");
});

test("Hide & Seek: the seeking guest's browser never receives the hidden host's position", async () => {
  const { a, b } = await twoPlayers();
  const { aId, bId } = await arenaFor(a, b, "hideseek");
  // Seekers rotate in join order: make the guest seek first.
  expect(
    await hooks(a, (h) =>
      h.partyDebug("first", (h.mode()?.players ?? []).find((p) => p.id !== h.selfId())!.id),
    ),
  ).toBe(true);
  await startMatch(a, b);
  await stageIs(b, "prep");
  await expect(b.getByTestId("blindfold")).toBeVisible();
  await expect(a.getByTestId("role-chip")).toContainText("Hider");
  const seen = new Set<string>();
  // The host walks around while hiding.
  await a.keyboard.down("KeyW");
  for (let i = 0; i < 10; i++) {
    await b.waitForTimeout(150);
    const info = (await hooks(b, (h) => h.mode()))!;
    const host = info.players.find((p) => p.id === aId)!;
    expect(host.masked).toBe(true);
    expect(info.allies).toEqual([]);
    seen.add(`${Math.round(host.x)},${Math.round(host.y)}`);
    expect(
      (await hooks(b, (h) => h.rendered(h.mode()!.players.find((p) => p.role === 2)!.id)))?.visible,
    ).toBe(false);
  }
  await a.keyboard.up("KeyW");
  expect(seen.size).toBe(1);
  // The host's own ghost exists only on the host side.
  expect((await hooks(a, (h) => h.mode()))!.allies).toContain(aId);
  await shot(b, "hideseek-blindfold");

  await stageIs(b, "hunt", 45_000);
  await expect(b.getByTestId("blindfold")).toHaveCount(0);
  // Put the hider in plain view of the seeker: now the seeker's browser receives the pose.
  const seeker = (await hooks(a, (h) => h.mode()))!.players.find((p) => p.id === bId)!;
  await a.evaluate(
    ({ id, x, y }) =>
      (window as unknown as { __scrapline: Hooks }).__scrapline.partyDebug("teleport", id, "", x, y),
    // Inside the security booth with the seeker: nothing in between.
    { id: aId, x: Math.min(2200, seeker.x + 80), y: seeker.y },
  );
  await b.waitForFunction(
    (id) => {
      const h = (window as unknown as { __scrapline: Hooks }).__scrapline;
      return h.mode()?.players.find((p) => p.id === id)?.masked === false && h.rendered(id)?.visible === true;
    },
    aId,
    { timeout: 5000 },
  );
  await shot(b, "hideseek-spotted");
});

test("Prop Hunt: the prop transforms (Q), hunters get the objects only when the hunt starts", async () => {
  const { a, b } = await twoPlayers();
  const { aId } = await arenaFor(a, b, "prophunt");
  expect(
    await hooks(a, (h) =>
      h.partyDebug("first", (h.mode()?.players ?? []).find((p) => p.id !== h.selfId())!.id),
    ),
  ).toBe(true);
  await startMatch(a, b);
  await stageIs(a, "prep");
  await expect(a.getByTestId("role-chip")).toContainText("Prop");
  await expect(b.getByTestId("role-chip")).toContainText("Hunter");
  await expect(b.getByTestId("blindfold")).toBeVisible();
  // Transform through the picker.
  await a.keyboard.press("KeyQ");
  await expect(a.getByTestId("prop-picker")).toBeVisible();
  await a.getByTestId("prop-kind-barrel").click();
  await a.waitForFunction(
    () => (window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.body?.radius === 18,
    null,
    {
      timeout: 5000,
    },
  );
  const propInfo = (await hooks(a, (h) => h.mode()))!;
  expect(propInfo.ally?.k).toBeGreaterThanOrEqual(0);
  expect(propInfo.disguises).toBeGreaterThan(30);
  // The hunter's browser has received no object at all during the hiding time.
  expect((await hooks(b, (h) => h.mode()))!.disguises).toBe(0);
  await shot(a, "prophunt-disguised");

  await stageIs(b, "hunt", 45_000);
  await b.waitForFunction(
    () => ((window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.disguises ?? 0) > 30,
    null,
    {
      timeout: 5000,
    },
  );
  const hunter = (await hooks(b, (h) => h.mode()))!;
  expect(hunter.allies).toEqual([]);
  // The prop's person is never drawn on the hunter's screen.
  expect((await hooks(b, (h) => h.rendered(h.mode()!.players.find((p) => p.role === 2)!.id)))?.visible).toBe(
    false,
  );
  // Lock: the prop's own client stops moving.
  await a.keyboard.press("KeyC");
  await a.waitForFunction(
    () => (window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.ally?.lk === true,
  );
  const before = (await hooks(a, (h) => h.mode()))!.ally!;
  await a.keyboard.down("KeyD");
  await a.waitForTimeout(700);
  await a.keyboard.up("KeyD");
  await a.waitForTimeout(300);
  const after = (await hooks(a, (h) => h.mode()))!.ally!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  await shot(b, "prophunt-hunter");
  expect(aId).toBeTruthy();
});

test("Prop Hunt 0.8.1: 18 objects in the picker, swap (V) to a nearby object, the hunter's sonar (G)", async () => {
  const { a, b } = await twoPlayers();
  await arenaFor(a, b, "prophunt");
  expect(
    await hooks(a, (h) =>
      h.partyDebug("first", (h.mode()?.players ?? []).find((p) => p.id !== h.selfId())!.id),
    ),
  ).toBe(true);
  await startMatch(a, b);
  await stageIs(a, "prep");
  await a.keyboard.press("KeyQ");
  await expect(a.locator('[data-testid^="prop-kind-"]')).toHaveCount(18);
  await shot(a, "prophunt-picker-18");
  await a.keyboard.press("KeyQ");
  await stageIs(b, "hunt", 45_000);
  // Stand on a hiding spawn of Salvage Depot, then swap with the nearest object (within 280 px).
  const aId = (await hooks(a, (h) => h.selfId()))!;
  await hooks(a, (h) => h.partyDebug("teleport", h.selfId()!, "", 800, 640));
  await a.waitForTimeout(600);
  const before = (await hooks(a, (h) => h.mode()))!;
  const near = before.objects
    .filter((o) => o.id !== before.ally?.d)
    .map((o) => ({ ...o, d: Math.hypot(o.x - 800, o.y - 640) }))
    .sort((x, y) => x.d - y.d)[0]!;
  expect(near.d).toBeLessThan(280);
  await expect(a.getByTestId("ability-swap")).toContainText("ready");
  await a.keyboard.press("KeyV");
  await a.waitForFunction(
    (id) => (window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.ally?.d === id,
    near.id,
    { timeout: 5000 },
  );
  await expect(a.getByTestId("ability-swap")).not.toContainText("ready", { timeout: 3000 });
  expect(aId).toBeTruthy();
  // The hunter: G fires the sonar, the bar shows it recharging.
  await expect(b.getByTestId("role-ability")).toContainText("Sonar");
  await b.keyboard.press("KeyG");
  await b.waitForFunction(
    () => {
      const m = (window as unknown as { __scrapline: Hooks }).__scrapline.mode();
      return !!m && m.abl > m.tick;
    },
    null,
    { timeout: 5000 },
  );
  await expect(b.getByTestId("role-ability")).not.toContainText("ready", { timeout: 3000 });
  await shot(b, "prophunt-sonar");
});

test("Hide & Seek 0.8.1: seekers get the sonar, hiders the noise decoy (G)", async () => {
  const { a, b } = await twoPlayers();
  await arenaFor(a, b, "hideseek");
  expect(
    await hooks(a, (h) =>
      h.partyDebug("first", (h.mode()?.players ?? []).find((p) => p.id !== h.selfId())!.id),
    ),
  ).toBe(true);
  await startMatch(a, b);
  await stageIs(b, "hunt", 45_000);
  await expect(b.getByTestId("role-ability")).toContainText("Sonar");
  await expect(a.getByTestId("role-ability")).toContainText("Noise decoy");
  // The hider throws a noise: a ping appears on the seeker's screen.
  await a.mouse.move(900, 360);
  await a.keyboard.press("KeyG");
  await b.waitForFunction(
    () => ((window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.pings ?? 0) > 0,
    null,
    { timeout: 5000 },
  );
  await shot(b, "hideseek-noise");
});
