import {
  DEFAULT_PRIMARY,
  DEFAULT_SKIN,
  isSkinUnlocked,
  isWeaponId,
  nicknameSchema,
  type PublicProfile,
  type WeaponId,
} from "@scrapline/shared";
import { createStore } from "../lib/store.ts";
import { ApiFailure, api, HOST_MODE, identity } from "../net/api.ts";
import type { Loadout } from "../net/session.ts";
import { localProfile, toPublic } from "./localProfile.ts";

export interface ProfileState {
  status: "loading" | "anonymous" | "ready" | "offline";
  profile: PublicProfile | null;
  error: string | null;
}

export const profileStore = createStore<ProfileState>({ status: "loading", profile: null, error: null });

export async function loadProfile(): Promise<void> {
  if (HOST_MODE) {
    const d = localProfile.load();
    profileStore.set(
      d
        ? { status: "ready", profile: toPublic(d), error: null }
        : { status: "anonymous", profile: null, error: null },
    );
    return;
  }
  if (!identity.get()) {
    profileStore.set({ status: "anonymous", profile: null, error: null });
    return;
  }
  try {
    const profile = await api.me();
    profileStore.set({ status: "ready", profile, error: null });
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 401) {
      identity.clear();
      profileStore.set({ status: "anonymous", profile: null, error: null });
    } else {
      profileStore.set({
        status: "offline",
        profile: null,
        error: err instanceof Error ? err.message : "Server unavailable",
      });
    }
  }
}

export async function createProfile(nickname: string): Promise<void> {
  if (HOST_MODE) {
    profileStore.set({ status: "ready", profile: toPublic(localProfile.create(nickname)), error: null });
    return;
  }
  const res = await api.createGuest(nickname);
  identity.set(res.token);
  profileStore.set({ status: "ready", profile: res.profile, error: null });
}

export async function refreshProfile(): Promise<void> {
  if (HOST_MODE) {
    const d = localProfile.load();
    if (d) profileStore.patch({ profile: toPublic(d) });
    return;
  }
  try {
    const profile = await api.me();
    profileStore.patch({ profile });
  } catch {
    // keep last known profile
  }
}

export function currentLoadout(): Loadout {
  const p = profileStore.get().profile;
  const primary: WeaponId = p && isWeaponId(p.primary) ? p.primary : DEFAULT_PRIMARY;
  const skin = p && isSkinUnlocked(p.skin, p.level) ? p.skin : DEFAULT_SKIN;
  return { primary, skin };
}

export async function saveLoadout(loadout: Partial<Loadout> & { nickname?: string }): Promise<void> {
  if (HOST_MODE) {
    let patch = loadout;
    if (loadout.nickname !== undefined) {
      const r = nicknameSchema.safeParse(loadout.nickname);
      if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid callsign");
      patch = { ...loadout, nickname: r.data };
    }
    const d = localProfile.update(patch);
    if (d) profileStore.patch({ profile: toPublic(d) });
    return;
  }
  const profile = await api.updateMe(loadout);
  profileStore.patch({ profile });
}
