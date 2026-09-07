"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DeviceStage } from "../../components/DeviceStage";
import type { Mode } from "../../components/Device3D";
import { InstallApp } from "../../components/InstallApp";
import { ShareCard } from "../../components/ShareCard";
import type { CardData } from "../../lib/share/card";
import { startDeck } from "../../lib/deck/render";
import { HANDLE_VARIANTS, handleFor, readHandleVariant, writeHandleVariant } from "../../lib/handle";
import { curveToPlan, type CurvePoint, type Leg } from "../../lib/curve";
import { cellsToPlan, emptyCells, hasPositions, type PixelCells } from "../../lib/pixel";
import { densePriceSeries } from "../../lib/priceSeries";
import { rollPriceSeries, venueIsLive } from "../../lib/commit";
import { subscribeFills } from "../../lib/liveFills";
import { usePlan } from "../../lib/usePlan";
import { useFlappy } from "../../lib/useFlappy";
import { useFires } from "../../lib/useFires";
import { useWindowClock } from "../../lib/useWindowClock";
import { PLAN_BOOK } from "../../lib/commit";
import { venueOf, EXPLORER, type Venue } from "../../lib/venues";
import { sfx } from "../../lib/sfx";
import type { DrawPoint } from "../../lib/render/types";
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
  const [card, setCard] = useState<CardData | null>(null);
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
        merge(add);
      } catch { /* the next tick tries again */ }
    };

    /**
     * Merge a batch of fills into the series.
     *
     * Shared by the socket and the poll so both agree on what "new" means. It reads
     * `priceRef` at call time rather than closing over it: a slow full refresh can
     * switch the series to a different source mid-flight, and appending onto a base
     * captured beforehand would silently revert that switch.
     */
    const merge = (add: { t: number; price: number }[]) => {
      if (stop || !add.length) return;
      const cur = priceRef.current;
      const from = cur.length ? cur[cur.length - 1].t : 0;
      const fresh = add.filter((p) => p.t > from);
      if (fresh.length) priceRef.current = [...cur, ...fresh].slice(-4000);
    };

    // PUSHED, with the poll as the fallback. See `lib/liveFills.ts` — the socket is
    // an optimisation, so the interval stays and simply skips its turn while the
    // subscription is carrying.
    const live = subscribeFills(venue.asset, merge);

    void run();
    const slow = setInterval(run, 30_000);
    const fast = setInterval(() => { if (!live.connected()) void head(); }, 1_500);
    return () => { stop = true; live.close(); clearInterval(slow); clearInterval(fast); };
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
     * `venueIsLive` asks about the series' recency, which measured zero misses over
     * a run spanning several rolls, so this is margin rather than the load-bearing
     * part it used to be: it now only absorbs a transient indexer error. A dormant
     * venue misses every time and still reports dead within half a minute.
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
    // `revision` and not `cells`: a flight mutates its round in place, so the array
    // identity only changes at a round boundary and the preview would lag a whole
    // round behind the calls being made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flappy.cells, flappy.revision]);

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

  // `rebuild` changes with the flight's revision, so this one effect now covers the
  // continuous case too — there is no end-of-run to hang a second effect off.
  useEffect(() => { rebuild(mode, legCount, total); }, [mode, legCount, total, rebuild]);

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

  /**
   * A GESTURE BELONGS TO THE VENUE IT WAS MADE ON.
   *
   * Switching asset or Window used to leave the Curve and the painted cells exactly
   * where they were, so a shape drawn against BTC's 60-second Windows silently became
   * a Plan on ETH's — same directions, same stakes, a different market. The preview
   * still said "6 LEGS READY" and the commit would have gone through.
   *
   * Keyed on `venue`, which is the (asset, Window) pair, because both halves
   * re-target the Legs. Skipped on the FIRST run so opening the page does not clear
   * a Plan restored from a previous session.
   */
  const firstVenue = useRef(true);
  useEffect(() => {
    if (firstVenue.current) { firstVenue.current = false; return; }
    curveRef.current = [];
    cellsRef.current = emptyCells(legCount);
    setPreview(null);
    setDrawErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  /**
   * Is this the phone layout? The console takes the frame almost exactly.
   *
   * `fill` is a fraction of the canvas the device occupies, and on a phone every
   * percent of it is legibility — 0.8 left a fifth of an already small screen empty.
   * Matched against the same query the stylesheet uses, so the rail the CSS reserves
   * and the space the device thinks it has cannot disagree.
   */
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape) and (max-height: 560px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /**
   * ONBOARDING ON ARRIVAL.
   *
   * If there is no account by the time the wallet adapter has loaded, open Privy's
   * sign-in rather than leaving someone on a device that quietly cannot do anything.
   * Guarded by a ref, not by the effect's deps: `connect` is a new function on most
   * renders, and without the guard this reopens the modal every time one happens.
   *
   * THIS ATTEMPT IS NOT ENOUGH ON ITS OWN. Opening a modal from an effect is not a
   * user gesture, and a mobile browser is entitled to suppress it — which it did,
   * silently, leaving a phone on a device that looked fine and could do nothing. So
   * the gate below renders whenever there is no account, and its button is a real
   * gesture. The auto-attempt is the convenience; the gate is the guarantee.
   */
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !plan.ready || plan.address) return;
    asked.current = true;
    void plan.connect();
  }, [plan.ready, plan.address, plan.connect]);

  /**
   * The name, on desktop.
   *
   * The device has always been able to reroll it from its profile screen, but that
   * needs a wheel and a keyboard the phone layout does not show. Same store, same
   * deterministic sequence — this is a second door to it, not a second source.
   */
  const [nameVariant, setNameVariant] = useState(0);
  useEffect(() => {
    if (!plan.address) return;
    setNameVariant(readHandleVariant(plan.address) ?? 0);
  }, [plan.address]);

  const reroll = useCallback(() => {
    const addr = plan.address;
    if (!addr) return;
    setNameVariant((v) => {
      const next = (v + 1) % HANDLE_VARIANTS;
      writeHandleVariant(addr, next);
      window.dispatchEvent(new CustomEvent("kurvv:handle", { detail: { address: addr, variant: next } }));
      return next;
    });
  }, [plan.address]);

  /**
   * The world behind the device: the same neon-night scene the deck opens on, so
   * `/play` is somewhere rather than a flat colour. `startDeck` renders a single
   * scene when handed a constant position.
   */
  const bgRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = bgRef.current;
    if (!c) return;
    return startDeck(c, () => 0);
  }, []);

  const onNew = useCallback(() => {
    plan.reset();
    curveRef.current = [];
    cellsRef.current = emptyCells(legCount);
    setPreview(null);
  }, [plan, legCount]);

  /**
   * Share the moment, not the page.
   *
   * The old version dumped the raw device canvas to a file. This builds a card: the
   * device, whose handle it is, and what the Plan actually did — see
   * `lib/share/card.ts`. Reading the device's own canvas beats any screenshot
   * library, because the chart, the Plan and the skin are already on it.
   */
  const share = useCallback(() => {
    /**
     * SNAPSHOT THE DEVICE NOW, while it is still on screen.
     *
     * Handing the live WebGL canvas to the dialog does not work: the moment the
     * modal covers the device it stops drawing, and a preserved buffer whose last
     * frame was a clear reads back as empty. The card then painted everything
     * except its subject. Copying to a 2D canvas here freezes the frame the user
     * actually pressed the button on, which is also the correct one to share.
     */
    const live = document.querySelector<HTMLCanvasElement>(".dev3d-gl");
    let device: HTMLCanvasElement | null = null;
    if (live && live.width > 0 && live.height > 0) {
      const shot = document.createElement("canvas");
      shot.width = live.width;
      shot.height = live.height;
      shot.getContext("2d")?.drawImage(live, 0, 0);
      device = shot;
    }
    const addr = plan.address ?? "";
    // Only SETTLED Legs count. Counting an open position as a loss would report a
    // result that has not happened yet.
    let staked = 0n;
    let paid = 0n;
    let won = 0;
    let lost = 0;
    for (const l of plan.legs) {
      if (l.state !== "won" && l.state !== "lost" && l.state !== "void") continue;
      staked += l.stake;
      paid += l.paid ?? 0n;
      if (l.state === "won") won += 1;
      else if (l.state === "lost") lost += 1;
    }
    setCard({
      handle: addr ? handleFor(addr, readHandleVariant(addr) ?? 0) : "guest",
      net: paid - staked,
      staked,
      legs: plan.legs.length,
      won,
      lost,
      device,
    });
  }, [plan.address, plan.legs]);

  const status = plan.busy ?? plan.err ?? drawErr
    ?? (mode === "flappy" && flappy.unsupported
      ? `The ${venue.label.toLowerCase()} window publishes no reference level, so gates cannot be anchored. Switch to 60s or 5m.`
      : null)
    ?? (venueLive === false
      ? `No ${venue.asset} market is open on the ${venue.label.toLowerCase()} window right now.`
      : null);

  return (
    <main className="play">
      <canvas className="play-bg" ref={bgRef} aria-hidden />

      <DeviceStage
        fill={compact ? 1 : 0.8} floatOnly still={compact}
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
        flappyUnsupported={mode === "flappy" && flappy.unsupported}
        onFlap={flappy.running ? flappy.tap : null}
        chain={{
          address: plan.address, bal: plan.bal, delegated: plan.delegated, dryRun: plan.dryRun,
          connected: !!plan.address, hasPlan: plan.planId !== null,
          needsGas: plan.needsGas, walletLabel: plan.walletLabel,
          // A wallet that cannot pay for gas cannot commit. Without this the centre
          // key sends a transaction that is certain to fail, and the user is told
          // "reverted" when the real answer is "you have no STT".
          canCommit: !!preview && !plan.busy && venueLive !== false && !plan.needsGas,
          connect: plan.connect, faucet: plan.faucet, fundGas: plan.fundGas,
          commit, cancel: plan.cancel, reset: onNew,
        }}
      />

      <div className="play-hud">
        <Link className="play-link" href="/">← Home</Link>
        <Link className="play-link" href="/play/demo">How it works</Link>
      </div>

      {plan.address && (
        <div className="play-who">
          <span className="play-who-n">{handleFor(plan.address, nameVariant).toUpperCase()}</span>
          <button className="play-who-b" onClick={reroll} title="Change name" aria-label="Change name">
            NEW NAME
          </button>
        </div>
      )}

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
        <span>Share</span>
      </button>
      </div>

      {plan.ready && !plan.address && (
        <div className="play-gate">
          <div className="play-gate-card">
            <p className="play-gate-k">Somnia Shannon testnet</p>
            <h2>Sign in to play</h2>
            <p>
              An email is enough — a wallet is created for you. Test tUSDC is free from
              the faucet, and nothing here touches real money.
            </p>
            <button className="lp-btn lp-btn-go" onClick={() => { void plan.connect(); }}>
              Sign in
            </button>
          </div>
        </div>
      )}

      {card && <ShareCard data={card} onClose={() => setCard(null)} />}

      {status && <div className={`play-status ${plan.err || drawErr ? "bad" : ""}`}>{status}</div>}
      {plan.tx && (
        <a className="play-tx" href={`${EXPLORER}/tx/${plan.tx}`} target="_blank" rel="noreferrer">
          {plan.batched ? "Committed in one transaction" : "Committed"} · {plan.tx.slice(0, 12)}…
        </a>
      )}
      {/*
        THE BALANCE MOVED ONTO THE DEVICE. It used to sit here, outside the object the
        user is holding, which split one decision across two surfaces — the bets were
        on the second screen and what you could afford was in a corner of the web
        page. It is now beside the staked total where it belongs.

        The dry-run badge STAYS. It is not a wallet figure, it is whether pressing
        commit opens real positions, and that belongs where it cannot be missed.
      */}
      {plan.dryRun !== null && (
        <div className="play-bal">
          <span className={plan.dryRun ? "" : "live"}>{plan.dryRun ? "dry run" : "live"}</span>
        </div>
      )}

      {/*
        Portrait is blocked, not hinted. See `.play-rotate` — the device is a
        landscape object and a portrait phone renders it too small to operate.
      */}
      <div className="play-rotate">
        <div className="play-rotate-icon" />
        <strong>Turn your phone sideways</strong>
        <span>KURVV is a landscape console. Rotate to play.</span>
      </div>

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
