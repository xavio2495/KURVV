import { INDEXER, type Venue } from "./venues.ts";
import { resolveVenueId } from "./registry.ts";
import { type PixelCells } from "./pixel.ts";

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
  const venueId = await resolveVenueId(v);
  const q = `{ Market(where:{venueId:{_eq:"${venueId}"}, asset:{_eq:"${v.asset}"},
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
 * One column of the world.
 *
 * Positions are in WORLD units — one unit is one Window — and the reference level is
 * the venue's own number, not a normalised height. Both are deliberate: the flight
 * is endless, so there is no run to normalise against, and the camera that decides
 * what is on screen belongs to the renderer, which runs at frame rate and can smooth
 * it. A hook that normalised first would have to re-derive the camera at 16Hz and
 * the two would visibly disagree.
 *
 * A gate is a HALF-PLANE. It starts at its Window's reference level and runs to the
 * edge of the frame, because the venue sells exactly one question per Window — "at
 * or above this line?" — and a bounded pipe with a GAP would be a price band the
 * chain cannot settle. So a column carries one pipe from one edge, its mouth on the
 * reference line, and never a facing pair.
 */
export interface GateView {
  /** World column index. Column `n` spans `[n, n+1)`. */
  col: number;
  /** The Window's reference level, in the venue's own units. */
  ref: number;
  /** `null` for a Window the player did not call — drawn as an empty slot. */
  dir: "UP" | "DOWN" | null;
  verdict: Verdict;
  /** Share of the round's stake, 0..1. Drives the pipe's width, never its height. */
  weight: number;
}

/** Everything the scene needs to draw the flight. */
export interface FlappyView {
  /** Only the columns near the camera. The world is longer than the frame. */
  gates: GateView[];
  /**
   * Wall-clock ms at which the bird was over world column 0.
   *
   * The TIME, not the position. The hook ticks at 16Hz, which is plenty for choosing
   * which columns exist but visibly judders a scrolling world; handing over the
   * anchor lets the renderer run the camera at frame rate off its own clock.
   */
  startedAt: number;
  /** How many Windows fit across the frame. */
  span: number;
  /** The columns of the round being flown, `[from, to)` — what would commit. */
  round: { from: number; to: number };
}

/**
 * Where the bird sits across the frame, as a fraction of the width.
 *
 * The bird is PINNED here and the world scrolls past it. Letting the bird cross the
 * frame instead means the run has a start and an end, which is the thing continuous
 * play removes — and it wastes the right-hand 90% of the screen on Windows already
 * decided rather than on the ones about to be called.
 */
export const BIRD_U = 0.1;

/**
 * How many Windows fit across the frame.
 *
 * A round is `legCount` Windows and used to fill the frame exactly, which left the
 * player calling a Window at the instant it arrived with nothing visible ahead of
 * it. About 30% wider, so what is coming is on screen before it has to be called.
 */
export function viewSpan(legCount: number): number {
  return Math.max(4, Math.round(legCount * 1.3));
}

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
 * Was the bird on the gate's side at the close? Presentation only — see `gradeColumn`.
 * Exposed so the renderer can place the impact, never to decide who won.
 */
export function visualHit(cell: number | undefined, w: RefWindow, next: RefWindow | undefined): boolean {
  if (cell === undefined || cell === 0 || !next || !next.strike || !w.strike) return false;
  return cell > 0 ? next.strike >= w.strike : next.strike < w.strike;
}

// ── the flight ─────────────────────────────────────────────────────────────

/** How long the bird spends over each column. One Window, one second. */
export const COLUMN_MS = 1000;

/**
 * THE FLIGHT IS ENDLESS, AND A ROUND IS A SLICE OF IT.
 *
 * There is no start button and no finish line. The world scrolls, a new Window
 * passes under the bird every `COLUMN_MS`, and every `legCount` of them is one
 * ROUND — the slice that becomes a Plan. When a round's last column goes by, the
 * next round is already running; nothing has to be pressed to begin it.
 *
 * Calls are held in ONE map keyed by absolute world column, not in a per-round
 * array. Rounds then need no bookkeeping at all — a round is a range, and the
 * columns of a finished round keep their calls, so a decided Window stays decided as
 * it scrolls away behind the bird instead of blanking at the round boundary.
 */
export interface Run {
  /** Wall-clock ms at which the bird was over world column 0. */
  startedAt: number;
  legCount: number;
  /** World column to signed conviction. Written by `tap`, never cleared. */
  painted: Map<number, number>;
}

export function startRun(legCount: number, now: number): Run {
  return { startedAt: now, legCount, painted: new Map() };
}

/** Which world column the bird is over. Grows without bound. */
export function columnAt(run: Run, now: number): number {
  return Math.floor(worldAt(run, now));
}

/** The bird's world position, in fractional columns — what the camera follows. */
export function worldAt(run: Run, now: number): number {
  return headAt(run.startedAt, now);
}

/** The same mapping from the anchor alone, for the renderer's own clock. */
export function headAt(startedAt: number, now: number): number {
  return Math.max(0, (now - startedAt) / COLUMN_MS);
}

/** Which round the bird is in, and the columns it covers. */
export function roundAt(run: Run, now: number): { index: number; from: number; to: number } {
  const index = Math.floor(columnAt(run, now) / run.legCount);
  return { index, from: index * run.legCount, to: (index + 1) * run.legCount };
}

/** One round's calls, in the shape `cellsToPlan` takes. */
export function roundCells(run: Run, from: number): PixelCells {
  const out: PixelCells = new Array(run.legCount).fill(undefined);
  for (let i = 0; i < run.legCount; i++) out[i] = run.painted.get(from + i);
  return out;
}

/**
 * The column a call lands on: the NEXT one, not the one underneath.
 *
 * This is the difference between a game and a light show. The bird is pinned at the
 * left of the frame, so the column it is currently over is half behind it and gone
 * within the second — calling that one meant the pipe appeared underneath the bird
 * and scrolled away before the player could see whether they had made it. Calling
 * the next one puts the pipe AHEAD, in clear air, and the bird then flies into the
 * gate it just chose. Which is flappy bird.
 */
export function targetAt(run: Run, now: number): number {
  return columnAt(run, now) + 1;
}

/**
 * A call on the Window the bird is about to reach.
 *
 * Calling the same side again stacks conviction; calling the other side flips the
 * column and resets it to one. You cannot go back and fix a column once the bird has
 * passed it — a tap only ever writes forward — and that single constraint is the
 * whole difference from pixel mode, which is a considered painting where this is a
 * rhythm you either nail or fly again.
 */
export function tap(run: Run, now: number, up: boolean): boolean {
  if (now < run.startedAt) return false;

  /**
   * A CALLED WINDOW IS LOCKED. The next tap moves to the next uncalled one.
   *
   * It used to overwrite whatever was in the target column, which made the game
   * winnable without predicting anything: call UP, watch the price for a second, and
   * flip to DOWN before the Window closed. The player was not forecasting, they were
   * reacting — and the whole product rests on the gesture being a forecast.
   *
   * Advancing rather than refusing keeps the input feeling alive: a tap always does
   * something, it just does it to the next Window along.
   *
   * THE COST, and it is real: conviction can no longer be built by tapping the same
   * side twice, so every flappy Leg carries an equal share of the stake. Draw and
   * grid still vary it. Restoring it here means allowing a repeat on the SAME side
   * while forbidding a flip, which is a different rule from the one asked for.
   */
  const first = targetAt(run, now);
  // Bounded by the TARGET's round, not the bird's. When the bird is over the last
  // column of a round, `targetAt` is already the first column of the next one — so
  // using the bird's round ended the search before it began and the call was
  // silently dropped at every round boundary.
  const end = (Math.floor(first / run.legCount) + 1) * run.legCount;
  for (let c = first; c < end; c++) {
    if (run.painted.get(c) !== undefined) continue;
    run.painted.set(c, up ? 1 : -1);
    return true;
  }
  return false;
}
