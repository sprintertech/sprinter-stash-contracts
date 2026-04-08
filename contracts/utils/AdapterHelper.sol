// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {IRoute} from "../interfaces/IRoute.sol";

struct InputOutputTokenData {
    BitMaps.BitMap destinationDomains;
    mapping(IRoute.Domain destinationDomain => int8) localDecimalsGreaterBy;
}

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
        } else
        if (destinationDomain == Domain.GNOSIS_CHAIN) {
            return 100;
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
        mapping(bytes32 outputToken => InputOutputTokenData) storage outputTokens
    ) internal view {
        require(outputTokens[outputToken].destinationDomains.get(uint256(destinationDomain)), InvalidOutputToken());
    }

    function _validateOutputToken(
        address outputToken,
        Domain destinationDomain,
        mapping(bytes32 outputToken => InputOutputTokenData) storage outputTokens
    ) internal view {
        _validateOutputToken(_addressToBytes32(outputToken), destinationDomain, outputTokens);
    }

    function _outputAmountToLocal(
        uint256 outputAmount,
        bytes32 outputToken,
        Domain destinationDomain,
        mapping(bytes32 outputToken => InputOutputTokenData) storage outputTokens
    ) internal view returns (uint256) {
        int8 localDecimalsGreaterBy = outputTokens[outputToken].localDecimalsGreaterBy[destinationDomain];
        if (localDecimalsGreaterBy == 0) {
            return outputAmount;
        }
        if (localDecimalsGreaterBy > 0) {
            return outputAmount * 10 ** uint256(uint8(localDecimalsGreaterBy));
        }
        return outputAmount / 10 ** uint256(uint8(-localDecimalsGreaterBy));
    }

    function _outputAmountToLocal(
        uint256 outputAmount,
        address outputToken,
        Domain destinationDomain,
        mapping(bytes32 outputToken => InputOutputTokenData) storage outputTokens
    ) internal view returns (uint256) {
        return _outputAmountToLocal(outputAmount, _addressToBytes32(outputToken), destinationDomain, outputTokens);
    }

    function _validateOutputAmount(
        uint256 inputAmount,
        uint256 outputAmount
    ) internal pure {
        require(outputAmount >= (inputAmount * 9980 / 10000), SlippageTooHigh());
    }

    function _validateOutputAmount(
        uint256 inputAmount,
        uint256 outputAmount,
        bytes32 outputToken,
        Domain destinationDomain,
        mapping(bytes32 outputToken => InputOutputTokenData) storage outputTokens
    ) internal view {
        _validateOutputAmount(
            inputAmount,
            _outputAmountToLocal(outputAmount, outputToken, destinationDomain, outputTokens)
        );
    }

    function _validateOutputAmount(
        uint256 inputAmount,
        uint256 outputAmount,
        address outputToken,
        Domain destinationDomain,
        mapping(bytes32 outputToken => InputOutputTokenData) storage outputTokens
    ) internal view {
        _validateOutputAmount(
            inputAmount,
            outputAmount,
            _addressToBytes32(outputToken),
            destinationDomain,
            outputTokens
        );
    }
}
