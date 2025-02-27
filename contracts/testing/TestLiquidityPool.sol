// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILiquidityPool} from "../interfaces/ILiquidityPool.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract TestLiquidityPool is ILiquidityPool, AccessControl {
    IERC20 public immutable ASSETS;
    bytes32 public constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";

    event Deposit();

    constructor(IERC20 assets) {
        ASSETS = assets;
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(LIQUIDITY_ADMIN_ROLE, _msgSender());
    }

    function deposit(uint256) external override {
        emit Deposit();
    }

    function withdraw(address to, uint256 amount) external override onlyRole(LIQUIDITY_ADMIN_ROLE) returns (uint256) {
        SafeERC20.safeTransfer(ASSETS, to, amount);
        return amount;
    }

    function depositWithPull(uint256) external pure override {
        return;
    }

    function borrow(
        address,
        uint256,
        address,
        bytes calldata,
        uint256,
        uint256,
        bytes calldata
    ) external pure override {
        return;
    }

    function borrowAndSwap(
        address,
        uint256,
        SwapParams calldata,
        address,
        bytes calldata,
        uint256,
        uint256,
        bytes calldata
    ) external pure override {
        return;
    }

    function repay(address[] calldata) external pure override {
        return;
    }

    function withdrawProfit(
        address[] calldata,
        address
    ) external pure override {
        return;
    }

    function pauseBorrow() external pure override {
        return;
    }

    function unpauseBorrow() external pure override {
        return;
    }

    function paused() external pure returns (bool) {
        return false;
    }

    function pause() external pure override {
        return;
    }

    function unpause() external pure override {
        return;
    }
}
