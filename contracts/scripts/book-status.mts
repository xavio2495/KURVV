import { type Address } from "viem";
import { artifact, pub, fmtUsdc, fmtStt } from "./lib.mts";
const BOOK = process.env.BOOK as Address;
const { abi } = artifact("PlanBook");
const STATE = ["Pending", "Open", "Settled", "Skipped"];
const r = (fn: string, args: any[] = []) => pub.readContract({ address: BOOK, abi, functionName: fn, args });
console.log(`PlanBook ${BOOK}  dryRun=${await r("dryRun")}  balance=${fmtStt(await pub.getBalance({ address: BOOK }))}`);
const n = Number(await r("planCount"));
for (let p = 0; p < n; p++) {
  const s = (await r("schedules", [p])) as any[];
  const lc = Number(await r("legCount", [p]));
  console.log(`  plan ${p}: series ${s[1]} cursor ${s[2]} live ${s[3]} unspent ${fmtUsdc(s[4])} openDelay ${s[5]}s minHeadroom ${s[6]}s`);
  for (let i = 0; i < lc; i++) {
    const l = (await r("getLeg", [p, i])) as any;
    console.log(`     leg ${i} ${l.direction === 0 ? "UP  " : "DOWN"} ${STATE[l.state].padEnd(8)} stake ${fmtUsdc(l.stake)} entry ${l.entryPrice} filled ${Number(l.filled) / 1e6} ${l.marketId.slice(0, 10)}`);
  }
}
