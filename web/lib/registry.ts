import { INDEXER, type Venue } from "./venues.ts";

/**
 * What the protocol registry says about a venue, as opposed to what we pinned.
 *
 * Two things in `venues.ts` are written down as constants that the protocol
 * treats as mutable: the venue id, and the fee schedule. Both are cheap to read
 * and both have already changed once. This module reads them, memoised for the
 * life of the tab, and every read falls back to the pinned value rather than
 * failing — a dead indexer must not be able to stop a commit that would
 * otherwise work.
 */

async function gql<T>(query: string): Promise<T> {
  const r = await fetch(INDEXER, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = (await r.json()) as { data?: T; errors?: unknown };
  if (!j.data) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const venueIds = new Map<string, Promise<`0x${string}`>>();

/**
 * The venue id currently in force for a venue's `MarketCreator`.
 *
 * THE CREATOR IS THE PERMANENT THING, not the venue id. The protocol's own
 * contracts-and-addresses page says market and pool addresses are
 * window-specific and recycled and should be resolved from the registry rather
 * than hardcoded; the venue id is the same class of value and has behaved like
 * it. The ids moved three times in the first week of August 2026, and the one
 * dreamDEX's bot kit documents as *the* testnet venue holds 16 of the last
 * 1,000 markets — pinning it is how an app ends up quoting a venue nobody
 * trades.
 *
 * Keyed on the creator alone rather than on (creator, asset, interval): a venue
 * id is a property of the creator, so resolving it this way still works for a
 * series that is currently dormant. Verified 10 Sep 2026 — both live creators
 * resolve to exactly the ids pinned in `venues.ts`, so this is a check that
 * currently changes nothing, which is the point.
 */
export function resolveVenueId(v: Venue): Promise<`0x${string}`> {
  const key = v.marketCreator.toLowerCase();
  let p = venueIds.get(key);
  if (!p) {
    p = gql<{ Market: { venueId: `0x${string}` }[] }>(`{ Market(
      where:{creator:{_eq:"${v.marketCreator}"}},
      order_by:{tradingStart:desc}, limit:1){ venueId } }`)
      .then((d) => d.Market[0]?.venueId ?? v.venueId)
      // A creator that has never rolled (SOMI) has no row, and an unreachable
      // indexer has no answer. Neither is a reason to refuse to trade.
      .catch(() => v.venueId);
    venueIds.set(key, p);
  }
  return p;
}

/**
 * The fee schedule, in basis points.
 *
 * dreamDEX sets maker, taker and settlement to zero and its docs say so — but
 * the protocol SUPPORTS a one-time settlement fee on winning redemptions, the
 * fields exist, and every payout number KURVV renders assumes they are zero.
 * If that ever changes, an assumed zero makes every projection an overstatement
 * silently. Read it, expect zero, surface anything else.
 *
 * These live on `MarketVenue`, keyed by venue — not on the pool. Probed on
 * 10 Sep 2026: `settlementFeeBpsTimes1k()` and its siblings do not exist as pool
 * getters, and `getOrderBookParameters()` returns exactly three words
 * (tick, minQuantity, lot) with no fee among them.
 */
export interface VenueFees {
  makerFeeBps: bigint;
  takerFeeBps: bigint;
  settlementFeeBps: bigint;
  maxBuilderFeeBps: bigint;
  routingFeeBps: bigint;
}

const fees = new Map<string, Promise<VenueFees | null>>();

export function venueFees(venueId: `0x${string}`): Promise<VenueFees | null> {
  const key = venueId.toLowerCase();
  let p = fees.get(key);
  if (!p) {
    p = gql<{ MarketVenue: Record<keyof VenueFees, string>[] }>(`{ MarketVenue(
      where:{venueId:{_eq:"${venueId}"}}, limit:1){
      makerFeeBps takerFeeBps settlementFeeBps maxBuilderFeeBps routingFeeBps } }`)
      .then((d) => {
        const r = d.MarketVenue[0];
        if (!r) return null;
        return {
          makerFeeBps: BigInt(r.makerFeeBps ?? 0),
          takerFeeBps: BigInt(r.takerFeeBps ?? 0),
          settlementFeeBps: BigInt(r.settlementFeeBps ?? 0),
          maxBuilderFeeBps: BigInt(r.maxBuilderFeeBps ?? 0),
          routingFeeBps: BigInt(r.routingFeeBps ?? 0),
        };
      })
      .catch(() => null);
    fees.set(key, p);
  }
  return p;
}

/**
 * A sentence for the user when the venue stops being free, or null when it has
 * not.
 *
 * SETTLEMENT IS THE ONE THAT CHANGES A NUMBER ALREADY ON SCREEN. A maker or
 * taker fee shows up in the fill price, which KURVV reads back from the chain
 * as `entryPrice` and therefore reports correctly whatever it is. A settlement
 * fee is taken from the redemption, which nothing on screen has measured yet —
 * every projected payout would simply be too high.
 *
 * `null` fees mean the venue has no registry row at all, which is true of a
 * creator that has never rolled a market. Nothing to claim either way.
 */
export function feeNotice(f: VenueFees | null): string | null {
  if (!f) return null;
  if (f.settlementFeeBps > 0n)
    return `Heads up: this venue now charges ${f.settlementFeeBps} bps on settlement — payouts will be below the projection.`;
  if (f.makerFeeBps > 0n || f.takerFeeBps > 0n || f.routingFeeBps > 0n)
    return `Heads up: this venue now charges trading fees (maker ${f.makerFeeBps} / taker ${f.takerFeeBps} bps).`;
  return null;
}
