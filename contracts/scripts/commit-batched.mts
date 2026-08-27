/** D1's core claim: approve-exact + commitPlan in ONE transaction, via EIP-7702.
 *  A Plan must never exist without its first Leg, and the user signs once. */
import { encodeFunctionData, decodeEventLog, type Address } from "viem";
import { ADDR, VENUES, account, artifact, fmtUsdc, liveMarket, pub, wallet } from "./lib.mts";
import { curveToPlan, type CurvePoint } from "../../web/lib/curve.ts";

const BOOK = process.env.BOOK as Address;
const BATCHER = process.env.BATCHER as Address;
if (!BOOK || !BATCHER) throw new Error("set BOOK= and BATCHER=");

const V = VENUES.fast;
const SERIES = 3, ASSET = "BTC", INTERVAL = 60;
const TOTAL = BigInt(process.env.TOTAL ?? "2000000");
const LEG_COUNT = Number(process.env.LEGS ?? 4);

// A drawn Curve: flat, then a sharp rise. Conviction must back-load the stake.
const curve: CurvePoint[] = Array.from({ length: 60 }, (_, i) => ({
  x: i, y: i < 30 ? 100 : 100 - (i - 30) * 4,
}));
const legs = curveToPlan(curve, { legCount: LEG_COUNT, totalStake: TOTAL, minWeightShare: 0.05 });

// THE TRAP: rounded integer stakes must sum to the approved total or the contract
// reverts ApprovalMustBeExact. Assert client-side BEFORE signing.
const sum = legs.reduce((a, l) => a + l.stake, 0n);
if (sum !== TOTAL) throw new Error(`stake allocation is off: ${sum} != ${TOTAL}`);
console.log(`Curve -> ${LEG_COUNT} Legs, total ${fmtUsdc(TOTAL)} (asserted exact)`);
for (const [i, l] of legs.entries()) {
  console.log(`  leg ${i}  ${l.direction.padEnd(4)}  weight ${(l.weight * 100).toFixed(1)}%  stake ${fmtUsdc(l.stake)}`);
}

const m = await liveMarket(V.venueId, ASSET, INTERVAL, V.minHeadroom + 5);
if (!m) throw new Error("no live market with headroom — rerun");

const bookAbi = artifact("PlanBook").abi;
const batchAbi = artifact("BatchExecutor").abi;
const erc20 = [{ name: "approve", type: "function", stateMutability: "nonpayable",
  inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }] as any;

const calls = [
  { to: ADDR.tusdc as Address, value: 0n,
    data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [BOOK, TOTAL] }) },
  { to: BOOK, value: 0n,
    data: encodeFunctionData({ abi: bookAbi, functionName: "commitPlan", args: [{
      marketCreator: V.marketCreator, rollTopic: V.rollTopic, seriesId: SERIES,
      openDelay: V.openDelay, minHeadroom: V.minHeadroom, gasLimit: 20_000_000n, marketId: m.marketId,
    }, legs.map((l) => (l.direction === "UP" ? 0 : 1)), legs.map((l) => l.stake)] }) },
];

// GOTCHA: for a 7702 tx that INSTALLS the delegation, the node estimates gas against
// pre-delegation state — where calling the EOA is a no-op costing ~21k — so the tx is
// wildly under-provisioned and the inner call dies with an empty revert. Once the
// delegation is in place, estimation is correct and no authorization is needed at all.
const existing = await pub.getCode({ address: account.address });
const alreadyDelegated =
  !!existing && existing.toLowerCase() === `0xef0100${BATCHER.slice(2).toLowerCase()}`;
console.log(`\ndelegation: ${alreadyDelegated ? "already installed — plain batch" : "installing with this tx"}`);

const data = encodeFunctionData({ abi: batchAbi, functionName: "execute", args: [calls] });
const hash = alreadyDelegated
  ? await wallet.sendTransaction({ account, chain: null, to: account.address, data })
  : await wallet.sendTransaction({
      account, chain: null, to: account.address, data,
      authorizationList: [await wallet.signAuthorization({ account, contractAddress: BATCHER, executor: "self" })],
      gas: 12_000_000n, // must be explicit; see above
    });
const rc = await pub.waitForTransactionReceipt({ hash });
console.log(`\nONE transaction: ${hash}`);
console.log(`  status ${rc.status}  gas ${rc.gasUsed.toLocaleString()}`);

let committed = false;
for (const log of rc.logs) {
  for (const abi of [bookAbi, batchAbi]) {
    try {
      const e = decodeEventLog({ abi, data: log.data, topics: log.topics }) as any;
      console.log(`  ${e.eventName}`, JSON.stringify(e.args, (_, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 160));
      if (e.eventName === "PlanCommitted") committed = true;
    } catch {}
  }
}
if (!committed) throw new Error("no PlanCommitted event — batch did not commit");
console.log(`\nasserted: PlanCommitted present in the SAME tx as the approval`);
