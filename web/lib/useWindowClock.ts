"use client";
import { useEffect, useRef, useState } from "react";
import { pub } from "./chain";
import { lastRoll } from "./autonomy";
import { liveMarket } from "./commit";
import type { Venue } from "./venues";

export interface WindowClock {
  /** Unix seconds at which the current Window opened. */
  rollAt: number;
  /** Unix seconds at which it rolls again — the next settlement + open boundary. */
  nextRollAt: number;
  /** Unix seconds at which the handler's one-shot opens the next Leg. */
  nextOpenAt: number;
  intervalSec: number;
  /** Where the anchor came from, so the UI never overstates its own precision. */
  source: "roll event" | "indexer" | "extrapolated" | "none";
  /** 0..1 through the current Window. */
  progress: number;
  /** Seconds remaining, floored at 0. */
  toRoll: number;
  toOpen: number;
}

interface Anchor { at: number; source: WindowClock["source"] }

/**
 * The venue's Window clock, anchored on chain.
 *
 * Primary anchor is the roll event itself — literally the log the Plan's Reactivity
 * subscription is filtered on, so the bar and the chain are reading the same thing.
 * One log page is 100 seconds, which always contains a roll on the 60s venue and
 * usually does not on the 15-minute one; the indexer's `tradingStart` seeds that
 * case and the clock extrapolates between anchors.
 *
 * Roll drift is real (898s windows have been observed), so the anchor is refreshed
 * rather than counted from a fixed origin.
 */
export function useWindowClock(venue: Venue): WindowClock {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [, force] = useState(0);
  const venueRef = useRef(venue);
  venueRef.current = venue;

  useEffect(() => { setAnchor(null); }, [venue.key]);

  // Seed from the indexer once, then keep it fresh at a low rate. `tradingStart` is
  // exact; the indexer's few-second lag only delays the seed, never skews it.
  useEffect(() => {
    let stop = false;
    const seed = async () => {
      try {
        const m = await liveMarket(venue, 1);
        if (!stop && m) setAnchor((a) => (a && a.at >= m.tradingStart ? a : { at: m.tradingStart, source: "indexer" }));
      } catch { /* the roll-event path below is the primary anchor anyway */ }
    };
    void seed();
    const t = setInterval(seed, 20_000);
    return () => { stop = true; clearInterval(t); };
  }, [venue]);

  // Primary: the roll log, within the RPC's 1000-block (100 second) reach.
  useEffect(() => {
    let stop = false;
    const scan = async () => {
      try {
        const head = await pub.getBlockNumber();
        const r = await lastRoll(venue.marketCreator, venue.rollTopic, venue.seriesId, head);
        // Wins ties against the indexer seed: same instant, more direct provenance.
        if (!stop && r) setAnchor((a) => (a && a.at > r.timestamp ? a : { at: r.timestamp, source: "roll event" }));
      } catch { /* keep the last good anchor on screen */ }
    };
    void scan();
    const t = setInterval(scan, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [venue]);

  // Tick the derived values without touching the chain.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);

  const now = Date.now() / 1000;
  const iv = venue.intervalSec;
  if (!anchor) {
    return { rollAt: now, nextRollAt: now + iv, nextOpenAt: now + venue.openDelay, intervalSec: iv,
      source: "none", progress: 0, toRoll: iv, toOpen: venue.openDelay };
  }
  const k = Math.max(0, Math.floor((now - anchor.at) / iv));
  const rollAt = anchor.at + k * iv;
  const nextRollAt = rollAt + iv;
  const openThis = rollAt + venue.openDelay;
  const nextOpenAt = now < openThis ? openThis : nextRollAt + venue.openDelay;
  return {
    rollAt, nextRollAt, nextOpenAt, intervalSec: iv,
    source: k > 0 ? "extrapolated" : anchor.source,
    progress: Math.min(1, Math.max(0, (now - rollAt) / iv)),
    toRoll: Math.max(0, nextRollAt - now),
    toOpen: Math.max(0, nextOpenAt - now),
  };
}

/** `00:14` — the countdown format the panel and the clock share. */
export const mmss = (sec: number) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
