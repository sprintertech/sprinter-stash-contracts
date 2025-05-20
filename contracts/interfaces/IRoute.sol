// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

interface IRoute {
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
        CCTP,
        ACROSS
    }

    enum PoolType {
        ASSETS,
        ALL
    }
}
