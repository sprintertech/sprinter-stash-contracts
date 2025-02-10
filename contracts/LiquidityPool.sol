// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {AccessControlUpgradeable} from '@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol';
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {UUPSUpgradeable} from '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {ERC7201Helper} from './utils/ERC7201Helper.sol';
import {IPoolAddressesProvider} from './interfaces/IPoolAddressesProvider.sol';
import {IPool, DataTypes} from './interfaces/IPool.sol';
import {IAaveOracle} from './interfaces/IAaveOracle.sol';

contract LiquidityPool is AccessControlUpgradeable, EIP712Upgradeable {
    using SafeERC20 for ERC20;
    using ECDSA for bytes32;
    using Math for uint256;

    uint256 private constant _HUNDRED_PERCENT = 10000;
    bytes32 private constant _BORROW_TYPEHASH =
        keccak256("Borrow(address borrowToken,uint256 amount,address target,bytes targetCallData)");

    ERC20 immutable public COLLATERAL;
    IPoolAddressesProvider immutable public AAVE_POOL_PROVIDER;

    /// @custom:storage-location erc7201:sprinter.storage.LiquidityPool
    struct LiquidityPoolStorage {
        // token  address to ltv
        mapping(address => uint256) _borrowTokenLTV;
        address _MPCAddress;
        uint256 _minHealthFactor;
        uint256 _defaultLTV;
    }

    struct UserAccountData {
        uint256 totalCollateralBase;
        uint256 totalDebtBase;
        uint256 availableBorrowsBase;
        uint256 currentLiquidationThreshold;
        uint256 ltv;
        uint256 healthFactor;
    }

    bytes32 private constant StorageLocation = 0x457f6fd6dd83195f8bfff9ee98f2df1d90fadb996523baa2b453217997285e00;
    
    bytes32 public constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";
    bytes32 public constant WITHDRAW_PROFIT_ROLE = "WITHDRAW_PROFIT_ROLE";

    error ZeroAddress();
    error InvalidSignature();
    error TokenLtvExceeded();
    error NoCollateral();
    error HealthFactorTooLow();
    error TargetCallFailed();
    error CannotRepayCollateral();
    error NothingToRepay();
    error TokenNotSupported(address borrowToken);
    error CannotWithdrawProfitCollateral();
    error TokenHasDebt();

    event SuppliedToAave(uint256 amount);
    event SolverStatusSet(address solver, bool status);
    event BorrowTokenLTVSet(address token, uint256 ltv);
    event HealthFactorSet(uint256 healthFactor);
    event DefaultLTVSet(uint256 defaultLTV);
    event Borrowed(address borrowToken, uint256 amount, address caller, address target);
    event Repaid(address borrowToken, uint256 repaidAmount);
    event WithdrawnFromAave(uint256 amount);
    event ProfitWithdrawn(address token, address to, uint256 amount);

    constructor(address liquidityToken, address aavePoolProvider) {
        ERC7201Helper.validateStorageLocation(
            StorageLocation,
            'sprinter.storage.LiquidityPool'
        );
        if (liquidityToken == address(0)) revert ZeroAddress();
        COLLATERAL = ERC20(liquidityToken);
        if (aavePoolProvider == address(0)) revert ZeroAddress();
        AAVE_POOL_PROVIDER = IPoolAddressesProvider(aavePoolProvider);
        _disableInitializers();
    }

    function initialize(address admin, uint256 minHealthFactor, uint256 defaultLTV, address MPCAddress) external initializer() {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        __EIP712_init("LiquidityPool", "1.0.0");
        LiquidityPoolStorage storage $ = _getStorage();
        $._minHealthFactor = minHealthFactor;
        $._defaultLTV = defaultLTV;
        $._MPCAddress = MPCAddress;
    }

    function deposit() public {
        // called after receiving deposit in USDC
        // transfer all USDC balance to AAVE
        IPool pool = IPool(AAVE_POOL_PROVIDER.getPool());
        uint256 amount = COLLATERAL.balanceOf(address(this));
        if (amount == 0) revert NoCollateral();
        COLLATERAL.forceApprove(address(pool), amount);
        pool.supply(address(COLLATERAL), amount, address(this), 0);
        emit SuppliedToAave(amount);
    }

    function borrow(
        address borrowToken,
        uint256 amount,
        address target,
        bytes calldata targetCallData,
        bytes calldata signature) 
    public {
        // - Validate MPC signature
        _validateMPCSignature(borrowToken, amount, target, targetCallData, signature);
        
        // - Borrow the requested source token from the lending protocol against available USDC liquidity.
        IPool pool = IPool(AAVE_POOL_PROVIDER.getPool());
        pool.borrow(
            borrowToken,
            amount,
            2,
            0,
            address(this)
        );

        // - Check health factor for user after borrow (can be read from aave, getUserAccountData)
        UserAccountData memory userAccountData;
        (
            userAccountData.totalCollateralBase,
            userAccountData.totalDebtBase,
            userAccountData.availableBorrowsBase,
            userAccountData.currentLiquidationThreshold,
            userAccountData.ltv,
            userAccountData.healthFactor
        ) = pool.getUserAccountData(address(this));
        if (userAccountData.healthFactor <  _getStorage()._minHealthFactor) revert HealthFactorTooLow();

        // check ltv for token
        _checkTokenLTV(pool, borrowToken);
        // - Approve the borrowed funds for transfer to the recipient specified in the MPC signature.
        ERC20(borrowToken).forceApprove(target, amount);
        // - Invoke the recipient's address with calldata provided in the MPC signature to complete the operation securely.
        (bool success,) = target.call(targetCallData);
        if (!success) revert TargetCallFailed();
        emit Borrowed(borrowToken, amount, msg.sender, target);
    }

    function repay(address[] calldata borrowTokens) public {
        // Repay token to aave
        bool success;
        IPool pool = IPool(AAVE_POOL_PROVIDER.getPool());
        for (uint256 i = 0; i < borrowTokens.length; i++) {
            success = _repay(borrowTokens[i], pool, success);
        }
        if (!success) revert NothingToRepay();
    }

    // Admin functions

    function withdraw(address to, uint256 amount) public onlyRole(LIQUIDITY_ADMIN_ROLE) {
        // get USDC from AAVE
        IPool pool = IPool(AAVE_POOL_PROVIDER.getPool());
        uint256 withdrawn = pool.withdraw(address(COLLATERAL), amount, to);
        // assert(withdrawn == amount);
        // health factor after withdraw
        UserAccountData memory userAccountData;
        (
            userAccountData.totalCollateralBase,
            userAccountData.totalDebtBase,
            userAccountData.availableBorrowsBase,
            userAccountData.currentLiquidationThreshold,
            userAccountData.ltv,
            userAccountData.healthFactor
        ) = pool.getUserAccountData(address(this));
        if (userAccountData.healthFactor <  _getStorage()._minHealthFactor) revert HealthFactorTooLow();
        emit WithdrawnFromAave(withdrawn);
    }

   function withdrawProfit(address token, address to, uint256 amount) public onlyRole(WITHDRAW_PROFIT_ROLE) {
        // check that not collateral
        if (token == address(COLLATERAL)) revert CannotWithdrawProfitCollateral();
        // check that no debt
        IPool pool = IPool(AAVE_POOL_PROVIDER.getPool());
        DataTypes.ReserveData memory tokenData = pool.getReserveData(token);
        if (tokenData.variableDebtTokenAddress != address(0)) {
            uint256 totalBorrowed = ERC20(tokenData.variableDebtTokenAddress).balanceOf(address(this));
            if (totalBorrowed != 0) revert TokenHasDebt();
        }
        // withdraw from this contract
        ERC20(token).safeTransfer(to, amount);
        emit ProfitWithdrawn(token, to, amount);
    }

    function setBorrowTokenLTV(address token, uint256 ltv) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _getStorage()._borrowTokenLTV[token] = ltv;
        emit BorrowTokenLTVSet(token, ltv);
    }

    function setDefaultLTV(uint256 defaultLTV) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _getStorage()._defaultLTV = defaultLTV;
        emit DefaultLTVSet(defaultLTV);
    }

    function setHealthFactor(uint256 healthFactor) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _getStorage()._minHealthFactor = healthFactor;
        emit HealthFactorSet(healthFactor);
    }

    // Internal functions

    function _getStorage() private pure returns (LiquidityPoolStorage storage $) {
        assembly {
            $.slot := StorageLocation
        }
    }

    function _validateMPCSignature(
        address borrowToken,
        uint256 amount,
        address target,
        bytes calldata targetCallData,
        bytes calldata signature
    ) private view {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            _BORROW_TYPEHASH,
            borrowToken,
            amount,
            target,
            keccak256(targetCallData)
        )));
        address signer = digest.recover(signature);
        if (signer != _getStorage()._MPCAddress) revert InvalidSignature();
    }

    function _checkTokenLTV(IPool pool, address borrowToken) private view {
        LiquidityPoolStorage storage $ = _getStorage();
        uint256 ltv = $._borrowTokenLTV[borrowToken];
        if (ltv == 0) ltv = $._defaultLTV;

        DataTypes.ReserveData memory collateralData = pool.getReserveData(address(COLLATERAL));
        uint256 totalCollateral = ERC20(collateralData.aTokenAddress).balanceOf(address(this));
        if (totalCollateral == 0) revert NoCollateral();

        DataTypes.ReserveData memory borrowTokenData = pool.getReserveData(borrowToken);
        if (borrowTokenData.variableDebtTokenAddress == address(0)) revert TokenNotSupported(borrowToken);
        uint256 totalBorrowed = ERC20(borrowTokenData.variableDebtTokenAddress).balanceOf(address(this));

        IAaveOracle oracle = IAaveOracle(AAVE_POOL_PROVIDER.getPriceOracle());
        address[] memory assets = new address[](2);
        assets[0] = borrowToken;
        assets[1] = address(COLLATERAL);

        uint256[] memory prices = oracle.getAssetsPrices(assets);


        uint256 collateralDecimals = COLLATERAL.decimals();
        uint256 borrowDecimals = ERC20(borrowToken).decimals();

        uint256 collateralUnit = 10 ** collateralDecimals;
        uint256 borrowUnit = 10 ** borrowDecimals;

        uint256 currentLtv;
        uint256 totalBorrowPrice = totalBorrowed * prices[0] * _HUNDRED_PERCENT;
        uint256 collateralPrice = totalCollateral * prices[1];

        if (collateralUnit > borrowUnit) {
            currentLtv = totalBorrowPrice.mulDiv(collateralUnit / borrowUnit, collateralPrice);
       } else if (borrowDecimals > collateralDecimals) {
            currentLtv = totalBorrowPrice / (collateralPrice * (borrowUnit / collateralUnit));
        } else {
            currentLtv = totalBorrowPrice / collateralPrice;
        }
        if (currentLtv > ltv) revert TokenLtvExceeded();
    }

    function _repay(address borrowToken, IPool pool, bool successInput) internal returns(bool success) {
        success = successInput;
        if (borrowToken == address(COLLATERAL)) revert CannotRepayCollateral();
        DataTypes.ReserveData memory borrowTokenData = pool.getReserveData(borrowToken);
        if (borrowTokenData.variableDebtTokenAddress == address(0)) revert TokenNotSupported(borrowToken);
        uint256 totalBorrowed = ERC20(borrowTokenData.variableDebtTokenAddress).balanceOf(address(this));
        if (totalBorrowed == 0) return success;
        uint256 borrowTokenBalance = ERC20(borrowToken).balanceOf(address(this));
        if (borrowTokenBalance == 0) return success;
        uint256 amountToRepay = borrowTokenBalance < totalBorrowed ? borrowTokenBalance : type(uint256).max;
        ERC20(borrowToken).forceApprove(address(pool), amountToRepay);
        uint256 repaidAmount = pool.repay(
            borrowToken,
            amountToRepay,
            2,
            address(this)
        );
        emit Repaid(borrowToken, repaidAmount);
        success = true;
    }

    // View functions

    function defaultLTV() public view returns (uint256) {
        return _getStorage()._defaultLTV;
    }

    function healthFactor() public view returns (uint256) {
        return _getStorage()._minHealthFactor;
    }

    function mpcAddress() public view returns (address) {
        return _getStorage()._MPCAddress;
    }

    function borrowTokenLTV(address token) public view returns (uint256) {
        return _getStorage()._borrowTokenLTV[token];
    }
}
