// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

library HelperLib {
    error InvalidLength();

    function validatePositiveLength(uint256 a, uint256 b) internal pure returns (uint256) {
        require(a == b && a > 0, InvalidLength());
        return a; 
    }
}
