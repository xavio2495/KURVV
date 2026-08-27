/** Read a Plan's full state, and decode any handler invocations since a block. */
import { decodeEventLog, type Address } from "viem";
import { artifact, pub, fmtUsdc, fmtStt, ADDR } from "./lib.mts";

const PLAN = process.env.PLAN as Address;
if (!PLAN) throw new Error("set PLAN=0x…");
const FROM = BigInt(process.env.FROM ?? "0");
const { abi } = artifact("Plan");

const REASON = ["None","WrongEmitter","WrongTopic","WrongSeries","PlanNotLive","PlanComplete",
  "MarketNotTrading","WindowTooShort","NoLiquidity","StakeTooSmall","DryRun","OrderRejected","PredecessorUnresolved"];
const STATE = ["Pending","Open","Settled","Skipped"];

const r = async (fn: string, args: any[] = []) => pub.readContract({ address: PLAN, abi, functionName: fn, args });

const s = (await r("schedule")) as any[];
const n = Number(await r("legCount"));
console.log(`Plan ${PLAN}`);
console.log(`  dryRun ${await r("dryRun")}   balance ${fmtStt(await pub.getBalance({ address: PLAN }))}`);
console.log(`  owner ${s[0]}  series ${s[1]}  cursor ${s[2]}  live ${s[3]}  unspent ${fmtUsdc(s[4])}  gasLimit ${Number(s[5]).toLocaleString()}  sub ${s[6]}`);
for (let i = 0; i < n; i++) {
  const l = (await r("getLeg", [i])) as any;
  console.log(`  leg ${i}: ${l.direction === 0 ? "UP  " : "DOWN"} ${STATE[l.state].padEnd(8)} stake ${fmtUsdc(l.stake)} entry ${l.entryPrice} filled ${Number(l.filled) / 1e6} market ${l.marketId}`);
}

const head = await pub.getBlockNumber();
const from = FROM > 0n ? FROM : head - 900n;
const logs = await pub.getLogs({ address: PLAN, fromBlock: from, toBlock: head });
if (logs.length) {
  console.log(`\n── Plan events, blocks ${from}..${head} ──`);
  for (const log of logs) {
    try {
      const e = decodeEventLog({ abi, data: log.data, topics: log.topics }) as any;
      const args = JSON.stringify(e.args, (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const extra = e.eventName === "LegSkipped" ? `  reason=${REASON[Number(e.args.reason)]}` : "";
      console.log(`  blk ${log.blockNumber}  ${e.eventName}${extra}  ${args}`);
    } catch {}
  }
} else {
  console.log(`\n(no Plan events in blocks ${from}..${head})`);
}
