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
        emit FundsDeposited(
            toBytes32(inputToken),
            toBytes32(outputToken),
            inputAmount,
            outputAmount,
            destinationChainId,
            1337,
            quoteTimestamp,
            fillDeadline,
            exclusivityDeadline,
            toBytes32(depositor),
            toBytes32(recipient),
            toBytes32(exclusiveRelayer),
            message
        );
    }

    function toBytes32(address _address) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_address)));
    }
}
