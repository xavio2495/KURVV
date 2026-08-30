import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeColumn, gradeRun, visualHit, hasReference,
  startRun, columnAt, worldAt, roundAt, roundCells, viewSpan, targetAt, tap, COLUMN_MS, type RefWindow,
} from "../lib/flappy.ts";
import { cellsToPlan, PIXEL_ROWS } from "../lib/pixel.ts";

const w = (o: 0 | 1 | null, strike = 100, voided = false): RefWindow =>
  ({ tradingStart: 0, expiry: 60, strike, outcome: voided ? null : o, voided });

test("the verdict comes from the chain, never from the geometry", () => {
  // UP cell + UP outcome (0) wins; UP cell + DOWN outcome loses.
  assert.equal(gradeColumn(2, w(0)), "won");
  assert.equal(gradeColumn(2, w(1)), "lost");
  assert.equal(gradeColumn(-3, w(1)), "won");
  assert.equal(gradeColumn(-3, w(0)), "lost");
});

test("a tie in the reference must NOT decide a column", () => {
  // The measured failure mode: strike unchanged between Windows. The visual hit
  // reads as UP because >= is true, but the chain settled DOWN. If gradeColumn
  // consulted geometry this would report a win on a losing Leg.
  const cur = w(1, 100);              // chain says DOWN
  const next = w(null, 100);          // reference unchanged — a tie
  assert.equal(visualHit(2, cur, next), true, "the picture shows a hit");
  assert.equal(gradeColumn(2, cur), "lost", "the chain says it lost");
});

test("unresolved, voided and skipped columns are each their own state", () => {
  assert.equal(gradeColumn(1, w(null)), "pending");
  assert.equal(gradeColumn(1, w(null, 100, true)), "void");
  assert.equal(gradeColumn(undefined, w(0)), "skipped");
  assert.equal(gradeColumn(0, w(0)), "skipped");
  // A Window that does not exist yet is pending, not lost.
  assert.equal(gradeColumn(1, undefined), "pending");
});

test("gradeRun lines verdicts up with columns, including the gaps", () => {
  const refs = [w(0), w(1), w(0), w(null)];
  assert.deepEqual(gradeRun([1, undefined, -2, 3], refs), ["won", "skipped", "lost", "pending"]);
});

test("a venue with no reference level is refused rather than guessed at", () => {
  const refs = [w(0, 100), w(1, 101.5), w(0, 0)];   // strike 0 = venue publishes none
  assert.equal(hasReference(refs), true, "one real strike is enough to anchor gates");
  assert.equal(hasReference([w(0, 0), w(1, 0)]), false, "the rolling venue has no reference");
});

test("THE FLIGHT DOES NOT END, and a round is a slice of it", () => {
  // Continuous play: there is no finish line, so no column index may ever come back
  // as "over". A bounded columnAt is what made the old mode need a start button.
  const run = startRun(6, 1000);
  assert.equal(columnAt(run, 1000), 0);
  assert.equal(columnAt(run, 1000 + COLUMN_MS * 2.5), 2);
  assert.equal(columnAt(run, 1000 + COLUMN_MS * 6), 6, "column 6 exists; the run is not over");
  assert.equal(columnAt(run, 1000 + COLUMN_MS * 41.5), 41);
  // Before the anchor is clamped, never negative: a negative column would index the
  // world behind the start and grade against a Window that is not there.
  assert.equal(columnAt(run, 0), 0);
  assert.equal(worldAt(run, 1000 + COLUMN_MS * 2.5), 2.5, "the camera gets the fraction");
});

test("rounds roll over on their own, and each one is legCount wide", () => {
  const run = startRun(4, 0);
  assert.deepEqual(roundAt(run, COLUMN_MS * 0), { index: 0, from: 0, to: 4 });
  assert.deepEqual(roundAt(run, COLUMN_MS * 3.9), { index: 0, from: 0, to: 4 });
  // The boundary is where the next round BEGINS. Nothing has to be pressed.
  assert.deepEqual(roundAt(run, COLUMN_MS * 4), { index: 1, from: 4, to: 8 });
  assert.deepEqual(roundAt(run, COLUMN_MS * 9.5), { index: 2, from: 8, to: 12 });
});

test("A CALL LANDS AHEAD OF THE BIRD, and the past is untouchable", () => {
  // The bird is pinned at the left of the frame, so the column under it is already
  // half gone. Calling it put the pipe beneath the bird and scrolled it away before
  // the player could see whether they had made it. Calls go to the NEXT column.
  const run = startRun(4, 0);
  assert.equal(targetAt(run, COLUMN_MS * 0.5), 1);
  assert.equal(targetAt(run, COLUMN_MS * 3.9), 4);

  tap(run, COLUMN_MS * 0.5, true);
  assert.equal(run.painted.get(1), 1);
  assert.equal(run.painted.get(0), undefined, "never the column already under the bird");
  // Later taps go to later columns; there is no reaching back.
  tap(run, COLUMN_MS * 3.5, true);
  assert.equal(run.painted.get(1), 1, "column 1 is untouched once the bird has passed");
  assert.equal(run.painted.get(4), 1);
  // Before the anchor there is nothing to call.
  assert.equal(tap(run, -1, true), false);
});

test("a call in the last column of a round belongs to the NEXT round", () => {
  // The lookahead crosses round boundaries, so the committable slice cannot be
  // derived by indexing off the CURRENT column — it has to be read from the world.
  const run = startRun(3, 0);
  tap(run, COLUMN_MS * 2.5, true);          // bird over column 2, calls column 3
  assert.deepEqual(roundCells(run, 0), [undefined, undefined, undefined]);
  assert.deepEqual(roundCells(run, 3), [1, undefined, undefined]);
});

test("a round's calls survive the roll, and slice out in commit order", () => {
  const run = startRun(3, 0);
  tap(run, COLUMN_MS * 0.5, true);      // -> column 1, round 0
  tap(run, COLUMN_MS * 1.5, false);     // -> column 2, round 0
  tap(run, COLUMN_MS * 4.5, true);      // -> column 5, round 1
  assert.deepEqual(roundCells(run, 0), [undefined, 1, -1]);
  // The finished round is still there. Blanking it at the boundary would erase the
  // gates the player can still see scrolling away behind the bird.
  assert.deepEqual(roundCells(run, 3), [undefined, undefined, 1]);
});

test("the frame shows about 30% more Windows than a round has", () => {
  // The point of the zoom-out: what is coming has to be on screen before it has to
  // be called. Equal to legCount means calling a Window the instant it appears.
  for (const legs of [4, 6, 8]) assert.ok(viewSpan(legs) > legs, `span for ${legs}`);
  assert.equal(viewSpan(6), 8);
  assert.equal(viewSpan(8), 10);
  // Never so narrow that a two-Leg Plan leaves nothing to look at.
  assert.ok(viewSpan(2) >= 4);
});

test("tapping the same side stacks, the other side flips and resets", () => {
  const run = startRun(4, 0);
  const t = COLUMN_MS * 0.5;
  assert.equal(tap(run, t, true), true);
  assert.equal(run.painted.get(1), 1);
  tap(run, t, true);
  assert.equal(run.painted.get(1), 2, "same side stacks");
  tap(run, t, false);
  assert.equal(run.painted.get(1), -1, "the other side flips and resets to one");
});

test("conviction caps at the grid's height", () => {
  const run = startRun(2, 0);
  for (let i = 0; i < 40; i++) tap(run, 10, true);
  assert.equal(run.painted.get(1), PIXEL_ROWS);
});

test("a round feeds the SAME payload builder as the grid", () => {
  // Flappy authors a Plan; it does not author a new kind of Plan. The exact-sum
  // invariant ApprovalMustBeExact depends on has to survive this path too.
  const run = startRun(6, 0);
  tap(run, COLUMN_MS * 0.5, true);      // -> column 1
  tap(run, COLUMN_MS * 1.5, false);     // -> column 2
  tap(run, COLUMN_MS * 1.5, false);     // -> column 2 again, stacking
  tap(run, COLUMN_MS * 4.5, true);      // -> column 5
  const total = 2_000_000n;
  const { legs, columns } = cellsToPlan(roundCells(run, 0), { totalStake: total, minWeightShare: 0.05 });
  assert.deepEqual(columns, [1, 2, 5]);
  assert.deepEqual(legs.map((l) => l.direction), ["UP", "DOWN", "UP"]);
  assert.equal(legs.reduce((a, l) => a + l.stake, 0n), total);
});
