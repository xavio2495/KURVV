"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { startDeck } from "../lib/deck/render";
import { SCENES } from "../lib/deck/scenes";
import { reducedMotion } from "../lib/landing/evolution";

/**
 * The pitch deck: one slide per screen, advanced a whole slide at a time.
 *
 * This is NOT the landing page's scroll. A deck that eases continuously with the
 * wheel leaves you parked between two slides, which is the one state a deck must
 * never be in — so the wheel, the arrow keys and a swipe all commit to exactly one
 * step and the position then animates to it on its own.
 *
 * The wheel needs the lockout specifically. A trackpad emits a long tail of momentum
 * events from one physical flick; without a cooldown that single gesture walks
 * through four slides.
 */
const STEP_LOCK = 460;
/** How long a slide takes to travel. */
const SLIDE_MS = 420;

/** Ease-out cubic: fast off the mark, settles without overshoot. */
const ease = (t: number) => 1 - (1 - t) ** 3;

export function Deck({ children }: { children: React.ReactNode }) {
  const n = SCENES.length;
  const [index, setIndex] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const locked = useRef(0);

  /**
   * The travel, as a closed form of the clock rather than a running lerp.
   *
   * An incremental `pos += (target - pos) * k` only advances inside a frame, so any
   * stalled or throttled frame leaves the canvas showing one slide while the words
   * have already moved to the next. Derived from `performance.now()`, the position
   * is correct in whatever frame eventually happens — and a synchronous redraw after
   * a keypress lands on the right scene without waiting for rAF at all.
   */
  const move = useRef({ from: 0, to: 0, at: 0, snap: false });
  const posAt = useCallback((now: number) => {
    const m = move.current;
    if (m.snap || m.from === m.to) return m.to;
    const t = Math.min(1, Math.max(0, (now - m.at) / SLIDE_MS));
    return m.from + (m.to - m.from) * ease(t);
  }, []);

  const go = useCallback((next: number) => {
    const i = Math.max(0, Math.min(n - 1, next));
    const now = performance.now();
    move.current = { from: posAt(now), to: i, at: now, snap: move.current.snap };
    setIndex(i);
  }, [n, posAt]);

  const step = useCallback((dir: number) => {
    const now = performance.now();
    if (now < locked.current) return;
    locked.current = now + STEP_LOCK;
    go(move.current.to + dir);
  }, [go]);

  // The position that actually gets drawn, eased toward the committed slide.
  useEffect(() => {
    const el = host.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    move.current.snap = reducedMotion();
    let frame = 0;
    const pos = () => posAt(performance.now());
    const tick = () => {
      el.style.setProperty("--deck", String(Math.round(pos() * 1000) / 1000));
      frame = requestAnimationFrame(tick);
    };
    tick();
    const stop = startDeck(canvas, pos);
    return () => {
      cancelAnimationFrame(frame);
      stop();
    };
  }, [posAt]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (Math.abs(d) < 8) return;
      e.preventDefault();
      step(d > 0 ? 1 : -1);
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " ") {
        e.preventDefault();
        step(1);
      } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") {
        e.preventDefault();
        step(-1);
      } else if (k === "Home") {
        e.preventDefault();
        go(0);
      } else if (k === "End") {
        e.preventDefault();
        go(n - 1);
      }
    };
    let sx = 0;
    let sy = 0;
    const onStart = (e: TouchEvent) => {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      if (Math.abs(d) > 44) step(d < 0 ? 1 : -1);
    };
    // Non-passive: the wheel must not also scroll whatever is behind the deck.
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [step, go, n]);

  return (
    <div className="deck" ref={host} style={{ "--deck-n": n } as React.CSSProperties}>
      <canvas className="deck-scene" ref={canvasRef} aria-hidden />
      <div className="deck-track">{children}</div>

      <div className="deck-hud">
        <button className="deck-arrow" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous slide">‹</button>
        <div className="deck-dots" role="tablist" aria-label="Slides">
          {SCENES.map((s, i) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1} of ${n}`}
              className={i === index ? "deck-dot on" : "deck-dot"}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <button className="deck-arrow" onClick={() => step(1)} disabled={index === n - 1} aria-label="Next slide">›</button>
      </div>
      <p className="deck-count" aria-hidden>
        {String(index + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
      </p>
    </div>
  );
}
