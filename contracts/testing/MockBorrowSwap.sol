// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockBorrowSwap {
    using SafeERC20 for IERC20;

    error BorrowCallFailed();

    event Swapped(bytes swapData);

    function callBorrow(address pool, bytes calldata borrowData) external {
        (bool success,) = pool.call(borrowData);
        if (!success) revert BorrowCallFailed();
    }

    function swap(bytes calldata swapData) external {
        (
            address borrowToken,
            uint256 borrowAmount,
            address fillToken,
            address from,
            uint256 fillAmount
        ) = abi.decode(swapData, (address, uint256, address, address, uint256));
        IERC20(borrowToken).safeTransferFrom(msg.sender, address(this), borrowAmount);
        IERC20(fillToken).safeTransferFrom(from, address(this), fillAmount);
        IERC20(fillToken).forceApprove(msg.sender, fillAmount);
        emit Swapped(swapData);
    }
}
