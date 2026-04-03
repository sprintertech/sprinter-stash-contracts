// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {AdapterHelper} from "./AdapterHelper.sol";

/// @notice Shared LayerZero endpoint ID mapping used by adapters that send messages via LayerZero v2.
abstract contract LayerZeroHelper is AdapterHelper {
    function layerZeroEndpointId(Domain destinationDomain) public pure virtual returns (uint32) {
        if (destinationDomain == Domain.ETHEREUM) {
            return 30101;
        } else
        if (destinationDomain == Domain.AVALANCHE) {
            return 30106;
        } else
        if (destinationDomain == Domain.OP_MAINNET) {
            return 30111;
        } else
        if (destinationDomain == Domain.ARBITRUM_ONE) {
            return 30110;
        } else
        if (destinationDomain == Domain.BASE) {
            return 30184;
        } else
        if (destinationDomain == Domain.POLYGON_MAINNET) {
            return 30109;
        } else
        if (destinationDomain == Domain.UNICHAIN) {
            return 30320;
        } else
        if (destinationDomain == Domain.BSC) {
            return 30102;
        } else
        if (destinationDomain == Domain.LINEA) {
            return 30183;
        } else
        if (destinationDomain == Domain.GNOSIS_CHAIN) {
            return 30145;
        } else {
            revert UnsupportedDomain();
        }
    }
}
