// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ICCTPTokenMessenger, ICCTPMessageTransmitter} from "../interfaces/ICCTP.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AdapterHelper} from "./AdapterHelper.sol";

/// @notice The child contract has to be deployed to the same address across chains, otherwise
/// processTransferCCTP() won't work, as the same address has to call receiveMessage().
/// Only supports CCTP V1 integration.
abstract contract CCTPAdapter is AdapterHelper {
    using SafeERC20 for IERC20;

    ICCTPTokenMessenger immutable public CCTP_TOKEN_MESSENGER;
    ICCTPMessageTransmitter immutable public CCTP_MESSAGE_TRANSMITTER;

    constructor(
        address cctpTokenMessenger,
        address cctpMessageTransmitter
    ) {
        // No check for address(0) to allow deployment on chains where CCTP V1 is not available
        CCTP_TOKEN_MESSENGER = ICCTPTokenMessenger(cctpTokenMessenger);
        CCTP_MESSAGE_TRANSMITTER = ICCTPMessageTransmitter(cctpMessageTransmitter);
    }

    function initiateTransferCCTP(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain
    ) internal {
        token.forceApprove(address(CCTP_TOKEN_MESSENGER), amount);
        CCTP_TOKEN_MESSENGER.depositForBurnWithCaller(
            amount,
            domainCCTP(destinationDomain),
            _addressToBytes32(address(destinationPool)),
            address(token),
            _addressToBytes32(address(this))
        );
    }
   
    function processTransferCCTP(
        IERC20 token,
        address destinationPool,
        bytes calldata extraData
    ) internal returns (uint256) {
        uint256 balanceBefore = token.balanceOf(address(destinationPool));

        (bytes memory message, bytes memory attestation) = abi.decode(extraData, (bytes, bytes));
        bool success = CCTP_MESSAGE_TRANSMITTER.receiveMessage(message, attestation);
        require(success, ProcessFailed());

        uint256 balanceAfter = token.balanceOf(address(destinationPool));
        require(balanceAfter > balanceBefore, ProcessFailed());
        uint256 amount = balanceAfter - balanceBefore;
        return amount;
    }

     function domainCCTP(Domain destinationDomain) public pure virtual returns (uint32) {
        if (destinationDomain == Domain.ETHEREUM) {
            return 0;
        } else
        if (destinationDomain == Domain.AVALANCHE) {
            return 1;
        } else
        if (destinationDomain == Domain.OP_MAINNET) {
            return 2;
        } else
        if (destinationDomain == Domain.ARBITRUM_ONE) {
            return 3;
        } else
        if (destinationDomain == Domain.BASE) {
            return 6;
        } else
        if (destinationDomain == Domain.POLYGON_MAINNET) {
            return 7;
        } else {
            revert UnsupportedDomain();
        }
    }
}
