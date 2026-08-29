"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DeviceStage } from "../../components/DeviceStage";
import type { Mode } from "../../components/Device3D";
import { InstallApp } from "../../components/InstallApp";
import { curveToPlan, type CurvePoint, type Leg } from "../../lib/curve";
import { cellsToPlan, emptyCells, hasPositions, type PixelCells } from "../../lib/pixel";
import { densePriceSeries } from "../../lib/priceSeries";
import { rollPriceSeries, venueIsLive } from "../../lib/commit";
import { usePlan } from "../../lib/usePlan";
import { useFlappy } from "../../lib/useFlappy";
import { useFires } from "../../lib/useFires";
import { useWindowClock } from "../../lib/useWindowClock";
import { PLAN_BOOK } from "../../lib/commit";
import { VENUES, venueOf, EXPLORER, type Venue } from "../../lib/venues";
import { fmtUsdc } from "../../lib/chain";
import { sfx } from "../../lib/sfx";
import type { DrawPoint } from "../../lib/three/chart";
import type { PricePoint } from "../../lib/render/types";

/**
 * A drawn point is normalised: `u` across the future span, `v` bottom-to-top.
 * `curveToPlan` wants CANVAS orientation, where y grows downward — so the flip
 * happens exactly here, once, and nowhere else.
 */
const toCurvePoints = (pts: DrawPoint[]): CurvePoint[] => pts.map((p) => ({ x: p.u, y: -p.v }));

const STAKES = [500_000n, 1_000_000n, 2_000_000n, 5_000_000n, 10_000_000n] as const;

export default function Play() {
  const [legCount, setLegCount] = useState(6);
  const [venueKey, setVenueKey] = useState<Venue["key"]>("fast-btc");
  const [stakeIndex, setStakeIndex] = useState(2);
  const [preview, setPreview] = useState<Leg[] | null>(null);
  const [drawErr, setDrawErr] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [muted, setMuted] = useState(false);
  const [venueLive, setVenueLive] = useState<boolean | null>(null);

  const venue = venueOf(venueKey);
  const total = STAKES[stakeIndex];
  const horizon = legCount * venue.intervalSec;

  const priceRef = useRef<PricePoint[]>([]);
  /**
   * Every drawn Curve, oldest first; the LAST is the one that commits.
   *
   * Earlier Curves stay on the chart to compare against rather than being wiped by
   * the next stroke. They are presentation only — one Plan is committed at a time,
   * and it is always the newest line.
   */
  const curveRef = useRef<DrawPoint[][]>([]);
  const activeCurve = () => curveRef.current[curveRef.current.length - 1] ?? [];
  const cellsRef = useRef<PixelCells>(emptyCells(8));
  const [mode, setMode] = useState<Mode>("draw");

  const plan = usePlan(venue);

  /**
   * Flappy runs against real, finished Windows.
   *
   * A rehearsal, not a position: the Windows it grades against have already settled,
   * so the verdicts are real but nothing is staked. It is the fastest honest way to
   * show the at-the-money staircase and the hit rule.
   */
  const flappy = useFlappy(venue, mode === "flappy", legCount);

  /**
   * The Reactivity fire feed — the evidence that nobody signed the Legs.
   *
   * `useFires` pages the PlanBook's own logs forward and marks every invocation
   * where `from == to == the contract`, which is a shape no private key can produce.
   * The handler also publishes the millisecond its one-shot open fires, so that is
   * preferred over the extrapolated Window clock whenever it is still ahead of now.
   */
  const feed = useFires(PLAN_BOOK || undefined, plan.planId, plan.planStartRef.current, (_i, paid) => {
    sfx.settle(paid > 0n);
  });
  const clock = useWindowClock(venue);
  const scheduled = feed.scheduledOpenMs !== null && feed.scheduledOpenMs > Date.now()
    ? (feed.scheduledOpenMs - Date.now()) / 1000
    : null;

  /**
   * Real on-chain observations, in falling order of directness.
   *
   * 1. Spot fills from the same indexer the Event Contracts settle against.
   * 2. This venue's own market references, parsed from the question text.
   * 3. The 60-second venue's references for the same asset.
   *
   * Step 3 is not a nicety. The WETH spot book is effectively dead — five fills in
   * thirty hours — so ETH would chart as an empty frame on step 1, and the hourly
   * venue asks "closes at or above its opening price", which carries no number at
   * all, so step 2 is empty there too. The 60s venue prints a real price for both
   * assets every minute. The asset's price does not depend on which Window a Plan
   * targets, so borrowing that series is exact, not an approximation.
   *
   * Nothing is interpolated; gaps stay gaps.
   */
  useEffect(() => {
    let stop = false;
    const run = async () => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const since = now - horizon * 5;
        // Emptiness is the wrong test. The WETH book returns a handful of fills from
        // eight hours ago, which is non-empty and useless: the chart draws a line
        // that stops at the far edge of the past. A source counts only if its newest
        // observation is recent enough to be the head of the timeline.
        const fresh = (s: { t: number }[]) =>
          s.length > 1 && now - s[s.length - 1].t < Math.max(venue.intervalSec * 4, 600);

        let s = await densePriceSeries(venue.key, since);
        if (!fresh(s)) s = await rollPriceSeries(venue, since);
        // Last resort: the same asset's fastest venue. NEVER another asset's — the
        // panel labels the chart from `venue.asset`, so borrowing BTC fills for a
        // SOMI selection draws BTC under a "SOMI/USD" heading. SOMI has a registered
        // series that has never rolled a market, so this is not hypothetical: it is
        // exactly the selection that falls through to here.
        if (!fresh(s) && venue.asset !== "SOMI") {
          s = await rollPriceSeries(venueOf(`fast-${venue.asset === "ETH" ? "eth" : "btc"}`), since);
        }
        if (!stop && fresh(s)) priceRef.current = s.map((p) => ({ t: p.t, price: p.price }));
      } catch { /* leave the last good series on screen */ }
    };
    /**
     * The head, polled fast.
     *
     * A full refetch is a six-thousand-row query and cannot run every second, but the
     * chart has to move or a sixty-second Window looks frozen. So the whole series is
     * rebuilt slowly and only the points newer than the last one are appended in
     * between. `_gt` on the last timestamp means the incremental query is tiny.
     */
    const head = async () => {
      const lastT = priceRef.current.length ? priceRef.current[priceRef.current.length - 1].t : 0;
      if (!lastT) return;
      try {
        const add = await densePriceSeries(venue.key, lastT);
        if (stop || !add.length) return;
        // Re-read the base AFTER the await. A slow full refresh can land inside this
        // 1.5s window and switch the series to a different source; appending onto a
        // base captured beforehand would silently revert that switch and then keep
        // extending the reverted array on every subsequent tick.
        const cur = priceRef.current;
        const from = cur.length ? cur[cur.length - 1].t : 0;
        const fresh = add.filter((p) => p.t > from);
        if (fresh.length) priceRef.current = [...cur, ...fresh].slice(-4000);
      } catch { /* the next tick tries again */ }
    };

    void run();
    const slow = setInterval(run, 30_000);
    const fast = setInterval(head, 1_500);
    return () => { stop = true; clearInterval(slow); clearInterval(fast); };
  }, [venue, horizon]);

  /**
   * Is this venue rolling? A series can stall — the 15-minute one did — and the
   * chain's own token has a series that has never rolled at all. Both look identical
   * from the picker unless it is asked, and finding out at commit time is too late.
   */
  useEffect(() => {
    let stop = false;
    setVenueLive(null);
    /**
     * Dead only after several misses in a row.
     *
     * A 60-second Window genuinely has no openable market for its last dozen
     * seconds — `minHeadroom` refuses the tail on purpose — so a single miss is
     * normal operation, not a stalled series. A dormant venue misses every time.
     */
    let misses = 0;
    const probe = async () => {
      try {
        const ok = await venueIsLive(venue);
        if (stop) return;
        misses = ok ? 0 : misses + 1;
        if (ok) setVenueLive(true);
        else if (misses >= 3) setVenueLive(false);
      } catch { if (!stop) setVenueLive(null); }
    };
    void probe();
    const t = setInterval(probe, 8_000);
    return () => { stop = true; clearInterval(t); };
  }, [venue]);

  // A restored Plan brings its Curve back with it.
  useEffect(() => {
    if (!plan.restored) return;
    curveRef.current = plan.restored.curve.length ? [plan.restored.curve] : [];
    setLegCount(plan.restored.legCount);
    setVenueKey(plan.restored.venueKey);
    const i = STAKES.indexOf(BigInt(plan.restored.total) as (typeof STAKES)[number]);
    if (i >= 0) setStakeIndex(i);
    try {
      setPreview(curveToPlan(toCurvePoints(plan.restored.curve), {
        legCount: plan.restored.legCount, totalStake: BigInt(plan.restored.total), minWeightShare: 0.05,
      }));
    } catch { /* a saved curve that no longer parses is not worth surfacing */ }
  }, [plan.restored]);

  /**
   * Turn whichever gesture is active into a preview Plan.
   *
   * Both modes end at the same `Leg[]`; only the input differs. Keeping one rebuild
   * means the strip, the preview and the commit can never disagree about what the
   * user just made.
   */
  const rebuild = useCallback((m: Mode, lc: number, tot: bigint) => {
    setDrawErr(null);
    try {
      // Flappy is declared on the play key but not built; it must not silently
      // produce a Plan from whatever the previous mode left behind.
      if (m === "flappy") {
        // A finished run authors a Plan through the SAME builder the grid uses.
        if (!hasPositions(flappy.cells)) { setPreview(null); return; }
        setPreview(cellsToPlan(flappy.cells, { totalStake: tot, minWeightShare: 0.05 }).legs);
        return;
      }
      if (m === "pixel") {
        if (!hasPositions(cellsRef.current)) { setPreview(null); return; }
        setPreview(cellsToPlan(cellsRef.current, { totalStake: tot, minWeightShare: 0.05 }).legs);
        return;
      }
      const c = activeCurve();
      if (c.length < 2) { setPreview(null); return; }
      setPreview(curveToPlan(toCurvePoints(c), { legCount: lc, totalStake: tot, minWeightShare: 0.05 }));
    } catch (e) { setPreview(null); setDrawErr((e as Error).message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flappy.cells]);

  const onStrokeEnd = useCallback(() => rebuild(mode, legCount, total), [rebuild, mode, legCount, total]);

  // The grid is one cell per Window, so changing the Leg count reshapes it. Painted
  // columns beyond the new width are dropped rather than silently committed.
  //
  // THIS MUST RESHAPE BEFORE THE PREVIEW IS REBUILT. Effects run in declaration
  // order, so with the rebuild first a Leg-count change previewed the OLD, longer
  // grid while `commit` read the live ref — the strip showed eight Legs and the
  // transaction sent four. Worse, trimming a ref schedules no render, so nothing ever
  // re-ran the rebuild to correct it.
  useEffect(() => {
    const cur = cellsRef.current;
    const next = emptyCells(legCount);
    for (let i = 0; i < Math.min(cur.length, legCount); i++) next[i] = cur[i];
    cellsRef.current = next;
  }, [legCount]);

  useEffect(() => { rebuild(mode, legCount, total); }, [mode, legCount, total, rebuild]);
  // A run mutates its cells in place, so the preview is rebuilt when it ends.
  useEffect(() => {
    if (mode === "flappy" && !flappy.running) rebuild(mode, legCount, total);
  }, [mode, flappy.running, legCount, total, rebuild]);

  /** The centre key commits whichever gesture is live. */
  const commit = useCallback(() => {
    // `cellsToPlan` THROWS on an empty grid, and this runs inside a pointer handler —
    // outside `usePlan`'s try/catch, so an unguarded throw surfaces nowhere and shows
    // the user nothing at all.
    try {
      if (mode === "flappy" || mode === "pixel") {
        const cells = mode === "flappy" ? flappy.cells : cellsRef.current;
        const built = cellsToPlan(cells, { totalStake: total, minWeightShare: 0.05 });
        void plan.commitLegs(built.legs, venue, total, cells.map((c) => c ?? null));
        return;
      }
      void plan.commit(activeCurve(), toCurvePoints, venue, legCount, total);
    } catch (e) { setDrawErr((e as Error).message); }
  }, [plan, venue, legCount, total, mode, flappy.cells]);

  const onNew = useCallback(() => {
    plan.reset();
    curveRef.current = [];
    cellsRef.current = emptyCells(legCount);
    setPreview(null);
  }, [plan, legCount]);

  /**
   * Share the moment, not the page. The device's canvas already carries the chart,
   * the Plan and the skin, so reading it directly beats any screenshot library.
   */
  const share = useCallback(async () => {
    const c = document.querySelector<HTMLCanvasElement>(".dev3d-gl");
    if (!c) return;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) return;
    const file = new File([blob], "kurvv.png", { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "KURVV", text: "Drew the market. The chain traded it." });
        return;
      } catch { /* dismissed — fall through to a download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kurvv.png";
    a.click();
    URL.revokeObjectURL(url);
    setShared(true);
    window.setTimeout(() => setShared(false), 1800);
  }, []);

  const status = plan.busy ?? plan.err ?? drawErr
    ?? (mode === "flappy" && flappy.unsupported
      ? `The ${venue.label.toLowerCase()} window publishes no reference level, so gates cannot be anchored. Switch to 60s or 5m.`
      : null)
    ?? (venueLive === false
      ? `No ${venue.asset} market is open on the ${venue.label.toLowerCase()} window right now.`
      : null);

  return (
    <main className="play">
      <DeviceStage
        fill={0.8} particles floatOnly
        fires={feed.fires}
        fireState={{
          scanning: feed.scanning, error: feed.error,
          hasPlan: plan.planId !== null,
          nextOpenSec: scheduled ?? (plan.planId !== null ? clock.toOpen : null),
        }}
        priceRef={priceRef} legsRef={plan.legsRef} curveRef={curveRef} cellsRef={cellsRef}
        onMode={setMode}
        planStartRef={plan.planStartRef} planId={plan.planId}
        horizonSec={horizon} onStrokeEnd={onStrokeEnd}
        onLegs={setLegCount} onVenue={setVenueKey} onStake={setStakeIndex}
        plan={preview ?? undefined} venueLive={venueLive}
        gates={flappy.view} onStartRun={flappy.start} score={mode === "flappy" ? flappy.score : null}
        onFlap={flappy.running ? flappy.tap : null}
        chain={{
          address: plan.address, bal: plan.bal, delegated: plan.delegated, dryRun: plan.dryRun,
          connected: !!plan.address, hasPlan: plan.planId !== null,
          canCommit: !!preview && !plan.busy && venueLive !== false,
          connect: plan.connect, faucet: plan.faucet, commit, cancel: plan.cancel, reset: onNew,
        }}
      />

      <div className="play-hud">
        <Link className="play-link" href="/">← Home</Link>
        <Link className="play-link" href="/play/demo">How it works</Link>
      </div>

      <div className="play-actions">
      <InstallApp />
      <button
        className="play-share play-mute"
        onClick={() => { const v = !muted; setMuted(v); sfx.setEnabled(!v); if (!v) sfx.unlock(); }}
        title={muted ? "Sound off" : "Sound on"} aria-label={muted ? "Turn sound on" : "Turn sound off"}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"
            stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          {muted
            ? <path d="m16.5 9.5 4 5m0-5-4 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            : <path d="M15.8 8.6a4.6 4.6 0 0 1 0 6.8M18.4 6.2a8 8 0 0 1 0 11.6"
                stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
        </svg>
      </button>

      <button className="play-share" onClick={share} title="Share this" aria-label="Share this">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 8.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19V8.5a1.5 1.5 0 0 0-1.5-1.5h-2.2l-1-2h-6.6l-1 2H5.5A1.5 1.5 0 0 0 4 8.5Z"
            stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <circle cx="12" cy="13" r="3.6" stroke="currentColor" strokeWidth="1.7" />
        </svg>
        <span>{shared ? "Saved" : "Share"}</span>
      </button>
      </div>

      {status && <div className={`play-status ${plan.err || drawErr ? "bad" : ""}`}>{status}</div>}
      {plan.tx && (
        <a className="play-tx" href={`${EXPLORER}/tx/${plan.tx}`} target="_blank" rel="noreferrer">
          Committed in one transaction · {plan.tx.slice(0, 12)}…
        </a>
      )}
      {plan.bal && (
        <div className="play-bal">
          {fmtUsdc(plan.bal.usdc, 2)} tUSDC
          {plan.dryRun !== null && <span className={plan.dryRun ? "" : "live"}>{plan.dryRun ? "dry run" : "live"}</span>}
        </div>
      )}

      <div className="play-rotate">Turn your phone for a bigger device</div>

      <div className="play-keys">
        <span><kbd>↑↓</kbd>move</span>
        <span><kbd>↵</kbd>select / commit</span>
        <span><kbd>E</kbd>draw</span>
        <span><kbd>Q</kbd>swap</span>
        <span><kbd>D</kbd>asset</span>
        <span><kbd>P</kbd>profile</span>
        <span><kbd>M</kbd>mode</span>
        <span><kbd>←</kbd>cancel</span>
      </div>
    </main>
  );
}
