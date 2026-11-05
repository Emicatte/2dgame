import type Phaser from "phaser";
import { useEffect, useRef } from "react";

/**
 * Mounts the Phaser game once for the whole app lifetime. Phaser is loaded lazily so the menu
 * paints before the engine bundle has finished downloading.
 */
export function GameCanvas({ onReady }: { onReady?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let game: Phaser.Game | null = null;
    let cancelled = false;
    void import("../game/createGame.ts").then(({ createGame }) => {
      if (cancelled || !ref.current) return;
      game = createGame(ref.current);
      game.events.once("boot-complete", () => onReady?.());
      (window as unknown as { __game?: Phaser.Game }).__game = game;
    });
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [onReady]);
  return <div className="game-canvas" ref={ref} aria-hidden="true" />;
}
