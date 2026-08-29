"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  COLUMN_MS, birdPath, columnAt, gradeRun, hasReference, refSeries, runProgress,
  startRun, tap as tapRun, type RefWindow, type Run,
} from "./flappy";
import type { GatesData } from "./three/gates";
import type { Venue } from "./venues";
import type { PixelCells } from "./pixel";

/**
 * FLAPPY MODE — the practice run.
 *
 * The price only moves at real time, so a live game is a minute per Leg and an hour
 * is not a game. The answer is that the whole thing can be REHEARSED against real
 * history: the last N Windows carry their own reference levels and their own settled
 * outcomes, so replaying them is a complete, honest run with no wallet, no
 * transaction and nothing written to the chain.
 *
 * It is also the fastest way to teach the product. Eight seconds shows the staircase,
 * the at-the-money reset and the hit rule, using numbers nobody made up.
 *
 * THE REPLAY IS NOT COMMITTABLE and says so on screen. A rehearsal that could be
 * mistaken for a position is exactly the confusion CLAUDE.md's dry-run rule exists
 * to prevent.
 */

export interface Flappy {
  /** Normalised gates and flight for the renderer, or null when not in flappy mode. */
  view: Omit<GatesData, "rect"> | null;
  /** The Windows being rehearsed against, oldest first. */
  refs: RefWindow[];
  /** True while the carriage is sweeping. */
  running: boolean;
  /** The painted grid this run produced. */
  cells: PixelCells;
  /** This venue publishes no reference level, so gates cannot be anchored honestly. */
  unsupported: boolean;
  start: () => void;
  tap: (up: boolean) => void;
}

const PAD = 0.12;

export function useFlappy(venue: Venue, active: boolean, legCount: number): Flappy {
  const [refs, setRefs] = useState<RefWindow[]>([]);
  const [, force] = useState(0);
  const runRef = useRef<Run | null>(null);
  const cellsRef = useRef<PixelCells>(new Array(legCount).fill(undefined));

  // The rehearsal needs one more Window than there are Legs: the last gate's verdict
  // lives in the Window that follows it.
  useEffect(() => {
    if (!active) return;
    let stop = false;
    void refSeries(venue, legCount + 2)
      .then((r) => { if (!stop) setRefs(r); })
      .catch(() => { if (!stop) setRefs([]); });
    return () => { stop = true; };
  }, [active, venue, legCount]);

  useEffect(() => { cellsRef.current = new Array(legCount).fill(undefined); }, [legCount, venue]);

  // A run is wall-clock driven, so the component has to tick while one is live.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const run = runRef.current;
      if (!run) return;
      if (Date.now() - run.startedAt > run.legCount * COLUMN_MS) runRef.current = null;
      force((n) => n + 1);
    }, 60);
    return () => clearInterval(t);
  }, [active]);

  const start = useCallback(() => {
    cellsRef.current = new Array(legCount).fill(undefined);
    runRef.current = startRun(legCount, Date.now());
    force((n) => n + 1);
  }, [legCount]);

  const tap = useCallback((up: boolean) => {
    const run = runRef.current;
    if (!run) return;
    run.cells = cellsRef.current;
    if (tapRun(run, Date.now(), up)) force((n) => n + 1);
  }, []);

  const window_ = refs.slice(0, legCount);
  const unsupported = refs.length > 0 && !hasReference(refs);

  let view: Flappy["view"] = null;
  if (active && window_.length && !unsupported) {
    // One shared vertical scale for the staircase and the flight, padded so a gate
    // at the extreme still has a plate to draw.
    const levels = birdPath(refs).map((p) => p.price);
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    const spread = Math.max(hi - lo, 1e-9);
    const v = (price: number) => PAD + ((price - lo) / spread) * (1 - PAD * 2);

    const n = window_.length;
    const verdicts = gradeRun(cellsRef.current, window_);
    const stakes = cellsRef.current.map((c) => Math.abs(c ?? 0));
    const totalStake = stakes.reduce((a, b) => a + b, 0) || 1;

    const gates = window_.map((w, i) => {
      const cell = cellsRef.current[i];
      return {
        u0: i / n,
        u1: (i + 1) / n,
        vRef: v(w.strike),
        dir: cell === undefined || cell === 0 ? null : cell > 0 ? ("UP" as const) : ("DOWN" as const),
        verdict: verdicts[i],
        weight: stakes[i] / totalStake,
      };
    });

    const path = birdPath(refs).map((p, i, arr) => ({ u: i / Math.max(arr.length - 1, 1), v: v(p.price) }));
    const run = runRef.current;
    view = { gates, bird: path, head: run ? runProgress(run, Date.now()) : 1 };
  }

  const active_ = runRef.current;
  const running = !!active_ && columnAt(active_, Date.now()) >= 0;

  return { view, refs: window_, running, cells: cellsRef.current, unsupported, start, tap };
}
