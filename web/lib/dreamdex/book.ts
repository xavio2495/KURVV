import type { Address } from "viem";
import { binaryPoolAbi } from "../abi.ts";
import { pub } from "../chain.ts";
import { USE_SDK } from "./flag.ts";
import { sdk } from "./client.ts";

/**
 * The order-book pre-flight.
 *
 * Moved here from `commit.ts` unchanged so both the legacy discovery path and
 * the SDK one can ask it without importing each other. The SDK read
 * (`getBinaryOrderBook`) replaces the ABI underneath in B5; the QUESTION must
 * not change when it does.
 */

/**
 * Does the side of the book this Leg has to take actually have a quote on it?
 *
 * NOT A TIMING QUESTION, which is why it is separate from the age bounds in
 * `liveMarket`. Measured on the 60s BTC venue: when a Window prices near an
 * extreme the maker quotes ONE SIDE ONLY. One observed Window sat at
 * `bid = 0.980` with an EMPTY ask from age 23s until it expired — an UP Leg
 * lifts the ask, so it could never have filled there no matter when it arrived.
 * `_openLeg` reads exactly this and skips with `NoLiquidity`, and that skip
 * consumes the Leg, so the cheap fix is to ask the same question before
 * committing rather than pay for the answer.
 *
 * A read, not a guarantee: the maker can pull between here and the block. It
 * removes the deterministic case, not the race.
 */
async function sideHasDepthLegacy(pool: Address, up: boolean): Promise<boolean> {
  try {
    const levels = await pub.readContract({
      address: pool, abi: binaryPoolAbi, functionName: "getBookLevels",
      // `!up` mirrors `PlanBook._openLeg`: BUY_YES lifts the ask, BUY_NO the bid.
      args: [!up, 1n],
    });
    return levels.length > 0 && levels[0].price > 0n;
  } catch {
    // An unreadable pool is not a reason to block a commit — the contract re-checks.
    return true;
  }
}

/**
 * The same question, asked through the SDK.
 *
 * `getBinaryOrderBook` reads `getBookLevels` for both sides in one pipelined
 * round-trip instead of the single side the legacy path fetches — same contract,
 * same call, one fewer trip when both sides are wanted.
 *
 * THE YES-SIDE ARRAYS ARE THE ONLY CORRECT ONES HERE. The SDK also returns
 * `noBids` / `noAsks`, which are the same book presented from the NO side by
 * price inversion. `PlanBook._openLeg` reads the YES book and quotes in YES
 * terms, so asking the inverted view would be asking a different question than
 * the contract asks — the exact failure this pre-flight exists to prevent.
 * `opts.decimals` only affects that inversion, so it is left at its default: the
 * arrays this function reads are untouched by it.
 */
async function sideHasDepthSdk(pool: Address, up: boolean): Promise<boolean> {
  try {
    const book = await sdk().getBinaryOrderBook(pool, { depth: 1 });
    // BUY_YES lifts the ask; BUY_NO works down from the YES bid.
    const side = up ? book.yesAsks : book.yesBids;
    return side.length > 0 && side[0].price > 0n;
  } catch {
    return true;
  }
}

export function sideHasDepth(pool: Address, up: boolean): Promise<boolean> {
  return USE_SDK ? sideHasDepthSdk(pool, up) : sideHasDepthLegacy(pool, up);
}
