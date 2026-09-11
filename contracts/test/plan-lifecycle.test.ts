import assert from "node:assert/strict";
import hre from "hardhat";
import { encodeFunctionData, getAddress, keccak256, toHex, pad, type Address } from "viem";

/**
 * Plan lifecycle, against mocked dreamDEX surfaces.
 *
 * The soak logs in claude-docs are the real evidence that this works on chain; this
 * suite exists so the lifecycle's branches are pinned locally and a reader can see
 * them exercised. It deliberately does not chase coverage.
 *
 * The reactivity precompile does not exist on a Hardhat chain, so `commitPlan` would
 * revert inside `SomniaExtensions.subscribe`. We inject a mock's runtime code at
 * 0x0100 and impersonate that address to drive the handler.
 */
const PRECOMPILE = "0x0000000000000000000000000000000000000100" as Address;
const ROLL_TOPIC = keccak256(toHex("SeriesRolled(uint32,bytes32,address)"));
const SCHEDULE_TOPIC = "0x67aa3d752967d87d8944b9c7adf73172518777fa4703f336edee81f0736d8987";
const SERIES = 3;
const OPEN_DELAY = 22;
const MIN_HEADROOM = 12;
const GAS_LIMIT = 20_000_000n;
const YES = 1n, NO = 2n;

const mid = (n: number) => pad(toHex(n), { size: 32 });

async function setup() {
  const pub = await hre.viem.getPublicClient();
  const [owner, user] = await hre.viem.getWalletClients();

  const usdc = await hre.viem.deployContract("MockERC20");
  const outcome = await hre.viem.deployContract("MockOutcome6909");
  const module_ = await hre.viem.deployContract("MockModule", [outcome.address, usdc.address]);
  const precompile = await hre.viem.deployContract("MockPrecompile");

  // The precompile lives at a fixed address; put the mock's code there.
  void precompile; // kept for reference; 0x0100 itself is reserved and cannot be etched
  await hre.network.provider.send("hardhat_impersonateAccount", [PRECOMPILE]);
  await hre.network.provider.send("hardhat_setBalance", [PRECOMPILE, "0x21e19e0c9bab2400000"]);

  // PlanBookHarness stubs ONLY the precompile seam — 0x0100 is reserved on a local
  // EVM, so subscription creation cannot be reached otherwise. All other logic is real.
  const book = await hre.viem.deployContract("PlanBookHarness",
    [module_.address, outcome.address, usdc.address],
    { value: 33n * 10n ** 18n }); // still funded past the 32-native gate

  const market = await hre.viem.deployContract("MockBinaryMarket");
  const pool = await hre.viem.deployContract("MockBinaryPool", [usdc.address, outcome.address, YES, NO]);

  const now = BigInt((await pub.getBlock()).timestamp);
  const rec = {
    market: market.address, pool: pool.address, yesId: YES, noId: NO,
    tradingStart: now, expiry: now + 600n, venueId: pad("0x01", { size: 32 }), collateral: usdc.address,
  };
  await module_.write.register([mid(1), rec]);
  await module_.write.register([mid(2), { ...rec, market: market.address, pool: pool.address }]);

  await usdc.write.mint([user.account.address, 1_000_000_000n]);
  await book.write.setDryRun([false]);

  return { pub, owner, user, usdc, outcome, module_, book, market, pool };
}

const commitParams = (marketId: `0x${string}`, creator: Address) => ({
  marketCreator: creator, rollTopic: ROLL_TOPIC, seriesId: SERIES,
  openDelay: OPEN_DELAY, minHeadroom: MIN_HEADROOM, gasLimit: GAS_LIMIT, marketId,
});

/** Drive the handler exactly as a validator would. */
async function fire(book: any, emitter: Address, topics: `0x${string}`[]) {
  await hre.network.provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: PRECOMPILE, to: book.address, gas: "0xe00000", // under the local 16.7M tx gas cap
      data: encodeFunctionData({
        abi: book.abi, functionName: "onEvent",
        args: [emitter, topics, "0x"],
      }),
    }],
  });
}

const CREATOR = getAddress("0x000000000000000000000000000000000000c0fe") as Address;

describe("Plan lifecycle", () => {
  it("rejects an allowance that is not EXACTLY the total stake", async () => {
    const { usdc, book, user } = await setup();
    const stakes = [400_000n, 600_000n]; // total 1_000_000

    // Too much — an unlimited approval would make our custody claim false.
    await usdc.write.approve([book.address, 1_000_001n], { account: user.account });
    await assert.rejects(
      book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], stakes], { account: user.account }),
      /ApprovalMustBeExact|reverted/,
      "an over-approval must be rejected",
    );

    // Too little.
    await usdc.write.approve([book.address, 999_999n], { account: user.account });
    await assert.rejects(
      book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], stakes], { account: user.account }),
      /ApprovalMustBeExact|reverted/,
      "an under-approval must be rejected",
    );
  });

  it("commits with an exact allowance and opens Leg 0", async () => {
    const { usdc, book, user, outcome } = await setup();
    const stakes = [400_000n, 600_000n];
    await usdc.write.approve([book.address, 1_000_000n], { account: user.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], stakes], { account: user.account });

    const leg0 = await book.read.getLeg([0n, 0]);
    assert.equal(leg0.state, 1, "Leg 0 should be Open");
    assert.ok(leg0.filled > 0n, "Leg 0 should have filled");
    // 0.4 tUSDC at 0.50 (ask 500000 + 4 ticks cushion = 504000) -> ~0.79 contracts
    assert.ok(await outcome.read.balanceOf([book.address, YES]) > 0n, "book should hold YES tokens");

    const sch = await book.read.schedules([0n]);
    assert.equal(sch[2], 1, "cursor should advance to 1");
    assert.equal(sch[4], 600_000n, "unspent should be Leg 1's stake only");
  });

  it("advances the chain: a roll queues the next open, the Schedule fire opens it", async () => {
    const { book, usdc, user } = await setup();
    await usdc.write.approve([book.address, 1_000_000n], { account: user.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], [400_000n, 600_000n]], { account: user.account });

    // Roll: settles Leg 0 (unresolved here, so it defers) and queues Leg 1.
    await fire(book, CREATOR, [ROLL_TOPIC, pad(toHex(SERIES), { size: 32 }), mid(2), pad("0x01", { size: 32 })]);
    let leg1 = await book.read.getLeg([0n, 1]);
    assert.equal(leg1.state, 0, "Leg 1 is still Pending until the delayed open");

    // The delayed open.
    await fire(book, PRECOMPILE, [SCHEDULE_TOPIC, pad(toHex(1), { size: 32 })]);
    leg1 = await book.read.getLeg([0n, 1]);
    assert.equal(leg1.state, 1, "Leg 1 should be Open after the Schedule fire");
    assert.ok(leg1.filled > 0n, "Leg 1 should have filled");

    const sch = await book.read.schedules([0n]);
    assert.equal(sch[2], 2, "cursor should be 2");
    assert.equal(sch[4], 0n, "all stake deployed");
  });

  it("commits WITHOUT taking the stake: only the Leg that opened costs anything", async () => {
    const { book, usdc, user } = await setup();
    const stakes = [400_000n, 600_000n];
    const before = await usdc.read.balanceOf([user.account.address]);

    await usdc.write.approve([book.address, 1_000_000n], { account: user.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], stakes], { account: user.account });

    const spent = before - (await usdc.read.balanceOf([user.account.address]));
    assert.ok(spent > 0n, "Leg 0 opened, so something was spent");
    assert.ok(spent <= 400_000n, `only Leg 0's stake may be drawn, not the total — drew ${spent}`);

    // The contract must not be sitting on change: lot rounding leaves some, and
    // holding it would rebuild the custody this design removes.
    assert.equal(await usdc.read.balanceOf([book.address]), 0n, "PlanBook must hold NO collateral at rest");

    // Leg 1's stake is still the owner's, and still claimable via the allowance.
    assert.equal(await book.read.outstanding([user.account.address]), 600_000n, "only Leg 1 remains outstanding");
  });

  it("cancels mid-chain: nothing to refund, because nothing was taken", async () => {
    const { book, usdc, user } = await setup();
    await usdc.write.approve([book.address, 1_000_000n], { account: user.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], [400_000n, 600_000n]], { account: user.account });

    const before = await usdc.read.balanceOf([user.account.address]);
    await book.write.cancelPlan([0n], { account: user.account });
    const after = await usdc.read.balanceOf([user.account.address]);

    assert.equal(after, before, "cancel moves no money — the stake never left the owner");
    const sch = await book.read.schedules([0n]);
    assert.equal(sch[3], false, "plan should not be live");
    assert.equal(sch[4], 0n, "unspent must be zeroed");
    assert.equal(await book.read.outstanding([user.account.address]), 0n, "the claim on the allowance is released");
  });

  it("a Leg the owner cannot fund is SKIPPED, and the Plan carries on", async () => {
    const { book, usdc, user } = await setup();
    await usdc.write.approve([book.address, 1_000_000n], { account: user.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], [400_000n, 600_000n]], { account: user.account });

    // The owner takes the allowance away mid-Plan — the cost of holding no custody.
    await usdc.write.approve([book.address, 0n], { account: user.account });
    const before = await usdc.read.balanceOf([user.account.address]);

    await fire(book, CREATOR, [ROLL_TOPIC, pad(toHex(SERIES), { size: 32 }), mid(2), pad("0x01", { size: 32 })]);
    await fire(book, PRECOMPILE, [SCHEDULE_TOPIC, pad(toHex(1), { size: 32 })]);

    const leg1 = await book.read.getLeg([0n, 1]);
    assert.equal(leg1.state, 3, "Leg 1 must be Skipped, not Open");
    assert.equal(await usdc.read.balanceOf([user.account.address]), before, "a skipped Leg costs nothing");
    assert.equal(await usdc.read.balanceOf([book.address]), 0n, "and leaves nothing behind in the contract");

    const skips = await book.getEvents.LegSkipped();
    assert.ok(skips.some((e: any) => e.args.reason === 15), "the reason must be StakeUnavailable (15)");
  });

  it("a second Plan must approve its own total PLUS what the first still needs", async () => {
    const { book, usdc, user } = await setup();
    await usdc.write.approve([book.address, 1_000_000n], { account: user.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], [400_000n, 600_000n]], { account: user.account });
    assert.equal(await book.read.outstanding([user.account.address]), 600_000n);

    // `approve` OVERWRITES. Approving only the new Plan's total would quietly hand
    // Plan 0's remaining Leg the new Plan's money.
    await usdc.write.approve([book.address, 500_000n], { account: user.account });
    await assert.rejects(
      book.write.commitPlan([commitParams(mid(1), CREATOR), [0], [500_000n]], { account: user.account }),
      /ApprovalMustBeExact|reverted/,
      "an allowance that ignores the live Plan must be rejected",
    );

    // 500_000 for the new Plan + 600_000 still owed to the old one.
    await usdc.write.approve([book.address, 1_100_000n], { account: user.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0], [500_000n]], { account: user.account });
    assert.equal((await book.read.getLeg([1n, 0])).state, 1, "the second Plan's Leg 0 opens");
  });

  it("redeems a settled Leg on a DEAD plan and pays the owner", async () => {
    const { book, usdc, user, market } = await setup();
    await usdc.write.approve([book.address, 1_000_000n], { account: user.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], [400_000n, 600_000n]], { account: user.account });

    // Kill the plan first — redeeming must still work afterwards.
    await book.write.cancelPlan([0n], { account: user.account });
    await market.write.resolve([10_000_000n, 0n]); // Up wins

    const filled = (await book.read.getLeg([0n, 0])).filled;
    const before = await usdc.read.balanceOf([user.account.address]);
    await book.write.redeemSettled([0n, 0]);          // permissionless
    const after = await usdc.read.balanceOf([user.account.address]);

    assert.equal(after - before, filled, "1 collateral unit per winning contract, to the OWNER");
    assert.equal((await book.read.getLeg([0n, 0])).state, 2, "Leg should be Settled");
  });

  it("THE TRAP: two Plans on the same market each redeem only their OWN tickets", async () => {
    // The book holds ONE ERC-6909 balance per outcome token, pooled across every Plan
    // it hosts, and Plans share markets by design: a series has one market per Window,
    // so two owners going the same way land on the same tokenId. Redeeming the whole
    // balance paid the first caller both Plans' winnings and left the second nothing.
    const { book, usdc, outcome, user, market } = await setup();
    const [, , second] = await hre.viem.getWalletClients();

    await usdc.write.approve([book.address, 1_000_000n], { account: user.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], [400_000n, 600_000n]], { account: user.account });

    await usdc.write.mint([second.account.address, 1_000_000_000n]);
    await usdc.write.approve([book.address, 1_000_000n], { account: second.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], [400_000n, 600_000n]], { account: second.account });

    const mine = (await book.read.getLeg([0n, 0])).filled;
    const theirs = (await book.read.getLeg([1n, 0])).filled;
    assert.ok(mine > 0n && theirs > 0n, "both Legs must have filled for this to test anything");
    assert.equal(
      await outcome.read.balanceOf([book.address, YES]), mine + theirs,
      "the book's balance is POOLED across both Plans — that is the whole hazard",
    );

    await market.write.resolve([10_000_000n, 0n]); // Up wins; both Legs were Up

    const beforeA = await usdc.read.balanceOf([user.account.address]);
    await book.write.redeemSettled([0n, 0]);
    const afterA = await usdc.read.balanceOf([user.account.address]);
    assert.equal(afterA - beforeA, mine, "the first redeemer must take ONLY its own tickets");

    // The decisive half: the second Plan's winnings must still be there.
    const beforeB = await usdc.read.balanceOf([second.account.address]);
    await book.write.redeemSettled([1n, 0]);
    const afterB = await usdc.read.balanceOf([second.account.address]);
    assert.equal(afterB - beforeB, theirs, "the second owner must not be left with zero");
  });

  it("a losing Leg redeems successfully and pays zero", async () => {
    const { book, usdc, user, market } = await setup();
    await usdc.write.approve([book.address, 1_000_000n], { account: user.account });
    await book.write.commitPlan([commitParams(mid(1), CREATOR), [0, 0], [400_000n, 600_000n]], { account: user.account });
    await market.write.resolve([0n, 10_000_000n]); // Down wins; our Leg was Up

    const before = await usdc.read.balanceOf([user.account.address]);
    await book.write.redeemSettled([0n, 0]);
    const after = await usdc.read.balanceOf([user.account.address]);

    assert.equal(after - before, 0n, "a loser pays zero and must not revert");
    assert.equal((await book.read.getLeg([0n, 0])).state, 2);
  });
});
