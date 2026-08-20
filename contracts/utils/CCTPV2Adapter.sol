// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ICCTPV2TokenMessenger, ICCTPV2MessageTransmitter} from "../interfaces/ICCTPV2.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AdapterHelper} from "./AdapterHelper.sol";

/// @notice processTransferCCTPV2() must be called by the address configured as the child
/// contract's own address on the destination domain (see destinationAddressThis), since it is
/// set as CCTP's destinationCaller. This no longer requires the child to be deployed to the
/// same address across chains.
/// Only supports CCTP V2 standard transfer (maxFee = 0, minFinalityThreshold = 2000).
abstract contract CCTPV2Adapter is AdapterHelper {
    using SafeERC20 for IERC20;

    IERC20 immutable public CCTP_V2_ONLY_SUPPORTED_TOKEN;
    ICCTPV2TokenMessenger immutable public CCTP_V2_TOKEN_MESSENGER;
    ICCTPV2MessageTransmitter immutable public CCTP_V2_MESSAGE_TRANSMITTER;

    constructor(
        IERC20 onlySupportedToken,
        address cctpV2TokenMessenger,
        address cctpV2MessageTransmitter
    ) {
        // No check for address(0) to allow deployment on chains where CCTP V2 is not available
        CCTP_V2_ONLY_SUPPORTED_TOKEN = onlySupportedToken;
        CCTP_V2_TOKEN_MESSENGER = ICCTPV2TokenMessenger(cctpV2TokenMessenger);
        CCTP_V2_MESSAGE_TRANSMITTER = ICCTPV2MessageTransmitter(cctpV2MessageTransmitter);
    }

    function initiateTransferCCTPV2(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes32 destinationAddressThis
    ) internal notPayable {
        require(token == CCTP_V2_ONLY_SUPPORTED_TOKEN, InvalidToken());
        require(address(CCTP_V2_TOKEN_MESSENGER) != address(0), ZeroAddress());
        token.forceApprove(address(CCTP_V2_TOKEN_MESSENGER), amount);
        // Standard transfer: maxFee = 0, minFinalityThreshold = 2000 (hard finality, no fast-transfer fee).
        // See https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/FinalityThresholds.sol
        CCTP_V2_TOKEN_MESSENGER.depositForBurn(
            amount,
            domainCCTP(destinationDomain),
            _addressToBytes32(destinationPool),
            address(token),
            destinationAddressThis,
            0,
            2000
        );
    }

    function processTransferCCTPV2(
        address destinationPool,
        bytes calldata extraData
    ) internal returns (IERC20, uint256) {
        require(address(CCTP_V2_MESSAGE_TRANSMITTER) != address(0), ZeroAddress());
        return _processTransferCCTP(address(CCTP_V2_MESSAGE_TRANSMITTER), destinationPool, extraData);
    }

    function _processTransferCCTP(
        address messageTransmitter,
        address destinationPool,
        bytes calldata extraData
    ) internal returns (IERC20, uint256) {
        uint256 balanceBefore = CCTP_V2_ONLY_SUPPORTED_TOKEN.balanceOf(destinationPool);
        (bytes memory message, bytes memory attestation) = abi.decode(extraData, (bytes, bytes));
        bool success = ICCTPV2MessageTransmitter(messageTransmitter).receiveMessage(message, attestation);
        require(success, ProcessFailed());
        uint256 balanceAfter = CCTP_V2_ONLY_SUPPORTED_TOKEN.balanceOf(destinationPool);
        require(balanceAfter > balanceBefore, ProcessFailed());
        unchecked {
            return (CCTP_V2_ONLY_SUPPORTED_TOKEN, balanceAfter - balanceBefore);
        }
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
        } else
        if (destinationDomain == Domain.UNICHAIN) {
            return 10;
        } else
        if (destinationDomain == Domain.LINEA) {
            return 11;
        } else
        if (destinationDomain == Domain.WORLD_CHAIN) {
            return 14;
        } else
        if (destinationDomain == Domain.HYPER_EVM) {
            return 19;
        } else
        if (destinationDomain == Domain.INK) {
            return 21;
        } else {
            revert UnsupportedDomain();
        }
    }
}
