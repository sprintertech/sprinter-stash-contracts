// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

interface IRebalancer {
    // Note, only extend enums at the end to maintain backward compatibility.
    enum Domain {
        ETHEREUM,
        AVALANCHE,
        OP_MAINNET,
        ARBITRUM_ONE,
        BASE,
        POLYGON_MAINNET,
        ETHEREUM_SEPOLIA,
        AVALANCHE_FUJI,
        OP_SEPOLIA,
        ARBITRUM_SEPOLIA,
        BASE_SEPOLIA,
        POLYGON_AMOY
    }

    enum Provider {
        LOCAL,
        CCTP
    }

    function initiateRebalance(
        uint256 amount,
        address sourcePool,
        address destinationPool,
        Domain destinationDomain,
        Provider provider,
        bytes calldata extraData
    ) external;

    function processRebalance(
        address destinationPool,
        Provider provider,
        bytes calldata extraData
    ) external;
}
