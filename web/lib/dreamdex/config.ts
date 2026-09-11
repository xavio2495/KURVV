import {
  SOMNIA_MAINNET_ADDRESSES, SOMNIA_TESTNET_ADDRESSES, SOMNIA_TESTNET_PRICE_FEED,
  type SomniaMarketsAddresses,
} from "@somnia-chain/markets-sdk";
import { getSomniaChain } from "@somnia-chain/markets-sdk/chains";
import type { Chain } from "viem";
import { ADDR, CHAIN_ID, INDEXER } from "../venues.ts";

/** Widened from the literal in `venues.ts` so a network comparison is legal. */
const chainId: number = CHAIN_ID;

/**
 * Where the protocol layer gets its addresses and endpoints.
 *
 * The point of this file is that KURVV stops being the authority on any of it.
 * The SDK ships the CREATE3 core in `SOMNIA_TESTNET_ADDRESSES` /
 * `SOMNIA_MAINNET_ADDRESSES` and the chain definitions in `./chains`, all of
 * which the protocol maintains and we do not.
 */

/**
 * The viem chain, from the SDK's own definitions.
 *
 * Its `rpcUrls.default.webSocket` already carries `wss://dream-rpc.somnia.network/ws`,
 * so `wsRpcUrl` on the client config is an override rather than a requirement —
 * viem's own `somniaTestnet` has no websocket entry and would need one.
 */
export const CHAIN: Chain = (() => {
  const c = getSomniaChain(CHAIN_ID);
  if (!c) throw new Error(`chain ${CHAIN_ID} is not a Somnia network the SDK ships`);
  return c;
})();

/** CREATE3 core, per network. Identical on 50312 and 5031 — the map is the protocol's. */
export const ADDRESSES: SomniaMarketsAddresses =
  chainId === 5031 ? SOMNIA_MAINNET_ADDRESSES : SOMNIA_TESTNET_ADDRESSES;

/**
 * The indexer. Overridable, because it is the one endpoint that has moved.
 */
export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || INDEXER;

/**
 * Optional websocket override. Empty means "use the chain definition's own",
 * which is what we want unless a deployment is pinned to a different provider.
 */
export const WS_RPC_URL = process.env.NEXT_PUBLIC_WS_RPC_URL || undefined;

/** The SDK's bundled testnet price feed — real BTC/ETH spot, not a market probability. */
export const PRICE_FEED = chainId === 5031 ? undefined : SOMNIA_TESTNET_PRICE_FEED;

/**
 * Do the SDK's addresses and KURVV's hand-pinned ones still agree?
 *
 * WHY THIS EXISTS RATHER THAN A DELETION. `lib/venues.ts` pins three addresses
 * that predate the SDK. Two of them — the module and the collateral — are in the
 * SDK's map, and they matched exactly when this was written. The safe migration
 * is not to delete our copies on faith but to keep them until every reader is
 * moved and let a divergence be loud in the meantime: these contracts are
 * PROXIES, so an upgrade moves behaviour without moving an address, and a map
 * that has drifted is precisely the thing nobody notices.
 *
 * `ADDR.outcome` is deliberately not checked — the ERC-6909 singleton is not in
 * the SDK's address map at all. It comes back per-market on
 * `getMarketOnchain().outcomeToken`, which is the better source anyway.
 *
 * Returns the mismatches rather than throwing: this must be able to run in a
 * diagnostic without taking the page down.
 */
export function addressDrift(): string[] {
  const out: string[] = [];
  const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  if (!same(ADDRESSES.binaryModule, ADDR.module))
    out.push(`binaryModule: SDK ${ADDRESSES.binaryModule} vs pinned ${ADDR.module}`);
  if (!same(ADDRESSES.collateral ?? ADDRESSES.testUsdc, ADDR.tusdc))
    out.push(`collateral: SDK ${ADDRESSES.collateral ?? ADDRESSES.testUsdc} vs pinned ${ADDR.tusdc}`);
  return out;
}

/**
 * The SDK's `marketCreator` is NOT one of ours.
 *
 * It is the factory the live tail watches so newly deployed markets are picked
 * up the block they land. KURVV's venues each name their own `MarketCreator`
 * (`venues.ts` → `SHELL`), and those are the addresses `PlanBook` subscribes to.
 * Passing the SDK's default here would watch the wrong factory, so the client
 * below leaves it unset rather than inheriting it.
 */
export const SDK_DEFAULT_MARKET_CREATOR = SOMNIA_TESTNET_ADDRESSES.marketCreator;
