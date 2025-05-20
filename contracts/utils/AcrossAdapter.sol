// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {V3SpokePoolInterface} from ".././interfaces/IAcross.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRoute} from ".././interfaces/IRoute.sol";

contract AcrossAdapter is IRoute {
    using SafeERC20 for IERC20;

    error ProcessFailed();
    error UnsupportedDomain();

    function initiateTransferAcross(
        V3SpokePoolInterface spokePool,
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain
    ) internal {
        token.forceApprove(address(spokePool), amount);
        uint256 quoteTimeBuffer = spokePool.depositQuoteTimeBuffer(); // TODO: Not changing ever, might be stored
        uint256 currentTime = block.timestamp();
        uint256 quoteTimestamp = currentTime - (quoteTimeBuffer / 2); // between [currentTime - depositQuoteTimeBuffer, currentTime]
        uint256 fillDeadlineBuffer = spokePool.fillDeadlineBuffer(); // TODO: Not changing ever, might be stored
        uint256 fillDeadline = currentTime + (fillDeadlineBuffer / 2); // before currentTime + fillDeadlineBuffer
        spokePool.depositV3(
            address(this), // address depositor,
            address(destinationPool), // address recipient,
            address(token), // address inputToken,
        // address outputToken, - TODO: can be a different token
            amount, // uint256 inputAmount,
            amount, // uint256 outputAmount, - TODO: The recommended outputAmount will be equal to inputAmount * ( 1 - relayerFeePct - lpFeePct).
            // usually the suggested-fees endpoint in the API is queried to get the suggested outputAmount to set in order to make the inputAmount profitable for fillers to relay

        // uint256 destinationChainId, TODO: maybe add to routes?
            address(0), // address exclusiveRelayer,
            quoteTimestamp, // uint32 quoteTimestamp,
            fillDeadline, // uint32 fillDeadline,
            0, // uint32 exclusivityDeadline,
            0x // bytes calldata message
        );
    }
   
    // TODO: handle message: https://docs.across.to/use-cases/embedded-crosschain-actions/crosschain-actions-integration-guide/using-a-custom-handler-contract#summarized-requirements


    // function processTransferCCTP(
    //     ICCTPMessageTransmitter messageTransmitter,
    //     IERC20 token,
    //     address destinationPool,
    //     bytes calldata extraData
    // ) internal returns (uint256) {
    //     uint256 balanceBefore = token.balanceOf(address(destinationPool));

    //     (bytes memory message, bytes memory attestation) = abi.decode(extraData, (bytes, bytes));
    //     bool success = messageTransmitter.receiveMessage(message, attestation);
    //     require(success, ProcessFailed());

    //     uint256 balanceAfter = token.balanceOf(address(destinationPool));
    //     require(balanceAfter > balanceBefore, ProcessFailed());
    //     uint256 amount = balanceAfter - balanceBefore;
    //     return amount;
    // }

    //  function domainCCTP(Domain destinationDomain) public pure virtual returns (uint32) {
    //     if (destinationDomain == Domain.ETHEREUM) {
    //         return 0;
    //     } else
    //     if (destinationDomain == Domain.AVALANCHE) {
    //         return 1;
    //     } else
    //     if (destinationDomain == Domain.OP_MAINNET) {
    //         return 2;
    //     } else
    //     if (destinationDomain == Domain.ARBITRUM_ONE) {
    //         return 3;
    //     } else
    //     if (destinationDomain == Domain.BASE) {
    //         return 6;
    //     } else
    //     if (destinationDomain == Domain.POLYGON_MAINNET) {
    //         return 7;
    //     } else {
    //         revert UnsupportedDomain();
    //     }
    // }

    // function _addressToBytes32(address addr) internal pure returns (bytes32) {
    //     return bytes32(uint256(uint160(addr)));
    // }
}
