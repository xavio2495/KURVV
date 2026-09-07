"use client";
import { useEffect, useRef } from "react";
import { trackEvolution, type SectionKey } from "../../lib/landing/evolution";
import { startWorld, type WorldOpts } from "../../lib/landing/world";

/**
 * The world behind the landing copy: one fixed canvas, painted from scroll depth.
 *
 * It is `aria-hidden` and pointer-transparent — every word on the page is real DOM
 * above it. Nothing here is load-bearing for reading the site.
 */
export function Scene({ onSection, panels = 6, offset = 0 }: {
  onSection?: (i: number, key: SectionKey) => void;
  panels?: number;
  offset?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cb = useRef(onSection);
  cb.current = onSection;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { evo, stop } = trackEvolution((i, k) => cb.current?.(i, k));
    const rects = () => ({
      copy: [...document.querySelectorAll<HTMLElement>(".lp-copy")].map((e) => e.getBoundingClientRect()),
      screens: [...document.querySelectorAll<HTMLElement>(".lp-play canvas")].map((e) => e.getBoundingClientRect()),
    });
    const stopScene = startWorld(canvas, evo, rects, { panels, offset } satisfies WorldOpts);
    return () => {
      stopScene();
      stop();
    };
  }, [panels, offset]);

  return <canvas ref={ref} className="hs-scene" aria-hidden />;
}
