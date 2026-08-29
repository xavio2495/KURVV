import { allocateStakes, type Leg } from "./curve.ts";

/**
 * PIXEL MODE — the grid, and why its rows mean what they mean.
 *
 * The obvious grid is price bands: rows are price ranges, a cell is "the price will
 * be in THIS band at THIS Window's expiry". That grid cannot be traded on this
 * venue, and it is worth being precise about why rather than discovering it late.
 * Across every binary market the indexer has ever recorded, each
 * `(venue, asset, interval, expiry)` Window has exactly ONE market; no Window has
 * two. `outcomeSlotCount` is never above 2. There are no strikes to build bands
 * from, so a band row would be a control with nothing behind it.
 *
 * What the venue does offer, per Window, is one binary question and one book. So the
 * axes are:
 *
 *     X   successive Windows, one column each — unchanged from draw mode
 *     Y   SIGNED CONVICTION. Above the centre line is UP, below is DOWN, and
 *         distance from the centre buys SIZE, not a different strike.
 *     0   the centre row means "no position in this Window"
 *
 * That last one is the feature draw mode cannot express: a Curve always has a slope
 * at every boundary, so it always takes a position. A grid can skip a Window.
 *
 * The payload is byte-identical to the drawn one — a `Direction` and a `uint96` per
 * Leg — so nothing on chain changes, and `allocateStakes` is reused rather than
 * reimplemented because it is what enforces the exact-sum invariant the contract's
 * `ApprovalMustBeExact` depends on.
 */

/** Rows either side of the centre. 3 gives a 7-row grid, which fits the display. */
export const PIXEL_ROWS = 3;

/** Total rows drawn, centre included. */
export const PIXEL_HEIGHT = PIXEL_ROWS * 2 + 1;

/**
 * One painted column: the row offset from centre, in `[-PIXEL_ROWS, +PIXEL_ROWS]`.
 * `0` and `undefined` both mean "skip this Window", and are kept distinct only so
 * the renderer can show a deliberately-skipped column differently from an empty one.
 */
export type PixelCells = (number | undefined)[];

export function emptyCells(legCount: number): PixelCells {
  return new Array(legCount).fill(undefined);
}

/** Quantise a normalised paint point onto the grid. `u`,`v` both run 0..1. */
export function cellAt(u: number, v: number, legCount: number): { col: number; row: number } {
  const col = Math.min(legCount - 1, Math.max(0, Math.floor(u * legCount)));
  // `v` is bottom-up, and so is the row axis: +PIXEL_ROWS at the top.
  const band = Math.min(PIXEL_HEIGHT - 1, Math.max(0, Math.floor(v * PIXEL_HEIGHT)));
  return { col, row: band - PIXEL_ROWS };
}

/** Is there anything to commit? A grid of skips is not a Plan. */
export function hasPositions(cells: PixelCells): boolean {
  return cells.some((c) => c !== undefined && c !== 0);
}

/**
 * The grid, as Legs.
 *
 * Skipped Windows are dropped rather than staked at zero: the venue rejects a
 * zero-size order, and a Leg that exists only to be skipped still costs a handler
 * invocation and a slot in the schedule.
 *
 * Returns the Legs AND the columns they came from, because the caller has to know
 * which Window each Leg lands on to draw the result back onto the grid — dropping a
 * column silently shifts every Leg after it.
 */
export interface PixelPlan {
  legs: Leg[];
  /** Column index for each Leg, ascending. `legs[i]` was painted at `columns[i]`. */
  columns: number[];
}

export function cellsToPlan(
  cells: PixelCells,
  opts: { totalStake: bigint; minWeightShare?: number },
): PixelPlan {
  const { totalStake, minWeightShare = 0 } = opts;

  const columns: number[] = [];
  const magnitude: number[] = [];
  const up: boolean[] = [];
  cells.forEach((c, i) => {
    if (c === undefined || c === 0) return;
    columns.push(i);
    magnitude.push(Math.abs(c));
    up.push(c > 0);
  });

  if (!columns.length) throw new Error("paint at least one cell above or below the centre line");
  if (minWeightShare < 0 || minWeightShare * columns.length > 1) {
    throw new Error("cellsToPlan: minWeightShare * legCount must be <= 1");
  }

  const totalMag = magnitude.reduce((a, b) => a + b, 0);
  let weights = magnitude.map((m) => m / totalMag);
  if (minWeightShare > 0) {
    const slack = 1 - minWeightShare * columns.length;
    weights = weights.map((w) => minWeightShare + w * slack);
  }

  const stakes = allocateStakes(weights, totalStake);
  return {
    legs: columns.map((_, i) => ({
      direction: up[i] ? ("UP" as const) : ("DOWN" as const),
      weight: weights[i],
      stake: stakes[i],
    })),
    columns,
  };
}
