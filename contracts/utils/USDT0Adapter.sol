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

    error InvalidToken();

    event USDT0Transfer(address token, address receiver, uint32 dstEid, uint256 amount);

    constructor(address usdt0Oft) {
        // No check for address(0): allows deployment on chains where USDT0 is not available.
        USDT0_OFT = IOFT(usdt0Oft);
    }

    /// @notice Initiates a cross-chain transfer of USDT0 via LayerZero.
    /// @dev The caller must supply sufficient native currency (msg.value) to cover the LayerZero
    /// messaging fee. Any excess is refunded to `caller` by the OFT contract.
    /// amountLD and minAmountLD are set equal — no slippage is accepted.
    /// @param token The ERC-20 token to bridge. Must match USDT0_OFT.token().
    /// @param amount The amount to send in local decimals (6 for USDT0).
    /// @param destinationPool The recipient address on the destination chain.
    /// @param destinationDomain The destination domain.
    /// @param localDomain The local domain; used to decide whether approval is needed.
    /// @param caller The address that initiated the call; used as the LayerZero fee refund address.
    function initiateTransferUSDT0(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        Domain localDomain,
        address caller
    ) internal {
        IOFT oft = USDT0_OFT;
        require(address(oft) != address(0), ZeroAddress());
        require(address(token) == oft.token(), InvalidToken());

        // On Ethereum the OFT is an OAdapterUpgradeable that pulls tokens via transferFrom.
        // On other chains the OFT calls token.burn() directly — no approval needed.
        if (localDomain == Domain.ETHEREUM) {
            token.forceApprove(address(oft), amount);
        }

        uint32 dstEid = layerZeroEndpointId(destinationDomain);

        SendParam memory sendParam = SendParam({
            dstEid: dstEid,
            to: _addressToBytes32(destinationPool),
            amountLD: amount,
            minAmountLD: amount,
            extraOptions: new bytes(0),
            composeMsg: new bytes(0),
            oftCmd: new bytes(0)
        });

        MessagingFee memory fee = MessagingFee(msg.value, 0);
        // solhint-disable-next-line check-send-result
        oft.send{value: msg.value}(sendParam, fee, caller);

        emit USDT0Transfer(address(token), destinationPool, dstEid, amount);
    }
}
