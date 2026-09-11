"use client";
import { useState } from "react";

/**
 * "Turn your phone sideways", on the way IN rather than on arrival at the game.
 *
 * It used to be a full-screen block on `/play`, which meant the first a player heard
 * of it was after they had committed to loading the console. It lives here instead,
 * so the ask happens while they are still reading the landing page and the game is
 * already the right way up when they get there.
 *
 * DELIBERATELY NOT A BLOCKER. The landing page is the page people are sent to and it
 * reads perfectly well in portrait; covering it would cost every phone visitor the
 * whole page to save one rotation. It is a card at the foot of the screen, it can be
 * dismissed, and CSS decides when it applies — `(orientation: portrait)` and a phone
 * width — so there is no resize listener and nothing to keep in step.
 */
export function RotateGate() {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <aside className="rotate-tip" role="note">
      <div className="rotate-tip-icon" aria-hidden />
      <div className="rotate-tip-copy">
        <strong>Turn your phone sideways</strong>
        <span>KURVV is a landscape console — it plays best held wide.</span>
      </div>
      <button type="button" className="rotate-tip-x" onClick={() => setGone(true)} aria-label="Dismiss">×</button>
    </aside>
  );
}
