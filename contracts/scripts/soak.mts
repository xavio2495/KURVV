/** Tail every PlanBook event, resolving each handler invocation's gas and cost.
 *  Runs unattended; append-only log so it can be inspected while running. */
import { decodeEventLog, type Address } from "viem";
import { appendFileSync } from "node:fs";
import { artifact, pub } from "./lib.mts";

const BOOK = process.env.BOOK as Address;
if (!BOOK) throw new Error("set BOOK=0x…");
const OUT = process.env.OUT ?? "soak.log";
const UNTIL = Number(process.env.MINUTES ?? 25) * 60_000;

const { abi } = artifact("PlanBook");
const REASON = ["None","WrongEmitter","WrongTopic","WrongSeries","PlanNotLive","PlanComplete","MarketNotTrading",
  "WindowTooShort","NoLiquidity","StakeTooSmall","DryRun","OrderRejected","PredecessorUnresolved","NothingPending","UnknownSchedule"];

const started = Date.now();
let cursor = await pub.getBlockNumber();
const txSeen = new Map<string, { gas: bigint; cost: bigint; synthetic: boolean }>();
const line = (s: string) => { console.log(s); appendFileSync(OUT, s + "\n"); };

line(`# soak start ${new Date().toISOString()}  book=${BOOK}  fromBlock=${cursor}`);

while (Date.now() - started < UNTIL) {
  let head: bigint;
  try { head = await pub.getBlockNumber(); } catch { await sleep(3000); continue; }
  if (head <= cursor) { await sleep(3000); continue; }
  const to = head - cursor > 900n ? cursor + 900n : head;

  let logs;
  try { logs = await pub.getLogs({ address: BOOK, fromBlock: cursor + 1n, toBlock: to }); }
  catch { await sleep(3000); continue; }

  for (const log of logs) {
    let e: any;
    try { e = decodeEventLog({ abi, data: log.data, topics: log.topics }); } catch { continue; }
    const tx = log.transactionHash!;
    if (!txSeen.has(tx)) {
      try {
        const rc = await pub.getTransactionReceipt({ hash: tx });
        txSeen.set(tx, {
          gas: rc.gasUsed,
          cost: rc.gasUsed * rc.effectiveGasPrice,
          // A Reactivity synthetic tx has from == to == the subscription owner.
          synthetic: rc.from.toLowerCase() === BOOK.toLowerCase(),
        });
      } catch { txSeen.set(tx, { gas: 0n, cost: 0n, synthetic: false }); }
    }
    const t = txSeen.get(tx)!;
    const args = JSON.stringify(e.args, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const tag = t.synthetic ? "HANDLER" : "user   ";
    const reason = e.eventName === "LegSkipped" ? ` [${REASON[Number(e.args.reason)]}]` : "";
    line(`${new Date().toISOString()} blk=${log.blockNumber} ${tag} gas=${t.gas.toString().padStart(9)} ` +
         `cost=${(Number(t.cost) / 1e18).toFixed(6)}STT ${e.eventName}${reason} ${args}`);
  }
  cursor = to;
  await sleep(2500);
}
line(`# soak end ${new Date().toISOString()}`);
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
