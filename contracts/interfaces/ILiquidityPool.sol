// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

interface ILiquidityPool {
    function deposit(uint256 amount) external;

    function withdraw(address to, uint256 amount) external returns (uint256 withdrawn);

    function ASSETS() external returns (IERC20);
}
