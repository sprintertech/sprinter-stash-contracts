// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

/// @notice Circle CCTP V2 TokenMessenger interface — standard transfer subset.
/// @dev Source: https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/TokenMessengerV2.sol
interface ICCTPV2TokenMessenger {
    /// @notice Deposits and burns tokens from sender to be minted on destination domain.
    /// @param amount Amount of tokens to burn.
    /// @param destinationDomain Destination CCTP domain ID.
    /// @param mintRecipient Address of mint recipient on destination domain (as bytes32).
    /// @param burnToken Token to burn on the local domain.
    /// @param destinationCaller Authorized caller on the destination domain (as bytes32);
    /// bytes32(0) allows any address to relay.
    /// @param maxFee Maximum fee to pay on the destination domain, in units of burnToken.
    /// @param minFinalityThreshold Minimum finality at which the burn message will be attested to.
    event DepositForBurn(
        address indexed burnToken,
        uint256 amount,
        address indexed depositor,
        bytes32 mintRecipient,
        uint32 destinationDomain,
        bytes32 destinationTokenMessenger,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 indexed minFinalityThreshold,
        bytes hookData
    );

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;
}

/// @notice Circle CCTP V2 MessageTransmitter interface.
/// @dev The receiveMessage signature is identical to V1 but lives at a different address per chain.
interface ICCTPV2MessageTransmitter {
    function receiveMessage(bytes calldata message, bytes calldata attestation)
        external
        returns (bool success);
}
