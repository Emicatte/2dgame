/** Browser side of the signaling API (src/p2p/signalServer.ts, deployed as api/p2p.js). Same origin as the page. */

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export class SignalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_SIGNAL_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function call<T>(op: string, body: Record<string, unknown> = {}, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/p2p?op=${op}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive,
    });
  } catch {
    throw new SignalError("Cannot reach the arena directory. Check the internet connection.", 0);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON (e.g. static hosting without functions)
  }
  if (!res.ok) {
    const msg =
      typeof data.error === "string"
        ? data.error
        : res.status === 404
          ? "The arena directory is not deployed with this site."
          : `Arena directory error (${res.status})`;
    throw new SignalError(msg, res.status);
  }
  return data as T;
}

export interface Registration {
  code: string;
  hostKey: string;
}

export interface PendingOffer {
  guestId: string;
  sdp: string;
}

export const signaling = {
  create: () => call<Registration>("create"),
  join: (code: string, sdp: string) => call<{ guestId: string }>("join", { code, sdp }),
  poll: (reg: Registration) => call<{ offers: PendingOffer[] }>("poll", { ...reg }),
  answer: (reg: Registration, guestId: string, answer: { sdp: string } | { error: string }) =>
    call<Record<string, never>>("answer", { ...reg, guestId, ...answer }),
  wait: (guestId: string) => call<{ answer: { sdp?: string; error?: string } | null }>("wait", { guestId }),
  close: (reg: Registration, keepalive = false) =>
    call<Record<string, never>>("close", { ...reg }, keepalive).catch(() => undefined),
  ice: () => call<{ iceServers: IceServerConfig[] }>("ice"),
};

let iceCache: { at: number; servers: IceServerConfig[] } | null = null;

/** ICE servers (STUN, plus TURN relays when configured on the deployment). Cached for 10 min. */
export async function iceServers(): Promise<IceServerConfig[]> {
  if (iceCache && performance.now() - iceCache.at < 10 * 60_000) return iceCache.servers;
  try {
    const { iceServers } = await signaling.ice();
    iceCache = { at: performance.now(), servers: iceServers };
    return iceServers;
  } catch {
    return [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  }
}
