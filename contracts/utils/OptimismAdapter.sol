// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IOptimismStandardBridge} from ".././interfaces/IOptimism.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AdapterHelper} from "./AdapterHelper.sol";

abstract contract OptimismAdapter is AdapterHelper {
    using SafeERC20 for IERC20;

    IOptimismStandardBridge immutable public OPTIMISM_STANDARD_BRIDGE;

    constructor(
        address optimismStandardBridge
    ) {
        // No check for address(0) to allow deployment on chains where Optimism Standard Bridge is not available
        OPTIMISM_STANDARD_BRIDGE = IOptimismStandardBridge(optimismStandardBridge);
    }

    function initiateTransferOptimism(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain,
        bytes calldata extraData
    ) internal {
        require(address(OPTIMISM_STANDARD_BRIDGE) != address(0), ZeroAddress());
        token.forceApprove(address(OPTIMISM_STANDARD_BRIDGE), amount);
        (
            address outputToken,
            uint32 minGasLimit
        ) = abi.decode(extraData, (address, uint32));
        OPTIMISM_STANDARD_BRIDGE.bridgeERC20To(
            address(token),
            outputToken,
            destinationPool,
            amount,
            minGasLimit,
            "" // message
        );
    }
}
