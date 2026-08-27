"use client";
import { useMemo } from "react";
import type { Address, Hex } from "viem";
import type { Fire } from "../lib/autonomy";
import type { FireFeed } from "../lib/useFires";
import { mmss, type WindowClock as Clock } from "../lib/useWindowClock";
import { EXPLORER } from "../lib/venues";

interface Props {
  planBook: Address | undefined;
  signer: Address | undefined;
  commitTx: Hex | null;
  feed: FireFeed;
  clock: Clock;
  planId: number | null;
}

const gas = (v: bigint) => Number(v).toLocaleString("en-US");
const clock12 = (ts: number) => (ts ? new Date(ts * 1000).toLocaleTimeString("en-GB", { hour12: false }) : "—");
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

const KIND_LABEL: Record<Fire["kind"], string> = {
  roll: "ROLL FIRE",
  open: "OPEN FIRE",
  commit: "YOU SIGNED THIS",
  cancel: "YOU SIGNED THIS",
  manual: "YOU SIGNED THIS",
};

/**
 * PROOF OF AUTONOMY.
 *
 * The product's central claim is that nobody sends the Legs — validators do. That is
 * invisible unless the evidence is on screen, so this panel puts the raw `from`
 * field of every handler invocation in front of the viewer at full width.
 *
 * `from == to == the PlanBook contract` is a shape no private key can produce: a
 * contract has no key to sign with, and the transaction was assembled by validators
 * when the subscription filter matched. The human's single commit sits in the same
 * list, in the opposite colour, with `from` = a wallet — and the contrast between
 * the one and the many is the entire story.
 */
export function AutonomyPanel({ planBook, signer, commitTx, feed, clock, planId }: Props) {
  const rows = useMemo(() => [...feed.fires].reverse(), [feed.fires]);

  const validatorCount = feed.fires.filter((f) => f.synthetic).length;
  const humanFire = feed.fires.find((f) => !f.synthetic);
  const humanCount = (humanFire ? 1 : 0) || (commitTx ? 1 : 0);
  const gasSpent = feed.fires.reduce((a, f) => (f.synthetic ? a + f.gasUsed : a), 0n);

  // The handler publishes the exact millisecond its one-shot fires. Prefer it over
  // the extrapolated Window clock whenever it is still in the future.
  const now = Date.now();
  const scheduled = feed.scheduledOpenMs !== null && feed.scheduledOpenMs > now
    ? (feed.scheduledOpenMs - now) / 1000
    : null;
  const toOpen = scheduled ?? clock.toOpen;
  const openSource = scheduled !== null ? "from the handler's own OpenScheduled log" : "from the Window clock";

  return (
    <section className="auto">
      <div className="auto-head">
        <h3>PROOF OF AUTONOMY</h3>
        <span className="dim" style={{ fontSize: 12 }}>
          Every row below is a real transaction on Somnia Shannon. Check the <code>from</code>.
        </span>
        <span className="grow" />
        {feed.scanning && <span className="pill">scanning…</span>}
      </div>

      <div className="auto-top">
        <div className="tally">
          <div className="tally-cell human">
            <div className="tally-n">{humanCount}</div>
            <div className="tally-l">human signature{humanCount === 1 ? "" : "s"}</div>
          </div>
          <div className="tally-x">→</div>
          <div className="tally-cell val">
            <div className="tally-n">{validatorCount}</div>
            <div className="tally-l">validator invocations</div>
          </div>
        </div>

        <div className="cdown">
          <div className="cdown-l">NEXT LEG OPENS IN</div>
          <div className="cdown-n">{planId === null ? "--:--" : mmss(toOpen)}</div>
          <div className="cdown-s dim">{planId === null ? "commit a Plan to start the chain" : openSource}</div>
        </div>
      </div>

      <div className="auto-key">
        <span className="swatch val" /> <code>from == to == the PlanBook contract</code> — a contract holds no
        private key, so no wallet could have produced this. Validators assembled it when the
        subscription filter matched. &nbsp;
        <span className="swatch human" /> <code>from</code> = a wallet — the one transaction a person signed.
      </div>

      {feed.error && <div className="err">log scan failed — {feed.error}</div>}

      {planId === null && <div className="dim" style={{ fontSize: 12 }}>No Plan running.</div>}

      {planId !== null && !rows.length && !feed.error && (
        <div className="dim" style={{ fontSize: 12 }}>
          Waiting for the first roll on this series. The first fire lands at the next Window boundary.
        </div>
      )}

      <div className="fires">
        {rows.map((f) => (
          <article key={f.hash} className={`fire ${f.synthetic ? "val" : "human"}`}>
            <div className="fire-top">
              <span className={`badge ${f.synthetic ? "val" : "human"}`}>{KIND_LABEL[f.kind]}</span>
              <span className="mono dim">{clock12(f.timestamp)}</span>
              <span className="grow" />
              <span className="mono dim">block {String(f.blockNumber)}</span>
            </div>

            {/* THE PROOF. Full address, biggest type in the row, never truncated. */}
            <div className="fire-from">
              <span className="k">from</span>
              <span className="v mono">{f.from}</span>
            </div>
            <div className="fire-to mono dim">
              to&nbsp;&nbsp;{f.to ?? "—"}
              {f.synthetic && planBook && f.to?.toLowerCase() === planBook.toLowerCase()
                ? "  ← same address. The contract sent this to itself; no key was involved."
                : "  ← a wallet signed this one."}
            </div>

            <div className={`fire-sum ${f.synthetic ? "" : "human"}`}>{f.summary}</div>

            <div className="fire-foot mono dim">
              <a href={`${EXPLORER}/tx/${f.hash}`} target="_blank" rel="noreferrer">{short(f.hash)}</a>
              <span>gas used {gas(f.gasUsed)}{f.synthetic ? ` / ${gas(f.gasLimit)} budget` : ""}</span>
            </div>
          </article>
        ))}

        {/* The commit is known from the session before any log page covers it. */}
        {!humanFire && commitTx && (
          <article className="fire human">
            <div className="fire-top">
              <span className="badge human">YOU SIGNED THIS</span>
              <span className="grow" />
              <span className="mono dim">one signature, once</span>
            </div>
            <div className="fire-from">
              <span className="k">from</span>
              <span className="v mono">{signer ?? "your wallet"}</span>
            </div>
            <div className="fire-to mono dim">approve exact + commitPlan, batched into one transaction</div>
            <div className="fire-sum human">Plan committed</div>
            <div className="fire-foot mono dim">
              <a href={`${EXPLORER}/tx/${commitTx}`} target="_blank" rel="noreferrer">{short(commitTx)}</a>
            </div>
          </article>
        )}
      </div>

      {validatorCount > 0 && (
        <div className="auto-foot dim">
          {validatorCount} validator-assembled transaction{validatorCount === 1 ? "" : "s"} so far, burning{" "}
          {gas(gasSpent)} gas from the contract&apos;s own balance. No keeper, no cron, no server holding a key.
        </div>
      )}
    </section>
  );
}
