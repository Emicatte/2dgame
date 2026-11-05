/**
 * WebRTC connection setup without trickle ICE: each side gathers its candidates first (bounded
 * wait), so one offer and one answer through the signaling mailbox are enough.
 */
import { dataChannelLink, type PeerLink } from "./link.ts";
import { type IceServerConfig, signaling } from "./signalClient.ts";
import { CLOSE } from "./wire.ts";

const GATHER_TIMEOUT_MS = 3500;
const ANSWER_TIMEOUT_MS = 15_000;
const OPEN_TIMEOUT_MS = 15_000;

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

function waitIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    // Unreachable STUN/TURN servers can keep gathering open for a long time: go with what we have.
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function waitOpen(ch: RTCDataChannel, pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (ch.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("timeout")), timeoutMs);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      ch.removeEventListener("open", onOpen);
      pc.removeEventListener("connectionstatechange", onState);
      if (err) reject(err);
      else resolve();
    };
    const onOpen = () => finish();
    const onState = () => {
      if (pc.connectionState === "failed") finish(new Error("failed"));
    };
    ch.addEventListener("open", onOpen);
    pc.addEventListener("connectionstatechange", onState);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Guest: offer → signaling → answer → open DataChannel to the host's browser. */
export async function connectToHost(code: string, ice: IceServerConfig[]): Promise<PeerLink> {
  const pc = new RTCPeerConnection({ iceServers: ice });
  const ch = pc.createDataChannel("game", { ordered: true });
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await waitIceGathering(pc, GATHER_TIMEOUT_MS);
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new ConnectError("Could not prepare the connection.", CLOSE.UNREACHABLE);
    let guestId: string;
    try {
      ({ guestId } = await signaling.join(code, sdp));
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) throw new ConnectError("Arena not found.", CLOSE.NOT_FOUND);
      throw new ConnectError(err instanceof Error ? err.message : "Arena directory error", CLOSE.UNREACHABLE);
    }
    const deadline = performance.now() + ANSWER_TIMEOUT_MS;
    let answer: { sdp?: string; error?: string } | null = null;
    while (!answer && performance.now() < deadline) {
      await sleep(400);
      try {
        ({ answer } = await signaling.wait(guestId));
      } catch {
        // transient: keep polling until the deadline
      }
    }
    if (!answer) {
      throw new ConnectError(
        "The host did not answer. Is the host's game still open, in front, on the lobby screen?",
        CLOSE.UNREACHABLE,
      );
    }
    if (answer.error || !answer.sdp) {
      throw new ConnectError(answer.error ?? "The host refused the connection.", CLOSE.UNREACHABLE);
    }
    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    try {
      await waitOpen(ch, pc, OPEN_TIMEOUT_MS);
    } catch {
      throw new ConnectError("Could not connect to the host's computer.", CLOSE.UNREACHABLE);
    }
    return dataChannelLink(pc, ch);
  } catch (err) {
    pc.close();
    throw err;
  }
}

/**
 * Host: answers one guest offer. Returns the answer SDP to post back, and a promise for the link
 * once the guest's DataChannel opens (rejects after a timeout).
 */
export async function answerGuest(
  offerSdp: string,
  ice: IceServerConfig[],
): Promise<{ sdp: string; link: Promise<PeerLink> }> {
  const pc = new RTCPeerConnection({ iceServers: ice });
  const link = new Promise<PeerLink>((resolve, reject) => {
    const timer = setTimeout(() => {
      pc.close();
      reject(new Error("guest did not connect"));
    }, OPEN_TIMEOUT_MS + ANSWER_TIMEOUT_MS);
    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      ch.binaryType = "arraybuffer";
      const ready = () => {
        clearTimeout(timer);
        resolve(dataChannelLink(pc, ch));
      };
      if (ch.readyState === "open") ready();
      else ch.addEventListener("open", ready, { once: true });
    };
  });
  try {
    await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIceGathering(pc, GATHER_TIMEOUT_MS);
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error("no local description");
    return { sdp, link };
  } catch (err) {
    pc.close();
    link.catch(() => undefined);
    throw err;
  }
}
