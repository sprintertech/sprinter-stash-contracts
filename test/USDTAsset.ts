import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {AbiCoder, MaxUint256} from "ethers";
import {
  getCreateAddress, getDeployXAddressBase, getContractAt, deploy, deployX, toBytes32,
  signBorrow, setupTests,
} from "./helpers";
import {
  ProviderSolidity as Provider, DomainSolidity as Domain, ZERO_ADDRESS,
} from "../scripts/common";
import {
  TestUSDC, TestUSDT, TestUSDT0, TestUSDT0OFTNative, TestUSDT0OFTFeeNativeToken,
  TestLiquidityPool, LiquidityPool, LiquidityHub, SprinterUSDTLPShare,
  TransparentUpgradeableProxy, ProxyAdmin, Rebalancer, Repayer,
  MockTarget, MockSignerTrue,
} from "../typechain-types";
import {prodNetworkConfig as networkConfig} from "../network.config";

// Validates that pools, the Hub, Rebalancer, and Repayer all work with a non-USDC main asset.
// TestUSDT deliberately replicates real USDT's non-standard ERC20 behavior (no bool return on
// transfer/transferFrom/approve, and a reverting approve-race-condition guard) so these tests
// exercise the same SafeERC20/forceApprove code paths production traffic will hit.
describe("USDT as a main pool asset", function () {
  setupTests();

  describe("LiquidityPool with USDT as ASSETS", function () {
    const deployAll = async () => {
      const [deployer, admin, user, mpc_signer, liquidityAdmin] = await hre.ethers.getSigners();

      const usdt = (await deploy("TestUSDT", deployer, {})) as TestUSDT;
      const mockTarget = (await deploy("MockTarget", deployer, {})) as MockTarget;
      const mockSignerTrue = (await deploy("MockSignerTrue", deployer, {})) as MockSignerTrue;

      const liquidityPoolImpl = (
        await deploy("LiquidityPool", deployer, {}, usdt, networkConfig.BASE.WrappedNativeToken)
      ) as LiquidityPool;
      const liquidityPoolInit = (await liquidityPoolImpl.initialize.populateTransaction(
        admin, mpc_signer, mockSignerTrue
      )).data;
      const liquidityPoolProxy = (await deploy(
        "TransparentUpgradeableProxy", deployer, {}, liquidityPoolImpl, admin, liquidityPoolInit
      )) as TransparentUpgradeableProxy;
      const liquidityPool = (await getContractAt("LiquidityPool", liquidityPoolProxy, deployer)) as LiquidityPool;

      const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
      await liquidityPool.connect(admin).grantRole(LIQUIDITY_ADMIN_ROLE, liquidityAdmin);

      const USDT_DEC = 10n ** (await usdt.decimals());

      return {deployer, admin, user, mpc_signer, liquidityAdmin, usdt, USDT_DEC, liquidityPool, mockTarget};
    };

    it("Should deposit, borrow via contract call, and withdraw with USDT as ASSETS", async function () {
      const {
        liquidityPool, usdt, USDT_DEC, liquidityAdmin, mockTarget, user, mpc_signer, deployer,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDT_DEC;
      await usdt.connect(deployer).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
      expect(await liquidityPool.totalDeposited()).to.equal(amountLiquidity);
      expect(await liquidityPool.balance(usdt)).to.equal(amountLiquidity);

      const amountToBorrow = 3n * USDT_DEC;
      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(usdt, amountToBorrow, additionalData);
      const signature = await signBorrow(
        mpc_signer, liquidityPool, user, usdt, amountToBorrow, mockTarget, callData.data,
      );
      const borrowTx = liquidityPool.connect(user).borrow(
        usdt, amountToBorrow, mockTarget, callData.data, 0n, 2000000000n, signature
      );
      await expect(borrowTx).to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdt.balanceOf(liquidityPool)).to.equal(amountLiquidity - amountToBorrow);
      expect(await usdt.balanceOf(mockTarget)).to.equal(amountToBorrow);
      expect(await liquidityPool.totalDeposited()).to.equal(amountLiquidity);

      const remaining = amountLiquidity - amountToBorrow;
      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, remaining))
        .to.emit(liquidityPool, "Withdraw").withArgs(liquidityAdmin, user.address, remaining);
      expect(await usdt.balanceOf(user)).to.equal(remaining);
      expect(await usdt.balanceOf(liquidityPool)).to.equal(0n);
      // withdraw() reduces totalDeposited by the withdrawn amount, leaving the borrowed amount.
      expect(await liquidityPool.totalDeposited()).to.equal(amountToBorrow);
    });

    it("Should deposit with pulling funds (depositWithPull) despite USDT's non-standard approve", async function () {
      const {liquidityPool, usdt, USDT_DEC, deployer} = await loadFixture(deployAll);
      const amount = 500n * USDT_DEC;
      await usdt.connect(deployer).approve(liquidityPool, amount);
      await expect(liquidityPool.connect(deployer).depositWithPull(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(deployer, amount);
      expect(await liquidityPool.totalDeposited()).to.equal(amount);
      expect(await liquidityPool.balance(usdt)).to.equal(amount);
    });

    it("Should replicate real USDT's approve race-condition guard", async function () {
      const {usdt, deployer, user} = await loadFixture(deployAll);
      await usdt.connect(deployer).approve(user, 100n);
      await expect(usdt.connect(deployer).approve(user, 200n))
        .to.be.revertedWithCustomError(usdt, "ApproveRaceCondition");
      await usdt.connect(deployer).approve(user, 0n);
      await usdt.connect(deployer).approve(user, 200n);
      expect(await usdt.allowance(deployer, user)).to.equal(200n);
    });
  });

  describe("LiquidityHub with USDT as the underlying asset", function () {
    const deployAll = async () => {
      const [deployer, admin, user] = await hre.ethers.getSigners();
      const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

      const usdt = (await deploy("TestUSDT", deployer, {})) as TestUSDT;
      const liquidityPool = (await deployX(
        "TestLiquidityPool", deployer, "TestLiquidityPoolUSDT", {},
        usdt, deployer, networkConfig.BASE.WrappedNativeToken
      )) as TestLiquidityPool;

      const USDT = 10n ** (await usdt.decimals());

      const liquidityHubAddress = await getDeployXAddressBase(
        deployer, "TransparentUpgradeableProxyLiquidityHubUSDT", false
      );
      const lpToken = (
        await deployX("SprinterUSDTLPShare", deployer, "SprinterLPShareUSDT", {}, liquidityHubAddress)
      ) as SprinterUSDTLPShare;
      const LP = 10n ** (await lpToken.decimals());

      const liquidityHubImpl = (
        await deployX("LiquidityHub", deployer, "LiquidityHubUSDT", {}, lpToken, liquidityPool)
      ) as LiquidityHub;
      const liquidityHubInit = (await liquidityHubImpl.initialize.populateTransaction(
        usdt, admin, admin, admin, admin, MaxUint256 * USDT / LP
      )).data;
      const liquidityHubProxy = (await deployX(
        "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyLiquidityHubUSDT", {},
        liquidityHubImpl, admin, liquidityHubInit
      )) as TransparentUpgradeableProxy;
      const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress, deployer)) as LiquidityHub;
      const liquidityHubProxyAdminAddress = await getCreateAddress(liquidityHubProxy, 1);
      const liquidityHubAdmin = (
        await getContractAt("ProxyAdmin", liquidityHubProxyAdminAddress, admin)
      ) as ProxyAdmin;

      await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, liquidityHub);

      return {
        deployer, admin, user, usdt, lpToken, liquidityHub, liquidityHubAdmin, liquidityPool, USDT, LP,
      };
    };

    it("Should deposit and withdraw through the Hub with USDT as the underlying asset", async function () {
      const {lpToken, liquidityHub, usdt, deployer, user, USDT, LP, liquidityPool} = await loadFixture(deployAll);

      expect(await liquidityHub.asset()).to.equal(usdt.target);

      await usdt.connect(deployer).transfer(user, 10n * USDT);
      await usdt.connect(user).approve(liquidityHub, 10n * USDT);
      const depositTx = liquidityHub.connect(user).deposit(10n * USDT, user);
      await expect(depositTx)
        .to.emit(lpToken, "Transfer")
        .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
      await expect(depositTx)
        .to.emit(usdt, "Transfer")
        .withArgs(user.address, liquidityPool.target, 10n * USDT);
      expect(await liquidityHub.totalAssets()).to.equal(10n * USDT);
      expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
      expect(await usdt.balanceOf(liquidityPool)).to.equal(10n * USDT);
      expect(await usdt.balanceOf(user)).to.equal(0n);

      const withdrawTx = liquidityHub.connect(user).withdraw(10n * USDT, user, user);
      await expect(withdrawTx)
        .to.emit(lpToken, "Transfer")
        .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
      await expect(withdrawTx)
        .to.emit(usdt, "Transfer")
        .withArgs(liquidityPool.target, user.address, 10n * USDT);
      expect(await liquidityHub.totalAssets()).to.equal(0n);
      expect(await liquidityHub.balanceOf(user)).to.equal(0n);
      expect(await usdt.balanceOf(user)).to.equal(10n * USDT);
      expect(await usdt.balanceOf(liquidityPool)).to.equal(0n);
    });
  });

  describe("Rebalancer with USDT0-bridged USDT as ASSETS", function () {
    const deployAll = async () => {
      const [deployer, admin, rebalanceUser] = await hre.ethers.getSigners();
      const REBALANCER_ROLE = toBytes32("REBALANCER_ROLE");
      const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

      // TestUSDT0 (not TestUSDT) is used as ASSETS here because USDT0Adapter requires the
      // bridged token to exactly match the OFT's own token() — this section validates the new
      // Rebalancer+USDT0Adapter wiring, not the ERC20-quirk handling (already covered above).
      // The native (burn-based) OFT variant is used since DOMAIN below is not Domain.ETHEREUM
      // (USDT0Adapter only grants an approval for the pull-based adapter on Domain.ETHEREUM).
      const testUsdt0 = (await deploy("TestUSDT0", deployer, {})) as TestUSDT0;
      const usdt0OftAdapter = (
        await deploy("TestUSDT0OFTNative", deployer, {}, testUsdt0)
      ) as TestUSDT0OFTNative;

      const pool1 = (await deploy(
        "TestLiquidityPool", deployer, {}, testUsdt0, deployer, networkConfig.BASE.WrappedNativeToken
      )) as TestLiquidityPool;
      const pool2 = (await deploy(
        "TestLiquidityPool", deployer, {}, testUsdt0, deployer, networkConfig.BASE.WrappedNativeToken
      )) as TestLiquidityPool;

      const USDT0_DEC = 10n ** (await testUsdt0.decimals());

      const rebalancerImpl = (
        await deployX("Rebalancer", deployer, "RebalancerUSDT0", {},
          Domain.BASE, testUsdt0, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
          usdt0OftAdapter, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        )
      ) as Rebalancer;
      const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
        admin, rebalanceUser,
        [pool1, pool2, pool2],
        [Domain.BASE, Domain.BASE, Domain.ARBITRUM_ONE],
        [Provider.LOCAL, Provider.LOCAL, Provider.USDT0],
      )).data;
      const rebalancerProxy = (await deployX(
        "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancerUSDT0", {},
        rebalancerImpl, admin, rebalancerInit
      )) as TransparentUpgradeableProxy;
      const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;

      await pool1.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
      await pool2.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);

      return {
        deployer, admin, rebalanceUser, testUsdt0, USDT0_DEC, usdt0OftAdapter,
        pool1, pool2, rebalancer, REBALANCER_ROLE,
      };
    };

    it("Should rebalance locally between two USDT pools", async function () {
      const {rebalancer, testUsdt0, USDT0_DEC, rebalanceUser, pool1, pool2} = await loadFixture(deployAll);
      await testUsdt0.mint(pool1, 10n * USDT0_DEC);

      const tx = rebalancer.connect(rebalanceUser).initiateRebalance(
        4n * USDT0_DEC, pool1, pool2, Domain.BASE, Provider.LOCAL, "0x"
      );
      await expect(tx)
        .to.emit(rebalancer, "InitiateRebalance")
        .withArgs(4n * USDT0_DEC, pool1.target, pool2.target, Domain.BASE, Provider.LOCAL);
      await expect(tx).to.emit(pool2, "Deposit");
      expect(await testUsdt0.balanceOf(pool1)).to.equal(6n * USDT0_DEC);
      expect(await testUsdt0.balanceOf(pool2)).to.equal(4n * USDT0_DEC);
      expect(await testUsdt0.balanceOf(rebalancer)).to.equal(0n);
    });

    it("Should rebalance cross-chain via USDT0: initiateRebalance(USDT0) then processRebalance(LOCAL)",
    async function () {
      const {
        rebalancer, testUsdt0, USDT0_DEC, rebalanceUser, pool1, pool2, usdt0OftAdapter,
      } = await loadFixture(deployAll);
      await testUsdt0.mint(pool1, 10n * USDT0_DEC);
      const amount = 4n * USDT0_DEC;
      const fee = await usdt0OftAdapter.NATIVE_FEE();

      const extraData = AbiCoder.defaultAbiCoder().encode(["uint256"], [amount]);
      const initTx = rebalancer.connect(rebalanceUser).initiateRebalance(
        amount, pool1, pool2, Domain.ARBITRUM_ONE, Provider.USDT0, extraData, {value: fee}
      );
      await expect(initTx)
        .to.emit(rebalancer, "InitiateRebalance")
        .withArgs(amount, pool1.target, pool2.target, Domain.ARBITRUM_ONE, Provider.USDT0);
      await expect(initTx)
        .to.emit(rebalancer, "USDT0Transfer");
      expect(await testUsdt0.balanceOf(pool1)).to.equal(6n * USDT0_DEC);
      expect(await testUsdt0.balanceOf(rebalancer)).to.equal(0n);
      // The native (non-Ethereum) OFT variant burns the bridged amount rather than holding it.
      expect(await testUsdt0.totalSupply()).to.equal(6n * USDT0_DEC);

      // Simulates LayerZero delivering the bridged USDT0 to the Rebalancer on the destination chain
      // (delivery is push-based via LayerZero's own network, with no on-chain "process" step to relay).
      await testUsdt0.mint(rebalancer, amount);
      const processTx = rebalancer.connect(rebalanceUser).processRebalance(pool2, Provider.LOCAL, "0x");
      await expect(processTx)
        .to.emit(rebalancer, "ProcessRebalance")
        .withArgs(amount, pool2.target, Provider.LOCAL);
      await expect(processTx).to.emit(pool2, "Deposit");
      expect(await testUsdt0.balanceOf(rebalancer)).to.equal(0n);
      expect(await testUsdt0.balanceOf(pool2)).to.equal(amount);
    });

    it("Should revert USDT0 rebalance with an ERC20 fee token if native currency is sent along",
    async function () {
      const {deployer, admin, rebalanceUser} = await loadFixture(deployAll);
      const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

      const testUsdt0 = (await deploy("TestUSDT0", deployer, {})) as TestUSDT0;
      const feeToken = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
      const testOFT = (
        await deploy("TestUSDT0OFTFeeNativeToken", deployer, {}, testUsdt0, feeToken)
      ) as TestUSDT0OFTFeeNativeToken;

      const USDT0_DEC = 10n ** (await testUsdt0.decimals());
      const feeTokenFee = await testOFT.FEE_NATIVE_TOKEN_FEE();

      const localPool = (await deploy(
        "TestLiquidityPool", deployer, {}, testUsdt0, deployer, networkConfig.BASE.WrappedNativeToken
      )) as TestLiquidityPool;
      const remotePool = "0x000000000000000000000000000000000000dEaD";

      const rebalancerImpl = (
        await deployX("Rebalancer", deployer, "RebalancerUSDT0FeeNativeTokenNotPayable", {},
          Domain.BASE, testUsdt0, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
          testOFT, feeToken, ZERO_ADDRESS, ZERO_ADDRESS,
        )
      ) as Rebalancer;
      const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
        admin, rebalanceUser,
        [localPool, remotePool],
        [Domain.BASE, Domain.ARBITRUM_ONE],
        [Provider.LOCAL, Provider.USDT0],
      )).data;
      const rebalancerProxy = (await deployX(
        "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancerUSDT0FeeNativeTokenNotPayable",
        {}, rebalancerImpl, admin, rebalancerInit
      )) as TransparentUpgradeableProxy;
      const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
      await localPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);

      const amount = 4n * USDT0_DEC;
      await testUsdt0.mint(localPool, 10n * USDT0_DEC);

      const feeAmount = 2n * feeTokenFee;
      await feeToken.mint(rebalanceUser, feeAmount);
      await feeToken.connect(rebalanceUser).approve(rebalancer, feeAmount);

      const extraData = AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [amount, feeAmount]);
      await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
        amount, localPool, remotePool, Domain.ARBITRUM_ONE, Provider.USDT0, extraData, {value: 1n}
      )).to.be.revertedWithCustomError(rebalancer, "NotPayable()");
    });
  });

  describe("Repayer routing mixed USDC-only, USDT-only, and unrestricted pools", function () {
    const deployAll = async () => {
      const [deployer, admin, repayUser, setTokensUser] = await hre.ethers.getSigners();

      const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
      const usdt = (await deploy("TestUSDT", deployer, {})) as TestUSDT;

      const poolUSDC = (await deploy(
        "TestLiquidityPool", deployer, {}, usdc, deployer, networkConfig.BASE.WrappedNativeToken
      )) as TestLiquidityPool;
      const poolUSDT = (await deploy(
        "TestLiquidityPool", deployer, {}, usdt, deployer, networkConfig.BASE.WrappedNativeToken
      )) as TestLiquidityPool;
      const poolAny = (await deploy(
        "TestLiquidityPool", deployer, {}, usdc, deployer, networkConfig.BASE.WrappedNativeToken
      )) as TestLiquidityPool;

      const cctpV2TokenMessenger = await deploy("TestCCTPV2TokenMessenger", deployer, {});
      const cctpV2MessageTransmitter = await deploy("TestCCTPV2MessageTransmitter", deployer, {});

      const repayerImpl = (
        await deployX("Repayer", deployer, "RepayerMixedAssets", {},
          Domain.BASE,
          usdc,
          ZERO_ADDRESS, networkConfig.BASE.WrappedNativeToken, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
          ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
          cctpV2TokenMessenger, cctpV2MessageTransmitter,
          ZERO_ADDRESS,
        )
      ) as Repayer;
      const repayerInit = (await repayerImpl.initialize.populateTransaction(
        admin, repayUser, setTokensUser,
        [poolUSDC, poolUSDT, poolAny],
        [Domain.BASE, Domain.BASE, Domain.BASE],
        [Provider.LOCAL, Provider.LOCAL, Provider.LOCAL],
        [usdc, usdt, ZERO_ADDRESS],
        [],
      )).data;
      const repayerProxy = (await deployX(
        "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayerMixedAssets", {},
        repayerImpl, admin, repayerInit
      )) as TransparentUpgradeableProxy;
      const repayer = (await getContractAt("Repayer", repayerProxy, deployer)) as Repayer;

      const USDC_DEC = 10n ** (await usdc.decimals());
      const USDT_DEC = 10n ** (await usdt.decimals());

      return {
        deployer, admin, repayUser, setTokensUser, usdc, usdt, USDC_DEC, USDT_DEC,
        poolUSDC, poolUSDT, poolAny, repayer,
      };
    };

    it("Should report the correct onlySupportedToken per pool via getAllRoutes", async function () {
      const {repayer, usdc, usdt, poolUSDC, poolUSDT, poolAny} = await loadFixture(deployAll);
      const routes = await repayer.getAllRoutes();
      const byPool = new Map(routes.pools.map((pool, i) => [pool, routes.poolOnlySupportsToken[i]]));
      expect(byPool.get(await poolUSDC.getAddress())).to.equal(usdc.target);
      expect(byPool.get(await poolUSDT.getAddress())).to.equal(usdt.target);
      expect(byPool.get(await poolAny.getAddress())).to.equal(ZERO_ADDRESS);
    });

    it("Should allow repaying USDC to the USDC-only pool but reject USDT", async function () {
      const {repayer, usdc, usdt, USDC_DEC, USDT_DEC, repayUser, poolUSDC, deployer} =
        await loadFixture(deployAll);
      await usdc.connect(deployer).transfer(repayer, 10n * USDC_DEC);
      await usdt.connect(deployer).transfer(repayer, 10n * USDT_DEC);

      await expect(repayer.connect(repayUser).initiateRepay(
        usdc, 5n * USDC_DEC, poolUSDC, Domain.BASE, Provider.LOCAL, "0x"
      )).to.emit(repayer, "InitiateRepay");
      expect(await usdc.balanceOf(poolUSDC)).to.equal(5n * USDC_DEC);

      await expect(repayer.connect(repayUser).initiateRepay(
        usdt, 1n * USDT_DEC, poolUSDC, Domain.BASE, Provider.LOCAL, "0x"
      )).to.be.revertedWithCustomError(repayer, "InvalidToken");
    });

    it("Should allow repaying USDT to the USDT-only pool but reject USDC", async function () {
      const {repayer, usdc, usdt, USDC_DEC, USDT_DEC, repayUser, poolUSDT, deployer} =
        await loadFixture(deployAll);
      await usdc.connect(deployer).transfer(repayer, 10n * USDC_DEC);
      await usdt.connect(deployer).transfer(repayer, 10n * USDT_DEC);

      await expect(repayer.connect(repayUser).initiateRepay(
        usdt, 5n * USDT_DEC, poolUSDT, Domain.BASE, Provider.LOCAL, "0x"
      )).to.emit(repayer, "InitiateRepay");
      expect(await usdt.balanceOf(poolUSDT)).to.equal(5n * USDT_DEC);

      await expect(repayer.connect(repayUser).initiateRepay(
        usdc, 1n * USDC_DEC, poolUSDT, Domain.BASE, Provider.LOCAL, "0x"
      )).to.be.revertedWithCustomError(repayer, "InvalidToken");
    });

    it("Should allow repaying either token to the unrestricted pool", async function () {
      const {repayer, usdc, usdt, USDC_DEC, USDT_DEC, repayUser, poolAny, deployer} =
        await loadFixture(deployAll);
      await usdc.connect(deployer).transfer(repayer, 10n * USDC_DEC);
      await usdt.connect(deployer).transfer(repayer, 10n * USDT_DEC);

      await repayer.connect(repayUser).initiateRepay(
        usdc, 5n * USDC_DEC, poolAny, Domain.BASE, Provider.LOCAL, "0x"
      );
      await repayer.connect(repayUser).initiateRepay(
        usdt, 3n * USDT_DEC, poolAny, Domain.BASE, Provider.LOCAL, "0x"
      );
      expect(await usdc.balanceOf(poolAny)).to.equal(5n * USDC_DEC);
      expect(await usdt.balanceOf(poolAny)).to.equal(3n * USDT_DEC);
    });
  });
});
