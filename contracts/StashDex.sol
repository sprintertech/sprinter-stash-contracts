// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";

/// @title StashDex — upgradeable DEX that routes swaps through Sprinter liquidity pools.
/// @notice Accepts tokenIn from the caller and delivers tokenOut borrowed from a configured
///         ILiquidityPool. The exchange rate is validated against an oracle with a per-route fee.
/// @notice Upgradeable.
/// @author Sprinter
contract StashDex is AccessControlUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant CONFIG_ROLE = "CONFIG_ROLE";
    bytes32 public constant PAUSER_ROLE = "PAUSER_ROLE";
    bytes32 public constant FORWARD_ROLE = "FORWARD_ROLE";

    uint256 private constant BPS = 10_000;

    IOracle immutable public ORACLE;
    address immutable public RECEIVER;

    struct RouteConfig {
        bool allowed;
        uint16 feeBps;
        address destination;
    }

    struct RouteInit {
        address tokenIn;
        address tokenOut;
        uint16 feeBps;
        address destination;
        ILiquidityPool pool;
    }

    /// @custom:storage-location erc7201:sprinter.storage.StashDex
    struct StashDexStorage {
        mapping(address tokenIn => mapping(address tokenOut => RouteConfig)) routes;
        mapping(address token => ILiquidityPool) pool;
        bool paused;
    }

    bytes32 private constant STORAGE_LOCATION = 0xcf0fc60ec5775aeb9384817ddbc170789307c3e4b4fa0209ca63afb0f9c5ab00;

    error ZeroAddress();
    error RouteNotAllowed();
    error InsufficientOutput();
    error NothingToForward();
    error InvalidIndex();
    error InvalidFeeBps();
    error EnforcedPause();
    error ExpectedPause();

    modifier whenNotPaused() {
        require(!_getStorage().paused, EnforcedPause());
        _;
    }

    event RouteSet(
        address indexed tokenIn,
        address indexed tokenOut,
        uint16 feeBps,
        address destination,
        ILiquidityPool pool
    );
    event RouteDisabled(address indexed tokenIn, address indexed tokenOut);

    event Swapped(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );
    event Repaid(address token, uint256 amount);
    event Forwarded(address token, uint256 amount);
    event Paused(address account);
    event Unpaused(address account);

    constructor(address oracle, address receiver) {
        ERC7201Helper.validateStorageLocation(STORAGE_LOCATION, "sprinter.storage.StashDex");
        require(oracle != address(0), ZeroAddress());
        require(receiver != address(0), ZeroAddress());
        ORACLE = IOracle(oracle);
        RECEIVER = receiver;
        _disableInitializers();
    }

    function initialize(
        address admin,
        address configAdmin,
        address pauser,
        address forwarder,
        RouteInit[] calldata initialRoutes
    ) external initializer {
        __AccessControl_init();
        require(admin != address(0), ZeroAddress());
        require(configAdmin != address(0), ZeroAddress());
        require(pauser != address(0), ZeroAddress());
        require(forwarder != address(0), ZeroAddress());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, configAdmin);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(FORWARD_ROLE, forwarder);
        for (uint256 i = 0; i < initialRoutes.length; i++) {
            _setRoute(initialRoutes[i]);
        }
    }

    /// @notice Swap tokenIn for tokenOut. The route must be configured and the rate (after fee)
    ///         must cover the requested amountOut per oracle pricing.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    ) public whenNotPaused() {
        StashDexStorage storage $ = _getStorage();
        RouteConfig memory route = $.routes[tokenIn][tokenOut];
        require(route.allowed, RouteNotAllowed());

        uint256 valueIn = ORACLE.getAssetValue(bytes32(uint256(uint160(tokenIn))), amountIn);
        uint256 valueOut = ORACLE.getAssetValue(bytes32(uint256(uint160(tokenOut))), amountOut);
        require(valueIn * (BPS - route.feeBps) >= valueOut * BPS, InsufficientOutput());

        IERC20(tokenIn).safeTransferFrom(_msgSender(), route.destination, amountIn);

        ILiquidityPool pool = $.pool[tokenOut];
        pool.borrowDirect(tokenOut, amountOut);
        IERC20(tokenOut).safeTransferFrom(address(pool), recipient, amountOut);

        emit Swapped(tokenIn, tokenOut, amountIn, amountOut, recipient);
    }

    /// @notice Convenience wrapper that accepts token addresses encoded as uint256 indices.
    /// @dev Meant to support UniversalRouter Curve Swap command.
    function exchange(
        uint256 indexIn,
        uint256 indexOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    ) external {
        require(indexIn == uint256(uint160(indexIn)) && indexOut == uint256(uint160(indexOut)), InvalidIndex());
        swap(address(uint160(indexIn)), address(uint160(indexOut)), amountIn, amountOut, recipient);
    }

    /// @notice Repay the liquidity pool for token if debt is outstanding, using this contract's balance.
    function repay(address token) public whenNotPaused() {
        StashDexStorage storage $ = _getStorage();
        ILiquidityPool pool = $.pool[token];
        if (pool.directDebt(token) == 0) return;
        uint256 amount = IERC20(token).balanceOf(address(this));
        address[] memory tokens = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        tokens[0] = token;
        amounts[0] = amount;
        IERC20(token).forceApprove(address(pool), amount);
        pool.repayDirect(tokens, amounts);
        emit Repaid(token, amount);
    }

    /// @notice Repay the pool if configured, then transfer any remaining balance to RECEIVER.
    function forward(address token) external onlyRole(FORWARD_ROLE) whenNotPaused() {
        ILiquidityPool pool = _getStorage().pool[token];
        if (address(pool) != address(0)) {
            repay(token);
        }
        uint256 amount = IERC20(token).balanceOf(address(this));
        require(amount > 0, NothingToForward());
        IERC20(token).safeTransfer(RECEIVER, amount);
        emit Forwarded(token, amount);
    }

    /// @notice Returns the available balance of token in its configured liquidity pool.
    function balance(IERC20 token) external view returns (uint256) {
        ILiquidityPool pool = _getStorage().pool[address(token)];
        if (address(pool) == address(0)) return 0;
        return pool.balance(token);
    }

    // --- PAUSER_ROLE functions ---

    function pause() external onlyRole(PAUSER_ROLE) {
        require(!_getStorage().paused, EnforcedPause());
        _getStorage().paused = true;
        emit Paused(_msgSender());
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        require(_getStorage().paused, ExpectedPause());
        _getStorage().paused = false;
        emit Unpaused(_msgSender());
    }

    function paused() external view returns (bool) {
        return _getStorage().paused;
    }

    // --- CONFIG_ROLE functions ---

    function setRoute(RouteInit calldata route) external onlyRole(CONFIG_ROLE) {
        _setRoute(route);
    }

    function disableRoute(address tokenIn, address tokenOut) external onlyRole(CONFIG_ROLE) {
        _getStorage().routes[tokenIn][tokenOut].allowed = false;
        emit RouteDisabled(tokenIn, tokenOut);
    }

    function _setRoute(RouteInit memory route) internal {
        require(route.tokenIn != address(0), ZeroAddress());
        require(route.tokenOut != address(0), ZeroAddress());
        require(route.destination != address(0), ZeroAddress());
        require(address(route.pool) != address(0), ZeroAddress());
        require(route.feeBps < BPS, InvalidFeeBps());
        StashDexStorage storage $ = _getStorage();
        $.routes[route.tokenIn][route.tokenOut] = RouteConfig({allowed: true, feeBps: route.feeBps, destination: route.destination});
        $.pool[route.tokenOut] = route.pool;
        emit RouteSet(route.tokenIn, route.tokenOut, route.feeBps, route.destination, route.pool);
    }

    // --- View helpers ---

    function getRoute(address tokenIn, address tokenOut) external view returns (RouteConfig memory) {
        return _getStorage().routes[tokenIn][tokenOut];
    }

    function getPool(address token) external view returns (ILiquidityPool) {
        return _getStorage().pool[token];
    }

    function _getStorage() internal pure returns (StashDexStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
