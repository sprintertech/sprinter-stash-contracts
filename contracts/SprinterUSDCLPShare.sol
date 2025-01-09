// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ManagedToken} from "./ManagedToken.sol";

contract SprinterUSDCLPShare is ManagedToken {
    constructor(address manager)
        ManagedToken("Sprinter USDC LP Share", "sprUSDC-LP", manager)
    {}
}
