// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LiquidityPool} from "./LiquidityPool.sol";

/// @title A version of the liquidity pool contract that supports multiple assets for borrowing.
/// The idea is that pool has to allow repayments with any token equivalent to the liquidity token.
/// It's possible to borrow any tokens that are present in the pool.
/// @author Tanya Bushenyova <tanya@chainsafe.io>
contract LiquidityPoolStablecoin is LiquidityPool {
    constructor(
        address liquidityToken,
        address admin,
        address mpcAddress_,
        address wrappedNativeToken,
        address signerAddress_
    ) LiquidityPool(liquidityToken, admin, mpcAddress_, wrappedNativeToken, signerAddress_) {
    }

    function _borrowLogic(address /*borrowToken*/, uint256 /*amount*/, uint256 /*profit*/, bytes memory context)
        internal pure override returns (bytes memory)
    {
        return context;
    }

    function _withdrawProfitLogic(IERC20 token) internal override returns (uint256) {
        uint256 assetBalance = ASSETS.balanceOf(address(this));
        uint256 deposited = _totalDeposited;
        uint256 virtualAssets = assetBalance + directDebt[address(ASSETS)];
        bool surplusAllowed = virtualAssets >= deposited;
        uint256 currentBalance = token.balanceOf(address(this));
        uint256 withdrawableSurplus = 0;
        if (surplusAllowed) {
            if (token == ASSETS) {
                withdrawableSurplus = Math.min(virtualAssets - deposited, currentBalance);
            } else {
                withdrawableSurplus = currentBalance;
            }
        }
        int256 profit = accruedProfit[address(token)];
        // Cannot be negative but can be zero.
        if (profit <= 0) return withdrawableSurplus;
        uint256 toWithdraw = Math.min(currentBalance, uint256(profit));
        accruedProfit[address(token)] = profit - int256(toWithdraw);
        return Math.max(toWithdraw, withdrawableSurplus);
    }

    function _balance(IERC20 token) internal view override returns (uint256) {
        uint256 result = token.balanceOf(address(this));
        if (token == WRAPPED_NATIVE_TOKEN) {
            result += address(this).balance;
        }
        return result;
    }
}
