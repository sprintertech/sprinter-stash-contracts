// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Rebalancer} from "../Rebalancer.sol";
import {TestLiquidityPool} from "./TestLiquidityPool.sol";
import {IRoute} from "../interfaces/IRoute.sol";
import {IOFT} from "../interfaces/IOFT.sol";
import {SendParam, MessagingFee} from "../interfaces/ILayerZero.sol";

/// @notice Exercises a full Rebalancer USDT0 bridge-out flow, against already-deployed, real
/// contracts (the real USDT0 OFT). Meant to be deployed via CreateX's deployCreate3, then driven
/// via run(), simulated with read-only eth_calls directly against live Stable mainnet (never
/// actually broadcast). See RepayerUSDT0Stable and RepayerUSDT0Tempo for the full rationale (why
/// run() is split from the constructor, why deployCreate3AndInit is used, why this contract must
/// be pre-funded, and why Stable needs no separate fee-token wrap step unlike Tempo).
///
/// Shares the same CreateX deployer/salt id ("StableSimulation") as RepayerUSDT0Stable, and
/// therefore the same pre-funded EXPECTED_ADDRESS — CREATE3 addresses depend only on
/// (deployer, salt), not on this file's bytecode, so whichever simulation contract is currently
/// the target of a deployCreate3(AndInit) call with that salt lands on the same funded address.
contract RebalancerUSDT0Stable {
    using SafeERC20 for IERC20;

    error SimulationSucceeded(
        address rebalancer,
        address localPool,
        address usdt0,
        uint256 bridgeAmount,
        uint256 nativeFeeUsed,
        uint32 dstEid,
        uint256 startingBalance,
        uint256 localPoolBalanceAfterWithdraw,
        uint256 rebalancerUsdt0BalanceAfterSend
    );

    error InsufficientStartingBalance(uint256 available, uint256 required);
    error InsufficientNativeFeeBalance(uint256 available, uint256 required);
    error LocalPoolNotReducedEnough(uint256 balanceBeforeWithdraw, uint256 balanceAfterWithdraw, uint256 bridgeAmount);
    error RebalancerBalanceNotFullyForwarded(uint256 rebalancerUsdt0BalanceAfterSend);
    error UnexpectedAddress(address actual);

    uint32 public constant ARBITRUM_ONE_EID = 30110;

    // Same deterministic, pre-funded address as RepayerUSDT0Stable (see that contract's docs):
    // CreateX deployer 0xdBD91aD22bE5304e385b7b0A2Cfe91164e416e11, salt id "StableSimulation".
    address public constant EXPECTED_ADDRESS = 0x1d98C9492F01aC4eEeaF13683dA561e4EC2b51E3;

    Rebalancer public immutable REBALANCER;
    TestLiquidityPool public immutable LOCAL_POOL;
    IOFT public immutable USDT0_OFT;
    IERC20 public immutable USDT0;
    address public immutable REMOTE_POOL;

    constructor(
        address usdt0OftAddress,
        address remotePool
    ) {
        require(address(this) == EXPECTED_ADDRESS, UnexpectedAddress(address(this)));

        IOFT usdt0Oft = IOFT(usdt0OftAddress);
        IERC20 usdt0 = IERC20(usdt0Oft.token());

        Rebalancer rebalancerImpl = new Rebalancer(
            IRoute.Domain.STABLE,
            usdt0, // assets
            IERC20(address(0)), // usdc: unused on Stable (no CCTP there)
            address(0), // omnibridge
            address(0), // gnosisUsdcxdai
            address(0), // gnosisUsdcTransmuter
            address(0), // ethereumAmb
            usdt0OftAddress,
            address(0), // usdt0FeeNativeToken: Stable pays LayerZero fees via msg.value, not an ERC20 fee token
            address(0), // cctpV2TokenMessenger
            address(0) // cctpV2MessageTransmitter
        );

        // A fresh local pool acting as the LOCAL/source route for the rebalance, since this
        // simulation deploys its own Rebalancer rather than pointing at a real Sprinter pool.
        TestLiquidityPool localPool = new TestLiquidityPool(usdt0, address(this), address(0));

        address[] memory pools = new address[](2);
        pools[0] = address(localPool);
        pools[1] = remotePool;
        IRoute.Domain[] memory domains = new IRoute.Domain[](2);
        domains[0] = IRoute.Domain.STABLE;
        domains[1] = IRoute.Domain.ARBITRUM_ONE;
        IRoute.Provider[] memory providers = new IRoute.Provider[](2);
        providers[0] = IRoute.Provider.LOCAL;
        providers[1] = IRoute.Provider.USDT0;

        bytes memory initData = abi.encodeCall(
            rebalancerImpl.initialize,
            (address(this), address(this), pools, domains, providers)
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
        REMOTE_POOL = remotePool;
    }

    function run(uint256 bridgeAmount) external {
        Rebalancer rebalancer = REBALANCER;
        TestLiquidityPool localPool = LOCAL_POOL;
        IOFT usdt0Oft = USDT0_OFT;
        IERC20 usdt0 = USDT0;
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
        require(
            address(this).balance >= fee.nativeFee,
            InsufficientNativeFeeBalance(address(this).balance, fee.nativeFee)
        );

        bytes memory extraData = abi.encode(bridgeAmount);
        uint256 localPoolBalanceBeforeWithdraw = usdt0.balanceOf(address(localPool));
        rebalancer.initiateRebalance{value: fee.nativeFee}(
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
