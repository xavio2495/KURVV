import { encodeFunctionData, type Address } from "viem";
import { erc20Abi, planBookAbi } from "./abi.ts";
import { ADDR, INDEXER, type Venue } from "./venues.ts";
import { feeNotice, resolveVenueId, venueFees, type VenueFees } from "./registry.ts";
import { USE_SDK } from "./dreamdex/flag.ts";
import { sideHasDepth } from "./dreamdex/book.ts";
import { pub } from "./chain.ts";
import { curveToPlan, type CurvePoint, type Leg } from "./curve.ts";
import type { BatchCall } from "./wallet/types.ts";

export const PLAN_BOOK = (process.env.NEXT_PUBLIC_PLAN_BOOK ?? "") as Address;

export interface LiveMarket {
  marketId: `0x${string}`;
  poolAddress: Address;
  expiry: number;
  tradingStart: number;
  /**
   * The scale THIS market settles in, straight off the indexer row.
   *
   * Carried rather than assumed so the venue's declared `quoteDecimals` has
   * something to be checked against before a stake is sized — see
   * `buildCommitFromLegs`. Both are on the row for free; disagreeing with the
   * chain about this is a factor-of-10^12 error that reverts nothing.
   */
  quoteDecimals: number;
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
async function liveMarketLegacy(
  v: Venue, tries = 32, marginSec = 3, needUp?: boolean,
): Promise<LiveMarket | null> {
  for (let i = 0; i < tries; i++) {
    const now = Math.floor(Date.now() / 1000);

    // A Leg-0 Window has to be old enough to have a book AND young enough to still
    // be open when the transaction lands. Both bounds were paid for on-chain.
    //
    // TOO YOUNG is `LegSkipped(NoLiquidity)`. A rolled Window opens with an EMPTY
    // book on both sides; the venue's maker posts its first quotes ~9s after
    // `tradingStart`. The Reactivity handler already respects this — that is what
    // `openDelay` is for — but `commitPlan` opens Leg 0 inline and does not get that
    // delay for free, so the CLIENT has to apply it when choosing the Window.
    //
    // TOO OLD is `LegSkipped(WindowTooShort)`: `_openLeg` refuses a Window with less
    // than `minHeadroom` left, and `marginSec` is whatever we expect to spend
    // between here and the block.
    //
    // Both were observed in sequence on the 60s venue: fixing the tail turned reason
    // 7 into reason 8, because preferring the freshest Window walked straight into
    // the empty book. On that venue the two bounds leave roughly
    // `[tradingStart+22, tradingStart+40]` — about 18 of every 60 seconds — which is
    // why the retry budget is generous rather than tight: measured on the 60s venue,
    // only 20% of samples are eligible and the longest ineligible run is ~34s, so a
    // budget under about a minute would fail on a perfectly healthy series.
    const opened = now - v.openDelay;
    const cutoff = now + v.minHeadroom + marginSec;
    const venueId = await resolveVenueId(v);
    const d = await gql<{ Market: LiveMarket[] }>(`{ Market(where:{
      venueId:{_eq:"${venueId}"}, asset:{_eq:"${v.asset}"}, intervalSec:{_eq:"${v.intervalSec}"},
      finalized:{_eq:false}, expiry:{_gt:"${cutoff}"}, tradingStart:{_lte:"${opened}"}
    }, order_by:{expiry:asc}, limit:1){ marketId poolAddress expiry tradingStart quoteDecimals } }`);
    const m = d.Market[0];
    if (m) {
      const market = {
        ...m, expiry: Number(m.expiry), tradingStart: Number(m.tradingStart),
        quoteDecimals: Number(m.quoteDecimals),
      };
      // `needUp === undefined` means the caller is not opening a Leg into this
      // Window immediately and has nothing to pre-flight.
      if (needUp === undefined || (await sideHasDepth(market.poolAddress, needUp))) return market;
    }
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
 *
 * ASK ABOUT THE SERIES, NOT ABOUT THIS INSTANT. The obvious query — "is there an
 * unfinalised market with `minHeadroom` left on it" — answers a different question,
 * the one `liveMarket` asks on the commit path, and answering it here made the device
 * lie. A 60-second Window has no openable market for its last dozen seconds by
 * design, and the successor takes a few more to reach the indexer, so that predicate
 * measured DEAD in **37-43% of samples with runs up to 19 seconds** on a venue that
 * was rolling perfectly. At an 8s poll needing three misses, it tripped, and the
 * screen said "no BTC market is open" straight through a healthy series.
 *
 * Recency of the newest Window is the property actually being claimed, and it has no
 * blind spot: during the roll gap the predecessor is still the newest row and still
 * recent. Measured over 50 consecutive samples spanning several rolls: **zero
 * misses**, while the stalled 15-minute series (last Window 24h old) and dormant SOMI
 * (no Windows at all) both still read dead.
 *
 * Two intervals of slack absorbs the roll drift the indexer shows (898s and 3598s
 * windows) without letting a genuinely stopped series look alive for long.
 */
async function venueIsLiveLegacy(v: Venue): Promise<boolean> {
  const venueId = await resolveVenueId(v);
  const d = await gql<{ Market: { tradingStart: string }[] }>(`{ Market(where:{
    venueId:{_eq:"${venueId}"}, asset:{_eq:"${v.asset}"}, intervalSec:{_eq:"${v.intervalSec}"}
  }, order_by:{tradingStart:desc}, limit:1){ tradingStart } }`);
  const newest = d.Market[0];
  if (!newest) return false;
  const age = Math.floor(Date.now() / 1000) - Number(newest.tradingStart);
  return age < 2 * v.intervalSec + 30;
}

/** Real on-chain settlement references: the opening price of each rolled Window. */
async function rollPriceSeriesLegacy(v: Venue, sinceSec: number): Promise<{ t: number; price: number }[]> {
  const venueId = await resolveVenueId(v);
  const d = await gql<{ Market: { tradingStart: string; question: string; strike: string; marketId: string }[] }>(
    // Newest first, then reversed. Ascending with a limit takes the OLDEST 400 rows,
    // which on a 60-second series is under seven hours starting from `since` — so a
    // long horizon charted a window of history that ended a day ago.
    `{ Market(where:{venueId:{_eq:"${venueId}"}, asset:{_eq:"${v.asset}"},
        intervalSec:{_eq:"${v.intervalSec}"}, tradingStart:{_gt:"${sinceSec}"}},
        order_by:{tradingStart:desc}, limit:400){ tradingStart question strike marketId } }`);
  /**
   * READ THE TYPED FIELD, not the sentence.
   *
   * This used to regex a number out of `question`, which dreamDEX's own gotchas page
   * tells you not to do: the wording has changed several times. It is also
   * unnecessary — `strike` carries the same number, in hundredths. Verified against
   * live rows on the fast venue: `strike = 7993155` under a question reading "at or
   * above 79931.55". A wording change would have silently emptied this series with no
   * error anywhere, which on a recorded demo is a blank reference line.
   *
   * TWO ENCODINGS SHARE THE FIELD, so the text parse survives as a fallback rather
   * than being deleted. The fast venue publishes real strikes; the rolling venue uses
   * `strike = 0` as a sentinel for "closes at or above its OPENING price", and its
   * question carries no number either — so that venue yields no reference series by
   * either route, and always did. Nothing regressed; it is now visible why.
   */
  const out: { t: number; price: number }[] = [];
  for (const m of d.Market) {
    const strike = Number(m.strike ?? 0);
    let p = Number.isFinite(strike) && strike > 0 ? strike / 100 : NaN;
    if (!Number.isFinite(p)) {
      const hit = /([0-9][0-9,]*\.?[0-9]*)/.exec(m.question?.replace(/^[^0-9]*/, "") ?? "");
      p = hit ? Number(hit[1].replace(/,/g, "")) : NaN;
    }
    if (Number.isFinite(p) && p > 0) out.push({ t: Number(m.tradingStart), price: p });
  }
  out.reverse();
  return out;
}

/**
 * The chart's price reference — legacy strike-parsing or the SDK.
 *
 * The SDK path reads the typed `mode` field and serves BOTH encodings: `strike`
 * for fixed-strike markets and the reference question's answer for the rest.
 * The legacy path only ever understood the first, which is why the rolling venue
 * has never had a reference line.
 */
export async function rollPriceSeries(
  v: Venue, sinceSec: number,
): Promise<{ t: number; price: number }[]> {
  if (!USE_SDK) return rollPriceSeriesLegacy(v, sinceSec);
  return (await import("./dreamdex/series.ts")).rollPriceSeries(v, sinceSec);
}

/**
 * Window discovery — legacy GraphQL or the SDK, chosen by flag.
 *
 * The exported names are unchanged so `usePlan`, `useWindowClock`, the play page
 * and `DeviceStage` are untouched by the swap. That is the point: the migration
 * step is one boolean wide, and reverting it is one boolean wide too.
 */
/**
 * IMPORTED DYNAMICALLY, and that is not a micro-optimisation.
 *
 * Pulling `dreamdex/markets` in statically put the whole SDK — and the wallet
 * stack it carries — into /play's first load: 402 kB to 504 kB, measured. None
 * of it is needed to render the device or run the canvas; it is needed the
 * moment someone goes looking for a Window. So it loads then.
 *
 * It also makes the flag genuinely free while it is off, which is what lets this
 * step be reverted by flipping one boolean rather than by reverting a commit.
 */
async function viaSdk() {
  return import("./dreamdex/markets.ts");
}

export async function liveMarket(
  v: Venue, tries = 32, marginSec = 3, needUp?: boolean,
): Promise<LiveMarket | null> {
  if (!USE_SDK) return liveMarketLegacy(v, tries, marginSec, needUp);
  return (await viaSdk()).liveMarket(v, tries, marginSec, needUp);
}

export async function venueIsLive(v: Venue): Promise<boolean> {
  if (!USE_SDK) return venueIsLiveLegacy(v);
  return (await viaSdk()).venueIsLive(v);
}

export { sideHasDepth };

export interface BuiltPlan {
  legs: Leg[];
  total: bigint;
  /** The Window Leg 0 will open into, as chosen at build time. */
  market: LiveMarket;
  /** Approve EXACTLY the total. Depends on nothing time-sensitive. */
  approve: BatchCall;
  /**
   * `commitPlan` against a given Window — deliberately a function of the market.
   *
   * WHY THIS IS LATE-BOUND. `commitPlan` opens Leg 0 immediately, and `_openLeg`
   * skips with `WindowTooShort` when `expiry < block.timestamp + minHeadroom`. On the
   * 60-second venue `minHeadroom` is 12s, so a `marketId` chosen more than a few
   * seconds before the transaction lands is a coin flip. Baking it into a fixed call
   * array at build time was fine while the commit was ONE transaction landing ~3s
   * later; it stopped being fine the moment a wallet that cannot batch had to send an
   * approval first and wait for its receipt. That cost a real Leg 0 to
   * `LegSkipped(WindowTooShort)`. Callers that sequence must re-read `liveMarket` and
   * call this again, as late as possible.
   */
  commit: (market: LiveMarket) => BatchCall;
  /** The atomic pair, for a wallet that can actually batch. */
  calls: BatchCall[];
  /** The venue's fee schedule as the registry reports it, or null if it has no row. */
  fees: VenueFees | null;
  /**
   * A sentence to show the user when the venue has stopped being free.
   *
   * Null in every case measured so far, which is exactly why it is read rather
   * than assumed: the day it is not null, every payout already on screen is an
   * overstatement.
   */
  feeNotice: string | null;
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

  // Leg 0 opens inside `commitPlan`, so the Window it lands in has to be one that
  // Leg 0's OWN direction can fill. Passing the direction is what turns a generic
  // "is anything trading" into "can this actually be bought".
  const market = await liveMarket(v, 32, 3, legs[0].direction === "UP");
  if (!market) throw new Error("no tradeable window for the first leg — try again in a moment");

  /**
   * THE STAKES WERE SIZED IN THE VENUE'S SCALE. Check the market agrees before
   * any of them is signed for.
   *
   * A stake is a `uint96` of collateral base units, so it only means what it is
   * meant to mean if the market settles at the number of decimals the venue
   * declared. Get that wrong and nothing reverts — the Plan simply stakes
   * 10^12 times too much or too little. Refusing is correct here: there is no
   * safe way to guess which of the two numbers is the real one, and both live
   * venues have agreed on every read.
   */
  if (market.quoteDecimals !== v.quoteDecimals) {
    throw new Error(
      `venue ${v.key} is configured for ${v.quoteDecimals}dp collateral but its live market ` +
      `settles in ${market.quoteDecimals}dp — refusing to size a stake against a scale that moved`);
  }

  // Read the fee schedule rather than assuming the zeros the docs promise.
  const fees = await venueFees(await resolveVenueId(v));
  const notice = feeNotice(fees);
  if (notice) console.warn(`[kurvv] ${notice}`);

  const approve: BatchCall = {
    to: ADDR.tusdc as Address, value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [book, total] }),
  };
  const commit = (m: LiveMarket): BatchCall => ({
    to: book, value: 0n,
    data: encodeFunctionData({ abi: planBookAbi, functionName: "commitPlan", args: [{
      marketCreator: v.marketCreator, rollTopic: v.rollTopic, seriesId: v.seriesId,
      openDelay: v.openDelay, minHeadroom: v.minHeadroom, gasLimit: 20_000_000n,
      marketId: m.marketId,
    }, legs.map((l) => (l.direction === "UP" ? 0 : 1)), legs.map((l) => l.stake)] }),
  });

  return { legs, total, market, approve, commit, calls: [approve, commit(market)], fees, feeNotice: notice };
}
