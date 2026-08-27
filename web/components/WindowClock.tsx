"use client";
import { mmss, type WindowClock as Clock } from "../lib/useWindowClock";
import type { Venue } from "../lib/venues";

/**
 * One Window, drawn as the chain experiences it.
 *
 * The bar is a single Window of this venue. The playhead sweeps it, the marker at
 * `openDelay` is where the handler's one-shot opens the next Leg, and the right edge
 * is the roll — the instant that settles the running Leg and arms the next one. Two
 * boundaries, one bar, and the pace of the whole chain becomes readable.
 */
export function WindowClock({ venue, clock }: { venue: Venue; clock: Clock }) {
  const openPct = (venue.openDelay / clock.intervalSec) * 100;
  const playPct = clock.progress * 100;
  const past = playPct >= openPct;

  return (
    <div className="wclock">
      <div className="wclock-head">
        <span className="wclock-title">WINDOW CLOCK</span>
        <span className="mono dim">{venue.asset} · {clock.intervalSec}s · series {venue.seriesId}</span>
        <span className="grow" />
        <span className="mono dim">anchor: {clock.source}</span>
      </div>

      <div className="wclock-bar">
        <div className="wclock-fill" style={{ width: `${playPct}%` }} />
        <div className={`wclock-mark ${past ? "done" : ""}`} style={{ left: `${openPct}%` }} />
        <div className="wclock-play" style={{ left: `${playPct}%` }} />
        <span className="wclock-lab open" style={{ left: `${openPct}%` }}>
          +{venue.openDelay}s · Leg opens
        </span>
        <span className="wclock-lab end">roll · settle + arm</span>
      </div>

      <div className="wclock-foot">
        <span className="mono">next roll <b>{mmss(clock.toRoll)}</b></span>
        <span className="mono">next Leg opens <b className="acc">{mmss(clock.toOpen)}</b></span>
        <span className="grow" />
        <span className="dim" style={{ fontSize: 11 }}>
          Both boundaries are on-chain events. Neither is a timer in this browser.
        </span>
      </div>
    </div>
  );
}
