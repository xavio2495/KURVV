/**
 * The one number the landing page is made of.
 *
 * Every layer, colour, font weight and parallax offset on `/` is a function of
 * `evo` — how far down the page you are, 0 at the top and 1 at the bottom. There
 * is no per-section animation state and no timeline library: one scalar, read by
 * both CSS (as `--evo`) and the canvas, which is why the build-up stays in step
 * with itself no matter how you arrive at a scroll position.
 *
 * It is deliberately reversible. Scrolling back up un-builds the world, because a
 * one-way build reads as a bug the first time anyone scrolls up.
 */

export const SECTIONS = ["header", "about", "draw", "pixel", "flappy", "play"] as const;
export type SectionKey = (typeof SECTIONS)[number];

/** Where each section's centre sits on the `evo` axis. Layers key off these. */
export const AT: Record<SectionKey, number> = {
  header: 0,
  about: 0.2,
  draw: 0.4,
  pixel: 0.6,
  flappy: 0.8,
  play: 1,
};

export interface Evo {
  /** Eased 0..1 over the whole document. What everything reads. */
  p: number;
  /** Raw, un-eased. Used for anything that must not lag the scrollbar. */
  raw: number;
  /** Index into `SECTIONS` of the section nearest the viewport centre. */
  index: number;
}

/**
 * Smoothing. A wheel notch moves `raw` in one jump; without easing the parallax
 * snaps and the pixel art tears. 0.12 lands within a pixel in ~5 frames, which is
 * under the threshold where the lag reads as sluggishness.
 */
const EASE = 0.12;

export const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Starts the scroll loop. Returns the live `Evo` (mutated in place — read it in a
 * rAF, never in render) and a stop function.
 *
 * `onSection` fires only when the nearest section changes, so React re-renders a
 * handful of times per page rather than sixty times a second.
 */
export function trackEvolution(onSection?: (i: number, key: SectionKey) => void): {
  evo: Evo;
  stop: () => void;
} {
  const evo: Evo = { p: 0, raw: 0, index: 0 };
  if (typeof window === "undefined") return { evo, stop: () => {} };

  const snap = reducedMotion();
  let frame = 0;
  let lastIndex = -1;
  let lastWritten = -1;

  // Read through `scrollingElement` rather than `window.scrollY`: whichever of
  // html or body owns the scroll, this is the element that actually moved.
  const measure = (): number => {
    const el = document.scrollingElement ?? document.documentElement;
    const span = el.scrollHeight - window.innerHeight;
    return span > 0 ? Math.min(1, Math.max(0, el.scrollTop / span)) : 0;
  };

  const step = () => {
    evo.raw = measure();
    evo.p = snap ? evo.raw : evo.p + (evo.raw - evo.p) * EASE;

    // Nearest section by centre distance, not by threshold crossing: the last
    // section is short and a threshold scheme leaves it unreachable.
    const i = Math.min(
      SECTIONS.length - 1,
      Math.max(0, Math.round(evo.p * (SECTIONS.length - 1))),
    );
    if (i !== lastIndex) {
      lastIndex = i;
      evo.index = i;
      onSection?.(i, SECTIONS[i]);
    }

    // Writing a custom property invalidates style for the subtree, so only do it
    // when the value has actually moved a visible amount.
    const q = Math.round(evo.p * 1000) / 1000;
    if (q !== lastWritten) {
      lastWritten = q;
      document.documentElement.style.setProperty("--evo", String(q));
    }

  };

  // Driven from BOTH a frame loop and the scroll event. The frame loop is what
  // eases; the scroll listener is what guarantees correctness when rAF is paused
  // or throttled — a backgrounded tab, a reduced-power mode, an occluded window.
  // Without it the page can be scrolled while `evo` stays frozen at 0, which
  // renders as a site that simply never builds.
  const loop = () => {
    step();
    frame = requestAnimationFrame(loop);
  };
  const onScroll = () => step();

  step();
  frame = requestAnimationFrame(loop);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  return {
    evo,
    stop: () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    },
  };
}

/** 0 below `a`, 1 above `b`, smoothstepped between. The shape of every fade-in. */
export function ramp(x: number, a: number, b: number): number {
  if (b === a) return x >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Rises over `[a,b]`, holds, falls over `[c,d]`. A layer's whole life. */
export function window4(x: number, a: number, b: number, c: number, d: number): number {
  return ramp(x, a, b) * (1 - ramp(x, c, d));
}
