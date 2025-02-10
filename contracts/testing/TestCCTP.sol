// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICCTPTokenMessenger, ICCTPMessageTransmitter} from "../interfaces/ICCTP.sol";

interface IBurnable {
    function burn(uint256 value) external;
}

interface IMintable {
    function mint(address to, uint256 value) external;
}

contract TestCCTPTokenMessenger is ICCTPTokenMessenger {
    function depositForBurnWithCaller(
        uint256 amount,
        uint32 /*destinationDomain*/,
        bytes32 /*mintRecipient*/,
        address burnToken,
        bytes32 /*destinationCaller*/
    ) external override returns (uint64 nonce) {
        SafeERC20.safeTransferFrom(IERC20(burnToken), msg.sender, address(this), amount);
        IBurnable(burnToken).burn(amount);
        return 1;
    }
}

contract TestCCTPMessageTransmitter is ICCTPMessageTransmitter {
    function receiveMessage(bytes calldata message, bytes calldata signature)
        external override returns (bool)
    {
        (address token, address to, uint256 amount) = abi.decode(message, (address, address, uint256));
        (bool isValid, bool success) = abi.decode(signature, (bool, bool));
        // solhint-disable-next-line
        require(isValid);
        IMintable(token).mint(to, amount);
        return success;
    }
}
