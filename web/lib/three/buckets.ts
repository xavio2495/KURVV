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
