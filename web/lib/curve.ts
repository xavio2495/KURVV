/**
 * Curve → Plan.
 *
 * The gesture layer's whole thesis lives here: a drawn shape carries information, so
 * a flat-then-sharply-up Curve must produce a different Plan from a steadily-rising
 * one even though both end higher. If that distinction is lost, the mapping is wrong.
 *
 *   Direction  = sign of a segment's change
 *   Conviction = that segment's slope, normalised across the Curve, → share of stake
 */

/** A raw point from the canvas. `y` is CANVAS space: it grows DOWNWARD. */
export interface CurvePoint {
  x: number;
  y: number;
}

export type Direction = "UP" | "DOWN";

export interface Leg {
  direction: Direction;
  /** Share of the total stake, in [0,1]. Weights across a Plan sum to 1. */
  weight: number;
  /** Integer stake in collateral base units. Stakes sum EXACTLY to the total. */
  stake: bigint;
}

export interface CurveToPlanOptions {
  /** One Leg per Window in the horizon. */
  legCount: number;
  /** Total stake in collateral base units (tUSDC is 6dp). */
  totalStake: bigint;
  /**
   * Floor on any single Leg's share, so a flat stretch still takes a real position
   * rather than a zero-stake one the venue would reject. 0 disables the floor and
   * gives pure slope-proportional sizing.
   */
  minWeightShare?: number;
}

/**
 * Monotone cubic Hermite interpolation (Fritsch–Carlson).
 *
 * The monotonicity limiting is the entire point. A plain cubic spline overshoots
 * between control points, and an overshoot here inverts a segment's sign — inventing
 * a DOWN Leg the user never drew. Fritsch–Carlson clamps the tangents so the
 * interpolant is monotone on every interval where the data is, which makes an
 * invented reversal impossible.
 */
export function monotoneInterpolator(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  if (n === 0) throw new Error("monotoneInterpolator: no points");
  if (n === 1) return () => ys[0];
  if (n === 2) {
    const k = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    return (x) => ys[0] + k * (x - xs[0]);
  }

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i];
    if (h <= 0) throw new Error("monotoneInterpolator: xs must be strictly increasing");
    dx.push(h);
    slope.push((ys[i + 1] - ys[i]) / h);
  }

  // Initial tangents: average of neighbouring slopes, zero at a local extremum.
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  }
  m.push(slope[n - 2]);

  // Fritsch–Carlson limiter: keep (alpha,beta) inside the circle of radius 3.
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const alpha = m[i] / slope[i];
    const beta = m[i + 1] / slope[i];
    const s = alpha * alpha + beta * beta;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * alpha * slope[i];
      m[i + 1] = tau * beta * slope[i];
    }
  }

  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const h = dx[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h * m[lo] +
      (-2 * t3 + 3 * t2) * ys[lo + 1] +
      (t3 - t2) * h * m[lo + 1]
    );
  };
}

/**
 * Resample a freehand Curve to `legCount + 1` evenly spaced boundary samples,
 * returned in PRICE orientation (up is larger) rather than canvas orientation.
 */
export function sampleAtWindowBoundaries(points: CurvePoint[], legCount: number): number[] {
  if (points.length < 2) throw new Error("sampleAtWindowBoundaries: need at least 2 points");
  if (legCount < 1) throw new Error("sampleAtWindowBoundaries: legCount must be >= 1");

  // Collapse duplicate/backtracking x so the interpolator sees a strictly
  // increasing domain — a freehand drag can easily produce both.
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of sorted) {
    if (xs.length > 0 && p.x === xs[xs.length - 1]) {
      ys[ys.length - 1] = p.y; // last write wins for a vertical stroke
      continue;
    }
    xs.push(p.x);
    ys.push(p.y);
  }
  if (xs.length < 2) throw new Error("sampleAtWindowBoundaries: curve has no horizontal extent");

  const f = monotoneInterpolator(xs, ys);
  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  const out: number[] = [];
  for (let i = 0; i <= legCount; i++) {
    const x = x0 + ((x1 - x0) * i) / legCount;
    // Canvas y grows downward; negate so the samples read as prices.
    out.push(-f(x));
  }
  return out;
}

/**
 * Split `total` across `weights` as integers that sum to EXACTLY `total`.
 *
 * This matters more than it looks: the contract enforces `ApprovalMustBeExact`, so
 * per-Leg stakes that are each rounded independently will not sum to the approved
 * amount and `commitPlan` reverts. Largest-remainder assigns every leftover base
 * unit deterministically, to the Legs with the largest truncated fraction, ties
 * broken by index — so the same Curve always produces the same Plan.
 */
export function allocateStakes(weights: number[], total: bigint): bigint[] {
  const n = weights.length;
  if (n === 0) throw new Error("allocateStakes: no weights");
  if (total < 0n) throw new Error("allocateStakes: negative total");

  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) {
    // Degenerate (all-zero) weights: spread evenly rather than emit a dead Plan.
    return allocateStakes(new Array(n).fill(1), total);
  }

  const exact = weights.map((w) => (Number(total) * w) / sum);
  const floors = exact.map((v) => BigInt(Math.floor(v)));
  let assigned = floors.reduce((a, b) => a + b, 0n);
  let remainder = total - assigned;

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  const out = [...floors];
  let k = 0;
  while (remainder > 0n) {
    out[order[k % n].i] += 1n;
    remainder -= 1n;
    k++;
  }
  return out;
}

/**
 * Map a drawn Curve onto one Leg per Window.
 *
 * A segment that is exactly flat is UP by convention, because the venue's question is
 * "closes AT OR ABOVE its opening price" — ties resolve up, so that is the side a
 * flat view should take.
 */
export function curveToPlan(points: CurvePoint[], opts: CurveToPlanOptions): Leg[] {
  const { legCount, totalStake, minWeightShare = 0 } = opts;
  if (minWeightShare < 0 || minWeightShare * legCount > 1) {
    throw new Error("curveToPlan: minWeightShare * legCount must be <= 1");
  }

  const samples = sampleAtWindowBoundaries(points, legCount);
  const changes: number[] = [];
  for (let i = 0; i < legCount; i++) changes.push(samples[i + 1] - samples[i]);

  // Conviction is the segment's slope. Boundaries are evenly spaced in x, so |change|
  // is proportional to |slope| and needs no extra division.
  const magnitude = changes.map(Math.abs);
  const totalMag = magnitude.reduce((a, b) => a + b, 0);

  let weights: number[];
  if (totalMag === 0) {
    weights = new Array(legCount).fill(1 / legCount); // a perfectly flat Curve
  } else {
    weights = magnitude.map((m) => m / totalMag);
    if (minWeightShare > 0) {
      const slack = 1 - minWeightShare * legCount;
      weights = weights.map((w) => minWeightShare + w * slack);
    }
  }

  const stakes = allocateStakes(weights, totalStake);
  return changes.map((c, i) => ({
    direction: c >= 0 ? "UP" : "DOWN",
    weight: weights[i],
    stake: stakes[i],
  }));
}
