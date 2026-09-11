import { venueOf, type Venue } from "../venues.ts";
import { sdk } from "./client.ts";

/**
 * The chart's price series, from the protocol's own price feed.
 *
 * WHAT THIS REPLACES, AND WHY IT IS BETTER RATHER THAN MERELY NEWER.
 *
 * `lib/priceSeries.ts` derives the series from executed trades on the venue's
 * spot `WBTC/USDso` CLOB. That was a well-argued choice — it beat the previous
 * source by 5.3x and its level was checked against on-chain settlement
 * references to a median of -0.66 bps. It is replaced here on the same terms,
 * measured the same way over one hour of BTC on 10 Sep 2026:
 *
 *   SDK price feed        3456 points   57.62 pts/min   median gap  1s   p99  2s   worst  7s
 *   spot fills (current)   328 points    5.48 pts/min   median gap 10s   p99 22s   worst 40s
 *
 * A 10.5x increase in density, and the two agree on level to a median of
 * 1.00 bps with a worst case of 2.81 bps — the same price, sampled far more
 * often. On a sixty-second Window that is the difference between a line that
 * steps and a line that moves.
 *
 * It is also the RIGHT source rather than a good proxy. `PriceFeedScheduler` is
 * the oracle feed the markets settle against; the spot CLOB is a separate
 * market that happens to track it closely. Charting the thing the bet is
 * actually about removes a correlation assumption from the product.
 *
 * NOTHING IS INTERPOLATED. Gaps are left as gaps, exactly as before.
 */

/**
 * Points for an asset since `sinceSec`, oldest first.
 *
 * Signature-compatible with `densePriceSeries` in `lib/priceSeries.ts` so the
 * swap is one dispatch and no call-site changes.
 *
 * Returns an empty array rather than throwing when the feed is unavailable —
 * the caller keeps its last good series on screen.
 */
export async function densePriceSeries(
  venueKey: Venue["key"],
  sinceSec: number,
): Promise<{ t: number; price: number }[]> {
  const asset = venueOf(venueKey).asset;
  let rows: { blockTimestamp: number; price: number }[];
  try {
    // Newest first, windowed by `from` in unix seconds (chain time).
    rows = await sdk().fetchPriceHistory(asset, { from: Math.floor(sinceSec), limit: 5000 });
  } catch {
    return [];
  }

  // `price` arrives already scaled off the feed's 10^18 raw value. `raw` is
  // there if an exact integer is ever needed; a chart coordinate is not that.
  const out: { t: number; price: number }[] = [];
  let lastT = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = Number(rows[i].blockTimestamp);
    const price = Number(rows[i].price);
    if (!Number.isFinite(price) || price <= 0 || t <= sinceSec) continue;
    // The feed can post more than once in a second. The last one is that
    // second's closing observation — overwrite rather than stack, which is the
    // same rule the spot-fill path applies to a taker sweeping several levels.
    if (t === lastT) out[out.length - 1] = { t, price };
    else { out.push({ t, price }); lastT = t; }
  }
  return out;
}

/**
 * The latest observation for an asset, or null.
 *
 * A single round-trip, for the fast head poll — the full series is thousands of
 * rows and cannot run every second.
 */
export async function latestPrice(asset: string): Promise<{ t: number; price: number } | null> {
  try {
    const p = await sdk().fetchPrice(asset);
    if (!p || !Number.isFinite(Number(p.price))) return null;
    return { t: Number(p.blockTimestamp), price: Number(p.price) };
  } catch {
    return null;
  }
}
