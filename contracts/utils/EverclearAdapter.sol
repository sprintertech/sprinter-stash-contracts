// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IFeeAdapter} from ".././interfaces/IEverclear.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BridgeAdapter} from "./BridgeAdapter.sol";

abstract contract EverclearAdapter is BridgeAdapter {
    using SafeERC20 for IERC20;

    IFeeAdapter immutable public EVERCLEAR_FEE_ADAPTER;

    constructor(
        address everclearFeeAdapter
    ) {
        // No check for address(0) to allow deployment on chains where Everclear is not available
        EVERCLEAR_FEE_ADAPTER = IFeeAdapter(everclearFeeAdapter);
    }

    function initiateTransferEverclear(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes calldata extraData
    ) internal {
        require(address(EVERCLEAR_FEE_ADAPTER) != address(0), ZeroAddress());
        token.forceApprove(address(EVERCLEAR_FEE_ADAPTER), amount);
        (
            bytes32 outputAsset,
            uint24 maxFee,
            uint48 ttl,
            IFeeAdapter.FeeParams memory feeParams
        ) = abi.decode(extraData, (bytes32, uint24, uint48, IFeeAdapter.FeeParams));
        uint32[] memory destinations = new uint32[](1);
        destinations[0] = domainChainId(destinationDomain);
        EVERCLEAR_FEE_ADAPTER.newIntent{value: msg.value}(
            destinations,
            _addressToBytes32(destinationPool),
            address(token),
            outputAsset,
            amount,
            maxFee,
            ttl,
            "",
            feeParams
        );
    }
}
