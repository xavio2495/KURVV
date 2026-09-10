import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtUnits, fmtUsdc } from "../lib/units.ts";

/**
 * These encode the mistake that was live: every amount in the frontend was
 * formatted as `Number(v) / 1e6`.
 *
 * Six decimals is a property of a VENUE, not of the network. Two of the three
 * binary venues on Shannon settle in 6dp tUSDC and the third settles in an
 * 18-decimal token; mainnet USDso is 18 as well. The old expression does not
 * revert on any of them — it just prints a number 10^12 too large, which is the
 * failure mode that reaches the user instead of the logs.
 */

test("6dp is unchanged — the venues we actually trade still read the same", () => {
  assert.equal(fmtUnits(1_000_000n, 6, 2), "1.00");
  assert.equal(fmtUnits(2_400_001n, 6, 4), "2.4000");
  assert.equal(fmtUsdc(500_000n, 2), "0.50");
});

test("18dp is not off by 10^12", () => {
  // One whole unit on an 18-decimal venue. `Number(v) / 1e6` called this
  // 1,000,000,000,000.00 — the bug, stated as a number.
  assert.equal(fmtUnits(10n ** 18n, 18, 2), "1.00");
  assert.equal(fmtUnits(10n ** 18n, 6, 2), "1000000000000.00");
});

test("the scale is a parameter, and the default is only a fallback", () => {
  const v = 10n ** 18n;
  assert.equal(fmtUsdc(v, 2), fmtUnits(v, 6, 2));      // default 6dp
  assert.equal(fmtUsdc(v, 2, 18), "1.00");             // told the truth, tells the truth
});

test("a real 18dp trade reads correctly", () => {
  // Measured on venue 0x9f06b6a2…: cumulativeBaseVolume 100 * 10^18 and
  // lastPrice 0.45 * 10^18. Read as 6dp these are 100 trillion contracts at a
  // price of 450 billion — a probability, which cannot exceed 1.
  assert.equal(fmtUnits(100_000000000000000000n, 18, 2), "100.00");
  assert.equal(fmtUnits(450000000000000000n, 18, 3), "0.450");
});

test("precision survives past 2^53, where Number(bigint) does not", () => {
  // 9,007,199,254.740993 in 6dp — one base unit above 2^53, so the float path
  // loses the last digit before it ever divides.
  const v = 9_007_199_254_740_993n;
  assert.equal(fmtUnits(v, 6, 6), "9007199254.740993");
  assert.notEqual(fmtUnits(v, 6, 6), (Number(v) / 1e6).toFixed(6));
});
