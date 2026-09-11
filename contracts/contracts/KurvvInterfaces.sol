// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice Minimal slices of the dreamDEX surfaces KURVV touches. Only the
///         functions we call — the full ABIs ship with the markets SDK.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @notice Outcome positions are ids on one shared ERC-6909 singleton, not
///         per-market ERC-20s.
interface IOutcomeToken6909 {
    function balanceOf(address owner, uint256 id) external view returns (uint256);
    function setOperator(address spender, bool approved) external returns (bool);
}

interface IBinaryMarketsModule {
    /// @dev Wide value-type record. `market` and `pool` rotate per Window — read,
    ///      never store beyond the Leg that used them.
    function markets(bytes32 marketId)
        external
        view
        returns (
            uint256 oracleQuestionId,
            uint8 outcomeSlotCount,
            uint8 voidPolicy,
            address collateral,
            uint32 originOperatorId,
            bytes32 originVenueId,
            address oracleAdapter,
            address creator,
            address market,
            address pool,
            uint256 yesId,
            uint256 noId,
            uint64 tradingStart,
            uint64 expiry
        );

    /// @dev Pulls the CALLER's winning outcome tokens and pays collateral back to
    ///      the caller. `(operatorId, venueId)` are attribution-only and may be 0.
    function redeem(
        uint32 operatorId,
        bytes32 venueId,
        bytes32 marketId,
        uint8 outcomeIdx,
        uint256 amount
    ) external;
}

interface IBinaryMarket {
    function isResolved() external view returns (bool);
    function isVoided() external view returns (bool);
    /// @dev Listed 0 · Trading 1 · Locked 2 · Resolved 4 · Voided 5.
    function status() external view returns (uint8);
}

interface IBinaryPool {
    struct BookParams {
        uint256 tickSize;
        uint256 minQuantity;
        uint256 lotSize;
    }
    struct Level {
        uint256 price;
        uint256 quantity;
    }

    /// @dev `kind` 0 BUY_YES · 1 SELL_YES · 2 BUY_NO · 3 SELL_NO. `price` is ALWAYS
    ///      the YES-side price. `orderType` 2 is ImmediateOrCancel.
    function placeBinaryOrder(
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k,
        uint64 userData
    ) external payable returns (bool success, uint128 id);

    function getOrderBookParameters() external view returns (BookParams memory);
    function getBookLevels(bool isBid, uint64 numLevels) external view returns (Level[] memory);
}

/// @notice The venue's rolling-window scheduler. Permanent address; the series
///         registry is what makes a Window addressable as a constant `seriesId`.
interface IMarketCreator {
    function seriesById(uint32 seriesId)
        external
        view
        returns (
            address collateral,
            string memory asset,
            uint64 numericDecimals,
            uint64 intervalSec,
            uint64 settlementWindow
        );
    function latestExpiryBySeriesId(uint32 seriesId) external view returns (uint64 expiry);
}
