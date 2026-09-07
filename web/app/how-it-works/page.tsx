import Link from "next/link";
import { GUIDES } from "../../lib/guide";
import { HScroll } from "../../components/HScroll";

/**
 * The three modes, explained in the same words the device uses.
 *
 * `GUIDES` is the single source: the on-device help screen and this page render the
 * same steps, so a rule cannot be corrected in one place and left stale in the other.
 */
export const metadata = {
  title: "How KURVV works",
  description: "Draw, grid or flappy — three gestures, one on-chain payload.",
};

const ORDER = ["draw", "pixel", "flappy"] as const;

export default function HowItWorks() {
  return (
    <HScroll panels={ORDER.length + 2} offset={1} className="doc-h">
      <header className="hs-panel">
        <div className="lp-copy">
          <span className="lp-num">How it works</span>
          <h1 className="lp-h">Three modes, one payload.</h1>
          <p className="lp-lede">
            Whatever you draw, tap or paint becomes the same thing on-chain: a direction
            and a stake for each expiry Window. Committing it takes one signature, and
            the chain runs the rest without you.
          </p>
          <div className="lp-cta">
            <Link className="lp-btn lp-btn-go" href="/play">Open the device</Link>
          </div>
        </div>
      </header>

      {ORDER.map((k) => {
        const g = GUIDES[k];
        return (
          <section className="hs-panel" key={k}>
            <div className="lp-copy guide">
              <h2>{g.title}</h2>
              <p className="guide-sub">{g.subtitle}</p>
              <ol className="guide-steps">
                {g.steps.map(([head2, body2]) => (
                  <li key={head2}>
                    <b>{head2}</b>
                    <span>{body2}</span>
                  </li>
                ))}
              </ol>
              <p className="guide-foot">{g.footer}</p>
            </div>
          </section>
        );
      })}

      <section className="hs-panel">
        <div className="lp-copy guide">
          <h2>THE CHAIN</h2>
          <p className="guide-sub">What happens after you commit</p>
          <ol className="guide-steps">
            <li><b>One approval, exactly your stake</b><span>Never an unlimited allowance. The Plan can only ever move the total you committed.</span></li>
            <li><b>The first position opens in the same transaction</b><span>So a Plan can never exist without its first Leg.</span></li>
            <li><b>Each Window rolls the next Leg</b><span>A Somnia Reactivity subscription fires when the previous Window settles. Validators invoke it. Nothing off-chain is awake.</span></li>
            <li><b>Paid per Leg</b><span>Proceeds arrive as each Window settles, not at the end. Cancel any time and unspent stake comes back.</span></li>
          </ol>
          <p className="guide-foot">Somnia Shannon testnet. Positions settle in tUSDC.</p>
        </div>
      </section>
    </HScroll>
  );
}
