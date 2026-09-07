import { DeviceStage } from "../../components/DeviceStage";
import { Deck } from "../../components/Deck";
import { PixelNav } from "../../components/PixelNav";

export const metadata = { title: "KURVV · pitch" };

const SLIDES = [
  {
    kicker: "The problem",
    title: "Prediction markets ask for one click at a time",
    body: [
      "An Event Contract is a single binary question over a single window. Expressing a view that lasts two hours means coming back every fifteen minutes and clicking again.",
      "Nobody does that. So the depth that exists in these markets goes untraded, and a venue with real liquidity sees a fraction of the volume its book could carry.",
    ],
  },
  {
    kicker: "The insight",
    title: "A gesture already contains a schedule",
    body: [
      "When someone sketches where they think a price is going, they have not drawn one prediction. They have drawn a sequence: a direction for each stretch of time, and a strength of belief in each.",
      "That is exactly the shape of a series of Event Contract positions. The information is already in the line — it only has to be read out.",
    ],
  },
  {
    kicker: "How it works",
    title: "One curve, one signature, N real positions",
    body: [
      "Each segment of the drawn curve becomes one Leg. The sign of its change picks UP or DOWN. Its slope, normalised across the whole curve, becomes that Leg's share of the stake — so a flat-then-sharply-up curve produces a different Plan from a steadily-rising one, even though both end higher.",
      "Committing is one transaction: it approves exactly the total staked and opens the first Leg together, so a Plan can never exist without its first position.",
    ],
  },
  {
    kicker: "The technical centrepiece",
    title: "No keeper. The chain runs the schedule.",
    body: [
      "The Plan contract subscribes to the venue's roll event through Somnia's Reactivity precompile. When a window rolls, validators invoke the handler as a synthetic transaction: it redeems the settled Leg and arms the next one.",
      "There is no cron, no bot, no server holding a hot key. The subscription filter is pinned to the venue's own roller and one series id, so it fires exactly once per window — one fire, one Leg boundary.",
    ],
  },
  {
    kicker: "Honest trade-off",
    title: "The Plan custodies the stake, and nothing else",
    body: [
      "A Reactivity handler is on-chain Solidity invoked by validators. It cannot hold a private key, so the positions are owned by the Plan contract rather than the wallet.",
      "What that costs: proceeds are owed to you by a contract. What it buys: no off-chain signer anywhere in the loop. The approval is exact, never unlimited, and cancelling returns whatever has not been deployed — including when the chain has stalled.",
    ],
  },
  {
    kicker: "Why it matters here",
    title: "One gesture, four to eight real positions",
    body: [
      "The measure that matters to the venue is Event Contract volume. A drawn curve over a two-hour horizon decomposes into eight sequential windows on a series that runs back-to-back with no gap.",
      "Every Plan is that multiplier, from a single interaction that takes about three seconds.",
    ],
  },
];

/**
 * The deck.
 *
 * One slide per screen, stepped a whole slide at a time by wheel, arrow keys or a
 * swipe. Each slide has its own finished scene behind it — see `lib/deck/scenes.ts`
 * — rather than a shared world that builds as you travel, because a deck is a
 * sequence of places and not a journey through one.
 *
 * `SLIDES` is untouched. This is a presentation of the same words.
 */
export default function Pitch() {
  return (
    <>
      <Deck>
        <section className="deck-slide deck-first">
          <div className="lp-copy">
            <p className="pitch-kicker">Pitch</p>
            <h1 className="deck-mark">KURVV</h1>
            <p className="pitch-tag">Draw the market. The chain trades it.</p>
            <p className="deck-cue">Scroll, or use the arrow keys</p>
          </div>
          <div className="deck-device">
            <DeviceStage fill={0.82} freeOrbit idleSpin inert />
          </div>
        </section>

        {SLIDES.map((s, i) => (
          <section className="deck-slide" key={s.title}>
            <div className="lp-copy">
              <p className="pitch-kicker">
                <span className="deck-n">{String(i + 1).padStart(2, "0")}</span>
                {s.kicker}
              </p>
              <h2>{s.title}</h2>
              {s.body.map((b, j) => <p key={j}>{b}</p>)}
              {i === SLIDES.length - 1 ? (
                <dl className="deck-specs">
                  <div><dt>Chain</dt><dd>Somnia Shannon · 50312</dd></div>
                  <div><dt>Collateral</dt><dd>tUSDC · 6 decimals</dd></div>
                  <div><dt>Trigger</dt><dd>Series roll, one subscription per Plan</dd></div>
                  <div><dt>Commit</dt><dd>EIP-7702 batch · approve + open Leg 0</dd></div>
                  <div><dt>Payout</dt><dd>Per Leg, as each Window settles</dd></div>
                  <div><dt>Custody</dt><dd>Exact-amount approval, cancellable</dd></div>
                </dl>
              ) : null}
            </div>
          </section>
        ))}
      </Deck>
      <PixelNav />
    </>
  );
}
