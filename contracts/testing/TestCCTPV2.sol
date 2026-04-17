// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICCTPV2TokenMessenger, ICCTPV2MessageTransmitter} from "../interfaces/ICCTPV2.sol";

interface IBurnableV2 {
    function burn(uint256 value) external;
}

interface IMintableV2 {
    function mint(address to, uint256 value) external;
}

contract TestCCTPV2TokenMessenger is ICCTPV2TokenMessenger {
    error InvalidStandardTransferMaxFee();
    error InvalidStandardTransferFinalityThreshold();

    function depositForBurn(
        uint256 amount,
        uint32 /*destinationDomain*/,
        bytes32 /*mintRecipient*/,
        address burnToken,
        bytes32 /*destinationCaller*/,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external override {
        // Mirror the v1 mock: pull tokens from caller and burn them.
        // Also assert the standard-transfer parameters so any drift fails loudly.
        require(maxFee == 0, InvalidStandardTransferMaxFee());
        require(minFinalityThreshold == 2000, InvalidStandardTransferFinalityThreshold());
        SafeERC20.safeTransferFrom(IERC20(burnToken), msg.sender, address(this), amount);
        IBurnableV2(burnToken).burn(amount);
    }
}

contract TestCCTPV2MessageTransmitter is ICCTPV2MessageTransmitter {
    function receiveMessage(bytes calldata message, bytes calldata signature)
        external override returns (bool)
    {
        (address token, address to, uint256 amount) = abi.decode(message, (address, address, uint256));
        (bool isValid, bool success) = abi.decode(signature, (bool, bool));
        // solhint-disable-next-line
        require(isValid);
        IMintableV2(token).mint(to, amount);
        return success;
    }
}
