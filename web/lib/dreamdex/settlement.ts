import { sdk } from "./client.ts";

/**
 * How a market settled, as a payout vector.
 *
 * `lib/outcome.ts` STAYS. Grading a vector is pure, tested, and ours — the bug
 * it encodes (a board that called every filled Leg a winner) is a reasoning
 * mistake, not a protocol one, and the SDK cannot protect us from repeating it.
 * This module only changes where the vector comes from.
 *
 * TWO READS BECOME ONE. `lib/payout.ts` reads the module's record to find the
 * market address, then the market's `payoutNumerators()`, then — when that comes
 * back empty — `isVoided()` to tell "unresolved" from "void with no vector".
 * `getMarketOnchain` answers all three in a single call.
 */

/** MarketStatus: 0 Listed · 1 Trading · 2 Locked · 3 Settling · 4 Resolved · 5 Voided */
export const STATUS = {
  Listed: 0, Trading: 1, Locked: 2, Settling: 3, Resolved: 4, Voided: 5,
} as const;

/**
 * The payout vector for a market, or null while it is unresolved or unreadable.
 *
 * SYNTHESISED FROM THE WINNER, not read as a vector — and the two are the same
 * thing here. Settlement v3 stores a vector and the winning index is its argmax;
 * `getMarketOnchain().winningOutcome` is that argmax, computed on chain. For a
 * binary market the vector has two entries, so argmax plus the void flag
 * determines it completely:
 *
 *   resolved, winner 0  →  [1, 0]
 *   resolved, winner 1  →  [0, 1]
 *   voided              →  [1, 1]   both sides redeem at half
 *
 * The void case is the one that matters. A voided market can carry NO
 * numerators at all, and returning null for it left a Leg that had finished on
 * chain rendering as "open" forever and dropped from the standings entirely.
 * `isVoided` is checked FIRST for exactly that reason.
 */
export async function readPayout(marketId: `0x${string}`): Promise<readonly bigint[] | null> {
  try {
    const m = await sdk().getMarketOnchain(marketId);
    if (m.isVoided) return [1n, 1n];
    if (!m.isResolved) return null;
    return m.winningOutcome === 0 ? [1n, 0n] : [0n, 1n];
  } catch {
    return null;
  }
}

/** A memo across one sweep, so forty Plans sharing a Window cost one call. */
export function payoutCache() {
  const seen = new Map<string, Promise<readonly bigint[] | null>>();
  return (marketId: `0x${string}`) => {
    const k = marketId.toLowerCase();
    let p = seen.get(k);
    if (!p) { p = readPayout(marketId); seen.set(k, p); }
    return p;
  };
}

/**
 * Settled markets holding unclaimed winnings.
 *
 * `loadMarkets()` CANNOT FIND THESE. The registry sweep skips finalized
 * binaries, so a scan over the live list finds no winnings, ever — one of the
 * protocol's own listed gotchas. The binary tier with an explicit status is the
 * only way to see them.
 *
 * Not wired to anything yet: today `PlanBook` holds the outcome tokens and
 * redeems as itself, so there is no user-held position to sweep for. This
 * becomes the board's source the day positions land at the user's address.
 */
export function listSettled(limit = 50) {
  return sdk().listBinaryMarkets({ status: "Finalized", limit });
}
