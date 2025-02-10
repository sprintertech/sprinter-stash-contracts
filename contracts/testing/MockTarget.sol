// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

contract MockTarget {
    using SafeERC20 for IERC20;

    event DataReceived(bytes data);

    function fulfill(IERC20 token, uint256 amount, bytes calldata data) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit DataReceived(data);
    }
}
