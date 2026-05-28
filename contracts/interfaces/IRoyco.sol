// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

/// @dev Minimal interface for Royco vault asynchronous redemption.
interface IRoyco {
    function claimWithdrawal(uint256[] calldata epochIDs) external;
    function cancelRequest(uint256 epochID) external;
}