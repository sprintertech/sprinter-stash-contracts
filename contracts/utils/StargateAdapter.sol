// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IStargate, SendParam, OFTReceipt, MessagingFee, MessagingReceipt, Ticket} from ".././interfaces/IStargate.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRoute} from ".././interfaces/IRoute.sol";
import {AdapterHelper} from "./AdapterHelper.sol";
import {ERC7201Helper} from "./ERC7201Helper.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

abstract contract StargateAdapter is IRoute, AdapterHelper {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    error EtherTransferFailed();
    error PoolNotConfigured();

    event SetStargatePool(address token, address pool, bool active);
    event StargateTransfer(
        MessagingReceipt msgReceipt,
        OFTReceipt oftReceipt,
        Ticket ticket
    );

    /// @custom:storage-location erc7201:sprinter.storage.StargateAdapter
    struct StargateAdapterStorage {
        mapping(address token => address stargatePool) stargatePools;
        EnumerableSet.AddressSet supportedTokens;
    }

    bytes32 private constant STORAGE_LOCATION = 0x69ed53fd7002b77325dfb2dcb94eb7915862ca85fe4da99402d49671ed0bcb00;

    constructor(
    ) {
        ERC7201Helper.validateStorageLocation(
            STORAGE_LOCATION,
            "sprinter.storage.StargateAdapter"
        );
    }

    function _setStargatePools(
        address[] memory pools,
        bool active
    ) internal {
        StargateAdapterStorage storage $ = _getStargateStorage();
        for (uint256 i = 0; i < pools.length; ++i) {
            address pool = pools[i];
            require(pool != address(0), ZeroAddress());
            address token = IStargate(pool).token();
            require(token != address(0), ZeroAddress());

            if (active) {
                $.stargatePools[token] = pool;
                $.supportedTokens.add(token);
            } else {
                delete $.stargatePools[token];
                $.supportedTokens.remove(token);
            }

            emit SetStargatePool(token, pool, active);
        }
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
        bytes calldata,
        address caller
    ) internal {
        IStargate stargate = IStargate(_getStargateStorage().stargatePools[address(token)]);
        require(address(stargate) != address(0), PoolNotConfigured());

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

    function getStargatePools()
        external view returns (
            address[] memory tokens,
            address[] memory pools
        ) 
    {
        StargateAdapterStorage storage $ = _getStargateStorage();
        uint256 totalPools = $.supportedTokens.length();
        tokens = new address[](totalPools);
        pools = new address[](totalPools);
        for (uint256 p = 0; p < totalPools; p++) {
            address token = $.supportedTokens.at(p);
            tokens[p] = token;
            pools[p] = $.stargatePools[token];
        }
        return (tokens, pools);
    }

    function _getStargateStorage() private pure returns (StargateAdapterStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
