"use client";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { pub } from "./chain";
import { planBookAbi } from "./abi";
import { PLAN_BOOK } from "./commit";
import { handleFor } from "./handle";

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

interface Tally { plans: number; settled: number; won: number; staked: bigint; paid: bigint }

async function readBoard(book: Address, me?: string): Promise<BoardRow[]> {
  const count = Number(await pub.readContract({
    address: book, abi: planBookAbi, functionName: "planCount",
  }) as bigint);
  if (!count) return [];

  const first = Math.max(0, count - WINDOW);
  const ids = Array.from({ length: count - first }, (_, i) => first + i);

  const tally = new Map<string, Tally>();

  await Promise.all(ids.map(async (id) => {
    let owner: string;
    try {
      const s = await pub.readContract({
        address: book, abi: planBookAbi, functionName: "schedules", args: [BigInt(id)],
      }) as readonly unknown[];
      owner = String(s[0]);
    } catch { return; }
    if (!owner || /^0x0+$/.test(owner)) return;

    const n = Number(await pub.readContract({
      address: book, abi: planBookAbi, functionName: "legCount", args: [BigInt(id)],
    }).catch(() => 0n) as bigint);

    const t = tally.get(owner.toLowerCase()) ?? { plans: 0, settled: 0, won: 0, staked: 0n, paid: 0n };
    t.plans++;

    const legs = await Promise.all(
      Array.from({ length: Math.min(n, MAX_LEGS) }, (_, i) =>
        pub.readContract({ address: book, abi: planBookAbi, functionName: "getLeg", args: [BigInt(id), i] })
          .catch(() => null)),
    );
    for (const l of legs) {
      if (!l) continue;
      const leg = l as { state: number; stake: bigint; filled: bigint };
      t.staked += leg.stake;
      // State 2 is Settled. `filled` is the winning collateral that came back; a
      // losing Leg redeems successfully and pays nothing, so >0 IS the win test.
      if (leg.state === 2) {
        t.settled++;
        if (leg.filled > 0n) { t.won++; t.paid += leg.filled; }
      }
    }
    tally.set(owner.toLowerCase(), t);
  }));

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
