/** Clear an EIP-7702 delegation from the signer EOA.
 *  Sends the zero-address authorization with an explicit gas limit so a reverting
 *  gas estimation cannot stop the tx from broadcasting. */
import { account, pub, wallet } from "./lib.mts";

const before = await pub.getCode({ address: account.address });
console.log(`before: ${before ?? "none"}`);

const auth = await wallet.signAuthorization({
  account, contractAddress: "0x0000000000000000000000000000000000000000", executor: "self",
});
const hash = await wallet.sendTransaction({
  account, chain: null,
  to: account.address, // this envelope shape is the one the node accepts
  value: 0n, gas: 200_000n,
  authorizationList: [auth],
});
const rc = await pub.waitForTransactionReceipt({ hash });
console.log(`tx ${hash} status=${rc.status}`);

const after = await pub.getCode({ address: account.address });
console.log(`after : ${after ?? "none"}`);
if (after && after !== "0x") { console.log("STILL DELEGATED"); process.exit(1); }
console.log("delegation cleared");
