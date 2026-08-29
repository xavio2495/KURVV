import { INDEXER, type Venue } from "./venues.ts";
import { PIXEL_ROWS, type PixelCells } from "./pixel.ts";

/**
 * FLAPPY MODE — the data model.
 *
 * The bird is the market price moving left to right through time. The player places
 * gates in future Windows, and WINS by hitting one. That inversion only works
 * because of what a gate is.
 *
 * A gate is a HALF-PLANE, not a pipe with a gap.
 *
 * Each Window asks exactly one question: is the close at or above `strike`? There is
 * one market per Window and `outcomeSlotCount` is never above 2, so a bounded gate
 * with a gap — the classic picture — would be a price band, needing three outcomes
 * or a strike ladder. Neither exists here. So the gate covers everything on one side
 * of the reference line and extends to the frame edge:
 *
 *     UP leg    the plate occupies [strike, +infinity)   "at or above"
 *     DOWN leg  the plate occupies (-infinity, strike)
 *
 * The line splits the frame into exactly two unbounded halves: one is your gate, the
 * other is void. There is no third region, which is precisely why there is no third
 * outcome. The game's rule and the venue's rule are the same sentence.
 *
 * Because `strike` is re-fixed every Window, the gates form a STAIRCASE anchored
 * wherever the market was when each Window opened. That is the at-the-money reset —
 * the actual mechanic of this product — drawn rather than described.
 */

/** One settled or in-flight Window, as the game needs it. */
export interface RefWindow {
  tradingStart: number;
  expiry: number;
  /** The reference level in collateral units. 0 when the venue publishes none. */
  strike: number;
  /** 0 = UP, 1 = DOWN. `null` while unresolved, and always null when voided. */
  outcome: 0 | 1 | null;
  voided: boolean;
}

/** `strike` is stored at 1e2 — two decimal places, not the collateral's six. */
const STRIKE_SCALE = 100;

/**
 * The last `limit` Windows of a venue's series, oldest first.
 *
 * This is the whole practice replay: a complete, real, on-chain record of what the
 * price did and what each Window paid. No wallet, no transaction, no chain write.
 */
export async function refSeries(v: Venue, limit = 24): Promise<RefWindow[]> {
  const q = `{ Market(where:{venueId:{_eq:"${v.venueId}"}, asset:{_eq:"${v.asset}"},
      intervalSec:{_eq:"${v.intervalSec}"}, marketType:{_eq:"BINARY"}},
      order_by:{expiry:desc}, limit:${Math.max(1, Math.min(limit, 200))}){
      tradingStart expiry strike winningOutcome voided } }`;
  const r = await fetch(INDEXER, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const d = await r.json() as {
    data?: { Market: { tradingStart: string; expiry: string; strike: string; winningOutcome: number | null; voided: boolean }[] };
  };
  const rows = d.data?.Market ?? [];
  return rows
    .map((m): RefWindow => ({
      tradingStart: Number(m.tradingStart),
      expiry: Number(m.expiry),
      strike: Number(m.strike) / STRIKE_SCALE,
      outcome: m.voided ? null : (m.winningOutcome as 0 | 1 | null),
      voided: !!m.voided,
    }))
    .reverse();
}

/**
 * Does this venue publish a reference level?
 *
 * The rolling venue's question is "closes at or above its opening price" and its
 * `strike` is 0, so a gate there would have to be drawn at a guessed height — which
 * is exactly the lie this mode must not tell. Flappy is fast-venue only.
 */
export function hasReference(refs: RefWindow[]): boolean {
  return refs.some((w) => w.strike > 0);
}

export type Verdict = "won" | "lost" | "void" | "pending" | "skipped";

/**
 * THE VERDICT COMES FROM THE CHAIN, NOT FROM THE GEOMETRY.
 *
 * It is tempting to grade a column by asking whether the next Window's reference is
 * higher — the two agree almost always, and it would need no settlement data at all.
 * Measured over 760 Windows the identity
 *
 *     outcome(n) == UP  <=>  strike(n+1) >= strike(n)
 *
 * is EXACT on BTC 60s/300s and ETH 300s, and holds 395/400 on ETH 60s. Every one of
 * the five misses is a TIE — `strike` unchanged, which happens in about 2% of
 * Windows and splits 3 UP / 5 DOWN. `strike` carries two decimals, so a sub-cent
 * move rounds to a tie and the sign is simply not recoverable. Voided runs freeze
 * the reference too, making ties trivially true.
 *
 * So the identity is good enough to ANIMATE with and not good enough to SETTLE with.
 * A 2% chance of showing a hit on a Leg that lost is a lie in one demo out of ten.
 */
export function gradeColumn(cell: number | undefined, w: RefWindow | undefined): Verdict {
  if (cell === undefined || cell === 0) return "skipped";
  if (!w) return "pending";
  if (w.voided) return "void";
  if (w.outcome === null) return "pending";
  const wantUp = cell > 0;
  return (w.outcome === 0) === wantUp ? "won" : "lost";
}

export function gradeRun(cells: PixelCells, refs: RefWindow[]): Verdict[] {
  return cells.map((c, i) => gradeColumn(c, refs[i]));
}

/**
 * Where the bird is at each Window boundary.
 *
 * The reference for Window n+1 IS the price at the instant Window n closed, so a run
 * of Windows is already a price series — one nailed to the same integers settlement
 * used. Spot fills can fill in between for smoothness, but the pins come from here,
 * because a few basis points of drift is enough to animate a photo finish backwards.
 */
export function birdPath(refs: RefWindow[]): { t: number; price: number }[] {
  return refs.filter((w) => w.strike > 0).map((w) => ({ t: w.tradingStart, price: w.strike }));
}

/**
 * Was the bird on the gate's side at the close? Presentation only — see `gradeColumn`.
 * Exposed so the renderer can place the impact, never to decide who won.
 */
export function visualHit(cell: number | undefined, w: RefWindow, next: RefWindow | undefined): boolean {
  if (cell === undefined || cell === 0 || !next || !next.strike || !w.strike) return false;
  return cell > 0 ? next.strike >= w.strike : next.strike < w.strike;
}

// ── the run ────────────────────────────────────────────────────────────────

/** How long the carriage spends in each column. Eight Legs is eight seconds. */
export const COLUMN_MS = 1000;

export interface Run {
  /** Wall-clock ms at which the carriage entered column 0. */
  startedAt: number;
  cells: PixelCells;
  legCount: number;
}

export function startRun(legCount: number, now: number): Run {
  return { startedAt: now, cells: new Array(legCount).fill(undefined), legCount };
}

/** Which column the carriage is in, or -1 once the run is over. */
export function columnAt(run: Run, now: number): number {
  const i = Math.floor((now - run.startedAt) / COLUMN_MS);
  return i >= 0 && i < run.legCount ? i : -1;
}

/** 0..1 across the whole run, for drawing the carriage between columns. */
export function runProgress(run: Run, now: number): number {
  return Math.min(1, Math.max(0, (now - run.startedAt) / (run.legCount * COLUMN_MS)));
}

/**
 * A tap while the carriage is in a column.
 *
 * Tapping the same side again stacks conviction; tapping the other side flips the
 * column and resets it to one. You cannot go back and fix a column once the carriage
 * has passed — that single constraint is the whole difference from pixel mode, which
 * is a considered painting where this is a rhythm you either nail or re-run.
 */
export function tap(run: Run, now: number, up: boolean): boolean {
  const c = columnAt(run, now);
  if (c < 0) return false;
  const cur = run.cells[c];
  const sameSide = cur !== undefined && cur !== 0 && (cur > 0) === up;
  const magnitude = sameSide ? Math.min(PIXEL_ROWS, Math.abs(cur!) + 1) : 1;
  run.cells[c] = up ? magnitude : -magnitude;
  return true;
}
