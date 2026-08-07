// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPolygonRootChainManager, IPolygonChildERC20} from ".././interfaces/IPolygonPosBridge.sol";
import {AdapterHelper, InputOutputTokenData} from "./AdapterHelper.sol";

/// @notice Bridges tokens between Ethereum and Polygon over the Polygon PoS bridge.
/// Ethereum -> Polygon takes minutes, Polygon -> Ethereum takes 30 minutes to 3 hours,
/// because the burn has to be checkpointed before it can be exited.
/// @notice The child contract has to be deployed to the same address on Ethereum and Polygon,
/// otherwise processTransferPolygonPosBridge() won't work, as the PoS predicate always releases
/// the exited tokens to the address that burned the child token on Polygon.
abstract contract PolygonPosBridgeAdapter is AdapterHelper {
    using SafeERC20 for IERC20;

    /// @notice Polygon PoS RootChainManager on Ethereum. Zero on every other chain.
    IPolygonRootChainManager immutable public POLYGON_POS_ROOT_CHAIN_MANAGER;

    event PolygonPosDepositInitiated(address indexed token, address indexed receiver, uint256 amount);
    event PolygonPosWithdrawInitiated(address indexed token, uint256 amount);

    constructor(
        address polygonPosRootChainManager
    ) {
        // No check for address(0) to allow deployment on chains where Polygon PoS Bridge is not available
        POLYGON_POS_ROOT_CHAIN_MANAGER = IPolygonRootChainManager(polygonPosRootChainManager);
    }

    /// @notice Bridges ERC20 tokens between Ethereum and Polygon via the PoS bridge.
    /// Supports both directions:
    ///   - Ethereum -> Polygon: depositFor on the RootChainManager, funds arrive at destinationPool.
    ///   - Polygon -> Ethereum: withdraw on the child token, funds arrive at this contract on
    ///     Ethereum once processTransferPolygonPosBridge() proves the burn.
    /// @param extraData ABI-encoded (address outputToken), the token expected on the destination domain.
    function initiateTransferPolygonPosBridge(
        IERC20 token,
        uint256 amount,
        address destinationPool,
        Domain destinationDomain,
        bytes calldata extraData,
        Domain localDomain,
        mapping(bytes32 outputToken => InputOutputTokenData) storage outputTokens
    ) internal notPayable {
        address outputToken = abi.decode(extraData, (address));
        _validateOutputToken(outputToken, destinationDomain, outputTokens);
        if (localDomain == Domain.ETHEREUM) {
            require(destinationDomain == Domain.POLYGON_MAINNET, UnsupportedDomain());
            IPolygonRootChainManager manager = POLYGON_POS_ROOT_CHAIN_MANAGER;
            require(address(manager) != address(0), ZeroAddress());
            // The bridge mints a fixed child token per root token, check that it is the expected one.
            require(manager.rootToChildToken(address(token)) == outputToken, InvalidOutputToken());
            // Deposits are pulled by the predicate registered for the token type, not by the manager.
            address predicate = manager.typeToPredicate(manager.tokenToType(address(token)));
            require(predicate != address(0), ZeroAddress());
            token.forceApprove(predicate, amount);
            manager.depositFor(destinationPool, address(token), abi.encode(amount));
            emit PolygonPosDepositInitiated(address(token), destinationPool, amount);
        } else
        if (localDomain == Domain.POLYGON_MAINNET) {
            require(destinationDomain == Domain.ETHEREUM, UnsupportedDomain());
            // The exit releases the tokens to whoever burned them on Polygon, so they have to
            // come back to this contract and be forwarded by process().
            require(destinationPool == address(this), InvalidDestinationPool());
            IPolygonChildERC20(address(token)).withdraw(amount);
            emit PolygonPosWithdrawInitiated(address(token), amount);
        } else {
            revert UnsupportedDomain();
        }
    }

    /// @notice Finalises a Polygon -> Ethereum transfer by proving the burn to the RootChainManager.
    /// Must be called on Ethereum after the burn has been checkpointed.
    /// @param extraData ABI-encoded (IERC20 token, bytes burnProof).
    ///   token     - the Ethereum token expected to arrive at this contract.
    ///   burnProof - the RLP encoded proof of the burn transaction on Polygon.
    /// @return token  The token that was received.
    /// @return amount The amount of tokens received by this contract.
    function processTransferPolygonPosBridge(
        bytes calldata extraData
    ) internal returns (IERC20 token, uint256 amount) {
        IPolygonRootChainManager manager = POLYGON_POS_ROOT_CHAIN_MANAGER;
        require(address(manager) != address(0), ZeroAddress());

        bytes memory burnProof;
        (token, burnProof) = abi.decode(extraData, (IERC20, bytes));

        uint256 balanceBefore = token.balanceOf(address(this));
        manager.exit(burnProof);
        uint256 balanceAfter = token.balanceOf(address(this));

        require(balanceAfter > balanceBefore, ProcessFailed());
        unchecked {
            return (token, balanceAfter - balanceBefore);
        }
    }
}
