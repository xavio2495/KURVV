import type { Address, Hex } from "viem";

/** One batched call inside a 7702 transaction. */
export interface BatchCall {
  to: Address;
  value: bigint;
  data: Hex;
}

/**
 * The wallet surface KURVV needs, so the commit path does not care whether it is
 * driving an embedded wallet or a local key. Two implementations: `privy` and
 * `local`. The local key is the demo path — it is funded.
 */
export interface WalletAdapter {
  kind: "privy" | "local";
  address: Address | null;
  /**
   * What to call this signer on screen.
   *
   * `kind` is not enough: "privy" covers both an embedded wallet created from an
   * email address and an external wallet the user already had, and telling someone
   * their MetaMask account is a "privy" wallet is simply wrong.
   */
  label: string;
  ready: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Plain contract write. */
  send: (call: BatchCall) => Promise<Hex>;
  /**
   * Execute several calls atomically as ONE user signature, via EIP-7702.
   * Implementations must handle the first-delegation gas trap themselves.
   */
  sendBatch: (calls: BatchCall[]) => Promise<Hex>;
  /** True when the account already delegates to our BatchExecutor. */
  isDelegated: () => Promise<boolean>;
}
