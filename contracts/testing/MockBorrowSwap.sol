// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBorrower} from "../interfaces/IBorrower.sol";
import {NATIVE_TOKEN} from "../utils/Constants.sol";
import {ILiquidityPool} from "../interfaces/ILiquidityPool.sol";
import {IWrappedNativeToken} from "../interfaces/IWrappedNativeToken.sol";

contract MockBorrowSwap is IBorrower {
    using SafeERC20 for IERC20;

    error BorrowCallFailed();
    error NativeFillFailed();

    event Swapped(bytes swapData);

    receive() external payable {
        // For WETH.
    }

    function callBorrow(address pool, bytes calldata borrowData) external {
        (bool success,) = pool.call(borrowData);
        if (!success) revert BorrowCallFailed();
    }

    function swap(
        address borrowToken,
        uint256 borrowAmount,
        address fillToken,
        uint256 fillAmount,
        bytes calldata swapData
    ) external override {
        IERC20(borrowToken).safeTransferFrom(msg.sender, address(this), borrowAmount);
        _finalizeSwap(fillToken, fillAmount, swapData);
    }

    function swapMany(
        address[] calldata borrowTokens,
        uint256[] calldata borrowAmounts,
        address fillToken,
        uint256 fillAmount,
        bytes calldata swapData
    ) external override {
        for (uint256 i = 0; i < borrowTokens.length; ++i) {
            IERC20(borrowTokens[i]).safeTransferFrom(msg.sender, address(this), borrowAmounts[i]);
        }
        _finalizeSwap(fillToken, fillAmount, swapData);
    }

    function _finalizeSwap(address fillToken, uint256 fillAmount, bytes calldata swapData) private {
        (address from) = abi.decode(swapData, (address));
        if (fillToken == address(NATIVE_TOKEN)) {
            IWrappedNativeToken weth = ILiquidityPool(msg.sender).WRAPPED_NATIVE_TOKEN();
            IERC20(weth).safeTransferFrom(from, address(this), fillAmount);
            weth.withdraw(fillAmount);
            (bool success, ) = payable(msg.sender).call{value: fillAmount}("");
            require(success, NativeFillFailed());
        } else {
            IERC20(fillToken).safeTransferFrom(from, address(this), fillAmount);
            IERC20(fillToken).forceApprove(msg.sender, fillAmount);
        }
        emit Swapped(swapData);
    }
}
