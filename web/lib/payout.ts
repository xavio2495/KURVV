import type { Address } from "viem";
import { pub } from "./chain";
import { marketAbi, moduleAbi } from "./abi";
import { ADDR } from "./venues.ts";

/**
 * Reading a market's payout vector off chain.
 *
 * Split from `outcome.ts` so the grading rules stay pure and testable without a viem
 * client: deciding what a vector MEANS is the part that was wrong, and it should be
 * provable in a unit test rather than only against a live market.
 */

/**
 * The payout vector for a market, or null while it is unresolved or unreadable.
 *
 * Two calls: the module's record for the market address, then the vector itself.
 * Callers batch and memoise by `marketId` — every Plan on the same series shares one
 * market per Window, so a board of forty Plans resolves a handful of markets.
 */
export async function readPayout(marketId: `0x${string}`): Promise<readonly bigint[] | null> {
  try {
    const rec = await pub.readContract({
      address: ADDR.module as Address, abi: moduleAbi, functionName: "markets", args: [marketId],
    }) as readonly unknown[];
    const market = rec[8] as Address;
    if (!market || /^0x0+$/.test(market)) return null;
    const nums = await pub.readContract({
      address: market, abi: marketAbi, functionName: "payoutNumerators",
    }) as readonly bigint[];
    return nums?.length ? nums : null;
  } catch { return null; }
}

/** A memo across one sweep, so forty Plans sharing a Window cost one pair of calls. */
export function payoutCache() {
  const seen = new Map<string, Promise<readonly bigint[] | null>>();
  return (marketId: `0x${string}`) => {
    const k = marketId.toLowerCase();
    let p = seen.get(k);
    if (!p) { p = readPayout(marketId); seen.set(k, p); }
    return p;
  };
}
