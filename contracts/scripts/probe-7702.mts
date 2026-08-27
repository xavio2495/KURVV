/** Does Shannon accept an EIP-7702 (type 0x04) set-code transaction?
 *  Decisive test: sign an authorization and send one. No inference. */
import { account, pub, wallet, shannon } from "./lib.mts";

console.log(`chain ${shannon.id}  signer ${account.address}`);

// Delegate to a harmless address (the collateral token). We only care whether the
// node ACCEPTS a type-4 envelope, not what the delegate does.
const DELEGATE = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;

let auth;
try {
  auth = await wallet.signAuthorization({ account, contractAddress: DELEGATE, executor: "self" });
  console.log(`  signAuthorization OK  chainId=${auth.chainId} nonce=${auth.nonce}`);
} catch (e) {
  console.log(`  signAuthorization FAILED: ${(e as Error).message.split("\n")[0]}`);
  process.exit(2);
}

try {
  const hash = await wallet.sendTransaction({
    account, chain: null, to: account.address, value: 0n,
    authorizationList: [auth],
  });
  console.log(`  type-4 tx accepted: ${hash}`);
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`  receipt status=${rc.status} gas=${rc.gasUsed}`);
  const code = await pub.getCode({ address: account.address });
  console.log(`  delegation indicator on EOA: ${code ?? "none"}`);
  console.log(code && code !== "0x" ? "\n  ✓ EIP-7702 IS SUPPORTED" : "\n  ✗ tx landed but no delegation set");
  // Clean up: revoke by delegating to the zero address.
  const revoke = await wallet.signAuthorization({ account, contractAddress: "0x0000000000000000000000000000000000000000", executor: "self" });
  const h2 = await wallet.sendTransaction({ account, chain: null, to: account.address, value: 0n, authorizationList: [revoke] });
  await pub.waitForTransactionReceipt({ hash: h2 });
  console.log(`  revoked; code now: ${(await pub.getCode({ address: account.address })) ?? "none"}`);
} catch (e) {
  console.log(`  type-4 tx REJECTED: ${(e as Error).message.split("\n").slice(0, 3).join(" | ")}`);
  console.log("\n  ✗ EIP-7702 NOT SUPPORTED on this chain");
  process.exit(3);
}
