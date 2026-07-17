// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {ORACLE_PRECISION} from "./utils/Constants.sol";

/// @title Oracle valuing Paxos-issued stablecoins (USDG, PYUSD) at a hardcoded 1:1 ratio to USDC.
/// @author Sprinter
/// @notice Implements {IOracle} for an admin-managed set of Paxos stablecoins, each pegged exactly 1:1 to USDC.
///         `getAssetValue` returns the USDC-denominated value of a given amount, adjusting only for any
///         decimal mismatch between the stablecoin and USDC. The price ratio is immutable at 1:1.
/// @dev `assetId` is the token address left-padded to bytes32 to allow non evm tokens in the future
contract PaxosOracle is IOracle, AccessControl {
    struct AssetConfig {
        bool supported;
        uint8 decimals;
    }

    struct AssetParams {
        bytes32 assetId;
        uint8 decimals;
    }

    /// @notice USDC token used as the value denomination.
    IERC20Metadata public immutable USDC;
    /// @notice Decimals of USDC, fetched once at deployment and used to scale returned values.
    uint8 public immutable USDC_DECIMALS;

    uint8 internal constant MAX_DECIMALS = 18;

    mapping(bytes32 assetId => AssetConfig) public assetConfig;

    event AssetAdded(bytes32 indexed assetId, uint8 decimals);
    event AssetRemoved(bytes32 indexed assetId);

    error ZeroAddress();
    error AssetAlreadySupported(bytes32 assetId);
    error AssetNotSupported(bytes32 assetId);
    error DecimalsTooLarge(uint8 decimals);
    error UnsupportedUSDCDecimals(uint8 decimals);

    /// @param admin Super-admin able to add/remove supported stablecoins.
    /// @param usdc Address of the USDC token, used as the value denomination (its decimals).
    /// @param initialAssets Initial set of stablecoins to support (e.g. USDG, PYUSD).
    constructor(address admin, address usdc, AssetParams[] memory initialAssets) {
        require(admin != address(0), ZeroAddress());
        require(usdc != address(0), ZeroAddress());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        USDC = IERC20Metadata(usdc);
        USDC_DECIMALS = IERC20Metadata(usdc).decimals();
        require(10**USDC_DECIMALS*ORACLE_PRECISION >= 10**MAX_DECIMALS, UnsupportedUSDCDecimals(USDC_DECIMALS));
        for (uint256 i = 0; i < initialAssets.length; ++i) {
            _addAsset(initialAssets[i].assetId, initialAssets[i].decimals);
        }
    }

    /// @notice Registers a stablecoin to be valued 1:1 against USDC.
    /// @param assetId The asset identifier (an EVM token address left-padded to bytes32).
    /// @param decimals The number of decimals the stablecoin uses. Provided explicitly so that
    ///        non-EVM assets, whose `decimals()` cannot be queried on-chain, can also be supported.
    function addAsset(bytes32 assetId, uint8 decimals) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _addAsset(assetId, decimals);
    }

    /// @notice Removes a previously registered stablecoin.
    /// @param assetId The asset identifier to remove.
    function removeAsset(bytes32 assetId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(assetConfig[assetId].supported, AssetNotSupported(assetId));
        delete assetConfig[assetId];
        emit AssetRemoved(assetId);
    }

    /// @notice Returns the USDC-denominated value of `amount` units of the supported stablecoin `assetId`.
    /// @dev Reverts for any asset that is not currently supported.
    function getAssetValue(bytes32 assetId, uint256 amount) external view returns (uint256) {
        AssetConfig memory config = assetConfig[assetId];
        require(config.supported, AssetNotSupported(assetId));
        if (config.decimals == USDC_DECIMALS) {
            return amount;
        }
        if (config.decimals > USDC_DECIMALS) {
            return amount / (10 ** (config.decimals - USDC_DECIMALS));
        }
        return amount * (10 ** (USDC_DECIMALS - config.decimals));
    }

    /// @notice Returns true if `assetId` is currently valued by this oracle.
    function isSupported(bytes32 assetId) external view returns (bool) {
        return assetConfig[assetId].supported;
    }

    function _addAsset(bytes32 assetId, uint8 decimals) internal {
        require(!assetConfig[assetId].supported, AssetAlreadySupported(assetId));
        require(decimals <= MAX_DECIMALS, DecimalsTooLarge(decimals));
        assetConfig[assetId] = AssetConfig({supported: true, decimals: decimals});
        emit AssetAdded(assetId, decimals);
    }
}
