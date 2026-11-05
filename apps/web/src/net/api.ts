import type {
  ApiError,
  GuestSessionResponse,
  LeaderboardEntry,
  PublicProfile,
  RoomListing,
  WeaponId,
} from "@scrapline/shared";

function resolveServerUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env.replace(/\/$/, "");
  // Same host, default Colyseus port: handy when the client is opened from another device on the LAN.
  return `${location.protocol}//${location.hostname}:2567`;
}

export const SERVER_URL = resolveServerUrl();

const TOKEN_KEY = "scrapline.identity.v1";

export const identity = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // ignore: identity will only last for this tab
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  },
};

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (auth) {
    const token = identity.get();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiFailure("Cannot reach the game server. Check your connection and try again.", 0);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as ApiError;
      if (body.error) message = body.error;
    } catch {
      // keep generic message
    }
    throw new ApiFailure(message, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  createGuest: (nickname: string) =>
    request<GuestSessionResponse>("/api/guest", { method: "POST", body: JSON.stringify({ nickname }) }),
  me: () => request<PublicProfile>("/api/me", {}, true),
  updateMe: (patch: { nickname?: string; skin?: string; primary?: WeaponId }) =>
    request<PublicProfile>("/api/me", { method: "PATCH", body: JSON.stringify(patch) }, true),
  rooms: () => request<RoomListing[]>("/api/rooms"),
  roomByCode: (code: string) => request<{ roomId: string }>(`/api/rooms/code/${encodeURIComponent(code)}`),
  leaderboard: (sort: "kills" | "wins" | "xp") =>
    request<LeaderboardEntry[]>(`/api/leaderboard?sort=${sort}`),
  health: () => request<{ status: string }>("/health"),
};
