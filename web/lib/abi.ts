export const erc20Abi = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "faucet", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

export const batchExecutorAbi = [
  { name: "execute", type: "function", stateMutability: "payable",
    inputs: [{ name: "calls", type: "tuple[]", components: [
      { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }] }],
    outputs: [] },
] as const;

export const planBookAbi = [
  { name: "commitPlan", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "p", type: "tuple", components: [
        { name: "marketCreator", type: "address" }, { name: "rollTopic", type: "bytes32" },
        { name: "seriesId", type: "uint32" }, { name: "openDelay", type: "uint32" },
        { name: "minHeadroom", type: "uint32" }, { name: "gasLimit", type: "uint64" },
        { name: "marketId", type: "bytes32" }] },
      { name: "directions", type: "uint8[]" }, { name: "stakes", type: "uint96[]" }],
    outputs: [{ name: "planId", type: "uint256" }] },
  { name: "cancelPlan", type: "function", stateMutability: "nonpayable", inputs: [{ name: "planId", type: "uint256" }], outputs: [] },
  { name: "redeemSettled", type: "function", stateMutability: "nonpayable", inputs: [{ name: "planId", type: "uint256" }, { name: "legIndex", type: "uint32" }], outputs: [] },
  { name: "planCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "legCount", type: "function", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "dryRun", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { name: "outstanding", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "getLeg", type: "function", stateMutability: "view",
    inputs: [{ name: "planId", type: "uint256" }, { name: "i", type: "uint32" }],
    outputs: [{ name: "leg", type: "tuple", components: [
      { name: "direction", type: "uint8" }, { name: "state", type: "uint8" }, { name: "entryPrice", type: "uint32" },
      { name: "stake", type: "uint96" }, { name: "filled", type: "uint128" }, { name: "marketId", type: "bytes32" }] }] },
  { name: "schedules", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" }, { name: "seriesId", type: "uint32" }, { name: "cursor", type: "uint32" },
      { name: "live", type: "bool" }, { name: "unspent", type: "uint96" }, { name: "openDelay", type: "uint32" },
      { name: "minHeadroom", type: "uint32" }, { name: "marketCreator", type: "address" },
      { name: "rollTopic", type: "bytes32" }, { name: "pendingMarketId", type: "bytes32" }] },
  { type: "event", name: "PlanCommitted", inputs: [
    { name: "planId", type: "uint256", indexed: true }, { name: "owner", type: "address", indexed: true },
    { name: "seriesId", type: "uint32", indexed: true }, { name: "totalStake", type: "uint96" }, { name: "legCount", type: "uint256" }] },
  { type: "event", name: "LegOpened", inputs: [
    { name: "planId", type: "uint256", indexed: true }, { name: "legIndex", type: "uint32", indexed: true },
    { name: "marketId", type: "bytes32", indexed: true }, { name: "entryPrice", type: "uint256" }, { name: "filled", type: "uint256" }] },
  { type: "event", name: "LegSettled", inputs: [
    { name: "planId", type: "uint256", indexed: true }, { name: "legIndex", type: "uint32", indexed: true },
    { name: "marketId", type: "bytes32", indexed: true }, { name: "redeemed", type: "uint256" }, { name: "paidToOwner", type: "uint256" }] },
  { type: "event", name: "LegSkipped", inputs: [
    { name: "planId", type: "uint256", indexed: true }, { name: "legIndex", type: "uint32", indexed: true }, { name: "reason", type: "uint8" }] },
  { type: "event", name: "PlanCompleted", inputs: [{ name: "planId", type: "uint256", indexed: true }] },
  { type: "event", name: "PlanCancelled", inputs: [{ name: "planId", type: "uint256", indexed: true }, { name: "refunded", type: "uint96" }] },
] as const;

/**
 * `PlanBook.ONE` — the contract's fixed-point scale.
 *
 * NOT a display decimal count, which is why it does not come from the venue.
 * `entryPrice` is a PROBABILITY: `_openLeg` computes it as `spent * ONE / got`,
 * so its scale is the contract's constant and nothing else. It stays 6 for as
 * long as `PlanBook` reverts `UnexpectedDecimals` on anything but 6dp
 * collateral at construction (`PlanBook.sol:200`) — a loud failure, unlike the
 * silent one `fmtUnits` exists to prevent. If that constraint is ever lifted,
 * this must be read from the deployment rather than pinned here.
 */
export const PLANBOOK_ONE = 1_000_000;

export const SKIP_REASON = [
  "None", "WrongEmitter", "WrongTopic", "WrongSeries", "PlanNotLive", "PlanComplete",
  "MarketNotTrading", "WindowTooShort", "NoLiquidity", "StakeTooSmall", "DryRun",
  "OrderRejected", "PredecessorUnresolved", "NothingPending", "UnknownSchedule",
  // Appended, never reordered — the contract's enum is indexed by position.
  // The owner's allowance or balance could not cover this Leg when it opened.
  "StakeUnavailable",
] as const;

/** Just enough of the module + market to decide whether a Leg won. */
export const moduleAbi = [
  { name: "markets", type: "function", stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      { name: "oracleQuestionId", type: "uint256" }, { name: "outcomeSlotCount", type: "uint8" },
      { name: "voidPolicy", type: "uint8" }, { name: "collateral", type: "address" },
      { name: "originOperatorId", type: "uint32" }, { name: "originVenueId", type: "bytes32" },
      { name: "oracleAdapter", type: "address" }, { name: "creator", type: "address" },
      { name: "market", type: "address" }, { name: "pool", type: "address" },
      { name: "yesId", type: "uint256" }, { name: "noId", type: "uint256" },
      { name: "tradingStart", type: "uint64" }, { name: "expiry", type: "uint64" }] },
] as const;

export const marketAbi = [
  { name: "isResolved", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { name: "isVoided", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  // Settlement v3 stores a payout VECTOR, not a winner. The winning index is its argmax.
  { name: "payoutNumerators", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256[]" }] },
] as const;

/**
 * Just enough of the binary pool to ask whether a side of the book exists.
 *
 * `isBid` is in YES terms: a BUY_YES lifts the ask (`false`), a BUY_NO works down
 * from the bid (`true`) — the same convention `PlanBook._openLeg` uses, and it has to
 * stay the same or the pre-flight check would clear a side the contract never reads.
 */
export const binaryPoolAbi = [
  { name: "getBookLevels", type: "function", stateMutability: "view",
    inputs: [{ name: "isBid", type: "bool" }, { name: "numLevels", type: "uint64" }],
    outputs: [{ type: "tuple[]", components: [
      { name: "price", type: "uint256" }, { name: "quantity", type: "uint256" }] }] },
] as const;
