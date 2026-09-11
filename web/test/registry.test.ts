import { test } from "node:test";
import assert from "node:assert/strict";
import { feeNotice, type VenueFees } from "../lib/registry.ts";

/**
 * `CLAUDE.md` says "All fees are zero" and dreamDEX's own docs say it too —
 * *"dreamDEX sets every fee, maker, taker and settlement, to zero."*
 *
 * That is true today and was re-measured on 10 Sep 2026: both live venues report
 * zero across the board. But the PROTOCOL supports a one-time settlement fee on
 * winning redemptions, the fields are on the venue row, and every payout number
 * KURVV renders is computed as though they are zero. An assumption that is
 * currently true and silently load-bearing is the kind that breaks a demo.
 */

const FREE: VenueFees = {
  makerFeeBps: 0n, takerFeeBps: 0n, settlementFeeBps: 0n,
  maxBuilderFeeBps: 0n, routingFeeBps: 0n,
};

test("the venues we trade are free, and say nothing", () => {
  assert.equal(feeNotice(FREE), null);
});

test("a venue with no registry row claims nothing either way", () => {
  // True of the SOMI creator: a registered series that has never rolled a
  // market, so there is no venue row to read. Silence is the honest answer.
  assert.equal(feeNotice(null), null);
});

test("a settlement fee is surfaced, because it is the one that moves a number already on screen", () => {
  const n = feeNotice({ ...FREE, settlementFeeBps: 25n });
  assert.ok(n, "a non-zero settlement fee must produce a notice");
  assert.match(n, /25 bps/);
  assert.match(n, /below the projection/);
});

test("trading fees are surfaced too, and rank below settlement", () => {
  assert.match(feeNotice({ ...FREE, takerFeeBps: 10n })!, /taker 10/);
  // Settlement wins when both are set: it is the one nothing on screen has
  // measured yet. A taker fee is already inside the fill price KURVV reads back.
  assert.match(feeNotice({ ...FREE, takerFeeBps: 10n, settlementFeeBps: 5n })!, /settlement/);
});

test("maxBuilderFee alone is not a user-facing fee", () => {
  // 0 on testnet, 100000 (a 1% cap) on mainnet. It caps what a builder MAY tag
  // an order with; KURVV places untagged orders, so it costs the user nothing.
  assert.equal(feeNotice({ ...FREE, maxBuilderFeeBps: 100_000n }), null);
});
