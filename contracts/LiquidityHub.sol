// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {
    IERC20,
    IERC20Metadata,
    ERC20Upgradeable,
    ERC4626Upgradeable,
    Math
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {ERC7201Helper} from './utils/ERC7201Helper.sol';
import {IManagedToken} from './interfaces/IManagedToken.sol';

contract LiquidityHub is ERC4626Upgradeable {
    using Math for uint256;

    IManagedToken immutable public SHARES;

    error ZeroAddress();
    error NotImplemented();
    error IncompatibleAssetsAndShares();

    /// @custom:storage-location erc7201:sprinter.storage.LiquidityHub
    struct LiquidityHubStorage {
        uint256 totalAssets;
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

    function initialize(IERC20 asset_) external initializer() {
        ERC4626Upgradeable.__ERC4626_init(asset_);
        require(
            IERC20Metadata(address(asset_)).decimals() <= IERC20Metadata(address(SHARES)).decimals(),
            IncompatibleAssetsAndShares()
        );
        // Deliberately not initializing ERC20Upgradable because its
        // functionality is delegated to SHARES.
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
        super._deposit(caller, receiver, assets, shares);
        _getStorage().totalAssets += assets;
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        _getStorage().totalAssets -= assets;
        super._withdraw(caller, receiver, owner, assets, shares);
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
