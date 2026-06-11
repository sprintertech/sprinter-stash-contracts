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
import {LiquidityPoolBase} from "./LiquidityPool.sol";
import {HelperLib} from "./utils/HelperLib.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";

/// @title A version of the liquidity pool contract that uses Aave pool.
/// Deposits of the liquidity token are supplied to Aave as collateral.
/// It's possible to borrow other tokens from Aave pool upon providing the MPC signature.
/// The contract verifies that the borrowing won't put it at risk of liquidation
/// by checking the custom LTV and health factor that should be configured with a safety margin.
/// Repayment to Aave is done by transferring the assets to the contract and calling the repay function.
/// Rebalancing is done by depositing and withdrawing assets from Aave pool by the liquidity admin role.
/// Profit from borrowing and accrued interest from supplying liquidity is accounted for
/// and can be withdrawn by the WITHDRAW_PROFIT_ROLE.
/// @notice Upgradeable.
/// @author Tanya Bushenyova <tanya@chainsafe.io>
contract LiquidityPoolAave is LiquidityPoolBase {
    using SafeERC20 for IERC20;

    uint256 private constant MULTIPLIER = 10000;

    IAavePoolAddressesProvider immutable public AAVE_POOL_PROVIDER;
    IAavePool immutable public AAVE_POOL;
    IERC20 immutable public ATOKEN;

    /// @custom:storage-location erc7201:sprinter.storage.LiquidityPoolAave
    struct LiquidityPoolAaveStorage {
        uint32 minHealthFactor;
        uint32 defaultLTV;
        mapping(address token => uint256 ltv) borrowTokenLTV;
        mapping(address token => uint256 snapshot) debtSnapshot;
    }

    bytes32 private constant STORAGE_LOCATION = 0xa970a5090ccc92b642632de0c6d5b2804c2710d470362ae3bea13b9a38a0d300;

    error TokenLtvExceeded();
    error NoCollateral();
    error HealthFactorTooLow();
    error CollateralNotSupported();
    error CannotWithdrawAToken();

    event SuppliedToAave(uint256 amount);
    event BorrowTokenLTVSet(address token, uint256 oldLTV, uint256 newLTV);
    event HealthFactorSet(uint256 oldHealthFactor, uint256 newHealthFactor);
    event DefaultLTVSet(uint256 oldDefaultLTV, uint256 newDefaultLTV);
    event WithdrawnFromAave(address to, uint256 amount);

    constructor(
        address liquidityToken,
        address aavePoolProvider,
        address wrappedNativeToken
    ) LiquidityPoolBase(liquidityToken, wrappedNativeToken) {
        ERC7201Helper.validateStorageLocation(STORAGE_LOCATION, "sprinter.storage.LiquidityPoolAave");
        require(aavePoolProvider != address(0), ZeroAddress());
        IAavePoolAddressesProvider provider = IAavePoolAddressesProvider(aavePoolProvider);
        AAVE_POOL_PROVIDER = provider;
        AAVE_POOL = IAavePool(provider.getPool());
        AaveDataTypes.ReserveData memory collateralData = AAVE_POOL.getReserveData(address(liquidityToken));
        ATOKEN = IERC20(collateralData.aTokenAddress);
        IAavePoolDataProvider poolDataProvider = IAavePoolDataProvider(provider.getPoolDataProvider());
        (,,,,,bool usageAsCollateralEnabled,,,bool isActive, bool isFrozen) =
            poolDataProvider.getReserveConfigurationData(liquidityToken);
        require(usageAsCollateralEnabled && isActive && !isFrozen, CollateralNotSupported());
    }

    function initialize(
        address admin,
        address mpcAddress_,
        address signerAddress_,
        uint32 minHealthFactor_,
        uint32 defaultLTV_
    ) external initializer {
        _initializeBase(admin, mpcAddress_, signerAddress_);
        _setMinHealthFactor(minHealthFactor_);
        _setDefaultLTV(defaultLTV_);
    }

    // Public getters for storage variables

    function minHealthFactor() public view returns (uint32) {
        return _getStorage().minHealthFactor;
    }

    function defaultLTV() public view returns (uint32) {
        return _getStorage().defaultLTV;
    }

    function borrowTokenLTV(address token) public view returns (uint256) {
        return _getStorage().borrowTokenLTV[token];
    }

    // Admin functions

    function setBorrowTokenLTVs(
        address[] calldata tokens,
        uint32[] calldata ltvs
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 length = HelperLib.validatePositiveLength(tokens.length, ltvs.length);
        LiquidityPoolAaveStorage storage $ = _getStorage();
        for (uint256 i = 0; i < length; ++i) {
            address token = tokens[i];
            uint256 ltv = ltvs[i];
            uint256 oldLTV = $.borrowTokenLTV[token];
            $.borrowTokenLTV[token] = ltv;
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
        LiquidityPoolAaveStorage storage $ = _getStorage();
        uint32 oldDefaultLTV = $.defaultLTV;
        $.defaultLTV = defaultLTV_;
        emit DefaultLTVSet(oldDefaultLTV, defaultLTV_);
    }

    function _setMinHealthFactor(uint32 minHealthFactor_) internal {
        LiquidityPoolAaveStorage storage $ = _getStorage();
        uint32 oldHealthFactor = $.minHealthFactor;
        $.minHealthFactor = minHealthFactor_;
        emit HealthFactorSet(oldHealthFactor, minHealthFactor_);
    }

    function _checkTokenLTV(uint256 totalCollateralBase, address borrowToken) internal view {
        LiquidityPoolAaveStorage storage $ = _getStorage();
        uint256 ltv = $.borrowTokenLTV[borrowToken];
        if (ltv == 0) ltv = $.defaultLTV;
        if (ltv >= MULTIPLIER) {
            // No limit on borrowing this token.
            return;
        }

        require(totalCollateralBase > 0, NoCollateral());

        AaveDataTypes.ReserveData memory borrowTokenData = AAVE_POOL.getReserveData(borrowToken);
        uint256 totalBorrowed = HelperLib.balanceOfThis(borrowTokenData.variableDebtTokenAddress);

        uint256 price = IAaveOracle(AAVE_POOL_PROVIDER.getPriceOracle()).getAssetPrice(borrowToken);

        uint256 borrowDecimals = IERC20Metadata(borrowToken).decimals();
        uint256 borrowUnit = 10 ** borrowDecimals;

        // (totalBorrowedBase) * MULTIPLIER / totalCollateralBase =
        // = (totalBorrowed * price / borrowUnit) * MULTIPLIER / totalCollateralBase
        uint256 currentLtv = totalBorrowed * price * MULTIPLIER / (totalCollateralBase * borrowUnit);
        require(currentLtv <= ltv, TokenLtvExceeded());
    }

    function _depositLogic(uint256 amount) internal override {
        ASSETS.forceApprove(address(AAVE_POOL), amount);
        AAVE_POOL.supply(address(ASSETS), amount, address(this), NO_REFERRAL);
        emit SuppliedToAave(amount);
    }

    function _borrowLogic(address borrowToken, uint256 amount, uint256 /*profit*/, bytes memory context)
        internal virtual override returns (bytes memory)
    {
        AAVE_POOL.borrow(
            borrowToken,
            amount,
            INTEREST_RATE_MODE_VARIABLE,
            NO_REFERRAL,
            address(this)
        );
        address vdToken = AAVE_POOL.getReserveData(borrowToken).variableDebtTokenAddress;
        (uint256 currentDebt, uint256 accruedDebt) =
            _processDebtSnapshot(IERC20(borrowToken), IERC20(vdToken), amount);
        if (accruedDebt > 0) {
            _getStorageBase().accruedProfit[borrowToken] -= int256(accruedDebt);
        }
        _getStorage().debtSnapshot[borrowToken] = currentDebt;
        return context;
    }

    function _afterBorrowLogic(address borrowToken, bytes memory /*context*/) internal virtual view override {
        uint256 totalCollateralBase = _checkHealthFactor();
        _checkTokenLTV(totalCollateralBase, borrowToken);
    }

    function _afterBorrowManyLogic(address[] memory borrowTokens, bytes memory /*context*/)
        internal virtual view override
    {
        uint256 totalCollateralBase = _checkHealthFactor();

        uint256 length = borrowTokens.length;
        for (uint256 i = 0; i < length; ++i) {
            _checkTokenLTV(totalCollateralBase, borrowTokens[i]);
        }
    }

    function _withdrawLogic(address to, uint256 amount) internal override {
        require(HelperLib.balanceOfThis(ATOKEN) >= amount, InsufficientLiquidity());
        AAVE_POOL.withdraw(address(ASSETS), amount, to);
        _checkHealthFactor();
        emit WithdrawnFromAave(to, amount);
    }

    function _withdrawProfitLogic(IERC20 token) internal virtual override returns (uint256) {
        require(token != ATOKEN, CannotWithdrawAToken());

        int256 profit = _getStorageBase().accruedProfit[address(token)];
        if (token == ASSETS) {
            // Profit from collateral yield: aToken appreciation above deposited principal.
            uint256 aTokenBalance = HelperLib.balanceOfThis(ATOKEN);
            uint256 deposited = _getStorageBase().totalDeposited;
            if (aTokenBalance > deposited) {
                uint256 interest = aTokenBalance - deposited;
                _withdrawLogic(address(this), interest);
                profit += int256(interest);
            }
        }

        // Doing it here so that balance from earlier withdrawal is accounted for.
        uint256 balance = HelperLib.balanceOfThis(token);
        address vdToken = AAVE_POOL.getReserveData(address(token)).variableDebtTokenAddress;
        // Withdrawing a token that cannot be borrowed.
        if (vdToken == address(0)) {
            return balance;
        }

        LiquidityPoolAaveStorage storage $aave = _getStorage();
        (uint256 currentDebt, uint256 accruedDebt) = _processDebtSnapshot(token, IERC20(vdToken), 0);
        profit -= int256(accruedDebt);

        uint256 virtualBalance = balance + _getStorageBase().directDebt[address(token)];
        uint256 withdrawableSurplus = 0;
        if (virtualBalance > currentDebt) {
            withdrawableSurplus = virtualBalance - currentDebt;
            // profit = max(profit, withdrawableSurplus)
            if (int256(withdrawableSurplus) > profit) {
                profit = int256(withdrawableSurplus);
            }
        }

        if (int256(balance) < profit) {
            uint256 shortfall = uint256(profit) - balance;
            AAVE_POOL.borrow(address(token), shortfall, INTEREST_RATE_MODE_VARIABLE, NO_REFERRAL, address(this));
            _checkHealthFactor();
            currentDebt += shortfall;
        }

        $aave.debtSnapshot[address(token)] = currentDebt;
        if (profit > 0) {
            _getStorageBase().accruedProfit[address(token)] = 0;
            return uint256(profit);
        } else {
            _getStorageBase().accruedProfit[address(token)] = profit;
            return 0;
        }
    }

    function _processDebtSnapshot(
        IERC20 borrowToken,
        IERC20 vdToken,
        uint256 justBorrowed
    ) internal view returns (uint256, uint256) {
        uint256 currentDebt = HelperLib.balanceOfThis(vdToken);
        uint256 snapshot = _getStorage().debtSnapshot[address(borrowToken)] + justBorrowed;
        uint256 accruedDebt = 0;
        if (currentDebt > snapshot) {
            accruedDebt = currentDebt - snapshot;
        }
        return (currentDebt, accruedDebt);
    }

    function _repay(address[] calldata borrowTokens) internal override {
        _repayAccessCheck();
        // Repay token to aave
        bool success;
        for (uint256 i = 0; i < borrowTokens.length; i++) {
            success = _repayToken(borrowTokens[i], type(uint256).max) || success;
        }
        require(success, NothingToRepay());
    }

    function _repayToken(address borrowToken, uint256 maxRepayAmount) internal returns(bool success) {
        _wrapIfNative(IERC20(borrowToken));

        address vdToken = AAVE_POOL.getReserveData(borrowToken).variableDebtTokenAddress;
        if (vdToken == address(0)) return false;

        uint256 outstandingDebt = HelperLib.balanceOfThis(vdToken);
        if (outstandingDebt == 0) return false;

        uint256 balance = HelperLib.balanceOfThis(borrowToken);
        if (balance == 0) return false;

        uint256 repayAmount = Math.min(Math.min(balance, maxRepayAmount), outstandingDebt);
        if (repayAmount == 0) return false;

        uint256 repaidAmount = _executeRepay(borrowToken, repayAmount);

        emit Repaid(borrowToken, repaidAmount);
        return true;
    }

    function _repayDirect(
        address[] calldata borrowTokens,
        uint256[] calldata maxAmounts
    ) internal override {
        uint256 length = HelperLib.validatePositiveLength(borrowTokens.length, maxAmounts.length);
        bool success;
        for (uint256 i = 0; i < length; i++) {
            success = _repayTokenDirect(borrowTokens[i], maxAmounts[i]) || success;
        }
        require(success, NothingToRepay());
    }

    function _repayTokenDirect(address borrowToken, uint256 maxRepayAmount)
        internal
        returns(bool success)
    {
        address vdToken = AAVE_POOL.getReserveData(borrowToken).variableDebtTokenAddress;
        if (vdToken == address(0)) return false;

        LiquidityPoolBaseStorage storage $ = _getStorageBase();
        uint256 outstandingDebt = $.directDebt[borrowToken];
        uint256 repayAmount = Math.min(outstandingDebt, maxRepayAmount);
        if (repayAmount == 0) return false;

        unchecked { $.directDebt[borrowToken] = outstandingDebt - repayAmount; }
        IERC20(borrowToken).safeTransferFrom(_msgSender(), address(this), repayAmount);
        _executeRepay(borrowToken, repayAmount);

        emit RepaidDirect(borrowToken, repayAmount);
        return true;
    }

    function _executeRepay(address borrowToken, uint256 repayAmount) private returns(uint256 repaidAmount) {
        address vdToken = AAVE_POOL.getReserveData(borrowToken).variableDebtTokenAddress;
        (, uint256 accruedDebt) = _processDebtSnapshot(IERC20(borrowToken), IERC20(vdToken), 0);
        if (accruedDebt > 0) {
            _getStorageBase().accruedProfit[borrowToken] -= int256(accruedDebt);
        }
        IERC20(borrowToken).forceApprove(address(AAVE_POOL), repayAmount);
        repaidAmount = AAVE_POOL.repay(borrowToken, repayAmount, 2, address(this));
        _getStorage().debtSnapshot[borrowToken] = HelperLib.balanceOfThis(vdToken);
    }

    function _checkHealthFactor() internal view returns (uint256) {
        (uint256 totalCollateralBase,,,,, uint256 currentHealthFactor) = AAVE_POOL.getUserAccountData(address(this));
        require(
            currentHealthFactor / (1e18 / MULTIPLIER) >= _getStorage().minHealthFactor,
            HealthFactorTooLow()
        );
        return totalCollateralBase;
    }

    // @notice Only takes into account LTV, without HF.
    function _calculateMaximumTokenBorrowBase(
        uint256 totalCollateralBase,
        address borrowToken
    ) internal view returns (uint256, uint256 tokenUnit, uint256 tokenPrice) {
        LiquidityPoolAaveStorage storage $ = _getStorage();
        uint256 ltv = $.borrowTokenLTV[borrowToken];
        if (ltv == 0) ltv = $.defaultLTV;
        if (ltv > MULTIPLIER) {
            ltv = MULTIPLIER;
        }

        uint256 totalAvailableBorrowsBase = totalCollateralBase * ltv / MULTIPLIER;

        AaveDataTypes.ReserveData memory borrowTokenData = AAVE_POOL.getReserveData(borrowToken);
        uint256 debt = HelperLib.balanceOfThis(borrowTokenData.variableDebtTokenAddress);

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

    function _balance(IERC20 token) internal view virtual override returns (uint256) {
        address reserveAToken = AAVE_POOL.getReserveAToken(address(token));
        if (reserveAToken == address(0)) {
            return 0;
        }
        uint256 maxBorrowByAaveReserves = HelperLib.balanceOf(token, reserveAToken);

        (uint256 totalCollateralBase, uint256 totalDebtBase,,, uint256 ltv,) =
            AAVE_POOL.getUserAccountData(address(this));
        uint256 maxBorrowsByMinHealthFactor = _calculateAvailableBorrowsBase(
            totalCollateralBase, totalDebtBase, ltv, _getStorage().minHealthFactor
        );
        (uint256 maxBorrowByTokenLTV, uint256 tokenUnit, uint256 tokenPrice) =
            _calculateMaximumTokenBorrowBase(totalCollateralBase, address(token));

        uint256 availableTokenBorrowBase = Math.min(maxBorrowsByMinHealthFactor, maxBorrowByTokenLTV);

        return Math.min(availableTokenBorrowBase * tokenUnit / tokenPrice, maxBorrowByAaveReserves);
    }

    function _repayAccessCheck() internal view virtual {
        // Public access.
        return;
    }

    function _getStorage() internal pure returns (LiquidityPoolAaveStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
