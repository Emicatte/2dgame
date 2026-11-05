/**
 * Minimal event signal with the call shape of the Colyseus SDK room events (`room.onStateChange(fn)`,
 * `.remove(fn)`, `.invoke(...)`, `.clear()`), used by the in-browser rooms (benchmark, host mode).
 */
export type Listener<A extends unknown[]> = (...args: A) => void;
export type Signal<A extends unknown[]> = ((fn: Listener<A>) => () => void) & {
  remove(fn: Listener<A>): void;
  invoke(...args: A): void;
  clear(): void;
};

export function signal<A extends unknown[]>(): Signal<A> {
  const fns = new Set<Listener<A>>();
  const s = ((fn: Listener<A>) => {
    fns.add(fn);
    return () => {
      fns.delete(fn);
    };
  }) as unknown as Signal<A>;
  s.remove = (fn) => {
    fns.delete(fn);
  };
  s.invoke = (...args) => {
    for (const fn of [...fns]) fn(...args);
  };
  s.clear = () => fns.clear();
  return s;
}
