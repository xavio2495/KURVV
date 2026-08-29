"use client";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { pub } from "./chain";
import { planBookAbi } from "./abi";
import { PLAN_BOOK } from "./commit";
import { handleFor } from "./handle";
import { gradeVector } from "./outcome";
import { payoutCache } from "./payout";

/**
 * The standings, read from the PlanBook itself.
 *
 * There is no account system and no off-chain index, so the board is assembled from
 * the only durable record there is: `schedules(planId)` for the owner, and `getLeg`
 * for what each Leg did. Names come from `handleFor(owner)` — derived, never stored.
 *
 * SCANNING LOGS WOULD NOT WORK HERE. This RPC caps `eth_getLogs` at a 1000-block
 * span, and a day of history is thousands of pages. Reading indexed state directly
 * is one cheap `eth_call` per Plan and per Leg instead, which is why the board walks
 * `planCount()` backwards rather than replaying `PlanCommitted`.
 *
 * The sweep runs in three phases — owners, then Legs, then outcomes — because each
 * needs the previous one complete. Tallying happens after all of it, synchronously:
 * a read-modify-write on a shared Map across an `await` loses every Plan but the
 * last, and one wallet owning several Plans is the NORMAL case here, not a race.
 */

export interface BoardRow {
  rank: number;
  who: string;
  plans: number;
  hit: string;
  ret: string;
  /** True for the connected wallet's own row, so the panel can mark it. */
  you?: boolean;
}

/** Plans to walk back from the head. Beyond this the board stops being current. */
const WINDOW = 40;
/** Legs read per Plan. The device never commits more than eight. */
const MAX_LEGS = 8;
/**
 * Requests in flight at once.
 *
 * Unbounded `Promise.all` over the window fires ~400 calls at a public endpoint every
 * 25s. Rate-limited failures are silently dropped per item, so the board would
 * publish whatever subset survived as though it were the whole truth.
 */
const LANES = 8;
/** Above this share of failed Plan reads the sweep is not a picture of anything. */
const MAX_LOSS = 0.25;

const ZERO_ID = `0x${"0".repeat(64)}`;

/** Run `fn` over `items` a few at a time, preserving order. */
async function inLanes<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(LANES, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  }));
  return out;
}

interface RawLeg { direction: number; state: number; stake: bigint; filled: bigint; marketId: `0x${string}` }
interface Tally { plans: number; settled: number; won: number; staked: bigint; paid: bigint }

async function readBoard(book: Address, me?: string): Promise<BoardRow[]> {
  const count = Number(await pub.readContract({
    address: book, abi: planBookAbi, functionName: "planCount",
  }) as bigint);
  if (!count) return [];

  const first = Math.max(0, count - WINDOW);
  const ids = Array.from({ length: count - first }, (_, i) => first + i);

  // ── phase 1: who owns each Plan, and how long is it ──────────────────────
  const heads = await inLanes(ids, async (id) => {
    try {
      const [s, n] = await Promise.all([
        pub.readContract({ address: book, abi: planBookAbi, functionName: "schedules", args: [BigInt(id)] }) as Promise<readonly unknown[]>,
        pub.readContract({ address: book, abi: planBookAbi, functionName: "legCount", args: [BigInt(id)] }) as Promise<bigint>,
      ]);
      const owner = String(s[0]);
      if (!owner || /^0x0+$/.test(owner)) return null;
      return { id, owner: owner.toLowerCase(), n: Math.min(Number(n), MAX_LEGS) };
    } catch { return undefined; }
  });

  // `undefined` is a failed read; `null` is a Plan that genuinely is not there.
  if (heads.filter((h) => h === undefined).length > ids.length * MAX_LOSS) return [];
  const plans = heads.filter((h): h is { id: number; owner: string; n: number } => !!h);
  if (!plans.length) return [];

  // ── phase 2: the Legs ────────────────────────────────────────────────────
  const legsByPlan = await inLanes(plans, (p) => Promise.all(
    Array.from({ length: p.n }, (_, i) =>
      pub.readContract({ address: book, abi: planBookAbi, functionName: "getLeg", args: [BigInt(p.id), i] })
        .then((l) => l as RawLeg)
        .catch(() => null)),
  ));

  // ── phase 3: what the settled ones were worth ────────────────────────────
  // A settled Leg's result is NOT in the struct. Every Plan on this series shares one
  // market per Window, so memoising by marketId collapses the whole board to a few.
  const payoutOf = payoutCache();
  const settled = legsByPlan.flat().filter((l): l is RawLeg => !!l && l.state === 2 && l.marketId !== ZERO_ID);
  const resolved = new Map<string, readonly bigint[] | null>();
  await Promise.all([...new Set(settled.map((l) => l.marketId))].map(async (m) => {
    resolved.set(m.toLowerCase(), await payoutOf(m));
  }));

  // ── phase 4: tally, with no await in sight ───────────────────────────────
  const tally = new Map<string, Tally>();
  for (let i = 0; i < plans.length; i++) {
    let t = tally.get(plans[i].owner);
    if (!t) { t = { plans: 0, settled: 0, won: 0, staked: 0n, paid: 0n }; tally.set(plans[i].owner, t); }
    t.plans++;
    for (const l of legsByPlan[i]) {
      if (!l) continue;
      t.staked += l.stake;
      if (l.state !== 2 || l.marketId === ZERO_ID) continue;
      const nums = resolved.get(l.marketId.toLowerCase());
      if (!nums) continue;
      const o = gradeVector(nums, l.direction, l.filled);
      t.paid += o.paid;
      // A void is not a result: it counts neither for the hit rate nor against it.
      if (o.voided) continue;
      t.settled++;
      if (o.won) t.won++;
    }
  }

  const rows = [...tally.entries()]
    .map(([addr, t]) => {
      const pnl = t.staked > 0n ? (Number(t.paid - t.staked) / Number(t.staked)) * 100 : 0;
      return {
        addr,
        who: handleFor(addr),
        plans: t.plans,
        hitPct: t.settled ? (t.won / t.settled) * 100 : 0,
        settled: t.settled,
        pnl,
      };
    })
    // Unsettled traders sort last: a 0% return with nothing resolved is not a result.
    .sort((a, b) => (b.settled - a.settled) || (b.pnl - a.pnl))
    .slice(0, 6);

  return rows.map((r, i) => ({
    rank: i + 1,
    who: r.who,
    plans: r.plans,
    hit: r.settled ? `${Math.round(r.hitPct)}%` : "—",
    ret: r.settled ? `${r.pnl >= 0 ? "+" : ""}${r.pnl.toFixed(1)}%` : "—",
    you: !!me && r.addr === me.toLowerCase(),
  }));
}

export interface Board {
  rows: BoardRow[];
  /** True when nothing on chain could be read and the rows are illustrative. */
  sample: boolean;
}

/**
 * A stand-in roster.
 *
 * Shown only when the PlanBook is unconfigured or has no Plans yet — an empty board
 * on a first run reads as a broken screen. The panel labels it, because standings
 * nobody earned must never be mistaken for standings somebody did.
 */
function sampleBoard(): BoardRow[] {
  const seeds = [
    "0x5f2a91c4", "0xa17d3e08", "0xc93b6d52", "0x2e84af71", "0xb60c15d9", "0x74e2b8a3",
  ];
  const plans = [9, 7, 6, 5, 4, 3];
  const hit = [71, 66, 62, 58, 54, 49];
  const ret = [18.4, 11.2, 6.7, 1.9, -3.4, -8.8];
  return seeds.map((s, i) => ({
    rank: i + 1,
    who: handleFor(s),
    plans: plans[i],
    hit: `${hit[i]}%`,
    ret: `${ret[i] >= 0 ? "+" : ""}${ret[i].toFixed(1)}%`,
  }));
}

export function useBoard(address?: string, refreshKey = 0): Board {
  const [board, setBoard] = useState<Board>({ rows: sampleBoard(), sample: true });

  useEffect(() => {
    let stop = false;
    const run = async () => {
      if (!PLAN_BOOK) return;
      try {
        const rows = await readBoard(PLAN_BOOK, address);
        if (!stop && rows.length) setBoard({ rows, sample: false });
      } catch { /* keep whatever is on screen; the next tick tries again */ }
    };
    void run();
    const t = setInterval(run, 25_000);
    return () => { stop = true; clearInterval(t); };
  }, [address, refreshKey]);

  return board;
}
