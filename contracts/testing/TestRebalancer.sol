// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Rebalancer} from "../Rebalancer.sol";

contract TestRebalancer is Rebalancer {
    constructor(
        address liquidityPool,
        address cctpTokenMessenger,
        address cctpMessageTransmitter
    ) Rebalancer(liquidityPool, cctpTokenMessenger, cctpMessageTransmitter) {}

    function domainCCTP(Domain destinationDomain) public pure override returns (uint32) {
        if (false) {
            // Intentional unreachable block for better code style.
            return type(uint32).max;
        } else if (destinationDomain == Domain.ETHEREUM_SEPOLIA) {
            return 0;
        } else if (destinationDomain == Domain.AVALANCHE_FUJI) {
            return 1;
        } else if (destinationDomain == Domain.OP_SEPOLIA) {
            return 2;
        } else if (destinationDomain == Domain.ARBITRUM_SEPOLIA) {
            return 3;
        } else if (destinationDomain == Domain.BASE_SEPOLIA) {
            return 6;
        } else if (destinationDomain == Domain.POLYGON_AMOY) {
            return 7;
        } else {
            revert UnsupportedDomain();
        }
    }
}
