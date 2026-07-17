// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {StashDex} from "../StashDex.sol";

/// @dev Testing contract simulating a previous StashDex implementation.
contract OldStashDex is StashDex {
    constructor(address oracle, address receiver) StashDex(oracle, receiver) {}

    /// @dev Testing helper — writes totalBorrowed directly to simulate accumulated swap debt.
    function setTotalBorrowed(address token, uint96 amount) external {
        _getStorage().tokenConfig[token].totalBorrowed = amount;
    }
}
