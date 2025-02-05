// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

interface IRebalancer {
    enum Domain {
        ETHEREUM,
        AVALANCHE,
        OP_CCHAIN,
        ARBITRUM_ONE,
        BASE,
        POLYGON_MAINNET
    }

    enum Provider {
        CCTP
    }

    function initiateRebalance(
        uint256 amount,
        Domain destinationDomain, 
        Provider provider, 
        bytes calldata extraData
    ) external;

    function processRebalance(
        Provider provider, 
        bytes calldata extraData
    ) external;
}
