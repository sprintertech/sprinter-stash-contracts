// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LiquidityPool} from "./LiquidityPool.sol";

/// @title A version of the liquidity pool contract that supports multiple assets for borrowing.
/// It's possible to borrow any tokens that are present in the pool.
/// @author Tanya Bushenyova <tanya@chainsafe.io>
contract LiquidityPoolStablecoin is LiquidityPool {
    using SafeERC20 for IERC20;

    error WithdrawProfitDenied();

    constructor(
        address liquidityToken,
        address admin,
        address mpcAddress_
    ) LiquidityPool(liquidityToken, admin, mpcAddress_) {
        return;
    }

    function _borrowLogic(address /*borrowToken*/, uint256 /*amount*/, address /*target*/) internal override {
        return;
    }

    function _withdrawProfitLogic(IERC20 token) internal override returns (uint256) {
        uint256 assetBalance = ASSETS.balanceOf(address(this));
        uint256 deposited = totalDeposited;
        require(assetBalance >= deposited, WithdrawProfitDenied());
        if (token == ASSETS) return assetBalance - deposited;
        return token.balanceOf(address(this));
    }
}
