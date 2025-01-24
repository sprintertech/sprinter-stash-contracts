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
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {AccessControlUpgradeable} from '@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol';
import {ERC7201Helper} from './utils/ERC7201Helper.sol';
import {IManagedToken} from './interfaces/IManagedToken.sol';
import {ILiquidityPool} from './interfaces/ILiquidityPool.sol';

contract LiquidityHub is ERC4626Upgradeable, AccessControlUpgradeable {
    using Math for uint256;

    IManagedToken immutable public SHARES;
    ILiquidityPool immutable public LIQUIDITY_POOL;
    bytes32 public constant ASSETS_ADJUST_ROLE = "ASSETS_ADJUST_ROLE";

    event TotalAssetsAdjustment(uint256 oldAssets, uint256 newAssets);

    error ZeroAddress();
    error NotImplemented();
    error IncompatibleAssetsAndShares();

    /// @custom:storage-location erc7201:sprinter.storage.LiquidityHub
    struct LiquidityHubStorage {
        uint256 totalAssets;
    }

    bytes32 private constant StorageLocation = 0xb877bfaae1674461dd1960c90f24075e3de3265a91f6906fe128ab8da6ba1700;

    constructor(address shares, address liquidityPool) {
        ERC7201Helper.validateStorageLocation(
            StorageLocation,
            'sprinter.storage.LiquidityHub'
        );
        if (shares == address(0)) revert ZeroAddress();
        if (liquidityPool == address(0)) revert ZeroAddress();
        SHARES = IManagedToken(shares);
        LIQUIDITY_POOL = ILiquidityPool(liquidityPool);
        _disableInitializers();
    }

    function initialize(IERC20 asset_, address admin, address adjuster) external initializer() {
        ERC4626Upgradeable.__ERC4626_init(asset_);
        require(
            IERC20Metadata(address(asset_)).decimals() <= IERC20Metadata(address(SHARES)).decimals(),
            IncompatibleAssetsAndShares()
        );
        // Deliberately not initializing ERC20Upgradable because its
        // functionality is delegated to SHARES.
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ASSETS_ADJUST_ROLE, adjuster);
    }

    function adjustTotalAssets(uint256 amount, bool isIncrease) external onlyRole(ASSETS_ADJUST_ROLE) {
        LiquidityHubStorage storage $ = _getStorage();
        uint256 assets = $.totalAssets;
        uint256 newAssets = isIncrease ? assets + amount : assets - amount;
        $.totalAssets = newAssets;
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
        return IERC20(address(SHARES)).totalSupply();
    }

    function balanceOf(address owner) public view virtual override(IERC20, ERC20Upgradeable) returns (uint256) {
        return IERC20(address(SHARES)).balanceOf(owner);
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

    function depositWithPermit(
        uint256 assets,
        address receiver,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC20Permit(asset()).permit(
            _msgSender(),
            address(this),
            assets,
            deadline,
            v,
            r,
            s
        );
        deposit(assets, receiver);
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

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
        LiquidityHubStorage storage $ = _getStorage();
        SafeERC20.safeTransferFrom(IERC20(asset()), caller, address(LIQUIDITY_POOL), assets);
        _mint(receiver, shares);
        $.totalAssets += assets;
        LIQUIDITY_POOL.deposit();
        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        LiquidityHubStorage storage $ = _getStorage();
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        $.totalAssets -= assets;
        _burn(owner, shares);
        LIQUIDITY_POOL.withdraw(receiver, assets);
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
