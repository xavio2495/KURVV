// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

import {
    IERC20,
    IOutcomeToken6909,
    IBinaryMarketsModule,
    IBinaryMarket,
    IBinaryPool
} from "./KurvvInterfaces.sol";

/// @title  PlanBook
/// @notice Many Plans on one deployment, each a committed schedule of Event Contract
///         positions executed leg by leg by Somnia Reactivity — no keeper, no cron,
///         no off-chain signer.
///
/// @dev    WHY ONE CONTRACT HOLDS MANY PLANS. The 32-native subscription requirement
///         is a BALANCE GATE checked at `subscribe`, not an escrow. One funded
///         deployment can therefore create unlimited subscriptions, so hosting N
///         Plans costs 32 native once rather than 32 x N.
///
///         VENUE-AGNOSTIC. Each Plan names its own MarketCreator, roll-event topic
///         and seriesId. The two live venues emit *different* roll events, but both
///         put `seriesId` in topic[1] and the successor `marketId` in topic[2], so
///         one filter shape serves both.
///
///         CUSTODY. This contract holds each Plan's committed stake and places
///         orders as itself — the operator path is protocol-gated and a Reactivity
///         handler cannot sign as an EOA. Every stall is therefore a lockup, and
///         every exit below works without the handler ever firing again.
contract PlanBook is SomniaEventHandler {
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

    struct Leg {
        Dir direction;
        LegState state;
        /// @dev The ACTUAL fill price (stake / filled), 6dp — not the limit we sent.
        ///      A taker is charged the fill, and this record is what calibration is
        ///      built on, so it must be what we really paid.
        uint32 entryPrice;
        uint96 stake;
        uint128 filled;
        bytes32 marketId;
    }

    /// @notice A Plan targets one (venue, series) for its whole life.
    struct Schedule {
        address owner;
        uint32 seriesId;
        uint32 cursor;
        bool live;
        uint96 unspent;
        /// @dev Seconds after a roll before opening. The successor's book is EMPTY at
        ///      the roll instant — the maker's first quotes land ~10s after
        ///      `tradingStart` on both venues. Tuned per Window length.
        uint32 openDelay;
        /// @dev Refuse to open into the tail of a Window; the maker pulls quotes near
        ///      expiry. Must be far smaller for 60s Windows than for 900s ones.
        uint32 minHeadroom;
        address marketCreator;
        bytes32 rollTopic;
        bytes32 pendingMarketId;
    }

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
        NothingPending,
        UnknownSchedule
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Wiring — permanent addresses only
    // ─────────────────────────────────────────────────────────────────────────

    IBinaryMarketsModule public immutable MODULE;
    IOutcomeToken6909 public immutable OUTCOME;
    IERC20 public immutable COLLATERAL;

    bytes32 public constant SCHEDULE_TOPIC =
        0x67aa3d752967d87d8944b9c7adf73172518777fa4703f336edee81f0736d8987;

    uint8 private constant KIND_BUY_YES = 0;
    uint8 private constant KIND_BUY_NO = 2;
    uint8 private constant ORDER_TYPE_IOC = 2;
    uint8 private constant STATUS_TRADING = 1;
    uint256 private constant ONE = 1e6;
    uint256 private constant CROSS_CUSHION_TICKS = 4;

    /// @dev Bounds the per-fire loop so a crowded series can never make the handler
    ///      exceed its gasLimit and stall every Plan on it.
    uint256 public constant MAX_PLANS_PER_FIRE = 16;

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    address public immutable owner;
    bool public dryRun = true;

    uint256 public planCount;
    mapping(uint256 => Schedule) public schedules;
    mapping(uint256 => Leg[]) private _legs;
    mapping(address => bool) public poolApproved;

    /// @dev One roll subscription per (marketCreator, seriesId), shared by every Plan
    ///      on it. Sharing is both cheaper and CORRECT: with one subscription per
    ///      Plan the handler would fire N times per roll and advance every Plan on
    ///      each fire.
    mapping(bytes32 => uint256) public seriesSubscription;
    mapping(bytes32 => uint256[]) public plansBySeries;
    /// @dev Reused when arming each Leg's one-shot delayed open.
    mapping(bytes32 => uint64) public seriesGasLimit;

    /// @dev Plans armed by the last roll and awaiting their delayed open.
    ///
    ///      MEASURED GOTCHA: a `Schedule` fire delivers the ACTUAL block timestamp in
    ///      milliseconds as topic[1], NOT the value we requested. The filter matches
    ///      on the requested value, but the delivered topic is the block's own time —
    ///      so a one-shot cannot be routed back to its Plan by its topic, and two
    ///      Plans armed in the same roll receive an identical topic. We therefore
    ///      keep the queue here and drain it on the next fire.
    uint256[] private _pendingOpens;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event PlanCommitted(
        uint256 indexed planId, address indexed owner, uint32 indexed seriesId, uint96 totalStake, uint256 legCount
    );
    event SubscriptionOpened(uint256 indexed subscriptionId, address indexed emitter, uint32 indexed seriesId);
    event SubscriptionClosed(uint256 indexed subscriptionId);
    /// @dev Armed once per roll for ALL Plans queued by it — `pendingCount` is how
    ///      many will be opened when the one-shot fires, not a planId.
    event OpenScheduled(uint256 indexed pendingCount, uint32 indexed seriesId, bytes32 indexed marketId, uint256 firesAtMillis);
    event LegIntent(
        uint256 indexed planId, uint32 indexed legIndex, bytes32 indexed marketId,
        address pool, uint8 kind, uint256 price, uint256 quantity, uint64 expireTimestampNs
    );
    event LegOpened(uint256 indexed planId, uint32 indexed legIndex, bytes32 indexed marketId, uint256 entryPrice, uint256 filled);
    event LegSkipped(uint256 indexed planId, uint32 indexed legIndex, Reason reason);
    event LegSettled(uint256 indexed planId, uint32 indexed legIndex, bytes32 indexed marketId, uint256 redeemed, uint256 paidToOwner);
    event PlanCancelled(uint256 indexed planId, uint96 refunded);
    event PlanCompleted(uint256 indexed planId);
    event Swept(address indexed token, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error NotOwner();
    error EmptySchedule();
    error ApprovalMustBeExact(uint256 required, uint256 actual);
    error UnexpectedDecimals(uint8 got);
    error LegNotOpen();
    error NotResolvedYet();
    error NothingToSweep();
    error NoPlan();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address module_, address outcome_, address collateral_) payable {
        owner = msg.sender;
        MODULE = IBinaryMarketsModule(module_);
        OUTCOME = IOutcomeToken6909(outcome_);
        COLLATERAL = IERC20(collateral_);

        uint8 d = IERC20(collateral_).decimals();
        if (d != 6) revert UnexpectedDecimals(d);

        IOutcomeToken6909(outcome_).setOperator(module_, true);
    }

    receive() external payable {}

    // ─────────────────────────────────────────────────────────────────────────
    // Commit
    // ─────────────────────────────────────────────────────────────────────────

    struct CommitParams {
        address marketCreator;
        bytes32 rollTopic;
        uint32 seriesId;
        uint32 openDelay;
        uint32 minHeadroom;
        uint64 gasLimit;
        bytes32 marketId; // the currently-Trading market, for Leg 0
    }

    /// @notice Commit a schedule, ensure the series is subscribed, and open Leg 0.
    /// @dev    The caller must have approved EXACTLY the sum of `stakes`. Never max —
    ///         an unlimited allowance would make our custody claim false.
    function commitPlan(CommitParams calldata p, Dir[] calldata directions, uint96[] calldata stakes)
        external
        returns (uint256 planId)
    {
        if (directions.length == 0 || directions.length != stakes.length) revert EmptySchedule();

        planId = planCount++;
        uint96 total;
        for (uint256 i; i < stakes.length; ++i) {
            total += stakes[i];
            _legs[planId].push(
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

        schedules[planId] = Schedule({
            owner: msg.sender,
            seriesId: p.seriesId,
            cursor: 0,
            live: true,
            unspent: total,
            openDelay: p.openDelay,
            minHeadroom: p.minHeadroom,
            marketCreator: p.marketCreator,
            rollTopic: p.rollTopic,
            pendingMarketId: bytes32(0)
        });

        bytes32 key = _seriesKey(p.marketCreator, p.seriesId);
        plansBySeries[key].push(planId);
        emit PlanCommitted(planId, msg.sender, p.seriesId, total, directions.length);

        if (seriesSubscription[key] == 0) _subscribeSeries(key, p, p.gasLimit);
        _openLeg(planId, 0, p.marketId, p.gasLimit);
    }

    function _seriesKey(address creator, uint32 seriesId) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(creator, seriesId));
    }

    /// @dev Pins `emitter` to the venue's MarketCreator. That pin is also the
    ///      recursion guard — our own events come from `address(this)` and can never
    ///      match. Do not wildcard it.
    function _subscribeSeries(bytes32 key, CommitParams calldata p, uint64 gasLimit) private {
        SomniaExtensions.SubscriptionFilter memory filter = SomniaExtensions.SubscriptionFilter({
            eventTopics: [p.rollTopic, bytes32(uint256(p.seriesId)), bytes32(0), bytes32(0)],
            origin: address(0),
            emitter: p.marketCreator
        });
        uint256 id = _doSubscribe(filter, _opts(gasLimit));
        seriesSubscription[key] = id;
        seriesGasLimit[key] = gasLimit;
        emit SubscriptionOpened(id, p.marketCreator, p.seriesId);
    }

    function _opts(uint64 gasLimit) private pure returns (SomniaExtensions.SubscriptionOptions memory) {
        return SomniaExtensions.SubscriptionOptions({priorityFeePerGas: 0, maxFeePerGas: 20 gwei, gasLimit: gasLimit});
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Precompile seam
    //
    // These two wrappers exist ONLY so the lifecycle can be unit-tested. The Somnia
    // reactivity precompile lives at the fixed address 0x0100, which a local EVM
    // reserves: `hardhat_setCode` there is silently ignored, the call returns empty,
    // and decoding that empty return reverts. So a local test can never reach
    // `commitPlan` unless subscription creation is overridable.
    //
    // Production behaviour is unchanged — both simply forward to SomniaExtensions.
    // Nothing overrides them outside `contracts/test`.
    // ─────────────────────────────────────────────────────────────────────────

    function _doSubscribe(
        SomniaExtensions.SubscriptionFilter memory filter,
        SomniaExtensions.SubscriptionOptions memory options
    ) internal virtual returns (uint256) {
        return SomniaExtensions.subscribe(address(this), filter, options);
    }

    function _doSchedule(uint256 firesAtMillis, SomniaExtensions.SubscriptionOptions memory options)
        internal
        virtual
        returns (uint256)
    {
        return SomniaExtensions.scheduleSubscriptionAtTimestamp(address(this), firesAtMillis, options);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The handler
    // ─────────────────────────────────────────────────────────────────────────

    function _onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata) internal override {
        if (emitter == SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS) {
            _onScheduledOpen(eventTopics);
        } else {
            _onRoll(emitter, eventTopics);
        }
    }

    /// @dev A Window closed and its successor exists. One event is both the
    ///      settlement signal for Leg N and the discovery of Leg N+1's market.
    function _onRoll(address emitter, bytes32[] calldata eventTopics) private {
        if (eventTopics.length < 3) return;
        uint32 seriesId = uint32(uint256(eventTopics[1]));
        bytes32 key = _seriesKey(emitter, seriesId);
        uint256[] storage ids = plansBySeries[key];

        uint64 gasLimit = seriesGasLimit[key];
        uint256 n = ids.length > MAX_PLANS_PER_FIRE ? MAX_PLANS_PER_FIRE : ids.length;

        for (uint256 i; i < n; ++i) {
            uint256 planId = ids[i];
            Schedule storage s = schedules[planId];
            if (s.rollTopic != eventTopics[0]) {
                emit LegSkipped(planId, s.cursor, Reason.WrongTopic);
                continue;
            }
            _advance(planId, s, eventTopics[2], gasLimit);
        }

        if (_pendingOpens.length > 0) {
            uint256 firesAt = (block.timestamp + schedules[_pendingOpens[0]].openDelay) * 1000 + 1;
            _doSchedule(firesAt, _opts(gasLimit));
            emit OpenScheduled(_pendingOpens.length, seriesId, eventTopics[2], firesAt);
        }
    }

    function _advance(uint256 planId, Schedule storage s, bytes32 newMarketId, uint64 /*gasLimit*/ ) private {
        uint32 cursor = s.cursor;

        // 1. Redeem and forward the Leg whose Window just ended. Resolution lands in
        //    a different transaction from the roll, so a deferral is normal — the
        //    permissionless `redeemSettled` closes it out either way.
        if (cursor > 0 && _legs[planId][cursor - 1].state == LegState.Open) {
            // External self-call so a reverting redeem rolls back ONLY this Plan's
            // state. Inline, one bad market would revert the whole handler and stall
            // every Plan sharing the subscription — and a reverting handler does not
            // remove the subscription, it just burns gas on every fire.
            try this.redeemFromHandler(planId, cursor - 1) returns (bool ok) {
                if (!ok) emit LegSkipped(planId, cursor - 1, Reason.PredecessorUnresolved);
            } catch {
                emit LegSkipped(planId, cursor - 1, Reason.OrderRejected);
            }
        }

        if (!s.live) {
            emit LegSkipped(planId, cursor, Reason.PlanNotLive);
            return;
        }
        if (cursor >= _legs[planId].length) {
            s.live = false;
            emit PlanCompleted(planId);
            _maybeCloseSeries(s.marketCreator, s.seriesId);
            return;
        }

        // 2. Queue the delayed open. One shared one-shot is armed for the whole
        //    roll by the caller, not one per Plan — see `_pendingOpens`.
        s.pendingMarketId = newMarketId;
        _pendingOpens.push(planId);
    }

    /// @dev The delayed open. The one-shot that brought us here is auto-removed by
    ///      the protocol as it fires, so there is nothing to clean up.
    /// @dev The delayed open, now that the book has had time to form. Drains every
    ///      Plan armed by the last roll. The one-shot that brought us here is
    ///      auto-removed by the protocol as it fires.
    function _onScheduledOpen(bytes32[] calldata eventTopics) private {
        if (eventTopics.length < 1 || eventTopics[0] != SCHEDULE_TOPIC) {
            emit LegSkipped(0, 0, Reason.WrongTopic);
            return;
        }
        uint256 n = _pendingOpens.length;
        if (n == 0) {
            // A second one-shot from the same roll, already drained. Harmless.
            emit LegSkipped(0, 0, Reason.NothingPending);
            return;
        }
        if (n > MAX_PLANS_PER_FIRE) n = MAX_PLANS_PER_FIRE;

        for (uint256 k; k < n; ++k) {
            uint256 planId = _pendingOpens[_pendingOpens.length - 1];
            _pendingOpens.pop();

            Schedule storage s = schedules[planId];
            uint32 cursor = s.cursor;
            if (!s.live) {
                emit LegSkipped(planId, cursor, Reason.PlanNotLive);
                continue;
            }
            if (cursor >= _legs[planId].length) {
                emit LegSkipped(planId, cursor, Reason.PlanComplete);
                continue;
            }
            bytes32 marketId = s.pendingMarketId;
            if (marketId == bytes32(0)) {
                emit LegSkipped(planId, cursor, Reason.NothingPending);
                continue;
            }
            s.pendingMarketId = bytes32(0);
            _openLeg(planId, cursor, marketId, 0);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Opening a Leg
    // ─────────────────────────────────────────────────────────────────────────

    function _openLeg(uint256 planId, uint32 legIndex, bytes32 marketId, uint64) private {
        Schedule storage s = schedules[planId];
        Leg storage leg = _legs[planId][legIndex];

        (,,,,,,,, address market, address pool,,,, uint64 expiry) = MODULE.markets(marketId);

        if (IBinaryMarket(market).status() != STATUS_TRADING) {
            return _skip(planId, legIndex, Reason.MarketNotTrading);
        }
        if (expiry < block.timestamp + s.minHeadroom) {
            return _skip(planId, legIndex, Reason.WindowTooShort);
        }

        IBinaryPool.BookParams memory bp = IBinaryPool(pool).getOrderBookParameters();
        bool up = leg.direction == Dir.Up;

        // BUY_YES lifts the best ask; BUY_NO meets a resting Buy YES (mint-a-pair) so
        // it works down from the best bid. `price` is the YES-side price in both.
        IBinaryPool.Level[] memory levels = IBinaryPool(pool).getBookLevels(!up, 1);
        if (levels.length == 0 || levels[0].price == 0) {
            return _skip(planId, legIndex, Reason.NoLiquidity);
        }

        uint256 touch = levels[0].price;
        uint256 cushion = bp.tickSize * CROSS_CUSHION_TICKS;
        uint256 price = up ? touch + cushion : (touch > cushion ? touch - cushion : bp.tickSize);
        price = (price / bp.tickSize) * bp.tickSize;
        if (price == 0) price = bp.tickSize;
        if (price >= ONE) price = ONE - bp.tickSize;

        uint256 unit = up ? price : ONE - price;
        uint256 qty = (uint256(leg.stake) * ONE) / unit;
        qty = (qty / bp.lotSize) * bp.lotSize;
        if (qty == 0 || qty < bp.minQuantity) {
            return _skip(planId, legIndex, Reason.StakeTooSmall);
        }

        uint64 expNs = uint64(expiry) * 1e9;

        if (dryRun) {
            emit LegIntent(planId, legIndex, marketId, pool, up ? KIND_BUY_YES : KIND_BUY_NO, price, qty, expNs);
            emit LegSkipped(planId, legIndex, Reason.DryRun);
            return; // cursor deliberately NOT advanced
        }

        if (!poolApproved[pool]) {
            COLLATERAL.approve(pool, type(uint256).max);
            poolApproved[pool] = true;
        }

        (,,,,,,,,,, uint256 yesId, uint256 noId,,) = MODULE.markets(marketId);
        uint256 tokenId = up ? yesId : noId;
        uint256 beforeTok = OUTCOME.balanceOf(address(this), tokenId);
        uint256 beforeCol = COLLATERAL.balanceOf(address(this));

        try IBinaryPool(pool).placeBinaryOrder(
            up ? KIND_BUY_YES : KIND_BUY_NO, price, qty, expNs, ORDER_TYPE_IOC, 0, address(0), 0, 0
        ) returns (bool, uint128) {
            uint256 got = OUTCOME.balanceOf(address(this), tokenId) - beforeTok;
            if (got == 0) return _skip(planId, legIndex, Reason.NoLiquidity);

            // The ACTUAL fill price: what we were charged, divided by what we got.
            // A taker pays the resting price, not the limit it offered.
            uint256 spent = beforeCol - COLLATERAL.balanceOf(address(this));
            uint256 fill = (spent * ONE) / got;

            leg.state = LegState.Open;
            leg.marketId = marketId;
            leg.entryPrice = uint32(fill);
            leg.filled = uint128(got);
            s.unspent -= leg.stake;
            s.cursor = legIndex + 1;
            emit LegOpened(planId, legIndex, marketId, fill, got);
        } catch {
            return _skip(planId, legIndex, Reason.OrderRejected);
        }
    }

    function _skip(uint256 planId, uint32 legIndex, Reason r) private {
        Leg storage leg = _legs[planId][legIndex];
        // A dry run changes nothing; every other skip consumes the Leg.
        leg.state = LegState.Skipped;
        schedules[planId].cursor = legIndex + 1;
        emit LegSkipped(planId, legIndex, r);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Settlement and payout
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Redeem a settled Leg and forward proceeds to that Plan's owner.
    /// @dev    PERMISSIONLESS — anyone may trigger it, only the owner can receive.
    ///         Works on a cancelled, completed or stalled Plan.
    function redeemSettled(uint256 planId, uint32 legIndex) external {
        if (_legs[planId][legIndex].state != LegState.Open) revert LegNotOpen();
        if (!_tryRedeem(planId, legIndex)) revert NotResolvedYet();
    }

    /// @notice Self-call entry point so the handler can isolate one Plan's redeem
    ///         failure. Not callable by anyone else.
    function redeemFromHandler(uint256 planId, uint32 legIndex) external returns (bool) {
        if (msg.sender != address(this)) revert NotOwner();
        return _tryRedeem(planId, legIndex);
    }

    function _tryRedeem(uint256 planId, uint32 legIndex) private returns (bool) {
        Leg storage leg = _legs[planId][legIndex];
        (,,,,, bytes32 venueId,,, address market,, uint256 yesId, uint256 noId,,) = MODULE.markets(leg.marketId);

        if (!IBinaryMarket(market).isResolved() && !IBinaryMarket(market).isVoided()) return false;

        // Redeem the side we hold. A loser redeems successfully and pays zero; a
        // voided market pays 0.5 per contract on each side.
        uint256 tokenId = leg.direction == Dir.Up ? yesId : noId;
        uint8 outcomeIdx = leg.direction == Dir.Up ? 0 : 1;
        uint256 held = OUTCOME.balanceOf(address(this), tokenId);

        uint256 beforeCol = COLLATERAL.balanceOf(address(this));
        if (held > 0) MODULE.redeem(0, venueId, leg.marketId, outcomeIdx, held);
        uint256 proceeds = COLLATERAL.balanceOf(address(this)) - beforeCol;

        leg.state = LegState.Settled;
        if (proceeds > 0) COLLATERAL.transfer(schedules[planId].owner, proceeds);
        emit LegSettled(planId, legIndex, leg.marketId, held, proceeds);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Exits
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Stop future Legs and return the undeployed stake.
    /// @dev    Must work when the chain is STALLED — no successor, gas shortfall,
    ///         reverting handler — which is exactly when the owner most needs it.
    ///         Nothing here depends on the handler. Settled Legs are untouched;
    ///         still-open Legs stay redeemable via `redeemSettled`.
    function cancelPlan(uint256 planId) external {
        Schedule storage s = schedules[planId];
        if (s.owner == address(0)) revert NoPlan();
        if (msg.sender != s.owner && msg.sender != owner) revert NotOwner();

        s.live = false;
        uint96 refund = s.unspent;
        s.unspent = 0;
        if (refund > 0) COLLATERAL.transfer(s.owner, refund);
        emit PlanCancelled(planId, refund);
        _maybeCloseSeries(s.marketCreator, s.seriesId);
    }

    /// @dev Drop the shared series subscription once no Plan on it is still live.
    function _maybeCloseSeries(address creator, uint32 seriesId) private {
        bytes32 key = _seriesKey(creator, seriesId);
        uint256 id = seriesSubscription[key];
        if (id == 0) return;
        uint256[] storage ids = plansBySeries[key];
        for (uint256 i; i < ids.length; ++i) {
            if (schedules[ids[i]].live) return;
        }
        seriesSubscription[key] = 0;
        // Best-effort: the protocol auto-removes subscriptions whose owner cannot
        // cover gasLimit, so a typed call would turn "already gone" into "cannot
        // cancel" and strand the refund path.
        (bool ok,) = SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS.call(
            abi.encodeWithSignature("unsubscribe(uint256)", id)
        );
        ok;
        emit SubscriptionClosed(id);
    }

    /// @notice Re-create a series subscription the protocol removed underneath us.
    /// @dev    A subscription is auto-removed when the owner cannot cover
    ///         `gasLimit x price` at fire time. Our `seriesSubscription` entry then
    ///         still holds the dead id, so no later commit would ever re-subscribe
    ///         and every Plan on that series stalls silently. Fund the contract,
    ///         then call this. Verify with `somnia_reactivityGetSubscriptions` first.
    function resubscribeSeries(address marketCreator, bytes32 rollTopic, uint32 seriesId, uint64 gasLimit)
        external
        onlyOwner
    {
        bytes32 key = _seriesKey(marketCreator, seriesId);
        SomniaExtensions.SubscriptionFilter memory filter = SomniaExtensions.SubscriptionFilter({
            eventTopics: [rollTopic, bytes32(uint256(seriesId)), bytes32(0), bytes32(0)],
            origin: address(0),
            emitter: marketCreator
        });
        uint256 id = _doSubscribe(filter, _opts(gasLimit));
        seriesSubscription[key] = id;
        seriesGasLimit[key] = gasLimit;
        emit SubscriptionOpened(id, marketCreator, seriesId);
    }

    function withdrawNative(uint256 amount) external onlyOwner {
        uint256 bal = address(this).balance;
        uint256 amt = amount == 0 ? bal : amount;
        if (amt == 0 || amt > bal) revert NothingToSweep();
        (bool ok,) = payable(owner).call{value: amt}("");
        require(ok, "native transfer failed");
        emit Swept(address(0), amt);
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 amt = amount == 0 ? bal : amount;
        if (amt == 0 || amt > bal) revert NothingToSweep();
        IERC20(token).transfer(owner, amt);
        emit Swept(token, amt);
    }

    function setDryRun(bool on) external onlyOwner {
        dryRun = on;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function legCount(uint256 planId) external view returns (uint256) {
        return _legs[planId].length;
    }

    function getLeg(uint256 planId, uint32 i) external view returns (Leg memory) {
        return _legs[planId][i];
    }

    function seriesPlans(address creator, uint32 seriesId) external view returns (uint256[] memory) {
        return plansBySeries[_seriesKey(creator, seriesId)];
    }
}
