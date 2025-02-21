// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";
import {IAavePoolAddressesProvider} from "./interfaces/IAavePoolAddressesProvider.sol";
import {IAavePool, AaveDataTypes, NO_REFERRAL, INTEREST_RATE_MODE_VARIABLE} from "./interfaces/IAavePool.sol";
import {IAaveOracle} from "./interfaces/IAaveOracle.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {IAavePoolDataProvider} from "./interfaces/IAavePoolDataProvider.sol";

contract LiquidityPool is ILiquidityPool, AccessControlUpgradeable, EIP712Upgradeable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using Math for uint256;
    using BitMaps for BitMaps.BitMap;

    uint256 private constant MULTIPLIER = 1e18;
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

    IERC20 immutable public ASSETS;
    IAavePoolAddressesProvider immutable public AAVE_POOL_PROVIDER;

    /// @custom:storage-location erc7201:sprinter.storage.LiquidityPool
    struct LiquidityPoolStorage {
        mapping(address token => uint256 ltv) borrowTokenLTV;
        BitMaps.BitMap usedNonces;
        address mpcAddress;
        uint256 minHealthFactor;
        uint256 defaultLTV;
    }

    bytes32 private constant STORAGE_LOCATION = 0x457f6fd6dd83195f8bfff9ee98f2df1d90fadb996523baa2b453217997285e00;
    
    bytes32 public constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";
    bytes32 public constant WITHDRAW_PROFIT_ROLE = "WITHDRAW_PROFIT_ROLE";

    error ZeroAddress();
    error InvalidSignature();
    error TokenLtvExceeded();
    error NotEnoughToDeposit();
    error NoCollateral();
    error HealthFactorTooLow();
    error TargetCallFailed();
    error NothingToRepay();
    error CannotWithdrawProfitAssets();
    error ExpiredSignature();
    error NonceAlreadyUsed();
    error NotEnoughBalance();
    error CollateralNotSupported();

    event SuppliedToAave(uint256 amount);
    event BorrowTokenLTVSet(address token, uint256 oldLTV, uint256 newLTV);
    event HealthFactorSet(uint256 oldHealthFactor, uint256 newHealthFactor);
    event DefaultLTVSet(uint256 oldDefaultLTV, uint256 newDefaultLTV);
    event Repaid(address borrowToken, uint256 repaidAmount);
    event WithdrawnFromAave(address to, uint256 amount);
    event ProfitWithdrawn(address token, address to, uint256 amount);

    constructor(address liquidityToken, address aavePoolProvider) {
        ERC7201Helper.validateStorageLocation(
            STORAGE_LOCATION,
            "sprinter.storage.LiquidityPool"
        );
        require(liquidityToken != address(0), ZeroAddress());
        ASSETS = IERC20(liquidityToken);
        require(aavePoolProvider != address(0), ZeroAddress());
        AAVE_POOL_PROVIDER = IAavePoolAddressesProvider(aavePoolProvider);
        IAavePoolDataProvider poolDataProvider = IAavePoolDataProvider(AAVE_POOL_PROVIDER.getPoolDataProvider());
        (,,,,,bool usageAsCollateralEnabled,,,,) = poolDataProvider.getReserveConfigurationData(address(ASSETS));
        require(usageAsCollateralEnabled, CollateralNotSupported());
        _disableInitializers();
    }

    function initialize(
        address admin,
        uint256 minHealthFactor,
        uint256 defaultLTV_,
        address mpcAddress_
    ) external initializer() {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        __EIP712_init("LiquidityPool", "1.0.0");
        LiquidityPoolStorage storage $ = _getStorage();
        $.minHealthFactor = minHealthFactor;
        $.defaultLTV = defaultLTV_;
        $.mpcAddress = mpcAddress_;
    }

    function deposit(uint256 amount) external override {
        // called after receiving deposit in USDC
        // transfer all USDC balance to AAVE
        uint256 balance = ASSETS.balanceOf(address(this));
        require(balance >= amount, NotEnoughToDeposit());
        IAavePool pool = IAavePool(AAVE_POOL_PROVIDER.getPool());
        ASSETS.forceApprove(address(pool), amount);
        pool.supply(address(ASSETS), amount, address(this), NO_REFERRAL);
        emit SuppliedToAave(amount);
    }

    function borrow(
        address borrowToken,
        uint256 amount,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        // - Validate MPC signature
        _validateMPCSignature(borrowToken, amount, target, targetCallData, nonce, deadline, signature);
        
        // - Borrow the requested source token from the lending protocol against available USDC liquidity.
        IAavePool pool = IAavePool(AAVE_POOL_PROVIDER.getPool());
        pool.borrow(
            borrowToken,
            amount,
            INTEREST_RATE_MODE_VARIABLE,
            NO_REFERRAL,
            address(this)
        );

        // - Check health factor for user after borrow (can be read from aave, getUserAccountData)
        (,,,,,uint256 currentHealthFactor) = pool.getUserAccountData(address(this));
        require(currentHealthFactor >= _getStorage().minHealthFactor, HealthFactorTooLow());

        // check ltv for token
        _checkTokenLTV(pool, borrowToken);
        // - Approve the borrowed funds for transfer to the recipient specified in the MPC signature.
        IERC20(borrowToken).forceApprove(target, amount);
        // - Invoke the recipient's address with calldata provided in the MPC signature to complete
        // the operation securely.
        (bool success,) = target.call(targetCallData);
        require(success, TargetCallFailed());
    }

    function repay(address[] calldata borrowTokens) external {
        // Repay token to aave
        bool success;
        IAavePool pool = IAavePool(AAVE_POOL_PROVIDER.getPool());
        for (uint256 i = 0; i < borrowTokens.length; i++) {
            (success,) = _repay(borrowTokens[i], pool, success);
        }
        require(success, NothingToRepay());
    }

    // Admin functions

    function withdraw(address to, uint256 amount) external override onlyRole(LIQUIDITY_ADMIN_ROLE) returns (uint256) {
        // get USDC from AAVE
        IAavePool pool = IAavePool(AAVE_POOL_PROVIDER.getPool());
        uint256 withdrawn = pool.withdraw(address(ASSETS), amount, to);
        // health factor after withdraw
        (,,,,,uint256 currentHealthFactor) = pool.getUserAccountData(address(this));
        require(currentHealthFactor >= _getStorage().minHealthFactor, HealthFactorTooLow());
        emit WithdrawnFromAave(to, withdrawn);
        return withdrawn;
    }

    function withdrawProfit(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(WITHDRAW_PROFIT_ROLE) returns (uint256) {
        // check that not assets
        require(token != address(ASSETS), CannotWithdrawProfitAssets());
        IAavePool pool = IAavePool(AAVE_POOL_PROVIDER.getPool());
        _repay(token, pool, true);
        uint256 available = IERC20(token).balanceOf(address(this));
        require(available > 0 && (amount <= available || amount == type(uint256).max), NotEnoughBalance());
        uint256 amountToWithdraw = amount;
        if (amount == type(uint256).max) {
            amountToWithdraw = available;
        }
        // withdraw from this contract
        IERC20(token).safeTransfer(to, amountToWithdraw);
        emit ProfitWithdrawn(token, to, amountToWithdraw);
        return amountToWithdraw;
    }

    function setBorrowTokenLTV(address token, uint256 ltv) external onlyRole(DEFAULT_ADMIN_ROLE) {
        LiquidityPoolStorage storage $ = _getStorage();
        uint256 oldLTV = $.borrowTokenLTV[token];
        $.borrowTokenLTV[token] = ltv;
        emit BorrowTokenLTVSet(token, oldLTV, ltv);
    }

    function setDefaultLTV(uint256 defaultLTV_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        LiquidityPoolStorage storage $ = _getStorage();
        uint256 oldDefaultLTV = $.defaultLTV;
        $.defaultLTV = defaultLTV_;
        emit DefaultLTVSet(oldDefaultLTV, defaultLTV_);
    }

    function setHealthFactor(uint256 minHealthFactor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        LiquidityPoolStorage storage $ = _getStorage();
        uint256 oldHealthFactor = $.minHealthFactor;
        $.minHealthFactor = minHealthFactor;
        emit HealthFactorSet(oldHealthFactor, minHealthFactor);
    }

    // Internal functions

    function _getStorage() private pure returns (LiquidityPoolStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
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
        require(signer == $.mpcAddress, InvalidSignature());
        require($.usedNonces.get(nonce) == false, NonceAlreadyUsed());
        $.usedNonces.set(nonce);
        require(notPassed(deadline), ExpiredSignature());
    }

    function _checkTokenLTV(IAavePool pool, address borrowToken) private view {
        LiquidityPoolStorage storage $ = _getStorage();
        uint256 ltv = $.borrowTokenLTV[borrowToken];
        if (ltv == 0) ltv = $.defaultLTV;

        AaveDataTypes.ReserveData memory collateralData = pool.getReserveData(address(ASSETS));
        uint256 totalCollateral = IERC20(collateralData.aTokenAddress).balanceOf(address(this));
        require(totalCollateral > 0, NoCollateral());

        AaveDataTypes.ReserveData memory borrowTokenData = pool.getReserveData(borrowToken);
        uint256 totalBorrowed = IERC20(borrowTokenData.variableDebtTokenAddress).balanceOf(address(this));

        IAaveOracle oracle = IAaveOracle(AAVE_POOL_PROVIDER.getPriceOracle());
        address[] memory assets = new address[](2);
        assets[0] = borrowToken;
        assets[1] = address(ASSETS);

        uint256[] memory prices = oracle.getAssetsPrices(assets);

        uint256 collateralDecimals = IERC20Metadata(address(ASSETS)).decimals();
        uint256 borrowDecimals = IERC20Metadata(borrowToken).decimals();

        uint256 collateralUnit = 10 ** collateralDecimals;
        uint256 borrowUnit = 10 ** borrowDecimals;

        uint256 totalBorrowPrice = totalBorrowed * prices[0];
        uint256 collateralPrice = totalCollateral * prices[1];

        uint256 currentLtv = totalBorrowPrice * MULTIPLIER * collateralUnit / (collateralPrice * borrowUnit);
        require(currentLtv <= ltv, TokenLtvExceeded());
    }

    function _repay(address borrowToken, IAavePool pool, bool successInput)
        internal
        returns(bool success, uint256 repaidAmount) 
    {
        success = successInput;
        AaveDataTypes.ReserveData memory borrowTokenData = pool.getReserveData(borrowToken);
        if (borrowTokenData.variableDebtTokenAddress == address(0)) return (success, 0);
        uint256 totalBorrowed = IERC20(borrowTokenData.variableDebtTokenAddress).balanceOf(address(this));
        if (totalBorrowed == 0) return (success, 0);
        uint256 borrowTokenBalance = IERC20(borrowToken).balanceOf(address(this));
        if (borrowTokenBalance == 0) return (success, 0);
        IERC20(borrowToken).forceApprove(address(pool), borrowTokenBalance);
        repaidAmount = pool.repay(
            borrowToken,
            borrowTokenBalance,
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
        return _getStorage().mpcAddress;
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

    function notPassed(uint256 timestamp) internal view returns (bool) {
        return !passed(timestamp);
    }
}
