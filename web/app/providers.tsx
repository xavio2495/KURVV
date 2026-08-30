"use client";
import dynamic from "next/dynamic";
import { PRIVY_CONFIGURED } from "../lib/wallet";

/**
 * Privy loads in its own chunk, and only where it is configured.
 *
 * `ssr: false` because the SDK reaches for `window` on import, and there is nothing
 * to render on the server anyway — the wallet is a client concern end to end.
 */
const PrivyRoot = dynamic(() => import("./PrivyRoot"), { ssr: false });

export function Providers({ children }: { children: React.ReactNode }) {
  // Without an app id Privy cannot initialise, so the tree is mounted WITHOUT the
  // bridge and `useWallet` falls through to the demo signer. This early return is
  // also what keeps the SDK out of the bundle entirely on such a deployment.
  if (!PRIVY_CONFIGURED) return <>{children}</>;
  return <PrivyRoot>{children}</PrivyRoot>;
}
