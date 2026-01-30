// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IWrappedNativeToken} from "./IWrappedNativeToken.sol";
import {ILiquidityPoolBase} from "./ILiquidityPoolBase.sol";

interface ILiquidityPool is ILiquidityPoolBase {
    struct SwapParams {
        address fillToken;
        uint256 fillAmount;
        bytes swapData;
    }

    function borrow(
        address borrowToken,
        uint256 amount,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function borrowMany(
        address[] calldata borrowTokens,
        uint256[] calldata amounts,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function borrowAndSwap(
        address borrowToken,
        uint256 amount,
        SwapParams calldata swapInputData,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function borrowAndSwapMany(
        address[] calldata borrowTokens,
        uint256[] calldata amounts,
        SwapParams calldata swapInputData,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function repay(address[] calldata borrowTokens) external;

    function pauseBorrow() external;

    function unpauseBorrow() external;

    function balance(IERC20 token) external view returns (uint256);

    function WRAPPED_NATIVE_TOKEN() external view returns (IWrappedNativeToken);
}
