import { GAME_TITLE, NICKNAME, nicknameSchema } from "@scrapline/shared";
import { type FormEvent, useState } from "react";
import { Button } from "../components/ui.tsx";
import { createProfile } from "../state/profile.ts";

export function Onboarding() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = nicknameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid nickname");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createProfile(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen screen--menu">
      <form className="menu" onSubmit={submit} noValidate>
        <div className="brand">
          <span className="stencil">Arena salvage league · season 0</span>
          <h1 className="brand__name">
            {GAME_TITLE.slice(0, 5)}
            <span>{GAME_TITLE.slice(5)}</span>
          </h1>
          <p className="brand__tag">
            Pick a callsign. Your stats, XP and unlocks are tied to it on this device.
          </p>
        </div>
        <div className="hazard" />
        <div className="field">
          <label htmlFor="nick">Callsign</label>
          <input
            id="nick"
            className="input"
            autoFocus
            autoComplete="nickname"
            maxLength={NICKNAME.max}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!error}
            aria-describedby="nick-hint nick-err"
          />
          <span id="nick-hint" className="field__hint">
            {NICKNAME.min}–{NICKNAME.max} characters: letters, numbers, space, _ . -
          </span>
          <span id="nick-err" className="field__error" role="alert">
            {error}
          </span>
        </div>
        <Button variant="primary" size="lg" type="submit" disabled={busy} block>
          {busy ? "Creating…" : "Enter the arena"}
        </Button>
      </form>
    </div>
  );
}
