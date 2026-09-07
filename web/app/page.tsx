import Link from "next/link";
import { Morph } from "../components/landing/Morph";
import { ModePlay } from "../components/landing/ModePlay";
import { StageLazy } from "../components/landing/StageLazy";
import { HScroll } from "../components/HScroll";
import { AT } from "../lib/landing/evolution";

/**
 * The landing page is a horizontal platformer.
 *
 * You scroll down; the world moves left. Six full-viewport panels ride a track that
 * is translated on X by the single scroll scalar in `lib/landing/evolution.ts`, and
 * the world behind them is one continuous side-scrolling strip that changes material
 * as you travel: night, industry, winter, summer, neon, and finally all four at once
 * under the device.
 *
 * The canvas is decoration. Every word here is real DOM above it, and the panels are
 * ordinary flow content — so the page reads correctly as text no matter where the
 * world has got to.
 */

/** Where each headline's font morph begins and ends, relative to its panel. */
const morph = (at: number) => ({ from: at - 0.15, to: at - 0.03 });

const FOOT = (
  <footer className="lp-foot">
    <span>Somnia Shannon testnet · settles in tUSDC</span>
  </footer>
);

export default function Home() {
  return (
    <HScroll panels={6} className="lp" chrome={FOOT}>
      <header className="hs-panel lp-hero" id="top">
        <h1 className="lp-wordmark">KURVV</h1>
        <p className="lp-tag">Draw the market. The chain trades it.</p>
        <p className="lp-scrollcue">Scroll</p>
      </header>

      <section className="hs-panel" id="about">
        <div className="lp-copy">
          <span className="lp-num">01 · Industry</span>
          <Morph as="h2" className="lp-h" {...morph(AT.about)}>
            One gesture. Real positions.
          </Morph>
          <p className="lp-lede">
            You draw where you think the market goes. KURVV reads a direction from
            each segment of that line and a conviction from its slope, then commits
            the whole schedule on-chain in a single transaction.
          </p>
          <p className="lp-lede">
            From there nothing off-chain is awake. A Somnia Reactivity subscription
            opens the next position the moment the previous one settles — validators
            invoke it as a synthetic transaction. No keeper, no cron, no backend
            holding a hot key and hoping it stays up.
          </p>
          <dl className="lp-facts">
            <div><dt>Positions per gesture</dt><dd>4–8</dd></div>
            <div><dt>Signatures required</dt><dd>One</dd></div>
            <div><dt>Approval</dt><dd>Exactly your stake</dd></div>
            <div><dt>Settles in</dt><dd>tUSDC</dd></div>
          </dl>
        </div>
      </section>

      <section className="hs-panel lp-mode" id="draw">
        <div className="lp-copy">
          <span className="lp-num">02 · Winter</span>
          <Morph as="h2" className="lp-h" {...morph(AT.draw)}>
            Sketch the curve.
          </Morph>
          <p className="lp-lede">
            Drag a line across the chart. Each segment becomes one Leg on its own
            expiry Window, and the steepness of that segment becomes its share of the
            stake — so a flat-then-sharp curve stakes differently from a steady
            climb, even when both end in the same place.
          </p>
        </div>
        <ModePlay mode="draw" label="Draw mode · running" />
      </section>

      <section className="hs-panel lp-mode lp-flip" id="pixel">
        <div className="lp-copy">
          <span className="lp-num">03 · Summer</span>
          <Morph as="h2" className="lp-h" {...morph(AT.pixel)}>
            Place the bets.
          </Morph>
          <p className="lp-lede">
            Same engine, coarser input. Tap cells on a grid of time against price and
            each filled cell becomes a Leg. It is the fastest way to express a view
            that is not a smooth line — a gap, a spike, a range you expect to hold.
          </p>
        </div>
        <ModePlay mode="pixel" label="Grid mode · running" />
      </section>

      <section className="hs-panel lp-mode" id="flappy">
        <div className="lp-copy">
          <span className="lp-num">04 · Neon</span>
          <Morph as="h2" className="lp-h" {...morph(AT.flappy)}>
            Call it, gate by gate.
          </Morph>
          <p className="lp-lede">
            Up or down, one Window at a time, at the speed the market actually moves.
            Once a gate is called it locks — you cannot watch the price turn and
            change your answer — and the line behind the bird is the real print, not
            a simulation.
          </p>
        </div>
        <ModePlay mode="flappy" label="Flappy mode · running" />
      </section>

      <section className="hs-panel lp-last" id="play">
        <StageLazy />
        <div className="lp-outro lp-copy">
          <Morph as="h2" className="lp-h lp-h-big" {...morph(AT.play)}>
            Try it out
          </Morph>
          <p className="lp-lede">
            Live on Somnia Shannon testnet. Sign in with an email, take test tUSDC
            from the faucet, and draw. The positions are real Event Contracts.
          </p>
          <div className="lp-cta">
            <Link className="lp-btn lp-btn-go" href="/play">Play now</Link>
            <Link className="lp-btn" href="/how-it-works">How it works</Link>
            <Link className="lp-btn" href="/board">Leaderboard</Link>
          </div>
        </div>
      </section>
    </HScroll>
  );
}
