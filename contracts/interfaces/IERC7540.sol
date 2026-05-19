// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @dev Minimal interface for ERC-7540 asynchronous redemption (requestRedeem and claim).
interface IERC7540 is IERC4626 {
    function requestRedeem(uint256 shares, address controller, address owner) external returns (uint256 requestId);
}