import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeVector, share } from "../lib/outcome.ts";

/**
 * These encode the mistake that shipped: the board decided a Leg had won by asking
 * whether `leg.filled > 0`. `filled` is written ONCE, at open, as the quantity of
 * outcome tokens bought — `_tryRedeem` never touches it again. So every Leg that got
 * a fill looked like a winner, the hit rate rendered 100% for everyone, and because a
 * stake `S` at price `p` buys `S/p > S` contracts, the return was always positive.
 *
 * A Leg's result is only knowable from the market's payout vector.
 */

/** A won market: one side takes everything. */
const WIN_UP: readonly bigint[] = [1n, 0n];
/** A voided market: both sides redeem at half. */
const VOID: readonly bigint[] = [1n, 1n];

const FILLED = 1_602_564n; // ~1.60 contracts for 1.00 tUSDC at 0.624

test("a losing Leg is NOT a win, however much it filled", () => {
  // direction 1 is DOWN; the UP side took the payout.
  const o = gradeVector(WIN_UP, 1, FILLED);
  assert.equal(o.won, false);
  assert.equal(o.voided, false);
  assert.equal(o.paid, 0n, "a loser redeems successfully and pays zero");
});

test("a winning Leg pays one collateral unit per contract", () => {
  const o = gradeVector(WIN_UP, 0, FILLED);
  assert.equal(o.won, true);
  assert.equal(o.voided, false);
  assert.equal(o.paid, FILLED);
});

test("THE TRAP: a void is not a win, and pays HALF", () => {
  // Both numerators are non-zero on a void, so the old test `nums[dir] > 0` called it
  // a win AND claimed the full payout — reporting double what the chain transferred.
  for (const dir of [0, 1]) {
    const o = gradeVector(VOID, dir, FILLED);
    assert.equal(o.won, false, "neither side was right");
    assert.equal(o.voided, true);
    assert.equal(o.paid, FILLED / 2n);
  }
});

test("payout is derived from the vector's own sum, not an assumed denominator", () => {
  // The vector sums to the denominator, so a scaled vector must pay identically.
  assert.equal(share([1n, 0n], 0, FILLED), share([1_000_000n, 0n], 0, FILLED));
  assert.equal(share([1n, 1n], 0, FILLED), share([500_000n, 500_000n], 0, FILLED));
});

test("an unresolved or empty vector pays nothing rather than dividing by zero", () => {
  assert.equal(share([0n, 0n], 0, FILLED), 0n);
  assert.equal(share([], 0, FILLED), 0n);
});

test("a Leg that never filled cannot win anything", () => {
  const o = gradeVector(WIN_UP, 0, 0n);
  assert.equal(o.won, true, "the side was right");
  assert.equal(o.paid, 0n, "but nothing was held, so nothing is owed");
});
