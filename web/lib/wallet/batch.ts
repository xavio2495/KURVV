import { encodeFunctionData, type Address, type Hex, type WalletClient } from "viem";
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
  account: Address,
  calls: BatchCall[],
  firstCommitGas = 12_000_000n,
): Promise<Hex> {
  const data = encodeFunctionData({ abi: batchExecutorAbi, functionName: "execute", args: [calls] });
  const already = await isDelegatedTo(account);

  if (already) {
    return wallet.sendTransaction({ account, chain: null, to: account, data } as never);
  }

  const authorization = await wallet.signAuthorization({
    account, contractAddress: BATCH_EXECUTOR, executor: "self",
  } as never);

  return wallet.sendTransaction({
    account, chain: null, to: account, data,
    authorizationList: [authorization],
    gas: firstCommitGas, // see above — must not be estimated
  } as never);
}
