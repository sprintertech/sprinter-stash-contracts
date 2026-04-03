// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {SendParam, MessagingFee} from "./ILayerZero.sol";

/// @notice Minimal interface for a LayerZero v2 OFT contract.
interface IOFT {
    /// @notice Estimate the native fee required for a cross-chain send.
    /// @param sendParam The send parameters.
    /// @param payInLzToken Pass false to pay fees in native gas.
    function quoteSend(
        SendParam calldata sendParam,
        bool payInLzToken
    ) external view returns (MessagingFee memory fee);

    /// @notice Execute a cross-chain OFT transfer.
    /// @param sendParam The send parameters.
    /// @param fee The messaging fee (nativeFee, lzTokenFee).
    /// @param refundAddress Address to receive any excess native fee refund.
    function send(
        SendParam calldata sendParam,
        MessagingFee calldata fee,
        address refundAddress
    ) external payable;

    /// @notice Returns the address of the ERC-20 token locked/burned by this OFT.
    function token() external view returns (address);
}
