import Link from "next/link";
import { DeviceStage } from "../components/DeviceStage";

/**
 * The presentation layer.
 *
 * The device floats small here and turns freely — it is the product shown as an
 * object, not the product being used. Everything that actually trades lives at
 * /play.
 */
export default function Home() {
  return (
    <main className="home">
      <section className="home-hero">
        <div className="home-copy">
          <h1>KURVV</h1>
          <p className="home-tag">Draw the market. The chain trades it.</p>
          <p className="home-lede">
            One hand-drawn curve becomes an autonomous sequence of real Event Contract
            positions that execute themselves, leg by leg, over the next few hours.
            No keeper. No cron. No backend holding a hot key and hoping it stays up.
          </p>
          <div className="home-cta">
            <Link className="btn btn-primary" href="/play">Open the device</Link>
            <Link className="btn" href="/pitch">Read the pitch</Link>
          </div>
          <p className="home-note">Drag the device to turn it.</p>
        </div>
        <div className="home-device">
          <DeviceStage fill={0.78} freeOrbit idleSpin />
        </div>
      </section>

      <section className="home-grid">
        <article>
          <h3>Draw a view</h3>
          <p>
            Sketch where you think BTC goes. Each segment becomes one Leg; the slope of
            that segment becomes its conviction, and conviction becomes its share of
            the stake.
          </p>
        </article>
        <article>
          <h3>Commit once</h3>
          <p>
            One signature approves <strong>exactly</strong> the total you staked —
            never an unlimited allowance — and opens the first Leg in the same
            transaction, so a Plan can never exist without its first position.
          </p>
        </article>
        <article>
          <h3>The chain runs it</h3>
          <p>
            A Somnia Reactivity subscription opens the next Leg the moment the previous
            one settles. Validators invoke it as a synthetic transaction. Nothing
            off-chain is awake.
          </p>
        </article>
        <article>
          <h3>Paid per Leg</h3>
          <p>
            Settlement is per Window, so proceeds arrive Leg by Leg rather than at the
            end. Cancel any time and whatever has not been deployed comes back.
          </p>
        </article>
      </section>

      <footer className="home-foot">
        <span>Somnia Shannon testnet · settles in tUSDC</span>
        <nav>
          <Link href="/play">Play</Link>
          <Link href="/pitch">Pitch</Link>
          <Link href="/device">Hardware</Link>
        </nav>
      </footer>
    </main>
  );
}
