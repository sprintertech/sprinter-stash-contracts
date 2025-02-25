// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {IRebalancer} from "./interfaces/IRebalancer.sol";
import {ICCTPTokenMessenger, ICCTPMessageTransmitter} from "./interfaces/ICCTP.sol";

contract Rebalancer is IRebalancer, AccessControlUpgradeable {
    using SafeERC20 for IERC20;
    using BitMaps for BitMaps.BitMap;
    using EnumerableSet for EnumerableSet.AddressSet;

    Domain immutable public DOMAIN;
    IERC20 immutable public ASSETS;
    ICCTPTokenMessenger immutable public CCTP_TOKEN_MESSENGER;
    ICCTPMessageTransmitter immutable public CCTP_MESSAGE_TRANSMITTER;
    bytes32 constant public REBALANCER_ROLE = "REBALANCER_ROLE";

    event InitiateRebalance(
        uint256 amount,
        address sourcePool,
        address destinationPool,
        Domain destinationDomain,
        Provider provider
    );
    event ProcessRebalance(uint256 amount, address destinationPool, Provider provider);
    event SetRoute(address destinationPool, Domain destinationDomain, Provider provider, bool isAllowed);

    error ZeroAddress();
    error ZeroAmount();
    error RouteDenied();
    error InvalidRoute();
    error ProcessFailed();
    error UnsupportedDomain();
    error UnsupportedProvider();
    error InvalidLength();
    error InvalidPoolAssets();

    /// @custom:storage-location erc7201:sprinter.storage.Rebalancer
    struct RebalancerStorage {
        mapping(address pool => BitMaps.BitMap) allowedRoutes;
        EnumerableSet.AddressSet knownPools;
    }

    bytes32 private constant STORAGE_LOCATION = 0x81fbb040176d3bdbf3707b380997ee0038798f9e3ad0bae77fff3621ef225c00;

    constructor(
        Domain localDomain,
        IERC20 assets,
        address cctpTokenMessenger,
        address cctpMessageTransmitter
    ) {
        ERC7201Helper.validateStorageLocation(
            STORAGE_LOCATION,
            "sprinter.storage.Rebalancer"
        );
        require(address(assets) != address(0), ZeroAddress());
        require(cctpTokenMessenger != address(0), ZeroAddress());
        require(cctpMessageTransmitter != address(0), ZeroAddress());
        DOMAIN = localDomain;
        ASSETS = assets;
        CCTP_TOKEN_MESSENGER = ICCTPTokenMessenger(cctpTokenMessenger);
        CCTP_MESSAGE_TRANSMITTER = ICCTPMessageTransmitter(cctpMessageTransmitter);

        _disableInitializers();
    }

    function initialize(
        address admin,
        address rebalancer,
        address[] memory pools,
        Domain[] memory domains,
        Provider[] memory providers
    ) external initializer() {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REBALANCER_ROLE, rebalancer);
        _setRoute(pools, domains, providers, true);
    }

    function setRoute(
        address[] calldata pools,
        Domain[] calldata domains,
        Provider[] calldata providers,
        bool isAllowed
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRoute(pools, domains, providers, isAllowed);
    }

    function _setRoute(
        address[] memory pools,
        Domain[] memory domains,
        Provider[] memory providers,
        bool isAllowed
    ) internal {
        RebalancerStorage storage $ = _getStorage();
        require(pools.length == domains.length, InvalidLength());
        require(pools.length == providers.length, InvalidLength());
        for (uint256 i = 0; i < pools.length; ++i) {
            address pool = pools[i];
            Domain domain = domains[i];
            Provider provider = providers[i];
            require(pool != address(0), ZeroAddress());
            if (domain == DOMAIN) {
                require(provider == Provider.LOCAL, UnsupportedProvider());
                require(ILiquidityPool(pool).ASSETS() == ASSETS, InvalidPoolAssets());
            } else {
                require(provider != Provider.LOCAL, UnsupportedProvider());
            }
            $.allowedRoutes[pool].setTo(_toIndex(domain, provider), isAllowed);
            if (isAllowed) {
                $.knownPools.add(pool);
            }
            emit SetRoute(pool, domain, provider, isAllowed);
        }
    }

    function getAllRoutes()
    external view returns (address[] memory pools, Domain[] memory domains, Provider[] memory providers) {
        RebalancerStorage storage $ = _getStorage();
        uint256 totalPools = $.knownPools.length();
        uint256 totalDomains = uint256(type(Domain).max) + 1;
        uint256 totalProviders = uint256(type(Provider).max) + 1;
        uint256 totalRoutes = totalPools * totalDomains * totalProviders;
        pools = new address[](totalRoutes);
        domains = new Domain[](totalRoutes);
        providers = new Provider[](totalRoutes);
        uint256 resultLength = 0;
        for (uint256 p = 0; p < totalPools; ++p) {
            address pool = $.knownPools.at(p);
            for (uint256 d = 0; d < totalDomains; ++d) {
                for (uint256 pr = 0; pr < totalProviders; ++pr) {
                    if (isRouteAllowed(pool, Domain(d), Provider(pr))) {
                        pools[resultLength] = pool;
                        domains[resultLength] = Domain(d);
                        providers[resultLength] = Provider(pr);
                        ++resultLength;
                    }
                }
            }
        }
        assembly ("memory-safe") {
            mstore(pools, resultLength)
            mstore(domains, resultLength)
            mstore(providers, resultLength)
        }
        return (pools, domains, providers);
    }

    function _toIndex(Domain domain, Provider provider) internal pure returns (uint256) {
        return (uint256(domain) << 8) + uint256(provider);
    }

    function isRouteAllowed(address pool, Domain domain, Provider provider) public view returns (bool) {
        return _getStorage().allowedRoutes[pool].get(_toIndex(domain, provider));
    }

    function initiateRebalance(
        uint256 amount,
        address sourcePool,
        address destinationPool,
        Domain destinationDomain,
        Provider provider,
        bytes calldata /*extraData*/
    ) external override onlyRole(REBALANCER_ROLE) {
        require(amount > 0, ZeroAmount());
        require(isRouteAllowed(sourcePool, DOMAIN, Provider.LOCAL), RouteDenied());
        require(isRouteAllowed(destinationPool, destinationDomain, provider), RouteDenied());

        emit InitiateRebalance(amount, sourcePool, destinationPool, destinationDomain, provider);
        ILiquidityPool(sourcePool).withdraw(address(this), amount);

        if (provider == Provider.LOCAL) {
            // This should always pass because isRouteAllowed check will fail earlier.
            // It is put here for explicitness.
            require(destinationDomain == DOMAIN, UnsupportedDomain());
            require(sourcePool != destinationPool, InvalidRoute());
            // For local we proceed to the process right away.
            _processRebalanceLOCAL(amount, destinationPool);
        } else
        if (provider == Provider.CCTP) {
            _initiateRebalanceCCTP(amount, destinationPool, destinationDomain);
        } else {
            // Unreachable atm, but could become so when more providers are added to enum.
            revert UnsupportedProvider();
        }
    }

    function processRebalance(
        address destinationPool,
        Provider provider,
        bytes calldata extraData
    ) external override onlyRole(REBALANCER_ROLE) {
        require(isRouteAllowed(destinationPool, DOMAIN, Provider.LOCAL), RouteDenied());
        uint256 depositAmount = 0;
        if (provider == Provider.CCTP) {
            depositAmount = _processRebalanceCCTP(destinationPool, extraData);
        } else {
            // Unreachable atm, but could become so when more providers are added to enum.
            revert UnsupportedProvider();
        }

        emit ProcessRebalance(depositAmount, destinationPool, provider);
    }

    function _initiateRebalanceCCTP(
        uint256 amount,
        address destinationPool,
        Domain destinationDomain
    ) internal {
        ASSETS.forceApprove(address(CCTP_TOKEN_MESSENGER), amount);
        CCTP_TOKEN_MESSENGER.depositForBurnWithCaller(
            amount,
            domainCCTP(destinationDomain),
            _addressToBytes32(address(destinationPool)),
            address(ASSETS),
            _addressToBytes32(address(this))
        );
    }

    function _processRebalanceLOCAL(
        uint256 amount,
        address destinationPool
    ) internal {
        ASSETS.safeTransfer(destinationPool, amount);
        ILiquidityPool(destinationPool).deposit(amount);

        emit ProcessRebalance(amount, destinationPool, Provider.LOCAL);
    }

    function _processRebalanceCCTP(
        address destinationPool,
        bytes calldata extraData
    ) internal returns (uint256) {
        uint256 balanceBefore = ASSETS.balanceOf(address(destinationPool));

        (bytes memory message, bytes memory attestation) = abi.decode(extraData, (bytes, bytes));
        bool success = CCTP_MESSAGE_TRANSMITTER.receiveMessage(message, attestation);
        require(success, ProcessFailed());

        uint256 balanceAfter = ASSETS.balanceOf(address(destinationPool));
        require(balanceAfter > balanceBefore, ProcessFailed());
        uint256 depositAmount = balanceAfter - balanceBefore;
        ILiquidityPool(destinationPool).deposit(depositAmount);
        return depositAmount;
    }

    function domainCCTP(Domain destinationDomain) public pure virtual returns (uint32) {
        if (destinationDomain == Domain.ETHEREUM) {
            return 0;
        } else
        if (destinationDomain == Domain.AVALANCHE) {
            return 1;
        } else
        if (destinationDomain == Domain.OP_MAINNET) {
            return 2;
        } else
        if (destinationDomain == Domain.ARBITRUM_ONE) {
            return 3;
        } else
        if (destinationDomain == Domain.BASE) {
            return 6;
        } else
        if (destinationDomain == Domain.POLYGON_MAINNET) {
            return 7;
        } else {
            revert UnsupportedDomain();
        }
    }

    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    function _getStorage() private pure returns (RebalancerStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
