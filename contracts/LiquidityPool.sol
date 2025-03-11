// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {IBorrower} from "./interfaces/IBorrower.sol";

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
contract LiquidityPool is ILiquidityPool, AccessControl, EIP712, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using BitMaps for BitMaps.BitMap;

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

    IERC20 immutable public ASSETS;

    bool public borrowPaused;
    address public mpcAddress;
    uint256 public totalDeposited;

    BitMaps.BitMap private _usedNonces;

    bytes32 public constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";
    bytes32 public constant WITHDRAW_PROFIT_ROLE = "WITHDRAW_PROFIT_ROLE";
    bytes32 public constant PAUSER_ROLE = "PAUSER_ROLE";

    error ZeroAddress();
    error InvalidSignature();
    error NotEnoughToDeposit();
    error TargetCallFailed();
    error ExpiredSignature();
    error NonceAlreadyUsed();
    error BorrowingIsPaused();
    error BorrowingIsNotPaused();
    error InsufficientLiquidity();
    error InvalidBorrowToken();
    error NotImplemented();
    error NoProfit();

    event Deposit(address from, uint256 amount);
    event Withdraw(address caller, address to, uint256 amount);
    event ProfitWithdrawn(address token, address to, uint256 amount);
    event BorrowPaused();
    event BorrowUnpaused();
    event MPCAddressSet(address oldMPCAddress, address newMPCAddress);

    constructor(
        address liquidityToken,
        address admin,
        address mpcAddress_
    ) EIP712("LiquidityPool", "1.0.0") {
        require(liquidityToken != address(0), ZeroAddress());
        ASSETS = IERC20(liquidityToken);
        require(admin != address(0), ZeroAddress());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        require(mpcAddress_ != address(0), ZeroAddress());
        mpcAddress = mpcAddress_;
    }

    function deposit(uint256 amount) external override onlyRole(LIQUIDITY_ADMIN_ROLE) {
        // called after receiving deposit in USDC
        uint256 balance = ASSETS.balanceOf(address(this));
        require(balance >= amount, NotEnoughToDeposit());
        _deposit(msg.sender, amount);
    }

    function depositWithPull(uint256 amount) external override {
        // pulls USDC from the sender
        ASSETS.safeTransferFrom(msg.sender, address(this), amount);
        _deposit(msg.sender, amount);
    }

    function borrow(
        address borrowToken,
        uint256 amount,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external override whenNotPaused() {
        // - Validate MPC signature
        _validateMPCSignatureWithCaller(borrowToken, amount, target, targetCallData, nonce, deadline, signature);
        _borrow(borrowToken, amount, target);
        // - Invoke the recipient's address with calldata provided in the MPC signature to complete
        // the operation securely.
        (bool success,) = target.call(targetCallData);
        require(success, TargetCallFailed());
    }

    function borrowAndSwap(
        address borrowToken,
        uint256 amount,
        SwapParams calldata swapInputData,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external override whenNotPaused() {
        _validateMPCSignatureWithCaller(borrowToken, amount, target, targetCallData, nonce, deadline, signature);
        _borrow(borrowToken, amount, msg.sender);
        // Call the swap function on caller
        IBorrower(msg.sender).swap(swapInputData.swapData);
        IERC20(swapInputData.fillToken).safeTransferFrom(msg.sender, address(this), swapInputData.fillAmount);
        IERC20(swapInputData.fillToken).forceApprove(target, swapInputData.fillAmount);
        // - Invoke the recipient's address with calldata provided in the MPC signature to complete
        // the operation securely.
        (bool success,) = target.call(targetCallData);
        require(success, TargetCallFailed());
    }

    function repay(address[] calldata) external virtual override {
        revert NotImplemented();
    }

    // Admin functions

    /// @notice Can withdraw a maximum of totalDeposited. If anything is left, it meant to be withdrawn through
    /// a withdrawProfit().
    function withdraw(address to, uint256 amount)
        external
        override
        onlyRole(LIQUIDITY_ADMIN_ROLE)
        whenNotPaused()
    {
        uint256 deposited = totalDeposited;
        require(deposited >= amount, InsufficientLiquidity());
        totalDeposited = deposited - amount;
        _withdrawLogic(to, amount);
        emit Withdraw(msg.sender, to, amount);
    }

    function withdrawProfit(
        address[] calldata tokens,
        address to
    ) external override onlyRole(WITHDRAW_PROFIT_ROLE) whenNotPaused() {
        _withdrawProfit(tokens, to);
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
        _pause();
    }

    function unpause() external override onlyRole(PAUSER_ROLE) whenPaused() {
        _unpause();
    }

    function paused() public view override(Pausable, ILiquidityPool) returns (bool) {
        return super.paused();
    }

    // Internal functions

    function _deposit(address caller, uint256 amount) internal {
        totalDeposited += amount;
        _depositLogic(caller, amount);
        emit Deposit(caller, amount);
    }

    function _validateMPCSignatureWithCaller(
        address borrowToken,
        uint256 amount,
        address target,
        bytes calldata targetCallData,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) internal {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            BORROW_TYPEHASH,
            msg.sender,
            borrowToken,
            amount,
            target,
            keccak256(targetCallData),
            nonce,
            deadline
        )));
        _validateSig(digest, nonce, deadline, signature);
    }

    function _validateSig(bytes32 digest, uint256 nonce, uint256 deadline, bytes calldata signature) internal {
        address signer = digest.recover(signature);
        require(signer == mpcAddress, InvalidSignature());
        require(_usedNonces.get(nonce) == false, NonceAlreadyUsed());
        _usedNonces.set(nonce);
        require(notPassed(deadline), ExpiredSignature());
    }

    function _borrow(address borrowToken, uint256 amount, address target) internal {
        require(!borrowPaused, BorrowingIsPaused());
        _borrowLogic(borrowToken, amount, target);
        IERC20(borrowToken).forceApprove(target, amount);
    }

    function _withdrawProfit(
        address[] calldata tokens,
        address to
    ) internal {
        require(to != address(0), ZeroAddress());
        bool success;
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            uint256 amountToWithdraw = _withdrawProfitLogic(token);
            if (amountToWithdraw == 0) continue;
            success = true;
            // Withdraw from this contract
            token.safeTransfer(to, amountToWithdraw);
            emit ProfitWithdrawn(address(token), to, amountToWithdraw);
        }
        require(success, NoProfit());
    }

    function _depositLogic(address /*caller*/, uint256 /*amount*/) internal virtual {
        return;
    }

    function _borrowLogic(address borrowToken, uint256 /*amount*/, address /*target*/) internal virtual {
        require(borrowToken == address(ASSETS), InvalidBorrowToken());
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
