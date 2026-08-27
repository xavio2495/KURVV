/** Commit a Plan into the PlanBook. Venue and series are parameters, not constants. */
import { decodeEventLog, type Address } from "viem";
import { ADDR, VENUES, account, artifact, fmtUsdc, liveMarket, pub, wallet } from "./lib.mts";

const BOOK = process.env.BOOK as Address;
if (!BOOK) throw new Error("set BOOK=0x…");

const VENUE_KEY = (process.env.VENUE_KEY ?? "fast") as keyof typeof VENUES;
const V = VENUES[VENUE_KEY];
const SERIES = Number(process.env.SERIES ?? V.series["BTC60" as keyof typeof V.series] ?? 3);
const ASSET = process.env.ASSET ?? "BTC";
const INTERVAL = Number(process.env.INTERVAL ?? 60);
const GAS_LIMIT = BigInt(process.env.GAS_LIMIT ?? "20000000");
const DIRS = (process.env.DIRS ?? "UP,DOWN,UP,DOWN").split(",").map((d) => (d.trim().toUpperCase() === "DOWN" ? 1 : 0));
const STAKES = (process.env.STAKES ?? "500000,500000,500000,500000").split(",").map((s) => BigInt(s.trim()));
if (DIRS.length !== STAKES.length) throw new Error("DIRS and STAKES length mismatch");
const TOTAL = STAKES.reduce((a, b) => a + b, 0n);

const { abi } = artifact("PlanBook");
const erc20 = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
] as any;

// The indexer lags the chain by seconds, so right after a roll the successor is
// briefly invisible while the predecessor has already expired. On a 60s Window
// that blind spot is a meaningful fraction of the cycle — retry rather than fail.
let m = null;
for (let i = 0; i < 30 && !m; i++) {
  m = await liveMarket(V.venueId, ASSET, INTERVAL, V.minHeadroom + 5);
  if (!m) await new Promise((r) => setTimeout(r, 2500));
}
if (!m) throw new Error(`no live ${ASSET} ${INTERVAL}s market with headroom after 75s`);
console.log(`venue    ${VENUE_KEY}  series ${SERIES}  ${ASSET} ${INTERVAL}s`);
console.log(`market   ${m.marketId}  (${m.expiry - Math.floor(Date.now() / 1000)}s left)`);
console.log(`legs     ${DIRS.map((d, i) => `${d ? "DOWN" : "UP"} ${fmtUsdc(STAKES[i])}`).join(", ")}`);

// EXACT-AMOUNT APPROVAL — the contract rejects anything else.
let h = await wallet.writeContract({ address: ADDR.tusdc, abi: erc20, functionName: "approve", args: [BOOK, TOTAL], account, chain: null });
await pub.waitForTransactionReceipt({ hash: h });
console.log(`approved exactly ${fmtUsdc(TOTAL)}`);

h = await wallet.writeContract({
  address: BOOK, abi, functionName: "commitPlan", account, chain: null,
  args: [{
    marketCreator: V.marketCreator, rollTopic: V.rollTopic, seriesId: SERIES,
    openDelay: V.openDelay, minHeadroom: V.minHeadroom, gasLimit: GAS_LIMIT, marketId: m.marketId,
  }, DIRS, STAKES],
});
const rc = await pub.waitForTransactionReceipt({ hash: h });
console.log(`commit   status ${rc.status}  gas ${rc.gasUsed.toLocaleString()}`);
for (const log of rc.logs) {
  try {
    const e = decodeEventLog({ abi, data: log.data, topics: log.topics }) as any;
    console.log(`  ${e.eventName}`, JSON.stringify(e.args, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  } catch {}
}
