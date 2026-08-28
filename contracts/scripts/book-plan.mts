import { pub, artifact, fmtUsdc } from "./lib.mts";
const abi = artifact("PlanBook").abi;
const BOOK = process.env.BOOK as `0x${string}`;
const P = BigInt(process.env.PLAN_ID ?? "0");
const S = ["Pending", "Open", "Settled", "Skipped"];
const n = Number(await pub.readContract({ address: BOOK, abi, functionName: "legCount", args: [P] }));
const sch = await pub.readContract({ address: BOOK, abi, functionName: "schedules", args: [P] }) as any[];
console.log(`plan ${P}  cursor ${sch[2]}  live ${sch[3]}  unspent ${fmtUsdc(sch[4])}`);
for (let i = 0; i < n; i++) {
  const l = await pub.readContract({ address: BOOK, abi, functionName: "getLeg", args: [P, i] }) as any;
  console.log(`  ${i} ${l.direction === 0 ? "UP  " : "DOWN"} ${S[l.state].padEnd(8)} stake ${fmtUsdc(l.stake, 3)} entry ${l.entryPrice} filled ${(Number(l.filled) / 1e6).toFixed(3)}`);
}
