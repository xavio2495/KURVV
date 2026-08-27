import { encodeFunctionData, type Account, type Address, type Hex, type WalletClient } from "viem";
import { batchExecutorAbi } from "../abi";
import { pub } from "../chain";
import type { BatchCall } from "./types";

export const BATCH_EXECUTOR = (process.env.NEXT_PUBLIC_BATCH_EXECUTOR ??
  "0x8aee0794ad361258422d96e70df13624fa92e5cd") as Address;

/** The 7702 delegation indicator EIP-7702 writes onto a delegated account. */
const indicator = (delegate: Address) => `0xef0100${delegate.slice(2)}`.toLowerCase();

export async function isDelegatedTo(account: Address, delegate = BATCH_EXECUTOR) {
  const code = await pub.getCode({ address: account });
  return !!code && code.toLowerCase() === indicator(delegate);
}

/**
 * Send a batch as one transaction.
 *
 * THE FIRST-COMMIT TRAP. On the transaction that INSTALLS the delegation, the node
 * estimates gas against pre-delegation state — where calling the account is a no-op
 * costing ~21k — so the transaction is under-provisioned and the inner call dies with
 * an empty revert. Every judge trying this for the first time would hit it. We pass an
 * explicit gas limit on that first transaction only; afterwards the delegation
 * persists and ordinary estimation is correct.
 */
export async function sendBatchVia7702(
  wallet: WalletClient,
  /**
   * Pass the ACCOUNT, not just its address. A bare address is a JSON-RPC account, so
   * viem routes to `eth_sendTransaction` — which a plain HTTP transport does not
   * serve, and the commit fails with "method does not exist". A local account object
   * makes viem sign locally and use `eth_sendRawTransaction`. The Privy adapter DOES
   * pass an address, because its injected provider serves `eth_sendTransaction`.
   */
  account: Account | Address,
  calls: BatchCall[],
  firstCommitGas = 12_000_000n,
): Promise<Hex> {
  const data = encodeFunctionData({ abi: batchExecutorAbi, functionName: "execute", args: [calls] });
  const addr = (typeof account === "string" ? account : account.address) as Address;
  const already = await isDelegatedTo(addr);

  if (already) {
    return wallet.sendTransaction({ account, chain: null, to: addr, data } as never);
  }

  const authorization = await wallet.signAuthorization({
    account, contractAddress: BATCH_EXECUTOR, executor: "self",
  } as never);

  return wallet.sendTransaction({
    account, chain: null, to: addr, data,
    authorizationList: [authorization],
    gas: firstCommitGas, // see above — must not be estimated
  } as never);
}
