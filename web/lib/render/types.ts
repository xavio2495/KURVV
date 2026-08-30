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

/** A drawn point, normalised. `u` runs across the future span, `v` bottom-to-top. */
export interface DrawPoint { u: number; v: number }
