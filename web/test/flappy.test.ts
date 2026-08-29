import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeColumn, gradeRun, birdPath, visualHit, hasReference,
  startRun, columnAt, runProgress, tap, COLUMN_MS, type RefWindow,
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

test("the bird is pinned to the chain's own integers", () => {
  const refs = [w(0, 100), w(1, 101.5), w(0, 0)];   // strike 0 = venue publishes none
  assert.deepEqual(birdPath(refs), [{ t: 0, price: 100 }, { t: 0, price: 101.5 }]);
  assert.equal(hasReference(refs), true);
  assert.equal(hasReference([w(0, 0), w(1, 0)]), false, "the rolling venue has no reference");
});

test("the carriage advances one column per beat and then ends the run", () => {
  const run = startRun(6, 1000);
  assert.equal(columnAt(run, 1000), 0);
  assert.equal(columnAt(run, 1000 + COLUMN_MS * 2.5), 2);
  assert.equal(columnAt(run, 1000 + COLUMN_MS * 5.9), 5);
  assert.equal(columnAt(run, 1000 + COLUMN_MS * 6), -1, "run is over");
  assert.equal(columnAt(run, 999), -1, "before it started");
  assert.equal(runProgress(run, 1000 + COLUMN_MS * 3), 0.5);
  assert.equal(runProgress(run, 1000 + COLUMN_MS * 99), 1);
});

test("tapping the same side stacks, the other side flips and resets", () => {
  const run = startRun(4, 0);
  const t = COLUMN_MS * 0.5;
  assert.equal(tap(run, t, true), true);
  assert.equal(run.cells[0], 1);
  tap(run, t, true);
  assert.equal(run.cells[0], 2, "same side stacks");
  tap(run, t, false);
  assert.equal(run.cells[0], -1, "the other side flips and resets to one");
});

test("conviction caps at the grid's height", () => {
  const run = startRun(2, 0);
  for (let i = 0; i < 20; i++) tap(run, 10, true);
  assert.equal(run.cells[0], PIXEL_ROWS);
});

test("a tap outside the run is refused, and cannot fix a passed column", () => {
  const run = startRun(3, 0);
  tap(run, COLUMN_MS * 0.5, true);          // column 0
  assert.equal(tap(run, COLUMN_MS * 3.5, true), false, "after the run");
  assert.equal(run.cells[0], 1, "column 0 is untouched once the carriage has passed");
});

test("a finished run feeds the SAME payload builder as the grid", () => {
  // Flappy authors a Plan; it does not author a new kind of Plan. The exact-sum
  // invariant ApprovalMustBeExact depends on has to survive this path too.
  const run = startRun(6, 0);
  tap(run, COLUMN_MS * 0.5, true);
  tap(run, COLUMN_MS * 1.5, false);
  tap(run, COLUMN_MS * 1.5, false);
  tap(run, COLUMN_MS * 4.5, true);
  const total = 2_000_000n;
  const { legs, columns } = cellsToPlan(run.cells, { totalStake: total, minWeightShare: 0.05 });
  assert.deepEqual(columns, [0, 1, 4]);
  assert.deepEqual(legs.map((l) => l.direction), ["UP", "DOWN", "UP"]);
  assert.equal(legs.reduce((a, l) => a + l.stake, 0n), total);
});
