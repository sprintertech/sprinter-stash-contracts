// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlUpgradeable} from '@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol';
import {ERC7201Helper} from './utils/ERC7201Helper.sol';
import {ILiquidityPool} from './interfaces/ILiquidityPool.sol';
import {IRebalancer} from './interfaces/IRebalancer.sol';
import {ICCTPTokenMessenger, ICCTPMessageTransmitter} from './interfaces/ICCTP.sol';

contract Rebalancer is IRebalancer, AccessControlUpgradeable {
    ILiquidityPool immutable public LIQUIDITY_POOL;
    IERC20 immutable public COLLATERAL;
    ICCTPTokenMessenger immutable public CCTP_TOKEN_MESSENGER;
    ICCTPMessageTransmitter immutable public CCTP_MESSAGE_TRANSMITTER;
    bytes32 public constant REBALANCER_ROLE = "REBALANCER_ROLE";

    event InitiateRebalance(uint256 amount, Domain destinationDomain, Provider provider);
    event ProcessRebalance(Provider provider);
    event SetRoute(Domain destinationDomain, Provider provider, bool isAllowed);

    error ZeroAddress();
    error ZeroAmount();
    error RouteDenied();
    error ProcessFailed();
    error UnsupportedDomain();
    error InvalidLength();

    /// @custom:storage-location erc7201:sprinter.storage.Rebalancer
    struct RebalancerStorage {
        mapping(Domain => mapping(Provider => bool)) allowedRoutes;
    }

    bytes32 private constant StorageLocation = 0x81fbb040176d3bdbf3707b380997ee0038798f9e3ad0bae77fff3621ef225c00;

    constructor(
        address liquidityPool,
        address cctpTokenMessenger,
        address cctpMessageTransmitter
    ) {
        ERC7201Helper.validateStorageLocation(
            StorageLocation,
            'sprinter.storage.Rebalancer'
        );
        if (liquidityPool == address(0)) revert ZeroAddress();
        if (cctpTokenMessenger == address(0)) revert ZeroAddress();
        if (cctpMessageTransmitter == address(0)) revert ZeroAddress();
        LIQUIDITY_POOL = ILiquidityPool(liquidityPool);
        COLLATERAL = ILiquidityPool(liquidityPool).COLLATERAL();
        CCTP_TOKEN_MESSENGER = ICCTPTokenMessenger(cctpTokenMessenger);
        CCTP_MESSAGE_TRANSMITTER = ICCTPMessageTransmitter(cctpMessageTransmitter);

        _disableInitializers();
    }

    function initialize(
        address admin,
        address rebalancer,
        Domain[] memory domains,
        Provider[] memory providers
    ) external initializer() {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REBALANCER_ROLE, rebalancer);
        _setRoute(domains, providers, true);
    }

    function setRoute(
        Domain[] calldata domains,
        Provider[] calldata providers,
        bool isAllowed
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRoute(domains, providers, isAllowed);
    }

    function _setRoute(Domain[] memory domains, Provider[] memory providers, bool isAllowed) internal {
        RebalancerStorage storage $ = _getStorage();
        require(domains.length == providers.length, InvalidLength());
        for (uint256 i = 0; i < domains.length; ++i) {
            Domain domain = domains[i];
            Provider provider = providers[i];
            $.allowedRoutes[domain][provider] = isAllowed;
            emit SetRoute(domain, provider, isAllowed);
        }
    }

    function isRouteAllowed(Domain domain, Provider provider) public view returns (bool) {
        return _getStorage().allowedRoutes[domain][provider];
    }

    function initiateRebalance(
        uint256 amount,
        Domain destinationDomain,
        Provider provider,
        bytes calldata /*extraData*/
    ) external override onlyRole(REBALANCER_ROLE) {
        require(amount > 0, ZeroAmount());
        require(isRouteAllowed(destinationDomain, provider), RouteDenied());

        LIQUIDITY_POOL.withdraw(address(this), amount);
        if (provider == Provider.CCTP) {
            _initiateRebalanceCCTP(amount, destinationDomain);
        }
    }

    function processRebalance(
        Provider provider,
        bytes calldata extraData
    ) external override {
        if (provider == Provider.CCTP) {
            _processRebalanceCCTP(extraData);
        }
        LIQUIDITY_POOL.deposit();
    }

    function _initiateRebalanceCCTP(
        uint256 amount,
        Domain destinationDomain
    ) internal {
        SafeERC20.forceApprove(COLLATERAL, address(CCTP_TOKEN_MESSENGER), amount);
        CCTP_TOKEN_MESSENGER.depositForBurnWithCaller(
            amount,
            domainCCTP(destinationDomain),
            _addressToBytes32(address(LIQUIDITY_POOL)),
            address(COLLATERAL),
            _addressToBytes32(address(this))
        );
    }

    function _processRebalanceCCTP(
        bytes calldata extraData
    ) internal {
        (bytes memory message, bytes memory attestation) = abi.decode(extraData, (bytes, bytes));
        bool success = CCTP_MESSAGE_TRANSMITTER.receiveMessage(message, attestation);
        require(success, ProcessFailed());
    }

    function domainCCTP(Domain destinationDomain) public pure returns (uint32) {
        if (false) {
            // Intentional unreachable block for better code style.
            return type(uint32).max;
        } else if (destinationDomain == Domain.ETHEREUM) {
            return 0;
        } else if (destinationDomain == Domain.AVALANCHE) {
            return 1;
        } else if (destinationDomain == Domain.OP_CCHAIN) {
            return 2;
        } else if (destinationDomain == Domain.ARBITRUM_ONE) {
            return 3;
        } else if (destinationDomain == Domain.BASE) {
            return 6;
        } else if (destinationDomain == Domain.POLYGON_MAINNET) {
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
            $.slot := StorageLocation
        }
    }
}
