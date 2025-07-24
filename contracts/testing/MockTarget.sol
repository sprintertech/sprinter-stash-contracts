// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {NATIVE_TOKEN} from "../utils/Constants.sol";

contract MockTarget {
    using SafeERC20 for IERC20;

    error IncorrectAmount();

    event DataReceived(bytes data);

    function fulfill(IERC20 token, uint256 amount, bytes calldata data) external payable {
        _fulfill(token, amount);
        emit DataReceived(data);
    }

    function fulfillMany(IERC20[] calldata tokens, uint256[] calldata amounts, bytes calldata data) external payable {
        for (uint256 i = 0; i < tokens.length; ++i) {
            _fulfill(tokens[i], amounts[i]);
        }
        emit DataReceived(data);
    }

    function _fulfill(IERC20 token, uint256 amount) private {
        if (token == NATIVE_TOKEN) {
            require(amount == msg.value, IncorrectAmount());
        } else {
            token.safeTransferFrom(msg.sender, address(this), amount);
        }
    }
}
