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
import {IRoute} from ".././interfaces/IRoute.sol";
import {AdapterHelper} from "./AdapterHelper.sol";
import {ERC7201Helper} from "./ERC7201Helper.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

abstract contract StargateAdapter is IRoute, AdapterHelper {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

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

    function stargateEndpointId(Domain destinationDomain) public pure virtual returns (uint32) {
        if (destinationDomain == Domain.ETHEREUM) {
            return 30101;
        } else
        if (destinationDomain == Domain.AVALANCHE) {
            return 30106;
        } else
        if (destinationDomain == Domain.OP_MAINNET) {
            return 30111;
        } else
        if (destinationDomain == Domain.ARBITRUM_ONE) {
            return 30110;
        } else
        if (destinationDomain == Domain.BASE) {
            return 30184;
        } else
        if (destinationDomain == Domain.POLYGON_MAINNET) {
            return 30109;
        } else {
            revert UnsupportedDomain();
        }
    }

    function initiateTransferStargate(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes calldata extraData,
        address caller
    ) internal {
        (address stargateAddress) = abi.decode(extraData, (address));
        require(STARGATE_TREASURER.stargates(stargateAddress), PoolInvalid());
        IStargate stargate = IStargate(stargateAddress);
        require(address(token) == stargate.token(), PoolInvalid());

        token.forceApprove(address(stargate), amount);

        uint32 dstEid = stargateEndpointId(destinationDomain);

        SendParam memory sendParam = SendParam({
            dstEid: dstEid,
            to: _addressToBytes32(destinationPool),
            amountLD: amount,
            minAmountLD: amount,
            extraOptions: new bytes(0),
            composeMsg: new bytes(0),
            oftCmd: new bytes(1)
        });

        sendParam.minAmountLD = amount * 9980 / 10000;

        MessagingFee memory messagingFee = stargate.quoteSend(sendParam, false);
        uint256 valueToSend = messagingFee.nativeFee;

        (
            MessagingReceipt memory msgReceipt,
            OFTReceipt memory oftReceipt,
            Ticket memory ticket
        ) = stargate.sendToken{ value: valueToSend }(sendParam, messagingFee, caller);

        emit StargateTransfer(msgReceipt, oftReceipt, ticket);
        
        // return unused fee to the caller
        uint256 refundAmount = msg.value - valueToSend;
        (bool success,) = payable(caller).call{value: refundAmount}("");
        if (!success) revert EtherTransferFailed();
    }
}
