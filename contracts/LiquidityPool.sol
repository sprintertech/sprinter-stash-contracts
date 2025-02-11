// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
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
    using BitMaps for BitMaps.BitMap;

    uint256 private constant HUNDRED_PERCENT = 10000;
    bytes32 private constant BORROW_TYPEHASH = keccak256(
        "Borrow("
            "address borrowToken,"
            "uint256 amount,"
            "address target,"
            "bytes targetCallData,"
            "uint256 nonce,"
            "uint256 deadline"
        ")"
    );

    ERC20 immutable public COLLATERAL;
    IPoolAddressesProvider immutable public AAVE_POOL_PROVIDER;

    /// @custom:storage-location erc7201:sprinter.storage.LiquidityPool
    struct LiquidityPoolStorage {
        // token address to ltv
        mapping(address => uint256) borrowTokenLTV;
        BitMaps.BitMap usedNonces;
        address MPCAddress;
        uint256 minHealthFactor;
        uint256 defaultLTV;
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
    error NothingToRepay();
    error TokenNotSupported(address borrowToken);
    error CannotWithdrawProfitCollateral();
    error TokenHasDebt();
    error ExpiredSignature();
    error NonceAlreadyUsed();

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

    function initialize(address admin, uint256 minHealthFactor, uint256 defaultLTV_, address MPCAddress) external initializer() {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        __EIP712_init("LiquidityPool", "1.0.0");
        LiquidityPoolStorage storage $ = _getStorage();
        $.minHealthFactor = minHealthFactor;
        $.defaultLTV = defaultLTV_;
        $.MPCAddress = MPCAddress;
    }

    function deposit() public {
        // called after receiving deposit in USDC
        // transfer all USDC balance to AAVE
        uint256 amount = COLLATERAL.balanceOf(address(this));
        if (amount == 0) revert NoCollateral();
        IPool pool = IPool(AAVE_POOL_PROVIDER.getPool());
        (, uint256 repaidAmount) = _repay(address(COLLATERAL), pool, true);
        amount -= repaidAmount;
        if (amount == 0) return;
        COLLATERAL.forceApprove(address(pool), amount);
        pool.supply(address(COLLATERAL), amount, address(this), 0);
        emit SuppliedToAave(amount);
    }

    function borrow(
        address borrowToken,
        uint256 amount,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature) 
    public {
        // - Validate MPC signature
        _validateMPCSignature(borrowToken, amount, target, targetCallData, nonce, deadline, signature);
        
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
        if (userAccountData.healthFactor < _getStorage().minHealthFactor) revert HealthFactorTooLow();

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
            (success,) = _repay(borrowTokens[i], pool, success);
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
        if (userAccountData.healthFactor < _getStorage().minHealthFactor) revert HealthFactorTooLow();
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
        _getStorage().borrowTokenLTV[token] = ltv;
        emit BorrowTokenLTVSet(token, ltv);
    }

    function setDefaultLTV(uint256 defaultLTV_) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _getStorage().defaultLTV = defaultLTV_;
        emit DefaultLTVSet(defaultLTV_);
    }

    function setHealthFactor(uint256 minHealthFactor) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _getStorage().minHealthFactor = minHealthFactor;
        emit HealthFactorSet(minHealthFactor);
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
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) private {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            BORROW_TYPEHASH,
            borrowToken,
            amount,
            target,
            keccak256(targetCallData),
            nonce,
            deadline
        )));
        address signer = digest.recover(signature);
        LiquidityPoolStorage storage $ = _getStorage();
        if (signer != $.MPCAddress) revert InvalidSignature();
        if ($.usedNonces.get(nonce)) revert NonceAlreadyUsed();
        $.usedNonces.set(nonce);
        if (passed(deadline)) revert ExpiredSignature();
    }

    function _checkTokenLTV(IPool pool, address borrowToken) private view {
        LiquidityPoolStorage storage $ = _getStorage();
        uint256 ltv = $.borrowTokenLTV[borrowToken];
        if (ltv == 0) ltv = $.defaultLTV;

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
        uint256 totalBorrowPrice = totalBorrowed * prices[0] * HUNDRED_PERCENT;
        uint256 collateralPrice = totalCollateral * prices[1];

        if (collateralUnit > borrowUnit) {
            currentLtv = totalBorrowPrice.mulDiv(collateralUnit / borrowUnit, collateralPrice);
        } else {
            currentLtv = totalBorrowPrice / (collateralPrice * (borrowUnit / collateralUnit));
        }
        if (currentLtv > ltv) revert TokenLtvExceeded();
    }

    function _repay(address borrowToken, IPool pool, bool successInput)
        internal
        returns(bool success, uint256 repaidAmount) 
    {
        success = successInput;
        DataTypes.ReserveData memory borrowTokenData = pool.getReserveData(borrowToken);
        if (borrowTokenData.variableDebtTokenAddress == address(0)) revert TokenNotSupported(borrowToken);
        uint256 totalBorrowed = ERC20(borrowTokenData.variableDebtTokenAddress).balanceOf(address(this));
        if (totalBorrowed == 0) return (success, 0);
        uint256 borrowTokenBalance = ERC20(borrowToken).balanceOf(address(this));
        if (borrowTokenBalance == 0) return (success, 0);
        uint256 amountToRepay = borrowTokenBalance < totalBorrowed ? borrowTokenBalance : type(uint256).max;
        ERC20(borrowToken).forceApprove(address(pool), amountToRepay);
        repaidAmount = pool.repay(
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
        return _getStorage().defaultLTV;
    }

    function healthFactor() public view returns (uint256) {
        return _getStorage().minHealthFactor;
    }

    function mpcAddress() public view returns (address) {
        return _getStorage().MPCAddress;
    }

    function borrowTokenLTV(address token) public view returns (uint256) {
        return _getStorage().borrowTokenLTV[token];
    }

    function timeNow() internal view returns (uint32) {
        return uint32(block.timestamp);
    }

    function passed(uint256 timestamp) internal view returns (bool) {
        return timeNow() > timestamp;
    }
}
