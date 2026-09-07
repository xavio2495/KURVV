"use client";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { useCallback, useMemo, useState, useEffect } from "react";
import { shannon } from "../chain";
import { isDelegatedTo } from "./batch";
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
    /**
     * REFUSES. Privy's embedded wallet cannot send an EIP-7702 batch.
     *
     * Two independent walls, both measured on Shannon rather than reasoned about:
     *
     * 1. It cannot SIGN the authorization through viem. An embedded wallet reached
     *    over EIP-1193 is a `json-rpc` account, and `walletClient.signAuthorization`
     *    rejects those outright — `Account type "json-rpc" is not supported.` was the
     *    first real commit's error, thrown before anything was sent.
     *
     * 2. Signing it elsewhere does not help, because it cannot SEND a type-4
     *    transaction either. Privy's `UnsignedTransactionRequest` has no
     *    `authorizationList` field, so the field is dropped silently: the wallet sent
     *    a plain type-2 transaction to the user's own undelegated address, which is a
     *    no-op that SUCCEEDS. Privy showed "Transaction complete!", ~221k gas was
     *    burnt, and on-chain there was no delegation, no Plan and no tUSDC moved.
     *
     * Sponsoring the type-4 from the server is closed too: `BatchExecutor.execute`
     * requires `msg.sender == address(this)`, so a server-submitted batch reverts
     * `OnlySelf()`. Opening that up would hand a relayer the right to drive any
     * delegated account — a worse trade than a second signature.
     *
     * THROWING IS THE POINT. `sendBatch` means ATOMIC, and quietly sending the calls
     * one after another would hand the caller a weaker guarantee than it asked for
     * under the same name. A caller that can live without atomicity says so by
     * sending each call itself — which `usePlan` does, and which is also what lets it
     * re-read the live Window between the two. See `BuiltPlan.commit`.
     */
    sendBatch: async () => {
      throw new Error("this wallet cannot batch — send the calls individually");
    },
  };
}
