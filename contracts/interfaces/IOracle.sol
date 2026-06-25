// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

/// @title Price oracle interface.
/// @author Oleksii Matiiasevych <oleksii@sprinter.tech>
interface IOracle {
    function getAssetValue(bytes32 assetId, uint256 amount) external view returns (uint256);
}
