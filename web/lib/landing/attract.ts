/**
 * ATTRACT MODE — the real device renderers, running on scripted input.
 *
 * The mode panels on the landing page are not illustrations of the modes. They are
 * `chartScene` and `flappyScene`, the exact renderers `/play` uses, handed a state
 * object this file builds. Nothing here is a second drawing of anything: if the
 * device's chart changes, these change with it.
 *
 * Every value is a pure function of elapsed time. There is no randomness and no
 * network, so a panel looks identical on every load, in every screenshot and in the
 * demo video — which is the whole reason it is scripted rather than live.
 */

import { bucketize, FUTURE_FRACTION, type Bucket } from "../three/buckets.ts";
// TYPE-ONLY, deliberately. `chartScene` reaches the device's whole render chain,
// some of which imports without file extensions — fine under the bundler, but not
// resolvable by `node --test`'s type stripping. The theme comes in as an argument
// so this module stays runnable, and testable, on its own.
import type { ChartSceneState, ChartTheme } from "../chartScene.ts";
import type { SceneState } from "../flappyScene.ts";
import type { DrawPoint, LegRenderState, LegView } from "../render/types.ts";
import type { GateView, Verdict } from "../flappy.ts";
import { PIXEL_ROWS, type PixelCells } from "../pixel.ts";

/** A fixed epoch. The panels must not drift with the wall clock. */
const T0 = 1_757_000_000;

/** One Window, and how many the panel shows. */
const WINDOW_SEC = 900;
const LEGS = 6;

/** The whole cycle, seconds: legs resolve one by one, then it starts over. */
export const CYCLE = 18;

/**
 * The price. A sum of two incommensurate sines, so it never visibly repeats inside
 * a cycle but is exactly reproducible.
 */
export function priceAt(t: number): number {
  return 101_400 + Math.sin(t / 430) * 880 + Math.sin(t / 97) * 240 + Math.sin(t / 31) * 70;
}

/** How far through the cycle, 0..1, and how many Legs have resolved by then. */
const phase = (elapsed: number) => (elapsed % CYCLE) / CYCLE;

const stateOf = (i: number, p: number): LegRenderState => {
  const done = p * (LEGS + 1.4);
  if (done > i + 1) return i % 3 === 1 ? "lost" : "won";
  if (done > i) return "open";
  return "pending";
};

function series(now: number, horizonSec: number): Bucket[] {
  const hist = horizonSec * (1 - FUTURE_FRACTION);
  const step = Math.max(15, Math.round(horizonSec / 90));
  const pts = [];
  for (let t = now - hist; t <= now; t += step) pts.push({ t, price: priceAt(t) });
  return bucketize(pts, step, now - hist);
}

/**
 * Draw mode and grid mode, which share a renderer and differ only in what the
 * player put on the glass: a Curve, or painted cells.
 */
export function attractChart(mode: "draw" | "pixel", elapsed: number, theme: ChartTheme): ChartSceneState {
  const p = phase(elapsed);
  const horizonSec = WINDOW_SEC * LEGS;
  // `now` advances with the cycle, which is what slides the Plan left through the
  // present. A static `now` renders a correct but completely still picture.
  const now = T0 + p * horizonSec * 0.5;
  const buckets = series(now, horizonSec);

  const lo = Math.min(...buckets.map((b) => b.lo));
  const hi = Math.max(...buckets.map((b) => b.hi));
  const pad = (hi - lo) * 0.45 + 120;

  const legs: LegView[] = Array.from({ length: LEGS }, (_, i) => ({
    index: i,
    direction: i % 3 === 1 ? "DOWN" : "UP",
    state: stateOf(i, p),
    stake: BigInt(400_000 + i * 90_000),
    start: T0 + i * WINDOW_SEC,
    end: T0 + (i + 1) * WINDOW_SEC,
    entryPrice: 0.52 + (i % 4) * 0.06,
  }));

  // The drawn Curve: the same shape every time, revealed as the pen crosses it.
  const drawn = Math.min(1, p * 1.9);
  const curve: DrawPoint[] = [];
  for (let u = 0; u <= drawn + 1e-9; u += 0.02) {
    curve.push({ u: Math.min(1, u), v: 0.5 + Math.sin(u * 4.1) * 0.26 + u * 0.16 });
  }

  // Grid mode's cells: a dip, a gap, then a run up. Landed one column at a time.
  const shape = [-2, -3, 0, 2, 3, 4];
  const cells: PixelCells = shape.map((r, i) =>
    p * (LEGS + 1) > i ? Math.max(-PIXEL_ROWS, Math.min(PIXEL_ROWS, r)) : undefined,
  );

  return {
    buckets,
    last: { t: now, price: priceAt(now) },
    extent: { lo: lo - pad, hi: hi + pad },
    now,
    horizonSec,
    legs,
    planStart: T0,
    curves: mode === "draw" ? [curve] : null,
    cells: mode === "pixel" ? cells : null,
    legCount: LEGS,
    anchor: T0,
    theme,
    plan: legs.map((l) => ({ direction: l.direction, stake: l.stake })),
    synthetic: Math.min(LEGS, Math.floor(p * (LEGS + 1))),
  };
}

const VERDICTS: Verdict[] = ["won", "lost", "won", "won", "lost", "won"];

/** Flappy mode: a flight already in progress, gates resolving as it goes. */
export function attractFlappy(elapsed: number): SceneState {
  const p = phase(elapsed);
  const span = 7;
  // The bird's world column advances across the cycle; gates behind it are decided.
  const head = p * (LEGS + 2);

  const gates: GateView[] = Array.from({ length: LEGS + 4 }, (_, i) => ({
    col: i,
    ref: priceAt(T0 + i * WINDOW_SEC),
    dir: i % 3 === 1 ? "DOWN" : "UP",
    verdict: i < head - 1 ? VERDICTS[i % VERDICTS.length] : "pending",
    weight: 0.1 + ((i * 37) % 11) / 55,
  }));

  return {
    view: {
      gates,
      // The renderer runs its own camera off this anchor against `Date.now()`, so the
      // anchor MUST be on the same clock — a `performance.now()` value here is off by
      // the entire unix epoch and parks every gate far off the left of the frame.
      startedAt: Date.now() - head * 1000,
      span,
      round: { from: 0, to: LEGS },
    },
    unsupported: false,
    label: "CALL IT, GATE BY GATE",
    birdVariant: 0,
    skyVariant: 4,
  };
}
