// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IManagedToken} from "./IManagedToken.sol";

interface ILiquidityHub {
    function SHARES() external view returns (IManagedToken);
    function setAssetsLimit(uint256 newAssetsLimit) external;
}
