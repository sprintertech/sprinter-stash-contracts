// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IFeeAdapterV2} from ".././interfaces/IEverclear.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AdapterHelper} from "./AdapterHelper.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";

abstract contract EverclearAdapter is AdapterHelper {
    using SafeERC20 for IERC20;

    IFeeAdapterV2 immutable public EVERCLEAR_FEE_ADAPTER;

    constructor(
        address everclearFeeAdapter
    ) {
        // No check for address(0) to allow deployment on chains where Everclear is not available
        EVERCLEAR_FEE_ADAPTER = IFeeAdapterV2(everclearFeeAdapter);
    }

    function initiateTransferEverclear(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes calldata extraData,
        mapping(bytes32 => BitMaps.BitMap) storage outputTokens
    ) internal {
        require(address(EVERCLEAR_FEE_ADAPTER) != address(0), ZeroAddress());
        token.forceApprove(address(EVERCLEAR_FEE_ADAPTER), amount);
        (
            bytes32 outputAsset,
            uint256 amountOutMin,
            uint48 ttl,
            IFeeAdapterV2.FeeParams memory feeParams
        ) = abi.decode(extraData, (bytes32, uint256, uint48, IFeeAdapterV2.FeeParams));
        require(amountOutMin >= (amount * 9980 / 10000), SlippageTooHigh());
        _validateOutputToken(outputAsset, destinationDomain, outputTokens);
        uint32[] memory destinations = new uint32[](1);
        destinations[0] = domainChainId(destinationDomain);
        EVERCLEAR_FEE_ADAPTER.newIntent{value: msg.value}(
            destinations,
            _addressToBytes32(destinationPool),
            address(token),
            outputAsset,
            amount - feeParams.fee,
            amountOutMin,
            ttl,
            "",
            feeParams
        );
    }
}
