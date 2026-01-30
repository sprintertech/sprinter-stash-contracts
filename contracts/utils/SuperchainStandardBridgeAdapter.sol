// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISuperchainStandardBridge} from ".././interfaces/ISuperchainStandardBridge.sol";
import {IWrappedNativeToken} from ".././interfaces/IWrappedNativeToken.sol";
import {AdapterHelper} from "./AdapterHelper.sol";

abstract contract SuperchainStandardBridgeAdapter is AdapterHelper {
    using SafeERC20 for IERC20;

    ISuperchainStandardBridge immutable public OPTIMISM_STANDARD_BRIDGE;
    ISuperchainStandardBridge immutable public BASE_STANDARD_BRIDGE;
    IWrappedNativeToken immutable private WRAPPED_NATIVE_TOKEN;

    constructor(
        address optimismStandardBridge,
        address baseStandardBridge,
        address wrappedNativeToken
    ) {
        // No check for address(0) to allow deployment on chains where Standard Bridge is not available
        OPTIMISM_STANDARD_BRIDGE = ISuperchainStandardBridge(optimismStandardBridge);
        BASE_STANDARD_BRIDGE = ISuperchainStandardBridge(baseStandardBridge);
        WRAPPED_NATIVE_TOKEN = IWrappedNativeToken(wrappedNativeToken);
    }

    function initiateTransferSuperchainStandardBridge(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes calldata extraData,
        Domain localDomain,
        mapping(bytes32 => BitMaps.BitMap) storage outputTokens
    ) internal notPayable {
        // We are only interested in fast L1->L2 bridging, because the reverse is slow.
        require(localDomain == Domain.ETHEREUM, UnsupportedDomain());
        ISuperchainStandardBridge standardBridge;
        if (destinationDomain == Domain.OP_MAINNET) {
            standardBridge = OPTIMISM_STANDARD_BRIDGE;
        } else if (destinationDomain == Domain.BASE) {
            standardBridge = BASE_STANDARD_BRIDGE;
        } else {
            revert UnsupportedDomain();
        }
        require(address(standardBridge) != address(0), ZeroAddress());
        // WARNING: Contract doesn't maintain an input/output token mapping which could result in a mismatch.
        // If the output token is wrong then the input tokens will be lost.
        // Notice: In case of minGasLimit being too low, the message could be retried on the destination chain.
        (address outputToken, uint32 minGasLimit, bytes memory message) =
            abi.decode(extraData, (address, uint32, bytes));
        if (token == WRAPPED_NATIVE_TOKEN) {
            require(outputToken == address(0), InvalidOutputToken());
            WRAPPED_NATIVE_TOKEN.withdraw(amount);
            standardBridge.bridgeETHTo{value: amount}(destinationPool, minGasLimit, message);
            return;
        }

        _validateOutputToken(_addressToBytes32(outputToken), destinationDomain, outputTokens);
        token.forceApprove(address(standardBridge), amount);
        standardBridge.bridgeERC20To(
            address(token),
            outputToken,
            destinationPool,
            amount,
            minGasLimit,
            message
        );
    }
}
