// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Repayer} from "../Repayer.sol";
import {IRoute} from "../interfaces/IRoute.sol";
import {IOFT} from "../interfaces/IOFT.sol";
import {SendParam, MessagingFee} from "../interfaces/ILayerZero.sol";

/// @notice Exercises a full Repayer USDT0 bridge-out flow, against already-deployed, real
/// contracts (the real USDT0 OFT). Meant to be deployed via CreateX's deployCreate3, then driven
/// via run(), simulated with read-only eth_calls directly against live Stable mainnet (never
/// actually broadcast). See RepayerUSDT0Tempo for the full rationale (why run() is split from
/// the constructor, why deployCreate3AndInit is used, and why this contract must be pre-funded).
///
/// Unlike Tempo, Stable's USDT is dual-role: the same underlying balance is exposed both as an
/// 18-decimal native currency (address.balance) and a 6-decimal ERC20 (USDT.balanceOf) — moving
/// one moves the other. USDT0OFT.nativeToken() reverts there (unsupported) and
/// approvalRequired() is false, so LayerZero fees are paid via plain msg.value, with no separate
/// fee-token wrap step required (contrast with RepayerUSDT0Tempo's LZD wrap).
///
/// Shares its CreateX deployer with the Tempo simulations, but uses its own salt id
/// ("StableSimulation") and therefore its own EXPECTED_ADDRESS/pre-funded balance, since Stable
/// is an entirely separate chain.
contract RepayerUSDT0Stable {
    using SafeERC20 for IERC20;

    error SimulationSucceeded(
        address repayer,
        address usdt0,
        uint256 bridgeAmount,
        uint256 nativeFeeUsed,
        uint32 dstEid,
        uint256 startingBalance,
        uint256 repayerUsdt0BalanceBeforeSend,
        uint256 repayerUsdt0BalanceAfterSend
    );

    error InsufficientStartingBalance(uint256 available, uint256 required);
    error InsufficientNativeFeeBalance(uint256 available, uint256 required);
    error BalanceNotReducedEnough(uint256 balanceBeforeSend, uint256 balanceAfterSend, uint256 bridgeAmount);
    error UnexpectedAddress(address actual);

    uint32 public constant ARBITRUM_ONE_EID = 30110;

    // CreateX deployer 0xdBD91aD22bE5304e385b7b0A2Cfe91164e416e11, salt id "StableSimulation".
    address public constant EXPECTED_ADDRESS = 0x1d98C9492F01aC4eEeaF13683dA561e4EC2b51E3;

    Repayer public immutable REPAYER;
    IOFT public immutable USDT0_OFT;
    IERC20 public immutable USDT0;
    address public immutable DESTINATION_POOL;

    constructor(address usdt0OftAddress, address destinationPool) {
        require(address(this) == EXPECTED_ADDRESS, UnexpectedAddress(address(this)));

        IOFT usdt0Oft = IOFT(usdt0OftAddress);
        IERC20 usdt0 = IERC20(usdt0Oft.token());

        Repayer repayerImpl = new Repayer(
            IRoute.Domain.STABLE,
            IERC20(address(0)), // usdc: unused on Stable (no CCTP there)
            address(0), // acrossSpokePool
            address(0), // wrappedNativeToken
            address(0), // stargateTreasurer
            address(0), // optimismBridge
            address(0), // baseBridge
            address(0), // arbitrumGatewayRouter
            address(0), // omnibridge
            address(0), // gnosisUsdcxdai
            address(0), // gnosisUsdceSwap
            address(0), // ethereumAmb
            usdt0OftAddress,
            address(0), // usdt0FeeNativeToken: Stable pays LayerZero fees via msg.value, not an ERC20 fee token
            address(0), // cctpV2TokenMessenger
            address(0) // cctpV2MessageTransmitter
        );

        address[] memory pools = new address[](1);
        pools[0] = destinationPool;
        IRoute.Domain[] memory domains = new IRoute.Domain[](1);
        domains[0] = IRoute.Domain.ARBITRUM_ONE;
        IRoute.Provider[] memory providers = new IRoute.Provider[](1);
        providers[0] = IRoute.Provider.USDT0;
        IERC20[] memory onlySupportedTokens = new IERC20[](1);
        onlySupportedTokens[0] = IERC20(address(0));
        Repayer.InputOutputToken[] memory inputOutputTokens = new Repayer.InputOutputToken[](0);

        bytes memory initData = abi.encodeCall(
            repayerImpl.initialize,
            (
                address(this),
                address(this),
                address(this),
                pools,
                domains,
                providers,
                onlySupportedTokens,
                inputOutputTokens
            )
        );
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(repayerImpl), address(this), initData
        );

        REPAYER = Repayer(payable(address(proxy)));
        USDT0_OFT = usdt0Oft;
        USDT0 = usdt0;
        DESTINATION_POOL = destinationPool;
    }

    function run(uint256 bridgeAmount) external {
        Repayer repayer = REPAYER;
        IOFT usdt0Oft = USDT0_OFT;
        IERC20 usdt0 = USDT0;
        address destinationPool = DESTINATION_POOL;

        uint256 startingBalance = usdt0.balanceOf(address(this));
        require(startingBalance >= bridgeAmount, InsufficientStartingBalance(startingBalance, bridgeAmount));

        usdt0.safeTransfer(address(repayer), bridgeAmount);

        MessagingFee memory fee = usdt0Oft.quoteSend(
            SendParam({
                dstEid: ARBITRUM_ONE_EID,
                to: _addressToBytes32(destinationPool),
                amountLD: bridgeAmount,
                minAmountLD: bridgeAmount,
                extraOptions: new bytes(0),
                composeMsg: new bytes(0),
                oftCmd: new bytes(0)
            }),
            false
        );
        require(
            address(this).balance >= fee.nativeFee,
            InsufficientNativeFeeBalance(address(this).balance, fee.nativeFee)
        );

        bytes memory extraData = abi.encode(bridgeAmount);
        uint256 repayerUsdt0BalanceBeforeSend = usdt0.balanceOf(address(repayer));
        repayer.initiateRepay{value: fee.nativeFee}(
            usdt0,
            bridgeAmount,
            destinationPool,
            IRoute.Domain.ARBITRUM_ONE,
            IRoute.Provider.USDT0,
            extraData
        );

        uint256 repayerUsdt0BalanceAfterSend = usdt0.balanceOf(address(repayer));
        require(
            repayerUsdt0BalanceBeforeSend - repayerUsdt0BalanceAfterSend >= bridgeAmount,
            BalanceNotReducedEnough(repayerUsdt0BalanceBeforeSend, repayerUsdt0BalanceAfterSend, bridgeAmount)
        );

        revert SimulationSucceeded(
            address(repayer),
            address(usdt0),
            bridgeAmount,
            fee.nativeFee,
            ARBITRUM_ONE_EID,
            startingBalance,
            repayerUsdt0BalanceBeforeSend,
            repayerUsdt0BalanceAfterSend
        );
    }

    function _addressToBytes32(address addr) private pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
