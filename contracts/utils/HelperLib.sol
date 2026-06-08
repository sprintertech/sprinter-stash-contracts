// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

library HelperLib {
    error InvalidLength();

    function validatePositiveLength(uint256 a, uint256 b) internal pure returns (uint256) {
        require(a == b && a > 0, InvalidLength());
        return a; 
    }

    function balanceOfThis(IERC20 token) internal view returns (uint256) {
        return balanceOf(token, address(this));
    }

    function balanceOfThis(address token) internal view returns (uint256) {
        return balanceOfThis(IERC20(token));
    }

    function balanceOf(IERC20 token, address owner) internal view returns (uint256) {
        return token.balanceOf(owner);
    }
}
