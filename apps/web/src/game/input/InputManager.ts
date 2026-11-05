import { type Action, settingsStore } from "../../lib/settings.ts";

/**
 * Keyboard and mouse state with user-configurable bindings (by physical key code).
 * Edge-triggered actions (slot changes) are latched until consumed by the next input step,
 * so a quick tap between two fixed steps is never lost.
 */
export class InputManager {
  private readonly down = new Set<string>();
  private readonly latched = new Set<Action>();
  mouseDown = false;
  enabled = true;
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (isTypingTarget(e.target)) return;
    const action = this.actionFor(e.code);
    if (action || e.code === "Tab" || e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    if (action) this.latched.add(action);
  };
  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };
  private readonly onBlur = () => {
    this.down.clear();
    this.mouseDown = false;
  };
  private readonly onMouseDown = (e: MouseEvent) => {
    if (!this.enabled || e.button !== 0) return;
    if (!(e.target instanceof HTMLCanvasElement)) return;
    this.mouseDown = true;
  };
  private readonly onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
  };
  private readonly onContextMenu = (e: MouseEvent) => {
    if (e.target instanceof HTMLCanvasElement) e.preventDefault();
  };

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("contextmenu", this.onContextMenu);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("contextmenu", this.onContextMenu);
  }

  private actionFor(code: string): Action | undefined {
    const b = settingsStore.get().bindings;
    return (Object.keys(b) as Action[]).find((a) => b[a] === code);
  }

  isDown(action: Action): boolean {
    if (!this.enabled) return false;
    return this.down.has(settingsStore.get().bindings[action]);
  }

  /** True once per key press, until consumed. */
  consume(action: Action): boolean {
    if (!this.latched.has(action)) return false;
    this.latched.delete(action);
    return true;
  }

  /** Clears latched presses (e.g. when the game regains focus after a menu). */
  reset(): void {
    this.latched.clear();
    this.down.clear();
    this.mouseDown = false;
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}
