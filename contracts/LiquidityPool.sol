// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAavePoolAddressesProvider} from "./interfaces/IAavePoolAddressesProvider.sol";
import {IAavePool, AaveDataTypes, NO_REFERRAL, INTEREST_RATE_MODE_VARIABLE} from "./interfaces/IAavePool.sol";
import {IAaveOracle} from "./interfaces/IAaveOracle.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {IAavePoolDataProvider} from "./interfaces/IAavePoolDataProvider.sol";

contract LiquidityPool is ILiquidityPool, AccessControl, EIP712, Pausable {
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

    address public _mpcAddress;
    uint256 public _minHealthFactor;
    uint256 public _defaultLTV;
    bool public _borrowPaused;

    mapping(address token => uint256 ltv) public _borrowTokenLTV;
    BitMaps.BitMap private _usedNonces;
    
    bytes32 public constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";
    bytes32 public constant WITHDRAW_PROFIT_ROLE = "WITHDRAW_PROFIT_ROLE";
    bytes32 public constant PAUSER_ROLE = "PAUSER_ROLE";

    error ZeroAddress();
    error InvalidSignature();
    error TokenLtvExceeded();
    error NotEnoughToDeposit();
    error NoCollateral();
    error HealthFactorTooLow();
    error TargetCallFailed();
    error NothingToRepay();
    error ExpiredSignature();
    error NonceAlreadyUsed();
    error CollateralNotSupported();
    error BorrowingIsPaused();
    error BorrowingIsNotPaused();

    event SuppliedToAave(uint256 amount);
    event BorrowTokenLTVSet(address token, uint256 oldLTV, uint256 newLTV);
    event HealthFactorSet(uint256 oldHealthFactor, uint256 newHealthFactor);
    event DefaultLTVSet(uint256 oldDefaultLTV, uint256 newDefaultLTV);
    event Repaid(address borrowToken, uint256 repaidAmount);
    event WithdrawnFromAave(address to, uint256 amount);
    event ProfitWithdrawn(address token, address to, uint256 amount);
    event BorrowPaused();
    event BorrowUnpaused();

    constructor(
        address liquidityToken,
        address aavePoolProvider,
        address admin,
        address mpcAddress,
        uint256 minHealthFactor,
        uint256 defaultLTV
    ) EIP712("LiquidityPool", "1.0.0") {
        require(liquidityToken != address(0), ZeroAddress());
        ASSETS = IERC20(liquidityToken);
        require(aavePoolProvider != address(0), ZeroAddress());
        AAVE_POOL_PROVIDER = IAavePoolAddressesProvider(aavePoolProvider);
        IAavePoolDataProvider poolDataProvider = IAavePoolDataProvider(AAVE_POOL_PROVIDER.getPoolDataProvider());
        (,,,,,bool usageAsCollateralEnabled,,,,) = poolDataProvider.getReserveConfigurationData(address(ASSETS));
        require(usageAsCollateralEnabled, CollateralNotSupported());
        require(address(admin) != address(0), ZeroAddress());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _minHealthFactor = minHealthFactor;
        _defaultLTV = defaultLTV;
        _mpcAddress = mpcAddress;
    }

    function deposit(uint256 amount) external override whenNotPaused() {
        // called after receiving deposit in USDC
        uint256 balance = ASSETS.balanceOf(address(this));
        require(balance >= amount, NotEnoughToDeposit());
        IAavePool pool = IAavePool(AAVE_POOL_PROVIDER.getPool());
        ASSETS.forceApprove(address(pool), amount);
        pool.supply(address(ASSETS), amount, address(this), NO_REFERRAL);
        emit SuppliedToAave(amount);
    }

    function depositWithPull(uint256 amount) external whenNotPaused() {
        // pulls USDC from the sender
        ASSETS.safeTransferFrom(msg.sender, address(this), amount);
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
    ) external whenNotPaused() {
        require(!_borrowPaused, BorrowingIsPaused());
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
        require(currentHealthFactor >= _minHealthFactor, HealthFactorTooLow());

        // check ltv for token
        _checkTokenLTV(pool, borrowToken);
        // - Approve the borrowed funds for transfer to the recipient specified in the MPC signature.
        IERC20(borrowToken).forceApprove(target, amount);
        // - Invoke the recipient's address with calldata provided in the MPC signature to complete
        // the operation securely.
        (bool success,) = target.call(targetCallData);
        require(success, TargetCallFailed());
    }

    function repay(address[] calldata borrowTokens) external whenNotPaused() {
        // Repay token to aave
        bool success;
        IAavePool pool = IAavePool(AAVE_POOL_PROVIDER.getPool());
        for (uint256 i = 0; i < borrowTokens.length; i++) {
            (success,) = _repay(borrowTokens[i], pool, success);
        }
        require(success, NothingToRepay());
    }

    // Admin functions

    function withdraw(address to, uint256 amount)
        external
        override
        onlyRole(LIQUIDITY_ADMIN_ROLE)
        whenNotPaused()
        returns (uint256) 
    {
        // get USDC from AAVE
        IAavePool pool = IAavePool(AAVE_POOL_PROVIDER.getPool());
        uint256 withdrawn = pool.withdraw(address(ASSETS), amount, to);
        // health factor after withdraw
        (,,,,,uint256 currentHealthFactor) = pool.getUserAccountData(address(this));
        require(currentHealthFactor >= _minHealthFactor, HealthFactorTooLow());
        emit WithdrawnFromAave(to, withdrawn);
        return withdrawn;
    }

    function withdrawProfit(
        address[] calldata tokens,
        address to
    ) external onlyRole(WITHDRAW_PROFIT_ROLE) whenNotPaused() {
        require(_borrowPaused, BorrowingIsNotPaused());
        IAavePool pool = IAavePool(AAVE_POOL_PROVIDER.getPool());
        AaveDataTypes.ReserveData memory collateralData = pool.getReserveData(address(ASSETS));
        for (uint256 i = 0; i < tokens.length; i++) {
            _withdrawProfit(tokens[i], to, collateralData.aTokenAddress, pool);
        }
    }

    function setBorrowTokenLTV(address token, uint256 ltv) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLTV = _borrowTokenLTV[token];
        _borrowTokenLTV[token] = ltv;
        emit BorrowTokenLTVSet(token, oldLTV, ltv);
    }

    function setDefaultLTV(uint256 defaultLTV_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldDefaultLTV = _defaultLTV;
        _defaultLTV = defaultLTV_;
        emit DefaultLTVSet(oldDefaultLTV, defaultLTV_);
    }

    function setHealthFactor(uint256 minHealthFactor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldHealthFactor = _minHealthFactor;
        _minHealthFactor = minHealthFactor;
        emit HealthFactorSet(oldHealthFactor, minHealthFactor);
    }

    function pauseBorrow() external onlyRole(WITHDRAW_PROFIT_ROLE) {
        _borrowPaused = true;
        emit BorrowPaused();
    }

    function unpauseBorrow() external onlyRole(WITHDRAW_PROFIT_ROLE) {
        _borrowPaused = false;
        emit BorrowUnpaused();
    }

    function pause() external onlyRole(PAUSER_ROLE) whenNotPaused() {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) whenPaused() {
        _unpause();
    }

    // Internal functions

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
        require(signer == _mpcAddress, InvalidSignature());
        require(_usedNonces.get(nonce) == false, NonceAlreadyUsed());
        _usedNonces.set(nonce);
        require(notPassed(deadline), ExpiredSignature());
    }

    function _checkTokenLTV(IAavePool pool, address borrowToken) private view {
        uint256 ltv = _borrowTokenLTV[borrowToken];
        if (ltv == 0) ltv = _defaultLTV;

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

    function _withdrawProfit(
        address token,
        address to,
        address aToken,
        IAavePool pool
    ) internal {
        // Check that not aToken
        if (token == aToken) return;
        uint256 amountToWithdraw = IERC20(token).balanceOf(address(this));
        if (amountToWithdraw == 0) return;
        // Check that the token doesn't have debt
        AaveDataTypes.ReserveData memory tokenData = pool.getReserveData(token);
        if (tokenData.variableDebtTokenAddress != address(0)) {
            uint256 debt = IERC20(tokenData.variableDebtTokenAddress).balanceOf(address(this));
            if (debt > 0) return;
        }
        // Withdraw from this contract
        IERC20(token).safeTransfer(to, amountToWithdraw);
        emit ProfitWithdrawn(token, to, amountToWithdraw);
    }

    // View functions

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
