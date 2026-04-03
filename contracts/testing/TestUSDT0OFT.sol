// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IOFT} from "../interfaces/IOFT.sol";
import {SendParam, MessagingFee} from "../interfaces/ILayerZero.sol";

/// @notice Minimal USDT0-style token with permissioned burn for testing.
/// The OFT calls burn() directly without needing an approval from the token holder.
contract TestUSDT0 is ERC20 {
    constructor() ERC20("TestUSDT0", "tUSDT0") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }
}

/// @notice Test mock for an OAdapterUpgradeable-style USDT0 OFT (Ethereum adapter pattern).
/// Locks the underlying token via transferFrom — requires approval from the sender.
contract TestUSDT0OFTAdapter is IOFT {
    using SafeERC20 for IERC20;

    address private immutable TOKEN;
    uint256 public constant NATIVE_FEE = 1e10;

    error EtherTransferFailed();

    constructor(address _token) {
        TOKEN = _token;
    }

    function token() public view returns (address) {
        return TOKEN;
    }

    function quoteSend(SendParam calldata, bool) external pure returns (MessagingFee memory) {
        return MessagingFee(NATIVE_FEE, 0);
    }

    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata,
        address refundAddress
    ) external payable virtual {
        IERC20(TOKEN).safeTransferFrom(msg.sender, address(this), _sendParam.amountLD);
        (bool success,) = payable(refundAddress).call{value: msg.value - NATIVE_FEE}("");
        if (!success) revert EtherTransferFailed();
    }
}

/// @notice Test mock for an OUpgradeable-style USDT0 OFT (native OFT pattern on non-Ethereum chains).
/// Calls token.burn() directly — no approval needed because burn is permissioned to the OFT.
contract TestUSDT0OFTNative is TestUSDT0OFTAdapter {
    constructor(address _token) TestUSDT0OFTAdapter(_token) {}

    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata,
        address refundAddress
    ) external payable override {
        TestUSDT0(token()).burn(msg.sender, _sendParam.amountLD);
        (bool success,) = payable(refundAddress).call{value: msg.value - NATIVE_FEE}("");
        if (!success) revert EtherTransferFailed();
    }
}
