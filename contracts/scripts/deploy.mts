/** Deploy a Plan and fund it past the 32-native subscription gate. */
import { parseEther, formatEther } from "viem";
import { ADDR, account, artifact, balances, pub, wallet } from "./lib.mts";

const FUND = parseEther(process.env.FUND ?? "33");

const { abi, bytecode } = artifact("Plan");
await balances("before deploy");

console.log(`\ndeploying Plan, funding ${formatEther(FUND)} STT (32 gate + handler-gas buffer)…`);
const hash = await wallet.deployContract({
  abi, bytecode, account, chain: null,
  args: [ADDR.module, ADDR.outcome, ADDR.tusdc, ADDR.marketCreator],
  value: FUND,
});
const rc = await pub.waitForTransactionReceipt({ hash });
if (rc.status !== "success" || !rc.contractAddress) throw new Error("deploy failed: " + hash);

const plan = rc.contractAddress;
console.log(`  Plan          ${plan}`);
console.log(`  deploy gas    ${rc.gasUsed.toLocaleString()}`);
console.log(`  dryRun        ${await pub.readContract({ address: plan, abi, functionName: "dryRun" })}`);
console.log(`  balance       ${formatEther(await pub.getBalance({ address: plan }))} STT`);
await balances("after deploy", plan);
console.log(`\nexport PLAN=${plan}`);
