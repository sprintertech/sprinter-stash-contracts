// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {IBorrower} from "./interfaces/IBorrower.sol";
import {IWrappedNativeToken} from "./interfaces/IWrappedNativeToken.sol";
import {HelperLib} from "./utils/HelperLib.sol";
import {NATIVE_TOKEN} from "./utils/Constants.sol";

/// @title Liquidity pool contract holds the liquidity asset and allows solvers to borrow
/// the asset from the pool and to perform an external function call upon providing the MPC signature.
/// It's possible to perform borrowing with swap by the solver (the solver gets the borrowed
/// assets from the pool, swaps them to fill tokens, and then the pool performs the target call).
/// Repayment is done by transferring the assets to the contract without calling any function.
/// Rebalancing is done by depositing and withdrawing assets from this pool by the LIQUIDITY_ADMIN_ROLE.
/// Profit from borrowing is accounted for and can be withdrawn by the WITHDRAW_PROFIT_ROLE.
/// Borrowing can be paused by the WITHDRAW_PROFIT_ROLE before withdrawing the profit.
/// The contract is pausable by the PAUSER_ROLE.
/// @author Tanya Bushenyova <tanya@chainsafe.io>
contract LiquidityPool is ILiquidityPool, AccessControl, EIP712 {
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

    BitMaps.BitMap private _usedNonces;
    uint256 public totalDeposited;

    bool public paused;
    bool public borrowPaused;
    address public mpcAddress;

    bytes32 public constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";
    bytes32 public constant WITHDRAW_PROFIT_ROLE = "WITHDRAW_PROFIT_ROLE";
    bytes32 public constant PAUSER_ROLE = "PAUSER_ROLE";
    IWrappedNativeToken immutable public WRAPPED_NATIVE_TOKEN;

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

    event Deposit(address from, uint256 amount);
    event Withdraw(address caller, address to, uint256 amount);
    event ProfitWithdrawn(address token, address to, uint256 amount);
    event BorrowPaused();
    event BorrowUnpaused();
    event MPCAddressSet(address oldMPCAddress, address newMPCAddress);
    event Paused(address account);
    event Unpaused(address account);

    modifier whenNotPaused() {
        require(!paused, EnforcedPause());
        _;
    }

    modifier whenBorrowNotPaused() {
        require(!borrowPaused, BorrowingIsPaused());
        _;
    }

    modifier whenPaused() {
        require(paused, ExpectedPause());
        _;
    }

    constructor(
        address liquidityToken,
        address admin,
        address mpcAddress_,
        address wrappedNativeToken
    ) EIP712("LiquidityPool", "1.0.0") {
        require(liquidityToken != address(0), ZeroAddress());
        ASSETS = IERC20(liquidityToken);
        require(admin != address(0), ZeroAddress());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        require(mpcAddress_ != address(0), ZeroAddress());
        mpcAddress = mpcAddress_;
        WRAPPED_NATIVE_TOKEN = IWrappedNativeToken(wrappedNativeToken);
    }

    receive() external payable {
        // Allow native token transfers.
    }

    function deposit(uint256 amount) external override onlyRole(LIQUIDITY_ADMIN_ROLE) {
        // called after receiving deposit in USDC
        uint256 newBalance = ASSETS.balanceOf(address(this));
        require(newBalance >= amount, NotEnoughToDeposit());
        _deposit(_msgSender(), amount);
    }

    function depositWithPull(uint256 amount) external override {
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
        uint256 amount,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external override whenNotPaused() whenBorrowNotPaused() {
        // - Validate MPC signature
        _validateMPCSignatureWithCaller(borrowToken, amount, target, targetCallData, nonce, deadline, signature);
        (uint256 nativeValue, address actualBorrowToken, bytes memory context) =
            _borrow(borrowToken, amount, target, NATIVE_ALLOWED);
        _afterBorrowLogic(actualBorrowToken, context);
        _unwrapNative(nativeValue);
        _finalizeBorrow(target, nativeValue, targetCallData);
    }

    /// @param borrowTokens can include a native token address which is 0x0. In this case, the function will
    /// borrow wrapped native token, then unwrap it and include the native value in the target call.
    function borrowMany(
        address[] calldata borrowTokens,
        uint256[] calldata amounts,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external override whenNotPaused() whenBorrowNotPaused() {
        // - Validate MPC signature
        _validateMPCSignatureWithCaller(borrowTokens, amounts, target, targetCallData, nonce, deadline, signature);
        (uint256 nativeValue, address[] memory actualBorrowTokens, bytes memory context) = _borrowMany(
            borrowTokens, amounts, target, NATIVE_ALLOWED
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
        uint256 amount,
        SwapParams calldata swap,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external override whenNotPaused() whenBorrowNotPaused() {
        _validateMPCSignatureWithCaller(borrowToken, amount, target, targetCallData, nonce, deadline, signature);
        // Native borrowing is denied because swap() is not payable.
        (,, bytes memory context) = _borrow(borrowToken, amount, _msgSender(), NATIVE_DENIED);
        _afterBorrowLogic(borrowToken, context);
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
        uint256[] calldata amounts,
        SwapParams calldata swap,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external override whenNotPaused()  whenBorrowNotPaused() {
        _validateMPCSignatureWithCaller(borrowTokens, amounts, target, targetCallData, nonce, deadline, signature);
        // Native borrowing is denied because swapMany() is not payable.
        (,, bytes memory context) = _borrowMany(borrowTokens, amounts, _msgSender(), NATIVE_DENIED);
        _afterBorrowManyLogic(borrowTokens, context);
        uint256 nativeBalanceBefore = _prepareNativeFill(swap.fillToken);
        // Call the swap function on caller
        IBorrower(_msgSender()).swapMany(borrowTokens, amounts, swap.fillToken, swap.fillAmount, swap.swapData);
        _finalizeSwap(swap, target, targetCallData, nativeBalanceBefore);
    }

    function repay(address[] calldata) external virtual override {
        revert NotImplemented();
    }

    // Admin functions

    /// @notice Can withdraw a maximum of totalDeposited. If anything is left, it is meant to be withdrawn through
    /// a withdrawProfit().
    function withdraw(address to, uint256 amount)
        external
        override
        onlyRole(LIQUIDITY_ADMIN_ROLE)
        whenNotPaused()
    {
        require(to != address(0), ZeroAddress());
        uint256 deposited = totalDeposited;
        require(deposited >= amount, InsufficientLiquidity());
        totalDeposited = deposited - amount;
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
        address oldMPCAddress = mpcAddress;
        mpcAddress = mpcAddress_;
        emit MPCAddressSet(oldMPCAddress, mpcAddress_);
    }

    function pauseBorrow() external override onlyRole(WITHDRAW_PROFIT_ROLE) {
        borrowPaused = true;
        emit BorrowPaused();
    }

    function unpauseBorrow() external override onlyRole(WITHDRAW_PROFIT_ROLE) {
        borrowPaused = false;
        emit BorrowUnpaused();
    }

    function pause() external override onlyRole(PAUSER_ROLE) whenNotPaused() {
        paused = true;
        emit Paused(_msgSender());
    }

    function unpause() external override onlyRole(PAUSER_ROLE) whenPaused() {
        paused = false;
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
        totalDeposited += amount;
        _depositLogic(caller, amount);
        emit Deposit(caller, amount);
    }

    function _borrowMany(
        address[] calldata tokens,
        uint256[] calldata amounts,
        address target,
        bool nativeAllowed
    ) private returns (uint256, address[] memory, bytes memory context) {
        uint256 totalNativeValue = 0;
        address[] memory actualBorrowTokens = new address[](tokens.length);
        uint256 length = HelperLib.validatePositiveLength(tokens.length, amounts.length);
        for (uint256 i = 0; i < length; ++i) {
            uint256 nativeValue = 0;
            (nativeValue, actualBorrowTokens[i], context) = _borrow(tokens[i], amounts[i], target, nativeAllowed);
            totalNativeValue += nativeValue;
        }
        return (totalNativeValue, actualBorrowTokens, context);
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
        address signer = digest.recover(signature);
        require(signer == mpcAddress, InvalidSignature());
        require(_usedNonces.get(nonce) == false, NonceAlreadyUsed());
        _usedNonces.set(nonce);
        require(notPassed(deadline), ExpiredSignature());
    }

    function _borrow(
        address borrowToken,
        uint256 amount,
        address target,
        bool nativeAllowed
    ) private returns (uint256 nativeAmount, address actualBorrowToken, bytes memory context) {
        bool isNative = borrowToken == address(NATIVE_TOKEN);
        actualBorrowToken = isNative ? address(WRAPPED_NATIVE_TOKEN) : borrowToken;
        _wrapIfNative(IERC20(actualBorrowToken));
        context = _borrowLogic(actualBorrowToken, amount, context);
        if (isNative) {
            require(nativeAllowed, NativeBorrowDenied());
            nativeAmount = amount;
        } else {
            IERC20(borrowToken).forceApprove(target, amount);
        }
        return (nativeAmount, actualBorrowToken, context);
    }

    function _wrapIfNative(IERC20 token) internal {
        if (token == WRAPPED_NATIVE_TOKEN && address(this).balance > 0) {
            WRAPPED_NATIVE_TOKEN.deposit{value: address(this).balance}();
        }
    }

    function _depositLogic(address /*caller*/, uint256 /*amount*/) internal virtual {
        return;
    }

    function _borrowLogic(address borrowToken, uint256 /*amount*/, bytes memory context)
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
        require(ASSETS.balanceOf(address(this)) >= amount, InsufficientLiquidity());
        ASSETS.safeTransfer(to, amount);
    }

    function _withdrawProfitLogic(IERC20 token) internal virtual returns (uint256) {
        uint256 totalBalance = token.balanceOf(address(this));
        if (token == ASSETS) {
            uint256 deposited = totalDeposited;
            if (totalBalance < deposited) return 0;
            return totalBalance - deposited;
        }
        return totalBalance;
    }

    function _balance(IERC20 token) internal view virtual returns (uint256) {
        if (token != ASSETS) return 0;
        uint256 result = token.balanceOf(address(this));
        if (token == WRAPPED_NATIVE_TOKEN) {
            result += address(this).balance;
        }
        return result;
    }

    // View functions

    function balance(IERC20 token) external view override returns (uint256) {
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
}
