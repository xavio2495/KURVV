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
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
          /**
           * NO CONFIRMATION DIALOG ON THE EMBEDDED WALLET, and this is a correctness
           * fix as much as an ergonomic one.
           *
           * `commitPlan` opens Leg 0 immediately and `_openLeg` refuses a Window with
           * less than `minHeadroom` left — 12 SECONDS on the 60s venue. The `marketId`
           * is baked into the calldata the user signs, so every second between
           * choosing it and the block eats that budget. A dialog puts an UNBOUNDED
           * human delay in exactly that gap: measured runs lost Leg 0 to
           * `LegSkipped(WindowTooShort)` — reason code 7, read off-chain — twice in a
           * row, and no margin can cover a wait with no upper bound. Signing without
           * the dialog collapses the gap to a couple of seconds.
           *
           * It is also what makes the product feel like the console it looks like:
           * a Plan is 4-8 positions and the chain opens all of them unattended, so
           * stopping to confirm at commit is the one piece of friction the design
           * does not otherwise have.
           *
           * THE TRADE-OFF, stated: within a logged-in session this app can sign with
           * the embedded wallet without asking again. The user authorised that by
           * logging in; the app never holds the key, Privy does, and the wallet is
           * scoped to this app. An external wallet connected through Privy is
           * unaffected — it keeps its own confirmation, because it is not ours to
           * silence.
           */
          showWalletUIs: false,
        },
        defaultChain: shannon,
        supportedChains: [shannon],
        appearance: { theme: "dark", accentColor: "#f0a030" },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
