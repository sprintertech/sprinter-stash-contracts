// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

interface ILiquidityPoolBase {
    function deposit(uint256 amount) external;

    function depositWithPull(uint256 amount) external;

    function withdraw(address to, uint256 amount) external;

    function withdrawProfit(
        address[] calldata tokens,
        address to
    ) external;

    function paused() external view returns (bool);

    function pause() external;

    function unpause() external;

    function ASSETS() external returns (IERC20);
}
