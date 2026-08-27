/** Approve EXACTLY the total stake, then commit a hard-coded one-Leg schedule. */
import { decodeEventLog, type Address } from "viem";
import { ADDR, SERIES_BTC_15M, account, artifact, balances, liveBtc15m, pub, wallet, fmtUsdc } from "./lib.mts";

const PLAN = process.env.PLAN as Address;
if (!PLAN) throw new Error("set PLAN=0x…");

const GAS_LIMIT = BigInt(process.env.GAS_LIMIT ?? "20000000"); // measured cost + 1M storage reserve
// DIRS: comma-separated UP/DOWN, one per Leg. STAKES: base units, one per Leg.
const DIRS = (process.env.DIRS ?? "UP").split(",").map((d) => (d.trim().toUpperCase() === "DOWN" ? 1 : 0));
const STAKES = (process.env.STAKES ?? "2000000").split(",").map((s) => BigInt(s.trim()));
if (DIRS.length !== STAKES.length) throw new Error("DIRS and STAKES must be the same length");
const STAKE = STAKES.reduce((a, b) => a + b, 0n);

const { abi } = artifact("Plan");
const erc20 = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
] as any;

const m = await liveBtc15m(150);
if (!m) throw new Error("no BTC 15m market with >150s headroom — rerun shortly");
const left = m.expiry - Math.floor(Date.now() / 1000);
console.log(`market   ${m.marketId}`);
console.log(`pool     ${m.poolAddress}   (${left}s of Window left)`);

// EXACT-AMOUNT APPROVAL. Never max — the contract rejects anything else, because
// "authorising a Plan stakes exactly what you staked" has to be literally true.
console.log(`\napproving EXACTLY ${fmtUsdc(STAKE)} (not max)…`);
let h = await wallet.writeContract({ address: ADDR.tusdc, abi: erc20, functionName: "approve", args: [PLAN, STAKE], account, chain: null });
await pub.waitForTransactionReceipt({ hash: h });
const allowed = (await pub.readContract({ address: ADDR.tusdc, abi: erc20, functionName: "allowance", args: [account.address, PLAN] })) as bigint;
console.log(`  allowance now ${fmtUsdc(allowed)}  (must equal stake exactly)`);

const legDesc = DIRS.map((d, i) => `${d === 0 ? "UP" : "DOWN"} ${fmtUsdc(STAKES[i])}`).join(", ");
console.log(`\ncommitPlan(series=${SERIES_BTC_15M}, legs=[${legDesc}], total ${fmtUsdc(STAKE)}, gasLimit=${GAS_LIMIT.toLocaleString()})…`);
h = await wallet.writeContract({
  address: PLAN, abi, functionName: "commitPlan", account, chain: null,
  args: [SERIES_BTC_15M, DIRS, STAKES, GAS_LIMIT, m.marketId],
});
const rc = await pub.waitForTransactionReceipt({ hash: h });
console.log(`  status ${rc.status}   gas ${rc.gasUsed.toLocaleString()}   tx ${h}`);

console.log(`\n── events ──`);
for (const log of rc.logs) {
  try {
    const e = decodeEventLog({ abi, data: log.data, topics: log.topics });
    console.log(`  ${e.eventName}`, JSON.stringify(e.args, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  } catch { /* logs from the precompile / token, not ours */ }
}

const s = (await pub.readContract({ address: PLAN, abi, functionName: "schedule" })) as any[];
console.log(`\n── schedule ──`);
console.log(`  owner ${s[0]}  seriesId ${s[1]}  cursor ${s[2]}  live ${s[3]}  unspent ${fmtUsdc(s[4])}`);
console.log(`  gasLimit ${Number(s[5]).toLocaleString()}  subscriptionId ${s[6]}`);
await balances("after commit", PLAN);
