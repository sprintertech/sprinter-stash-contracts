// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IProcessor {
    function TARGET_ASSET() external view returns (IERC20);
    function forwardAmount(IERC20 token, uint256 amount) external;
}
