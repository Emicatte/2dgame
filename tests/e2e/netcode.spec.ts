import { expect, type Page, test } from "@playwright/test";
import {
  hooks,
  launch,
  NET_SPIKES,
  net,
  netem,
  onboard,
  pendingBound,
  report,
  serverInputs,
  startDuel,
} from "./helpers.ts";

/**
 * Real browsers under injected network faults: a page reload in the middle of a match, an uplink
 * stall longer than the client stall guard, and an abrupt connection drop. After each fault the
 * player must still be in the match, the input stream must resynchronise (no stale acks, bounded
 * pending, server queue drained) and the prediction must equal the authoritative position.
 */

async function moveAndCheckSeen(a: Page, b: Page, bId: string, key: "KeyS" | "KeyW", ms = 600) {
  const before = (await hooks(a, (h) => h.players())).find((p) => p.id === bId)!;
  await b.keyboard.down(key);
  await b.waitForTimeout(ms);
  await b.keyboard.up(key);
  await expect
    .poll(async () =>
      Math.abs(((await hooks(a, (h) => h.players())).find((p) => p.id === bId)?.y ?? 0) - before.y),
    )
    .toBeGreaterThan(20);
}

/** Prediction equals the server's position for the local player once inputs stop. */
async function expectConverged(page: Page) {
  await page.waitForTimeout(1200);
  const { local, server } = await hooks(page, (h) => {
    const n = h.net() as unknown as { local: { x: number; y: number } };
    const self = h.players().find((p) => p.id === h.selfId())!;
    return { local: n.local, server: { x: self.x, y: self.y } };
  });
  expect(Math.hypot(local.x - server.x, local.y - server.y)).toBeLessThan(0.01);
}

test("a player survives a page reload, an uplink stall and a connection drop", async ({ baseURL }) => {
  const browserA = await launch();
  const browserB = await launch();
  try {
    const a = await browserA.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    const b = await browserB.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    await onboard(a, "Alpha");
    await onboard(b, "Bravo");
    const { bId, roomId } = await startDuel(a, b);
    await moveAndCheckSeen(a, b, bId, "KeyS");

    // 1. Page reload: the new page reconnects with the stored token and restarts its sequence.
    await b.reload();
    await expect(b.getByTestId("hud")).toBeVisible({ timeout: 20_000 });
    await b.waitForFunction(
      () =>
        (window as unknown as { __scrapline?: { phase(): string | null } }).__scrapline?.phase() ===
        "playing",
      null,
      { timeout: 20_000 },
    );
    await moveAndCheckSeen(a, b, bId, "KeyW");
    await expectConverged(b);
    let n = await net(b);
    expect(n.staleAcks).toBe(0);
    report("after reload", { B: n }, await serverInputs(roomId), pendingBound(n.frameMaxMs));

    // 2. Uplink stall of 1.5 s while B holds a key: the HUD reports the interruption, input is
    //    held after NET.inputStallMs, and the player is neither kicked nor rubber-banded.
    const before = await serverInputs(roomId);
    await b.keyboard.down("KeyS");
    await netem("/stall", { ms: 1500, dir: "up" });
    await expect(b.getByText("Connection interrupted")).toBeVisible({ timeout: 2000 });
    await b.waitForTimeout(1600);
    await b.keyboard.up("KeyS");
    await expect(b.getByText("Connection interrupted")).toBeHidden({ timeout: 3000 });
    await expectConverged(b);
    n = await net(b);
    const after = await serverInputs(roomId);
    const sb = after.get(bId)!;
    const sb0 = before.get(bId)!;
    report("after 1.5 s uplink stall", { B: n }, after, pendingBound(n.frameMaxMs));
    expect(n.stallEvents).toBeGreaterThanOrEqual(1);
    expect(n.staleAcks).toBe(0);
    expect(sb.overflow - sb0.overflow).toBe(0);
    expect(sb.duplicate - sb0.duplicate).toBe(0);
    expect(sb.queue).toBeLessThanOrEqual(pendingBound(n.frameMaxMs, NET_SPIKES ? 150 : 0));
    expect((await hooks(a, (h) => h.players())).length).toBe(2);

    // 3. Abrupt drop of every connection: the SDK reconnects automatically within the seat window.
    await netem("/drop", {});
    await b.waitForTimeout(1500);
    await expect(b.getByText("Reconnecting…")).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => (await hooks(a, (h) => h.players())).length, { timeout: 15_000 }).toBe(2);
    await moveAndCheckSeen(a, b, bId, "KeyW");
    await expectConverged(b);
    n = await net(b);
    expect(n.staleAcks).toBe(0);
    report("after drop + reconnect", { B: n }, await serverInputs(roomId), pendingBound(n.frameMaxMs));
  } finally {
    await browserA.close();
    await browserB.close();
  }
});
