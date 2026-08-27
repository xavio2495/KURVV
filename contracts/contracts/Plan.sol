// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

import {
    IERC20,
    IOutcomeToken6909,
    IBinaryMarketsModule,
    IBinaryMarket,
    IBinaryPool,
    IMarketCreator
} from "./KurvvInterfaces.sol";

/// @title  Plan
/// @notice One committed schedule of Event Contract positions, executed leg by leg
///         by Somnia Reactivity with no keeper, cron, or off-chain signer.
///
/// @dev    PHASE 1 SCOPE: a single Plan per deployment, from a hard-coded Leg. The
///         Curve mapping, multi-Plan storage, and the frontend are later phases.
///
///         CUSTODY. This contract holds the committed stake for the Plan's duration
///         and places orders AS ITSELF — the dreamDEX operator/session-key path is
///         protocol-gated (`OnlyApprovedContracts`) and a Reactivity handler cannot
///         sign as an EOA, so there is no third option. The claim we make to users
///         is "authorising a Plan stakes exactly what you staked, and nothing else",
///         and `commitPlan` enforces the exact-allowance half of that on-chain.
///
///         STALLS ARE LOCKUPS. Because the contract holds funds, every path that
///         can stall must have an owner-reachable exit that does not depend on the
///         handler ever firing again. `cancelPlan`, `redeemSettled`,
///         `withdrawToken` and `withdrawNative` are those exits.
contract Plan is SomniaEventHandler {
    // ─────────────────────────────────────────────────────────────────────────
    // Domain model
    // ─────────────────────────────────────────────────────────────────────────

    enum Dir {
        Up,
        Down
    }

    enum LegState {
        Pending,
        Open,
        Settled,
        Skipped
    }

    /// @notice One Event Contract position, corresponding to one segment of a Curve.
    struct Leg {
        Dir direction; // sign of the segment
        LegState state;
        uint32 entryPrice; // published Up price at entry, 6dp — the calibration record
        uint96 stake; // tUSDC base units. Conviction x total, integers only
        uint128 filled; // outcome tokens actually acquired, 6dp
        bytes32 marketId; // zero until opened
    }

    /// @notice The committed schedule. A Plan targets ONE `seriesId` for its whole
    ///         life, which is what lets a single subscription serve every Leg.
    struct Schedule {
        address owner; // who staked, and the only address proceeds may reach
        uint32 seriesId; // 1 = BTC 15m on the rolling venue
        uint32 cursor; // index of the next unexecuted Leg
        bool live; // false once cancelled or exhausted
        uint96 unspent; // stake committed but not yet deployed
        uint64 gasLimit; // reused when arming each Leg's delayed open
        uint256 subscriptionId;
    }

    /// @notice Every reason the handler may decline to act. A silent early return
    ///         inside a validator-invoked synthetic transaction is undebuggable and
    ///         looks identical to an unfunded subscription — so there are none.
    enum Reason {
        None,
        WrongEmitter,
        WrongTopic,
        WrongSeries,
        PlanNotLive,
        PlanComplete,
        MarketNotTrading,
        WindowTooShort,
        NoLiquidity,
        StakeTooSmall,
        DryRun,
        OrderRejected,
        PredecessorUnresolved,
        NothingPending
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Wiring — permanent addresses only. Per-market and per-pool addresses rotate
    // every Window and are read at runtime, never stored beyond their Leg.
    // ─────────────────────────────────────────────────────────────────────────

    IBinaryMarketsModule public immutable MODULE;
    IOutcomeToken6909 public immutable OUTCOME;
    IERC20 public immutable COLLATERAL; // tUSDC on Shannon, 6 decimals
    IMarketCreator public immutable MARKET_CREATOR;

    /// @dev keccak256("SeriesRolled(uint32,bytes32,address)"). Emitted by the venue's
    ///      MarketCreator on every roll, with the successor's marketId already in
    ///      topic[2] — no decode, no follow-up call.
    bytes32 public constant SERIES_ROLLED =
        0x2f81a5d8c4d5d43e0ba57b7ee38e6a5ac6799dd18f58f377d1fc8359d6a27eee;

    /// @dev keccak256("Schedule(uint256)") — the precompile's one-shot system event,
    ///      emitted from 0x0100 at the requested wall-clock time.
    bytes32 public constant SCHEDULE_TOPIC =
        0x67aa3d752967d87d8944b9c7adf73172518777fa4703f336edee81f0736d8987;

    /// @dev MEASURED, not guessed: a freshly rolled Window has an EMPTY book on both
    ///      sides, because the venue's maker posts its first quotes ~9s after
    ///      `tradingStart`. A Reactivity handler runs as a synthetic transaction in
    ///      the SAME block as the roll, so opening there always finds no liquidity.
    ///      We therefore arm a one-shot `Schedule` and open once the book exists.
    uint64 public constant OPEN_DELAY = 45 seconds;

    uint8 private constant KIND_BUY_YES = 0;
    uint8 private constant KIND_BUY_NO = 2;
    uint8 private constant ORDER_TYPE_IOC = 2;
    uint8 private constant STATUS_TRADING = 1;
    uint256 private constant ONE = 1e6; // collateral scale; asserted against decimals()

    /// @dev The maker pulls quotes near expiry, so a Leg opened into the tail of a
    ///      Window fills at a bad price or not at all.
    uint64 public constant MIN_WINDOW_HEADROOM = 120 seconds;

    /// @dev Ticks of price cushion so the IOC actually crosses. A taker is charged
    ///      the fill price, not the price it offered, so this costs nothing when the
    ///      book is where we last read it.
    uint256 private constant CROSS_CUSHION_TICKS = 4;

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    address public immutable owner; // contract admin: sweeps, dry-run switch
    bool public dryRun = true; // CLAUDE.md §5 — nothing goes live without a dry run
    Schedule public schedule;
    Leg[] public legs;

    /// @dev Pools are recycled from a free list of 140+ and rotate every Window, so
    ///      the same pool recurs across a long-running Plan. Cache the approval and
    ///      the list saturates instead of paying for one every Leg. The contract
    ///      approves on its own behalf — no user signature is involved.
    mapping(address => bool) public poolApproved;

    /// @dev The market handed to us by `SeriesRolled`, held until the delayed open.
    bytes32 public pendingMarketId;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event PlanCommitted(address indexed owner, uint32 indexed seriesId, uint96 totalStake, uint256 legCount);
    event SubscriptionOpened(uint256 indexed subscriptionId, address indexed emitter, uint32 indexed seriesId);
    event SubscriptionClosed(uint256 indexed subscriptionId);

    /// @dev Emitted instead of placing while `dryRun` is on. Carries the exact
    ///      intended order so a dry run is reviewable rather than merely safe.
    event LegIntent(
        uint32 indexed legIndex,
        bytes32 indexed marketId,
        address pool,
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs
    );
    event OpenScheduled(uint32 indexed legIndex, bytes32 indexed marketId, uint256 firesAtMillis);
    event LegOpened(uint32 indexed legIndex, bytes32 indexed marketId, uint256 price, uint256 filled);
    event LegSkipped(uint32 indexed legIndex, Reason reason);
    event LegSettled(uint32 indexed legIndex, bytes32 indexed marketId, uint256 redeemed, uint256 paidToOwner);
    event PlanCancelled(uint96 refunded);
    event PlanCompleted();
    event Swept(address indexed token, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error NotOwner();
    error PlanAlreadyCommitted();
    error NoPlan();
    error EmptySchedule();
    /// @dev The user must approve PRECISELY the Plan's total stake. An unlimited
    ///      allowance would make our custody claim false, so it is rejected here
    ///      rather than merely discouraged in the UI.
    error ApprovalMustBeExact(uint256 required, uint256 actual);
    error UnexpectedDecimals(uint8 got);
    error LegNotOpen();
    error NotResolvedYet();
    error NothingToSweep();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address module_,
        address outcome_,
        address collateral_,
        address marketCreator_
    ) payable {
        owner = msg.sender;
        MODULE = IBinaryMarketsModule(module_);
        OUTCOME = IOutcomeToken6909(outcome_);
        COLLATERAL = IERC20(collateral_);
        MARKET_CREATOR = IMarketCreator(marketCreator_);

        // Fail loudly at deploy rather than mispricing every order silently.
        uint8 d = IERC20(collateral_).decimals();
        if (d != 6) revert UnexpectedDecimals(d);

        // One-time: let the module pull our winning outcome tokens on redeem.
        IOutcomeToken6909(outcome_).setOperator(module_, true);
    }

    receive() external payable {}

    // ─────────────────────────────────────────────────────────────────────────
    // Commit
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Commit a schedule, subscribe to the Window's roll event, and open Leg 0.
    /// @dev    The caller must have approved EXACTLY `totalStake` of collateral to
    ///         this contract. This contract must already hold >= 32 native tokens —
    ///         `SomniaExtensions.subscribe` checks `address(this).balance`, so it is
    ///         the Plan's balance that gates the subscription, not the deployer's.
    /// @param  seriesId    Window series on the venue's MarketCreator (1 = BTC 15m).
    /// @param  directions  Direction per Leg, in execution order.
    /// @param  stakes      Stake per Leg in collateral base units; must sum to the approval.
    /// @param  gasLimit    Per-invocation handler gas cap. Must clear measured cost
    ///                     PLUS Somnia's 1,000,000 storage reserve.
    /// @param  marketId    The currently-Trading market for `seriesId`, for Leg 0.
    function commitPlan(
        uint32 seriesId,
        Dir[] calldata directions,
        uint96[] calldata stakes,
        uint64 gasLimit,
        bytes32 marketId
    ) external {
        if (schedule.owner != address(0)) revert PlanAlreadyCommitted();
        if (directions.length == 0 || directions.length != stakes.length) revert EmptySchedule();

        uint96 total;
        for (uint256 i; i < stakes.length; ++i) {
            total += stakes[i];
            legs.push(
                Leg({
                    direction: directions[i],
                    state: LegState.Pending,
                    entryPrice: 0,
                    stake: stakes[i],
                    filled: 0,
                    marketId: bytes32(0)
                })
            );
        }

        uint256 allowed = COLLATERAL.allowance(msg.sender, address(this));
        if (allowed != total) revert ApprovalMustBeExact(total, allowed);
        COLLATERAL.transferFrom(msg.sender, address(this), total);

        schedule = Schedule({
            owner: msg.sender,
            seriesId: seriesId,
            cursor: 0,
            live: true,
            unspent: total,
            gasLimit: gasLimit,
            subscriptionId: 0
        });
        emit PlanCommitted(msg.sender, seriesId, total, directions.length);

        _subscribe(seriesId, gasLimit);
        _openLeg(0, marketId);
    }

    /// @dev Pins `emitter` to the MarketCreator. That pin is also the recursion
    ///      guard: our own events come from `address(this)`, so a filter that names
    ///      the MarketCreator can never match anything we emit. Do not wildcard it.
    function _subscribe(uint32 seriesId, uint64 gasLimit) private {
        SomniaExtensions.SubscriptionFilter memory filter = SomniaExtensions.SubscriptionFilter({
            eventTopics: [SERIES_ROLLED, bytes32(uint256(seriesId)), bytes32(0), bytes32(0)],
            origin: address(0),
            emitter: address(MARKET_CREATOR)
        });
        SomniaExtensions.SubscriptionOptions memory options = SomniaExtensions.SubscriptionOptions({
            priorityFeePerGas: 0,
            maxFeePerGas: 20 gwei,
            gasLimit: gasLimit
        });
        uint256 id = SomniaExtensions.subscribe(address(this), filter, options);
        schedule.subscriptionId = id;
        emit SubscriptionOpened(id, address(MARKET_CREATOR), seriesId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The handler
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Invoked by validators as a synthetic transaction. The base contract has
    ///      already enforced `msg.sender == 0x0100`.
    ///
    ///      `SeriesRolled` fires at the instant the predecessor Window finalises and
    ///      the successor is created, so ONE event is both the settlement signal for
    ///      Leg N and the open signal for Leg N+1. That is why payout is per-Leg:
    ///      the information is already here, and forwarding now minimises how long
    ///      this contract holds anyone's money.
    function _onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata) internal override {
        // Two entry paths, distinguished by emitter:
        //   MarketCreator  -> SeriesRolled: a Window closed and its successor exists.
        //   0x0100         -> Schedule:     our own delayed open, now that the book
        //                                   has had time to form.
        if (emitter == SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS) {
            _onScheduledOpen(eventTopics);
            return;
        }
        if (emitter != address(MARKET_CREATOR)) {
            emit LegSkipped(schedule.cursor, Reason.WrongEmitter);
            return;
        }
        _onSeriesRolled(eventTopics);
    }

    /// @dev The roll instant. One event is both the settlement signal for Leg N and
    ///      the discovery of the market for Leg N+1 — which is why payout is per-Leg.
    function _onSeriesRolled(bytes32[] calldata eventTopics) private {
        uint32 cursor = schedule.cursor;

        if (eventTopics.length < 3 || eventTopics[0] != SERIES_ROLLED) {
            emit LegSkipped(cursor, Reason.WrongTopic);
            return;
        }
        if (uint32(uint256(eventTopics[1])) != schedule.seriesId) {
            emit LegSkipped(cursor, Reason.WrongSeries);
            return;
        }

        // 1. Redeem and forward the Leg whose Window just ended. Resolution lands in
        //    a different transaction from the roll, so a deferral here is normal;
        //    the permissionless `redeemSettled` closes it out either way.
        if (cursor > 0) {
            uint32 prev = cursor - 1;
            if (legs[prev].state == LegState.Open) {
                if (!_tryRedeem(prev)) emit LegSkipped(prev, Reason.PredecessorUnresolved);
            }
        }

        // 2. Arm the next Leg. Not opened here — see OPEN_DELAY.
        if (!schedule.live) {
            emit LegSkipped(cursor, Reason.PlanNotLive);
            _closeSubscription();
            return;
        }
        if (cursor >= legs.length) {
            emit PlanCompleted();
            schedule.live = false;
            _closeSubscription();
            return;
        }

        pendingMarketId = eventTopics[2];
        uint256 firesAt = (block.timestamp + OPEN_DELAY) * 1000 + 1;
        SomniaExtensions.scheduleSubscriptionAtTimestamp(
            address(this),
            firesAt,
            SomniaExtensions.SubscriptionOptions({
                priorityFeePerGas: 0,
                maxFeePerGas: 20 gwei,
                gasLimit: schedule.gasLimit
            })
        );
        emit OpenScheduled(cursor, pendingMarketId, firesAt);
    }

    /// @dev The delayed open. The one-shot subscription that brought us here is
    ///      auto-removed by the protocol as it fires, so there is nothing to clean up.
    function _onScheduledOpen(bytes32[] calldata eventTopics) private {
        uint32 cursor = schedule.cursor;

        if (eventTopics.length < 1 || eventTopics[0] != SCHEDULE_TOPIC) {
            emit LegSkipped(cursor, Reason.WrongTopic);
            return;
        }
        if (!schedule.live) {
            emit LegSkipped(cursor, Reason.PlanNotLive);
            return;
        }
        if (cursor >= legs.length) {
            emit LegSkipped(cursor, Reason.PlanComplete);
            return;
        }
        bytes32 marketId = pendingMarketId;
        if (marketId == bytes32(0)) {
            emit LegSkipped(cursor, Reason.NothingPending);
            return;
        }
        pendingMarketId = bytes32(0);
        _openLeg(cursor, marketId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Opening a Leg
    // ─────────────────────────────────────────────────────────────────────────

    function _openLeg(uint32 legIndex, bytes32 marketId) private {
        Leg storage leg = legs[legIndex];

        (, , , , , , , , address market, address pool, , , , uint64 expiry) = MODULE.markets(marketId);

        // Gate on live on-chain status, never on an indexed row.
        if (IBinaryMarket(market).status() != STATUS_TRADING) {
            leg.state = LegState.Skipped;
            schedule.cursor = legIndex + 1;
            emit LegSkipped(legIndex, Reason.MarketNotTrading);
            return;
        }
        if (expiry < block.timestamp + MIN_WINDOW_HEADROOM) {
            leg.state = LegState.Skipped;
            schedule.cursor = legIndex + 1;
            emit LegSkipped(legIndex, Reason.WindowTooShort);
            return;
        }

        IBinaryPool.BookParams memory bp = IBinaryPool(pool).getOrderBookParameters();
        bool up = leg.direction == Dir.Up;

        // Cross the touch. BUY_YES lifts the best ask; BUY_NO meets a resting Buy YES
        // (the mint-a-pair path), so it works down from the best bid. `price` is the
        // YES-side price in both cases.
        IBinaryPool.Level[] memory levels = IBinaryPool(pool).getBookLevels(!up, 1);
        if (levels.length == 0 || levels[0].price == 0) {
            leg.state = LegState.Skipped;
            schedule.cursor = legIndex + 1;
            emit LegSkipped(legIndex, Reason.NoLiquidity);
            return;
        }

        uint256 touch = levels[0].price;
        uint256 cushion = bp.tickSize * CROSS_CUSHION_TICKS;
        uint256 price = up ? touch + cushion : (touch > cushion ? touch - cushion : bp.tickSize);
        price = (price / bp.tickSize) * bp.tickSize; // snap to the grid
        if (price == 0) price = bp.tickSize;
        if (price >= ONE) price = ONE - bp.tickSize;

        // Cost per contract is `price` for YES and `ONE - price` for NO.
        uint256 unit = up ? price : ONE - price;
        uint256 qty = (uint256(leg.stake) * ONE) / unit;
        qty = (qty / bp.lotSize) * bp.lotSize; // snap to the lot grid
        if (qty == 0 || qty < bp.minQuantity) {
            leg.state = LegState.Skipped;
            schedule.cursor = legIndex + 1;
            emit LegSkipped(legIndex, Reason.StakeTooSmall);
            return;
        }

        // Order expiry is mandatory, in NANOSECONDS, and may not outlive the Window.
        uint64 expNs = uint64(expiry) * 1e9;

        if (dryRun) {
            emit LegIntent(legIndex, marketId, pool, up ? KIND_BUY_YES : KIND_BUY_NO, price, qty, expNs);
            emit LegSkipped(legIndex, Reason.DryRun);
            return; // cursor deliberately NOT advanced: a dry run changes nothing
        }

        if (!poolApproved[pool]) {
            COLLATERAL.approve(pool, type(uint256).max);
            poolApproved[pool] = true;
        }

        (, , , , , , , , , , uint256 yesId, uint256 noId, , ) = MODULE.markets(marketId);
        uint256 tokenId = up ? yesId : noId;
        uint256 before = OUTCOME.balanceOf(address(this), tokenId);

        try
            IBinaryPool(pool).placeBinaryOrder(
                up ? KIND_BUY_YES : KIND_BUY_NO,
                price,
                qty,
                expNs,
                ORDER_TYPE_IOC,
                0,
                address(0),
                0,
                0
            )
        returns (bool, uint128) {
            uint256 got = OUTCOME.balanceOf(address(this), tokenId) - before;
            if (got == 0) {
                leg.state = LegState.Skipped;
                schedule.cursor = legIndex + 1;
                emit LegSkipped(legIndex, Reason.NoLiquidity);
                return;
            }
            leg.state = LegState.Open;
            leg.marketId = marketId;
            leg.entryPrice = uint32(price);
            leg.filled = uint128(got);
            schedule.unspent -= leg.stake;
            schedule.cursor = legIndex + 1;
            emit LegOpened(legIndex, marketId, price, got);
        } catch {
            leg.state = LegState.Skipped;
            schedule.cursor = legIndex + 1;
            emit LegSkipped(legIndex, Reason.OrderRejected);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Settlement and payout
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Redeem a settled Leg and forward the proceeds to the Plan's owner.
    /// @dev    PERMISSIONLESS by design — anyone may trigger the payout, but only the
    ///         Plan's owner can receive it. This is the exit that still works when the
    ///         chain has stalled, the Plan was cancelled, or the handler never fired.
    function redeemSettled(uint32 legIndex) external {
        if (legs[legIndex].state != LegState.Open) revert LegNotOpen();
        if (!_tryRedeem(legIndex)) revert NotResolvedYet();
    }

    function _tryRedeem(uint32 legIndex) private returns (bool) {
        Leg storage leg = legs[legIndex];
        (, , , , , bytes32 venueId, , , address market, , uint256 yesId, uint256 noId, , ) =
            MODULE.markets(leg.marketId);

        if (!IBinaryMarket(market).isResolved() && !IBinaryMarket(market).isVoided()) return false;

        // Redeem the side we hold. A losing position redeems successfully and pays
        // zero; a voided market pays 0.5 per contract on each side.
        uint256 tokenId = leg.direction == Dir.Up ? yesId : noId;
        uint8 outcomeIdx = leg.direction == Dir.Up ? 0 : 1;
        uint256 held = OUTCOME.balanceOf(address(this), tokenId);

        uint256 before = COLLATERAL.balanceOf(address(this));
        if (held > 0) {
            MODULE.redeem(0, venueId, leg.marketId, outcomeIdx, held);
        }
        uint256 proceeds = COLLATERAL.balanceOf(address(this)) - before;

        leg.state = LegState.Settled;
        if (proceeds > 0) COLLATERAL.transfer(schedule.owner, proceeds);
        emit LegSettled(legIndex, leg.marketId, held, proceeds);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Exits
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Stop all future Legs and return the undeployed stake to the owner.
    /// @dev    Must work when the chain is STALLED, not only when it is running — a
    ///         Plan whose handler stopped firing is exactly when the owner most needs
    ///         their money back. Nothing here depends on the handler, and the
    ///         unsubscribe is best-effort so a subscription the protocol already
    ///         auto-removed cannot brick the refund.
    ///
    ///         Legs already settled are untouched: their proceeds were forwarded to
    ///         the owner at settlement. Legs still open remain redeemable afterwards
    ///         through the permissionless `redeemSettled`.
    function cancelPlan() external {
        if (schedule.owner == address(0)) revert NoPlan();
        if (msg.sender != schedule.owner && msg.sender != owner) revert NotOwner();

        schedule.live = false;
        _closeSubscription();

        uint96 refund = schedule.unspent;
        schedule.unspent = 0;
        if (refund > 0) COLLATERAL.transfer(schedule.owner, refund);
        emit PlanCancelled(refund);
    }

    /// @dev Best-effort. `SomniaExtensions.unsubscribe` reverts `UnsubscribeFailed`
    ///      on a subscription that no longer exists, and the protocol removes
    ///      subscriptions on its own when the owner cannot cover `gasLimit` — so a
    ///      typed call here would turn "already stopped" into "cannot cancel".
    function _closeSubscription() private {
        uint256 id = schedule.subscriptionId;
        if (id == 0) return;
        schedule.subscriptionId = 0;
        (bool ok, ) = SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS.call(
            abi.encodeWithSignature("unsubscribe(uint256)", id)
        );
        ok; // ignored on purpose — see above
        emit SubscriptionClosed(id);
    }

    /// @notice Sweep native balance. Each live Plan locks 32 STT as the subscription
    ///         gate, so old deployments must be emptied before funding a new one.
    function withdrawNative(uint256 amount) external onlyOwner {
        uint256 bal = address(this).balance;
        uint256 amt = amount == 0 ? bal : amount;
        if (amt == 0 || amt > bal) revert NothingToSweep();
        (bool ok, ) = payable(owner).call{value: amt}("");
        require(ok, "native transfer failed");
        emit Swept(address(0), amt);
    }

    /// @notice Sweep an ERC-20. Needed so tUSDC is never stranded in a dead Plan.
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 amt = amount == 0 ? bal : amount;
        if (amt == 0 || amt > bal) revert NothingToSweep();
        IERC20(token).transfer(owner, amt);
        emit Swept(token, amt);
    }

    /// @notice Arm live trading. Defaults off — CLAUDE.md §5.
    function setDryRun(bool on) external onlyOwner {
        dryRun = on;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function legCount() external view returns (uint256) {
        return legs.length;
    }

    function getLeg(uint32 i) external view returns (Leg memory) {
        return legs[i];
    }
}
