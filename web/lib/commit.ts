import { encodeFunctionData, type Address } from "viem";
import { erc20Abi, planBookAbi } from "./abi";
import { ADDR, INDEXER, type Venue } from "./venues";
import { curveToPlan, type CurvePoint, type Leg } from "./curve";
import type { BatchCall } from "./wallet/types";

export const PLAN_BOOK = (process.env.NEXT_PUBLIC_PLAN_BOOK ?? "") as Address;

export interface LiveMarket {
  marketId: `0x${string}`;
  poolAddress: Address;
  expiry: number;
  tradingStart: number;
}

async function gql<T>(query: string): Promise<T> {
  const r = await fetch(INDEXER, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = (await r.json()) as { data?: T; errors?: unknown };
  if (!j.data) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

/**
 * The currently-Trading market for a venue's series.
 *
 * The indexer lags the chain by seconds, so right after a roll the successor is
 * briefly invisible while the predecessor has already expired. On a 60s Window that
 * blind spot is a real fraction of the cycle — retry rather than fail.
 */
export async function liveMarket(v: Venue, tries = 12): Promise<LiveMarket | null> {
  for (let i = 0; i < tries; i++) {
    const cutoff = Math.floor(Date.now() / 1000) + v.minHeadroom + 3;
    const d = await gql<{ Market: LiveMarket[] }>(`{ Market(where:{
      venueId:{_eq:"${v.venueId}"}, asset:{_eq:"${v.asset}"}, intervalSec:{_eq:"${v.intervalSec}"},
      finalized:{_eq:false}, expiry:{_gt:"${cutoff}"}
    }, order_by:{expiry:asc}, limit:1){ marketId poolAddress expiry tradingStart } }`);
    const m = d.Market[0];
    if (m) return { ...m, expiry: Number(m.expiry), tradingStart: Number(m.tradingStart) };
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/**
 * Is this venue rolling right now?
 *
 * One query, no retry — the caller polls. `liveMarket` deliberately retries for two
 * dozen seconds because it is on the commit path and a roll boundary is worth
 * waiting through; this is for the UI, where the honest answer to "is there a market"
 * has to arrive before the user presses anything.
 *
 * It matters because a series can stop. The 15-minute series stalled on 29 Aug with
 * its last window unfinalised, and the chain's own token has a registered series that
 * has never rolled at all. Both look identical from the picker unless it is asked.
 */
export async function venueIsLive(v: Venue): Promise<boolean> {
  const cutoff = Math.floor(Date.now() / 1000) + v.minHeadroom + 3;
  const d = await gql<{ Market: { marketId: string }[] }>(`{ Market(where:{
    venueId:{_eq:"${v.venueId}"}, asset:{_eq:"${v.asset}"}, intervalSec:{_eq:"${v.intervalSec}"},
    finalized:{_eq:false}, expiry:{_gt:"${cutoff}"}
  }, limit:1){ marketId } }`);
  return d.Market.length > 0;
}

/** Real on-chain settlement references: the opening price of each rolled Window. */
export async function rollPriceSeries(v: Venue, sinceSec: number): Promise<{ t: number; price: number }[]> {
  const d = await gql<{ Market: { tradingStart: string; question: string; marketId: string }[] }>(
    // Newest first, then reversed. Ascending with a limit takes the OLDEST 400 rows,
    // which on a 60-second series is under seven hours starting from `since` — so a
    // long horizon charted a window of history that ended a day ago.
    `{ Market(where:{venueId:{_eq:"${v.venueId}"}, asset:{_eq:"${v.asset}"},
        intervalSec:{_eq:"${v.intervalSec}"}, tradingStart:{_gt:"${sinceSec}"}},
        order_by:{tradingStart:desc}, limit:400){ tradingStart question marketId } }`);
  // The venue writes the reference into the question text; the typed strike field is
  // 0 for at-or-above markets. Parse defensively and drop anything unparseable.
  const out: { t: number; price: number }[] = [];
  for (const m of d.Market) {
    const hit = /([0-9][0-9,]*\.?[0-9]*)/.exec(m.question?.replace(/^[^0-9]*/, "") ?? "");
    const p = hit ? Number(hit[1].replace(/,/g, "")) : NaN;
    if (Number.isFinite(p) && p > 0) out.push({ t: Number(m.tradingStart), price: p });
  }
  out.reverse();
  return out;
}

export interface BuiltPlan {
  legs: Leg[];
  total: bigint;
  market: LiveMarket;
  calls: BatchCall[];
}

/**
 * Build the one-transaction commit: approve EXACTLY the total, then commitPlan.
 *
 * THE EXACT-SUM TRAP. Leg stakes come from normalised float weights, but the contract
 * enforces `ApprovalMustBeExact`. Independently rounded stakes will not sum to the
 * approved total and the commit reverts. `curveToPlan` allocates the remainder
 * deterministically; we assert the invariant here before anything is signed.
 */
export async function buildCommit(
  points: CurvePoint[], v: Venue, legCount: number, total: bigint, book: Address = PLAN_BOOK,
): Promise<BuiltPlan> {
  return buildCommitFromLegs(
    curveToPlan(points, { legCount, totalStake: total, minWeightShare: 0.05 }), v, total, book);
}

/**
 * The same commit, from Legs that are already decided.
 *
 * Draw mode derives them from a Curve and pixel mode from painted cells, but past
 * that point the transaction is identical — the on-chain payload is a `Direction`
 * and a `uint96` per Leg and knows nothing about which gesture produced it. Keeping
 * one builder is what guarantees the two modes cannot drift apart.
 */
export async function buildCommitFromLegs(
  legs: Leg[], v: Venue, total: bigint, book: Address = PLAN_BOOK,
): Promise<BuiltPlan> {
  if (!legs.length) throw new Error("a Plan needs at least one Leg");
  const sum = legs.reduce((a, l) => a + l.stake, 0n);
  if (sum !== total) throw new Error(`stake allocation off by ${sum - total} base units`);

  const market = await liveMarket(v);
  if (!market) throw new Error("no live market with enough headroom — try again in a moment");

  return {
    legs, total, market,
    calls: [
      { to: ADDR.tusdc as Address, value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [book, total] }) },
      { to: book, value: 0n,
        data: encodeFunctionData({ abi: planBookAbi, functionName: "commitPlan", args: [{
          marketCreator: v.marketCreator, rollTopic: v.rollTopic, seriesId: v.seriesId,
          openDelay: v.openDelay, minHeadroom: v.minHeadroom, gasLimit: 20_000_000n,
          marketId: market.marketId,
        }, legs.map((l) => (l.direction === "UP" ? 0 : 1)), legs.map((l) => l.stake)] }) },
    ],
  };
}
