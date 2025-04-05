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
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";
import {IManagedToken} from "./interfaces/IManagedToken.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {ILiquidityHub} from "./interfaces/ILiquidityHub.sol";

/// @title A modified version of the ERC4626 vault with the following key differences:
/// 1. The shares token functionality is delegated to a dedicated token contract.
/// 2. The total assets variable cannot be increased by a donation, making inflation by users impossible.
/// 3. The total assets could be increased or decreased by an Adjuster role to modify the conversion rate.
/// 4. Has an admin controlled maximum total assets limit.
/// 5. Supports deposit with permit if the underlying asset supports permit as well.
/// 6. Underlying assets are deposited/withdrawn to/from a connected ILiquidityPool contract.
/// 7. To withdraw/redeem on behalf, owner has to approve spender on the shares contract instead of this one.
/// @notice Upgradeable.
/// @author Oleksii Matiiasevych <oleksii@chainsafe.io>
contract LiquidityHub is ILiquidityHub, ERC4626Upgradeable, AccessControlUpgradeable {
    using Math for uint256;

    IManagedToken immutable public SHARES;
    ILiquidityPool immutable public LIQUIDITY_POOL;
    bytes32 public constant ASSETS_ADJUST_ROLE = "ASSETS_ADJUST_ROLE";
    bytes32 public constant DEPOSIT_PROFIT_ROLE = "DEPOSIT_PROFIT_ROLE";
    bytes32 public constant SET_ASSETS_LIMIT_ROLE = "SET_ASSETS_LIMIT_ROLE";

    event TotalAssetsAdjustment(uint256 oldAssets, uint256 newAssets);
    event AssetsLimitSet(uint256 oldLimit, uint256 newLimit);
    event DepositProfit(address caller, uint256 assets);

    error ZeroAddress();
    error NotImplemented();
    error IncompatibleAssetsAndShares();
    error AssetsLimitIsTooBig();
    error EmptyHub();
    error AssetsExceedHardLimit();

    /// @custom:storage-location erc7201:sprinter.storage.LiquidityHub
    struct LiquidityHubStorage {
        uint256 totalAssets;
        uint256 assetsLimit;
    }

    bytes32 private constant STORAGE_LOCATION = 0xb877bfaae1674461dd1960c90f24075e3de3265a91f6906fe128ab8da6ba1700;

    constructor(address shares, address liquidityPool) {
        ERC7201Helper.validateStorageLocation(
            STORAGE_LOCATION,
            "sprinter.storage.LiquidityHub"
        );
        require(shares != address(0), ZeroAddress());
        require(liquidityPool != address(0), ZeroAddress());
        SHARES = IManagedToken(shares);
        LIQUIDITY_POOL = ILiquidityPool(liquidityPool);
        _disableInitializers();
    }

    function initialize(
        IERC20 asset_,
        address admin,
        address adjuster,
        address depositorProfit,
        address assetsLimitSetter,
        uint256 newAssetsLimit
    ) external initializer() {
        ERC4626Upgradeable.__ERC4626_init(asset_);
        require(
            IERC20Metadata(address(asset_)).decimals() <= IERC20Metadata(address(SHARES)).decimals(),
            IncompatibleAssetsAndShares()
        );
        // Deliberately not initializing ERC20Upgradable because its
        // functionality is delegated to SHARES.
        require(admin != address(0), ZeroAddress());
        require(adjuster != address(0), ZeroAddress());
        require(depositorProfit != address(0), ZeroAddress());
        require(assetsLimitSetter != address(0), ZeroAddress());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ASSETS_ADJUST_ROLE, adjuster);
        _grantRole(DEPOSIT_PROFIT_ROLE, depositorProfit);
        _grantRole(SET_ASSETS_LIMIT_ROLE, assetsLimitSetter);
        _setAssetsLimit(newAssetsLimit);
    }

    function adjustTotalAssets(uint256 amount, bool isIncrease) external onlyRole(ASSETS_ADJUST_ROLE) {
        LiquidityHubStorage storage $ = _getStorage();
        uint256 assets = $.totalAssets;
        require(assets > 0, EmptyHub());
        if (isIncrease) require(amount <= _assetsHardLimit(assets), AssetsExceedHardLimit());
        uint256 newAssets = isIncrease ? assets + amount : assets - amount;
        $.totalAssets = newAssets;
        emit TotalAssetsAdjustment(assets, newAssets);
    }

    function setAssetsLimit(uint256 newAssetsLimit) external onlyRole(SET_ASSETS_LIMIT_ROLE) {
        _setAssetsLimit(newAssetsLimit);
    }

    function _setAssetsLimit(uint256 newAssetsLimit) internal {
        require(newAssetsLimit <= type(uint256).max / 10 ** _decimalsOffset(), AssetsLimitIsTooBig());
        LiquidityHubStorage storage $ = _getStorage();
        uint256 oldLimit = $.assetsLimit;
        $.assetsLimit = newAssetsLimit;
        emit AssetsLimitSet(oldLimit, newAssetsLimit);
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

    function assetsLimit() public view returns (uint256) {
        return _getStorage().assetsLimit;
    }

    function maxDeposit(address) public view virtual override returns (uint256) {
        uint256 total = totalAssets();
        uint256 limit = assetsLimit();
        if (total >= limit) {
            return 0;
        }
        uint256 hardLimit = _assetsHardLimit(total);
        return Math.min(hardLimit, limit - total);
    }

    function maxMint(address) public view virtual override returns (uint256) {
        return _convertToShares(maxDeposit(address(0)), Math.Rounding.Floor);
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

    function depositProfit(uint256 assets) external onlyRole(DEPOSIT_PROFIT_ROLE) {
        LiquidityHubStorage storage $ = _getStorage();
        SafeERC20.safeTransferFrom(IERC20(asset()), _msgSender(), address(LIQUIDITY_POOL), assets);
        uint256 totalAssets = $.totalAssets;
        require(totalAssets > 0, EmptyHub());
        require(assets <= _assetsHardLimit(totalAssets), AssetsExceedHardLimit());
        uint256 newAssets = totalAssets + assets;
        $.totalAssets = newAssets;
        LIQUIDITY_POOL.deposit(assets);
        emit DepositProfit(_msgSender(), assets);
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view virtual override returns (uint256) {
        (uint256 supplyShares, uint256 supplyAssets) = _getTotalsForConversion();
        return assets.mulDiv(supplyShares, supplyAssets, rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view virtual override returns (uint256) {
        (uint256 supplyShares, uint256 supplyAssets) = _getTotalsForConversion();
        return shares.mulDiv(supplyAssets, supplyShares, rounding);
    }

    function _getTotalsForConversion() internal view returns (uint256, uint256) {
        uint256 supplyShares = totalSupply();
        uint256 supplyAssets = totalAssets();
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
        LIQUIDITY_POOL.deposit(assets);
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
    
    function _assetsHardLimit(uint256 total) internal view returns (uint256) {
        uint256 totalShares = totalSupply();
        uint256 multiplier = uint256(10) ** _decimalsOffset();
        if (total * multiplier <= totalShares) {
            uint256 sharesHardLimit = type(uint256).max - totalShares;
            return _convertToAssets(sharesHardLimit, Math.Rounding.Floor);
        } else {
            return type(uint256).max / multiplier - total;
        }
    }

    function _getStorage() private pure returns (LiquidityHubStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
