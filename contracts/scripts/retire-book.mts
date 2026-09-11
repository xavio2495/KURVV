/** Retire the old PlanBook: pay users what it owes, THEN sweep what is ours.
 *  Order matters — sweeping first would take stake that belongs to players. */
import { formatEther, formatUnits, type Address } from "viem";
import { ADDR, account, artifact, pub, wallet } from "./lib.mts";

const BOOK = (process.env.BOOK ?? "0x0ea0f0e3a7ebe5f91cb19be606c6114287d9765a") as Address;
const { abi } = artifact("PlanBook");
const erc20 = [{ name: "balanceOf", type: "function", stateMutability: "view",
  inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

const send = async (fn: string, args: unknown[]) => {
  try {
    const hash = await wallet.writeContract({ address: BOOK, abi, functionName: fn, args, account, chain: null });
    const rc = await pub.waitForTransactionReceipt({ hash });
    console.log(`    ${fn}(${args.join(", ")}) -> ${rc.status} ${hash.slice(0, 12)}`);
    return rc.status === "success";
  } catch (e) { console.log(`    ${fn}(${args.join(", ")}) -> reverted: ${(e as Error).message.split("\n")[0].slice(0, 90)}`); return false; }
};

const n = await pub.readContract({ address: BOOK, abi, functionName: "planCount" }) as bigint;
console.log(`Retiring ${BOOK} — ${n} plans\n`);

console.log("1. Redeem every settled-but-unredeemed Leg (pays the plan's OWNER, not us)");
for (let p = 0n; p < n; p++) {
  const c = await pub.readContract({ address: BOOK, abi, functionName: "legCount", args: [p] }) as bigint;
  for (let i = 0; i < Number(c); i++) {
    const l = await pub.readContract({ address: BOOK, abi, functionName: "getLeg", args: [p, i] }) as any;
    if (l.state === 1) await send("redeemSettled", [p, i]);
  }
}

console.log("\n2. Cancel every plan with unspent stake (refunds the OWNER)");
for (let p = 0n; p < n; p++) {
  const s = await pub.readContract({ address: BOOK, abi, functionName: "schedules", args: [p] }) as any[];
  if ((s[4] as bigint) > 0n) await send("cancelPlan", [p]);
}

const tus = await pub.readContract({ address: ADDR.tusdc, abi: erc20, functionName: "balanceOf", args: [BOOK] }) as bigint;
const stt = await pub.getBalance({ address: BOOK });
console.log(`\n3. Residue after paying everyone: ${formatUnits(tus, 6)} tUSDC, ${formatEther(stt)} STT`);
if (tus > 0n) await send("withdrawToken", [ADDR.tusdc, tus]);
if (stt > 0n) await send("withdrawNative", [stt]);

console.log(`\nFinal: ${formatUnits(await pub.readContract({ address: ADDR.tusdc, abi: erc20, functionName: "balanceOf", args: [BOOK] }) as bigint, 6)} tUSDC, ${formatEther(await pub.getBalance({ address: BOOK }))} STT`);
