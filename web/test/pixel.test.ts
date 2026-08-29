import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cellsToPlan, cellAt, emptyCells, hasPositions, PIXEL_ROWS, PIXEL_HEIGHT,
} from "../lib/pixel.ts";

const TOTAL = 2_000_000n; // 2.00 tUSDC at 6dp

test("THE TRAP: stakes sum EXACTLY to the approved total", () => {
  // The contract enforces ApprovalMustBeExact. Independently rounded stakes would
  // not sum to the approval and the commit reverts, so this is the one invariant
  // pixel mode must not break — it is why allocateStakes is reused, not rewritten.
  const grids = [
    [1, 2, 3, -1, -2, -3],
    [3, undefined, 1, 0, -2, 2],
    [1, 1, 1],
    [-3],
    [2, -2, 2, -2, 2, -2, 2, -2],
  ];
  for (const cells of grids) {
    for (const total of [1n, 7n, 999_999n, TOTAL, 10_000_000n]) {
      const { legs } = cellsToPlan(cells, { totalStake: total });
      const sum = legs.reduce((a, l) => a + l.stake, 0n);
      assert.equal(sum, total, `grid ${JSON.stringify(cells)} at ${total}`);
    }
  }
});

test("a skipped Window produces no Leg, and the columns say which is which", () => {
  const { legs, columns } = cellsToPlan([2, undefined, 0, -1, 3], { totalStake: TOTAL });
  assert.equal(legs.length, 3);
  // Columns 1 (unpainted) and 2 (explicit centre) are both skips.
  assert.deepEqual(columns, [0, 3, 4]);
  assert.deepEqual(legs.map((l) => l.direction), ["UP", "DOWN", "UP"]);
});

test("distance from the centre buys SIZE, never a different direction", () => {
  const { legs } = cellsToPlan([1, 3], { totalStake: TOTAL });
  assert.deepEqual(legs.map((l) => l.direction), ["UP", "UP"]);
  // Row 3 is three times the conviction of row 1, so three times the stake.
  assert.ok(legs[1].stake > legs[0].stake * 2n);
});

test("sign alone decides direction — a deep DOWN is still DOWN", () => {
  const { legs } = cellsToPlan([-3, -1], { totalStake: TOTAL });
  assert.deepEqual(legs.map((l) => l.direction), ["DOWN", "DOWN"]);
  assert.ok(legs[0].stake > legs[1].stake);
});

test("an empty grid refuses rather than committing a dead Plan", () => {
  assert.throws(() => cellsToPlan([], { totalStake: TOTAL }));
  assert.throws(() => cellsToPlan([undefined, undefined], { totalStake: TOTAL }));
  assert.throws(() => cellsToPlan([0, 0, 0], { totalStake: TOTAL }));
  assert.equal(hasPositions(emptyCells(6)), false);
  assert.equal(hasPositions([0, undefined, 2]), true);
});

test("minWeightShare keeps a low cell from becoming a zero-stake Leg", () => {
  // 1 against 3 and 3: without a floor the small cell rounds toward nothing at
  // small totals, and the venue rejects a zero-size order.
  const { legs } = cellsToPlan([1, 3, 3], { totalStake: 700n, minWeightShare: 0.05 });
  assert.ok(legs.every((l) => l.stake > 0n));
  assert.equal(legs.reduce((a, l) => a + l.stake, 0n), 700n);
});

test("cellAt quantises the drawable span onto the grid, and clamps its edges", () => {
  const LEGS = 6;
  assert.equal(cellAt(0, 0.5, LEGS).col, 0);
  assert.equal(cellAt(0.999, 0.5, LEGS).col, LEGS - 1);
  // Out-of-range input is clamped, never wrapped: a stray pointer must not paint
  // the opposite end of the Plan.
  assert.equal(cellAt(-0.4, 0.5, LEGS).col, 0);
  assert.equal(cellAt(1.4, 0.5, LEGS).col, LEGS - 1);

  // v is bottom-up: the top band is +PIXEL_ROWS, the bottom is -PIXEL_ROWS.
  assert.equal(cellAt(0.5, 0.999, LEGS).row, PIXEL_ROWS);
  assert.equal(cellAt(0.5, 0, LEGS).row, -PIXEL_ROWS);
  // The exact middle is the skip row.
  assert.equal(cellAt(0.5, 0.5, LEGS).row, 0);
});

test("every band cellAt can return is a valid row", () => {
  for (let i = 0; i < 200; i++) {
    const { row } = cellAt(Math.random(), Math.random(), 8);
    assert.ok(row >= -PIXEL_ROWS && row <= PIXEL_ROWS);
  }
  assert.equal(PIXEL_HEIGHT, PIXEL_ROWS * 2 + 1);
});

test("weights are a distribution: they sum to 1", () => {
  const { legs } = cellsToPlan([3, -1, 2, undefined, -3], { totalStake: TOTAL });
  const sum = legs.reduce((a, l) => a + l.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights summed to ${sum}`);
});
