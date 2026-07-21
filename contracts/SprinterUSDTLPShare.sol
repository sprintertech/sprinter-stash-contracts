// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ManagedToken} from "./ManagedToken.sol";

/// @title An ERC20 token that represents shares in the Sprinter USDT liquidity reserves.
/// Meant to be managed by LiquidityHub.
/// @author Oleksii Matiiasevych <oleksii@sprinter.tech>
contract SprinterUSDTLPShare is ManagedToken {
    constructor(address manager)
        ManagedToken("Sprinter USDT LP Share", "sprUSDT-LP", manager)
    {}
}
