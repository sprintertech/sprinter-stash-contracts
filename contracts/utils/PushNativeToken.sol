// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

contract PushNativeToken {
    constructor(address payable to) payable {
        assembly ("memory-safe") {
            selfdestruct(to)
            // Making the deploy contract code empty to not waste gas.
            return(0, 0)
        }
    }
}
