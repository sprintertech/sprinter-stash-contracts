// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {V3SpokePoolInterface} from "../interfaces/IAcross.sol";

contract TestAcrossV3SpokePool is V3SpokePoolInterface {
    function depositV3(
        address depositor,
        address recipient,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 destinationChainId,
        address exclusiveRelayer,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityDeadline,
        bytes calldata message
    ) external payable override {
        require(fillDeadline > 0, InvalidFillDeadline()); // To simulate revert.
        SafeERC20.safeTransferFrom(IERC20(inputToken), msg.sender, address(this), inputAmount);
        emit V3FundsDeposited(
            inputToken,
            outputToken,
            inputAmount,
            outputAmount,
            destinationChainId,
            0,
            quoteTimestamp,
            fillDeadline,
            exclusivityDeadline,
            depositor,
            recipient,
            exclusiveRelayer,
            message
        );
    }
}
