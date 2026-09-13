"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BIRD_U, gradeColumn, hasReference, refSeries, roundAt, roundCells,
  startRun, tap as tapRun, viewSpan, worldAt,
  type FlappyView, type GateView, type RefWindow, type Run,
} from "./flappy";
import type { Venue } from "./venues";
import { hasPositions, type PixelCells } from "./pixel";

/**
 * FLAPPY MODE — the endless rehearsal.
 *
 * The price only moves at real time, so a live game is a minute per Leg and an hour
 * is not a game. The answer is that the whole thing can be REHEARSED against real
 * history: a long tail of finished Windows carries its own reference levels and its
 * own settled outcomes, so flying through them is a complete, honest run with no
 * wallet, no transaction and nothing written to the chain.
 *
 * It is also the fastest way to teach the product. A few seconds shows the
 * staircase, the at-the-money reset and the hit rule, using numbers nobody made up.
 *
 * NOTHING STARTS IT AND NOTHING ENDS IT. The flight begins as soon as there are
 * Windows to fly through and rolls from one round into the next by itself. Rounds
 * exist only because a Plan has a fixed number of Legs; they are a slice of a
 * continuous flight, not a game that has to be re-launched.
 *
 * THE REPLAY IS NOT COMMITTABLE and says so on screen. A rehearsal that could be
 * mistaken for a real position is exactly the confusion the dry-run gate exists to
 * prevent: nothing here touches a wallet, signs, or reaches the Plan contract.
 */

export interface Flappy {
  /** The world near the camera, or null when not in flappy mode. */
  view: FlappyView | null;
  /** True once there is a flight to fly. */
  running: boolean;
  /** The round's calls, in commit order. Mutated in place; identity changes per round. */
  cells: PixelCells;
  /** Bumps on every call and every round boundary, so a preview can follow along. */
  revision: number;
  /** This venue publishes no reference level, so gates cannot be anchored honestly. */
  unsupported: boolean;
  /**
   * How the round is doing. `resolved` excludes Windows that voided or have not
   * settled, so the fraction never flatters itself by counting a no-contest as a miss.
   */
  score: { hit: number; resolved: number; placed: number };
  /** Start a fresh flight now. Nothing needs to call it; the DRAW key may. */
  start: () => void;
  tap: (up: boolean) => void;
}

/**
 * How many Windows the flight has to fly through before it runs out of world.
 *
 * At one Window a second this is about a minute of continuous play, which is longer
 * than any demo take. Running out re-fetches and starts a fresh flight — a visible
 * cut, but one that happens off-camera rather than mid-sentence.
 */
const WORLD = 60;

/**
 * Windows of world kept BEHIND world column 0.
 *
 * The bird sits at `BIRD_U` across the frame, so the columns to its left are already
 * on screen at the instant the flight starts. Without this lead-in the first second
 * of every flight shows a blank strip where the recent past should be.
 */
const leadFor = (span: number) => Math.ceil(BIRD_U * span) + 1;

export function useFlappy(venue: Venue, active: boolean, legCount: number): Flappy {
  const [refs, setRefs] = useState<RefWindow[]>([]);
  /**
   * Two counters, deliberately.
   *
   * `tick` re-renders so the view follows the world; `revision` changes only when
   * the CALLS did. A consumer rebuilding its Plan preview keys off the second — with
   * one counter for both it would rebuild sixteen times a second forever.
   */
  const [, tick] = useState(0);
  const [revision, bump] = useState(0);
  const runRef = useRef<Run | null>(null);
  /** The live round's calls. A stable array so a consumer's deps do not thrash. */
  const cellsRef = useRef<PixelCells>(new Array(legCount).fill(undefined));
  /** The last round that had any calls in it, so a fresh round has something to commit. */
  const lastRef = useRef<PixelCells | null>(null);
  const roundRef = useRef(0);
  /** So a refetch can tell a venue change from a leg-count change. */
  const lastVenue = useRef(venue.key);

  const span = viewSpan(legCount);
  const lead = leadFor(span);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    // Drop the previous VENUE's Windows before the new ones arrive: keeping them for
    // the round trip means `hasReference` stays true across the change, so switching
    // to a venue that publishes no strike draws a confident at-the-money staircase
    // for it — the one claim this mode must never make.
    //
    // Only on a venue change. A leg-count change re-fetches too (the span moves),
    // but the reference levels it already holds are still that venue's own, so
    // blanking them just empties the screen for a round trip — and if the refetch
    // then fails, `unsupported` stays false on an empty list and the mode renders
    // blank with nothing said.
    if (lastVenue.current !== venue.key) { lastVenue.current = venue.key; setRefs([]); }
    void refSeries(venue, WORLD)
      .then((r) => { if (!stop) setRefs(r); })
      .catch(() => { if (!stop) setRefs([]); });
    return () => { stop = true; };
  }, [active, venue, legCount]);

  // Reshaping the round has to retire the flight that was writing to it. Otherwise
  // the calls vanish while the world keeps scrolling, and `run.legCount` outlives the
  // array it indexes — which would let a round author a Plan with more Legs than the
  // device is set to.
  useEffect(() => {
    cellsRef.current = new Array(legCount).fill(undefined);
    lastRef.current = null;
    runRef.current = null;
    roundRef.current = 0;
  }, [legCount, venue]);

  /**
   * The flight's own clock.
   *
   * It does three things and only three: start a flight when there is world to fly
   * through, roll the round over when the bird leaves it, and re-fetch when the
   * world runs out. Everything else is derived on read.
   */
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (!refs.length || !hasReference(refs)) return;
      const now = Date.now();
      let run = runRef.current;
      if (!run) {
        run = startRun(legCount, now);
        runRef.current = run;
        roundRef.current = 0;
        cellsRef.current = new Array(legCount).fill(undefined);
      }
      const head = worldAt(run, now);
      // Out of world: the right-hand edge has reached the newest Window we hold.
      if (lead + head + (1 - BIRD_U) * span >= refs.length) {
        runRef.current = startRun(legCount, now);
        roundRef.current = 0;
        lastRef.current = hasPositions(cellsRef.current) ? cellsRef.current : lastRef.current;
        cellsRef.current = new Array(legCount).fill(undefined);
        bump((n) => n + 1);
        return;
      }
      const r = roundAt(run, now);
      if (r.index !== roundRef.current) {
        // The round the bird just left keeps its calls in the world map, so nothing
        // is lost on screen; only the committable slice is handed over and reset.
        roundRef.current = r.index;
        if (hasPositions(cellsRef.current)) lastRef.current = cellsRef.current;
        cellsRef.current = roundCells(run, r.from);
        bump((n) => n + 1);
        return;
      }
      tick((n) => n + 1);
    }, 60);
    return () => clearInterval(t);
  }, [active, refs, legCount, span, lead]);

  const start = useCallback(() => {
    runRef.current = startRun(legCount, Date.now());
    roundRef.current = 0;
    cellsRef.current = new Array(legCount).fill(undefined);
    bump((n) => n + 1);
  }, [legCount]);

  const tap = useCallback((up: boolean) => {
    const run = runRef.current;
    if (!run) return;
    const now = Date.now();
    if (!tapRun(run, now, up)) return;
    // Re-read the whole live round out of the world map rather than writing one
    // index. A call targets the NEXT column, which near a boundary belongs to the
    // next round, and any arithmetic that assumed otherwise would put the call in
    // the wrong slice. Copying `legCount` entries costs nothing and cannot be wrong.
    const from = roundRef.current * run.legCount;
    for (let i = 0; i < run.legCount; i++) cellsRef.current[i] = run.painted.get(from + i);
    bump((n) => n + 1);
  }, []);

  const unsupported = refs.length > 0 && !hasReference(refs);
  const run = runRef.current;
  const ready = active && !!run && refs.length > 0 && !unsupported;

  let view: FlappyView | null = null;
  if (ready && run) {
    const now = Date.now();
    const head = worldAt(run, now);
    const r = roundAt(run, now);
    // Only the columns near the camera, plus a margin: the renderer runs its camera
    // off its own clock and is a frame or two ahead of this slice.
    const from = Math.max(0, Math.floor(head - BIRD_U * span) - 2);
    const to = Math.min(refs.length - lead, Math.ceil(head + (1 - BIRD_U) * span) + 2);

    // Conviction is a share of the ROUND, so a pipe's width means the same thing
    // whichever round it belongs to.
    const weightIn = (round: number) => {
      let total = 0;
      for (let c = round; c < round + legCount; c++) total += Math.abs(run.painted.get(c) ?? 0);
      return total || 1;
    };

    const gates: GateView[] = [];
    for (let c = from; c < to; c++) {
      const w = refs[lead + c];
      if (!w) continue;
      const cell = run.painted.get(c);
      const roundFrom = Math.floor(c / legCount) * legCount;
      gates.push({
        col: c,
        ref: w.strike,
        dir: cell === undefined || cell === 0 ? null : cell > 0 ? "UP" : "DOWN",
        verdict: gradeColumn(cell, w),
        weight: Math.abs(cell ?? 0) / weightIn(roundFrom),
      });
    }
    view = { gates, startedAt: run.startedAt, span, round: { from: r.from, to: r.to } };
  }

  // The round on screen, graded against the Windows it was actually called on.
  const verdicts = ready && run
    ? cellsRef.current.map((c, i) => gradeColumn(c, refs[lead + roundRef.current * legCount + i]))
    : [];
  const score = {
    hit: verdicts.filter((v) => v === "won").length,
    resolved: verdicts.filter((v) => v === "won" || v === "lost").length,
    placed: verdicts.filter((v) => v !== "skipped").length,
  };

  // A round that has just rolled over is empty, and committing nothing is not what
  // the player meant by pressing the key. The last round that had calls in it stands
  // in until this one does.
  const cells = hasPositions(cellsRef.current) ? cellsRef.current : (lastRef.current ?? cellsRef.current);

  return { view, running: ready, cells, revision, unsupported, score, start, tap };
}
