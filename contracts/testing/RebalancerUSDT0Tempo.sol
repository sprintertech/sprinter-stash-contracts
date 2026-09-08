// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Rebalancer} from "../Rebalancer.sol";
import {TestLiquidityPool} from "./TestLiquidityPool.sol";
import {IRoute} from "../interfaces/IRoute.sol";
import {IOFT} from "../interfaces/IOFT.sol";
import {ILZEndpointDollar, SendParam, MessagingFee} from "../interfaces/ILayerZero.sol";

/// @notice Exercises a full Rebalancer USDT0 bridge-out flow, against already-deployed, real
/// contracts (the real USDT0 OFT, the real LZD fee token). Meant to be deployed via CreateX's
/// deployCreate3, then driven via run(), simulated with read-only eth_calls directly against
/// live Tempo mainnet (never actually broadcast). See RepayerUSDT0Tempo for the full rationale
/// (Tempo's non-standard opcode behavior, why run() is split from the constructor, why
/// deployCreate3AndInit is used, and why this contract must be pre-funded with USDT0).
///
/// This shares the same CreateX deployer/salt id ("TempoSimulation") as RepayerUSDT0Tempo, and
/// therefore the same pre-funded EXPECTED_ADDRESS — CREATE3 addresses depend only on
/// (deployer, salt), not on this file's bytecode, so whichever simulation contract is currently
/// the target of a deployCreate3(AndInit) call with that salt lands on the same funded address.
contract RebalancerUSDT0Tempo {
    using SafeERC20 for IERC20;

    error SimulationSucceeded(
        address rebalancer,
        address localPool,
        address usdt0,
        address feeToken,
        uint256 bridgeAmount,
        uint256 nativeFeeUsed,
        uint32 dstEid,
        uint256 startingBalance,
        uint256 localPoolBalanceAfterWithdraw,
        uint256 rebalancerUsdt0BalanceAfterSend
    );

    error InsufficientStartingBalance(uint256 available, uint256 required);
    error LocalPoolNotReducedEnough(uint256 balanceBeforeWithdraw, uint256 balanceAfterWithdraw, uint256 bridgeAmount);
    error RebalancerBalanceNotFullyForwarded(uint256 rebalancerUsdt0BalanceAfterSend);

    uint32 public constant ARBITRUM_ONE_EID = 30110;

    // Same deterministic, pre-funded address as RepayerUSDT0Tempo (see that contract's docs):
    // CreateX deployer 0xdBD91aD22bE5304e385b7b0A2Cfe91164e416e11, salt id "TempoSimulation".
    address public constant EXPECTED_ADDRESS = 0xcE98A33AC0a054bCE4ed6715b780F59A2e6CC7f1;

    error UnexpectedAddress(address actual);

    Rebalancer public immutable REBALANCER;
    TestLiquidityPool public immutable LOCAL_POOL;
    IOFT public immutable USDT0_OFT;
    IERC20 public immutable USDT0;
    ILZEndpointDollar public immutable FEE_TOKEN;
    address public immutable REMOTE_POOL;

    constructor(
        address usdt0OftAddress,
        address usdt0FeeNativeTokenAddress,
        address remotePool
    ) {
        require(address(this) == EXPECTED_ADDRESS, UnexpectedAddress(address(this)));

        IOFT usdt0Oft = IOFT(usdt0OftAddress);
        IERC20 usdt0 = IERC20(usdt0Oft.token());
        ILZEndpointDollar feeToken = ILZEndpointDollar(usdt0FeeNativeTokenAddress);

        Rebalancer rebalancerImpl = new Rebalancer(
            IRoute.Domain.TEMPO,
            usdt0, // assets
            IERC20(address(0)), // usdc: unused on Tempo (no CCTP/Omnibridge there)
            address(0), // omnibridge
            address(0), // gnosisUsdcxdai
            address(0), // gnosisUsdcTransmuter
            address(0), // ethereumAmb
            usdt0OftAddress,
            usdt0FeeNativeTokenAddress,
            address(0), // cctpV2TokenMessenger
            address(0) // cctpV2MessageTransmitter
        );

        // A fresh local pool acting as the LOCAL/source route for the rebalance, since no real
        // Sprinter Liquidity Pool is deployed on Tempo yet.
        TestLiquidityPool localPool = new TestLiquidityPool(usdt0, address(this), address(0));

        address[] memory pools = new address[](2);
        pools[0] = address(localPool);
        pools[1] = remotePool;
        IRoute.Domain[] memory domains = new IRoute.Domain[](2);
        domains[0] = IRoute.Domain.TEMPO;
        domains[1] = IRoute.Domain.ARBITRUM_ONE;
        IRoute.Provider[] memory providers = new IRoute.Provider[](2);
        providers[0] = IRoute.Provider.LOCAL;
        providers[1] = IRoute.Provider.USDT0;
        Rebalancer.ThisAddresses[] memory thisAddresses = new Rebalancer.ThisAddresses[](1);
        thisAddresses[0] = Rebalancer.ThisAddresses(IRoute.Domain.ARBITRUM_ONE, _addressToBytes32(address(this)));

        bytes memory initData = abi.encodeCall(
            rebalancerImpl.initialize,
            (address(this), address(this), pools, domains, providers, thisAddresses)
        );
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(rebalancerImpl), address(this), initData
        );
        Rebalancer rebalancer = Rebalancer(payable(address(proxy)));

        localPool.grantRole(localPool.LIQUIDITY_ADMIN_ROLE(), address(rebalancer));

        REBALANCER = rebalancer;
        LOCAL_POOL = localPool;
        USDT0_OFT = usdt0Oft;
        USDT0 = usdt0;
        FEE_TOKEN = feeToken;
        REMOTE_POOL = remotePool;
    }

    function run(uint256 bridgeAmount) external {
        Rebalancer rebalancer = REBALANCER;
        TestLiquidityPool localPool = LOCAL_POOL;
        IOFT usdt0Oft = USDT0_OFT;
        IERC20 usdt0 = USDT0;
        ILZEndpointDollar feeToken = FEE_TOKEN;
        address remotePool = REMOTE_POOL;

        uint256 startingBalance = usdt0.balanceOf(address(this));
        require(startingBalance >= bridgeAmount, InsufficientStartingBalance(startingBalance, bridgeAmount));

        // Fund the local pool with the USDT0 the Rebalancer will withdraw and bridge out.
        usdt0.safeTransfer(address(localPool), bridgeAmount);

        MessagingFee memory fee = usdt0Oft.quoteSend(
            SendParam({
                dstEid: ARBITRUM_ONE_EID,
                to: _addressToBytes32(address(rebalancer)),
                amountLD: bridgeAmount,
                minAmountLD: bridgeAmount,
                extraOptions: new bytes(0),
                composeMsg: new bytes(0),
                oftCmd: new bytes(0)
            }),
            false
        );

        // Wrap USDT0 into LZD 1:1 to pay the LayerZero fee, minted straight to this contract
        // (which holds REBALANCER_ROLE and is the caller of initiateRebalance below, so the fee
        // token must be pulled from here, not from the Rebalancer's own balance).
        usdt0.forceApprove(address(feeToken), fee.nativeFee);
        feeToken.wrap(address(usdt0), address(this), fee.nativeFee);
        IERC20(address(feeToken)).forceApprove(address(rebalancer), fee.nativeFee);

        bytes memory extraData = abi.encode(bridgeAmount, fee.nativeFee);
        uint256 localPoolBalanceBeforeWithdraw = usdt0.balanceOf(address(localPool));
        rebalancer.initiateRebalance(
            bridgeAmount,
            address(localPool),
            remotePool,
            IRoute.Domain.ARBITRUM_ONE,
            IRoute.Provider.USDT0,
            extraData
        );

        uint256 localPoolBalanceAfterWithdraw = usdt0.balanceOf(address(localPool));
        require(
            localPoolBalanceBeforeWithdraw - localPoolBalanceAfterWithdraw >= bridgeAmount,
            LocalPoolNotReducedEnough(localPoolBalanceBeforeWithdraw, localPoolBalanceAfterWithdraw, bridgeAmount)
        );
        uint256 rebalancerUsdt0BalanceAfterSend = usdt0.balanceOf(address(rebalancer));
        require(
            rebalancerUsdt0BalanceAfterSend == 0,
            RebalancerBalanceNotFullyForwarded(rebalancerUsdt0BalanceAfterSend)
        );

        revert SimulationSucceeded(
            address(rebalancer),
            address(localPool),
            address(usdt0),
            address(feeToken),
            bridgeAmount,
            fee.nativeFee,
            ARBITRUM_ONE_EID,
            startingBalance,
            localPoolBalanceAfterWithdraw,
            rebalancerUsdt0BalanceAfterSend
        );
    }

    function _addressToBytes32(address addr) private pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
