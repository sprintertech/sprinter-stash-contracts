// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SendParam, MessagingFee} from ".././interfaces/ILayerZero.sol";
import {IOFT} from ".././interfaces/IOFT.sol";
import {LayerZeroHelper} from "./LayerZeroHelper.sol";

abstract contract USDT0Adapter is LayerZeroHelper {
    using SafeERC20 for IERC20;

    /// @notice The USDT0 OFT contract on the local chain.
    /// On Ethereum this is an OAdapterUpgradeable (locks/unlocks native USDT via transferFrom).
    /// On all other chains it is an OUpgradeable (burns/mints USDT0 directly — no approval needed).
    IOFT immutable public USDT0_OFT;
    address immutable public USDT0_FEE_NATIVE_TOKEN;

    event USDT0Transfer(address token, bytes32 receiver, uint32 dstEid, uint256 amount);

    error InvalidNativeToken();
    error InvalidExtraData();

    constructor(address usdt0Oft, address usdt0FeeNativeToken) {
        // No check for address(0): allows deployment on chains where USDT0 is not available.
        USDT0_OFT = IOFT(usdt0Oft);
        if (usdt0FeeNativeToken != address(0)) {
            require(usdt0FeeNativeToken == USDT0_OFT.nativeToken(), InvalidNativeToken());
        }
        USDT0_FEE_NATIVE_TOKEN = usdt0FeeNativeToken;
    }

    /// @notice Initiates a cross-chain transfer of USDT0 via LayerZero.
    /// @dev The caller must supply sufficient native currency (msg.value) to cover the LayerZero
    /// messaging fee. Any excess is refunded to `caller` by the OFT contract.
    /// amountLD and minAmountLD are set equal — no slippage is accepted.
    /// @param token The ERC-20 token to bridge. Must match USDT0_OFT.token().
    /// @param amount The amount to send in local decimals (6 for USDT0).
    /// @param destinationPool The recipient address on the destination chain.
    /// @param destinationDomain The destination domain.
    /// @param caller The address that initiated the call; used as the LayerZero fee refund address.
    function initiateTransferUSDT0(
        IERC20 token,
        uint256 amount,
        bytes32 destinationPool,
        Domain destinationDomain,
        bytes calldata extraData,
        address caller
    ) internal {
        IOFT oft = USDT0_OFT;
        require(address(oft) != address(0), ZeroAddress());
        require(address(token) == oft.token(), InvalidToken());
        require(extraData.length >= 32, InvalidExtraData());
        uint256 minAmountLD = abi.decode(extraData[0:32], (uint256));
        _validateOutputAmount(amount, minAmountLD);

        if (oft.approvalRequired()) {
            token.forceApprove(address(oft), amount);
        }

        uint32 dstEid = layerZeroEndpointId(destinationDomain);

        SendParam memory sendParam = SendParam({
            dstEid: dstEid,
            to: destinationPool,
            amountLD: amount,
            minAmountLD: minAmountLD,
            extraOptions: new bytes(0),
            composeMsg: new bytes(0),
            oftCmd: new bytes(0)
        });

        MessagingFee memory fee;
        if (USDT0_FEE_NATIVE_TOKEN == address(0)) {
            require(extraData.length == 32, InvalidExtraData());
            fee.nativeFee = msg.value;
        } else {
            require(msg.value == 0, NotPayable());
            require(extraData.length == 64, InvalidExtraData());
            fee.nativeFee = abi.decode(extraData[32:64], (uint256));
            IERC20(USDT0_FEE_NATIVE_TOKEN).safeTransferFrom(caller, address(this), fee.nativeFee);
            IERC20(USDT0_FEE_NATIVE_TOKEN).forceApprove(address(oft), fee.nativeFee);
        }
        // solhint-disable-next-line check-send-result
        oft.send{value: msg.value}(sendParam, fee, caller);

        emit USDT0Transfer(address(token), destinationPool, dstEid, amount);
    }
}
