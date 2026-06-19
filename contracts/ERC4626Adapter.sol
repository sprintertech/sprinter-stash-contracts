// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILiquidityPoolBase} from "./interfaces/ILiquidityPoolBase.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";

/// @title A middleware contract that allows Sprinter funds to be rebalanced to/from the underlying ERC4626 vault.
/// Same as liquidity pools it is admin managed, and profits from underlying vault are accounted for.
/// @notice Upgradeable.
/// @author Oleksii Matiiasevych <oleksii@sprinter.tech>
contract ERC4626Adapter is ILiquidityPoolBase, AccessControlUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 private constant LIQUIDITY_ADMIN_ROLE = "LIQUIDITY_ADMIN_ROLE";
    bytes32 private constant WITHDRAW_PROFIT_ROLE = "WITHDRAW_PROFIT_ROLE";
    bytes32 private constant PAUSER_ROLE = "PAUSER_ROLE";

    IERC4626 public immutable TARGET_VAULT;
    IERC20 public immutable ASSETS;

    /// @custom:storage-location erc7201:sprinter.storage.ERC4626Adapter
    struct ERC4626AdapterStorage {
        uint256 totalDeposited;
        bool paused;
    }

    bytes32 private constant STORAGE_LOCATION =
        0xdb0057345f3738848bf8a9e90884cadba7e4e1698ccc2272bbd8e7c847969100;

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

    constructor(address assets, address targetVault) {
        ERC7201Helper.validateStorageLocation(STORAGE_LOCATION, "sprinter.storage.ERC4626Adapter");
        require(assets != address(0), ZeroAddress());
        require(targetVault != address(0), ZeroAddress());
        require(assets == IERC4626(targetVault).asset(), IncompatibleAssets());
        TARGET_VAULT = IERC4626(targetVault);
        ASSETS = IERC20(assets);
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __AccessControl_init();
        require(admin != address(0), ZeroAddress());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    modifier whenNotPaused() {
        require(!_getStorage().paused, EnforcedPause());
        _;
    }

    modifier whenPaused() {
        require(_getStorage().paused, ExpectedPause());
        _;
    }

    function totalDeposited() external view returns (uint256) {
        return _getStorage().totalDeposited;
    }

    function paused() external view returns (bool) {
        return _getStorage().paused;
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
        ERC4626AdapterStorage storage $ = _getStorage();
        uint256 deposited = $.totalDeposited;
        require(deposited >= amount, InsufficientLiquidity());
        $.totalDeposited = deposited - amount;
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
        _getStorage().paused = true;
        emit Paused(_msgSender());
    }

    function unpause() external override onlyRole(PAUSER_ROLE) whenPaused() {
        _getStorage().paused = false;
        emit Unpaused(_msgSender());
    }

    function _deposit(address caller, uint256 amount) private {
        ASSETS.forceApprove(address(TARGET_VAULT), amount);
        TARGET_VAULT.deposit(amount, address(this));
        _getStorage().totalDeposited += amount;
        emit Deposit(caller, amount);
    }

    function _withdrawProfitLogic(IERC20 token) internal returns (uint256) {
        require(token != IERC20(address(TARGET_VAULT)), InvalidToken());
        uint256 localBalance = token.balanceOf(address(this));
        if (token == ASSETS) {
            uint256 deposited = _getStorage().totalDeposited;
            uint256 depositedShares = TARGET_VAULT.previewWithdraw(deposited);
            uint256 totalShares = TARGET_VAULT.balanceOf(address(this));
            if (totalShares <= depositedShares) return localBalance;
            uint256 profit = TARGET_VAULT.redeem(totalShares - depositedShares, address(this), address(this));
            assert(TARGET_VAULT.previewRedeem(depositedShares) >= deposited);
            return profit + localBalance;
        }
        return localBalance;
    }

    function _getStorage() private pure returns (ERC4626AdapterStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
