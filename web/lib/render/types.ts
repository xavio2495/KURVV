export interface Dims { w: number; h: number; dpr: number }

/**
 * Bidirectional projection between chart space and pixels.
 *
 * `futureFraction` reserves the right-hand slice of the chart for time that has not
 * happened yet. That is the space the user draws into — without it there is nowhere
 * to express a view about the next two hours.
 */
export interface Viewport {
  t0: number; t1: number;          // visible time range, unix seconds
  p0: number; p1: number;          // visible price range
  plotW: number; plotH: number;    // plot area in CSS px, excluding the axis gutter
  timeToX: (t: number) => number;
  priceToY: (p: number) => number;
  xToTime: (x: number) => number;
  yToPrice: (y: number) => number;
  nowX: number;                    // pixel column for "now" — the drawing boundary
}

export interface PricePoint { t: number; price: number }

/**
 * `void` is a settled Leg that was neither right nor wrong — the market resolved to
 * no side and both tickets redeem at half. It is deliberately NOT folded into `won`:
 * the payout vector pays both sides on a void, so any test of the form
 * "my numerator is non-zero" calls it a win and reports double the real proceeds.
 */
export type LegRenderState = "pending" | "open" | "won" | "lost" | "void" | "skipped";

export interface LegView {
  index: number;
  direction: "UP" | "DOWN";
  state: LegRenderState;
  stake: bigint;
  /** Window bounds, unix seconds. */
  start: number;
  end: number;
  /** Collateral paid out to the owner, once settled. */
  paid?: bigint;
  entryPrice?: number;
}
