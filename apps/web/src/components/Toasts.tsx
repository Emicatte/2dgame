import type { NoticeMessage } from "@scrapline/shared";
import { useEffect, useRef, useState } from "react";
import { gameEvents } from "../net/session.ts";

export function Toasts() {
  const [items, setItems] = useState<(NoticeMessage & { id: number })[]>([]);
  const counter = useRef(0);
  useEffect(
    () =>
      gameEvents.on("notice", (n) => {
        const id = ++counter.current;
        setItems((prev) => [...prev.slice(-3), { ...n, id }]);
        setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 3500);
      }),
    [],
  );
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
