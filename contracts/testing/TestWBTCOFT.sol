// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IOFT} from "../interfaces/IOFT.sol";
import {SendParam, MessagingFee} from "../interfaces/ILayerZero.sol";

/// @notice Minimal WBTC-style token with permissioned burn for testing.
/// The OFT calls burn() directly without needing an approval from the token holder.
/// To simplify the test setup, burn function here can be called by anyone.
contract TestWBTC is ERC20 {
    constructor() ERC20("TestWBTC", "tWBTC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }
}

/// @notice Test mock for a WBTCOFTAdapter-style OFT (Ethereum adapter pattern).
/// Locks the underlying token via transferFrom — requires approval from the sender.
contract TestWBTCOFTAdapter is IOFT {
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

/// @notice Test mock for a native-OFT-style WBTC OFT (non-Ethereum chains).
/// Calls token.burn() directly — no approval needed because burn is permissioned to the OFT.
contract TestWBTCOFTNative is TestWBTCOFTAdapter {
    constructor(address _token) TestWBTCOFTAdapter(_token) {}

    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata,
        address refundAddress
    ) external payable override {
        TestWBTC(token()).burn(msg.sender, _sendParam.amountLD);
        (bool success,) = payable(refundAddress).call{value: msg.value - NATIVE_FEE}("");
        if (!success) revert EtherTransferFailed();
    }
}
