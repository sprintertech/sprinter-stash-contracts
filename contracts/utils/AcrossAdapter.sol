// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {V3SpokePoolInterface} from ".././interfaces/IAcross.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BridgeAdapter} from "./BridgeAdapter.sol";

abstract contract AcrossAdapter is BridgeAdapter {
    using SafeERC20 for IERC20;

    V3SpokePoolInterface immutable public ACROSS_SPOKE_POOL;

    error SlippageTooHigh();

    constructor(
        address acrossSpokePool
    ) {
        require(acrossSpokePool != address(0), ZeroAddress());
        ACROSS_SPOKE_POOL = V3SpokePoolInterface(acrossSpokePool);
    }

    function initiateTransferAcross(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes calldata extraData
    ) internal {
        token.forceApprove(address(ACROSS_SPOKE_POOL), amount);
        (
            address outputToken, // Can be set to 0x0 for automapping by solvers.
            uint256 outputAmount,
            address exclusiveRelayer,
            uint32 quoteTimestamp, // Validated in the spoke pool
            uint32 fillDeadline, // Validated in the spoke pool
            uint32 exclusivityDeadline
        ) = abi.decode(extraData, (address, uint256, address, uint32, uint32, uint32));
        require(outputAmount > (amount * 9 / 10), SlippageTooHigh()); // TODO: Probably needs to be stricter.
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
