// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ICCTPV2TokenMessenger, ICCTPV2MessageTransmitter} from "../interfaces/ICCTPV2.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CCTPAdapter} from "./CCTPAdapter.sol";

/// @notice The child contract has to be deployed to the same address across chains, otherwise
/// processTransferCCTPV2() won't work, as the same address has to call receiveMessage().
/// Only supports CCTP V2 standard transfer (maxFee = 0, minFinalityThreshold = 2000).
/// @dev Inherits from CCTPAdapter to share domainCCTP() and helper code, since V1 and V2 use
/// identical CCTP domain IDs for chains supported by both protocols.
abstract contract CCTPV2Adapter is CCTPAdapter {
    using SafeERC20 for IERC20;

    ICCTPV2TokenMessenger immutable internal CCTP_V2_TOKEN_MESSENGER;
    ICCTPV2MessageTransmitter immutable internal CCTP_V2_MESSAGE_TRANSMITTER;

    constructor(
        address cctpTokenMessenger,
        address cctpMessageTransmitter,
        address cctpV2TokenMessenger,
        address cctpV2MessageTransmitter
    ) CCTPAdapter(cctpTokenMessenger, cctpMessageTransmitter) {
        // No check for address(0) to allow deployment on chains where CCTP V2 is not available
        CCTP_V2_TOKEN_MESSENGER = ICCTPV2TokenMessenger(cctpV2TokenMessenger);
        CCTP_V2_MESSAGE_TRANSMITTER = ICCTPV2MessageTransmitter(cctpV2MessageTransmitter);
    }

    function initiateTransferCCTPV2(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain
    ) internal notPayable {
        token.forceApprove(address(CCTP_V2_TOKEN_MESSENGER), amount);
        // Standard transfer: maxFee = 0, minFinalityThreshold = 2000 (hard finality, no fast-transfer fee).
        // See https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/FinalityThresholds.sol
        CCTP_V2_TOKEN_MESSENGER.depositForBurn(
            amount,
            domainCCTP(destinationDomain),
            _addressToBytes32(address(destinationPool)),
            address(token),
            _addressToBytes32(address(this)),
            0,
            2000
        );
    }

}
