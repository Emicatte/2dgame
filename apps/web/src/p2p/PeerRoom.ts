import { Decoder } from "@colyseus/schema";
import { MatchState, NET } from "@scrapline/shared";
import { signal } from "../net/signal.ts";
import type { PeerLink, WireData } from "./link.ts";
import { CLOSE, encodeFrame, FRAME_FULL, FRAME_PATCH, type Hello, parseFrame, type Welcome } from "./wire.ts";

/** Opens a new pipe to the host (WebRTC through signaling in the game, memory pipes in tests). */
export type Connector = () => Promise<PeerLink>;

export class JoinError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

const KEEPALIVE_MS = 1000;
/** No frame from the host for this long = the path is dead (the host sends 20 patches/s). */
const HOST_SILENCE_MS = 4000;
const HANDSHAKE_TIMEOUT_MS = 10_000;

interface Handshake {
  welcome: Welcome;
  link: PeerLink;
}

/**
 * Guest side of host mode: implements the subset of the Colyseus SDK Room API the client uses,
 * over a PeerLink to the host's browser. State is decoded with @colyseus/schema exactly like the
 * SDK does, so the game scene and menus run unmodified. A broken link is re-established within
 * NET.reconnectSeconds with the seat token (onDrop → onReconnect), like the SDK's reconnection.
 */
export class PeerRoom {
  roomId = "";
  sessionId = "";
  reconnectionToken = "";
  readonly state = new MatchState();
  readonly connection = { isOpen: false, transport: {} as { ws?: WebSocket } };
  readonly onStateChange = signal<[MatchState]>();
  readonly onReconnect = signal<[]>();
  readonly onDrop = signal<[number?, string?]>();
  readonly onLeave = signal<[number]>();
  readonly onError = signal<[number, string?]>();
  readonly isHost = false;
  /** How the current connection reaches the host ("direct", "relayed (TURN)"), when known. */
  path = "";

  private readonly decoder = new Decoder(this.state);
  private readonly handlers = new Map<string, Set<(m: unknown) => void>>();
  private readonly pings = new Map<number, { at: number; cb: (ms: number) => void }>();
  private pingSeq = 0;
  private link: PeerLink | null = null;
  private lastHeard = 0;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private left = false;
  private reconnecting = false;
  private decodedOnce = false;

  private constructor(
    private readonly connect: Connector,
    private readonly hello: Omit<Hello, "resume">,
  ) {}

  /** Connects, says hello and waits for the first full state. */
  static async join(connect: Connector, hello: Omit<Hello, "resume">, resume?: string): Promise<PeerRoom> {
    const room = new PeerRoom(connect, hello);
    const hs = await room.handshake(resume);
    room.adopt(hs);
    return room;
  }

  // ------------------------------------------------------------------ SDK Room API

  onMessage(type: string, cb: (m: unknown) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  send(type: string, payload?: unknown): void {
    this.link?.send(encodeFrame(["m", type, payload ?? {}]));
  }

  ping(cb: (ms: number) => void): void {
    const n = ++this.pingSeq;
    this.pings.set(n, { at: performance.now(), cb });
    this.link?.send(encodeFrame(["pi", n]));
  }

  async leave(_consented = true): Promise<void> {
    if (this.left) return;
    this.link?.send(encodeFrame(["bye"]));
    this.finish(CLOSE.CONSENTED);
  }

  removeAllListeners(): void {
    for (const s of [this.onStateChange, this.onReconnect, this.onDrop, this.onLeave, this.onError])
      s.clear();
    this.handlers.clear();
  }

  // ------------------------------------------------------------------ connection

  private async handshake(resume?: string): Promise<Handshake> {
    let link: PeerLink;
    try {
      link = await this.connect();
    } catch (err) {
      const code = (err as { code?: number }).code ?? CLOSE.UNREACHABLE;
      throw new JoinError(err instanceof Error ? err.message : "Could not connect", code);
    }
    return new Promise<Handshake>((resolve, reject) => {
      let welcome: Welcome | null = null;
      const fail = (err: JoinError) => {
        clearTimeout(timer);
        link.onmessage = null;
        link.onclose = null;
        link.close();
        reject(err);
      };
      const timer = setTimeout(
        () => fail(new JoinError("The host did not let us in (timeout).", CLOSE.UNREACHABLE)),
        HANDSHAKE_TIMEOUT_MS,
      );
      link.onclose = () => fail(new JoinError("The connection to the host closed.", CLOSE.UNREACHABLE));
      link.onmessage = (data) => {
        if (typeof data === "string") {
          const f = parseFrame(data);
          if (f?.[0] === "welcome") welcome = f[1] as Welcome;
          else if (f?.[0] === "reject") fail(new JoinError(String(f[2] ?? "refused"), Number(f[1])));
          // Notices and events sent before our first full state are not ours to show yet.
          return;
        }
        const bytes = new Uint8Array(data);
        if (!welcome || bytes[0] !== FRAME_FULL) return;
        clearTimeout(timer);
        this.applyFull(bytes);
        resolve({ welcome, link });
      };
      const hello: Hello = { ...this.hello, ...(resume ? { resume } : {}) };
      link.send(encodeFrame(["hello", hello]));
    });
  }

  private adopt({ welcome, link }: Handshake) {
    this.roomId = welcome.code;
    this.sessionId = welcome.sessionId;
    this.reconnectionToken = welcome.token;
    this.link = link;
    this.connection.isOpen = true;
    this.lastHeard = performance.now();
    link.onmessage = (data) => this.onData(link, data);
    link.onclose = () => this.onLinkLost(link);
    if (!this.keepalive) {
      this.keepalive = setInterval(() => {
        if (this.left || this.reconnecting || !this.link) return;
        if (performance.now() - this.lastHeard > HOST_SILENCE_MS) {
          const dead = this.link;
          dead.onmessage = null;
          dead.onclose = null;
          dead.close();
          this.onLinkLost(dead);
          return;
        }
        this.link.send(encodeFrame(["pi", 0]));
      }, KEEPALIVE_MS);
    }
    void link.describe?.().then((p) => {
      this.path = p;
    });
    queueMicrotask(() => this.onStateChange.invoke(this.state));
  }

  private applyFull(bytes: Uint8Array) {
    // A full snapshot after a reconnect is authoritative: entries it lacks were removed meanwhile.
    if (this.decodedOnce && typeof this.decoder.decodeResync === "function") {
      this.decoder.decodeResync(bytes, { offset: 1 });
    } else {
      this.decoder.decode(bytes, { offset: 1 });
    }
    this.decodedOnce = true;
  }

  private onData(link: PeerLink, data: WireData) {
    if (link !== this.link) return;
    this.lastHeard = performance.now();
    if (typeof data !== "string") {
      const bytes = new Uint8Array(data);
      if (bytes[0] === FRAME_PATCH) this.decoder.decode(bytes, { offset: 1 });
      else if (bytes[0] === FRAME_FULL) this.applyFull(bytes);
      else return;
      this.onStateChange.invoke(this.state);
      return;
    }
    const f = parseFrame(data);
    if (!f) return;
    switch (f[0]) {
      case "m": {
        for (const h of this.handlers.get(String(f[1])) ?? []) h(f[2]);
        return;
      }
      case "po": {
        const p = this.pings.get(Number(f[1]));
        if (p) {
          this.pings.delete(Number(f[1]));
          p.cb(performance.now() - p.at);
        }
        return;
      }
      case "bye":
        this.finish(Number(f[1]) || CLOSE.HOST_CLOSED);
        return;
    }
  }

  /** The pipe broke: keep the room object and try to take the seat back. */
  private onLinkLost(link: PeerLink) {
    if (link !== this.link || this.left) return;
    this.link = null;
    this.connection.isOpen = false;
    this.pings.clear();
    void this.reconnect();
  }

  private async reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.onDrop.invoke(CLOSE.RECONNECT_FAILED, "connection lost");
    const deadline = performance.now() + NET.reconnectSeconds * 1000;
    let lastCode: number = CLOSE.RECONNECT_FAILED;
    while (!this.left && performance.now() < deadline) {
      try {
        const hs = await this.handshake(this.reconnectionToken);
        if (this.left) {
          hs.link.close();
          return;
        }
        this.reconnecting = false;
        this.adopt(hs);
        this.onReconnect.invoke();
        return;
      } catch (err) {
        lastCode = err instanceof JoinError ? err.code : CLOSE.RECONNECT_FAILED;
        // The host answered and said no (seat gone, arena closed): stop trying.
        if (lastCode !== CLOSE.UNREACHABLE && lastCode !== CLOSE.RECONNECT_FAILED) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    this.reconnecting = false;
    if (!this.left) {
      // Arena gone from the directory while we were away: the host left.
      const code =
        lastCode === CLOSE.NOT_FOUND
          ? CLOSE.HOST_CLOSED
          : lastCode === CLOSE.UNREACHABLE
            ? CLOSE.RECONNECT_FAILED
            : lastCode;
      this.finish(code);
    }
  }

  private finish(code: number) {
    if (this.left) return;
    this.left = true;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    const link = this.link;
    this.link = null;
    if (link) {
      link.onmessage = null;
      link.onclose = null;
      link.close();
    }
    this.connection.isOpen = false;
    this.onLeave.invoke(code);
  }
}
