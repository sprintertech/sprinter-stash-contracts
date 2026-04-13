// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {V3SpokePoolInterface} from ".././interfaces/IAcross.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AdapterHelper, InputOutputTokenData} from "./AdapterHelper.sol";

abstract contract AcrossAdapter is AdapterHelper {
    using SafeERC20 for IERC20;

    V3SpokePoolInterface immutable public ACROSS_SPOKE_POOL;

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
        bytes calldata extraData,
        mapping(bytes32 => InputOutputTokenData) storage outputTokens
    ) internal notPayable {
        require(address(ACROSS_SPOKE_POOL) != address(0), ZeroAddress());
        token.forceApprove(address(ACROSS_SPOKE_POOL), amount);
        (
            address outputToken,
            uint256 outputAmount,
            address exclusiveRelayer,
            uint32 quoteTimestamp, // Validated in the spoke pool
            uint32 fillDeadline, // Validated in the spoke pool
            uint32 exclusivityDeadline
        ) = abi.decode(extraData, (address, uint256, address, uint32, uint32, uint32));
        _validateOutputAmount(amount, outputAmount, outputToken, destinationDomain, outputTokens);
        _validateOutputToken(outputToken, destinationDomain, outputTokens);
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
}
