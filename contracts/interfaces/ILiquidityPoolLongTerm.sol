// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ILiquidityPool} from "./ILiquidityPool.sol";

interface ILiquidityPoolLongTerm is ILiquidityPool {
    function borrowLongTerm(address borrowToken, uint256 amount) external;
    function repayPartial(address[] calldata borrowTokens, uint256[] calldata amounts) external;
}
