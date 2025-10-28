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
import {AdapterHelper} from "./AdapterHelper.sol";

abstract contract StargateAdapter is AdapterHelper {
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
        } else
        if (destinationDomain == Domain.UNICHAIN) {
            return 30320;
        } else
        if (destinationDomain == Domain.BSC) {
            return 30102;
        } else
        if (destinationDomain == Domain.LINEA) {
            return 30183;
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
        (address stargateAddress, uint256 minAmountOut) = abi.decode(extraData, (address, uint256));
        require(minAmountOut >= (amount * 9980 / 10000), SlippageTooHigh());
        require(STARGATE_TREASURER.stargates(stargateAddress), PoolInvalid());
        IStargate stargate = IStargate(stargateAddress);
        require(address(token) == stargate.token(), PoolInvalid());

        token.forceApprove(address(stargate), amount);

        uint32 dstEid = stargateEndpointId(destinationDomain);

        SendParam memory sendParam = SendParam({
            dstEid: dstEid,
            to: _addressToBytes32(destinationPool),
            amountLD: amount,
            minAmountLD: minAmountOut,
            extraOptions: new bytes(0),
            composeMsg: new bytes(0),
            oftCmd: new bytes(1)
        });

        MessagingFee memory messagingFee = MessagingFee(msg.value, 0);

        (
            MessagingReceipt memory msgReceipt,
            OFTReceipt memory oftReceipt,
            Ticket memory ticket
        ) = stargate.sendToken{ value: msg.value }(sendParam, messagingFee, caller);

        emit StargateTransfer(msgReceipt, oftReceipt, ticket);
    }
}
