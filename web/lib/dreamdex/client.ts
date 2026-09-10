import { SomniaMarkets, type SomniaMarketsClient } from "@somnia-chain/markets-sdk";
import { ADDRESSES, CHAIN, INDEXER_URL, PRICE_FEED, WS_RPC_URL } from "./config.ts";

/**
 * One SDK instance for the whole app.
 *
 * A SINGLETON IS NOT A STYLE CHOICE HERE. The client owns a websocket to the
 * chain — the live tail subscribes to logs and new heads over it, and every
 * on-chain read goes down the same transport. Constructing one per component
 * mount opens a socket per mount, and React's development double-mount makes
 * that two before anything has rendered twice. So: one instance, created lazily
 * on first use, torn down explicitly.
 *
 * LAZILY, because module scope runs during the server render too. Nothing here
 * should dial a websocket while Next is producing HTML.
 *
 * TWO TIERS, ONE INSTANCE. `SomniaMarkets` is the unified, symbol-keyed layer;
 * `.client` underneath it is the address- and marketId-keyed engine. KURVV wants
 * the engine almost everywhere — it selects a Window by venue, series and
 * expiry, not by symbol — so `sdk()` is the escape hatch and `exchange()` is
 * there for the few places a symbol is genuinely the right key.
 */

let instance: SomniaMarkets | null = null;

function exchangeInstance(): SomniaMarkets {
  let x = instance;
  if (!x) {
    x = new SomniaMarkets({
      indexerUrl: INDEXER_URL,
      chain: CHAIN,
      // Undefined on purpose: the SDK's chain definition already carries a
      // websocket endpoint, and overriding it with a literal is how the URL in
      // `venues.ts` and the URL actually dialled drift apart.
      wsRpcUrl: WS_RPC_URL,
      addresses: ADDRESSES,
      priceFeed: PRICE_FEED,
    });
    instance = x;
  }
  return x;
}

/** The unified, symbol-keyed layer. Rarely what KURVV wants — see `sdk()`. */
export const exchange = exchangeInstance;

/** The engine: bigint-exact, keyed by address and marketId. The default. */
export function sdk(): SomniaMarketsClient {
  return exchangeInstance().client;
}

/**
 * Release every watch and channel and stop the live machinery.
 *
 * The instance stays usable for one-shot fetches afterwards, which is the right
 * shape for a page teardown. Do NOT call it on every consumer unmount: watch
 * handles are reference-counted and `WatchHandle.stop()` is the per-consumer
 * release.
 */
export async function stopDreamdexLive(): Promise<void> {
  await instance?.close();
}

/**
 * Drop the singleton entirely. Tests and hot-reload only.
 *
 * Deliberately separate from `stopDreamdexLive`: a page that tears down and then
 * reads is silently building a second socket, and that should be a decision
 * someone typed rather than a side effect.
 */
export async function resetDreamdex(): Promise<void> {
  await instance?.close();
  instance = null;
}
