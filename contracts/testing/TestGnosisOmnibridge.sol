// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IGnosisOmnibridge, IGnosisAMB, IUSDCTransmuter} from "../interfaces/IGnosisOmnibridge.sol";

contract TestGnosisOmnibridge is IGnosisOmnibridge {
    using SafeERC20 for IERC20;

    error SimulatedRevert();

    function relayTokens(address token, address /* receiver */, uint256 value) external override {
        require(value != 2000, SimulatedRevert());
        SafeERC20.safeTransferFrom(IERC20(token), msg.sender, address(this), value);
    }
}

contract TestGnosisAMB is IGnosisAMB {
    using SafeERC20 for IERC20;

    error SimulatedRevert();

    /// @dev message encodes (address token, address to, uint256 amount)
    /// @dev signatures encodes (bool isValid)
    function executeSignatures(bytes calldata message, bytes calldata signatures) external override {
        (bool isValid) = abi.decode(signatures, (bool));
        require(isValid, SimulatedRevert());
        (address token, address to, uint256 amount) = abi.decode(message, (address, address, uint256));
        IERC20(token).safeTransfer(to, amount);
    }
}

contract TestUSDCTransmuter is IUSDCTransmuter {
    using SafeERC20 for IERC20;

    IERC20 immutable public USDCE;
    IERC20 immutable public USDC;

    error SimulatedRevert();

    constructor(address usdce, address usdc) {
        USDCE = IERC20(usdce);
        USDC = IERC20(usdc);
    }

    function withdraw(uint256 amount) external override {
        require(amount != 2000, SimulatedRevert());
        USDCE.safeTransferFrom(msg.sender, address(this), amount);
        USDC.safeTransfer(msg.sender, amount);
    }
}
