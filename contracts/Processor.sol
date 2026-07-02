// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {MulticallUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import {IRoyco} from "./interfaces/IRoyco.sol";
import {IERC7540} from "./interfaces/IERC7540.sol";
import {SubProcessor} from "./SubProcessor.sol";
import {ERC7201Helper} from "./utils/ERC7201Helper.sol";
import {IOracle} from "./interfaces/IOracle.sol";

/// @title Processor for unwinding vault tokens.
/// @author Sprinter
contract Processor is AccessControlUpgradeable, MulticallUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public immutable TARGET_ASSET;
    address public immutable RECEIVER;
    IOracle immutable public ORACLE;

    uint256 public constant MULTIPLIER = 100_00;

    bytes32 internal constant CALLER_ROLE = "CALLER_ROLE";
    bytes32 internal constant CONFIG_ROLE = "CONFIG_ROLE";

    /// @custom:storage-location erc7201:sprinter.storage.Processor
    struct ProcessorStorage {
        SubProcessor subProcessor;
        uint16 maxSlippage;
    }

    bytes32 private constant STORAGE_LOCATION = 0x315f94a0eb28ebc9ade3d51c8bd7ef4c2011752d9ac5c2acc448e4822cfa1f00;

    event Forwarded(address caller, IERC20 token, uint256 amount);
    event Processed(address caller, IERC20 tokenIn, uint256 amountIn, uint256 amountOut);
    event MaxSlippageSet(uint256 maxSlippage);
    event AdminProcessed(address caller);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidTokenIn();
    error SlippageTooHigh();
    error InsufficientAssets();
    error InvalidSlippage();
    error AlreadyInitialized();
    error DeadlineExceeded();

    constructor(address asset, address receiver, address oracle) {
        ERC7201Helper.validateStorageLocation(
            STORAGE_LOCATION,
            "sprinter.storage.Processor"
        );
        _disableInitializers();
        require(asset != address(0), ZeroAddress());
        require(receiver != address(0), ZeroAddress());
        TARGET_ASSET = IERC20(asset);
        RECEIVER = receiver;
        ORACLE = IOracle(oracle);
    }

    function initialize(
        address admin,
        address caller,
        address config
    ) public initializer {
        require(admin != address(0), ZeroAddress());
        require(config != address(0), ZeroAddress());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CALLER_ROLE, caller);
        _grantRole(CONFIG_ROLE, config);

        initializeSubProcessor();
    }

    function initializeSubProcessor() public {
        ProcessorStorage storage $ = _getStorage();
        require(address($.subProcessor) == address(0), AlreadyInitialized());
        $.subProcessor = new SubProcessor(address(TARGET_ASSET));
        _setMaxSlippage($, 3_00);
    }

    function subProcessor() external view returns (address) {
        return address(_getStorage().subProcessor);
    }

    function maxSlippage() external view returns (uint256) {
        return _getStorage().maxSlippage;
    }

    function setMaxSlippage(uint256 newMaxSlippage) external onlyRole(CONFIG_ROLE) {
        _setMaxSlippage(_getStorage(), newMaxSlippage);
    }

    function forward(IERC20 token) external {
        forwardAmount(token, token.balanceOf(address(this)));
    }

    function forwardAmount(IERC20 token, uint256 amount) public onlyRole(CALLER_ROLE) {
        _finalizeTransfer(token, amount);
        emit Forwarded(msg.sender, token, amount);
    }

    function redeem7540(IERC7540 token) external onlyRole(CALLER_ROLE) {
        uint256 balance = token.balanceOf(address(this));
        token.requestRedeem(balance, address(this), address(this));
    }

    function claim7540(IERC7540 token) external {
        withdraw4626(token);
    }

    function redeem4626(IERC4626 token) external onlyRole(CALLER_ROLE) {
        uint256 balance = token.maxRedeem(address(this));
        token.redeem(balance, address(this), address(this));
    }

    function withdraw4626(IERC4626 token) public onlyRole(CALLER_ROLE) {
        uint256 balance = token.maxWithdraw(address(this));
        token.withdraw(balance, address(this), address(this));
    }

    function claimRoyco(IRoyco token, uint256[] calldata epochIDs) external onlyRole(CALLER_ROLE) {
        token.claimWithdrawal(epochIDs);
    }

    function cancelRoyco(IRoyco token, uint256 epochID) external onlyRole(CALLER_ROLE) {
        token.cancelRequest(epochID);
    }

    function process4626(
        IERC4626 tokenIn,
        uint256 sharesIn,
        uint256 amountOutMin,
        SubProcessor.Call[] calldata calls
    ) external onlyRole(CALLER_ROLE) {
        ProcessorStorage storage $ = _getStorage();
        uint256 redeemResult = tokenIn.convertToAssets(sharesIn);
        _assertOutputAmount($, redeemResult, amountOutMin);
        _process($, tokenIn, sharesIn, amountOutMin, calls);
    }
    
    /// @notice Signature is not used at the moment, but might be useful in the future.
    function process(
        IERC20 tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline,
        bytes calldata signature,
        SubProcessor.Call[] calldata calls
    ) external onlyRole(CALLER_ROLE) {
        require(block.timestamp <= deadline, DeadlineExceeded());
        ProcessorStorage storage $ = _getStorage();
        _processSignature(tokenIn, amountIn, amountOutMin, deadline, signature);
        _process($, tokenIn, amountIn, amountOutMin, calls);
    }

    function _process(
        ProcessorStorage storage $,
        IERC20 tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        SubProcessor.Call[] calldata calls
    ) internal {
        require(amountIn > 0, ZeroAmount());
        require(tokenIn != TARGET_ASSET, InvalidTokenIn());
        tokenIn.safeTransfer(address($.subProcessor), amountIn);
        uint256 assets = TARGET_ASSET.balanceOf(address(this));
        $.subProcessor.process(calls);
        uint256 assetsAfter = TARGET_ASSET.balanceOf(address(this));
        require(assetsAfter >= assets, InsufficientAssets());
        uint256 amountOut = assetsAfter - assets;
        require(amountOut >= amountOutMin, InsufficientAssets());
        _finalizeTransfer(TARGET_ASSET, amountOut);
        emit Processed(msg.sender, tokenIn, amountIn, amountOut);
    }

    function _finalizeTransfer(IERC20 token, uint256 amount) internal virtual {
        token.safeTransfer(RECEIVER, amount);
    }

    /// @notice Currently consults oracle instead of checking the signature.
    function _processSignature(
        IERC20 tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256,
        bytes calldata
    ) internal view {
        ProcessorStorage storage $ = _getStorage();
        uint256 valueIn = ORACLE.getAssetValue(_tokenToAssetId(tokenIn), amountIn);
        uint256 valueOut = ORACLE.getAssetValue(_tokenToAssetId(TARGET_ASSET), amountOutMin);
        _assertOutputAmount($, valueIn, valueOut);
    }

    function adminProcess(SubProcessor.Call[] calldata calls) external onlyRole(CONFIG_ROLE) {
        _getStorage().subProcessor.process(calls);

        emit AdminProcessed(msg.sender);
    }

    function _setMaxSlippage(ProcessorStorage storage $, uint256 newMaxSlippage) internal {
        require(newMaxSlippage < MULTIPLIER, InvalidSlippage());
        $.maxSlippage = uint16(newMaxSlippage);
        emit MaxSlippageSet(newMaxSlippage);
    }

    function _tokenToAssetId(address token) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(token)));
    }

    function _tokenToAssetId(IERC20 token) internal pure returns (bytes32) {
        return _tokenToAssetId(address(token));
    }

    function _assertOutputAmount(ProcessorStorage storage $, uint256 valueIn, uint256 valueOut) internal view {
        require(valueIn * (MULTIPLIER - uint256($.maxSlippage)) <= valueOut * MULTIPLIER, SlippageTooHigh());
    }

    function _getStorage() private pure returns (ProcessorStorage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }
}
