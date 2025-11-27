// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILiquidityPoolBase} from "./interfaces/ILiquidityPoolBase.sol";

/// @title A middleware contract that allows Sprinter funds to be rebalanced to/from the underlying ERC4626 vault.
/// Same as liquidity pools it is admin managed, and profits from underlying vault are accounted for.
/// @author Oleksii Matiiasevych <oleksii@sprinter.tech>
contract ERC4626Adapter is ILiquidityPoolBase, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 private constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";
    bytes32 private constant WITHDRAW_PROFIT_ROLE = "WITHDRAW_PROFIT_ROLE";
    bytes32 private constant PAUSER_ROLE = "PAUSER_ROLE";

    IERC4626 public immutable TARGET_VAULT;
    IERC20 public immutable ASSETS;

    uint256 public totalDeposited;
    bool public paused;

    event Deposit(address caller, uint256 amount);
    event Withdraw(address caller, address to, uint256 amount);
    event Paused(address account);
    event Unpaused(address account);
    event ProfitWithdrawn(address token, address to, uint256 amount);

    error ZeroAddress();
    error IncompatibleAssets();
    error InsufficientLiquidity();
    error EnforcedPause();
    error ExpectedPause();
    error NoProfit();
    error InvalidToken();

    constructor(address assets, address targetVault, address admin) {
        require(assets != address(0), ZeroAddress());
        require(targetVault != address(0), ZeroAddress());
        require(admin != address(0), ZeroAddress());
        require(assets == IERC4626(targetVault).asset(), IncompatibleAssets());
        TARGET_VAULT = IERC4626(targetVault);
        ASSETS = IERC20(assets);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    modifier whenNotPaused() {
        require(!paused, EnforcedPause());
        _;
    }

    modifier whenPaused() {
        require(paused, ExpectedPause());
        _;
    }

    function deposit(uint256 amount) external override onlyRole(LIQUIDITY_ADMIN_ROLE) whenNotPaused() {
        _deposit(_msgSender(), amount);
    }

    function depositWithPull(uint256 amount) external override whenNotPaused() {
        ASSETS.safeTransferFrom(_msgSender(), address(this), amount);
        _deposit(_msgSender(), amount);
    }

    function withdraw(address to, uint256 amount) override
        external
        onlyRole(LIQUIDITY_ADMIN_ROLE)
        whenNotPaused()
    {
        require(to != address(0), ZeroAddress());
        uint256 deposited = totalDeposited;
        require(deposited >= amount, InsufficientLiquidity());
        totalDeposited = deposited - amount;
        TARGET_VAULT.withdraw(amount, to, address(this));
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
            uint256 amountToWithdraw = _withdrawProfitLogic(token);
            if (amountToWithdraw == 0) continue;
            success = true;
            token.safeTransfer(to, amountToWithdraw);
            emit ProfitWithdrawn(address(token), to, amountToWithdraw);
        }
        require(success, NoProfit());
    }

    function pause() external override onlyRole(PAUSER_ROLE) whenNotPaused() {
        paused = true;
        emit Paused(_msgSender());
    }

    function unpause() external override onlyRole(PAUSER_ROLE) whenPaused() {
        paused = false;
        emit Unpaused(_msgSender());
    }

    function _deposit(address caller, uint256 amount) private {
        ASSETS.forceApprove(address(TARGET_VAULT), amount);
        TARGET_VAULT.deposit(amount, address(this));
        totalDeposited += amount;
        emit Deposit(caller, amount);
    }

    function _withdrawProfitLogic(IERC20 token) internal returns (uint256) {
        require(token != IERC20(TARGET_VAULT), InvalidToken());
        uint256 localBalance = token.balanceOf(address(this));
        if (token == ASSETS) {
            uint256 deposited = totalDeposited;
            uint256 depositedShares = TARGET_VAULT.previewWithdraw(deposited);
            uint256 totalShares = TARGET_VAULT.balanceOf(address(this));
            if (totalShares <= depositedShares) return localBalance;
            uint256 profit = TARGET_VAULT.redeem(totalShares - depositedShares, address(this), address(this));
            assert(TARGET_VAULT.previewRedeem(depositedShares) >= deposited);
            return profit + localBalance;
        }
        return localBalance;
    }
}
