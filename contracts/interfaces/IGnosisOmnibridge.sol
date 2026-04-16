// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

/// @notice Interface for the Gnosis Omnibridge mediator on both Ethereum and Gnosis Chain.
/// Ethereum mediator: 0x88ad09518695c6c3712AC10a214bE5109a655671
/// Gnosis Chain mediator: 0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d
interface IGnosisOmnibridge {
    /// @notice Initiates a token bridge transfer to the other side.
    /// Caller must approve this contract for `value` of `token` before calling.
    function relayTokens(address token, address receiver, uint256 value) external;
}

/// @notice Interface for the Ethereum AMB (Arbitrary Message Bridge).
/// Used to finalise a Gnosis Chain → Ethereum bridge transfer after validators have collected signatures.
/// Ethereum AMB: 0x4C36d2919e407f0Cc2Ee3c993ccF8ac26d9CE64e
interface IGnosisAMB {
    /// @notice Executes a message on Ethereum using validator signatures collected on Gnosis Chain.
    function executeSignatures(bytes calldata _data, bytes calldata _signatures) external;
}

/// @notice Interface for the USDCe-to-USDC swap contract on Gnosis Chain.
/// USDCe (Circle's Bridged USDC Standard) cannot be bridged via Omnibridge directly.
/// It must first be swapped 1:1 to USDC (the original Omnibridge-bridged USDC) before bridging.
/// Caller must approve this contract for `amount` of USDCe before calling.
interface IUSDCTransmuter {
    function withdraw(uint256 amount) external;
}
