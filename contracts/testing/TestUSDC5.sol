// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestUSDC5 is ERC20 {
    constructor() ERC20("Test USD 5dec", "USDC5") {}

    function decimals() public pure override returns (uint8) {
        return 5;
    }
}
