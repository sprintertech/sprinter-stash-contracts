// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Repayer} from "../Repayer.sol";
import {IRoute} from "../interfaces/IRoute.sol";
import {IOFT} from "../interfaces/IOFT.sol";
import {ILZEndpointDollar, SendParam, MessagingFee} from "../interfaces/ILayerZero.sol";

/// @notice Exercises a full Repayer USDT0 bridge-out flow, against already-deployed, real
/// contracts (the real USDT0 OFT, the real LZD fee token). Meant to be deployed via CreateX's
/// deployCreate3, then driven via run(), simulated with read-only eth_calls directly against
/// live Tempo mainnet (never actually broadcast), so it runs under Tempo's real execution
/// semantics rather than Hardhat's fork EVM, which cannot replicate Tempo's non-standard opcode
/// behavior (CALLVALUE and BALANCE always return 0 on Tempo).
///
/// Deployment (this constructor) only does setup that is not expected to fail: deploying a
/// fresh Repayer implementation + proxy and wiring the USDT0 route. All steps that could
/// actually fail (funding, wrapping the LZD fee, initiateRepay) live in run() instead, so that
/// if run() reverts, CreateX's deployCreate3AndInit forwards the real revert reason via
/// FailedContractInitialisation(address,bytes) rather than swallowing it behind its own
/// generic, reason-less FailedContractCreation(address) (which is what happens if a plain
/// deployCreate3's constructor itself reverts).
///
/// run() always reverts on completion so a static call can decode the outcome without any
/// state persisting:
///   - On success: reverts with SimulationSucceeded(...) carrying diagnostic values.
///   - On failure: bubbles up whatever error the failing step reverted with.
///
/// This contract is only ever deployed via CreateX's deployCreate3(AndInit), at a deterministic
/// address (independent of this file's bytecode) that must be pre-funded with USDT0 for run()
/// to succeed, since every call it makes has msg.sender == address(this) — an eth_call's `from`
/// override has no effect on calls made further down the stack.
contract RepayerUSDT0Tempo {
    using SafeERC20 for IERC20;

    error SimulationSucceeded(
        address repayer,
        address usdt0,
        address feeToken,
        uint256 bridgeAmount,
        uint256 nativeFeeUsed,
        uint32 dstEid,
        uint256 startingBalance,
        uint256 repayerUsdt0BalanceBeforeSend,
        uint256 repayerUsdt0BalanceAfterSend
    );

    error InsufficientStartingBalance(uint256 available, uint256 required);
    error BalanceNotReducedEnough(uint256 balanceBeforeSend, uint256 balanceAfterSend, uint256 bridgeAmount);

    uint32 public constant ARBITRUM_ONE_EID = 30110;

    // This exact address is pre-funded with real USDT0 on Tempo mainnet (see run()'s docs).
    // Deployment must always land here, via CreateX's deployCreate3 with deployer
    // 0xdBD91aD22bE5304e385b7b0A2Cfe91164e416e11 and salt id "TempoSimulation" — never deploy
    // this contract any other way, since a different address would have no funds to work with.
    address public constant EXPECTED_ADDRESS = 0xcE98A33AC0a054bCE4ed6715b780F59A2e6CC7f1;

    error UnexpectedAddress(address actual);

    Repayer public immutable REPAYER;
    IOFT public immutable USDT0_OFT;
    IERC20 public immutable USDT0;
    ILZEndpointDollar public immutable FEE_TOKEN;
    address public immutable DESTINATION_POOL;

    constructor(
        address usdt0OftAddress,
        address usdt0FeeNativeTokenAddress,
        address destinationPool
    ) {
        require(address(this) == EXPECTED_ADDRESS, UnexpectedAddress(address(this)));

        IOFT usdt0Oft = IOFT(usdt0OftAddress);
        IERC20 usdt0 = IERC20(usdt0Oft.token());
        ILZEndpointDollar feeToken = ILZEndpointDollar(usdt0FeeNativeTokenAddress);

        Repayer repayerImpl = new Repayer(
            IRoute.Domain.TEMPO,
            IERC20(address(0)), // usdc: unused on Tempo (no CCTP/Omnibridge there)
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
            usdt0FeeNativeTokenAddress,
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
                address(this), address(this), address(this),
                pools, domains, providers, onlySupportedTokens, inputOutputTokens
            )
        );
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(repayerImpl), address(this), initData
        );

        REPAYER = Repayer(payable(address(proxy)));
        USDT0_OFT = usdt0Oft;
        USDT0 = usdt0;
        FEE_TOKEN = feeToken;
        DESTINATION_POOL = destinationPool;
    }

    function run(uint256 bridgeAmount) external {
        Repayer repayer = REPAYER;
        IOFT usdt0Oft = USDT0_OFT;
        IERC20 usdt0 = USDT0;
        ILZEndpointDollar feeToken = FEE_TOKEN;
        address destinationPool = DESTINATION_POOL;

        uint256 startingBalance = usdt0.balanceOf(address(this));
        require(startingBalance >= bridgeAmount, InsufficientStartingBalance(startingBalance, bridgeAmount));

        // Fund the fresh Repayer with the USDT0 it will bridge out.
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

        // Wrap USDT0 into LZD 1:1 to pay the LayerZero fee, minted straight to this contract
        // (which holds REPAYER_ROLE and is the caller of initiateRepay below, so the fee token
        // must be pulled from here, not from the Repayer's own balance).
        usdt0.forceApprove(address(feeToken), fee.nativeFee);
        feeToken.wrap(address(usdt0), address(this), fee.nativeFee);
        IERC20(address(feeToken)).forceApprove(address(repayer), fee.nativeFee);

        bytes memory extraData = abi.encode(bridgeAmount, fee.nativeFee);
        uint256 repayerUsdt0BalanceBeforeSend = usdt0.balanceOf(address(repayer));
        repayer.initiateRepay(
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
            address(feeToken),
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
