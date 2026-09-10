import { test } from "node:test";
import assert from "node:assert/strict";
import { ADDRESSES, CHAIN, addressDrift } from "../lib/dreamdex/config.ts";
import { ADDR, CHAIN_ID } from "../lib/venues.ts";

/**
 * The migration's safety net.
 *
 * KURVV pinned three protocol addresses by hand before the SDK existed. Two of
 * them are in the SDK's own CREATE3 map, and they agree today. Rather than
 * deleting our copies on faith while readers are still being moved over, both
 * sets stay and this test fails the build if they ever stop matching.
 *
 * It matters more than it looks: every one of these contracts is a PROXY, so an
 * implementation can change without the address moving — and conversely a map
 * that drifts is exactly the thing no one notices until a read returns zeroes.
 */

test("the SDK's addresses still agree with the hand-pinned ones", () => {
  assert.deepEqual(addressDrift(), []);
});

test("the SDK ships the chain KURVV targets, with a websocket", () => {
  assert.equal(CHAIN.id, CHAIN_ID);
  // `wsRpcUrl` is left unset in `client.ts` on the strength of this: the SDK's
  // definition carries its own websocket, unlike viem's `somniaTestnet`.
  assert.ok(CHAIN.rpcUrls.default.webSocket?.length, "chain definition must carry a websocket endpoint");
});

test("the collateral the SDK names is the one KURVV approves against", () => {
  // `testUsdc` is the legacy alias; `collateral` is preferred. Both are read so
  // a deploy that sets only one still resolves.
  const c = ADDRESSES.collateral ?? ADDRESSES.testUsdc;
  assert.equal(c?.toLowerCase(), ADDR.tusdc.toLowerCase());
});

test("the SDK's default marketCreator is NOT one of KURVV's venue creators", () => {
  // Guards a tempting mistake. The SDK's `marketCreator` is the factory its live
  // tail watches; KURVV's venues each name their own, and those are what
  // PlanBook subscribes to. Inheriting the SDK's would watch the wrong factory.
  const sdkCreator = ADDRESSES.marketCreator?.toLowerCase();
  assert.ok(sdkCreator, "the SDK map should still carry a marketCreator");
  assert.notEqual(sdkCreator, "0xee3aff92812a2cb7bf801b500687bc97b55cab34");
  assert.notEqual(sdkCreator, "0x94d963b6670ab96e78c8d0c46ca35d196d606efe");
});
