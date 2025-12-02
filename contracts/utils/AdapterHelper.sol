// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {IRoute} from ".././interfaces/IRoute.sol";

abstract contract AdapterHelper is IRoute {
    using BitMaps for BitMaps.BitMap;

    error SlippageTooHigh();
    error NotPayable();
    error InvalidOutputToken();

    modifier notPayable() {
        require(msg.value == 0, NotPayable());
        _;
    }

    function domainChainId(Domain destinationDomain) public pure virtual returns (uint32) {
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
        } else
        if (destinationDomain == Domain.UNICHAIN) {
            return 130;
        } else
        if (destinationDomain == Domain.BSC) {
            return 56;
        } else
        if (destinationDomain == Domain.LINEA) {
            return 59144;
        } else {
            revert UnsupportedDomain();
        }
    }

    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    function _validateOutputToken(
        bytes32 outputToken,
        Domain destinationDomain,
        mapping(bytes32 outputToken => BitMaps.BitMap destinationDomains) storage outputTokens
    ) internal view {
        require(outputTokens[outputToken].get(uint256(destinationDomain)), InvalidOutputToken());
    }
}
