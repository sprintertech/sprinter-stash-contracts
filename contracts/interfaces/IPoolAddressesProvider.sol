// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

/**
 * @title PoolAddressesProvider
 * @author Aave
 * @notice Main registry of addresses part of or connected to the protocol, including permissioned roles
 * @dev Acts as factory of proxies and admin of those, so with right to change its implementations
 * @dev Owned by the Aave Governance
 */
interface IPoolAddressesProvider {
  function getPool() external view returns (address);
  function getPriceOracle() external view returns (address);
}