import { test } from "node:test";
import assert from "node:assert/strict";
import {
  curveToPlan, allocateStakes, sampleAtWindowBoundaries, monotoneInterpolator,
  type CurvePoint,
} from "../lib/curve.ts";

/** Canvas space: y grows DOWNWARD, so a rising price is a falling y. */
const rising = (n = 40): CurvePoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: 100 - i * 2 }));

const flatThenUp = (n = 40): CurvePoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i < n / 2 ? 100 : 100 - (i - n / 2) * 4 }));

test("THE THESIS: flat-then-up produces a different Plan from steadily-rising", () => {
  const opts = { legCount: 4, totalStake: 1_000_000n };
  const steady = curveToPlan(rising(), opts);
  const kinked = curveToPlan(flatThenUp(), opts);

  // Both end higher, so both are all-UP...
  assert.deepEqual(steady.map((l) => l.direction), ["UP", "UP", "UP", "UP"]);
  assert.deepEqual(kinked.map((l) => l.direction), ["UP", "UP", "UP", "UP"]);

  // ...but the SHAPE must move the money. If these match, the mapping is wrong and
  // the product has no thesis.
  assert.notDeepEqual(steady.map((l) => l.stake), kinked.map((l) => l.stake));

  // Steadily-rising is near-uniform; flat-then-up is back-loaded.
  const spread = (ls: typeof steady) =>
    Number(ls.reduce((m, l) => (l.stake > m ? l.stake : m), 0n)) /
    Number(ls.reduce((m, l) => (l.stake < m ? l.stake : m), ls[0].stake));
  assert.ok(spread(steady) < 1.2, `steady should be near-uniform, got ${spread(steady)}`);
  assert.ok(spread(kinked) > 2, `kinked should be strongly back-loaded, got ${spread(kinked)}`);
  assert.ok(kinked[3].stake > kinked[0].stake, "the sharp leg must take more size");
});

test("direction follows the sign of each segment", () => {
  // Down, then up (canvas y: up then down).
  const v: CurvePoint[] = Array.from({ length: 41 }, (_, i) => ({
    x: i, y: i <= 20 ? 100 + i * 2 : 100 + 40 - (i - 20) * 2,
  }));
  const legs = curveToPlan(v, { legCount: 2, totalStake: 1_000_000n });
  assert.deepEqual(legs.map((l) => l.direction), ["DOWN", "UP"]);
});

/**
 * A strong move, then a near-flat drift, then another strong move. This is the shape
 * that makes an UNLIMITED Hermite ring: the tangent at the drift's endpoints is ~50x
 * the drift's own slope, so the curve bulges far outside the data and the drift reads
 * as a reversal. It is also a shape users draw constantly ("rips, pauses, rips").
 *
 * The mutation test for this is deliberate: deleting the Fritsch-Carlson limiter from
 * lib/curve.ts MUST make this test fail. An earlier, weaker version of this test did
 * not — it passed with the limiter removed, which made it worthless.
 */
const ripPauseRip = (): CurvePoint[] => {
  const prices = [0, 10, 10.1, 20];
  const xs = [0, 10, 20, 30];
  return prices.map((p, i) => ({ x: xs[i], y: -p })); // canvas y grows downward
};

test("NO INVENTED REVERSALS: a near-flat drift between strong moves never flips", () => {
  for (const legCount of [3, 4, 5, 6, 8, 12, 16, 24]) {
    const legs = curveToPlan(ripPauseRip(), { legCount, totalStake: 1_000_000n });
    assert.ok(
      legs.every((l) => l.direction === "UP"),
      `legCount=${legCount} fabricated a reversal: ${legs.map((l) => l.direction).join(",")}`,
    );
  }
});

test("NO INVENTED REVERSALS: the interpolant stays inside the data's bounds", () => {
  const pts = ripPauseRip();
  const f = monotoneInterpolator(pts.map((p) => p.x), pts.map((p) => p.y));
  const lo = Math.min(...pts.map((p) => p.y));
  const hi = Math.max(...pts.map((p) => p.y));
  for (let x = 0; x <= 30; x += 0.05) {
    const v = f(x);
    assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `overshoot at x=${x}: ${v} outside [${lo}, ${hi}]`);
  }
});

test("NO INVENTED REVERSALS: samples are non-decreasing for non-decreasing input", () => {
  const s = sampleAtWindowBoundaries(ripPauseRip(), 24);
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i] >= s[i - 1] - 1e-9, `sample ${i} dipped: ${s[i - 1]} -> ${s[i]}`);
  }
});

test("a step-like rise also never fabricates a reversal", () => {
  const step: CurvePoint[] = [];
  for (let i = 0; i <= 60; i++) step.push({ x: i, y: i < 20 ? 100 : i < 40 ? 60 : 58 });
  for (const legCount of [3, 4, 5, 6, 8, 12, 16]) {
    const legs = curveToPlan(step, { legCount, totalStake: 1_000_000n });
    assert.ok(legs.every((l) => l.direction === "UP"), `legCount=${legCount} flipped`);
  }
});

test("monotone interpolator stays within the data's bounds", () => {
  const xs = [0, 1, 2, 3, 4];
  const ys = [0, 0, 0, 10, 10];
  const f = monotoneInterpolator(xs, ys);
  for (let x = 0; x <= 4; x += 0.05) {
    const v = f(x);
    assert.ok(v >= -1e-9 && v <= 10 + 1e-9, `overshoot at x=${x}: ${v}`);
  }
});

test("THE TRAP: stakes sum EXACTLY to the approved total", () => {
  // The contract reverts ApprovalMustBeExact, so this must hold for awkward
  // totals and leg counts that do not divide evenly.
  for (const total of [1_000_000n, 999_999n, 1n, 7n, 2_400_001n, 33_333_333n]) {
    for (const legCount of [1, 2, 3, 4, 5, 6, 7, 8, 11]) {
      const legs = curveToPlan(flatThenUp(60), { legCount, totalStake: total, minWeightShare: 0.05 });
      const sum = legs.reduce((a, l) => a + l.stake, 0n);
      assert.equal(sum, total, `legCount=${legCount} total=${total} summed to ${sum}`);
      assert.equal(legs.length, legCount);
    }
  }
});

test("allocateStakes is deterministic and exact under adversarial weights", () => {
  const w = [1 / 3, 1 / 3, 1 / 3];
  const a = allocateStakes(w, 100n);
  const b = allocateStakes(w, 100n);
  assert.deepEqual(a, b, "same input must give the same Plan");
  assert.equal(a.reduce((x, y) => x + y, 0n), 100n);
  // All-zero weights must not produce a dead Plan.
  const z = allocateStakes([0, 0, 0], 10n);
  assert.equal(z.reduce((x, y) => x + y, 0n), 10n);
});

test("minWeightShare keeps a flat stretch from becoming a zero-stake Leg", () => {
  const legs = curveToPlan(flatThenUp(60), { legCount: 4, totalStake: 1_000_000n, minWeightShare: 0.05 });
  assert.ok(legs.every((l) => l.stake > 0n), "no Leg may be dead");
  assert.ok(legs.every((l) => l.weight >= 0.05 - 1e-9));
});

test("a flat Curve is UP — the venue resolves ties at-or-above", () => {
  const flat: CurvePoint[] = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 50 }));
  const legs = curveToPlan(flat, { legCount: 3, totalStake: 900n });
  assert.ok(legs.every((l) => l.direction === "UP"));
  assert.equal(legs.reduce((a, l) => a + l.stake, 0n), 900n);
});

test("freehand input: unsorted and duplicated x are tolerated", () => {
  const messy: CurvePoint[] = [
    { x: 5, y: 40 }, { x: 0, y: 100 }, { x: 5, y: 42 }, { x: 10, y: 20 }, { x: 2, y: 80 },
  ];
  const legs = curveToPlan(messy, { legCount: 3, totalStake: 300n });
  assert.equal(legs.length, 3);
  assert.equal(legs.reduce((a, l) => a + l.stake, 0n), 300n);
});
