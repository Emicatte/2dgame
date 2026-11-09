import { type GameMode, modeFlags } from "@scrapline/shared";

/**
 * Mode feature flags of this build (VITE_MODE_FLAGS, see modeFlags): host mode applies them to the
 * arena it runs, the menus hide what is switched off.
 */
export const MODE_FLAGS: ReadonlySet<GameMode> = modeFlags(
  (import.meta.env.VITE_MODE_FLAGS as string | undefined) ?? "",
);
