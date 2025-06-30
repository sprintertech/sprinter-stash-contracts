// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBorrower} from "../interfaces/IBorrower.sol";

contract MockBorrowSwap is IBorrower {
    using SafeERC20 for IERC20;

    error BorrowCallFailed();

    event Swapped(bytes swapData);

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
        (address from) = abi.decode(swapData, (address));
        IERC20(borrowToken).safeTransferFrom(msg.sender, address(this), borrowAmount);
        IERC20(fillToken).safeTransferFrom(from, address(this), fillAmount);
        IERC20(fillToken).forceApprove(msg.sender, fillAmount);
        emit Swapped(swapData);
    }
}
