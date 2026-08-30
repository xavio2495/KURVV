import type { PricePoint } from "../render/types";

/**
 * Collapse a raw fill series into fixed-width buckets.
 *
 * One fetch of WBTC spot fills feeds every lane; a lane is that same series at a
 * coarser resolution, so the near lane is jagged and the far lanes are smooth. This
 * is a real property of the data, not a stylistic filter — nothing is interpolated
 * and an empty bucket stays empty rather than borrowing its neighbour's price.
 */
export interface Bucket {
  /** Bucket start, unix seconds. */
  t: number;
  /** Closing print in the bucket — the last fill, not an average. */
  close: number;
  lo: number;
  hi: number;
}

export function bucketize(points: PricePoint[], intervalSec: number, since: number): Bucket[] {
  if (intervalSec <= 0) throw new Error("bucketize: intervalSec must be > 0");
  const by = new Map<number, Bucket>();
  for (const p of points) {
    if (p.t < since) continue;
    const t = Math.floor(p.t / intervalSec) * intervalSec;
    const b = by.get(t);
    if (!b) by.set(t, { t, close: p.price, lo: p.price, hi: p.price });
    else {
      b.close = p.price; // points arrive oldest-first, so the last write is the close
      if (p.price < b.lo) b.lo = p.price;
      if (p.price > b.hi) b.hi = p.price;
    }
  }
  return [...by.values()].sort((a, b) => a.t - b.t);
}

/** Shared price extent across every lane, so lanes are directly comparable. */
export function priceExtent(lanes: Bucket[][]): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const l of lanes) for (const b of l) { if (b.lo < lo) lo = b.lo; if (b.hi > hi) hi = b.hi; }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 };
  // Headroom so a drawn Curve can leave the traded range without clipping.
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, Math.max(mid * 0.0015, 1e-9)) * 1.9;
  return { lo: mid - half, hi: mid + half };
}

/**
 * How much of the frame is the FUTURE — the part a Curve may be drawn on.
 *
 * The single source for the timeline's split. `PLOT.x0` in the chart scene is
 * derived from it, and so is the bucketiser's history window, because the two
 * drifting apart puts the price line and the drawable span on different scales.
 * It used to live on the 3D stage, which imported three.js and so could not be
 * reached from a unit test.
 */
export const FUTURE_FRACTION = 0.56;

/** Total seconds across the frame, given the future horizon it must fit. */
export function visibleSpanOf(horizonSec: number): number {
  return horizonSec / FUTURE_FRACTION;
}

/** Samples across the visible span. Enough to read as a line, few enough to draw. */
const SAMPLES = 190;
const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Bucket width for the timeline, derived so the span always fills the frame. */
export function timelineInterval(horizonSec: number): number {
  const want = visibleSpanOf(horizonSec) / SAMPLES;
  for (const n of NICE) if (n >= want) return n;
  return NICE[NICE.length - 1];
}
