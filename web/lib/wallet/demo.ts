"use client";
import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import type { BatchCall, WalletAdapter } from "./types";

/**
 * The demo-wallet adapter.
 *
 * It holds NO key. Every signature happens in the /api/demo route handler, because a
 * key handed to the browser through a NEXT_PUBLIC_ variable is inlined into the client
 * bundle and served to everyone — which is exactly what happened here once. The
 * browser sees an address and a transaction hash, never a key.
 */
export function useDemoAdapter(): WalletAdapter {
  const [address, setAddress] = useState<Address | null>(null);
  const [delegated, setDelegated] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/demo", { cache: "no-store" });
      const j = (await r.json()) as { address: Address | null; delegated: boolean };
      setAddress(j.address);
      setDelegated(j.delegated);
    } catch { setAddress(null); }
    setReady(true);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const post = async (body: unknown): Promise<Hex> => {
    const r = await fetch("/api/demo", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const j = (await r.json()) as { hash?: Hex; error?: string };
    if (!j.hash) throw new Error(j.error ?? "signing failed");
    return j.hash;
  };

  const enc = (c: BatchCall) => ({ to: c.to, value: c.value.toString(), data: c.data });

  return {
    kind: "local",
    address,
    ready,
    connect: async () => { await refresh(); },
    disconnect: async () => {},
    isDelegated: async () => delegated,
    send: (c: BatchCall) => post({ action: "send", call: enc(c) }),
    sendBatch: (calls: BatchCall[]) => post({ action: "sendBatch", calls: calls.map(enc) }),
  };
}
