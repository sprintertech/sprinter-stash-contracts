// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {IRoute} from ".././interfaces/IRoute.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
        mapping(bytes32 outputToken => BitMaps.BitMap destinationDomains) storage outputTokens
    ) internal view {
        require(outputTokens[outputToken].get(uint256(destinationDomain)), InvalidOutputToken());
    }

    IERC20 private constant USDC_BSC = IERC20(0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d);
    IERC20 private constant WBTC_BSC = IERC20(0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c);
    IERC20 private constant USDT_BSC = IERC20(0x55d398326f99059fF775485246999027B3197955);

    // Only supports BSC origin for now as BSC doesn't have any pools deployed.
    function _destAmountToLocal(
        uint256 destAmount,
        IERC20 localToken,
        Domain localDomain
    ) internal pure returns (uint256) {
        if (localDomain == Domain.BSC) {
            if (localToken == USDC_BSC || localToken == USDT_BSC) {
                return destAmount * 10 ** (18 - 6);
            } else
            if (localToken == WBTC_BSC) {
                return destAmount * 10 ** (18 - 8);
            }
            // Add other tokens here when supported.
        }
        return destAmount;
    }
}
