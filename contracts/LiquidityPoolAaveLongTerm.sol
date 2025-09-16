// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {LiquidityPoolAave} from "./LiquidityPoolAave.sol";
import {AaveDataTypes} from "./interfaces/IAavePool.sol";

/// @title Same as LiquidityPoolAave, but when borrowing the contract will first try to fulfill
/// the request with own funds, in which case health factor and ltv are not checked.
/// If there are not enough funds, the contract will borrow from Aave.
/// @author Oleksii Matiiasevych <oleksii@sprinter.tech>
contract LiquidityPoolAaveLongTerm is LiquidityPoolAave {
    bytes32 constant public REPAYER_ROLE = "REPAYER_ROLE";
    bytes32 constant public BORROW_LONG_TERM_ROLE = "BORROW_LONG_TERM_ROLE";

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

    function _repayAccessCheck() internal view override onlyRole(REPAYER_ROLE) {
        // Permissioned access through a modifier.
        return;
    }

    /// @notice Could be used to increase health factor without full repayment.
    function repayPartial(address[] calldata borrowTokens, uint256[] calldata amounts) external {
        _repayAccessCheck();
        require(borrowTokens.length == amounts.length, InvalidLength());
        bool success;
        for (uint256 i = 0; i < borrowTokens.length; i++) {
            success = _repay(borrowTokens[i], amounts[i]) || success;
        }
        require(success, NothingToRepay());
    }

    /// @notice Prepare funds on the contract for future borrow() calls.
    function borrowLongTerm(address borrowToken, uint256 amount)
        external whenNotPaused() onlyRole(BORROW_LONG_TERM_ROLE)
    {
        bytes memory context = super._borrowLogic(borrowToken, amount, "");
        super._afterBorrowLogic(borrowToken, context);
    }
    
    /// @dev borrowMany() might fail if trying to borrow duplicate tokens.
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

    function _withdrawProfitLogic(IERC20 token) internal override returns (uint256) {
        // Check that not aToken
        require(token != ATOKEN, CannotWithdrawAToken());
        uint256 totalBalance = token.balanceOf(address(this));
        if (token == ASSETS) {
            // Calculate accrued interest from deposits.
            uint256 interest = ATOKEN.balanceOf(address(this)) - totalDeposited;
            if (interest > 0) {
                _withdrawLogic(address(this), interest);
                totalBalance += interest;
            }
        }
        // If there is debt, subtract it from profit
        AaveDataTypes.ReserveData memory tokenData = AAVE_POOL.getReserveData(address(token));
        if (tokenData.variableDebtTokenAddress != address(0)) {
            uint256 debt = IERC20(tokenData.variableDebtTokenAddress).balanceOf(address(this));
            if (totalBalance > debt) {
                totalBalance -= debt;
            } else {
                totalBalance = 0;
            }
        }
        return totalBalance;
    }

    function _balance(IERC20 token) internal view override returns (uint256) {
        return super._balance(token) + token.balanceOf(address(this));
    }
}
