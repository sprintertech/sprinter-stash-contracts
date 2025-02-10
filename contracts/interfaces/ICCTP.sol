// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

interface ICCTPTokenMessenger {
    function depositForBurnWithCaller(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller
    ) external returns (uint64 nonce);
}

interface ICCTPMessageTransmitter {
    function receiveMessage(bytes calldata message, bytes calldata signature)
        external
        returns (bool success);
}
