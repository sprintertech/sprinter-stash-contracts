// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IRoute} from ".././interfaces/IRoute.sol";

abstract contract BridgeAdapter is IRoute {
    function domainChainId(Domain destinationDomain) public pure virtual returns (uint256) {
        if (destinationDomain == Domain.ETHEREUM) {
            return 1;
        } else
        if (destinationDomain == Domain.AVALANCHE) {
            return 43114;
        } else
        if (destinationDomain == Domain.OP_MAINNET) {
            return 10;
        } else
        if (destinationDomain == Domain.ARBITRUM_ONE) {
            return 42161;
        } else
        if (destinationDomain == Domain.BASE) {
            return 8453;
        } else
        if (destinationDomain == Domain.POLYGON_MAINNET) {
            return 137;
        } else {
            revert UnsupportedDomain();
        }
    }
}
