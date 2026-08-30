"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { shannon } from "../lib/chain";
import { PrivyBridge } from "../lib/wallet/bridge";

/**
 * Everything that touches the Privy SDK, in one lazily-loaded chunk.
 *
 * WHY THIS IS A SEPARATE FILE. Privy pulls in every wallet connector it supports —
 * injected, WalletConnect, Coinbase — and importing it from the root provider put
 * the whole graph in the first-load bundle of every page: `/play` went from 387 kB
 * to 1.06 MB. A static import cannot be dropped by tree-shaking just because the
 * component that uses it sits behind an `if`, so the split has to be a real
 * boundary. `providers.tsx` loads this with `next/dynamic` only when there is an app
 * id to initialise it with.
 */
export default function PrivyRoot({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ""}
      config={{
        loginMethods: ["email", "wallet"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        defaultChain: shannon,
        supportedChains: [shannon],
        appearance: { theme: "dark", accentColor: "#f0a030" },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
