"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { decodeEventLog, encodeFunctionData, type Address, type Hex } from "viem";
import { pub } from "./chain";
import { erc20Abi, planBookAbi } from "./abi";
import { buildCommit, buildCommitFromLegs, liveMarket, PLAN_BOOK, type BuiltPlan } from "./commit";
import { ADDR, EXPLORER, type Venue } from "./venues";
import { gradeVector } from "./outcome";
import { payoutCache } from "./payout";
import { useWallet } from "./wallet";
import type { CurvePoint, Leg } from "./curve";
import type { LegView } from "./render/types";
import type { DrawPoint } from "./render/types";

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

/**
 * Below this a wallet cannot be relied on to land a commit.
 *
 * 0.05 STT at 6 gwei is well under one first commit (~0.072 STT, which carries an
 * explicit 12M gas limit) and comfortably over an ordinary one (~0.009). It matches
 * the server's own refusal threshold in `/api/demo`; the two are stated separately
 * on purpose, because a client constant must never be what decides whether funds move.
 */
const GAS_FLOOR = 50_000_000_000_000_000n;

export interface PlanState {
  address?: Address;
  bal: { stt: bigint; usdc: bigint } | null;
  delegated: boolean | null;
  /** Did the commit land as a single transaction? False on wallets that cannot batch. */
  batched: boolean;
  dryRun: boolean | null;
  planId: number | null;
  legs: LegView[];
  busy: string | null;
  err: string | null;
  tx: Hex | null;
  planStartRef: React.RefObject<number | null>;
  legsRef: React.RefObject<LegView[]>;
  /** What to call the signer on screen — "Email wallet", "Metamask", "Demo signer". */
  walletLabel: string;
  /**
   * Whether the wallet adapter has finished loading.
   *
   * Without this, "no address" is ambiguous: it means both "nobody is signed in" and
   * "Privy has not answered yet", and anything that reacts to the first will fire
   * during the second on every load.
   */
  ready: boolean;
  /**
   * Connected, but with no STT to pay for gas.
   *
   * The defining failure of a fresh embedded wallet, and it must be its own state:
   * "connected with an empty balance" and "not connected" look identical on a
   * balance readout and need completely different things from the user.
   */
  needsGas: boolean;
  connect: () => Promise<void>;
  faucet: () => Promise<void>;
  /** Top up gas from the demo signer. Refused unless `DEMO_FUND_GAS=1`. */
  fundGas: () => Promise<void>;
  commit: (curve: DrawPoint[], toPoints: (c: DrawPoint[]) => CurvePoint[], venue: Venue, legCount: number, total: bigint) => Promise<void>;
  /** The same commit from an already-decided schedule — pixel mode's path. */
  commitLegs: (legs: Leg[], venue: Venue, total: bigint, cells: (number | null)[]) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  /** A saved Plan that outlived the page, restored on mount. */
  restored: Saved | null;
}

export function usePlan(venue: Venue): PlanState {
  /**
   * Whoever is signing: a Privy wallet when Privy is configured, the server-side
   * demo signer otherwise. Every call below goes through the `WalletAdapter`
   * interface, so nothing in this file knows or cares which one it got.
   */
  const local = useWallet();
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
    built: BuiltPlan,
    v: Venue, total: bigint,
    extra: { curve: DrawPoint[]; legCount: number; cells?: (number | null)[] },
  ) => {
    // An embedded wallet cannot batch — it signs the approve and the commit
    // separately — so promising "sign once" or a delegate install there would be a
    // lie the user catches one modal later. See `sendBatch` in `wallet/privy.ts`.
    const canBatch = local.kind !== "privy";
    setBusy(
      !canBatch ? "Approve, then commit — two signatures…"
      : delegated ? "Sign once — approve + commit…"
      : "First commit: installing the batch delegate…",
    );

    let hash: Hex;
    if (canBatch) {
      hash = await local.sendBatch(built.calls);
    } else {
      // SEQUENCE, AND RE-READ THE WINDOW IN BETWEEN.
      //
      // `commitPlan` opens Leg 0 immediately and refuses a Window with less than
      // `minHeadroom` left — 12 seconds on the 60s venue. Sending the approval and
      // waiting for its receipt burns most of that, so reusing the `marketId` chosen
      // before the approval loses Leg 0 to `LegSkipped(WindowTooShort)`. It did,
      // once, which is why this is here. The approval depends on nothing but the
      // total, so the Window is chosen as late as it possibly can be.
      await pub.waitForTransactionReceipt({ hash: await local.send(built.approve) });
      // Naming the wait matters: on the 60s venue only ~20% of the cycle is eligible
      // for Leg 0, so this can sit for half a minute on a series that is running
      // perfectly. "Confirm the commit" would read as a stuck prompt.
      setBusy("Waiting for a tradeable Window…");
      // 8s of margin, not the default 3. Two signatures on an embedded wallet take
      // longer to land than one from a local key, and this Window has to still be
      // open when the SECOND one arrives. It is deliberately not larger: Privy signs
      // without a confirmation dialog (see `PrivyRoot`), so the gap is bounded by
      // network latency rather than by how long someone takes to read a modal, and a
      // bigger margin would just idle waiting for a fresher Window than we need.
      const fresh = await liveMarket(v, 32, 8, built.legs[0].direction === "UP");
      if (!fresh) throw new Error("no live market with enough headroom — try again in a moment");
      hash = await local.send(built.commit(fresh));
    }
    setBusy("Waiting for confirmation…");
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`reverted — ${EXPLORER}/tx/${hash}`);
    setTx(hash);
    // The planId comes from OUR receipt, never from `planCount() - 1`: any other
    // commit landing in between would hand us someone else's Plan, which then gets
    // saved, polled, restored and passed to `cancelPlan`.
    let id: number | null = null;
    for (const lg of rc.logs) {
      if (lg.address.toLowerCase() !== PLAN_BOOK.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: planBookAbi, data: lg.data, topics: lg.topics });
        if (ev.eventName === "PlanCommitted") {
          id = Number((ev.args as unknown as { planId: bigint }).planId);
          break;
        }
      } catch { /* some other event from the book */ }
    }
    if (id === null) throw new Error("commit landed but emitted no PlanCommitted");
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
    // A tick that outlives its 4s interval must not overlap the next one: two polls
    // in flight can finish out of order and write a STALE `legsRef` over a fresh one.
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const n = Number(await pub.readContract({
          address: PLAN_BOOK, abi: planBookAbi, functionName: "legCount", args: [BigInt(planId)],
        }));
        const now = Math.floor(Date.now() / 1000);
        const raw = await Promise.all(Array.from({ length: n }, (_, i) =>
          pub.readContract({
            address: PLAN_BOOK, abi: planBookAbi, functionName: "getLeg", args: [BigInt(planId), i],
          }) as Promise<{ direction: number; state: number; entryPrice: number; stake: bigint; filled: bigint; marketId: `0x${string}` }>));

        // A settled Leg is `Settled` whether it won, lost or voided — the struct does
        // not record the outcome, and `filled` is the quantity bought at OPEN, not
        // the collateral that came back. Derive it from the market's payout VECTOR.
        const payoutOf = payoutCache();
        const vectors = await Promise.all(raw.map((l) =>
          l.state === 2 && l.marketId !== ZERO ? payoutOf(l.marketId) : Promise.resolve(null)));

        const out: LegView[] = raw.map((l, i) => {
          const anchor = planStartRef.current ?? now;
          const start = anchor + i * venue.intervalSec;
          const nums = vectors[i];
          const o = nums ? gradeVector(nums, l.direction, l.filled) : null;
          return {
            index: i,
            direction: l.direction === 0 ? "UP" : "DOWN",
            state:
              l.state === 0 ? "pending"
              : l.state === 1 ? "open"
              : l.state === 3 ? "skipped"
              : !o ? "open"
              : o.voided ? "void" : o.won ? "won" : "lost",
            stake: l.stake, start, end: start + venue.intervalSec,
            paid: o ? o.paid : undefined,
            entryPrice: l.entryPrice ? l.entryPrice / 1e6 : undefined,
          };
        });
        if (!stop) { legsRef.current = out; setLegs(out); }
      } catch { /* transient */ } finally { inFlight = false; }
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

  /**
   * Ask the demo signer for enough STT to transact.
   *
   * Deliberately NOT automatic on connect. It moves real testnet funds, the endpoint
   * is off unless someone opted in, and a silent transfer the user did not ask for
   * is the wrong default even when the amount is small.
   */
  const fundGas = useCallback(async () => {
    if (!local.address) return;
    setErr(null); setBusy("Sending gas…");
    try {
      const r = await fetch("/api/demo", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "fund", to: local.address }),
      });
      const j = (await r.json()) as { hash?: Hex; error?: string };
      if (!j.hash) throw new Error(j.error ?? "could not send gas");
      await pub.waitForTransactionReceipt({ hash: j.hash });
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
    walletLabel: local.label,
    ready: local.ready,
    // Only once a balance has actually been read. `bal === null` is "not known yet",
    // and treating that as "needs gas" would flash a funding prompt at every user on
    // every load, including the ones who are already funded.
    needsGas: !!local.address && bal !== null && bal.stt < GAS_FLOOR,
    // Whether the commit actually landed as ONE transaction. An embedded wallet
    // cannot batch, so claiming it on that path would be false on screen.
    batched: local.kind !== "privy",
    bal, delegated, dryRun, planId, legs, busy, err, tx,
    planStartRef, legsRef,
    connect, faucet, fundGas, commit, commitLegs, cancel, reset, restored,
  };
}
