"use client";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { useCallback, useMemo, useState, useEffect } from "react";
import { shannon } from "../chain";
import { sendBatchVia7702, isDelegatedTo } from "./batch";
import type { BatchCall, WalletAdapter } from "./types";

/**
 * The Privy adapter — the app's default signer.
 *
 * It covers BOTH onboarding routes behind one login, which is why there is no
 * separate wallet-connect integration in this repo: Privy's modal is configured with
 * `loginMethods: ["email", "wallet"]`, so an email address creates an embedded
 * wallet and an existing wallet connects through Privy's own injected/WalletConnect
 * handling. Two front doors, one adapter, one code path to the commit.
 *
 * THE EMBEDDED WALLET IS PREFERRED WHEN THERE IS ONE. A user who signed up with an
 * email may also happen to have an extension installed; the account that holds their
 * balances and their Plans is the embedded one, and silently signing from a
 * different address would look like their funds had vanished.
 *
 * FUNDING GAP, stated plainly: a fresh embedded wallet has neither tUSDC nor STT.
 * tUSDC self-mints, so the app offers a faucet. STT for gas comes from Somnia's
 * external faucet and cannot be triggered from here — see `usePlan`'s `fundGas` and
 * the `DEMO_FUND_GAS` flag for the drip that closes it on testnet.
 */
export function usePrivyAdapter(): WalletAdapter {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [addr, setAddr] = useState<Address | null>(null);

  // The embedded wallet if there is one, otherwise whatever the user connected.
  const active = useMemo(
    () => wallets.find((w) => w.walletClientType === "privy") ?? wallets[0] ?? null,
    [wallets],
  );

  useEffect(() => {
    setAddr((active?.address as Address | undefined) ?? null);
  }, [active]);

  const label = useMemo(() => {
    if (!active) return "Connect";
    if (active.walletClientType === "privy") return "Email wallet";
    // `metamask` -> `Metamask`, `coinbase_wallet` -> `Coinbase wallet`. Prettified
    // rather than mapped: Privy adds connectors and a lookup table would go stale
    // silently, showing a blank name for whichever one is newest.
    const raw = active.walletClientType.replace(/_/g, " ");
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [active]);

  const client = useCallback(async () => {
    if (!active) throw new Error("no wallet connected");
    const provider = (await active.getEthereumProvider()) as EIP1193Provider;
    return createWalletClient({ account: active.address as Address, chain: shannon, transport: custom(provider) });
  }, [active]);

  return {
    kind: "privy",
    label,
    address: addr,
    ready: ready && walletsReady,
    connect: async () => { if (!authenticated) login(); },
    disconnect: async () => { await logout(); },
    isDelegated: async () => (addr ? isDelegatedTo(addr) : false),
    send: async (c: BatchCall) => {
      const w = await client();
      return w.sendTransaction({ account: addr as Address, chain: null, to: c.to, value: c.value, data: c.data });
    },
    sendBatch: async (calls: BatchCall[]) => {
      const w = await client();
      return sendBatchVia7702(w, addr as Address, calls);
    },
  };
}
