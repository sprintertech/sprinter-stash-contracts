// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title StashDex — upgradeable DEX that routes swaps through Sprinter liquidity pools.
/// @notice Accepts tokenIn from the caller and delivers tokenOut borrowed from a configured
///         ILiquidityPool. The exchange rate is validated against an oracle with a per-route fee.
/// @notice Upgradeable.
/// @author Sprinter
contract StashDex is AccessControlUpgradeable {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    bytes32 public constant CONFIG_ROLE = "CONFIG_ROLE";
    bytes32 public constant PAUSER_ROLE = "PAUSER_ROLE";
    bytes32 public constant FORWARD_ROLE = "FORWARD_ROLE";

    uint256 private constant BPS = 10_000;

    IOracle immutable public ORACLE;
    address immutable public RECEIVER;

    struct RouteConfig {
        bool allowed;
        uint16 feeBps;
        address processor;
    }

    // pool (20 bytes) + totalBorrowed (12 bytes) = 32 bytes = one storage slot
    struct TokenConfig {
        ILiquidityPool pool;
        uint96 totalBorrowed;
    }

    struct PoolInit {
        address token;
        ILiquidityPool pool;
    }

    struct RouteInit {
        address tokenIn;
        address tokenOut;
        uint16 feeBps;
        address processor;
    }

    /// @custom:storage-location erc7201:sprinter.storage.StashDex
    struct StashDexStorage {
        mapping(address tokenIn => mapping(address tokenOut => RouteConfig)) routes;
        mapping(address token => TokenConfig) tokenConfig;
        bool paused;
    }

    bytes32 private constant STORAGE_LOCATION = 0xcf0fc60ec5775aeb9384817ddbc170789307c3e4b4fa0209ca63afb0f9c5ab00;

    error ZeroAddress();
    error SameToken();
    error RouteNotAllowed();
    error InsufficientOutput();
    error NothingToForward();
    error InvalidIndex();
    error InvalidFeeBps();
    error OutstandingDebt();
    error PoolNotConfigured();
    error EnforcedPause();
    error ExpectedPause();

    modifier whenNotPaused() {
        require(!_getStorage().paused, EnforcedPause());
        _;
    }

    event PoolSet(address indexed token, ILiquidityPool pool);
    event RouteSet(address indexed tokenIn, address indexed tokenOut, uint16 feeBps, address processor);
    event RouteDisabled(address tokenIn, address tokenOut);

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
        PoolInit[] calldata initialPools,
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
        for (uint256 i = 0; i < initialPools.length; i++) {
            _setPool(initialPools[i]);
        }
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

        uint256 precision = 10**12;
        uint256 valueIn = ORACLE.getAssetValue(_tokenToAssetId(tokenIn), amountIn * precision);
        uint256 valueOut = ORACLE.getAssetValue(_tokenToAssetId(tokenOut), amountOut * precision);
        require(valueIn * (BPS - route.feeBps) >= valueOut * BPS, InsufficientOutput());

        IERC20(tokenIn).safeTransferFrom(_msgSender(), route.processor, amountIn);

        TokenConfig storage tc = $.tokenConfig[tokenOut];
        require(address(tc.pool) != address(0), PoolNotConfigured());
        tc.pool.borrowDirect(tokenOut, amountOut);
        tc.totalBorrowed += amountOut.toUint96();
        IERC20(tokenOut).safeTransferFrom(address(tc.pool), recipient, amountOut);

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
    ) public {
        swap(_indexToAddress(indexIn), _indexToAddress(indexOut), amountIn, amountOut, recipient);
    }

    function exchange(
        uint256 indexIn,
        uint256 indexOut,
        uint256 amountIn,
        uint256 amountOut
    ) external {
        exchange(indexIn, indexOut, amountIn, amountOut, _msgSender());
    }

    /// @notice Repay the liquidity pool for token if debt is outstanding, using this contract's balance.
    function repay(address token) public whenNotPaused() {
        TokenConfig storage config = _getStorage().tokenConfig[token];
        uint256 debt = config.totalBorrowed;
        if (debt == 0) return;

        uint256 available = IERC20(token).balanceOf(address(this));
        uint256 repayAmount = Math.min(debt, available);
        if (repayAmount == 0) return;
        config.totalBorrowed = uint96(debt - repayAmount);

        address[] memory tokens = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        tokens[0] = token;
        amounts[0] = repayAmount;

        config.pool.repayDirect(tokens, amounts);
        emit Repaid(token, repayAmount);
    }

    /// @notice Repay the pool if configured, then transfer any remaining balance to RECEIVER.
    function forward(address token) external onlyRole(FORWARD_ROLE) whenNotPaused() {
        if (address(_getStorage().tokenConfig[token].pool) != address(0)) {
            repay(token);
        }
        uint256 amount = IERC20(token).balanceOf(address(this));
        require(amount > 0, NothingToForward());
        IERC20(token).safeTransfer(RECEIVER, amount);
        emit Forwarded(token, amount);
    }

    /// @notice Returns the available balance of token in its configured liquidity pool.
    function balance(IERC20 token) external view returns (uint256) {
        ILiquidityPool pool = _getStorage().tokenConfig[address(token)].pool;
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

    function setPool(address token, ILiquidityPool pool) external onlyRole(CONFIG_ROLE) {
        _setPool(PoolInit({token: token, pool: pool}));
    }

    function setRoute(RouteInit calldata route) external onlyRole(CONFIG_ROLE) {
        _setRoute(route);
    }

    function disableRoute(address tokenIn, address tokenOut) external onlyRole(CONFIG_ROLE) {
        StashDexStorage storage $ = _getStorage();
        require($.routes[tokenIn][tokenOut].allowed, RouteNotAllowed());
        $.routes[tokenIn][tokenOut].allowed = false;
        emit RouteDisabled(tokenIn, tokenOut);
    }

    function _setPool(PoolInit memory params) internal {
        require(params.token != address(0), ZeroAddress());
        require(address(params.pool) != address(0), ZeroAddress());
        TokenConfig storage config = _getStorage().tokenConfig[params.token];
        address currentPool = address(config.pool);
        if (currentPool != address(0) && currentPool != address(params.pool)) {
            require(config.totalBorrowed == 0, OutstandingDebt());
            IERC20(params.token).forceApprove(currentPool, 0);
        }
        config.pool = params.pool;
        IERC20(params.token).forceApprove(address(params.pool), type(uint256).max);
        emit PoolSet(params.token, params.pool);
    }

    function _setRoute(RouteInit memory route) internal {
        require(route.tokenIn != address(0), ZeroAddress());
        require(route.tokenOut != address(0), ZeroAddress());
        require(route.tokenIn != route.tokenOut, SameToken());
        require(route.processor != address(0), ZeroAddress());
        require(route.feeBps < BPS, InvalidFeeBps());
        _getStorage().routes[route.tokenIn][route.tokenOut] = RouteConfig({
            allowed: true, feeBps: route.feeBps, processor: route.processor
        });
        emit RouteSet(route.tokenIn, route.tokenOut, route.feeBps, route.processor);
    }

    // --- View helpers ---

    function getRoute(address tokenIn, address tokenOut) external view returns (RouteConfig memory) {
        return _getStorage().routes[tokenIn][tokenOut];
    }

    function getPool(address token) external view returns (ILiquidityPool) {
        return _getStorage().tokenConfig[token].pool;
    }

    function getTotalBorrowed(address token) external view returns (uint256) {
        return _getStorage().tokenConfig[token].totalBorrowed;
    }

    function _indexToAddress(uint256 index) internal pure returns (address) {
        require(index == uint256(uint160(index)), InvalidIndex());
        return address(uint160(index));
    }

    function _tokenToAssetId(address token) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(token)));
    }

    function _getStorage() internal pure returns (StashDexStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
