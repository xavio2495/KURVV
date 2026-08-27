"use client";
import { createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { shannon } from "../chain";
import { sendBatchVia7702, isDelegatedTo } from "./batch";
import type { BatchCall, WalletAdapter } from "./types";

/**
 * The local-key adapter. This is the DEMO path: the funded wallet everything is
 * filmed on. The key is supplied at build time and is a testnet key only.
 */
export function createLocalAdapter(): WalletAdapter {
  const raw = process.env.NEXT_PUBLIC_LOCAL_KEY?.trim().replace(/^["']|["']$/g, "");
  const key = raw ? ((raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`) : null;
  const account = key ? privateKeyToAccount(key) : null;
  const wallet = account ? createWalletClient({ account, chain: shannon, transport: http() }) : null;

  return {
    kind: "local",
    address: (account?.address ?? null) as Address | null,
    ready: !!account,
    connect: async () => {},
    disconnect: async () => {},
    isDelegated: async () => (account ? isDelegatedTo(account.address) : false),
    send: async (c: BatchCall) => {
      if (!wallet || !account) throw new Error("local key not configured");
      return wallet.sendTransaction({ account, chain: null, to: c.to, value: c.value, data: c.data });
    },
    sendBatch: async (calls: BatchCall[]) => {
      if (!wallet || !account) throw new Error("local key not configured");
      return sendBatchVia7702(wallet, account.address, calls);
    },
  };
}
