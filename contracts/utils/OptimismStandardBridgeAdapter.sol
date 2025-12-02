// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOptimismStandardBridge} from ".././interfaces/IOptimism.sol";
import {IWrappedNativeToken} from ".././interfaces/IWrappedNativeToken.sol";
import {AdapterHelper} from "./AdapterHelper.sol";

abstract contract OptimismStandardBridgeAdapter is AdapterHelper {
    using SafeERC20 for IERC20;

    IOptimismStandardBridge immutable public OPTIMISM_STANDARD_BRIDGE;
    IWrappedNativeToken immutable private WRAPPED_NATIVE_TOKEN;

    constructor(
        address optimismStandardBridge,
        address wrappedNativeToken
    ) {
        // No check for address(0) to allow deployment on chains where Optimism Standard Bridge is not available
        OPTIMISM_STANDARD_BRIDGE = IOptimismStandardBridge(optimismStandardBridge);
        WRAPPED_NATIVE_TOKEN = IWrappedNativeToken(wrappedNativeToken);
    }

    function initiateTransferOptimismStandardBridge(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes calldata extraData,
        Domain localDomain
    ) internal notPayable{
        // We are only interested in fast L1->L2 bridging, because the reverse is slow.
        require(
            localDomain == Domain.ETHEREUM && destinationDomain == Domain.OP_MAINNET,
            UnsupportedDomain()
        );
        require(address(OPTIMISM_STANDARD_BRIDGE) != address(0), ZeroAddress());
        // WARNING: Contract doesn't maintain an input/output token mapping which could result in a mismatch.
        // If the output token is wrong then the input tokens will be lost.
        // Notice: In case of minGasLimit being too low, the message could be retried on the destination chain.
        (address outputToken, uint32 minGasLimit) = abi.decode(extraData, (address, uint32));
        if (token == WRAPPED_NATIVE_TOKEN) {
            WRAPPED_NATIVE_TOKEN.withdraw(amount);
            OPTIMISM_STANDARD_BRIDGE.bridgeETHTo{value: amount}(destinationPool, minGasLimit, "");
            return;
        }

        require(outputToken != address(0), ZeroAddress());
        token.forceApprove(address(OPTIMISM_STANDARD_BRIDGE), amount);
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
