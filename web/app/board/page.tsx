"use client";
import Link from "next/link";
import { useBoard } from "../../lib/useBoard";
import { HScroll } from "../../components/HScroll";

/**
 * The standings, as a page rather than a panel.
 *
 * Same `useBoard` sweep the device's board channel uses — read straight from the
 * PlanBook, no account system and no off-chain index. With no wallet connected there
 * is simply no row to mark as yours; the page needs no wallet to be correct.
 */
export default function Board() {
  const board = useBoard();

  return (
    <HScroll panels={2} offset={4} className="doc-h">
      <section className="hs-panel">
        <div className="lp-copy board-copy">
          <span className="lp-num">Leaderboard</span>
          <div className="board">
            <div className="board-row board-head">
              <span>#</span><span>Player</span><span>Plans</span><span>Hit</span><span>Return</span>
            </div>
            {board.rows.map((r) => (
              <div className="board-row" key={`${r.rank}-${r.who}`}>
                <span className="board-rank">{r.rank}</span>
                <span>{r.who}</span>
                <span>{r.plans}</span>
                <span>{r.hit}</span>
                <span>{r.ret}</span>
              </div>
            ))}
          </div>
          <p className="guide-foot">
            {board.sample
              ? "Showing placeholder standings — the live sweep has not returned yet."
              : "Live from Somnia Shannon testnet, refreshed every 25 seconds."}
          </p>
        </div>
      </section>

      <section className="hs-panel">
        <div className="lp-copy">
          <span className="lp-num">How the standings are built</span>
          <h2 className="lp-h">Read from the chain, not from us.</h2>
          <p className="lp-lede">
            Assembled from the PlanBook itself — every committed Plan and how each of its
            Legs settled. There is no account system and no off-chain index to trust.
          </p>
          <p className="lp-lede">
            Names are derived from the wallet address rather than stored, so nothing here
            is personal data we hold. <strong>Hit</strong> is the share of settled Legs
            that won; <strong>Return</strong> is payout against stake across every Leg,
            so a Plan that cancelled early counts only what it actually deployed.
          </p>
          <div className="lp-cta">
            <Link className="lp-btn lp-btn-go" href="/play">Take a turn</Link>
          </div>
        </div>
      </section>
    </HScroll>
  );
}
