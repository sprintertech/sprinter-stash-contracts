// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {IBorrower} from "./interfaces/IBorrower.sol";
import {IWrappedNativeToken} from "./interfaces/IWrappedNativeToken.sol";
import {HelperLib} from "./utils/HelperLib.sol";
import {NATIVE_TOKEN} from "./utils/Constants.sol";
import {ISigner} from "./interfaces/ISigner.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";

/// @title LiquidityPoolBase
/// @notice Base contract for liquidity pools. Holds the liquidity asset and allows solvers to borrow
/// the asset from the pool and to perform an external function call upon providing the MPC signature.
/// The pool can also be used by trusted parties to borrow without the need of providing an MPC signature.
/// It's possible to perform borrowing with swap by the solver (the solver gets the borrowed
/// assets from the pool, swaps them to fill tokens, and then the pool performs the target call).
/// Repayment is done by transferring the assets to the contract without calling any function.
/// Rebalancing is done by depositing and withdrawing assets from this pool by the LIQUIDITY_ADMIN_ROLE.
/// Profit from borrowing is accounted for and can be withdrawn by the WITHDRAW_PROFIT_ROLE.
/// Borrowing can be paused by the WITHDRAW_PROFIT_ROLE before withdrawing the profit.
/// The contract is pausable by the PAUSER_ROLE.
/// @notice Upgradeable.
/// @author Tanya Bushenyova <tanya@chainsafe.io>
abstract contract LiquidityPoolBase is ILiquidityPool, AccessControlUpgradeable, EIP712Upgradeable, ISigner {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using BitMaps for BitMaps.BitMap;

    bool private constant NATIVE_ALLOWED = true;
    bool private constant NATIVE_DENIED = false;

    bytes32 private constant BORROW_TYPEHASH = keccak256(
        "Borrow("
            "address caller,"
            "address borrowToken,"
            "uint256 amount,"
            "address target,"
            "bytes targetCallData,"
            "uint256 nonce,"
            "uint256 deadline"
        ")"
    );

    bytes32 private constant BORROW_MANY_TYPEHASH = keccak256(
        "BorrowMany("
            "address caller,"
            "address[] borrowTokens,"
            "uint256[] amounts,"
            "address target,"
            "bytes targetCallData,"
            "uint256 nonce,"
            "uint256 deadline"
        ")"
    );

    IERC20 immutable public ASSETS;
    IWrappedNativeToken immutable public WRAPPED_NATIVE_TOKEN;

    // bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 constant internal MAGICVALUE = 0x1626ba7e;

    bytes32 private constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";
    bytes32 private constant WITHDRAW_PROFIT_ROLE = "WITHDRAW_PROFIT_ROLE";
    bytes32 private constant PAUSER_ROLE = "PAUSER_ROLE";
    bytes32 private constant DIRECT_BORROW_ROLE = "DIRECT_BORROW_ROLE";

    /// @custom:storage-location erc7201:sprinter.storage.LiquidityPoolBase
    struct LiquidityPoolBaseStorage {
        BitMaps.BitMap usedNonces;
        uint256 totalDeposited;
        bool paused;
        bool borrowPaused;
        address mpcAddress;
        address signerAddress;
        mapping(address => uint256) directDebt;
        mapping(address => int256) accruedProfit;
    }

    bytes32 private constant STORAGE_LOCATION = 0x5e15f96722dbf086bee72311c58c79f389b08ebbbe17ddec49a890658a971800;

    error ZeroAddress();
    error InvalidSignature();
    error NotEnoughToDeposit();
    error TargetCallFailed();
    error ExpiredSignature();
    error NonceAlreadyUsed();
    error BorrowingIsPaused();
    error InsufficientLiquidity();
    error InvalidBorrowToken();
    error NotImplemented();
    error NoProfit();
    error EnforcedPause();
    error ExpectedPause();
    error InsufficientSwapResult();
    error NativeBorrowDenied();
    error NotDirectBorrower();
    error NothingToRepay();
    error InvalidAsset();

    event Deposit(address from, uint256 amount);
    event Withdraw(address caller, address to, uint256 amount);
    event ProfitWithdrawn(address token, address to, uint256 amount);
    event BorrowPaused();
    event BorrowUnpaused();
    event MPCAddressSet(address oldMPCAddress, address newMPCAddress);
    event SignerAddressSet(address oldSignerAddress, address newSignerAddress);
    event Paused(address account);
    event Unpaused(address account);
    event Repaid(address token, uint256 amount);
    event RepaidDirect(address indexed token, uint256 amount);
    event BorrowDirect(address indexed account, address indexed borrowToken, uint256 amount);

    modifier whenNotPaused() {
        require(!_getStorageBase().paused, EnforcedPause());
        _;
    }

    modifier whenBorrowNotPaused() {
        require(!_getStorageBase().borrowPaused, BorrowingIsPaused());
        _;
    }

    modifier whenPaused() {
        require(_getStorageBase().paused, ExpectedPause());
        _;
    }

    modifier onlyDirectBorrower() {
        require(hasRole(DIRECT_BORROW_ROLE, _msgSender()), NotDirectBorrower());
        _;
    }

    constructor(address liquidityToken, address wrappedNativeToken) {
        ERC7201Helper.validateStorageLocation(STORAGE_LOCATION, "sprinter.storage.LiquidityPoolBase");
        require(liquidityToken != address(0), ZeroAddress());
        ASSETS = IERC20(liquidityToken);
        WRAPPED_NATIVE_TOKEN = IWrappedNativeToken(wrappedNativeToken);
        _disableInitializers();
    }

    function _initializeBase(
        address admin,
        address mpcAddress_,
        address signerAddress_
    ) internal onlyInitializing {
        __AccessControl_init();
        __EIP712_init("LiquidityPool", "1.0.0");
        require(admin != address(0), ZeroAddress());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        LiquidityPoolBaseStorage storage $ = _getStorageBase();
        require(mpcAddress_ != address(0), ZeroAddress());
        $.mpcAddress = mpcAddress_;
        require(signerAddress_ != address(0), ZeroAddress());
        $.signerAddress = signerAddress_;
    }

    receive() external payable {
        // Allow native token transfers.
    }

    // Public getters for storage variables

    function paused() public view returns (bool) {
        return _getStorageBase().paused;
    }

    function borrowPaused() public view returns (bool) {
        return _getStorageBase().borrowPaused;
    }

    function mpcAddress() public view returns (address) {
        return _getStorageBase().mpcAddress;
    }

    function signerAddress() public view returns (address) {
        return _getStorageBase().signerAddress;
    }

    function directDebt(address account) public view returns (uint256) {
        return _getStorageBase().directDebt[account];
    }

    function accruedProfit(address token) public view returns (int256) {
        return _getStorageBase().accruedProfit[token];
    }

    /// @notice The liqudity admin is supposed to call this function after transferring exact amount of assets.
    /// Supplying amount less than the actual increase will result in the extra funds being treated as profit.
    /// Supplying amount greater than the actual increase will result in the future profits treated as deposit.
    function deposit(uint256 amount) external virtual override onlyRole(LIQUIDITY_ADMIN_ROLE) {
        // called after receiving deposit in USDC
        uint256 newBalance = HelperLib.balanceOfThis(ASSETS);
        require(newBalance >= amount, NotEnoughToDeposit());
        _deposit(_msgSender(), amount);
    }

    function depositWithPull(uint256 amount) external virtual override {
        // pulls USDC from the sender
        ASSETS.safeTransferFrom(_msgSender(), address(this), amount);
        _deposit(_msgSender(), amount);
    }

    /// @notice This function allows an authorized caller to borrow funds from the contract.
    /// The MPC signer needs to sign the data:
    /// caller's address, borrow token address, amount, target call address and calldata, nonce and deadline.
    /// The contract verifies the MPC signature, approves the tokens for the target address
    /// and performs the target call.
    /// It's supposed that the target is a trusted contract that fulfills the request, performs transferFrom
    /// of borrow tokens and guarantees to repay the tokens to the pool later.
    /// targetCallData is a trusted and checked calldata.
    /// @param borrowToken can be specified as native token address which is 0x0. In this case, the function will
    /// borrow wrapped native token, then unwrap it and include the native value in the target call.
    function borrow(
        address borrowToken,
        uint256 packedAmount,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external override whenNotPaused() whenBorrowNotPaused() {
        // - Validate MPC signature
        _validateMPCSignatureWithCaller(borrowToken, packedAmount, target, targetCallData, nonce, deadline, signature);
        (uint256 nativeValue, address actualBorrowToken,,, bytes memory context) =
            _borrow(borrowToken, packedAmount, target, NATIVE_ALLOWED, "");
        _afterBorrowLogic(actualBorrowToken, context);
        _unwrapNative(nativeValue);
        _finalizeBorrow(target, nativeValue, targetCallData);
    }

    /// @notice This function allows an authorized caller to borrow funds from the contract.
    /// This is callable by authorized callers and does not need MPC signatures.
    /// The contract approves the tokens for the target address.
    /// It's supposed that the target is a trusted contract that fulfills the request, performs transferFrom
    /// of borrow tokens and guarantees to repay the tokens to the pool later.
    /// @param borrowToken can be specified as native token address which is 0x0. In this case, the function will
    /// borrow wrapped native token, then unwrap it and include the native value in the target call.
    function borrowDirect(
      address borrowToken,
      uint256 packedAmount
    ) external override whenNotPaused() onlyDirectBorrower() {
        (, address actualBorrowToken, uint256 amount, uint256 profit, bytes memory context) =
            _borrow(borrowToken, packedAmount, _msgSender(), false, "");

        uint256 totalObligation = amount + profit;
        _getStorageBase().directDebt[actualBorrowToken] += totalObligation;
        _afterBorrowLogic(actualBorrowToken, context);

        emit BorrowDirect(_msgSender(), borrowToken, totalObligation);
    }

    /// @param borrowTokens can include a native token address which is 0x0. In this case, the function will
    /// borrow wrapped native token, then unwrap it and include the native value in the target call.
    function borrowMany(
        address[] calldata borrowTokens,
        uint256[] calldata packedAmounts,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external override whenNotPaused() whenBorrowNotPaused() {
        // - Validate MPC signature
        _validateMPCSignatureWithCaller(
            borrowTokens, packedAmounts, target, targetCallData, nonce, deadline, signature
        );
        (uint256 nativeValue, address[] memory actualBorrowTokens,, bytes memory context) = _borrowMany(
            borrowTokens, packedAmounts, target, NATIVE_ALLOWED
        );
        _afterBorrowManyLogic(actualBorrowTokens, context);
        _unwrapNative(nativeValue);
        _finalizeBorrow(target, nativeValue, targetCallData);
    }

    /// @notice This function allows an authorized caller to perform borrowing with swap by the solver
    /// (the solver gets the borrow tokens from the pool, swaps them to fill tokens,
    /// and then the pool performs the target call).
    /// The MPC signer needs to sign the data:
    /// caller's address, borrow token address, amount, target call address and calldata, nonce and deadline.
    /// The contract verifies the MPC signature, approves the borrow tokens for the caller's address
    /// and performs the swap call back to the caller.
    /// The caller is supposed to swap borrow tokens for fill tokens (transfer borrow tokens from the contract
    /// and approve fill tokens). This contract transfers fill tokens from the caller and approves them for the target.
    /// It's supposed that the target is a trusted contract that fulfills the request,
    /// performs transferFrom of fill tokens and guarantees to repay the tokens later.
    /// targetCallData is a trusted and checked calldata.
    /// fillToken and fillAmount are not part of the signature because that's the solver's responsibility to
    /// provide tokens for the target call: if the required fillToken is not provided then the target call should fail.
    /// Considered solver misbehave scenarios:
    /// 1. If the fillToken is incorrect, then allowance for the expected token will be 0 and target call will fail.
    /// 2. If the fillAmount is too small, then allowance will be less than what is needed for target call to succeed.
    /// 3. If the fillAmount is too big, then this contract will transfer extra payment from the caller and the diff
    ///    allowance to the target will remain for the subsequent borrower to use, or it will be overridden instead.
    /// 4. The swapData could be anything, the caller cannot reuse the signature in a reentrancy as the nonce is
    ///    already marked as used. The caller can reenter with another valid signature, which is an allowed scenario
    ///    as there are no state assumptions/changes made afterwards.
    /// @param borrowToken can NOT be specified as native token address because the swap function is supposed to work
    /// with wrapped native token.
    /// @param swap is a struct that contains the fill token which could be specified as native token address 0x0.
    /// In this case the swap call is expected to send back the native token amount that is >= fillAmount.
    /// The fillAmount will then be included in the target call.
    function borrowAndSwap(
        address borrowToken,
        uint256 packedAmount,
        SwapParams calldata swap,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external override whenNotPaused() whenBorrowNotPaused() {
        _validateMPCSignatureWithCaller(borrowToken, packedAmount, target, targetCallData, nonce, deadline, signature);
        // Native borrowing is denied because swap() is not payable.
        (, address actualBorrowToken, uint256 amount,, bytes memory context) =
            _borrow(borrowToken, packedAmount, _msgSender(), NATIVE_DENIED, "");
        _afterBorrowLogic(actualBorrowToken, context);
        uint256 nativeBalanceBefore = _prepareNativeFill(swap.fillToken);
        // Call the swap function on caller
        IBorrower(_msgSender()).swap(borrowToken, amount, swap.fillToken, swap.fillAmount, swap.swapData);
        _finalizeSwap(swap, target, targetCallData, nativeBalanceBefore);
    }

    /// @param borrowTokens can NOT include native token address because the swapMany() function is supposed to work
    /// with wrapped native token.
    /// @param swap is a struct that contains the fill token which could be specified as native token address 0x0.
    /// In this case the swap call is expected to send back the native token amount that is >= fillAmount.
    /// The fillAmount will then be included in the target call.
    function borrowAndSwapMany(
        address[] calldata borrowTokens,
        uint256[] calldata packedAmounts,
        SwapParams calldata swap,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external override whenNotPaused()  whenBorrowNotPaused() {
        _validateMPCSignatureWithCaller(
            borrowTokens, packedAmounts, target, targetCallData, nonce, deadline, signature
        );
        // Native borrowing is denied because swapMany() is not payable.
        (,, uint256[] memory amounts, bytes memory context) = _borrowMany(
            borrowTokens, packedAmounts, _msgSender(), NATIVE_DENIED
        );
        _afterBorrowManyLogic(borrowTokens, context);
        uint256 nativeBalanceBefore = _prepareNativeFill(swap.fillToken);
        // Call the swap function on caller
        IBorrower(_msgSender()).swapMany(borrowTokens, amounts, swap.fillToken, swap.fillAmount, swap.swapData);
        _finalizeSwap(swap, target, targetCallData, nativeBalanceBefore);
    }

    function repay(address[] calldata borrowTokens) external override {
        _repay(borrowTokens);
    }

    function repayDirect(
        address[] calldata borrowTokens,
        uint256[] calldata maxAmounts
    ) external override onlyDirectBorrower {
        _repayDirect(borrowTokens, maxAmounts);
    }

    // Admin functions

    /// @notice Can withdraw a maximum of _totalDeposited. If anything is left, it is meant to be withdrawn through
    /// a withdrawProfit().
    function withdraw(address to, uint256 amount)
        external
        virtual
        override
        onlyRole(LIQUIDITY_ADMIN_ROLE)
        whenNotPaused()
    {
        require(to != address(0), ZeroAddress());
        LiquidityPoolBaseStorage storage $ = _getStorageBase();
        uint256 deposited = $.totalDeposited;
        require(deposited >= amount, InsufficientLiquidity());
        $.totalDeposited = deposited - amount;
        _withdrawLogic(to, amount);
        emit Withdraw(_msgSender(), to, amount);
    }

    function withdrawProfit(
        address[] calldata tokens,
        address to
    ) external override onlyRole(WITHDRAW_PROFIT_ROLE) whenNotPaused() {
        require(to != address(0), ZeroAddress());
        bool success;
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            _wrapIfNative(token);
            uint256 amountToWithdraw = _withdrawProfitLogic(token);
            if (amountToWithdraw == 0) continue;
            success = true;
            // Withdraw from this contract
            token.safeTransfer(to, amountToWithdraw);
            emit ProfitWithdrawn(address(token), to, amountToWithdraw);
        }
        require(success, NoProfit());
    }

    function setMPCAddress(address mpcAddress_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(mpcAddress_ != address(0), ZeroAddress());
        LiquidityPoolBaseStorage storage $ = _getStorageBase();
        address oldMPCAddress = $.mpcAddress;
        $.mpcAddress = mpcAddress_;
        emit MPCAddressSet(oldMPCAddress, mpcAddress_);
    }

    function setSignerAddress(address signerAddress_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        LiquidityPoolBaseStorage storage $ = _getStorageBase();
        address oldSignerAddress = $.signerAddress;
        $.signerAddress = signerAddress_;
        emit SignerAddressSet(oldSignerAddress, signerAddress_);
    }

    function pauseBorrow() external override onlyRole(WITHDRAW_PROFIT_ROLE) {
        _getStorageBase().borrowPaused = true;
        emit BorrowPaused();
    }

    function unpauseBorrow() external override onlyRole(WITHDRAW_PROFIT_ROLE) {
        _getStorageBase().borrowPaused = false;
        emit BorrowUnpaused();
    }

    function pause() external override onlyRole(PAUSER_ROLE) whenNotPaused() {
        _getStorageBase().paused = true;
        emit Paused(_msgSender());
    }

    function unpause() external override onlyRole(PAUSER_ROLE) whenPaused() {
        _getStorageBase().paused = false;
        emit Unpaused(_msgSender());
    }

    // Internal functions

    function _prepareNativeFill(address fillToken) private view returns (uint256) {
        if (fillToken == address(NATIVE_TOKEN)) {
            return address(this).balance;
        }
        return 0;
    }

    function _unwrapNative(uint256 amount) private {
        if (amount == 0) return;
        WRAPPED_NATIVE_TOKEN.withdraw(amount);
    }

    function _deposit(address caller, uint256 amount) private {
        _getStorageBase().totalDeposited += amount;
        _depositLogic(amount);
        emit Deposit(caller, amount);
    }

    function _borrowMany(
        address[] calldata tokens,
        uint256[] calldata packedAmounts,
        address target,
        bool nativeAllowed
    ) private returns (uint256, address[] memory, uint256[] memory, bytes memory context) {
        uint256 totalNativeValue = 0;
        address[] memory actualBorrowTokens = new address[](tokens.length);
        uint256[] memory amounts = new uint256[](tokens.length);
        uint256 length = HelperLib.validatePositiveLength(tokens.length, packedAmounts.length);
        for (uint256 i = 0; i < length; ++i) {
            uint256 nativeValue = 0;
            (nativeValue, actualBorrowTokens[i], amounts[i],, context) =
                _borrow(tokens[i], packedAmounts[i], target, nativeAllowed, context);
            totalNativeValue += nativeValue;
        }
        return (totalNativeValue, actualBorrowTokens, amounts, context);
    }

    function _finalizeSwap(
        SwapParams calldata swap,
        address target,
        bytes calldata targetCallData,
        uint256 nativeBalanceBefore
    ) private {
        uint256 value = 0;
        if (swap.fillToken == address(NATIVE_TOKEN)) {
            value = swap.fillAmount;
            require(address(this).balance - nativeBalanceBefore >= value, InsufficientSwapResult());
        } else {
            IERC20(swap.fillToken).safeTransferFrom(_msgSender(), address(this), swap.fillAmount);
            IERC20(swap.fillToken).forceApprove(target, swap.fillAmount);
        }
        _finalizeBorrow(target, value, targetCallData);
    }

    function _finalizeBorrow(address target, uint256 value, bytes calldata targetCallData) private {
        // - Invoke the recipient's address with calldata provided in the MPC signature to complete
        // the operation securely.
        (bool success,) = target.call{value: value}(targetCallData);
        require(success, TargetCallFailed());
    }

    function _validateMPCSignatureWithCaller(
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
            _msgSender(),
            borrowToken,
            amount,
            target,
            keccak256(targetCallData),
            nonce,
            deadline
        )));
        _validateSig(digest, nonce, deadline, signature);
    }

    function _validateMPCSignatureWithCaller(
        address[] calldata borrowTokens,
        uint256[] calldata amounts,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) private {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            BORROW_MANY_TYPEHASH,
            _msgSender(),
            keccak256(abi.encodePacked(borrowTokens)),
            keccak256(abi.encodePacked(amounts)),
            target,
            keccak256(targetCallData),
            nonce,
            deadline
        )));
        _validateSig(digest, nonce, deadline, signature);
    }

    function _validateSig(bytes32 digest, uint256 nonce, uint256 deadline, bytes calldata signature) private {
        LiquidityPoolBaseStorage storage $ = _getStorageBase();
        address signer = digest.recover(signature);
        require(signer == $.mpcAddress, InvalidSignature());
        require($.usedNonces.get(nonce) == false, NonceAlreadyUsed());
        $.usedNonces.set(nonce);
        require(notPassed(deadline), ExpiredSignature());
    }

    function _borrow(
        address borrowToken,
        uint256 packedAmount,
        address target,
        bool nativeAllowed,
        bytes memory context
    ) private returns (uint256 nativeAmount, address actualBorrowToken, uint256 amount, uint256 profit, bytes memory) {
        (profit, amount) = _unpackAmount(packedAmount);
        bool isNative = borrowToken == address(NATIVE_TOKEN);
        actualBorrowToken = isNative ? address(WRAPPED_NATIVE_TOKEN) : borrowToken;
        _wrapIfNative(IERC20(actualBorrowToken));
        context = _borrowLogic(actualBorrowToken, amount, profit, context);
        if (isNative) {
            require(nativeAllowed, NativeBorrowDenied());
            nativeAmount = amount;
        } else {
            IERC20(borrowToken).forceApprove(target, amount);
        }
        if (profit > 0) _getStorageBase().accruedProfit[actualBorrowToken] += int256(profit);
        return (nativeAmount, actualBorrowToken, amount, profit, context);
    }

    function _wrapIfNative(IERC20 token) internal {
        if (token == WRAPPED_NATIVE_TOKEN && address(this).balance > 0) {
            WRAPPED_NATIVE_TOKEN.deposit{value: address(this).balance}();
        }
    }

    function _unpackAmount(uint256 packedAmount) private pure returns (uint128 profit, uint128 amount) {
        profit = uint128(packedAmount >> 128);
        amount = uint128(packedAmount);
    }

    function _depositLogic(uint256 /*amount*/) internal virtual {
        return;
    }

    function _borrowLogic(address borrowToken, uint256 /*amount*/, uint256 /*profit*/, bytes memory context)
        internal virtual returns (bytes memory)
    {
        require(borrowToken == address(ASSETS), InvalidBorrowToken());
        return context;
    }

    function _afterBorrowLogic(address /*borrowToken*/, bytes memory /*context*/) internal virtual {
        return;
    }

    function _afterBorrowManyLogic(address[] memory /*borrowTokens*/, bytes memory /*context*/) internal virtual {
        return;
    }

    function _withdrawLogic(address to, uint256 amount) internal virtual {
        require(HelperLib.balanceOfThis(ASSETS) >= amount, InsufficientLiquidity());
        ASSETS.safeTransfer(to, amount);
    }

    function _withdrawProfitLogic(IERC20 token) internal virtual returns (uint256) {
        LiquidityPoolBaseStorage storage $ = _getStorageBase();
        uint256 currentBalance = HelperLib.balanceOfThis(token);
        uint256 withdrawableSurplus = 0;
        if (token == ASSETS) {
            uint256 deposited = $.totalDeposited;
            uint256 virtualBalance = currentBalance + $.directDebt[address(token)];
            if (virtualBalance > deposited) {
                // In case there are extra funds in the pool, withdraw them.
                withdrawableSurplus = Math.min(virtualBalance - deposited, currentBalance);
            }
        } else {
            withdrawableSurplus = currentBalance;
        }
        int256 profit = $.accruedProfit[address(token)];
        // Cannot be negative (in this contract, but can be in children) but can be zero.
        if (profit <= 0) return withdrawableSurplus;
        uint256 toWithdraw = Math.min(currentBalance, uint256(profit));
        $.accruedProfit[address(token)] = profit - int256(toWithdraw);
        return Math.max(toWithdraw, withdrawableSurplus);
    }

    function _repay(address[] calldata) internal virtual {
        // Repayment is done by sending tokens directly to LiquidityPool.
        // Pool implementations that need to actively settle debt (e.g. Aave) must override this.
        // This base implementation is a no-op because LiquidityPool uses a single asset as both
        // the liquidity asset and the borrow asset: there is no external protocol to repay, so
        // transferring the asset back to this contract is itself the repayment. Accounting for
        // repaid funds is handled implicitly via the contract's balance relative to _totalDeposited
        // (see _withdrawProfitLogic for example).
        revert NotImplemented();
    }

    function _repayDirect(
        address[] calldata borrowTokens,
        uint256[] calldata maxAmounts
    ) internal virtual {
        // Validate calldata: we want the caller to send us ASSETS
        // and the max amount they are willing to repay.
        HelperLib.validatePositiveLength(borrowTokens.length, maxAmounts.length);
        if (borrowTokens.length != 1) revert InvalidAsset();
        if (borrowTokens[0] != address(ASSETS)) revert InvalidAsset();

        LiquidityPoolBaseStorage storage $ = _getStorageBase();
        uint256 debt = $.directDebt[address(ASSETS)];
        if (debt == 0) revert NothingToRepay();

        uint256 repayAmount = Math.min(debt, maxAmounts[0]);
        $.directDebt[address(ASSETS)] = debt - repayAmount;

        // Repay the amount and decrease direct debt.
        // Note that extensions of this pool will need to take care
        // of direct debt if they support direct borrowing.
        ASSETS.safeTransferFrom(_msgSender(), address(this), repayAmount);

        emit RepaidDirect(address(ASSETS), repayAmount);
    }

    function _balance(IERC20 token) internal view virtual returns (uint256) {
        if (token != ASSETS) return 0;
        uint256 result = HelperLib.balanceOfThis(token);
        if (token == WRAPPED_NATIVE_TOKEN) {
            result += address(this).balance;
        }
        return result;
    }

    // View functions

    function totalDeposited() external view virtual override returns (uint256) {
        return _getStorageBase().totalDeposited;
    }

    function balance(IERC20 token) external view override returns (uint256) {
        LiquidityPoolBaseStorage storage $ = _getStorageBase();
        if ($.paused || $.borrowPaused) return 0;
        if (token == NATIVE_TOKEN) token = WRAPPED_NATIVE_TOKEN;
        return _balance(token);
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

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4 magicValue) {
        address signerAddr = _getStorageBase().signerAddress;
        if (signerAddr.code.length == 0) {
            // EOA
            address signerAddressRecovered = ECDSA.recover(hash, signature);
            if (signerAddressRecovered == signerAddr) return MAGICVALUE;
            else return 0xffffffff;
        }
        // Contract
        return ISigner(signerAddr).isValidSignature(hash, signature);
    }

    function _getStorageBase() internal pure returns (LiquidityPoolBaseStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}

/// @notice Concrete, upgradeable liquidity pool with the standard single-asset borrow/repay logic.
/// @author Tanya Bushenyova <tanya@chainsafe.io>
contract LiquidityPool is LiquidityPoolBase {
    constructor(address liquidityToken, address wrappedNativeToken)
        LiquidityPoolBase(liquidityToken, wrappedNativeToken) {}

    function initialize(
        address admin,
        address mpcAddress_,
        address signerAddress_
    ) external initializer {
        _initializeBase(admin, mpcAddress_, signerAddress_);
    }
}
