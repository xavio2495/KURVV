"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { pub } from "./chain";
import { erc20Abi, marketAbi, moduleAbi, planBookAbi } from "./abi";
import { buildCommit, buildCommitFromLegs, PLAN_BOOK } from "./commit";
import { ADDR, EXPLORER, type Venue } from "./venues";
import { useDemoAdapter } from "./wallet/demo";
import type { CurvePoint, Leg } from "./curve";
import type { BatchCall } from "./wallet/types";
import type { LegView } from "./render/types";
import type { DrawPoint } from "./three/chart";

/**
 * The chain half of the device.
 *
 * Everything that touches the wallet or the Plan contract lives here so the surface
 * that draws it stays presentational. Lifted from the working chassis build — the
 * ordering, the exact-approval rule and the payout-vector read are load-bearing and
 * were not re-derived.
 */

/**
 * Bumped with the venue keys: a Plan saved as "fast" would restore into an
 * undefined venue now that a key names its asset too. A stale schema must not be
 * readable, only ignorable.
 */
const SAVE_KEY = "kurvv.activePlan.v4";
interface Saved {
  planId: number; planStart: number; curve: DrawPoint[];
  venueKey: Venue["key"]; legCount: number; total: string; tx?: Hex;
  /** Painted grid, when the Plan came from pixel mode rather than a Curve. */
  cells?: (number | null)[];
}
const save = (v: Saved) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(v)); } catch {} };
const load = (): Saved | null => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null"); } catch { return null; } };
const clearSaved = () => { try { localStorage.removeItem(SAVE_KEY); } catch {} };

const ZERO = `0x${"0".repeat(64)}`;

export interface PlanState {
  address?: Address;
  bal: { stt: bigint; usdc: bigint } | null;
  delegated: boolean | null;
  dryRun: boolean | null;
  planId: number | null;
  legs: LegView[];
  busy: string | null;
  err: string | null;
  tx: Hex | null;
  planStartRef: React.RefObject<number | null>;
  legsRef: React.RefObject<LegView[]>;
  connect: () => Promise<void>;
  faucet: () => Promise<void>;
  commit: (curve: DrawPoint[], toPoints: (c: DrawPoint[]) => CurvePoint[], venue: Venue, legCount: number, total: bigint) => Promise<void>;
  /** The same commit from an already-decided schedule — pixel mode's path. */
  commitLegs: (legs: Leg[], venue: Venue, total: bigint, cells: (number | null)[]) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  /** A saved Plan that outlived the page, restored on mount. */
  restored: Saved | null;
}

export function usePlan(venue: Venue): PlanState {
  // The demo wallet signs SERVER-SIDE; the browser never holds a key.
  const local = useDemoAdapter();
  const [bal, setBal] = useState<{ stt: bigint; usdc: bigint } | null>(null);
  const [delegated, setDelegated] = useState<boolean | null>(null);
  const [dryRun, setDryRun] = useState<boolean | null>(null);
  const [planId, setPlanId] = useState<number | null>(null);
  const [legs, setLegs] = useState<LegView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [restored, setRestored] = useState<Saved | null>(null);

  const planStartRef = useRef<number | null>(null);
  const legsRef = useRef<LegView[]>([]);

  const refreshAccount = useCallback(async () => {
    if (!local.address) return;
    try {
      const [stt, usdc, dele] = await Promise.all([
        pub.getBalance({ address: local.address }),
        pub.readContract({ address: ADDR.tusdc as Address, abi: erc20Abi, functionName: "balanceOf", args: [local.address] }),
        local.isDelegated(),
      ]);
      setBal({ stt, usdc: usdc as bigint });
      setDelegated(dele);
      if (PLAN_BOOK) {
        try {
          setDryRun(await pub.readContract({ address: PLAN_BOOK, abi: planBookAbi, functionName: "dryRun" }) as boolean);
        } catch { setDryRun(null); }
      }
    } catch { /* transient RPC */ }
  }, [local]);

  /**
   * Everything after the calls are built.
   *
   * Both modes share it deliberately: the batch, the receipt check, the planId read
   * and the save are where the subtle mistakes live, and having one copy is what
   * stops pixel mode from quietly acquiring a different definition of success.
   */
  const send = useCallback(async (
    built: { calls: BatchCall[]; market: { tradingStart: number } },
    v: Venue, total: bigint,
    extra: { curve: DrawPoint[]; legCount: number; cells?: (number | null)[] },
  ) => {
    setBusy(delegated ? "Sign once — approve + commit…" : "First commit: installing the batch delegate…");
    const hash = await local.sendBatch(built.calls);
    setBusy("Waiting for confirmation…");
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`reverted — ${EXPLORER}/tx/${hash}`);
    setTx(hash);
    const id = Number(await pub.readContract({
      address: PLAN_BOOK, abi: planBookAbi, functionName: "planCount",
    })) - 1;
    planStartRef.current = built.market.tradingStart;
    setPlanId(id);
    save({
      planId: id, planStart: built.market.tradingStart, curve: extra.curve,
      venueKey: v.key, legCount: extra.legCount, total: String(total), tx: hash, cells: extra.cells,
    });
    await refreshAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delegated, refreshAccount]);


  useEffect(() => {
    void refreshAccount();
    const t = setInterval(refreshAccount, 8000);
    return () => clearInterval(t);
  }, [refreshAccount]);

  // ── restore a Plan that is still running ────────────────────────────────
  useEffect(() => {
    const saved = load();
    if (!saved || !PLAN_BOOK) return;
    (async () => {
      try {
        const sch = await pub.readContract({
          address: PLAN_BOOK, abi: planBookAbi, functionName: "schedules", args: [BigInt(saved.planId)],
        }) as unknown as unknown[];
        if (!sch || (sch[0] as string) === "0x0000000000000000000000000000000000000000") { clearSaved(); return; }
        planStartRef.current = saved.planStart;
        setRestored(saved);
        if (saved.tx) setTx(saved.tx);
        setPlanId(saved.planId);
      } catch { clearSaved(); }
    })();
  }, []);

  // ── live Plan state ─────────────────────────────────────────────────────
  useEffect(() => {
    if (planId === null || !PLAN_BOOK) return;
    let stop = false;
    const poll = async () => {
      try {
        const n = Number(await pub.readContract({
          address: PLAN_BOOK, abi: planBookAbi, functionName: "legCount", args: [BigInt(planId)],
        }));
        const now = Math.floor(Date.now() / 1000);
        const out: LegView[] = [];
        for (let i = 0; i < n; i++) {
          const l = await pub.readContract({
            address: PLAN_BOOK, abi: planBookAbi, functionName: "getLeg", args: [BigInt(planId), i],
          }) as { direction: number; state: number; entryPrice: number; stake: bigint; filled: bigint; marketId: `0x${string}` };
          const anchor = planStartRef.current ?? now;
          const start = anchor + i * venue.intervalSec;
          // A settled Leg is `Settled` whether it won or lost — the struct does not
          // record the outcome. Derive it from the market's payout VECTOR.
          let won: boolean | undefined;
          if (l.state === 2 && l.marketId !== ZERO) {
            try {
              const rec = await pub.readContract({
                address: ADDR.module as Address, abi: moduleAbi, functionName: "markets", args: [l.marketId],
              }) as readonly unknown[];
              const nums = await pub.readContract({
                address: rec[8] as Address, abi: marketAbi, functionName: "payoutNumerators",
              }) as readonly bigint[];
              won = (nums?.[l.direction === 0 ? 0 : 1] ?? 0n) > 0n;
            } catch { /* leave unknown; renders as open */ }
          }
          out.push({
            index: i,
            direction: l.direction === 0 ? "UP" : "DOWN",
            state:
              l.state === 0 ? "pending"
              : l.state === 1 ? "open"
              : l.state === 3 ? "skipped"
              : won === true ? "won" : won === false ? "lost" : "open",
            stake: l.stake, start, end: start + venue.intervalSec,
            paid: won === true ? l.filled : won === false ? 0n : undefined,
            entryPrice: l.entryPrice ? l.entryPrice / 1e6 : undefined,
          });
        }
        if (!stop) { legsRef.current = out; setLegs(out); }
      } catch { /* transient */ }
    };
    void poll();
    const t = setInterval(poll, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [planId, venue]);

  const reset = useCallback(() => {
    clearSaved();
    setPlanId(null); setTx(null); setLegs([]); setErr(null); setRestored(null);
    planStartRef.current = null;
    legsRef.current = [];
  }, []);

  const faucet = useCallback(async () => {
    setErr(null); setBusy("Minting 1,000 tUSDC…");
    try {
      const h = await local.send({
        to: ADDR.tusdc as Address, value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "faucet", args: [1_000_000_000n] }),
      });
      await pub.waitForTransactionReceipt({ hash: h });
      await refreshAccount();
    } catch (e) { setErr((e as Error).message.split("\n")[0]); } finally { setBusy(null); }
  }, [local, refreshAccount]);

  const connect = useCallback(async () => {
    setErr(null);
    try { await local.connect(); await refreshAccount(); }
    catch (e) { setErr((e as Error).message.split("\n")[0]); }
  }, [local, refreshAccount]);

  const commit = useCallback(async (
    curve: DrawPoint[],
    toPoints: (c: DrawPoint[]) => CurvePoint[],
    v: Venue, legCount: number, total: bigint,
  ) => {
    setErr(null); setTx(null);
    if (!PLAN_BOOK) { setErr("PLAN_BOOK is not configured."); return; }
    if (!local.address) { setErr("Connect a wallet first."); return; }
    if (curve.length < 2) { setErr("Draw a curve first."); return; }
    try {
      setBusy("Finding the live Window…");
      const built = await buildCommit(toPoints(curve), v, legCount, total);
      await send(built, v, total, { curve, legCount });
    } catch (e) {
      setErr((e as Error).message.split("\n").slice(0, 2).join(" "));
    } finally { setBusy(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delegated, refreshAccount]);

  /**
   * Pixel mode's commit.
   *
   * Same transaction, same builder, same saved record — only the gesture that chose
   * the Legs differs. The grid is stored alongside so a restored Plan comes back as
   * the painting the user made rather than as a bare list of directions.
   */
  const commitLegs = useCallback(async (legs: Leg[], v: Venue, total: bigint, cells: (number | null)[]) => {
    setErr(null); setTx(null);
    if (!PLAN_BOOK) { setErr("PLAN_BOOK is not configured."); return; }
    if (!local.address) { setErr("Connect a wallet first."); return; }
    if (!legs.length) { setErr("Paint at least one cell first."); return; }
    try {
      setBusy("Finding the live Window…");
      const built = await buildCommitFromLegs(legs, v, total);
      await send(built, v, total, { curve: [], legCount: legs.length, cells });
    } catch (e) {
      setErr((e as Error).message.split("\n").slice(0, 2).join(" "));
    } finally { setBusy(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delegated, refreshAccount]);

  const cancel = useCallback(async () => {
    if (planId === null || !PLAN_BOOK) return;
    setErr(null); setBusy("Cancelling — returning unspent stake…");
    try {
      const h = await local.send({
        to: PLAN_BOOK, value: 0n,
        data: encodeFunctionData({ abi: planBookAbi, functionName: "cancelPlan", args: [BigInt(planId)] }),
      });
      await pub.waitForTransactionReceipt({ hash: h });
      reset();
      await refreshAccount();
    } catch (e) { setErr((e as Error).message.split("\n")[0]); } finally { setBusy(null); }
  }, [planId, local, refreshAccount, reset]);

  return {
    address: local.address ?? undefined,
    bal, delegated, dryRun, planId, legs, busy, err, tx,
    planStartRef, legsRef,
    connect, faucet, commit, commitLegs, cancel, reset, restored,
  };
}
