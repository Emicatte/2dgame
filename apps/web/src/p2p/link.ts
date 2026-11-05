/**
 * Transport between the host's browser and one guest: a reliable, ordered message pipe. In the game
 * it is a WebRTC DataChannel; tests use an in-memory pair with the same semantics.
 *
 * Frames: binary = synchronized state (byte 0 = FRAME_FULL | FRAME_PATCH, then schema bytes),
 * text = JSON array `[kind, ...args]` (see wire.ts).
 */
export type WireData = string | ArrayBuffer;

export interface PeerLink {
  send(data: string | Uint8Array): void;
  /** Closes the pipe after queued messages are flushed. Does not fire `onclose`. */
  close(): void;
  readonly open: boolean;
  /** Bytes queued and not yet sent. */
  readonly bufferedAmount: number;
  onmessage: ((data: WireData) => void) | null;
  /** The pipe broke or the other side closed it. Fires at most once. */
  onclose: (() => void) | null;
  /** Short description of the path (direct, relayed), for diagnostics. */
  describe?(): Promise<string>;
}

/** WebRTC DataChannel link. The peer connection is closed shortly after the channel. */
export function dataChannelLink(pc: RTCPeerConnection, ch: RTCDataChannel): PeerLink {
  ch.binaryType = "arraybuffer";
  let closed = false;
  let disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  const link: PeerLink = {
    send(data) {
      if (closed || ch.readyState !== "open") return;
      try {
        if (typeof data === "string") ch.send(data);
        else ch.send(data as Uint8Array<ArrayBuffer>);
      } catch {
        fire();
      }
    },
    close() {
      if (closed) return;
      closed = true;
      cleanup();
      try {
        ch.close();
      } catch {
        // already closed
      }
      // Give the SCTP stack a moment to flush a final message ("bye") before tearing down ICE.
      setTimeout(() => pc.close(), 800);
    },
    get open() {
      return !closed && ch.readyState === "open";
    },
    get bufferedAmount() {
      return ch.bufferedAmount;
    },
    onmessage: null,
    onclose: null,
    async describe() {
      try {
        const stats = await pc.getStats();
        let pairId = "";
        stats.forEach((s) => {
          if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
        });
        let local = "";
        let remote = "";
        stats.forEach((s) => {
          if (
            s.type === "candidate-pair" &&
            (s.id === pairId || (!pairId && s.nominated && s.state === "succeeded"))
          ) {
            local = s.localCandidateId;
            remote = s.remoteCandidateId;
          }
        });
        const types: string[] = [];
        stats.forEach((s) => {
          if ((s.id === local || s.id === remote) && "candidateType" in s)
            types.push(s.candidateType as string);
        });
        return types.includes("relay")
          ? "relayed (TURN)"
          : types.length
            ? `direct (${types.join("/")})`
            : "unknown";
      } catch {
        return "unknown";
      }
    },
  };
  const fire = () => {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      ch.close();
    } catch {
      // ignore
    }
    pc.close();
    link.onclose?.();
  };
  const cleanup = () => {
    if (disconnectedTimer) clearTimeout(disconnectedTimer);
    ch.onmessage = null;
    ch.onclose = null;
    pc.onconnectionstatechange = null;
  };
  ch.onmessage = (ev: MessageEvent<WireData>) => {
    if (!closed) link.onmessage?.(ev.data);
  };
  ch.onclose = fire;
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === "failed" || s === "closed") fire();
    else if (s === "disconnected") {
      // Often recovers by itself within a few seconds (Wi-Fi hiccup); the keepalive decides later.
      if (!disconnectedTimer)
        disconnectedTimer = setTimeout(() => pc.connectionState !== "connected" && fire(), 6000);
    } else if (s === "connected" && disconnectedTimer) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }
  };
  return link;
}

/**
 * Two connected in-memory links (tests, offline tools). Delivery is asynchronous and ordered;
 * `latencyMs` delays every message by a fixed amount.
 */
export function memoryLinkPair(latencyMs = 0): [PeerLink, PeerLink] {
  const make = () => {
    const l: PeerLink & {
      peer?: PeerLink & { _recv(d: WireData): void; _closed(): void };
      isClosed: boolean;
    } & {
      _recv(d: WireData): void;
      _closed(): void;
    } = {
      isClosed: false,
      send(data) {
        if (l.isClosed) return;
        const copy: WireData = typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer);
        const peer = l.peer;
        setTimeout(() => peer?._recv(copy), latencyMs);
      },
      close() {
        if (l.isClosed) return;
        l.isClosed = true;
        const peer = l.peer;
        setTimeout(() => peer?._closed(), latencyMs);
      },
      get open() {
        return !l.isClosed;
      },
      bufferedAmount: 0,
      onmessage: null,
      onclose: null,
      _recv(d) {
        if (!l.isClosed) l.onmessage?.(d);
      },
      _closed() {
        if (l.isClosed) return;
        l.isClosed = true;
        l.onclose?.();
      },
    };
    return l;
  };
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/** Simulates a broken network path: both ends see `onclose`, nothing more is delivered. */
export function breakLink(link: PeerLink): void {
  const l = link as PeerLink & { _closed?: () => void; peer?: { _closed(): void } };
  l._closed?.();
  l.peer?._closed();
}
