import { normalizeRoomCode } from "@scrapline/shared";
import { useCallback, useEffect, useState } from "react";
import { GameCanvas } from "./components/GameCanvas.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { Button } from "./components/ui.tsx";
import { sfx } from "./game/audio/sfx.ts";
import { useStore } from "./lib/store.ts";
import { session, sessionStore } from "./net/session.ts";
import { InGame } from "./screens/InGame.tsx";
import { Lobby } from "./screens/Lobby.tsx";
import { CreateDialog, JoinDialog, MainMenu, type MenuView } from "./screens/MainMenu.tsx";
import { Onboarding } from "./screens/Onboarding.tsx";
import { Results } from "./screens/Results.tsx";
import { Leaderboard, Loadout, Profile, RoomBrowser, SettingsSheet } from "./screens/Sheets.tsx";
import { currentLoadout, loadProfile, profileStore } from "./state/profile.ts";

function useInviteCode(): [string | null, () => void] {
  const [code, setCode] = useState<string | null>(() => {
    const raw = new URLSearchParams(location.search).get("join");
    return raw ? normalizeRoomCode(raw) : null;
  });
  const clear = useCallback(() => {
    setCode(null);
    const url = new URL(location.href);
    url.searchParams.delete("join");
    history.replaceState(null, "", url.toString());
  }, []);
  return [code, clear];
}

export function App() {
  const profile = useStore(profileStore);
  const sess = useStore(sessionStore);
  const [view, setView] = useState<MenuView>("main");
  const [overlay, setOverlay] = useState<"settings" | "loadout" | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, clearInvite] = useInviteCode();

  useEffect(() => {
    void loadProfile();
    const unlock = () => sfx.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
  }, []);

  // Resume a match after a page reload, otherwise honour an invite link.
  useEffect(() => {
    if (profile.status !== "ready") return;
    void (async () => {
      const resumed = await session.tryResume();
      if (resumed || !invite) return;
      setBusy(true);
      try {
        await session.joinByCode(invite, currentLoadout());
      } catch {
        setView("join");
      } finally {
        setBusy(false);
      }
      clearInvite();
    })();
  }, [profile.status, invite, clearInvite]);

  useEffect(() => {
    if (sess.status === "connected") setView("main");
  }, [sess.status]);

  const inRoom = sess.status === "connected" || sess.status === "reconnecting";
  const back = () => setView("main");

  let screen: React.ReactNode = null;
  if (profile.status === "loading") {
    screen = (
      <div className="screen">
        <span className="stencil">Connecting…</span>
      </div>
    );
  } else if (profile.status === "offline") {
    screen = (
      <div className="screen screen--dim">
        <div className="panel" style={{ maxWidth: 440 }}>
          <h3 className="panel__title">Server unreachable</h3>
          <p>{profile.error}</p>
          <Button variant="primary" onClick={() => void loadProfile()}>
            Retry
          </Button>
        </div>
      </div>
    );
  } else if (profile.status === "anonymous") {
    screen = <Onboarding />;
  } else if (inRoom) {
    if (sess.phase === "lobby") screen = <Lobby onOpenLoadout={() => setOverlay("loadout")} />;
    else if (sess.phase === "results") screen = <Results />;
    else screen = <InGame onSettings={() => setOverlay("settings")} />;
  } else {
    screen = (
      <>
        <MainMenu onNavigate={setView} busy={busy} setBusy={setBusy} />
        {view === "browse" && <RoomBrowser onBack={back} />}
        {view === "join" && <JoinDialog onClose={back} initialCode={invite ?? ""} />}
        {view === "create" && <CreateDialog onClose={back} />}
        {view === "loadout" && <Loadout onBack={back} />}
        {view === "profile" && <Profile onBack={back} />}
        {view === "leaderboard" && <Leaderboard onBack={back} />}
        {view === "settings" && <SettingsSheet onBack={back} />}
        {sess.error && sess.status === "error" && (
          <div className="toast-stack">
            <div className="toast toast--warn" role="alert">
              {sess.error}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <GameCanvas />
      {screen}
      {overlay === "settings" && <SettingsSheet onBack={() => setOverlay(null)} />}
      {overlay === "loadout" && <Loadout onBack={() => setOverlay(null)} />}
      <Toasts />
    </>
  );
}
