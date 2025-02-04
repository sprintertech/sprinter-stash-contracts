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
import {IRebalancer} from './interfaces/IRebalancer.sol';

contract Rebalancer is IRebalancer, AccessControlUpgradeable {
    using Math for uint256;

    ILiquidityPool immutable public LIQUIDITY_POOL;
    IERC20 immutable public COLLATERAL;
    bytes32 public constant REBALANCER_ROLE = "REBALANCER_ROLE";
    bytes32 internal constant CCTP = "CCTP";
    bytes32 internal constant ETHEREUM = "ETHEREUM";
    bytes32 internal constant AVALANCHE = "AVALANCHE";
    bytes32 internal constant OP_CCHAIN = "OP_CCHAIN";
    bytes32 internal constant ARBITRUM_ONE = "ARBITRUM_ONE";
    bytes32 internal constant BASE = "BASE";
    bytes32 internal constant POLYGON_MAINNET = "POLYGON_MAINNET";

    event TotalAssetsAdjustment(uint256 oldAssets, uint256 newAssets);
    event AssetsLimitSet(uint256 oldLimit, uint256 newLimit);

    error ZeroAddress();
    error UnsupportedDomain();
    error UnsupportedProvider();
    error RouteDenied();

    /// @custom:storage-location erc7201:sprinter.storage.Rebalancer
    struct RebalancerStorage {
        mapping(bytes32 destination => mapping(bytes32 provider => bool)) allowedRoutes;
    }

    bytes32 private constant StorageLocation = 0xf131773; // FIXME

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
        if (cctpTokenTransmitter == address(0)) revert ZeroAddress();
        LIQUIDITY_POOL = ILiquidityPool(liquidityPool);
        COLLATERAL = ILiquidityPool(liquidityPool).COLLATERAL();
        CCTP_TOKEN_MESSENGER = ICCTPTokenMessenger(cctpTokenMessenger);
        CCTP_MESSAGE_TRANSMITTER = ICCTPMessageTransmitter(cctpMessageTransmitter);

        _disableInitializers();
    }

    function initialize(
        IERC20 asset_,
        address admin,
        address rebalancer,
        uint256 newAssetsLimit
    ) external initializer() {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REBALANCER_ROLE, rebalancer);
    }

    function initiateRebalance(
        uint256 amount,
        bytes32 destinationDomain, 
        bytes32 provider, 
        bytes calldata extraData
    ) external onlyRole(REBALANCER_ROLE) {
        require(amount > 0, ZeroAmount());
        require(isRouteAllowed(destinationDomain, provider), RouteDenied());

        LIQUIDITY_POOL.withdraw(address(this), amount);
        if (provider == CCTP) {
            _initiateRebalanceCCTP(amount, destinationDomain, extraData);
        } else {
            revert UnsupportedProvider();
        }
    }

    function processRebalance(
        bytes32 provider,
        bytes calldata extraData
    ) external /*onlyRole(PROCESSOR_ROLE)*/ {
        if (provider == CCTP) {
            _processRebalanceCCTP(extraData);
        } else {
            revert UnsupportedProvider();
        }
        LIQUIDITY_POOL.deposit();
    }

    function _initiateRebalanceCCTP(
        uint256 amount,
        bytes32 destinationDomain, 
        bytes calldata extraData
    ) internal {
        SafeERC20.forceApprove(COLLATERAL, address(CCTP_TOKEN_MESSENGER), amount);
        CCTP_TOKEN_MESSENGER.depositForBurnWithCaller(
            amount,
            domainCCTP(destinationDomain),
            _addressToBytes32(LIQUIDITY_POOL),
            address(COLLATERAL),
            address(this)
        );
    }

    function _processRebalanceCCTP(
        bytes calldata extraData
    ) internal {
        (bytes calldata message, bytes calldata attestation) = abi.decode(extraData, (bytes, bytes));
        CCTP_MESSAGE_TRANSMITTER.receiveMessage(message, attestation);
    }

    function domainCCTP(bytes32 destinationDomain) public pure returns (uint32) {
        if (false) {
            // Intentional empty block for better code style.
        } else if (destinationDomain == ETHEREUM) {
            return 0;
        } else if (destinationDomain == AVALANCHE) {
            return 1;
        } else if (destinationDomain == OP_CCHAIN) {
            return 2;
        } else if (destinationDomain == ARBITRUM_ONE) {
            return 3;
        } else if (destinationDomain == BASE) {
            return 6;
        } else if (destinationDomain == POLYGON_MAINNET) {
            return 7;
        } else {
            revert UnsupportedDomain();
        }
    }

    function _addressToBytes32(IERC20 addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(address(addr))));
    }

    function _getStorage() private pure returns (RebalancerStorage storage $) {
        assembly {
            $.slot := StorageLocation
        }
    }
}
