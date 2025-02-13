// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILiquidityPool} from "../interfaces/ILiquidityPool.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract TestLiquidityPool is ILiquidityPool, AccessControl {
    IERC20 public immutable COLLATERAL;
    bytes32 public constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";

    event Deposit();

    constructor(IERC20 collateral) {
        COLLATERAL = collateral;
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(LIQUIDITY_ADMIN_ROLE, _msgSender());
    }

    function deposit() external override {
        emit Deposit();
    }

    function withdraw(address to, uint256 amount) external override onlyRole(LIQUIDITY_ADMIN_ROLE) returns (uint256) {
        SafeERC20.safeTransfer(COLLATERAL, to, amount);
        return amount;
    }
}
