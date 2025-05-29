// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {IRepayer} from "./interfaces/IRepayer.sol";
import {IWrappedNativeToken} from "./interfaces/IWrappedNativeToken.sol";

import {CCTPAdapter} from "./utils/CCTPAdapter.sol";
import {AcrossAdapter} from "./utils/AcrossAdapter.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";

/// @title Performs repayment to Liquidity Pools on same/different chains.
/// Routes, which is a destination pool/domain and a bridging provider, have to be approved by admin.
/// REPAYER_ROLE is needed to finalize/init rebalancing process.
/// @notice Upgradeable.
/// @author Tanya Bushenyova <tanya@chainsafe.io>
contract Repayer is IRepayer, AccessControlUpgradeable, CCTPAdapter, AcrossAdapter {
    using SafeERC20 for IERC20;
    using BitMaps for BitMaps.BitMap;
    using EnumerableSet for EnumerableSet.AddressSet;

    Domain immutable public DOMAIN;
    IERC20 immutable public ASSETS;
    bytes32 constant public REPAYER_ROLE = "REPAYER_ROLE";
    IWrappedNativeToken immutable public WRAPPED_NATIVE_TOKEN;

    /// @custom:storage-location erc7201:sprinter.storage.Repayer
    struct RepayerStorage {
        mapping(address pool => BitMaps.BitMap) allowedRoutes;
        EnumerableSet.AddressSet knownPools;
        mapping(address pool => bool) poolSupportsAllTokens;
    }

    bytes32 private constant STORAGE_LOCATION = 0xa6615d19cc0b2a17ee46271ca76cd3f303efb9bf682e7eb5c4e7290e895cde00;

    event SetRoute(
        address destinationPool,
        Domain destinationDomain,
        Provider provider,
        bool poolSupportsAllTokens,
        bool isAllowed
    );
    event InitiateRepay(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        Provider provider
    );
    event ProcessRepay(IERC20 token, uint256 amount, address destinationPool, Provider provider);

    error ZeroAmount();
    error InsufficientBalance();
    error RouteDenied();
    error InvalidRoute();
    error InvalidToken();
    error UnsupportedProvider();
    error InvalidLength();
    error InvalidPoolAssets();

    constructor(
        Domain localDomain,
        IERC20 assets,
        address cctpTokenMessenger,
        address cctpMessageTransmitter,
        address acrossSpokePool,
        address wrappedNativeToken
    )
        CCTPAdapter(cctpTokenMessenger, cctpMessageTransmitter)
        AcrossAdapter(acrossSpokePool)
    {
        ERC7201Helper.validateStorageLocation(
            STORAGE_LOCATION,
            "sprinter.storage.Repayer"
        );
        require(address(assets) != address(0), ZeroAddress());
        DOMAIN = localDomain;
        ASSETS = assets;
        WRAPPED_NATIVE_TOKEN = IWrappedNativeToken(wrappedNativeToken);
    }

    receive() external payable {
        // Allow native token transfers.
    }

    function initialize(
        address admin,
        address repayer,
        address[] memory pools,
        Domain[] memory domains,
        Provider[] memory providers,
        bool[] memory poolSupportsAllTokens
    ) external initializer() {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REPAYER_ROLE, repayer);
        _setRoute(pools, domains, providers, poolSupportsAllTokens, true);
    }

    function setRoute(
        address[] calldata pools,
        Domain[] calldata domains,
        Provider[] calldata providers,
        bool[] memory poolSupportsAllTokens,
        bool isAllowed
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRoute(pools, domains, providers, poolSupportsAllTokens, isAllowed);
    }

    /// @notice If the selected provider requires native currency payment to cover fees,
    /// then caller has to include it in the transaction. It is then the responsibility
    /// of the Adapter to forward the payment and return any change back to the caller.
    function initiateRepay(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        Provider provider,
        bytes calldata extraData
    ) external payable override onlyRole(REPAYER_ROLE) {
        require(amount > 0, ZeroAmount());
        if (token == WRAPPED_NATIVE_TOKEN) {
            uint256 thisBalance = address(this).balance - msg.value;
            if (thisBalance > 0) WRAPPED_NATIVE_TOKEN.deposit{value: thisBalance}();
        }
        require(token.balanceOf(address(this)) >= amount, InsufficientBalance());
        require(isRouteAllowed(destinationPool, destinationDomain, provider), RouteDenied());

        emit InitiateRepay(token, amount, destinationPool, destinationDomain, provider);

        RepayerStorage storage $ = _getStorage();

        if (provider == Provider.LOCAL) {
            // This should always pass because isRouteAllowed check will fail earlier.
            // It is put here for explicitness.
            require(destinationDomain == DOMAIN, UnsupportedDomain());

            if (!$.poolSupportsAllTokens[destinationPool]) {
                require(token == ASSETS, InvalidToken());
            }
            // For local we proceed to the process right away.
            _processRepayLOCAL(token, amount, destinationPool);
        } else
        if (provider == Provider.CCTP) {
            require(token == ASSETS, InvalidToken());
            initiateTransferCCTP(ASSETS, amount, destinationPool, destinationDomain);
        } else
        if (provider == Provider.ACROSS) {
            initiateTransferAcross(token, amount, destinationPool, destinationDomain, extraData);
        } else {
            // Unreachable atm, but could become so when more providers are added to enum.
            revert UnsupportedProvider();
        }
    }

    function processRepay(
        address destinationPool,
        Provider provider,
        bytes calldata extraData
    ) external override onlyRole(REPAYER_ROLE) {
        require(isRouteAllowed(destinationPool, DOMAIN, Provider.LOCAL), RouteDenied());
        uint256 amount = 0;
        if (provider == Provider.CCTP) {
            amount = processTransferCCTP(ASSETS, destinationPool, extraData);
        } else {
            revert UnsupportedProvider();
        }

        emit ProcessRepay(ASSETS, amount, destinationPool, provider);
    }

    function _processRepayLOCAL(
        IERC20 token,
        uint256 amount,
        address destinationPool
    ) internal {
        token.safeTransfer(destinationPool, amount);
        emit ProcessRepay(token, amount, destinationPool, Provider.LOCAL);
    }

    function _setRoute(
        address[] memory pools,
        Domain[] memory domains,
        Provider[] memory providers,
        bool[] memory poolSupportsAllTokens,
        bool isAllowed
    ) internal {
        RepayerStorage storage $ = _getStorage();
        require(pools.length == domains.length, InvalidLength());
        require(pools.length == providers.length, InvalidLength());
        require(pools.length == poolSupportsAllTokens.length, InvalidLength());
        for (uint256 i = 0; i < pools.length; ++i) {
            address pool = pools[i];
            Domain domain = domains[i];
            Provider provider = providers[i];
            bool supportsAllTokens = poolSupportsAllTokens[i];
            require(pool != address(0), ZeroAddress());
            if (domain == DOMAIN) {
                require(provider == Provider.LOCAL, UnsupportedProvider());
                if (!supportsAllTokens) {
                    require(ILiquidityPool(pool).ASSETS() == ASSETS, InvalidPoolAssets());
                }
            } else {
                require(provider != Provider.LOCAL, UnsupportedProvider());
            }
            $.allowedRoutes[pool].setTo(_toIndex(domain, provider), isAllowed);
            if (isAllowed) {
                $.knownPools.add(pool);
            }
            $.poolSupportsAllTokens[pool] = supportsAllTokens;
            emit SetRoute(pool, domain, provider, supportsAllTokens, isAllowed);
        }
    }

    function getAllRoutes()
        external view returns (
            address[] memory pools,
            Domain[] memory domains,
            Provider[] memory providers,
            bool[] memory poolSupportsAllTokens
        ) 
    {
        RepayerStorage storage $ = _getStorage();
        uint256 totalPools = $.knownPools.length();
        uint256 totalDomains = uint256(type(Domain).max) + 1;
        uint256 totalProviders = uint256(type(Provider).max) + 1;
        uint256 totalRoutes = totalPools * totalDomains * totalProviders;
        pools = new address[](totalRoutes);
        domains = new Domain[](totalRoutes);
        providers = new Provider[](totalRoutes);
        poolSupportsAllTokens = new bool[](totalRoutes);
        uint256 resultLength = 0;
        for (uint256 p = 0; p < totalPools; ++p) {
            address pool = $.knownPools.at(p);
            for (uint256 d = 0; d < totalDomains; ++d) {
                for (uint256 pr = 0; pr < totalProviders; ++pr) {
                    if (isRouteAllowed(pool, Domain(d), Provider(pr))) {
                        pools[resultLength] = pool;
                        domains[resultLength] = Domain(d);
                        providers[resultLength] = Provider(pr);
                        poolSupportsAllTokens[resultLength] = $.poolSupportsAllTokens[pool];
                        ++resultLength;
                    }
                }
            }
        }
        assembly ("memory-safe") {
            mstore(pools, resultLength)
            mstore(domains, resultLength)
            mstore(providers, resultLength)
            mstore(poolSupportsAllTokens, resultLength)
        }
        return (pools, domains, providers, poolSupportsAllTokens);
    }

    function _toIndex(Domain domain, Provider provider) internal pure returns (uint256) {
        return (uint256(domain) << 8) + uint256(provider);
    }

    function isRouteAllowed(address pool, Domain domain, Provider provider) public view returns (bool) {
        return _getStorage().allowedRoutes[pool].get(_toIndex(domain, provider));
    }

    function _getStorage() private pure returns (RepayerStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
