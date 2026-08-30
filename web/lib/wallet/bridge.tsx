"use client";
import { usePrivyAdapter } from "./privy";
import { WalletCtx } from "./index";

/**
 * Publishes the Privy adapter into the wallet context.
 *
 * Separate from `./index` on purpose: this file imports the Privy SDK, and `./index`
 * is reachable from `providers.tsx` on every page. Keeping the import here is what
 * holds the SDK inside the lazily-loaded chunk.
 */
export function PrivyBridge({ children }: { children: React.ReactNode }) {
  const adapter = usePrivyAdapter();
  return <WalletCtx.Provider value={adapter}>{children}</WalletCtx.Provider>;
}
