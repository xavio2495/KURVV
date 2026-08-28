import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketize, priceExtent } from "../lib/three/buckets.ts";

test("a bucket's close is the LAST fill in it, not an average", () => {
  const b = bucketize([
    { t: 100, price: 10 }, { t: 105, price: 30 }, { t: 110, price: 20 },
  ], 60, 0);
  assert.equal(b.length, 1);
  assert.equal(b[0].close, 20);
  assert.equal(b[0].lo, 10);
  assert.equal(b[0].hi, 30);
});

test("buckets align to the interval and come back in time order", () => {
  const b = bucketize([
    { t: 190, price: 3 }, { t: 10, price: 1 }, { t: 70, price: 2 },
  ], 60, 0);
  assert.deepEqual(b.map((x) => x.t), [0, 60, 180]);
  assert.deepEqual(b.map((x) => x.close), [1, 2, 3]);
});

test("an empty bucket stays empty — nothing is interpolated across a gap", () => {
  // A 3-minute hole between two fills must NOT produce filler buckets, or the
  // chart would draw a price the market never printed.
  const b = bucketize([{ t: 0, price: 1 }, { t: 240, price: 2 }], 60, 0);
  assert.equal(b.length, 2);
  assert.deepEqual(b.map((x) => x.t), [0, 240]);
});

test("points before `since` are dropped", () => {
  const b = bucketize([{ t: 10, price: 1 }, { t: 500, price: 2 }], 60, 300);
  assert.equal(b.length, 1);
  assert.equal(b[0].close, 2);
});

test("extent spans every lane and leaves headroom for a drawn Curve", () => {
  const e = priceExtent([[{ t: 0, close: 100, lo: 90, hi: 100 }], [{ t: 0, close: 120, lo: 120, hi: 130 }]]);
  assert.ok(e.lo < 90, "low must sit below the traded low");
  assert.ok(e.hi > 130, "high must sit above the traded high");
});

test("a flat market still gets a non-zero band", () => {
  const e = priceExtent([[{ t: 0, close: 50, lo: 50, hi: 50 }]]);
  assert.ok(e.hi > e.lo, "a zero-width extent would divide by zero in priceToY");
});

test("no lanes at all degrades rather than returning NaN", () => {
  const e = priceExtent([[], []]);
  assert.ok(Number.isFinite(e.lo) && Number.isFinite(e.hi));
});
