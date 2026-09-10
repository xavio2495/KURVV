import { INDEXER, venueOf, type Venue } from "./venues.ts";
import { USE_SDK } from "./dreamdex/flag.ts";

/**
 * A dense BTC price series, every point a real on-chain observation.
 *
 * WHERE THE POINTS COME FROM. The same dreamDEX indexer that serves the Event
 * Contracts also indexes the venue's spot CLOB, which runs a permanent
 * `WBTC/USDso` market. Every executed trade on it is a `Fill` row carrying a
 * price and a block timestamp. One point here is one trade that happened.
 *
 * MEASURED DENSITY (Shannon, 24h sample, 28 Aug): 7,686 fills over 86,400s =
 * **5.34 points/minute**, median gap 10s, p99 30s, worst gap 70s. Against the
 * previous source — one point per rolled Window — that is 5.3x on the 60s venue
 * and 80x on the 15m venue.
 *
 * WHY THIS IS THE SAME BTC THE LEGS SETTLE AGAINST, not a lookalike. Checked
 * against 60 consecutive 60s-venue Windows over an hour: each Window's on-chain
 * settlement reference versus the nearest spot fill (within 3s) agreed to a
 * median of -0.66 bps, worst case 3.73 bps. Same feed, same level.
 *
 * WHY NOT THE OTHER CANDIDATES, all measured and rejected:
 *  - Event Contract `Fill`/`Order` prices are the Up PROBABILITY in 6dp, not a
 *    BTC level. A 0.62 print says the market thinks UP is 62% likely; recovering
 *    a price from it needs the strike AND an implied-vol model. Unusable.
 *  - `Market.strike` is the real reference and IS populated on the 60s venue
 *    (1e2 scale), but it is 0 on the 15m venue, whose question text carries no
 *    number either. So it cannot be the series, and it arrives only once per
 *    Window anyway.
 *  - The BTC PERP market trades 0.19/min with a 225s median gap and sits ~19 bps
 *    off spot. Merging it would add noise, not resolution.
 *  - Spot `Candle` rows are derived from these same fills and their high/low
 *    carry no timestamp, so they are strictly less information.
 *  - `raw_events` returns empty on this deployment.
 *
 * NOTHING IS INTERPOLATED. Gaps are left as gaps.
 */

interface SpotMarket {
  id: string;
  /** 10^quoteDecimals, read from the indexer — never a literal. */
  divisor: bigint;
}

/** Spot base token for a venue's asset. Only BTC is live; WETH last traded 38h ago. */
// The spot book each asset is charted from. SOMI trades natively, the majors as
// wrapped tokens; all three are quoted in USDso on the same indexer.
const SPOT_BASE: Record<string, string> = { BTC: "WBTC", ETH: "WETH", SOMI: "SOMI" };

async function gql<T>(query: string): Promise<T> {
  const r = await fetch(INDEXER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = (await r.json()) as { data?: T; errors?: unknown };
  if (!j.data) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const spotCache = new Map<string, Promise<SpotMarket | null>>();

/**
 * Resolve the spot market by symbol at runtime.
 *
 * Its address is permanent, unlike the per-Window Event Contract pools, but
 * looking it up costs one cached query and keeps the address out of the source.
 */
export function spotMarket(asset: string): Promise<SpotMarket | null> {
  const base = SPOT_BASE[asset];
  if (!base) return Promise.resolve(null);
  const hit = spotCache.get(base);
  if (hit) return hit;

  const p = gql<{ Market: { id: string; quoteDecimals: number }[] }>(
    `{ Market(where:{marketType:{_eq:"SPOT"}, baseSymbol:{_eq:"${base}"},
        quoteSymbol:{_eq:"USDso"}}, limit:1){ id quoteDecimals } }`,
  )
    .then((d): SpotMarket | null => {
      const m = d.Market[0];
      return m ? { id: m.id, divisor: 10n ** BigInt(m.quoteDecimals) } : null;
    })
    .catch(() => {
      spotCache.delete(base); // a network blip must not poison the cache
      return null;
    });
  spotCache.set(base, p);
  return p;
}

/**
 * Every spot trade on the venue's asset since `sinceSec`, oldest first.
 *
 * Ordered `desc` in the query and reversed here so that a range longer than the
 * row cap keeps the MOST RECENT points rather than the oldest ones. Returns an
 * empty array rather than throwing when the market or the indexer is unavailable
 * — the caller keeps its last good series on screen.
 */
async function densePriceSeriesLegacy(
  venueKey: Venue["key"],
  sinceSec: number,
): Promise<{ t: number; price: number }[]> {
  const spot = await spotMarket(venueOf(venueKey).asset);
  if (!spot) return [];

  let rows: { timestamp: string; fillPrice: string }[];
  try {
    const d = await gql<{ Fill: typeof rows }>(
      `{ Fill(where:{market_id:{_eq:"${spot.id}"}, timestamp:{_gt:"${Math.floor(sinceSec)}"}},
          order_by:{timestamp:desc}, limit:6000){ timestamp fillPrice } }`,
    );
    rows = d.Fill;
  } catch {
    return [];
  }

  // `fillPrice` is quote base units per WHOLE base token — reconciled against
  // quoteQuantity/quantity on live rows, not assumed. Split the division so the
  // integer part never touches a float.
  const out: { t: number; price: number }[] = [];
  let lastT = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = Number(rows[i].timestamp);
    const v = BigInt(rows[i].fillPrice);
    const price = Number(v / spot.divisor) + Number(v % spot.divisor) / Number(spot.divisor);
    // A taker sweeping several levels prints multiple fills in one block; the last
    // one is that second's closing print. Overwrite rather than stack them.
    if (t === lastT) out[out.length - 1] = { t, price };
    else { out.push({ t, price }); lastT = t; }
  }
  return out;
}

/**
 * The series, from the protocol's price feed or from spot fills.
 *
 * Measured over an hour of BTC on 10 Sep 2026: the feed gives 57.62 points a
 * minute against 5.48 here, with a median gap of 1s against 10s, and the two
 * agree on level to a median of 1.00 bps. See `dreamdex/price.ts` for the full
 * comparison and why the feed is the more correct source as well as the denser
 * one.
 */
export async function densePriceSeries(
  venueKey: Venue["key"],
  sinceSec: number,
): Promise<{ t: number; price: number }[]> {
  if (!USE_SDK) return densePriceSeriesLegacy(venueKey, sinceSec);
  return (await import("./dreamdex/price.ts")).densePriceSeries(venueKey, sinceSec);
}
