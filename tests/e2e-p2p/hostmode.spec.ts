import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Host mode end to end: two separate Chrome processes, real WebRTC DataChannel between them, the
 * signaling endpoint of the dev server. A creates the arena (and runs the match in its tab), B joins
 * with the code, they play, B reloads mid-match and takes its seat back, then the host closes.
 */

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  // Headless containers cannot resolve mDNS host candidates: expose plain addresses instead.
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

interface Hooks {
  selfId(): string | null;
  rendered(id: string): { x: number; y: number; visible: boolean } | null;
  toScreen(x: number, y: number): { x: number; y: number };
  phase(): string | null;
  players(): {
    id: string;
    x: number;
    y: number;
    alive: boolean;
    hp: number;
    kills: number;
    deaths: number;
  }[];
  pve(): { dark: boolean } | null;
  net(): {
    stalled: boolean;
    pendingMaxEver: number;
    staleAcks: number;
    corrections: number;
    snaps: number;
    fps: number;
  };
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
  await expect(page.getByTestId("hero-play")).toContainText("you host");
  await page.waitForFunction(() => !!(window as unknown as { __scrapline?: unknown }).__scrapline);
}

const phaseIs = (page: Page, phase: string, timeout = 20_000) =>
  page.waitForFunction(
    (p) => (window as unknown as { __scrapline?: Hooks }).__scrapline?.phase() === p,
    phase,
    { timeout },
  );

const SHOTS = process.env.E2E_SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

let browsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of browsers) await b.close();
  browsers = [];
});

test("host mode: create, Team Deathmatch invite link, play, reload and resume, host closes", async () => {
  browsers = await Promise.all(
    [0, 1].map(() => chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })),
  );
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const b = await (await browsers[1]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  for (const p of [a, b]) p.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

  await onboard(a, "Alpha");
  await onboard(b, "Bravo");

  // A creates an arena hosted in its own tab.
  await a.getByTestId("nav-rooms").click();
  await a.getByTestId("create-room").click();
  await expect(a.getByTestId("host-hint")).toBeVisible({ timeout: 15_000 });
  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  // Team Deathmatch, and B joins through A's "invite to my team" link over WebRTC.
  await a.getByTestId("change-mode").click();
  await a.getByTestId("mode-tdm").click();
  await expect(a.getByTestId("match-rules")).toContainText("Team Deathmatch");
  const hostTeam = ((await a.getByTestId("team-1").textContent()) ?? "").includes("Alpha") ? 1 : 2;
  const otherTeam = hostTeam === 1 ? 2 : 1;
  const t0 = Date.now();
  await b.goto(`/?join=${code}&team=${hostTeam}`);
  await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 45_000 });
  console.log(`[hostmode] join took ${Date.now() - t0} ms`);
  await expect(a.getByTestId(`team-${hostTeam}`)).toContainText("Bravo");
  await expect(b.getByTestId(`team-${hostTeam}`)).toContainText("Alpha");
  await expect(b.getByTestId("host-hint")).toHaveCount(0);
  // The guest moves to the other team (validated by the host).
  await b.getByTestId(`join-team-${otherTeam}`).click();
  await expect(a.getByTestId(`team-${otherTeam}`)).toContainText("Bravo");

  await b.getByTestId("ready-toggle").click();
  await expect(a.getByTestId("start-match")).toBeEnabled();
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing");
  await phaseIs(b, "playing");

  const bId = (await hooks(b, (h) => h.selfId()))!;
  const aId = (await hooks(a, (h) => h.selfId()))!;
  expect(bId).not.toBe(aId);
  // PvP arenas keep their lighting: the co-op darkness never runs here.
  expect((await hooks(a, (h) => h.pve()))?.dark).toBe(false);
  expect((await hooks(b, (h) => h.pve()))?.dark).toBe(false);

  // B moves; the host's authoritative state and B's own view agree.
  const before = (await hooks(a, (h) => h.players())).find((p) => p.id === bId)!;
  await b.keyboard.down("KeyS");
  await b.waitForTimeout(1200);
  await b.keyboard.up("KeyS");
  await b.waitForTimeout(800);
  const onHost = (await hooks(a, (h) => h.players())).find((p) => p.id === bId)!;
  const onGuest = (await hooks(b, (h) => h.players())).find((p) => p.id === bId)!;
  expect(Math.abs(onHost.y - before.y)).toBeGreaterThan(50);
  expect(Math.abs(onGuest.y - onHost.y)).toBeLessThan(1);
  expect(Math.abs(onGuest.x - onHost.x)).toBeLessThan(1);
  // A (host) moves too, and B sees it.
  const aBefore = (await hooks(b, (h) => h.players())).find((p) => p.id === aId)!;
  await a.keyboard.down("KeyW");
  await a.waitForTimeout(1000);
  await a.keyboard.up("KeyW");
  await a.waitForTimeout(800);
  const aAfter = (await hooks(b, (h) => h.players())).find((p) => p.id === aId)!;
  expect(Math.abs(aAfter.y - aBefore.y)).toBeGreaterThan(50);

  const nb = await hooks(b, (h) => h.net());
  console.log(`[hostmode] guest netcode: ${JSON.stringify(nb)}`);
  expect(nb.stalled).toBe(false);
  expect(nb.staleAcks).toBe(0);
  expect(nb.corrections - nb.snaps).toBeLessThanOrEqual(2);

  // B reloads mid-match: the stored seat token takes the same seat back.
  await b.reload();
  await phaseIs(b, "playing", 45_000);
  expect(await hooks(b, (h) => h.selfId())).toBe(bId);
  expect((await hooks(a, (h) => h.players())).filter((p) => p.id === bId)).toHaveLength(1);

  // The host leaves: B is told and returns to the menu.
  await a.close();
  await expect(b.getByText("The host closed the arena.")).toBeVisible({ timeout: 15_000 });
  await expect(b.getByTestId("nav-rooms")).toBeVisible();
});

test("host alone: the practice bots move, fight and hurt the host", async () => {
  test.setTimeout(150_000);
  browsers = [await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })];
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  a.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await onboard(a, "Solo");
  await a.getByTestId("nav-rooms").click();
  await a.getByTestId("create-room").click();
  await expect(a.getByTestId("host-hint")).toBeVisible({ timeout: 15_000 });
  await expect(a.getByText("Bot", { exact: true })).toHaveCount(3);
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing", 30_000);
  const selfId = (await hooks(a, (h) => h.selfId()))!;
  const start = (await hooks(a, (h) => h.players())).filter((p) => p.id.startsWith("bot:"));
  expect(start.length).toBe(3);
  let lowest = 100;
  let botDamage = 0;
  let moved = 0;
  for (let i = 0; i < 40; i++) {
    await a.waitForTimeout(500);
    const ps = await hooks(a, (h) => h.players());
    const me = ps.find((p) => p.id === selfId)!;
    lowest = Math.min(lowest, me.alive ? me.hp : 0);
    botDamage = Math.max(
      botDamage,
      ps.filter((p) => p.id.startsWith("bot:")).reduce((n, p) => n + p.kills + p.deaths, 0),
    );
    moved = Math.max(
      moved,
      ...ps
        .filter((p) => p.id.startsWith("bot:"))
        .map((p) => {
          const s0 = start.find((b) => b.id === p.id)!;
          return Math.hypot(p.x - s0.x, p.y - s0.y);
        }),
    );
    if (i === 10 || i === 25) await shot(a, `bots-${i}`);
    if (lowest < 100 && moved > 200) break;
  }
  console.log(
    `[bots e2e] host hp low ${lowest}, bot kills+deaths ${botDamage}, max bot travel ${Math.round(moved)} px`,
  );
  expect(moved).toBeGreaterThan(200);
  // They shoot: the host (standing still) gets hit, or the bots already traded kills.
  expect(lowest < 100 || botDamage > 0).toBe(true);
});

test("the crosshair moves with the player: walking with the mouse still keeps the player's place on screen", async () => {
  test.setTimeout(120_000);
  browsers = [await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })];
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await onboard(a, "Aim");
  await a.getByTestId("nav-rooms").click();
  await a.getByTestId("create-room").click();
  await expect(a.getByTestId("host-hint")).toBeVisible({ timeout: 15_000 });
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing", 30_000);
  await a.mouse.move(760, 360);
  await a.waitForTimeout(1200);
  const onScreen = () =>
    hooks(a, (h) => {
      const r = h.rendered(h.selfId()!)!;
      const s = h.toScreen(r.x, r.y);
      return { sx: s.x, sy: s.y, x: r.x, y: r.y };
    });
  const start = await onScreen();
  const seen = [start];
  // Spawns are often by the edge of the map: walk away from the nearest edge, both axes.
  for (const key of ["KeyS", "KeyW", "KeyD", "KeyA"]) {
    await a.keyboard.down(key);
    for (let i = 0; i < 4; i++) {
      await a.waitForTimeout(200);
      seen.push(await onScreen());
    }
    await a.keyboard.up(key);
  }
  const travelled = Math.max(...seen.map((p) => Math.hypot(p.x - start.x, p.y - start.y)));
  const drift = Math.max(...seen.map((p) => Math.hypot(p.sx - start.sx, p.sy - start.sy)));
  console.log(`[aim e2e] walked up to ${Math.round(travelled)} px, screen drift ${drift.toFixed(1)} px`);
  expect(travelled).toBeGreaterThan(150);
  expect(drift).toBeLessThan(4);
});
