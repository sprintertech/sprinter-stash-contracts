// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {LiquidityPoolAave} from "./LiquidityPoolAave.sol";
import {ILiquidityPoolLongTerm} from "./interfaces/ILiquidityPoolLongTerm.sol";
import {HelperLib} from "./utils/HelperLib.sol";

/// @title Same as LiquidityPoolAave, but when borrowing the contract will first try to fulfill
/// the request with own funds, in which case health factor and ltv are not checked.
/// If there are not enough funds, the contract will borrow from Aave.
/// @notice Upgradeable.
/// @author Oleksii Matiiasevych <oleksii@sprinter.tech>
contract LiquidityPoolAaveLongTerm is LiquidityPoolAave, ILiquidityPoolLongTerm {
    bytes32 private constant REPAYER_ROLE = "REPAYER_ROLE";
    bytes32 private constant BORROW_LONG_TERM_ROLE = "BORROW_LONG_TERM_ROLE";

    error CollateralLongTermBorrowNotAllowed();

    event BorrowLongTerm(address token, uint256 amount);

    constructor(
        address liquidityToken,
        address aavePoolProvider,
        address wrappedNativeToken
    ) LiquidityPoolAave(liquidityToken, aavePoolProvider, wrappedNativeToken) {}

    function _repayAccessCheck() internal view override onlyRole(REPAYER_ROLE) {
        // Permissioned access through a modifier.
        return;
    }

    /// @notice Could be used to increase health factor without full repayment.
    function repayPartial(address[] calldata borrowTokens, uint256[] calldata amounts) external override {
        _repayAccessCheck();
        uint256 length = HelperLib.validatePositiveLength(borrowTokens.length, amounts.length);
        bool success;
        for (uint256 i = 0; i < length; i++) {
            success = _repayToken(borrowTokens[i], amounts[i]) || success;
        }
        require(success, NothingToRepay());
    }

    /// @notice Prepare funds on the contract for future borrow() calls.
    function borrowLongTerm(address borrowToken, uint256 amount)
        external override whenNotPaused() onlyRole(BORROW_LONG_TERM_ROLE)
    {
        require(borrowToken != address(ASSETS), CollateralLongTermBorrowNotAllowed());
        bytes memory context = super._borrowLogic(borrowToken, amount, 0, "");
        super._afterBorrowLogic(borrowToken, context);

        emit BorrowLongTerm(borrowToken, amount);
    }

    /// @dev borrowMany() might fail if trying to borrow duplicate tokens.
    function _borrowLogic(address borrowToken, uint256 amount, uint256 profit, bytes memory context)
        internal override returns (bytes memory)
    {
        uint256 availableBalance = HelperLib.balanceOfThis(borrowToken);
        uint8 borrowFlag = 0;
        if (availableBalance < amount) {
            super._borrowLogic(borrowToken, amount - availableBalance, profit, context);
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

    function _balance(IERC20 token) internal view override returns (uint256) {
        return super._balance(token) + HelperLib.balanceOfThis(token);
    }
}
