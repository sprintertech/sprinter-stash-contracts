// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

interface IManagedToken {
    function MANAGER() external view returns (address);

    function mint(address to, uint256 amount) external;

    function burn(address from, uint256 amount) external;

    function spendAllowance(address owner, address spender, uint256 value) external;
}
