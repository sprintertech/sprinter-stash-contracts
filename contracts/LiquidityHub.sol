// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {
    IERC20,
    IERC20Metadata,
    ERC20Upgradeable,
    ERC4626Upgradeable,
    SafeERC20,
    Math
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {AccessControlUpgradeable} from '@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol';
import {ERC7201Helper} from './utils/ERC7201Helper.sol';
import {IManagedToken} from './interfaces/IManagedToken.sol';

contract LiquidityHub is ERC4626Upgradeable, AccessControlUpgradeable {
    using Math for uint256;

    IManagedToken immutable public SHARES;
    bytes32 public constant ASSETS_UPDATE_ROLE = "ASSETS_UPDATE_ROLE";

    event TotalAssetsAdjustment(uint256 oldAssets, uint256 newAssets);
    event DepositRequest(address caller, address receiver, uint256 assets);
    event WithdrawRequest(address caller, address receiver, address owner, uint256 shares);

    error ZeroAddress();
    error NotImplemented();
    error IncompatibleAssetsAndShares();

    struct AdjustmentRecord {
        uint256 totalAssets;
        uint256 totalShares;
    }

    struct PendingDeposit {
        uint256 assets;
        uint256 adjustmentId;
    }

    struct PendingWithdraw {
        uint256 shares;
        uint256 adjustmentId;
    }

    /// @custom:storage-location erc7201:sprinter.storage.LiquidityHub
    struct LiquidityHubStorage {
        uint256 totalAssets;
        uint256 totalShares;
        uint256 depositedAssets;
        uint256 burnedShares;
        uint256 lastAdjustmentId;
        mapping(uint256 adjustmentId => AdjustmentRecord) adjustmentRecords;
        mapping(address receiver => PendingDeposit) pendingDeposits;
        mapping(address receiver => PendingWithdraw) pendingWithdrawals;
    }

    bytes32 private constant StorageLocation = 0xb877bfaae1674461dd1960c90f24075e3de3265a91f6906fe128ab8da6ba1700;

    constructor(address shares) {
        ERC7201Helper.validateStorageLocation(
            StorageLocation,
            'sprinter.storage.LiquidityHub'
        );
        if (shares == address(0)) revert ZeroAddress();
        SHARES = IManagedToken(shares);
        _disableInitializers();
    }

    function initialize(IERC20 asset_, address admin) external initializer() {
        ERC4626Upgradeable.__ERC4626_init(asset_);
        require(
            IERC20Metadata(address(asset_)).decimals() <= IERC20Metadata(address(SHARES)).decimals(),
            IncompatibleAssetsAndShares()
        );
        // Deliberately not initializing ERC20Upgradable because its
        // functionality is delegated to SHARES.
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function adjustTotalAssets(uint256 amount, bool isIncrease) external onlyRole(ASSETS_UPDATE_ROLE) {
        LiquidityHubStorage storage $ = _getStorage();
        uint256 adjustmentId = ++$.lastAdjustmentId;
        AdjustmentRecord storage adjustmentRecord = $.adjustmentRecords[adjustmentId];
        uint256 assets = $.totalAssets;
        uint256 newAssets = isIncrease ? assets + amount : assets - amount;
        uint256 supplyShares = totalSupply();
        uint256 mintingShares = _toShares($.depositedAssets, supplyShares, newAssets, Math.Rounding.Floor);
        uint256 releasingAssets = _toAssets($.burnedShares, supplyShares, newAssets, Math.Rounding.Floor);
        $.totalAssets = newAssets - releasingAssets;
        $.totalShares = supplyShares + mintingShares - $.burnedShares;
        $.depositedAssets = 0;
        $.burnedShares = 0;
        adjustmentRecord.totalAssets = newAssets;
        adjustmentRecord.totalShares = supplyShares;
        emit TotalAssetsAdjustment(assets, newAssets);
    }

    function name() public pure override(IERC20Metadata, ERC20Upgradeable) returns (string memory) {
        revert NotImplemented();
    }

    function symbol() public pure override(IERC20Metadata, ERC20Upgradeable) returns (string memory) {
        revert NotImplemented();
    }

    function decimals() public pure override returns (uint8) {
        revert NotImplemented();
    }

    function totalSupply() public view virtual override(IERC20, ERC20Upgradeable) returns (uint256) {
        return _getStorage().totalShares;
    }

    function balanceOf(address owner) public view virtual override(IERC20, ERC20Upgradeable) returns (uint256) {
        return IERC20(address(SHARES)).balanceOf(owner) + _simulateSettleDeposit(owner);
    }

    function transfer(address, uint256) public pure override(IERC20, ERC20Upgradeable) returns (bool) {
        revert NotImplemented();
    }

    function allowance(address, address) public pure override(IERC20, ERC20Upgradeable) returns (uint256) {
        // Silences the unreachable code warning from ERC20Upgradeable._spendAllowance().
        return 0;
    }

    function approve(address, uint256) public pure override(IERC20, ERC20Upgradeable) returns (bool) {
        revert NotImplemented();
    }

    function transferFrom(address, address, uint256) public pure override(IERC20, ERC20Upgradeable) returns (bool) {
        revert NotImplemented();
    }

    function totalAssets() public view virtual override returns (uint256) {
        return _getStorage().totalAssets;
    }

    function _toShares(
        uint256 assets,
        uint256 supplyShares,
        uint256 supplyAssets,
        Math.Rounding rounding
    ) internal view returns (uint256) {
        (supplyShares, supplyAssets) = _getTotals(supplyShares, supplyAssets);
        return assets.mulDiv(supplyShares, supplyAssets, rounding);
    }

    function _toAssets(
        uint256 shares,
        uint256 supplyShares,
        uint256 supplyAssets,
        Math.Rounding rounding
    ) internal view returns (uint256) {
        (supplyShares, supplyAssets) = _getTotals(supplyShares, supplyAssets);
        return shares.mulDiv(supplyAssets, supplyShares, rounding);
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view virtual override returns (uint256) {
        return _toShares(assets, totalSupply(), totalAssets(), rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view virtual override returns (uint256) {
        return _toAssets(shares, totalSupply(), totalAssets(), rounding);
    }

    function _getTotals(uint256 supplyShares, uint256 supplyAssets) internal view returns (uint256, uint256) {
        if (supplyShares == 0) {
            supplyShares = 10 ** _decimalsOffset();
        }
        if (supplyAssets == 0) {
            supplyAssets = 1;
        }
        return (supplyShares, supplyAssets);
    }

    function _update(address from, address to, uint256 value) internal virtual override {
        if (from == address(0)) {
            SHARES.mint(to, value);
        } else if (to == address(0)) {
            SHARES.burn(from, value);
        } else {
            revert NotImplemented();
        }
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal virtual override {
        SHARES.spendAllowance(owner, spender, value);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 /*shares*/) internal virtual override {
        _settleWithdraw(caller, caller, caller);
        _settleDeposit(caller, receiver);
        LiquidityHubStorage storage $ = _getStorage();
        SafeERC20.safeTransferFrom(IERC20(asset()), caller, address(this), assets);
        PendingDeposit storage pendingDeposit = $.pendingDeposits[receiver];
        pendingDeposit.assets += assets;
        pendingDeposit.adjustmentId = $.lastAdjustmentId;
        emit DepositRequest(caller, receiver, assets);
    }

    function _simulateSettleDeposit(address receiver) internal view returns (uint256) {
        LiquidityHubStorage storage $ = _getStorage();
        PendingDeposit storage pendingDeposit = $.pendingDeposits[receiver];
        uint256 assets = pendingDeposit.assets;
        if (assets == 0) {
            return 0;
        }
        uint256 settleAdjustmentId = pendingDeposit.adjustmentId + 1;
        if (settleAdjustmentId > $.lastAdjustmentId) {
            return 0;
        }
        AdjustmentRecord memory adjustmentRecord = $.adjustmentRecords[settleAdjustmentId];
        uint256 shares = _toShares(
            assets, adjustmentRecord.totalShares, adjustmentRecord.totalAssets, Math.Rounding.Floor
        );
        return shares;
    }

    function _settleDeposit(address caller, address receiver) internal {
        uint256 shares = _simulateSettleDeposit(receiver);
        PendingDeposit storage pendingDeposit = _getStorage().pendingDeposits[receiver];
        uint256 assets = pendingDeposit.assets;
        pendingDeposit.assets = 0;
        pendingDeposit.adjustmentId = 0;
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 /*assets*/,
        uint256 shares
    ) internal virtual override {
        _settleDeposit(caller, owner);
        _settleWithdraw(caller, receiver, owner);
        LiquidityHubStorage storage $ = _getStorage();
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        PendingWithdraw storage pendingWithdraw = $.pendingWithdrawals[receiver];
        pendingWithdraw.shares += shares;
        pendingWithdraw.adjustmentId = $.lastAdjustmentId;
        $.burnedShares += shares;
        _burn(owner, shares);
        emit WithdrawRequest(caller, receiver, owner, shares);
    }

    function _settleWithdraw(address caller, address receiver, address owner) internal {
        LiquidityHubStorage storage $ = _getStorage();
        PendingWithdraw storage pendingWithdraw = $.pendingWithdrawals[receiver];
        uint256 shares = pendingWithdraw.shares;
        if (shares == 0) {
            return;
        }
        uint256 settleAdjustmentId = pendingWithdraw.adjustmentId + 1;
        if (settleAdjustmentId > $.lastAdjustmentId) {
            return;
        }
        pendingWithdraw.shares = 0;
        pendingWithdraw.adjustmentId = 0;
        AdjustmentRecord memory adjustmentRecord = $.adjustmentRecords[settleAdjustmentId];
        uint256 assets = _toAssets(
            shares, adjustmentRecord.totalShares, adjustmentRecord.totalAssets, Math.Rounding.Floor
        );
        SafeERC20.safeTransfer(IERC20(asset()), receiver, assets);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function _decimalsOffset() internal view virtual override returns (uint8) {
        return IERC20Metadata(address(SHARES)).decimals() - IERC20Metadata(asset()).decimals();
    }

    function _getStorage() private pure returns (LiquidityHubStorage storage $) {
        assembly {
            $.slot := StorageLocation
        }
    }
}
