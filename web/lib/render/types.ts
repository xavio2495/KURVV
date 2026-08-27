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

export type LegRenderState = "pending" | "open" | "won" | "lost" | "skipped";

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

export const AXIS_W = 62;
export const AXIS_H = 22;
