// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SendParam, MessagingFee} from ".././interfaces/ILayerZero.sol";
import {IOFT} from ".././interfaces/IOFT.sol";
import {LayerZeroHelper} from "./LayerZeroHelper.sol";

abstract contract WBTCOFTAdapter is LayerZeroHelper {
    using SafeERC20 for IERC20;

    /// @notice The WBTC OFT contract on the local chain.
    /// On Ethereum this is a WBTCOFTAdapter (locks/unlocks canonical WBTC via transferFrom).
    /// On all other supported chains it is an OFT that burns/mints WBTC directly — no approval needed.
    IOFT immutable public WBTC_OFT;

    event WBTCOFTTransfer(address token, address receiver, uint32 dstEid, uint256 amount);

    constructor(address wbtcOft) {
        // No check for address(0): allows deployment on chains where WBTC OFT is not available.
        WBTC_OFT = IOFT(wbtcOft);
    }

    /// @notice Initiates a cross-chain transfer of WBTC via the LayerZero OFT.
    /// @dev The caller must supply sufficient native currency (msg.value) to cover the LayerZero
    /// messaging fee. Any excess is refunded to `caller` by the OFT contract.
    /// amountLD and minAmountLD are set equal — no slippage is accepted.
    /// @param token The ERC-20 token to bridge. Must match WBTC_OFT.token().
    /// @param amount The amount to send in local decimals (8 for WBTC).
    /// @param destinationPool The recipient address on the destination chain.
    /// @param destinationDomain The destination domain.
    /// @param localDomain The local domain; used to decide whether approval is needed.
    /// @param caller The address that initiated the call; used as the LayerZero fee refund address.
    function initiateTransferWBTCOFT(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        Domain localDomain,
        address caller
    ) internal {
        IOFT oft = WBTC_OFT;
        require(address(oft) != address(0), ZeroAddress());
        require(address(token) == oft.token(), InvalidToken());

        // On Ethereum the OFT is a WBTCOFTAdapter that pulls tokens via transferFrom.
        // On other chains the OFT burns from msg.sender directly — no approval needed.
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

        emit WBTCOFTTransfer(address(token), destinationPool, dstEid, amount);
    }
}
