// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

interface IBorrower {
    function swap(bytes calldata data) external;
}
