import type { Venue } from "../venues.ts";
import { sdk } from "./client.ts";

/**
 * The chart's price reference: what each rolled Window settles against.
 *
 * TWO VENUES, TWO ENCODINGS, AND THE OLD CODE ONLY UNDERSTOOD ONE.
 *
 * A binary market resolves in one of two `mode`s, and the indexer says which:
 *
 *   mode "fixed"      the question names a price — "at or above 77970.95" — and
 *                     the row's `strike` carries it. `getOpeningPrices` returns
 *                     NOTHING for these: there is no reference question to answer.
 *   mode "reference"  the question is "closes at or above its OPENING price".
 *                     `strike` is 0 as a sentinel and the number lives in the
 *                     reference question's answer, which is what
 *                     `getOpeningPrices` returns.
 *
 * KURVV's fast venue is `fixed`; its rolling venue is `reference`. So the
 * migration note that said to "prefer `getOpeningPrices` over the strike field"
 * had it backwards for the venue the demo runs on — adopting it as written would
 * have emptied the reference line on the fast venue and left the rolling one
 * still empty. Reading `mode` serves both, and the rolling venue gains a
 * reference series it has never had by either route.
 */

/**
 * The scale of the indexer's `strike` column: hundredths.
 *
 * Verified against the question text on the fast venue — `strike = 7797095`
 * under "at or above 77970.95". This is the INDEXER's normalised column, which
 * is why it is a constant here and the oracle's own scale below is not.
 */
const STRIKE_SCALE = 100;

/**
 * Oracle decimals, per venue, resolved from the chain.
 *
 * NOT A CONSTANT, AND THIS IS THE WHOLE POINT. `getOpeningPrices` returns the
 * oracle's raw `numericValue`, and the protocol's own docs say to format it with
 * the market's oracle price scale because adapters differ. Measured 10 Sep 2026:
 *
 *   fast venue     adapter 0x78bc8E82…   decimals 18
 *   rolling venue  adapter 0xe40db387…   decimals 2
 *
 * A hardcoded ÷100 happens to be right for the rolling venue and wrong by a
 * factor of 10^16 for the fast one. That is the same shape as the collateral-
 * decimals trap, one layer down, so it gets the same treatment: read it.
 *
 * Cached per MarketCreator — the adapter is a venue property, so one probe
 * serves a whole series.
 */
const oracleDecimals = new Map<string, Promise<number | null>>();

function adapterDecimals(v: Venue, resolvedMarketId: `0x${string}`): Promise<number | null> {
  const key = v.marketCreator.toLowerCase();
  let p = oracleDecimals.get(key);
  if (!p) {
    p = sdk().getOnchainResolutionPrice(resolvedMarketId)
      .then((r) => r?.decimals ?? null)
      .catch(() => null);
    oracleDecimals.set(key, p);
  }
  return p;
}

/** Real on-chain settlement references: the price each rolled Window resolves against. */
export async function rollPriceSeries(
  v: Venue, sinceSec: number,
): Promise<{ t: number; price: number }[]> {
  // PAST **AND** LIVE. `listPastBinaryMarkets` excludes the window currently
  // running, and that window's reference is precisely the one the user is about
  // to trade into — dropping it left the chart's line ending a full interval
  // short of now, which on the 60s venue is a visible gap at the right edge.
  //
  // Newest-first with a limit, then sorted ascending at the end. Asking for the
  // oldest 400 instead would chart a window of history that ends a day ago on a
  // fast series.
  const filter = { creator: v.marketCreator, asset: v.asset, intervalSec: v.intervalSec, limit: 400 };
  const [past, live] = await Promise.all([
    sdk().listPastBinaryMarkets(filter),
    sdk().listLiveBinaryMarkets(filter),
  ]);
  const byId = new Map([...past, ...live].map((m) => [m.marketId.toLowerCase(), m]));
  const rows = [...byId.values()].filter((m) => Number(m.tradingStart) > sinceSec);

  const out: { t: number; price: number }[] = [];

  const fixed = rows.filter((m) => m.mode === "fixed");
  for (const m of fixed) {
    const p = Number(m.strike ?? 0) / STRIKE_SCALE;
    if (Number.isFinite(p) && p > 0) out.push({ t: Number(m.tradingStart), price: p });
  }

  const reference = rows.filter((m) => m.mode === "reference");
  if (reference.length) {
    const dp = await adapterDecimals(v, reference[0].marketId);
    if (dp !== null) {
      // One batched pair of round-trips for the whole series, not one per row.
      const opening = await sdk().getOpeningPrices(reference.map((m) => m.marketId));
      const scale = 10 ** dp;
      for (const m of reference) {
        const raw = opening[m.marketId.toLowerCase()];
        if (raw === null || raw === undefined) continue;
        const p = Number(raw) / scale;
        if (Number.isFinite(p) && p > 0) out.push({ t: Number(m.tradingStart), price: p });
      }
    }
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}
