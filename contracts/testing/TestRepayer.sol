// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Repayer, IERC20} from "../Repayer.sol";

contract TestRepayer is Repayer {
    constructor(
        Domain localDomain,
        IERC20 assets,
        address cctpTokenMessenger,
        address cctpMessageTransmitter,
        address acrossSpokePool,
        address everclearFeeAdapter,
        address wrappedNativeToken,
        address stargateTreasurer,
        address optimismBridge,
        address baseBridge,
        address arbitrumGatewayRouter
    ) Repayer(
        localDomain,
        assets,
        cctpTokenMessenger,
        cctpMessageTransmitter,
        acrossSpokePool,
        everclearFeeAdapter,
        wrappedNativeToken,
        stargateTreasurer,
        optimismBridge,
        baseBridge,
        arbitrumGatewayRouter
    ) {}

    function domainCCTP(Domain destinationDomain) public pure override returns (uint32) {
        if (destinationDomain == Domain.ETHEREUM_SEPOLIA) {
            return 0;
        } else
        if (destinationDomain == Domain.AVALANCHE_FUJI) {
            return 1;
        } else
        if (destinationDomain == Domain.OP_SEPOLIA) {
            return 2;
        } else
        if (destinationDomain == Domain.ARBITRUM_SEPOLIA) {
            return 3;
        } else
        if (destinationDomain == Domain.BASE_SEPOLIA) {
            return 6;
        } else
        if (destinationDomain == Domain.POLYGON_AMOY) {
            return 7;
        } else {
            revert UnsupportedDomain();
        }
    }

    function domainChainId(Domain destinationDomain) public pure override returns (uint32) {
        if (destinationDomain == Domain.ETHEREUM_SEPOLIA) {
            return 11155111;
        } else
        if (destinationDomain == Domain.AVALANCHE_FUJI) {
            return 43113;
        } else
        if (destinationDomain == Domain.OP_SEPOLIA) {
            return 11155420;
        } else
        if (destinationDomain == Domain.ARBITRUM_SEPOLIA) {
            return 421614;
        } else
        if (destinationDomain == Domain.BASE_SEPOLIA) {
            return 84532;
        } else
        if (destinationDomain == Domain.POLYGON_AMOY) {
            return 80002;
        } else {
            revert UnsupportedDomain();
        }
    }
}
