// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

interface ILiquidityPool {
    struct SwapParams {
        address fillToken;
        uint256 fillAmount;
        bytes swapData;
    }

    function deposit(uint256 amount) external;

    function depositWithPull(uint256 amount) external;

    function withdraw(address to, uint256 amount) external;

    function borrow(
        address borrowToken,
        uint256 amount,
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

    function repay(address[] calldata borrowTokens) external;

    function withdrawProfit(
        address[] calldata tokens,
        address to
    ) external;

    function pauseBorrow() external;

    function unpauseBorrow() external;

    function paused() external view returns (bool);

    function pause() external;

    function unpause() external;

    function ASSETS() external returns (IERC20);
}
