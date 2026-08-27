import { AXIS_H, AXIS_W, type Dims, type PricePoint, type Viewport } from "./types";

/** ~20% of the width is future space to draw into. */
export const FUTURE_FRACTION = 0.2;

export function makeViewport(
  dims: Dims, price: PricePoint[], horizonSec: number, now = Date.now() / 1000,
): Viewport {
  const plotW = Math.max(1, dims.w - AXIS_W);
  const plotH = Math.max(1, dims.h - AXIS_H);

  // Past occupies (1 - FUTURE_FRACTION); the horizon fills the rest, so the drawable
  // region is always exactly the Plan's horizon however far back the history goes.
  const future = Math.max(horizonSec, 1);
  const past = (future / FUTURE_FRACTION) * (1 - FUTURE_FRACTION);
  const t0 = now - past;
  const t1 = now + future;

  let lo = Infinity, hi = -Infinity;
  for (const p of price) {
    if (p.t < t0) continue;
    if (p.price < lo) lo = p.price;
    if (p.price > hi) hi = p.price;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  // A minimum band so a quiet market still reads as a line rather than a flat wire,
  // plus headroom above and below for the drawn Curve to leave the price range.
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, Math.max(mid * 0.0015, 1e-9)) * 2.2;
  const p0 = mid - half, p1 = mid + half;

  const timeToX = (t: number) => ((t - t0) / (t1 - t0)) * plotW;
  const priceToY = (p: number) => plotH - ((p - p0) / (p1 - p0)) * plotH;
  return {
    t0, t1, p0, p1, plotW, plotH,
    timeToX, priceToY,
    xToTime: (x: number) => t0 + (x / plotW) * (t1 - t0),
    yToPrice: (y: number) => p0 + ((plotH - y) / plotH) * (p1 - p0),
    nowX: timeToX(now),
  };
}
