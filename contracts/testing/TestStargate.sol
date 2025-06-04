// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    IStargate, 
    SendParam,
    MessagingFee,
    MessagingReceipt,
    OFTReceipt,
    Ticket,
    OFTLimit,
    OFTFeeDetail
} from "../interfaces/IStargate.sol";

contract TestStargate is IStargate {
    using SafeERC20 for IERC20;

    address private immutable TOKEN;
    uint256 public constant NATIVE_FEE = 1e10;

    error EtherTransferFailed();

    constructor(address _token) {
        TOKEN = _token;
    }

    function token() external view returns (address) {
        return TOKEN;
    }

    function sendToken(
        SendParam calldata _sendParam,
        MessagingFee calldata,
        address
    ) external payable returns (
        MessagingReceipt memory msgReceipt,
        OFTReceipt memory oftReceipt,
        Ticket memory ticket
    ) {
        IERC20(TOKEN).safeTransferFrom(msg.sender, address(this), _sendParam.amountLD);
        (bool success,) = payable(msg.sender).call{value: msg.value - NATIVE_FEE}("");
        if (!success) revert EtherTransferFailed();
        emit OFTSent(
            bytes32(0),
            _sendParam.dstEid,
            msg.sender,
            _sendParam.amountLD,
            _sendParam.minAmountLD
        );
        return(
            MessagingReceipt(bytes32(0), 0, MessagingFee(NATIVE_FEE, 0)),
            OFTReceipt(_sendParam.amountLD, _sendParam.amountLD),
            Ticket(0, "0x")
        );
    }

    /**
     * @notice Provides a quote for OFT-related operations.
     * @param _sendParam The parameters for the send operation.
     * @return limit The OFT limit information.
     * @return oftFeeDetails The details of OFT fees.
     * @return receipt The OFT receipt information.
     */
    function quoteOFT(
        SendParam calldata _sendParam
    ) external pure returns (OFTLimit memory, OFTFeeDetail[] memory oftFeeDetails, OFTReceipt memory) {
        OFTFeeDetail[] memory oftDetail = new OFTFeeDetail[](0);
        return (
            OFTLimit(_sendParam.amountLD, _sendParam.amountLD),
            oftDetail,
            OFTReceipt(_sendParam.amountLD, _sendParam.amountLD)
        );
    }

    function quoteSend(SendParam calldata, bool) external pure returns (MessagingFee memory) {
        return MessagingFee(NATIVE_FEE, 0);
    }
}
