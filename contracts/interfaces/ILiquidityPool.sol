// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

interface ILiquidityPool {
    function deposit() external;

    function withdraw(address to, uint256 amount) external;
}
