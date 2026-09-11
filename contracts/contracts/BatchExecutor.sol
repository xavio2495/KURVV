// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.30;

/// @title  BatchExecutor
/// @notice The delegate an EOA points at under EIP-7702 so one signature performs
///         several calls atomically.
///
/// @dev    KURVV uses exactly one batch: `approve(exact)` + `commitPlan(...)`. Those
///         must land together — a Plan must never exist without its first Leg, and an
///         approval must never outlive the commit it was granted for. Splitting them
///         would also break the sign-once claim the product rests on.
///
///         Under 7702 the EOA executes this code with `address(this)` equal to the
///         EOA, so a self-call gives `msg.sender == address(this)`. That single check
///         is the whole authorisation model: only the account itself can drive its
///         own batch. Nothing else can reach `execute`, because for any other caller
///         `msg.sender` is not the delegated account.
contract BatchExecutor {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    error OnlySelf();
    error CallFailed(uint256 index, bytes returndata);

    event BatchExecuted(uint256 count);

    /// @dev MANDATORY, and the reason is not obvious: an EOA delegated here executes
    ///      THIS code for every call it receives, including a plain value transfer.
    ///      Without `receive()` such a transfer finds no matching function, no
    ///      fallback, and reverts — so delegating would silently make the user unable
    ///      to be paid in native currency. We hit exactly that: `withdrawNative` to a
    ///      delegated owner failed with "native transfer failed" until this existed.
    receive() external payable {}

    /// @notice Run every call in order, reverting the whole batch if any one fails.
    function execute(Call[] calldata calls) external payable {
        if (msg.sender != address(this)) revert OnlySelf();
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, ret);
        }
        emit BatchExecuted(calls.length);
    }
}
