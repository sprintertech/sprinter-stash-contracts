// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

interface IBorrower {
    function swap(
        address borrowToken,
        uint256 borrowAmount,
        address fillToken,
        uint256 fillAmount,
        bytes calldata data
    ) external;

    function swapMany(
        address[] calldata borrowTokens,
        uint256[] calldata borrowAmounts,
        address fillToken,
        uint256 fillAmount,
        bytes calldata data
    ) external;
}
