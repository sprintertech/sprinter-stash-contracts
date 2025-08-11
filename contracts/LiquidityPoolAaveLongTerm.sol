// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {LiquidityPoolAave, NO_REFERRAL, INTEREST_RATE_MODE_VARIABLE} from "./LiquidityPoolAave.sol";

/// @title Same as LiquidityPoolAave, but when borrowing the contract will first try to fulfill
/// the request with own funds. If there are not enough funds, the contract will borrow from Aave.
/// @author Oleksii Matiiasevych <oleksii@sprinter.tech>
contract LiquidityPoolAaveLongTerm is LiquidityPoolAave {
    constructor(
        address liquidityToken,
        address aavePoolProvider,
        address admin,
        address mpcAddress_,
        uint32 minHealthFactor_,
        uint32 defaultLTV_,
        address wrappedNativeToken
    ) LiquidityPoolAave(
        liquidityToken,
        aavePoolProvider,
        admin,
        mpcAddress_,
        minHealthFactor_,
        defaultLTV_,
        wrappedNativeToken
    ) {}
    
    function _borrowLogic(address borrowToken, uint256 amount, bytes memory context)
        internal override returns (bytes memory)
    {
        uint256 availableBalance = IERC20(borrowToken).balanceOf(address(this));
        uint8 borrowFlag = 0;
        if (availableBalance < amount) {
            super._borrowLogic(borrowToken, amount - availableBalance, context);
            borrowFlag = 1;
        }
        return abi.encodePacked(context, borrowFlag);
    }

    function _afterBorrowLogic(address borrowToken, bytes memory context)
        internal view override
    {
        uint8 borrowFlag = uint8(context[0]);
        if (borrowFlag == 1) {
            super._afterBorrowLogic(borrowToken, context);
        }
    }

    function _afterBorrowManyLogic(address[] memory borrowTokens, bytes memory context) internal view override {
        uint256 totalCollateralBase = 0;

        uint256 length = borrowTokens.length;
        for (uint256 i = 0; i < length; ++i) {
            uint8 borrowFlag = uint8(context[i]);
            if (borrowFlag == 1) {
                if (totalCollateralBase == 0) {
                    totalCollateralBase = _checkHealthFactor();
                }
                _checkTokenLTV(totalCollateralBase, borrowTokens[i]);
            }
        }
    }
}
