/**
 * Host mode entry points: create an arena in this browser (host), or join one by code (guest).
 * Signaling is used only while connecting; game traffic flows directly between the browsers.
 */
import type { MapId, WeaponId } from "@scrapline/shared";
import { HostRoom } from "./HostRoom.ts";
import { PeerRoom } from "./PeerRoom.ts";
import { answerGuest, connectToHost } from "./rtc.ts";
import { iceServers, type Registration, SignalError, signaling } from "./signalClient.ts";
import { BUILD_ID } from "./wire.ts";

export interface LocalPlayer {
  name: string;
  level: number;
  skin: string;
  primary: WeaponId;
  profileId: string;
  /** Preferred team when joining a team match (invite link). */
  team?: 1 | 2;
}

/** Host polls for join requests often in the lobby, less during a match (Redis command budget). */
const POLL_LOBBY_MS = 1500;
const POLL_MATCH_MS = 4000;
const POLL_ERROR_MS = 5000;

export async function hostArena(me: LocalPlayer, map: MapId): Promise<HostRoom> {
  const reg = await signaling.create();
  const ice = await iceServers();
  const room = new HostRoom({ code: reg.code, map, host: me });
  const poller = new OfferPoller(reg, room, ice);
  room.onDispose(() => {
    poller.stop();
    void signaling.close(reg);
  });
  const onUnload = () => {
    // Best effort: tell guests and the directory that the arena is gone.
    void room.leave();
  };
  window.addEventListener("pagehide", onUnload);
  room.onDispose(() => window.removeEventListener("pagehide", onUnload));
  room.start();
  poller.start();
  return room;
}

/** `resume`: seat token from an earlier connection to this arena (page reload). */
export async function joinArena(code: string, me: LocalPlayer, resume?: string): Promise<PeerRoom> {
  const ice = await iceServers();
  return PeerRoom.join(() => connectToHost(code, ice), { build: BUILD_ID, ...me }, resume);
}

class OfferPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly reg: Registration,
    private readonly room: HostRoom,
    private readonly ice: Awaited<ReturnType<typeof iceServers>>,
  ) {}

  start() {
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.poll(), ms);
  }

  private async poll() {
    if (this.stopped) return;
    try {
      const { offers } = await signaling.poll(this.reg);
      for (const offer of offers) void this.answer(offer.guestId, offer.sdp);
      const phase = this.room.state.phase;
      this.schedule(phase === "lobby" || phase === "results" ? POLL_LOBBY_MS : POLL_MATCH_MS);
    } catch (err) {
      if (err instanceof SignalError && (err.status === 404 || err.status === 403)) {
        // Registration expired (e.g. the computer slept): nobody new can join with this code.
        this.stop();
        return;
      }
      this.schedule(POLL_ERROR_MS);
    }
  }

  private async answer(guestId: string, sdp: string) {
    try {
      const { sdp: answer, link } = await answerGuest(sdp, this.ice);
      await signaling.answer(this.reg, guestId, { sdp: answer });
      this.room.acceptLink(await link);
    } catch {
      await signaling
        .answer(this.reg, guestId, { error: "The host could not open a connection." })
        .catch(() => undefined);
    }
  }
}
