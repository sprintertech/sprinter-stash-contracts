// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {TestERC20Token} from "@crytic/properties/contracts/ERC4626/util/TestERC20Token.sol";

contract TestShareToken is TestERC20Token {
    constructor(string memory _name, string memory _symbol, uint8 _decimals) 
        TestERC20Token(_name, _symbol, _decimals)
    {
    }

    function spendAllowance(address owner, address spender, uint256 value) external {
        uint256 currentAllowance = allowance[owner][spender];
        if (currentAllowance < type(uint256).max) {
            if (currentAllowance < value) {
                revert("ERC20InsufficientAllowance");
            }
            unchecked {
                allowance[owner][spender] = currentAllowance  - value;
            }
        }
    }
}
