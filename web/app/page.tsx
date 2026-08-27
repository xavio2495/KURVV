"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { Canvas } from "../components/Canvas";
import { curveToPlan, type CurvePoint, type Leg } from "../lib/curve";
import { buildCommit, liveMarket, rollPriceSeries, PLAN_BOOK } from "../lib/commit";
import { VENUES, ADDR, EXPLORER, type Venue } from "../lib/venues";
import { erc20Abi, planBookAbi, moduleAbi, marketAbi } from "../lib/abi";
import { pub, fmtUsdc, fmtStt } from "../lib/chain";
import { createLocalAdapter } from "../lib/wallet/local";
import type { LegView, PricePoint } from "../lib/render/types";
import type { DrawnPoint } from "../lib/render/curve";

const TOTAL_CHOICES = [1_000_000n, 2_000_000n, 5_000_000n];

/**
 * A running Plan outlives the page. Without this, a reload — or a hot reload while
 * filming — drops a Plan that is still chaining on-chain, and the user is left with
 * an empty canvas and no way back to it.
 */
const SAVE_KEY = "kurvv.activePlan.v1";
interface Saved { planId: number; planStart: number; drawn: DrawnPoint[]; venueKey: Venue["key"]; legCount: number; total: string }
const save = (v: Saved) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(v)); } catch {} };
const load = (): Saved | null => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null"); } catch { return null; } };
const clearSaved = () => { try { localStorage.removeItem(SAVE_KEY); } catch {} };

export default function Page() {
  const local = useMemo(() => createLocalAdapter(), []);
  const [venueKey, setVenueKey] = useState<Venue["key"]>("fast");
  const venue = VENUES[venueKey];
  const [legCount, setLegCount] = useState(6);
  const [total, setTotal] = useState<bigint>(2_000_000n);

  const [drawn, setDrawn] = useState<DrawnPoint[]>([]);
  const [preview, setPreview] = useState<Leg[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [planId, setPlanId] = useState<number | null>(null);
  const [delegated, setDelegated] = useState<boolean | null>(null);
  const [bal, setBal] = useState<{ stt: bigint; usdc: bigint } | null>(null);
  const [legs, setLegs] = useState<LegView[]>([]);
  const [dryRun, setDryRun] = useState<boolean | null>(null);

  const priceRef = useRef<PricePoint[]>([]);
  const legsRef = useRef<LegView[]>([]);
  const drawnRef = useRef<DrawnPoint[]>([]);
  /** Fixed anchor for Leg bands. Without it they re-derive from `now` each poll and slide. */
  const planStartRef = useRef<number | null>(null);
  const horizon = legCount * venue.intervalSec;

  // ── balances, delegation, dry-run flag ────────────────────────────────────
  const refreshAccount = useCallback(async () => {
    if (!local.address) return;
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
  }, [local]);

  useEffect(() => { void refreshAccount(); const t = setInterval(refreshAccount, 8000); return () => clearInterval(t); }, [refreshAccount]);

  // ── restore a Plan that is still running ──────────────────────────────────
  useEffect(() => {
    const saved = load();
    if (!saved || !PLAN_BOOK) return;
    (async () => {
      try {
        const sch = await pub.readContract({ address: PLAN_BOOK, abi: planBookAbi, functionName: "schedules", args: [BigInt(saved.planId)] }) as unknown as unknown[];
        if (!sch || (sch[0] as string) === "0x0000000000000000000000000000000000000000") { clearSaved(); return; }
        setVenueKey(saved.venueKey);
        setLegCount(saved.legCount);
        setTotal(BigInt(saved.total));
        setDrawn(saved.drawn);
        drawnRef.current = saved.drawn;
        planStartRef.current = saved.planStart;
        setPreview(curveToPlan(saved.drawn.map((p) => ({ x: p.x, y: p.y })),
          { legCount: saved.legCount, totalStake: BigInt(saved.total), minWeightShare: 0.05 }));
        setPlanId(saved.planId);
      } catch { clearSaved(); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── on-chain price series: each rolled Window's settlement reference ───────
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const since = Math.floor(Date.now() / 1000) - horizon * 5;
        const s = await rollPriceSeries(venue, since);
        if (!stop && s.length) priceRef.current = s.map((p) => ({ t: p.t, price: p.price }));
      } catch { /* leave the last good series on screen */ }
    };
    void load();
    const t = setInterval(load, venue.intervalSec * 1000 / 2);
    return () => { stop = true; clearInterval(t); };
  }, [venue, horizon]);

  // ── live Plan state ───────────────────────────────────────────────────────
  useEffect(() => {
    if (planId === null || !PLAN_BOOK) return;
    let stop = false;
    const poll = async () => {
      try {
        const n = Number(await pub.readContract({ address: PLAN_BOOK, abi: planBookAbi, functionName: "legCount", args: [BigInt(planId)] }));

        // A settled Leg is `Settled` whether it won or lost — the struct does not record
        // the outcome. Deriving it from the market's payout VECTOR keeps this to plain
        // chain reads: `getLogs` cannot help here because this RPC caps ranges at 1000
        // blocks (~100s) and a 6-Leg 60s Plan spans far more than that.
        const won = new Map<number, boolean>();
        const now = Math.floor(Date.now() / 1000);
        const out: LegView[] = [];
        for (let i = 0; i < n; i++) {
          const l = await pub.readContract({ address: PLAN_BOOK, abi: planBookAbi, functionName: "getLeg", args: [BigInt(planId), i] }) as {
            direction: number; state: number; entryPrice: number; stake: bigint; filled: bigint; marketId: `0x${string}`;
          };
          const anchor = planStartRef.current ?? now;
          const start = anchor + i * venue.intervalSec;
          // Resolve the outcome for a settled Leg, once, from the payout vector.
          if (l.state === 2 && !won.has(i) && l.marketId !== `0x${"0".repeat(64)}`) {
            try {
              const rec = await pub.readContract({ address: ADDR.module as Address, abi: moduleAbi, functionName: "markets", args: [l.marketId] }) as readonly unknown[];
              const market = rec[8] as Address;
              const nums = await pub.readContract({ address: market, abi: marketAbi, functionName: "payoutNumerators" }) as readonly bigint[];
              const mine = l.direction === 0 ? 0 : 1;
              won.set(i, (nums?.[mine] ?? 0n) > 0n);
            } catch { /* leave unknown; renders as settled-neutral */ }
          }
          const w = won.get(i);
          out.push({
            index: i,
            direction: l.direction === 0 ? "UP" : "DOWN",
            state:
              l.state === 0 ? "pending"
              : l.state === 1 ? "open"
              : l.state === 3 ? "skipped"
              : w === true ? "won" : w === false ? "lost" : "open",
            stake: l.stake, start, end: start + venue.intervalSec,
            paid: w === true ? l.filled : w === false ? 0n : undefined,
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

  // ── draw → preview ────────────────────────────────────────────────────────
  const onStrokeEnd = useCallback((pts: DrawnPoint[]) => {
    setDrawn(pts); setErr(null);
    try {
      const cp: CurvePoint[] = pts.map((p) => ({ x: p.x, y: p.y }));
      setPreview(curveToPlan(cp, { legCount, totalStake: total, minWeightShare: 0.05 }));
    } catch (e) { setPreview(null); setErr((e as Error).message); }
  }, [legCount, total]);

  useEffect(() => {
    if (drawn.length > 1) onStrokeEnd(drawn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legCount, total]);

  // ── faucet ────────────────────────────────────────────────────────────────
  const faucet = async () => {
    setErr(null); setBusy("Minting 1,000 tUSDC…");
    try {
      const h = await local.send({ to: ADDR.tusdc as Address, value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "faucet", args: [1_000_000_000n] }) });
      await pub.waitForTransactionReceipt({ hash: h });
      await refreshAccount();
    } catch (e) { setErr((e as Error).message.split("\n")[0]); } finally { setBusy(null); }
  };

  // ── commit: ONE transaction ───────────────────────────────────────────────
  const authorise = async () => {
    setErr(null); setTx(null);
    if (!PLAN_BOOK) { setErr("NEXT_PUBLIC_PLAN_BOOK is not set."); return; }
    try {
      setBusy("Finding the live Window…");
      const built = await buildCommit(drawn.map((p) => ({ x: p.x, y: p.y })), venue, legCount, total);
      setBusy(delegated ? "Sign once — approve + commit…" : "First commit: installing the batch delegate…");
      const hash = await local.sendBatch(built.calls);
      setBusy("Waiting for confirmation…");
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error(`transaction reverted — ${EXPLORER}/tx/${hash}`);
      setTx(hash);
      const id = Number(await pub.readContract({ address: PLAN_BOOK, abi: planBookAbi, functionName: "planCount" })) - 1;
      planStartRef.current = built.market.tradingStart;
      setPlanId(id);
      save({ planId: id, planStart: built.market.tradingStart, drawn, venueKey, legCount, total: String(total) });
      await refreshAccount();
    } catch (e) { setErr((e as Error).message.split("\n").slice(0, 3).join("\n")); } finally { setBusy(null); }
  };

  const cancel = async () => {
    if (planId === null) return;
    setErr(null); setBusy("Cancelling — returning unspent stake…");
    try {
      const h = await local.send({ to: PLAN_BOOK, value: 0n,
        data: encodeFunctionData({ abi: planBookAbi, functionName: "cancelPlan", args: [BigInt(planId)] }) });
      await pub.waitForTransactionReceipt({ hash: h });
      clearSaved(); setPlanId(null); setTx(null);
      await refreshAccount();
    } catch (e) { setErr((e as Error).message.split("\n")[0]); } finally { setBusy(null); }
  };

  const canCommit = !!preview && drawn.length > 1 && !busy && !!local.address && !!PLAN_BOOK;

  return (
    <div className="wrap">
      <header>
        <h1>KURVV</h1>
        <span className="tag">Draw the market. The chain trades it.</span>
      </header>

      <div className="bar">
        <span className="mono dim">{local.address ? `${local.address.slice(0, 6)}…${local.address.slice(-4)}` : "no wallet"}</span>
        <span className={`pill ${local.kind === "local" ? "on" : ""}`}>{local.kind === "local" ? "local key · demo path" : local.kind}</span>
        {bal && <span className="mono dim">{fmtStt(bal.stt, 3)} STT · {fmtUsdc(bal.usdc, 2)} tUSDC</span>}
        {delegated !== null && <span className={`pill ${delegated ? "on" : ""}`}>{delegated ? "7702 delegated" : "not yet delegated"}</span>}
        {dryRun !== null && <span className={`pill ${dryRun ? "" : "on"}`}>{dryRun ? "DRY RUN" : "LIVE"}</span>}
        <span className="grow" />
        <button onClick={faucet} disabled={!!busy}>Get test tUSDC</button>
      </div>

      <div className="cols">
        <div>
          <Canvas
            priceRef={priceRef} legsRef={legsRef} drawnRef={drawnRef}
            horizonSec={horizon} drawingEnabled={!busy && planId === null}
            onStrokeEnd={onStrokeEnd}
          />
          <div className="bar">
            <label className="dim">Window</label>
            <select value={venueKey} onChange={(e) => setVenueKey(e.target.value as Venue["key"])}>
              {Object.values(VENUES).map((v) => <option key={v.key} value={v.key}>{v.label} · series {v.seriesId}</option>)}
            </select>
            <label className="dim">Legs</label>
            <input type="range" min={2} max={8} value={legCount} onChange={(e) => setLegCount(Number(e.target.value))} />
            <span className="mono">{legCount}</span>
            <label className="dim">Stake</label>
            <select value={String(total)} onChange={(e) => setTotal(BigInt(e.target.value))}>
              {TOTAL_CHOICES.map((t) => <option key={String(t)} value={String(t)}>{fmtUsdc(t, 2)} tUSDC</option>)}
            </select>
            <span className="grow" />
            <span className="mono dim">horizon {Math.round(horizon / 60)}m</span>
          </div>
          <div className="dim" style={{ fontSize: 12 }}>{venue.blurb} The dashed line is now — draw to the right of it.</div>
        </div>

        <div className="panel">
          <h3>THE PLAN</h3>
          {!preview && <div className="dim" style={{ fontSize: 12 }}>Draw a curve across the future space to build a Plan.</div>}
          {preview && (
            <>
              <table>
                <thead><tr><th>#</th><th>Dir</th><th>Conviction</th><th>Stake</th><th>State</th></tr></thead>
                <tbody>
                  {preview.map((l, i) => {
                    const live = legs[i];
                    return (
                      <tr key={i}>
                        <td className="dim">{i}</td>
                        <td className={l.direction === "UP" ? "up" : "down"}>{l.direction === "UP" ? "▲ UP" : "▼ DOWN"}</td>
                        <td className="dim">{(l.weight * 100).toFixed(1)}%</td>
                        <td>{fmtUsdc(l.stake, 3)}</td>
                        <td className={live?.state === "won" ? "up" : live?.state === "lost" ? "down" : "dim"}>
                          {live ? (live.state === "won" && live.paid ? `won +${fmtUsdc(live.paid, 3)}` : live.state) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="custody">
                Authorising approves <strong>exactly {fmtUsdc(total, 3)} tUSDC</strong> — never an unlimited
                allowance. The contract can pull exactly this amount, and its only outbound
                path is back to you. You can cancel at any time and any stake it has not
                yet deployed is returned.
              </div>
              {delegated === false && (
                <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
                  First commit also installs the batch delegate, so it carries a fixed gas
                  limit. Later commits are a single ordinary transaction.
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="primary" onClick={authorise} disabled={!canCommit}>
                  {busy ?? "Authorise — one signature"}
                </button>
                <button className="danger ghost" onClick={cancel} disabled={planId === null || !!busy}>Cancel Plan</button>
                {planId !== null && (
                  <button className="ghost" onClick={() => { clearSaved(); setPlanId(null); setTx(null); setDrawn([]); drawnRef.current = []; legsRef.current = []; setLegs([]); setPreview(null); }} disabled={!!busy}>New</button>
                )}
              </div>
              {tx && <div className="ok" style={{ marginTop: 8 }}>
                Committed in one transaction · <a href={`${EXPLORER}/tx/${tx}`} target="_blank" rel="noreferrer" style={{ color: "#22c55e" }}>{tx.slice(0, 12)}…</a>
              </div>}
              {err && <div className="err">{err}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
