/** Deploy the PlanBook and fund it past the 32-native subscription gate.
 *  One deployment hosts many Plans — the 32 is a balance gate, not an escrow. */
import { parseEther, formatEther } from "viem";
import { ADDR, account, artifact, balances, pub, wallet } from "./lib.mts";

const FUND = parseEther(process.env.FUND ?? "33");
const { abi, bytecode } = artifact("PlanBook");
await balances("before deploy");

const hash = await wallet.deployContract({
  abi, bytecode, account, chain: null,
  args: [ADDR.module, ADDR.outcome, ADDR.tusdc],
  value: FUND,
});
const rc = await pub.waitForTransactionReceipt({ hash });
if (rc.status !== "success" || !rc.contractAddress) throw new Error("deploy failed: " + hash);
console.log(`\n  PlanBook   ${rc.contractAddress}`);
console.log(`  deploy gas ${rc.gasUsed.toLocaleString()}`);
console.log(`  dryRun     ${await pub.readContract({ address: rc.contractAddress, abi, functionName: "dryRun" })}`);
console.log(`  balance    ${formatEther(await pub.getBalance({ address: rc.contractAddress }))} STT`);
console.log(`\nexport BOOK=${rc.contractAddress}`);
