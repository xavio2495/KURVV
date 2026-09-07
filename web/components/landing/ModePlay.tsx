"use client";
import { useEffect, useRef } from "react";
import { MAIN_H, MAIN_W } from "../../lib/screen";
import { createChartScene, THEMES } from "../../lib/chartScene";
import { createFlappyScene } from "../../lib/flappyScene";
import { attractChart, attractFlappy } from "../../lib/landing/attract";
import { reducedMotion } from "../../lib/landing/evolution";

export type Mode = "draw" | "pixel" | "flappy";

/**
 * A mode panel: the device's OWN renderer, running on scripted input.
 *
 * This is not a picture of the mode. `createChartScene` and `createFlappyScene` are
 * the same modules `/play` mounts, drawing at the same 900x780 the device does — the
 * only difference is that the state comes from `lib/landing/attract` instead of from
 * a wallet and a chain. If the device's chart changes, this changes with it.
 *
 * It runs only while it is on screen, and paints one still frame at mount:
 * IntersectionObserver callbacks are delivered in the browser's rendering step,
 * which a hidden or occluded tab skips entirely, so a panel that waits for the
 * observer to draw anything can stay blank for as long as the tab is in the
 * background.
 */
export function ModePlay({ mode, label }: { mode: Mode; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = MAIN_W;
    canvas.height = MAIN_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scene = mode === "flappy" ? createFlappyScene() : createChartScene();
    const SETTLED = 8.2;
    const t0 = performance.now() - SETTLED * 1000;
    const paint = (elapsed: number) => {
      ctx.clearRect(0, 0, MAIN_W, MAIN_H);
      if (mode === "flappy") {
        (scene as ReturnType<typeof createFlappyScene>).draw(ctx, attractFlappy(elapsed), elapsed);
      } else {
        (scene as ReturnType<typeof createChartScene>).draw(ctx, attractChart(mode, elapsed, THEMES[mode]), elapsed);
      }
    };

    // A settled frame immediately — before the observer, and the only frame a
    // reduced-motion visitor ever sees.
    paint(SETTLED);
    if (reducedMotion()) return () => scene.dispose();

    let frame = 0;
    let running = false;
    const loop = () => {
      if (!document.hidden) paint((performance.now() - t0) / 1000);
      frame = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !running) {
          running = true;
          frame = requestAnimationFrame(loop);
        } else if (!e.isIntersecting && running) {
          running = false;
          cancelAnimationFrame(frame);
        }
      },
      { rootMargin: "15% 0px" },
    );
    io.observe(canvas);

    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      scene.dispose();
    };
  }, [mode]);

  return (
    <figure className="lp-play">
      <canvas ref={ref} aria-hidden />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
