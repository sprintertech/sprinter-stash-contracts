// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IWrappedNativeToken is IERC20 {
    event Deposit(address indexed to, uint256 amount);

    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
