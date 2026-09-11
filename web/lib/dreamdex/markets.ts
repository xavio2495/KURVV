import type { Address } from "viem";
import type { Venue } from "../venues.ts";
import { sdk } from "./client.ts";
import { sideHasDepth } from "./book.ts";

/**
 * Window discovery, through the protocol's own client.
 *
 * Replaces three hand-written Hasura queries in `commit.ts`. The QUERIES change;
 * the POLICY does not — the three eligibility bounds below were paid for on
 * chain and the SDK knows nothing about them.
 */

export interface LiveMarket {
  marketId: `0x${string}`;
  poolAddress: Address;
  expiry: number;
  tradingStart: number;
  quoteDecimals: number;
}

/** MarketStatus: 0 Listed · 1 Trading · 2 Locked · 3 Settling · 4 Resolved · 5 Voided */
const TRADING = 1;

/**
 * Why a candidate Window was rejected. Only for the migration harness — it is
 * what lets a difference against the legacy path be ATTRIBUTED rather than
 * merely noticed.
 */
export type RejectReason = "none" | "no-candidate" | "not-trading-onchain" | "no-depth";

/**
 * The currently-Trading market for a venue's series.
 *
 * FILTERED BY `creator`, NOT BY `venueId`. The MarketCreator is the permanent
 * identifier — the protocol's own docs say pool and market addresses are
 * window-specific and recycled, and venue ids have moved three times — so
 * asking the SDK for "markets this creator rolled" removes the resolution step
 * `registry.ts` had to do by hand against raw GraphQL.
 *
 * The indexer lags the chain by seconds, so right after a roll the successor is
 * briefly invisible while the predecessor has already expired. On a 60s Window
 * that blind spot is a real fraction of the cycle — retry rather than fail.
 */
export async function liveMarket(
  v: Venue, tries = 32, marginSec = 3, needUp?: boolean,
  onReject?: (r: RejectReason, marketId?: string) => void,
): Promise<LiveMarket | null> {
  for (let i = 0; i < tries; i++) {
    const now = Math.floor(Date.now() / 1000);

    // A Leg-0 Window has to be old enough to have a book AND young enough to
    // still be open when the transaction lands. Both bounds were paid for
    // on-chain and both stay exactly as `commit.ts` had them.
    //
    // TOO YOUNG is `LegSkipped(NoLiquidity)`: a rolled Window opens with an
    // EMPTY book on both sides and the venue's maker posts its first quotes ~9s
    // after `tradingStart`. The Reactivity handler gets `openDelay` for free;
    // `commitPlan` opens Leg 0 inline and does not, so the CLIENT applies it.
    //
    // TOO OLD is `LegSkipped(WindowTooShort)`: `_openLeg` refuses a Window with
    // less than `minHeadroom` left, and `marginSec` is what we expect to spend
    // between here and the block.
    //
    // On the 60s venue the two bounds leave roughly [tradingStart+22,
    // tradingStart+40] — about 18 of every 60 seconds — which is why the retry
    // budget is generous rather than tight.
    const opened = now - v.openDelay;
    const cutoff = now + v.minHeadroom + marginSec;

    // `listLiveBinaryMarkets` is already `expiry > now`, soonest-first, so the
    // extra bounds narrow rather than reorder. A small page is enough: one
    // series has at most a couple of unexpired Windows at a time.
    const rows = await sdk().listLiveBinaryMarkets({
      creator: v.marketCreator, asset: v.asset, intervalSec: v.intervalSec, limit: 10,
    });

    const m = rows.find((r) =>
      !r.finalized && Number(r.expiry) > cutoff && Number(r.tradingStart) <= opened);

    if (!m) {
      onReject?.("no-candidate");
    } else {
      /**
       * GATE ON THE CHAIN, NOT ON THE INDEX.
       *
       * New in the SDK path and deliberately so. The indexer lags by seconds
       * and dreamDEX's own gotchas page puts this first: orders placed against
       * a market the index still calls live revert, or fail silently. The old
       * path had only `finalized:false` and an expiry bound to go on, which is
       * a proxy for the status rather than the status.
       */
      const onchain = await sdk().getMarketOnchain(m.marketId);
      if (onchain.status !== TRADING) {
        onReject?.("not-trading-onchain", m.marketId);
      } else {
        const market: LiveMarket = {
          marketId: m.marketId,
          poolAddress: onchain.pool,
          expiry: Number(m.expiry),
          tradingStart: Number(m.tradingStart),
          // From the chain rather than the row: `getMarketOnchain` reads the
          // collateral's own `decimals()`, which is the authority the row is a
          // copy of.
          quoteDecimals: onchain.decimals,
        };
        // `needUp === undefined` means the caller is not opening a Leg into this
        // Window immediately and has nothing to pre-flight.
        if (needUp === undefined || (await sideHasDepth(market.poolAddress, needUp))) {
          onReject?.("none", m.marketId);
          return market;
        }
        onReject?.("no-depth", m.marketId);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/**
 * Is this venue rolling right now?
 *
 * ASK ABOUT THE SERIES, NOT ABOUT THIS INSTANT — the whole point of the
 * predicate, and the reason it is not simply "is there an openable market".
 * That obvious version answers the question `liveMarket` asks on the commit
 * path, and answering it here made the device lie: a 60-second Window has no
 * openable market for its last dozen seconds by design, so it measured DEAD in
 * 37-43% of samples on a venue that was rolling perfectly.
 *
 * Recency of the newest Window has no such blind spot — during the roll gap the
 * predecessor is still the newest row and still recent. Two intervals of slack
 * absorbs the roll drift the indexer shows (898s and 3598s windows) without
 * letting a genuinely stopped series look alive for long.
 *
 * NOTE THE SOURCE CHANGE. The legacy query ordered ALL of a series' markets by
 * `tradingStart desc` and took one. `listLiveBinaryMarkets` only returns
 * unexpired ones, so a series whose last Window has already expired returns
 * nothing here where the old query returned a stale row and let the age test
 * judge it. Both answer "dead" for a stopped series; this one answers it a
 * couple of minutes sooner.
 */
export async function venueIsLive(v: Venue): Promise<boolean> {
  const rows = await sdk().listLiveBinaryMarkets({
    creator: v.marketCreator, asset: v.asset, intervalSec: v.intervalSec, limit: 10,
  });
  if (!rows.length) return false;
  const newest = rows.reduce((a, b) => (Number(a.tradingStart) >= Number(b.tradingStart) ? a : b));
  const age = Math.floor(Date.now() / 1000) - Number(newest.tradingStart);
  return age < 2 * v.intervalSec + 30;
}
