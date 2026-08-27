"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { shannon } from "../lib/chain";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export function Providers({ children }: { children: React.ReactNode }) {
  // Without an app id Privy cannot initialise; the local-key adapter still works, so
  // the app degrades to the demo path rather than failing to render.
  if (!APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["email", "wallet"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        defaultChain: shannon,
        supportedChains: [shannon],
        appearance: { theme: "dark", accentColor: "#f0a030" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
