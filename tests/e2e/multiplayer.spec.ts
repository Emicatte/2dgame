import { expect, test } from "@playwright/test";
import {
  hooks,
  launch,
  NET_SPIKES,
  net,
  onboard,
  pendingBound,
  report,
  sampleWhile,
  serverInputs,
  startDuel,
} from "./helpers.ts";

/**
 * Two fully independent browser processes connect to the same real game server, meet in a
 * private room through its invite code, and fight. Nothing about the multiplayer path is mocked.
 * Besides gameplay, the run checks the input pipeline against explicit bounds (helpers.ts).
 */
test("two independent browsers play a real deathmatch exchange", async ({ baseURL }) => {
  const browserA = await launch();
  const browserB = await launch();
  try {
    const a = await browserA.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    const b = await browserB.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    await onboard(a, "Alpha");
    await onboard(b, "Bravo");
    const { aId, bId, roomId } = await startDuel(a, b);

    const { samples } = await sampleWhile(b, async () => {
      // Movement made in browser B is seen by browser A (authoritative sync + interpolation).
      const bBefore = (await hooks(a, (h) => h.players())).find((p) => p.id === bId)!;
      await b.keyboard.down("KeyS");
      await b.waitForTimeout(700);
      await b.keyboard.up("KeyS");
      await expect
        .poll(async () => {
          const now = await a.evaluate(
            (id) =>
              (
                window as unknown as { __scrapline: { rendered(id: string): { y: number } | null } }
              ).__scrapline.rendered(id),
            bId,
          );
          return now ? Math.round(now.y - bBefore.y) : 0;
        })
        .toBeGreaterThan(20);
      await b.keyboard.down("KeyW");
      await b.waitForTimeout(700);
      await b.keyboard.up("KeyW");

      // Spawn protection lasts 1.5 s; then A aims at where it sees B and holds the trigger.
      await a.waitForTimeout(1200);
      const deadline = Date.now() + 15_000;
      let killed = false;
      while (Date.now() < deadline && !killed) {
        const target = await a.evaluate((id) => {
          const h = (
            window as unknown as {
              __scrapline: {
                rendered(id: string): { x: number; y: number } | null;
                toScreen(x: number, y: number): { x: number; y: number };
              };
            }
          ).__scrapline;
          const r = h.rendered(id);
          return r ? h.toScreen(r.x, r.y) : null;
        }, bId);
        if (target) await a.mouse.move(target.x, target.y);
        await a.mouse.down();
        await a.waitForTimeout(300);
        await a.mouse.up();
        killed = (await hooks(b, (h) => h.players())).some((p) => p.kills >= 1);
      }

      // The server decided the kill; both browsers agree on the outcome.
      expect(killed).toBe(true);
      await expect(b.getByTestId("hud")).toContainText(/Eliminated|Redeploying/);
      const fromA = await hooks(a, (h) => h.players());
      const fromB = await hooks(b, (h) => h.players());
      expect(fromA.find((p) => p.id === aId)!.kills).toBe(1);
      expect(fromB.find((p) => p.id === aId)!.kills).toBe(1);
      expect(fromB.find((p) => p.id === bId)!.deaths).toBe(1);
      await expect(a.getByTestId("hud-kills")).toHaveText("1");
      await expect
        .poll(async () => (await hooks(b, (h) => h.players())).find((p) => p.id === bId)?.alive, {
          timeout: 8000,
        })
        .toBe(true);
    });

    // ------------------------------------------------------------ input pipeline acceptance
    await a.waitForTimeout(1500); // keys released: pipeline settles
    const netA = await net(a);
    const netB = await net(b);
    const srv = await serverInputs(roomId);
    const worstFrame = Math.max(...samples.map((s) => s.frameMaxMs), netA.frameMaxMs, netB.frameMaxMs);
    const bound = pendingBound(worstFrame, NET_SPIKES ? 150 : 0);
    report("duel", { A: netA, B: netB }, srv, bound);

    for (const [name, n, id, deaths] of [
      ["A", netA, aId, 0],
      ["B", netB, bId, 1],
    ] as const) {
      const s = srv.get(id)!;
      expect(n.staleAcks, `${name} stale acks`).toBe(0);
      expect(n.snaps, `${name} snap corrections beyond respawns`).toBeLessThanOrEqual(deaths);
      expect(n.pendingMaxEver, `${name} pending max vs bound ${bound}`).toBeLessThanOrEqual(bound);
      expect(n.pending, `${name} pending after settling`).toBeLessThanOrEqual(bound);
      expect(s.duplicate + s.overflow + s.trimmed, `${name} server-side drops`).toBe(0);
      // Accounting: every frame sent reached the server, every frame received was processed,
      // except those still in flight (bounded like pending).
      expect(n.sent - s.received, `${name} frames in flight`).toBeLessThanOrEqual(bound);
      expect(n.sent - s.received).toBeGreaterThanOrEqual(0);
      expect(s.received - s.processed, `${name} frames queued`).toBeLessThanOrEqual(bound);
    }
    // The shooter never received a correction: prediction matched the server exactly.
    expect(netA.corrections).toBe(0);
  } finally {
    await browserA.close();
    await browserB.close();
  }
});
