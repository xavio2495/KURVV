// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.30;

import {PlanBook} from "../PlanBook.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

/// @notice Test doubles for the dreamDEX surfaces and the Somnia reactivity
///         precompile. Only what PlanBook actually calls.
///
/// @dev The precompile is the reason these exist. Somnia's reactivity precompile at
///      0x0100 does not exist on a Hardhat chain, so `SomniaExtensions.subscribe`
///      reverts and `commitPlan` can never be reached. The suite deploys
///      `MockPrecompile` and copies its runtime code to 0x0100 with
///      `hardhat_setCode`, which is the only way to unit-test the lifecycle locally.

contract MockERC20 {
    string public name = "Test USDC";
    string public symbol = "tUSDC";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

contract MockOutcome6909 {
    mapping(address => mapping(uint256 => uint256)) public balanceOf;
    mapping(address => mapping(address => bool)) public isOperator;

    function setOperator(address s, bool ok) external returns (bool) { isOperator[msg.sender][s] = ok; return true; }
    function mint(address to, uint256 id, uint256 a) external { balanceOf[to][id] += a; }
    function burn(address from, uint256 id, uint256 a) external { balanceOf[from][id] -= a; }
}

contract MockBinaryMarket {
    uint8 public status = 1;            // 1 = Trading
    bool public isResolved;
    bool public isVoided;
    uint256[] private _payout;

    function setStatus(uint8 s) external { status = s; }
    function resolve(uint256 upNum, uint256 downNum) external {
        isResolved = true; delete _payout; _payout.push(upNum); _payout.push(downNum);
    }
    function payoutNumerators() external view returns (uint256[] memory) { return _payout; }
}

contract MockBinaryPool {
    struct BookParams { uint256 tickSize; uint256 minQuantity; uint256 lotSize; }
    struct Level { uint256 price; uint256 quantity; }

    MockERC20 public collateral;
    MockOutcome6909 public outcome;
    uint256 public yesId;
    uint256 public noId;
    uint256 public ask = 500_000;       // 0.50
    uint256 public bid = 480_000;
    bool public emptyBook;

    constructor(MockERC20 c, MockOutcome6909 o, uint256 y, uint256 n) {
        collateral = c; outcome = o; yesId = y; noId = n;
    }
    function setBook(uint256 a, uint256 b) external { ask = a; bid = b; }
    function setEmpty(bool e) external { emptyBook = e; }

    function getOrderBookParameters() external pure returns (BookParams memory) {
        return BookParams({tickSize: 1000, minQuantity: 1000, lotSize: 1000});
    }
    function getBookLevels(bool isBid, uint64) external view returns (Level[] memory out) {
        if (emptyBook) return new Level[](0);
        out = new Level[](1);
        out[0] = Level({price: isBid ? bid : ask, quantity: 500_000_000});
    }

    /// @dev Fills fully at the limit price: pulls collateral, credits outcome tokens.
    function placeBinaryOrder(
        uint8 kind, uint256 price, uint256 quantity, uint64, uint8, uint8, address, uint96, uint64
    ) external payable returns (bool, uint128) {
        bool up = kind == 0;
        uint256 unit = up ? price : 1e6 - price;
        uint256 cost = (quantity * unit) / 1e6;
        collateral.transferFrom(msg.sender, address(this), cost);
        outcome.mint(msg.sender, up ? yesId : noId, quantity);
        return (true, 1);
    }
}

contract MockModule {
    struct Rec {
        address market; address pool; uint256 yesId; uint256 noId;
        uint64 tradingStart; uint64 expiry; bytes32 venueId; address collateral;
    }
    mapping(bytes32 => Rec) public recs;
    MockOutcome6909 public outcome;
    MockERC20 public collateralToken;

    constructor(MockOutcome6909 o, MockERC20 c) { outcome = o; collateralToken = c; }

    function register(bytes32 id, Rec calldata r) external { recs[id] = r; }

    function markets(bytes32 id)
        external view
        returns (uint256, uint8, uint8, address, uint32, bytes32, address, address, address, address, uint256, uint256, uint64, uint64)
    {
        Rec memory r = recs[id];
        return (0, 2, 0, r.collateral, 0, r.venueId, address(0), address(0), r.market, r.pool, r.yesId, r.noId, r.tradingStart, r.expiry);
    }

    /// @dev Burns the caller's winning tokens and pays 1 collateral unit each.
    function redeem(uint32, bytes32, bytes32 marketId, uint8 outcomeIdx, uint256 amount) external {
        Rec memory r = recs[marketId];
        uint256 id = outcomeIdx == 0 ? r.yesId : r.noId;
        outcome.burn(msg.sender, id, amount);
        uint256[] memory p = MockBinaryMarket(r.market).payoutNumerators();
        uint256 num = p.length > outcomeIdx ? p[outcomeIdx] : 0;
        if (num > 0) collateralToken.mint(msg.sender, amount);
    }
}

/// @notice Stands in for the reactivity precompile at 0x0100.
contract MockPrecompile {
    uint256 public nextId = 1000;
    mapping(uint256 => bool) public alive;

    struct SubscriptionData {
        bytes32[4] eventTopics;
        address origin;
        address caller;
        address emitter;
        address handlerContractAddress;
        bytes4 handlerFunctionSelector;
        uint64 priorityFeePerGas;
        uint64 maxFeePerGas;
        uint64 gasLimit;
        bool isGuaranteed;
        bool isCoalesced;
    }

    function subscribe(SubscriptionData calldata) external returns (uint256) {
        alive[++nextId] = true;
        return nextId;
    }

    function unsubscribe(uint256 id) external { alive[id] = false; }
}

/// @notice PlanBook with the precompile seam stubbed. See PlanBook's "Precompile seam"
///         comment: 0x0100 is reserved on a local EVM, so subscription creation cannot
///         be exercised any other way. Nothing else is changed.
contract PlanBookHarness is PlanBook {
    uint256 public subs;
    uint256 public lastScheduledMs;

    constructor(address m, address o, address c) payable PlanBook(m, o, c) {}

    function _doSubscribe(
        SomniaExtensions.SubscriptionFilter memory,
        SomniaExtensions.SubscriptionOptions memory
    ) internal override returns (uint256) { return ++subs; }

    function _doSchedule(uint256 firesAtMillis, SomniaExtensions.SubscriptionOptions memory)
        internal override returns (uint256) { lastScheduledMs = firesAtMillis; return ++subs; }
}
