/**
 * Scripted input for the offline benchmark: when set, the scene's fixed step takes movement, aim
 * and buttons from here instead of the keyboard and mouse. Never set in normal play.
 */
export interface AutopilotInput {
  mx: number;
  my: number;
  aim: number;
  buttons: number;
}

export type Autopilot = (step: number, self: { x: number; y: number }) => AutopilotInput;

let current: Autopilot | null = null;

export const autopilot = {
  get: (): Autopilot | null => current,
  set: (a: Autopilot | null): void => {
    current = a;
  },
};
