import { CHAT_MAX_LEN } from "@scrapline/shared";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store.ts";
import { session, sessionStore } from "../net/session.ts";

/** In-match lines stay visible this long while the chat is closed. */
const FADE_MS = 8000;

/**
 * Room chat. Lobby: a chat button that opens a popup. Match: T opens the input line,
 * Enter sends, Escape or clicking away closes it; recent lines show briefly while closed.
 */
export function Chat({ inGame = false }: { inGame?: boolean }) {
  const s = useStore(sessionStore);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [seen, setSeen] = useState(s.chat.length);
  const [, tick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Match: T opens (capture phase, before the game's key handling, so it never triggers the T binding).
  useEffect(() => {
    if (!inGame) return;
    const onKey = (e: KeyboardEvent) => {
      if (open || e.code !== "KeyT" || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [inGame, open]);

  // Closed in-match chat: re-render once a second so old lines fade out.
  useEffect(() => {
    if (!inGame || open) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [inGame, open]);

  useEffect(() => {
    if (open) {
      input.current?.focus();
      setSeen(s.chat.length);
    }
  }, [open, s.chat.length]);

  useEffect(() => {
    list.current?.scrollTo(0, list.current.scrollHeight);
  });

  const send = () => {
    const t = text.trim();
    if (t) session.chat(t);
    setText("");
    if (inGame) setOpen(false);
  };

  const now = Date.now();
  const lines = inGame && !open ? s.chat.filter((m) => now - m.at < FADE_MS).slice(-5) : s.chat;
  const unread = s.chat.length - seen;

  const box = (
    <div className={`chat ${inGame ? "chat--game" : "chat--lobby"}`} data-testid="chat">
      <div className="chat__list" ref={list}>
        {lines.map((m) => (
          <div key={`${m.at}-${m.from}`} className={`chat__line${m.from === s.selfId ? " is-me" : ""}`}>
            <b>{m.name}</b> {m.text}
          </div>
        ))}
        {!inGame && lines.length === 0 && <div className="chat__empty">No messages yet. Say hi!</div>}
      </div>
      {open && (
        <input
          ref={input}
          className="chat__input"
          data-testid="chat-input"
          value={text}
          maxLength={CHAT_MAX_LEN}
          placeholder={inGame ? "Message · Enter to send · Esc to close" : "Message…"}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => inGame && setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
            else if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
      )}
    </div>
  );

  if (inGame) return open || lines.length > 0 ? box : null;
  return (
    <>
      {open && box}
      <button
        type="button"
        className="chat-toggle"
        aria-label="Chat"
        data-testid="chat-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M4 4h16v12H8l-4 4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        {!open && unread > 0 && <span className="chat-toggle__badge">{unread}</span>}
      </button>
    </>
  );
}
