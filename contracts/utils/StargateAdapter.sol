// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {
    IStargate,
    SendParam,
    OFTReceipt,
    MessagingFee,
    MessagingReceipt,
    Ticket,
    IStargateTreasurer
} from ".././interfaces/IStargate.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LayerZeroHelper} from "./LayerZeroHelper.sol";

abstract contract StargateAdapter is LayerZeroHelper {
    using SafeERC20 for IERC20;

    IStargateTreasurer immutable public STARGATE_TREASURER;

    error EtherTransferFailed();
    error PoolInvalid();

    event StargateTransfer(
        MessagingReceipt msgReceipt,
        OFTReceipt oftReceipt,
        Ticket ticket
    );

    constructor(
        address stargateTreasurer
    ) {
        // No check for address(0) to allow deployment on chains where Stargate Treasurer is not available
        STARGATE_TREASURER = IStargateTreasurer(stargateTreasurer);
    }

    function initiateTransferStargate(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes calldata extraData,
        address caller
    ) internal {
        (address stargateAddress, uint256 minAmountOut) = abi.decode(extraData, (address, uint256));
        require(minAmountOut >= (amount * 9980 / 10000), SlippageTooHigh());
        require(STARGATE_TREASURER.stargates(stargateAddress), PoolInvalid());
        IStargate stargate = IStargate(stargateAddress);
        require(address(token) == stargate.token(), PoolInvalid());

        token.forceApprove(address(stargate), amount);

        uint32 dstEid = layerZeroEndpointId(destinationDomain);

        SendParam memory sendParam = SendParam({
            dstEid: dstEid,
            to: _addressToBytes32(destinationPool),
            amountLD: amount,
            minAmountLD: minAmountOut,
            extraOptions: new bytes(0),
            composeMsg: new bytes(0),
            oftCmd: new bytes(1)
        });

        // The caller is responsible for estimating and providing the correct messaging fee.
        MessagingFee memory messagingFee = MessagingFee(msg.value, 0);

        (
            MessagingReceipt memory msgReceipt,
            OFTReceipt memory oftReceipt,
            Ticket memory ticket
        ) = stargate.sendToken{ value: msg.value }(sendParam, messagingFee, caller);

        emit StargateTransfer(msgReceipt, oftReceipt, ticket);
    }
}
