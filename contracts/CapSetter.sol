// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ILiquidityHub} from "./interfaces/ILiquidityHub.sol";

/// @title Sets assets limit on LiquidityHub contract.
contract CapSetter {
    address immutable public owner;
    ILiquidityHub immutable public liquidityHub;

    error ZeroAddress();
    error Unauthorized();

    constructor(
        address _owner,
        address _liquidityHub
    ) {
        require(_owner != address(0), ZeroAddress());
        require(_liquidityHub != address(0), ZeroAddress());
        owner = _owner;
        liquidityHub = ILiquidityHub(_liquidityHub);
    }

    function setCap(uint256 newCap) external {
        if (msg.sender != owner) revert Unauthorized();
        liquidityHub.setAssetsLimit(newCap);
    }
}
