/**
 * What a settled Leg actually did.
 *
 * The Leg struct does NOT record the outcome. `leg.filled` is written once, at open,
 * as the quantity of outcome tokens bought (`PlanBook._openLeg`), and `_tryRedeem`
 * never writes it again — the redeemed collateral leaves only in the `LegSettled`
 * event. So `filled > 0` means "this Leg got a fill", not "this Leg won", and any
 * scoreboard built on it reports every filled Leg as a winner.
 *
 * The result has to come from the market's payout VECTOR instead, which is why this
 * lives in one place: the board and the Plan strip must never disagree about whether
 * a Leg won.
 */

export interface Outcome {
  /** True only for an outright win. A void is not a win. */
  won: boolean;
  /** The market resolved to neither side; both tickets redeem at half. */
  voided: boolean;
  /** Collateral this Leg's `filled` contracts are worth, in base units. */
  paid: bigint;
}

/**
 * Payout per contract, without needing `payoutDenominator`.
 *
 * The payout vector sums to the denominator, so a share of the total IS the fraction
 * of one collateral unit each contract redeems for: `[1,0]` pays 1 to the winner and
 * `[1,1]` pays 1/2 to each side, which is exactly the void rule.
 */
export function share(nums: readonly bigint[], index: number, filled: bigint): bigint {
  const total = nums.reduce((a, b) => a + b, 0n);
  if (total <= 0n) return 0n;
  return (filled * (nums[index] ?? 0n)) / total;
}

export function gradeVector(nums: readonly bigint[], direction: number, filled: bigint): Outcome {
  const idx = direction === 0 ? 0 : 1;
  const mine = nums[idx] ?? 0n;
  const other = nums[idx === 0 ? 1 : 0] ?? 0n;
  // Both sides paying is the settled definition of a void: nobody was right.
  const voided = mine > 0n && other > 0n;
  return { won: mine > 0n && !voided, voided, paid: share(nums, idx, filled) };
}
