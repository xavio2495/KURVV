"use client";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { useCallback, useMemo, useState, useEffect } from "react";
import { shannon } from "../chain";
import { sendBatchVia7702, isDelegatedTo } from "./batch";
import type { BatchCall, WalletAdapter } from "./types";

/**
 * The Privy embedded-wallet adapter.
 *
 * FUNDING GAP, stated plainly: a fresh embedded wallet has neither tUSDC nor STT.
 * tUSDC self-mints, so the app offers a faucet button. STT for gas comes from
 * Somnia's external faucet and cannot be triggered from here, so a brand-new Privy
 * user cannot transact until they fund gas themselves. Gas sponsorship is deliberately
 * out of scope this week; the local-key adapter is the demo path.
 */
export function usePrivyAdapter(): WalletAdapter {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [addr, setAddr] = useState<Address | null>(null);

  // The embedded wallet specifically — not a browser extension the user happens to have.
  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === "privy") ?? null,
    [wallets],
  );

  useEffect(() => {
    setAddr((embedded?.address as Address | undefined) ?? null);
  }, [embedded]);

  const client = useCallback(async () => {
    if (!embedded) throw new Error("no embedded wallet");
    const provider = (await embedded.getEthereumProvider()) as EIP1193Provider;
    return createWalletClient({ account: embedded.address as Address, chain: shannon, transport: custom(provider) });
  }, [embedded]);

  return {
    kind: "privy",
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
