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

/** Real on-chain settlement references: the opening price of each rolled Window. */
export async function rollPriceSeries(v: Venue, sinceSec: number): Promise<{ t: number; price: number }[]> {
  const d = await gql<{ Market: { tradingStart: string; question: string; marketId: string }[] }>(
    `{ Market(where:{venueId:{_eq:"${v.venueId}"}, asset:{_eq:"${v.asset}"},
        intervalSec:{_eq:"${v.intervalSec}"}, tradingStart:{_gt:"${sinceSec}"}},
        order_by:{tradingStart:asc}, limit:400){ tradingStart question marketId } }`);
  // The venue writes the reference into the question text; the typed strike field is
  // 0 for at-or-above markets. Parse defensively and drop anything unparseable.
  const out: { t: number; price: number }[] = [];
  for (const m of d.Market) {
    const hit = /([0-9][0-9,]*\.?[0-9]*)/.exec(m.question?.replace(/^[^0-9]*/, "") ?? "");
    const p = hit ? Number(hit[1].replace(/,/g, "")) : NaN;
    if (Number.isFinite(p) && p > 0) out.push({ t: Number(m.tradingStart), price: p });
  }
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
  const legs = curveToPlan(points, { legCount, totalStake: total, minWeightShare: 0.05 });
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
