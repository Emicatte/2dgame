import { useSyncExternalStore } from "react";

/**
 * Tiny observable store. Phaser writes to it at a throttled rate; React reads it with
 * useSyncExternalStore, so the game loop never re-renders React on every frame.
 */
export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  patch(partial: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    get: () => state,
    set(next) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      if (value === state) return;
      state = value;
      emit();
    },
    patch(partial) {
      let changed = false;
      for (const k in partial) {
        if (!Object.is(state[k], partial[k])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...partial };
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Simple typed event emitter for one-shot game events (kill feed, notices). */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as (payload: never) => void);
    return () => set.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) (fn as (p: Events[K]) => void)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
