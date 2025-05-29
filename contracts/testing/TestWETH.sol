// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestWETH is ERC20 {
    event Deposit(address indexed to, uint256 amount);

    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }
}
