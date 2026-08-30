"use client";
import { createContext, useContext } from "react";
import { useDemoAdapter } from "./demo";
import type { WalletAdapter } from "./types";

/**
 * WHICH SIGNER THE APP USES.
 *
 * Privy is the default. The demo signer is the fallback for a deployment with no
 * `NEXT_PUBLIC_PRIVY_APP_ID` — the guided demo page, a local checkout without Privy
 * credentials, and CI.
 *
 * THE CHOICE IS MADE BY THE COMPONENT TREE, NOT BY A BRANCH. `usePrivyAdapter` calls
 * `usePrivy()`, which throws outside a `PrivyProvider`, and hooks cannot be called
 * conditionally — so "use Privy only if it is configured" cannot be written as an
 * `if`. Instead `providers.tsx` lazily mounts `PrivyRoot` when there is an app id,
 * and the bridge inside it publishes its adapter here.
 *
 * THIS MODULE MUST NOT IMPORT THE PRIVY SDK. It is pulled in by `providers.tsx`,
 * which every page renders, so a static import here would put every wallet connector
 * back in the first-load bundle and undo the split. That is why `PrivyBridge` lives
 * in its own file and only `PrivyRoot` — itself dynamically imported — touches it.
 */
const Ctx = createContext<WalletAdapter | null>(null);

/** Shared with `./bridge`, which is the only other module allowed to touch it. */
export const WalletCtx = Ctx;

/** Build-time: does this deployment have Privy credentials at all? */
export const PRIVY_CONFIGURED = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/**
 * The signer on a Privy deployment before the SDK chunk has arrived.
 *
 * It reports "not ready" and refuses to sign. It must NEVER quietly become the demo
 * signer: on a deployment configured for Privy, a transaction signed by the server's
 * demo key would be charged to the wrong account and would not belong to the user who
 * pressed the key. Failing loudly for a few hundred milliseconds is the correct
 * behaviour; silently signing as someone else is not.
 */
const PENDING: WalletAdapter = {
  kind: "privy",
  label: "Connect",
  address: null,
  ready: false,
  connect: async () => {},
  disconnect: async () => {},
  isDelegated: async () => false,
  send: async () => { throw new Error("wallet is still loading"); },
  sendBatch: async () => { throw new Error("wallet is still loading"); },
};

export function useWallet(): WalletAdapter {
  const privy = useContext(Ctx);
  // Constructed either way — hooks are unconditional — but told not to make its round
  // trip to `/api/demo` when it is not the signer.
  const demo = useDemoAdapter(!PRIVY_CONFIGURED);
  if (PRIVY_CONFIGURED) return privy ?? PENDING;
  return demo;
}
