"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DeviceStage } from "../../components/DeviceStage";
import { curveToPlan, type CurvePoint, type Leg } from "../../lib/curve";
import { densePriceSeries } from "../../lib/priceSeries";
import { rollPriceSeries } from "../../lib/commit";
import { VENUES } from "../../lib/venues";
import type { DrawPoint } from "../../lib/three/chart";
import type { LegView, PricePoint } from "../../lib/render/types";

/**
 * A drawn point is normalised: `u` across the future span, `v` bottom-to-top.
 * `curveToPlan` wants CANVAS orientation, where y grows downward — so the flip
 * happens exactly here, once, and nowhere else.
 */
const toCurvePoints = (pts: DrawPoint[]): CurvePoint[] => pts.map((p) => ({ x: p.u, y: -p.v }));

export default function Play() {
  const [legCount, setLegCount] = useState(6);
  const [preview, setPreview] = useState<Leg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const priceRef = useRef<PricePoint[]>([]);
  const legsRef = useRef<LegView[]>([]);
  const curveRef = useRef<DrawPoint[]>([]);
  const planStartRef = useRef<number | null>(null);

  const venue = VENUES.fast;
  const horizon = legCount * venue.intervalSec;

  // Real on-chain observations: WBTC spot fills from the same indexer the Event
  // Contracts settle against. Nothing is interpolated; gaps stay gaps.
  useEffect(() => {
    let stop = false;
    const run = async () => {
      try {
        const since = Math.floor(Date.now() / 1000) - horizon * 5;
        let s = await densePriceSeries(venue.key, since);
        if (!s.length) s = await rollPriceSeries(venue, since);
        if (!stop && s.length) priceRef.current = s.map((p) => ({ t: p.t, price: p.price }));
      } catch { /* leave the last good series on screen */ }
    };
    void run();
    const t = setInterval(run, venue.intervalSec * 500);
    return () => { stop = true; clearInterval(t); };
  }, [venue, horizon]);

  const onStrokeEnd = useCallback((pts: DrawPoint[]) => {
    setErr(null);
    if (pts.length < 2) { setPreview(null); return; }
    try {
      setPreview(curveToPlan(toCurvePoints(pts), {
        legCount, totalStake: 2_000_000n, minWeightShare: 0.05,
      }));
    } catch (e) { setPreview(null); setErr((e as Error).message); }
  }, [legCount]);

  /**
   * Share the moment, not the page.
   *
   * The device's own canvas is the artefact — it already carries the chart, the Plan
   * and the skin. Reading it directly avoids a screenshot library and keeps whatever
   * the user is actually looking at.
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

  return (
    <main className="play">
      <DeviceStage
        fill={0.8} particles floatOnly
        priceRef={priceRef} legsRef={legsRef} curveRef={curveRef}
        planStartRef={planStartRef} horizonSec={horizon}
        onStrokeEnd={onStrokeEnd} onLegs={setLegCount}
        plan={preview ?? undefined}
      />

      <div className="play-hud">
        <Link className="play-link" href="/">← Home</Link>
        <Link className="play-link" href="/play/demo">How it works</Link>
      </div>

      <button className="play-share" onClick={share} title="Share this" aria-label="Share this">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 8.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19V8.5a1.5 1.5 0 0 0-1.5-1.5h-2.2l-1-2h-6.6l-1 2H5.5A1.5 1.5 0 0 0 4 8.5Z"
            stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <circle cx="12" cy="13" r="3.6" stroke="currentColor" strokeWidth="1.7" />
        </svg>
        <span>{shared ? "Saved" : "Share"}</span>
      </button>

      {err && <div className="play-err">{err}</div>}

      <div className="play-keys">
        <span><kbd>↑↓</kbd>move</span>
        <span><kbd>↵</kbd>select</span>
        <span><kbd>E</kbd>draw</span>
        <span><kbd>Q</kbd>swap</span>
        <span><kbd>D</kbd>board</span>
        <span><kbd>N</kbd>new</span>
        <span><kbd>←</kbd>back</span>
      </div>
    </main>
  );
}
