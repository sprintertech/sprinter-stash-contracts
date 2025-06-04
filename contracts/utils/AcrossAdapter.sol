// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {V3SpokePoolInterface} from ".././interfaces/IAcross.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRoute} from ".././interfaces/IRoute.sol";
import {AdapterHelper} from "./AdapterHelper.sol";

abstract contract AcrossAdapter is IRoute, AdapterHelper {
    using SafeERC20 for IERC20;

    V3SpokePoolInterface immutable public ACROSS_SPOKE_POOL;

    error SlippageTooHigh();

    constructor(
        address acrossSpokePool
    ) {
        // No check for address(0) to allow deployment on chains where SpokePool is not available
        ACROSS_SPOKE_POOL = V3SpokePoolInterface(acrossSpokePool);
    }

    function initiateTransferAcross(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes calldata extraData
    ) internal {
        require(address(ACROSS_SPOKE_POOL) != address(0), ZeroAddress());
        token.forceApprove(address(ACROSS_SPOKE_POOL), amount);
        (
            address outputToken, // Can be set to 0x0 for automapping by solvers.
            uint256 outputAmount,
            address exclusiveRelayer,
            uint32 quoteTimestamp, // Validated in the spoke pool
            uint32 fillDeadline, // Validated in the spoke pool
            uint32 exclusivityDeadline
        ) = abi.decode(extraData, (address, uint256, address, uint32, uint32, uint32));
        // Note, in case we will start supporting destination tokens with a decimals value different from the source,
        // then we will need to remove this requirement.
        // Until then we leave it here as a protective measure on potential offchain component calculation errors.
        require(outputAmount >= (amount * 9980 / 10000), SlippageTooHigh());
        ACROSS_SPOKE_POOL.depositV3(
            address(this),
            destinationPool,
            address(token),
            outputToken,
            amount,
            outputAmount,
            domainChainId(destinationDomain),
            exclusiveRelayer,
            quoteTimestamp,
            fillDeadline,
            exclusivityDeadline,
            "" // message
        );
    }

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
