import {
  DEFAULT_PRIMARY,
  DEFAULT_SKIN,
  isSkinUnlocked,
  isWeaponId,
  type PublicProfile,
  type WeaponId,
} from "@scrapline/shared";
import { createStore } from "../lib/store.ts";
import { ApiFailure, api, identity } from "../net/api.ts";
import type { Loadout } from "../net/session.ts";

export interface ProfileState {
  status: "loading" | "anonymous" | "ready" | "offline";
  profile: PublicProfile | null;
  error: string | null;
}

export const profileStore = createStore<ProfileState>({ status: "loading", profile: null, error: null });

export async function loadProfile(): Promise<void> {
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
  const res = await api.createGuest(nickname);
  identity.set(res.token);
  profileStore.set({ status: "ready", profile: res.profile, error: null });
}

export async function refreshProfile(): Promise<void> {
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
  const profile = await api.updateMe(loadout);
  profileStore.patch({ profile });
}
