// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ManagedToken} from "./ManagedToken.sol";

/// @title An ERC20 token that represents shares in the Sprinter USDC liquidity reserves.
/// Meant to be managed by LiquidityHub.
/// @author Oleksii Matiiasevych <oleksii@chainsafe.io>
contract SprinterUSDCLPShare is ManagedToken {
    constructor(address manager)
        ManagedToken("Sprinter USDC LP Share", "sprUSDC-LP", manager)
    {}
}
