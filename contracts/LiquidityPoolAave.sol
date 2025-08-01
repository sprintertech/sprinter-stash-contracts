// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAavePoolAddressesProvider} from "./interfaces/IAavePoolAddressesProvider.sol";
import {IAavePool, AaveDataTypes, NO_REFERRAL, INTEREST_RATE_MODE_VARIABLE} from "./interfaces/IAavePool.sol";
import {IAaveOracle} from "./interfaces/IAaveOracle.sol";
import {IAavePoolDataProvider} from "./interfaces/IAavePoolDataProvider.sol";
import {LiquidityPool} from "./LiquidityPool.sol";

/// @title A version of the liquidity pool contract that uses Aave pool.
/// Deposits of the liquidity token are supplied to Aave as collateral.
/// It's possible to borrow other tokens from Aave pool upon providing the MPC signature.
/// The contract verifies that the borrowing won't put it at risk of liquidation
/// by checking the custom LTV and health factor that should be configured with a safety margin.
/// Repayment to Aave is done by transferring the assets to the contract and calling the repay function.
/// Rebalancing is done by depositing and withdrawing assets from Aave pool by the liquidity admin role.
/// Profit from borrowing and accrued interest from supplying liquidity is accounted for
/// and can be withdrawn by the WITHDRAW_PROFIT_ROLE.
/// @author Tanya Bushenyova <tanya@chainsafe.io>
contract LiquidityPoolAave is LiquidityPool {
    using SafeERC20 for IERC20;

    uint256 private constant MULTIPLIER = 10000;

    IAavePoolAddressesProvider immutable public AAVE_POOL_PROVIDER;
    IAavePool immutable public AAVE_POOL;
    IERC20 immutable public ATOKEN;
    uint8 immutable public ASSETS_DECIMALS;

    uint32 public minHealthFactor;
    uint32 public defaultLTV;

    mapping(address token => uint256 ltv) public borrowTokenLTV;

    error TokenLtvExceeded();
    error NoCollateral();
    error HealthFactorTooLow();
    error NothingToRepay();
    error CollateralNotSupported();
    error CannotWithdrawAToken();
    error InvalidLength();

    event SuppliedToAave(uint256 amount);
    event BorrowTokenLTVSet(address token, uint256 oldLTV, uint256 newLTV);
    event HealthFactorSet(uint256 oldHealthFactor, uint256 newHealthFactor);
    event DefaultLTVSet(uint256 oldDefaultLTV, uint256 newDefaultLTV);
    event WithdrawnFromAave(address to, uint256 amount);
    event Repaid(address borrowToken, uint256 repaidAmount);

    constructor(
        address liquidityToken,
        address aavePoolProvider,
        address admin,
        address mpcAddress_,
        uint32 minHealthFactor_,
        uint32 defaultLTV_,
        address wrappedNativeToken
    ) LiquidityPool(liquidityToken, admin, mpcAddress_, wrappedNativeToken) {
        ASSETS_DECIMALS = IERC20Metadata(liquidityToken).decimals();
        require(aavePoolProvider != address(0), ZeroAddress());
        IAavePoolAddressesProvider provider = IAavePoolAddressesProvider(aavePoolProvider);
        AAVE_POOL_PROVIDER = provider;
        AAVE_POOL = IAavePool(provider.getPool());
        AaveDataTypes.ReserveData memory collateralData = AAVE_POOL.getReserveData(address(liquidityToken));
        ATOKEN = IERC20(collateralData.aTokenAddress);
        IAavePoolDataProvider poolDataProvider = IAavePoolDataProvider(provider.getPoolDataProvider());
        (,,,,,bool usageAsCollateralEnabled,,,,) = poolDataProvider.getReserveConfigurationData(liquidityToken);
        require(usageAsCollateralEnabled, CollateralNotSupported());
        _setMinHealthFactor(minHealthFactor_);
        _setDefaultLTV(defaultLTV_);
    }

    function repay(address[] calldata borrowTokens) external override {
        // Repay token to aave
        bool success;
        for (uint256 i = 0; i < borrowTokens.length; i++) {
            success = _repay(borrowTokens[i]) || success;
        }
        require(success, NothingToRepay());
    }

    // Admin functions

    function setBorrowTokenLTVs(
        address[] calldata tokens,
        uint32[] calldata ltvs
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tokens.length == ltvs.length, InvalidLength());
        for (uint256 i = 0; i < tokens.length; ++i) {
            address token = tokens[i];
            uint256 ltv = ltvs[i];
            uint256 oldLTV = borrowTokenLTV[token];
            borrowTokenLTV[token] = ltv;
            emit BorrowTokenLTVSet(token, oldLTV, ltv);
        }
    }

    function setDefaultLTV(uint32 defaultLTV_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setDefaultLTV(defaultLTV_);
    }

    function setMinHealthFactor(uint32 minHealthFactor_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setMinHealthFactor(minHealthFactor_);
    }

    // Internal functions

    function _setDefaultLTV(uint32 defaultLTV_) internal {
        uint32 oldDefaultLTV = defaultLTV;
        defaultLTV = defaultLTV_;
        emit DefaultLTVSet(oldDefaultLTV, defaultLTV_);
    }

    function _setMinHealthFactor(uint32 minHealthFactor_) internal {
        uint32 oldHealthFactor = minHealthFactor;
        minHealthFactor = minHealthFactor_;
        emit HealthFactorSet(oldHealthFactor, minHealthFactor_);
    }

    function _checkTokenLTV(uint256 totalCollateralBase, address borrowToken) private view {
        uint256 ltv = borrowTokenLTV[borrowToken];
        if (ltv == 0) ltv = defaultLTV;
        if (ltv >= MULTIPLIER) {
            // No limit on borrowing this token.
            return;
        }

        require(totalCollateralBase > 0, NoCollateral());

        AaveDataTypes.ReserveData memory borrowTokenData = AAVE_POOL.getReserveData(borrowToken);
        uint256 totalBorrowed = IERC20(borrowTokenData.variableDebtTokenAddress).balanceOf(address(this));

        uint256 price = IAaveOracle(AAVE_POOL_PROVIDER.getPriceOracle()).getAssetPrice(borrowToken);

        uint256 borrowDecimals = IERC20Metadata(borrowToken).decimals();
        uint256 borrowUnit = 10 ** borrowDecimals;

        // (totalBorrowedBase) * MULTIPLIER / totalCollateralBase =
        // = (totalBorrowed * price / borrowUnit) * MULTIPLIER / totalCollateralBase
        uint256 currentLtv = totalBorrowed * price * MULTIPLIER / (totalCollateralBase * borrowUnit);
        require(currentLtv <= ltv, TokenLtvExceeded());
    }

    function _depositLogic(address /*caller*/, uint256 amount) internal override {
        ASSETS.forceApprove(address(AAVE_POOL), amount);
        AAVE_POOL.supply(address(ASSETS), amount, address(this), NO_REFERRAL);
        emit SuppliedToAave(amount);
    }

    function _borrowLogic(address borrowToken, uint256 amount, address /*target*/) internal override {
        AAVE_POOL.borrow(
            borrowToken,
            amount,
            INTEREST_RATE_MODE_VARIABLE,
            NO_REFERRAL,
            address(this)
        );
    }

    function _afterBorrowLogic(address borrowToken, address /*target*/) internal view override {
        uint256 totalCollateralBase = _checkHealthFactor();

        _checkTokenLTV(totalCollateralBase, borrowToken);
    }

    function _afterBorrowManyLogic(address[] memory borrowTokens, address /*target*/) internal view override {
        uint256 totalCollateralBase = _checkHealthFactor();

        uint256 length = borrowTokens.length;
        for (uint256 i = 0; i < length; ++i) {
            _checkTokenLTV(totalCollateralBase, borrowTokens[i]);
        }
    }

    function _withdrawLogic(address to, uint256 amount) internal override {
        require(ATOKEN.balanceOf(address(this)) >= amount, InsufficientLiquidity());
        AAVE_POOL.withdraw(address(ASSETS), amount, to);
        _checkHealthFactor();
        emit WithdrawnFromAave(to, amount);
    }

    function _withdrawProfitLogic(IERC20 token) internal override returns (uint256) {
        // Check that not aToken
        require(token != ATOKEN, CannotWithdrawAToken());
        // Check that the token doesn't have debt
        AaveDataTypes.ReserveData memory tokenData = AAVE_POOL.getReserveData(address(token));
        if (tokenData.variableDebtTokenAddress != address(0)) {
            uint256 debt = IERC20(tokenData.variableDebtTokenAddress).balanceOf(address(this));
            if (debt > 0) return 0;
        }
        uint256 totalBalance = token.balanceOf(address(this));
        if (token == ASSETS) {
            // Calculate accrued interest from deposits.
            uint256 interest = ATOKEN.balanceOf(address(this)) - totalDeposited;
            if (interest > 0) {
                _withdrawLogic(address(this), interest);
                totalBalance += interest;
            }
        }
        return totalBalance;
    }

    function _repay(address borrowToken)
        internal
        returns(bool success)
    {
        _wrapIfNative(IERC20(borrowToken));
        AaveDataTypes.ReserveData memory borrowTokenData = AAVE_POOL.getReserveData(borrowToken);
        if (borrowTokenData.variableDebtTokenAddress == address(0)) return false;
        uint256 totalBorrowed = IERC20(borrowTokenData.variableDebtTokenAddress).balanceOf(address(this));
        if (totalBorrowed == 0) return false;
        uint256 borrowTokenBalance = IERC20(borrowToken).balanceOf(address(this));
        if (borrowTokenBalance == 0) return false;
        IERC20(borrowToken).forceApprove(address(AAVE_POOL), Math.min(borrowTokenBalance, totalBorrowed));
        uint256 repaidAmount = AAVE_POOL.repay(
            borrowToken,
            borrowTokenBalance,
            2,
            address(this)
        );
        emit Repaid(borrowToken, repaidAmount);
        return true;
    }

    function _checkHealthFactor() internal view returns (uint256) {
        (uint256 totalCollateralBase,,,,, uint256 currentHealthFactor) = AAVE_POOL.getUserAccountData(address(this));
        require(currentHealthFactor / (1e18 / MULTIPLIER) >= minHealthFactor, HealthFactorTooLow());

        return totalCollateralBase;
    }

    // @notice Only takes into account LTV, without HF.
    function _calculateMaximumTokenBorrowBase(
        uint256 totalCollateralBase,
        address borrowToken
    ) internal view returns (uint256, uint256 tokenUnit, uint256 tokenPrice) {
        uint256 ltv = borrowTokenLTV[borrowToken];
        if (ltv == 0) ltv = defaultLTV;
        if (ltv > MULTIPLIER) {
            ltv = MULTIPLIER;
        }

        uint256 totalAvailableBorrowsBase = totalCollateralBase * ltv / MULTIPLIER;

        AaveDataTypes.ReserveData memory borrowTokenData = AAVE_POOL.getReserveData(borrowToken);
        uint256 debt = IERC20(borrowTokenData.variableDebtTokenAddress).balanceOf(address(this));

        tokenPrice = IAaveOracle(AAVE_POOL_PROVIDER.getPriceOracle()).getAssetPrice(borrowToken);

        uint256 borrowDecimals = IERC20Metadata(borrowToken).decimals();
        tokenUnit = 10 ** borrowDecimals;

        uint256 debtBase = debt * tokenPrice / tokenUnit;

        uint256 result = totalAvailableBorrowsBase <= debtBase ? 0 : totalAvailableBorrowsBase - debtBase;

        return (result, tokenUnit, tokenPrice);
    }

    // @notice Only takes into account minimalHealthFactor, on top of the Aave config LTV.
    function _calculateAvailableBorrowsBase(
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 ltv,
        uint256 minHF
    ) internal pure returns (uint256) {
        if (minHF < MULTIPLIER) {
            minHF = MULTIPLIER;
        }
        uint256 totalAvailableBorrowsBase = totalCollateralBase * ltv / minHF;

        if (totalAvailableBorrowsBase <= totalDebtBase) {
          return 0;
        }

        totalAvailableBorrowsBase = totalAvailableBorrowsBase - totalDebtBase;
        return totalAvailableBorrowsBase;
    }

    function _balance(IERC20 token) internal view override returns (uint256) {
        address reserveAToken = AAVE_POOL.getReserveAToken(address(token));
        if (reserveAToken == address(0)) {
            return 0;
        }
        uint256 maxBorrowByAaveReserves = token.balanceOf(reserveAToken);

        (uint256 totalCollateralBase, uint256 totalDebtBase,,, uint256 ltv,) =
            AAVE_POOL.getUserAccountData(address(this));
        uint256 maxBorrowsByMinHealthFactor = _calculateAvailableBorrowsBase(
            totalCollateralBase, totalDebtBase, ltv, minHealthFactor
        );
        (uint256 maxBorrowByTokenLTV, uint256 tokenUnit, uint256 tokenPrice) =
            _calculateMaximumTokenBorrowBase(totalCollateralBase, address(token));

        uint256 availableTokenBorrowBase = Math.min(maxBorrowsByMinHealthFactor, maxBorrowByTokenLTV);

        return Math.min(availableTokenBorrowBase * tokenUnit / tokenPrice, maxBorrowByAaveReserves);
    }
}
