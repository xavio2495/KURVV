import { decodeEventLog, type Address, type Hex, type Log } from "viem";
import { pub } from "./chain";
import { fmtUnits } from "./units.ts";
import { PLANBOOK_ONE, planBookAbi, SKIP_REASON } from "./abi";
import { DEFAULT_QUOTE_DECIMALS } from "./venues.ts";

/**
 * PROOF OF AUTONOMY — the read side.
 *
 * A Reactivity handler invocation arrives on chain as a *synthetic* transaction
 * assembled by validators, not by any wallet. Its signature on the wire is
 * unmistakable and is the whole claim this file exists to evidence:
 *
 *     from == to == the subscription owner (the PlanBook contract)
 *
 * Nothing else on this chain looks like that. A human commit — even the EIP-7702
 * batched one, which is also a self-call — has `from == to == the user's EOA`, so
 * the address is what separates them, never the shape alone. Both checks below.
 */

/** This RPC hard-errors `block range exceeds 1000` above a 1000-block span, and
 *  `fromBlock: "earliest"` therefore never works. Every log read pages through here. */
export const LOG_SPAN = 999n;

/** Blocks are 100ms, measured: 1000 blocks is exactly 100 seconds of history. */
export const BLOCKS_PER_SEC = 10;

/** Events the shared ABI omits. Kept here so `lib/abi.ts` stays untouched. */
const extraEventAbi = [
  { type: "event", name: "OpenScheduled", inputs: [
    { name: "pendingCount", type: "uint256", indexed: true }, { name: "seriesId", type: "uint32", indexed: true },
    { name: "marketId", type: "bytes32", indexed: true }, { name: "firesAtMillis", type: "uint256" }] },
  { type: "event", name: "SubscriptionOpened", inputs: [
    { name: "subscriptionId", type: "uint256", indexed: true }, { name: "emitter", type: "address", indexed: true },
    { name: "seriesId", type: "uint32", indexed: true }] },
  { type: "event", name: "SubscriptionClosed", inputs: [{ name: "subscriptionId", type: "uint256", indexed: true }] },
  { type: "event", name: "LegIntent", inputs: [
    { name: "planId", type: "uint256", indexed: true }, { name: "legIndex", type: "uint32", indexed: true },
    { name: "marketId", type: "bytes32", indexed: true }, { name: "pool", type: "address" }, { name: "kind", type: "uint8" },
    { name: "price", type: "uint256" }, { name: "quantity", type: "uint256" }, { name: "expireTimestampNs", type: "uint64" }] },
  { type: "event", name: "Swept", inputs: [
    { name: "token", type: "address", indexed: true }, { name: "amount", type: "uint256" }] },
] as const;

export const planBookEventAbi = [...planBookAbi, ...extraEventAbi] as const;

/** One decoded PlanBook event, flattened to the few fields the panel renders. */
export interface FireEvent {
  name: string;
  planId?: number;
  legIndex?: number;
  paidToOwner?: bigint;
  entryPrice?: bigint;
  filled?: bigint;
  reason?: number;
  firesAtMillis?: number;
  pendingCount?: number;
}

export type FireKind = "open" | "roll" | "commit" | "cancel" | "manual";

export interface Fire {
  hash: Hex;
  from: Address;
  to: Address | null;
  /** `from == to == planBook`. THE field: nobody signed this transaction. */
  synthetic: boolean;
  blockNumber: bigint;
  timestamp: number;
  gasUsed: bigint;
  gasLimit: bigint;
  kind: FireKind;
  events: FireEvent[];
  /** Human sentence: "settled Leg 2 +0.695 · opened Leg 3". */
  summary: string;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : undefined);
const big = (v: unknown) => (typeof v === "bigint" ? v : undefined);
const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Page an address's logs in <=1000-block windows. A single wide call is rejected. */
export async function pagedLogs(address: Address, from: bigint, to: bigint): Promise<Log[]> {
  const out: Log[] = [];
  for (let lo = from; lo <= to; lo += LOG_SPAN + 1n) {
    const hi = lo + LOG_SPAN > to ? to : lo + LOG_SPAN;
    out.push(...(await pub.getLogs({ address, fromBlock: lo, toBlock: hi })));
  }
  return out;
}

function decode(log: Log): FireEvent | null {
  try {
    const d = decodeEventLog({ abi: planBookEventAbi, data: log.data, topics: log.topics });
    // viem types `args` as a union across the whole ABI; read it as a bag and narrow.
    const a = (d.args ?? {}) as Record<string, unknown>;
    return {
      name: d.eventName,
      planId: num(a.planId),
      legIndex: num(a.legIndex),
      paidToOwner: big(a.paidToOwner),
      entryPrice: big(a.entryPrice),
      filled: big(a.filled),
      reason: num(a.reason),
      firesAtMillis: num(a.firesAtMillis),
      pendingCount: num(a.pendingCount),
    };
  } catch {
    return null; // an event this build does not know about; not our concern
  }
}

// The fire log is venue-agnostic — it decodes PlanBook events without a Venue in
// scope — so it formats at the scale PlanBook itself enforces (6dp, or it will
// not deploy). Anything that DOES know its venue must pass `quoteDecimals`.
const usdc = (v: bigint) => fmtUnits(v, DEFAULT_QUOTE_DECIMALS, 3);

function summarise(events: FireEvent[], planId: number): string {
  const parts: string[] = [];
  for (const e of events) {
    if (e.planId !== undefined && e.planId !== planId && e.name !== "OpenScheduled") continue;
    switch (e.name) {
      case "LegSettled":
        parts.push(`settled Leg ${e.legIndex}${e.paidToOwner !== undefined && e.paidToOwner > 0n ? ` +${usdc(e.paidToOwner)}` : " +0.000"}`);
        break;
      case "LegOpened":
        parts.push(`opened Leg ${e.legIndex}${e.entryPrice !== undefined && e.entryPrice > 0n ? ` @ ${(Number(e.entryPrice) / PLANBOOK_ONE).toFixed(3)}` : ""}`);
        break;
      case "LegSkipped":
        parts.push(`Leg ${e.legIndex} skipped · ${SKIP_REASON[e.reason ?? 0] ?? e.reason}`);
        break;
      case "OpenScheduled":
        parts.push(`armed the next open${e.pendingCount ? ` (${e.pendingCount} queued)` : ""}`);
        break;
      case "PlanCompleted": parts.push("Plan complete"); break;
      case "PlanCancelled": parts.push("Plan cancelled"); break;
      case "PlanCommitted": parts.push("Plan committed"); break;
      case "SubscriptionOpened": parts.push("subscription opened"); break;
      case "SubscriptionClosed": parts.push("subscription closed"); break;
      default: break;
    }
  }
  return parts.join(" · ") || "no effect on this Plan";
}

function classify(synthetic: boolean, events: FireEvent[]): FireKind {
  const has = (n: string) => events.some((e) => e.name === n);
  if (!synthetic) return has("PlanCommitted") ? "commit" : has("PlanCancelled") ? "cancel" : "manual";
  if (has("LegOpened") || has("LegIntent")) return "open";
  return "roll";
}

/**
 * Turn a block range of PlanBook logs into Fires touching one Plan.
 *
 * A Fire is kept when it carries an event scoped to `planId`, or when it is a roll
 * fire that armed the next open — the roll that queues Leg 0 emits nothing
 * plan-scoped, so dropping it would hide the first link in the chain.
 */
export async function readFires(planBook: Address, planId: number, from: bigint, to: bigint): Promise<Fire[]> {
  const logs = await pagedLogs(planBook, from, to);
  if (!logs.length) return [];

  const byTx = new Map<Hex, { block: bigint; events: FireEvent[] }>();
  for (const l of logs) {
    if (!l.transactionHash || l.blockNumber === null) continue;
    const e = decode(l);
    if (!e) continue;
    const cur = byTx.get(l.transactionHash) ?? { block: l.blockNumber, events: [] };
    cur.events.push(e);
    byTx.set(l.transactionHash, cur);
  }

  const keep = [...byTx.entries()].filter(([, v]) =>
    v.events.some((e) => e.planId === planId) || v.events.some((e) => e.name === "OpenScheduled"));
  if (!keep.length) return [];

  const blockTs = new Map<bigint, number>();
  await Promise.all([...new Set(keep.map(([, v]) => v.block))].map(async (b) => {
    const blk = await pub.getBlock({ blockNumber: b });
    blockTs.set(b, Number(blk.timestamp));
  }));

  const fires = await Promise.all(keep.map(async ([hash, v]) => {
    const [t, r] = await Promise.all([
      pub.getTransaction({ hash }),
      pub.getTransactionReceipt({ hash }),
    ]);
    const to_ = (t.to ?? null) as Address | null;
    // THE assertion. Shape alone is not enough — a 7702 batch is also a self-call.
    const synthetic = eq(t.from, to_) && eq(t.from, planBook) && !eq(t.from, ZERO_ADDR);
    return {
      hash,
      from: t.from as Address,
      to: to_,
      synthetic,
      blockNumber: v.block,
      timestamp: blockTs.get(v.block) ?? 0,
      gasUsed: r.gasUsed,
      gasLimit: t.gas,
      kind: classify(synthetic, v.events),
      events: v.events,
      summary: summarise(v.events, planId),
    } satisfies Fire;
  }));

  return fires.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1));
}

/**
 * The last roll of a venue's series, read from the very event the subscription
 * filters on. One page covers 100 seconds, so the 60s venue always has one in
 * range; the 15-minute venue usually does not and the caller extrapolates.
 */
export async function lastRoll(
  marketCreator: Address, rollTopic: Hex, seriesId: number, head: bigint,
): Promise<{ timestamp: number; blockNumber: bigint } | null> {
  const from = head > LOG_SPAN ? head - LOG_SPAN : 0n;
  const logs = await pub.getLogs({ address: marketCreator, fromBlock: from, toBlock: head });
  const series = `0x${seriesId.toString(16).padStart(64, "0")}`.toLowerCase();
  let best: Log | null = null;
  for (const l of logs) {
    if (!eq(l.topics[0], rollTopic)) continue;
    if (!eq(l.topics[1], series)) continue;
    if (l.blockNumber === null) continue;
    if (!best || (best.blockNumber !== null && l.blockNumber > best.blockNumber)) best = l;
  }
  if (!best || best.blockNumber === null) return null;
  const blk = await pub.getBlock({ blockNumber: best.blockNumber });
  return { timestamp: Number(blk.timestamp), blockNumber: best.blockNumber };
}
