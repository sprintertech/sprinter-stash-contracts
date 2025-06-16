import {
  loadFixture, setBalance, time, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {AbiCoder, zeroPadValue} from "ethers";
import {anyValue} from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  getCreateAddress, getContractAt, deploy, deployX, toBytes32, getBalance,
} from "./helpers";
import {
  ProviderSolidity as Provider, DomainSolidity as Domain, ZERO_ADDRESS,
  DEFAULT_ADMIN_ROLE, assertAddress, ETH, ZERO_BYTES32,
} from "../scripts/common";
import {
  TestUSDC, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, Repayer, TestCCTPTokenMessenger, TestCCTPMessageTransmitter,
  TestAcrossV3SpokePool, TestStargate, MockStargateTreasurerTrue, MockStargateTreasurerFalse,
  TestOptimismStandardBridge
} from "../typechain-types";
import {networkConfig} from "../network.config";

const ALLOWED = true;
const DISALLOWED = false;

async function now() {
  return BigInt(await time.latest());
}

function addressToBytes32(address: any) {
  return zeroPadValue(address.toString(), 32);
}

describe("Repayer", function () {
  const deployAll = async () => {
    const [deployer, admin, repayUser, user] = await hre.ethers.getSigners();
    await setCode(repayUser.address, "0x00");

    const forkNetworkConfig = networkConfig.BASE;

    const REPAYER_ROLE = toBytes32("REPAYER_ROLE");
    const DEPOSIT_PROFIT_ROLE = toBytes32("DEPOSIT_PROFIT_ROLE");

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const liquidityPool = (await deploy("TestLiquidityPool", deployer, {}, usdc, deployer)) as TestLiquidityPool;
    const liquidityPool2 = (await deploy("TestLiquidityPool", deployer, {}, usdc, deployer)) as TestLiquidityPool;
    const cctpTokenMessenger = (await deploy("TestCCTPTokenMessenger", deployer, {})) as TestCCTPTokenMessenger;
    const cctpMessageTransmitter = (
      await deploy("TestCCTPMessageTransmitter", deployer, {})
    ) as TestCCTPMessageTransmitter;
    const acrossV3SpokePool = (
      await deploy("TestAcrossV3SpokePool", deployer, {})
    ) as TestAcrossV3SpokePool;
    const stargateTreasurerTrue = (
      await deploy("MockStargateTreasurerTrue", deployer, {})
    ) as MockStargateTreasurerTrue;
    const stargateTreasurerFalse = (
      await deploy("MockStargateTreasurerFalse", deployer, {})
    ) as MockStargateTreasurerFalse;
    const optimismBridge = (
      await deploy("TestOptimismStandardBridge", deployer, {})
    ) as TestOptimismStandardBridge;

    const USDC_DEC = 10n ** (await usdc.decimals());

    const EURC_ADDRESS = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42"; 
    const EURC_OWNER_ADDRESS = process.env.EURC_OWNER_ADDRESS!;
    if (!EURC_OWNER_ADDRESS) throw new Error("Env variables not configured (EURC_OWNER_ADDRESS missing)");
    const eurc = await hre.ethers.getContractAt("ERC20", EURC_ADDRESS);
    const eurcOwner = await hre.ethers.getImpersonatedSigner(EURC_OWNER_ADDRESS);
    await setBalance(EURC_OWNER_ADDRESS, 10n ** 18n);
    const EURC_DEC = 10n ** (await eurc.decimals());

    const WETH_ADDRESS = forkNetworkConfig.WrappedNativeToken;
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", WETH_ADDRESS);

    const everclearFeeAdapter = await hre.ethers.getContractAt("IFeeAdapter", forkNetworkConfig.EverclearFeeAdapter!);

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer", {},
        Domain.BASE,
        usdc.target,
        cctpTokenMessenger.target,
        cctpMessageTransmitter.target,
        acrossV3SpokePool.target,
        everclearFeeAdapter.target,
        weth.target,
        stargateTreasurerTrue,
        optimismBridge.target,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin.address,
      repayUser.address,
      [liquidityPool.target, liquidityPool2.target, liquidityPool.target, liquidityPool.target],
      [Domain.BASE, Domain.BASE, Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.LOCAL, Provider.CCTP, Provider.CCTP],
      [true, false, true, true],
    )).data;
    const repayerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRepayer", {},
      repayerImpl.target, admin, repayerInit
    )) as TransparentUpgradeableProxy;
    const repayer = (await getContractAt("Repayer", repayerProxy.target, deployer)) as Repayer;
    const repayerProxyAdminAddress = await getCreateAddress(repayerProxy, 1);
    const repayerAdmin = (await getContractAt("ProxyAdmin", repayerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(DEPOSIT_PROFIT_ROLE, repayer.target);

    return {
      deployer, admin, repayUser, user, usdc,
      USDC_DEC, eurc, EURC_DEC, eurcOwner, liquidityPool, liquidityPool2, repayer, repayerProxy, repayerAdmin,
      cctpTokenMessenger, cctpMessageTransmitter, REPAYER_ROLE, DEFAULT_ADMIN_ROLE, acrossV3SpokePool, weth,
      stargateTreasurerTrue, stargateTreasurerFalse, everclearFeeAdapter, forkNetworkConfig, optimismBridge,
    };
  };

  it("Should have default values", async function () {
    const {liquidityPool, liquidityPool2, repayer, usdc, REPAYER_ROLE, DEFAULT_ADMIN_ROLE,
      cctpTokenMessenger, cctpMessageTransmitter, admin, repayUser, deployer, acrossV3SpokePool,
      stargateTreasurerTrue, optimismBridge,
    } = await loadFixture(deployAll);

    expect(await repayer.ASSETS()).to.equal(usdc.target);
    expect(await repayer.CCTP_TOKEN_MESSENGER()).to.equal(cctpTokenMessenger.target);
    expect(await repayer.CCTP_MESSAGE_TRANSMITTER()).to.equal(cctpMessageTransmitter.target);
    expect(await repayer.ACROSS_SPOKE_POOL()).to.equal(acrossV3SpokePool.target);
    expect(await repayer.STARGATE_TREASURER()).to.equal(stargateTreasurerTrue.target);
    expect(await repayer.OPTIMISM_STANDARD_BRIDGE()).to.equal(optimismBridge.target);
    expect(await repayer.REPAYER_ROLE()).to.equal(REPAYER_ROLE);
    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.BASE, Provider.LOCAL)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool2.target, Domain.BASE, Provider.LOCAL)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool2.target, Domain.BASE, Provider.CCTP)).to.be.false;
    expect(await repayer.isRouteAllowed(liquidityPool2.target, Domain.ETHEREUM, Provider.CCTP)).to.be.false;
    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.ETHEREUM, Provider.CCTP)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.AVALANCHE, Provider.CCTP)).to.be.false;
    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS)).to.be.false;
    expect(await repayer.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    expect(await repayer.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.false;
    expect(await repayer.hasRole(REPAYER_ROLE, repayUser.address)).to.be.true;
    expect(await repayer.hasRole(REPAYER_ROLE, deployer.address)).to.be.false;
    expect(await repayer.domainCCTP(Domain.ETHEREUM)).to.equal(0n);
    expect(await repayer.domainCCTP(Domain.AVALANCHE)).to.equal(1n);
    expect(await repayer.domainCCTP(Domain.OP_MAINNET)).to.equal(2n);
    expect(await repayer.domainCCTP(Domain.ARBITRUM_ONE)).to.equal(3n);
    expect(await repayer.domainCCTP(Domain.BASE)).to.equal(6n);
    expect(await repayer.domainCCTP(Domain.POLYGON_MAINNET)).to.equal(7n);
    expect(await repayer.domainChainId(Domain.ETHEREUM)).to.equal(1n);
    expect(await repayer.domainChainId(Domain.AVALANCHE)).to.equal(43114n);
    expect(await repayer.domainChainId(Domain.OP_MAINNET)).to.equal(10n);
    expect(await repayer.domainChainId(Domain.ARBITRUM_ONE)).to.equal(42161n);
    expect(await repayer.domainChainId(Domain.BASE)).to.equal(8453n);
    expect(await repayer.domainChainId(Domain.POLYGON_MAINNET)).to.equal(137n);
    expect(await repayer.getAllRoutes()).to.deep.equal([
      [liquidityPool.target, liquidityPool.target, liquidityPool.target, liquidityPool2.target],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.CCTP, Provider.LOCAL, Provider.LOCAL],
      [true, true, true, false]
    ]);

    await expect(repayer.connect(admin).initialize(
      admin.address, repayUser.address, [], [], [], []
    )).to.be.reverted;
  });

  it("Should allow admin to enable routes", async function () {
    const {repayer, usdc, USDC_DEC, admin, repayUser,
      liquidityPool, liquidityPool2
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc.target,
      5n * USDC_DEC,
      liquidityPool.target,
      Domain.AVALANCHE,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "RouteDenied()");
    const tx = repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.AVALANCHE],
      [Provider.CCTP],
      [true],
      ALLOWED
    );
    await expect(tx)
      .to.emit(repayer, "SetRoute")
      .withArgs(liquidityPool.target, Domain.AVALANCHE, Provider.CCTP, true, ALLOWED);

    expect(await repayer.getAllRoutes()).to.deep.equal([
      [liquidityPool.target, liquidityPool.target, liquidityPool.target, liquidityPool.target, liquidityPool2.target],
      [Domain.ETHEREUM, Domain.AVALANCHE, Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.LOCAL, Provider.LOCAL],
      [true, true, true, true, false],
    ]);
    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.ETHEREUM, Provider.CCTP)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.AVALANCHE, Provider.CCTP)).to.be.true;
    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    await repayer.connect(repayUser).initiateRepay(
      usdc.target,
      5n * USDC_DEC,
      liquidityPool.target,
      Domain.AVALANCHE,
      Provider.CCTP,
      "0x"
    );
  });

  it("Should allow admin to disable routes", async function () {
    const {repayer, usdc, USDC_DEC, admin, repayUser, liquidityPool, liquidityPool2} = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);
    await repayer.connect(repayUser).initiateRepay(
      usdc.target,
      5n * USDC_DEC,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    );
    const tx = repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.CCTP],
      [true],
      DISALLOWED
    );
    await expect(tx)
      .to.emit(repayer, "SetRoute")
      .withArgs(liquidityPool.target, Domain.ETHEREUM, Provider.CCTP, true, DISALLOWED);

    expect(await repayer.getAllRoutes()).to.deep.equal([
      [liquidityPool.target, liquidityPool.target, liquidityPool2.target],
      [Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.LOCAL, Provider.LOCAL],
      [true, true, false]
    ]);

    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.ETHEREUM, Provider.CCTP)).to.be.false;
    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.AVALANCHE, Provider.CCTP)).to.be.false;
    expect(await repayer.isRouteAllowed(liquidityPool.target, Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc.target,
      5n * USDC_DEC,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "RouteDenied()");
  });

  it("Should not allow admin to enable invalid routes", async function () {
    const {repayer, admin, liquidityPool2, deployer} = await loadFixture(deployAll);
    const liquidityPool3 = (await deploy("TestLiquidityPool", deployer, {}, admin, admin)) as TestLiquidityPool;

    await expect(repayer.connect(admin).setRoute(
      [liquidityPool2.target],
      [Domain.BASE],
      [Provider.CCTP],
      [true],
      ALLOWED
    )).to.be.revertedWithCustomError(repayer, "UnsupportedProvider()");
    await expect(repayer.connect(admin).setRoute(
      [liquidityPool2.target],
      [Domain.ETHEREUM],
      [Provider.LOCAL],
      [true],
      ALLOWED
    )).to.be.revertedWithCustomError(repayer, "UnsupportedProvider()");
    await expect(repayer.connect(admin).setRoute(
      [liquidityPool3.target],
      [Domain.BASE],
      [Provider.LOCAL],
      [false],
      ALLOWED
    )).to.be.revertedWithCustomError(repayer, "InvalidPoolAssets()");
  });

  it("Should not allow others to enable routes", async function () {
    const {repayer, repayUser, liquidityPool2} = await loadFixture(deployAll);

    await expect(repayer.connect(repayUser).setRoute(
      [liquidityPool2.target],
      [Domain.AVALANCHE],
      [Provider.CCTP],
      [true],
      ALLOWED
    )).to.be.revertedWithCustomError(repayer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should not allow others to disable routes", async function () {
    const {repayer, repayUser, liquidityPool} = await loadFixture(deployAll);

    await expect(repayer.connect(repayUser).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.CCTP],
      [true],
      DISALLOWED
    )).to.be.revertedWithCustomError(repayer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should allow repayer to initiate CCTP repay", async function () {
    const {repayer, usdc, USDC_DEC, repayUser, liquidityPool,
      cctpTokenMessenger
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc.target,
      4n * USDC_DEC,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, 4n * USDC_DEC, liquidityPool.target, Domain.ETHEREUM, Provider.CCTP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, cctpTokenMessenger.target, 4n * USDC_DEC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(cctpTokenMessenger.target, ZERO_ADDRESS, 4n * USDC_DEC);

    expect(await usdc.balanceOf(repayer.target)).to.equal(6n * USDC_DEC);
  });

  it("Should allow repayer to initiate Across repay", async function () {
    const {repayer, usdc, USDC_DEC, admin, repayUser,
      liquidityPool, acrossV3SpokePool, eurc, user,
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [eurc.target, amount + 1n, user.address, 1n, 2n, 3n]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, acrossV3SpokePool.target, amount);
    await expect(tx)
      .to.emit(acrossV3SpokePool, "FundsDeposited")
      .withArgs(
        addressToBytes32(usdc.target),
        addressToBytes32(eurc.target),
        amount,
        amount + 1n,
        1n,
        1337n,
        1n,
        2n,
        3n,
        addressToBytes32(repayer.target),
        addressToBytes32(liquidityPool.target),
        addressToBytes32(user.address),
        "0x"
      );

    expect(await usdc.balanceOf(repayer.target)).to.equal(6n * USDC_DEC);
  });

  it("Should allow repayer to initiate Across repay with a different token", async function () {
    const {repayer, EURC_DEC, admin, repayUser,
      liquidityPool, acrossV3SpokePool, eurc, user, eurcOwner,
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer.target, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [ZERO_ADDRESS, amount * 998n / 1000n, user.address, 1n, 2n, 3n]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      eurc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(eurc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
    await expect(tx)
      .to.emit(eurc, "Transfer")
      .withArgs(repayer.target, acrossV3SpokePool.target, amount);
    await expect(tx)
      .to.emit(acrossV3SpokePool, "FundsDeposited")
      .withArgs(
        addressToBytes32(eurc.target),
        addressToBytes32(ZERO_ADDRESS),
        amount,
        amount * 998n / 1000n,
        1n,
        1337n,
        1n,
        2n,
        3n,
        addressToBytes32(repayer.target),
        addressToBytes32(liquidityPool.target),
        addressToBytes32(user.address),
        "0x"
      );

    expect(await eurc.balanceOf(repayer.target)).to.equal(6n * EURC_DEC);
  });

  it("Should allow repayer to initiate Across repay with SpokePool on fork", async function () {
    const {deployer, repayer, USDC_DEC, admin, repayUser, repayerAdmin, repayerProxy,
      liquidityPool, cctpTokenMessenger, cctpMessageTransmitter, weth, stargateTreasurerTrue, everclearFeeAdapter,
      optimismBridge,
    } = await loadFixture(deployAll);
    
    const acrossV3SpokePoolFork = await hre.ethers.getContractAt(
      "V3SpokePoolInterface",
      networkConfig.BASE.AcrossV3SpokePool!
    );
    const USDC_BASE_ADDRESS = networkConfig.BASE.USDC;

    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", networkConfig.BASE.USDC);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const repayerImpl2 = (
      await deployX(
        "Repayer",
        deployer,
        "Repayer2",
        {},
        Domain.BASE,
        usdc.target,
        cctpTokenMessenger.target,
        cctpMessageTransmitter.target,
        acrossV3SpokePoolFork.target,
        everclearFeeAdapter.target,
        weth.target,
        stargateTreasurerTrue,
        optimismBridge,
      )
    ) as Repayer;

    expect(await repayerAdmin.connect(admin).upgradeAndCall(repayerProxy, repayerImpl2, "0x"))
      .to.emit(repayerProxy, "Upgraded");
    expect(await repayer.ACROSS_SPOKE_POOL())
      .to.equal(acrossV3SpokePoolFork.target);

    await usdc.connect(usdcOwner).transfer(repayer.target, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const currentTime = await now();
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [USDC_BASE_ADDRESS, amount * 998n / 1000n, ZERO_ADDRESS, currentTime - 1n, currentTime + 90n, 0n]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.ACROSS);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, acrossV3SpokePoolFork.target, amount);
    await expect(tx)
      .to.emit(acrossV3SpokePoolFork, "FundsDeposited")
      .withArgs(
        addressToBytes32(usdc.target),
        addressToBytes32(USDC_BASE_ADDRESS),
        amount,
        amount * 998n / 1000n,
        await repayer.domainChainId(Domain.ETHEREUM),
        anyValue,
        currentTime - 1n,
        currentTime + 90n,
        0n,
        addressToBytes32(repayer.target),
        addressToBytes32(liquidityPool.target),
        addressToBytes32(ZERO_ADDRESS),
        "0x"
      );
  });

  it("Should revert Across repay if call to Across reverts", async function () {
    const {repayer, EURC_DEC, admin, repayUser,
      liquidityPool, acrossV3SpokePool, eurc, user, eurcOwner,
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer.target, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const fillDeadlineError = 0n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [ZERO_ADDRESS, amount, user.address, 1n, fillDeadlineError, 3n]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    )).to.be.revertedWithCustomError(acrossV3SpokePool, "InvalidFillDeadline()");
  });

  it("Should revert Across repay if slippage is above 0.20%", async function () {
    const {repayer, EURC_DEC, admin, repayUser,
      liquidityPool, eurc, user, eurcOwner,
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer.target, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint32", "uint32", "uint32"],
      [ZERO_ADDRESS, amount * 998n / 1000n - 1n, user.address, 1n, 2n, 3n]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.ACROSS,
      extraData
    )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh()");
  });

  it("Should allow repayer to initiate Everclear repay on fork", async function () {
    const {repayer, USDC_DEC, admin, repayUser,
      liquidityPool, everclearFeeAdapter, forkNetworkConfig,
    } = await loadFixture(deployAll);
    
    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.USDC);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    await usdc.connect(usdcOwner).transfer(repayer.target, 100000n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.EVERCLEAR],
      [true],
      ALLOWED
    );
    const amount = 40000n * USDC_DEC;

    const apiData = (await (await fetch("https://api.everclear.org/intents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        origin: forkNetworkConfig.chainId.toString(),
        destinations: [networkConfig.ETHEREUM.chainId.toString()],
        to: liquidityPool.target,
        inputAsset: usdc.target,
        amount: amount.toString(),
        callData: "",
        maxFee: "0"
      })
    })).json()).data;
    const newIntentSelector = "0x3bd1c754";
    // API returns selector for a variety of newIntent that takes 'address' as resipient.
    // We are using a V3 version that expects a 'bytes32' instead. Encoding other data remains the same.
    const apiTx = everclearFeeAdapter.interface.decodeFunctionData("newIntent", newIntentSelector + apiData.substr(10));

    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint24", "uint48", "tuple(uint256, uint256, bytes)"],
      [apiTx[3], apiTx[4], apiTx[5], apiTx[6], apiTx[8]]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.EVERCLEAR,
      extraData
    );

    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.EVERCLEAR);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, everclearFeeAdapter.target, amount);
    await expect(tx)
      .to.emit(everclearFeeAdapter, "IntentWithFeesAdded");
    expect(await usdc.balanceOf(repayer.target)).to.equal(60000n * USDC_DEC);
  });

  it("Should allow repayer to initiate Everclear repay with other token", async function () {
    const {deployer, repayer, weth, admin, repayUser,
      liquidityPool, everclearFeeAdapter, forkNetworkConfig,
    } = await loadFixture(deployAll);

    await deployer.sendTransaction({to: repayer.target, value: 10n * ETH});

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.EVERCLEAR],
      [true],
      ALLOWED
    );
    const amount = 4n * ETH;

    const apiData = (await (await fetch("https://api.everclear.org/intents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        origin: forkNetworkConfig.chainId.toString(),
        destinations: [networkConfig.ETHEREUM.chainId.toString()],
        to: liquidityPool.target,
        inputAsset: weth.target,
        amount: amount.toString(),
        callData: "",
        maxFee: "200"
      })
    })).json()).data;
    const newIntentSelector = "0x3bd1c754";
    // API returns selector for a variety of newIntent that takes 'address' as resipient.
    // We are using a V3 version that expects a 'bytes32' instead. Encoding other data remains the same.
    const apiTx = everclearFeeAdapter.interface.decodeFunctionData("newIntent", newIntentSelector + apiData.substr(10));

    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint24", "uint48", "tuple(uint256, uint256, bytes)"],
      [apiTx[3], apiTx[4], apiTx[5], apiTx[6], apiTx[8]]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      weth.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.EVERCLEAR,
      extraData
    );

    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.EVERCLEAR);
    await expect(tx)
      .to.emit(weth, "Transfer")
      .withArgs(repayer.target, everclearFeeAdapter.target, amount);
    await expect(tx)
      .to.emit(everclearFeeAdapter, "IntentWithFeesAdded");
    expect(await weth.balanceOf(repayer.target)).to.equal(6n * ETH);
  });

  it("Should revert Everclear repay if call to Everclear reverts", async function () {
    const {repayer, USDC_DEC, admin, repayUser,
      liquidityPool, forkNetworkConfig,
    } = await loadFixture(deployAll);

    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", forkNetworkConfig.USDC);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    await usdc.connect(usdcOwner).transfer(repayer.target, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.EVERCLEAR],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;

    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint24", "uint48", "tuple(uint256, uint256, bytes)"],
      [ZERO_BYTES32, amount, 0, 0, [0, 0, "0x"]]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.EVERCLEAR,
      extraData
    )).to.be.reverted;
  });

  // it.only("Should allow repayer to initiate Optimism repay on fork", async function () {
  //   // This test is commented out because it should be run on Ethereum mainnet fork.
  //   // To run this test, change FORK_PROVIDER in .env to ethereum mainnet RPC URL
  //   // and modify the deployAll fixture so that it doesn't perform calls to token contracts on BASE
  //   // for getting token decimals (for example, set the token decimals to fixed values).
  //   const {deployer, repayer, USDC_DEC, admin, repayUser, repayerAdmin, repayerProxy, acrossV3SpokePool,
  //     liquidityPool, cctpTokenMessenger, cctpMessageTransmitter, weth, stargateTreasurerTrue, everclearFeeAdapter,
  //   } = await loadFixture(deployAll);
    
  //   const optimismBridgeFork = await hre.ethers.getContractAt(
  //     "IOptimismStandardBridge",
  //     networkConfig.ETHEREUM.OptimismStandardBridge!
  //   );
  //   const USDC_ETHEREUM_ADDRESS = networkConfig.ETHEREUM.USDC;

  //   assertAddress(process.env.USDC_OWNER_ETH_ADDRESS, "Env variables not configured (USDC_OWNER_ETH_ADDRESS missing)");
  //   const USDC_OWNER_ETH_ADDRESS = process.env.USDC_OWNER_ETH_ADDRESS;
  //   const usdc = await hre.ethers.getContractAt("ERC20", networkConfig.ETHEREUM.USDC);
  //   const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ETH_ADDRESS);
  //   await setBalance(USDC_OWNER_ETH_ADDRESS, 10n ** 18n);

  //   const repayerImpl2 = (
  //     await deployX(
  //       "Repayer",
  //       deployer,
  //       "Repayer2",
  //       {},
  //       Domain.ETHEREUM,
  //       usdc.target,
  //       cctpTokenMessenger.target,
  //       cctpMessageTransmitter.target,
  //       acrossV3SpokePool.target,
  //       everclearFeeAdapter.target,
  //       weth.target,
  //       stargateTreasurerTrue,
  //       optimismBridgeFork,
  //     )
  //   ) as Repayer;

  //   expect(await repayerAdmin.connect(admin).upgradeAndCall(repayerProxy, repayerImpl2, "0x"))
  //     .to.emit(repayerProxy, "Upgraded");
  //   expect(await repayer.OPTIMISM_STANDARD_BRIDGE())
  //     .to.equal(optimismBridgeFork.target);

  //   await usdc.connect(usdcOwner).transfer(repayer.target, 10n * USDC_DEC);

  //   await repayer.connect(admin).setRoute(
  //     [liquidityPool.target],
  //     [Domain.OP_MAINNET],
  //     [Provider.OPTIMISM],
  //     [true],
  //     ALLOWED
  //   );
  //   const amount = 4n * USDC_DEC;
  //   const outputToken = networkConfig.OP_MAINNET.USDC;
  //   const minGasLimit = 4n * USDC_DEC;
  //   const extraData = AbiCoder.defaultAbiCoder().encode(
  //     ["address", "uint32"],
  //     [outputToken, minGasLimit]
  //   );
  //   const tx = repayer.connect(repayUser).initiateRepay(
  //     usdc.target,
  //     amount,
  //     liquidityPool.target,
  //     Domain.OP_MAINNET,
  //     Provider.OPTIMISM,
  //     extraData
  //   );
  //   await expect(tx)
  //     .to.emit(repayer, "InitiateRepay")
  //     .withArgs(usdc.target, amount, liquidityPool.target, Domain.OP_MAINNET, Provider.OPTIMISM);
  //   await expect(tx)
  //     .to.emit(usdc, "Transfer")
  //     .withArgs(repayer.target, optimismBridgeFork.target, amount);
  //   await expect(tx)
  //     .to.emit(optimismBridgeFork, "ERC20BridgeInitiated")
  //     .withArgs(
  //       usdc.target,
  //       outputToken,
  //       repayer.target,
  //       liquidityPool.target,
  //       amount,
  //       "0x"
  //     );
  // });

  it.skip("Should allow repayer to initiate Optimism repay with mock bridge", async function () {
  });

  it.skip("Should revert Optimism repay if call to Optimism reverts", async function () {
  });

  it.skip("Should NOT allow repayer to initiate Optimism repay on invalid route", async function () {
  });

  it("Should allow repayer to initiate repay of a different token", async function () {
    const {repayer, eurc, EURC_DEC, eurcOwner, repayUser, liquidityPool
    } = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer.target, 10n * EURC_DEC);
    const tx = repayer.connect(repayUser).initiateRepay(
      eurc.target,
      4n * EURC_DEC,
      liquidityPool.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(eurc.target, 4n * EURC_DEC, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(eurc, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, 4n * EURC_DEC);

    expect(await eurc.balanceOf(repayer.target)).to.equal(6n * EURC_DEC);
    expect(await eurc.balanceOf(liquidityPool.target)).to.equal(4n * EURC_DEC);
  });

  it("Should allow repayer to initiate repay to local pool", async function () {
    const {repayer, usdc, USDC_DEC, repayUser, liquidityPool2
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc.target,
      4n * USDC_DEC,
      liquidityPool2.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, 4n * USDC_DEC, liquidityPool2.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, liquidityPool2.target, 4n * USDC_DEC);

    expect(await usdc.balanceOf(repayer.target)).to.equal(6n * USDC_DEC);
    expect(await usdc.balanceOf(liquidityPool2.target)).to.equal(4n * USDC_DEC);
  });

  it("Should not allow repayer to initiate repay on invalid route", async function () {
    const {repayer, usdc, USDC_DEC, repayUser, liquidityPool,
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc.target,
      4n * USDC_DEC,
      usdc.target,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "RouteDenied()");
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc.target,
      4n * USDC_DEC,
      liquidityPool.target,
      Domain.BASE,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "RouteDenied()");
  });

  it("Should not allow others to initiate repay", async function () {
    const {repayer, usdc, USDC_DEC, admin, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);
    await expect(repayer.connect(admin).initiateRepay(
      usdc.target,
      4n * USDC_DEC,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should not allow repayer to initiate repay with 0 amount", async function () {
    const {repayer, repayUser, usdc, USDC_DEC, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc.target,
      0n,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "ZeroAmount()");
  });

  it("Should not allow repayer to initiate repay with disabled route", async function () {
    const {repayer, repayUser, usdc, USDC_DEC, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc.target,
      4n * USDC_DEC,
      liquidityPool.target,
      Domain.AVALANCHE,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "RouteDenied()");
  });

  it("Should not allow repayer to initiate repay with other token if the pool doesn't support it", async function () {
    const {repayer, repayUser, eurc, EURC_DEC, eurcOwner, liquidityPool2} = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer.target, 10n * EURC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc.target,
      4n * EURC_DEC,
      liquidityPool2.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "InvalidToken()");
  });

  it("Should not allow repayer to initiate repay with other token if the provider is CCTP", async function () {
    const {repayer, repayUser, eurc, EURC_DEC, eurcOwner, liquidityPool} = await loadFixture(deployAll);

    await eurc.connect(eurcOwner).transfer(repayer.target, 10n * EURC_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc.target,
      4n * EURC_DEC,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "InvalidToken()");
  });

  it("Should allow repayer to process repay", async function () {
    const {repayer, usdc, USDC_DEC, liquidityPool, repayUser} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC_DEC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    const tx = repayer.connect(repayUser).processRepay(liquidityPool.target, Provider.CCTP, extraData);
    await expect(tx)
      .to.emit(repayer, "ProcessRepay")
      .withArgs(usdc.target, 4n * USDC_DEC, liquidityPool.target, Provider.CCTP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(ZERO_ADDRESS, liquidityPool.target, 4n * USDC_DEC);

    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(4n * USDC_DEC);
    expect(await usdc.balanceOf(repayer.target)).to.equal(0n);
  });

  it("Should not allow others to process repay", async function () {
    const {repayer, usdc, USDC_DEC, liquidityPool, user} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC_DEC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(repayer.connect(user).processRepay(liquidityPool.target, Provider.CCTP, extraData))
      .to.be.revertedWithCustomError(repayer, "AccessControlUnauthorizedAccount(address,bytes32)");;
  });

  it("Should revert if CCTP receiveMessage reverts", async function () {
    const {repayer, usdc, USDC_DEC, liquidityPool, repayUser} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC_DEC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [false, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(repayer.connect(repayUser).processRepay(liquidityPool.target, Provider.CCTP, extraData))
      .to.be.reverted;
  });

  it("Should revert if CCTP receiveMessage returned false", async function () {
    const {repayer, usdc, USDC_DEC, liquidityPool, repayUser} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC_DEC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, false]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(repayer.connect(repayUser).processRepay(liquidityPool.target, Provider.CCTP, extraData))
      .to.be.revertedWithCustomError(repayer, "ProcessFailed()");
  });

  it("Should perform Stargate repay with a mock pool", async function () {
    const {repayer, USDC_DEC, usdc, admin, repayUser, liquidityPool, deployer} = await loadFixture(deployAll);

    const testStargate = (
      await deploy("TestStargate", deployer, {}, usdc.target)
    ) as TestStargate;
    expect(await testStargate.token()).to.eq(usdc.target);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const minAmount = amount * 999n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [testStargate.target, minAmount]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * ETH}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.STARGATE);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, testStargate.target, amount);

    const receipt = await hre.ethers.provider.getTransactionReceipt((await tx).hash);
    const events = await repayer.queryFilter(repayer.getEvent("StargateTransfer"), receipt!.blockNumber);
    const messagingFee = events[0].args[0][2];
    expect(messagingFee[1]).to.eq(0);
    const nativeFee = messagingFee[0];
    await expect(tx).to.changeEtherBalance(repayUser, -nativeFee);

    await expect(tx)
      .to.emit(testStargate, "OFTSent")
      .withArgs(
        anyValue,
        "30101",
        repayer.target,
        amount,
        minAmount
      );
  });

  it("Should revert Stargate repay if the pool is not registered", async function () {
    const {repayer, USDC_DEC, usdc, admin, repayUser, liquidityPool, deployer, cctpTokenMessenger,
      cctpMessageTransmitter, acrossV3SpokePool, weth, stargateTreasurerFalse, repayerAdmin, repayerProxy,
      everclearFeeAdapter, optimismBridge,
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);

    const testStargate = (
      await deploy("TestStargate", deployer, {}, usdc.target)
    ) as TestStargate;
    expect(await testStargate.token()).to.eq(usdc.target);

    const repayerImpl2 = (
      await deployX(
        "Repayer",
        deployer,
        "Repayer2",
        {},
        Domain.BASE,
        usdc.target,
        cctpTokenMessenger.target,
        cctpMessageTransmitter.target,
        acrossV3SpokePool.target,
        everclearFeeAdapter.target,
        weth.target,
        stargateTreasurerFalse,
        optimismBridge,
      )
    ) as Repayer;

    expect(await repayerAdmin.connect(admin).upgradeAndCall(repayerProxy, repayerImpl2, "0x"))
      .to.emit(repayerProxy, "Upgraded");
    expect(await repayer.STARGATE_TREASURER())
      .to.equal(stargateTreasurerFalse.target);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const minAmount = amount * 999n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [testStargate.target, minAmount]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * ETH}
    )).to.be.revertedWithCustomError(repayer, "PoolInvalid");
  });

  it("Should revert Stargate repay if provided minimal amount is too low", async function () {
    const {repayer, USDC_DEC, usdc, admin, repayUser, liquidityPool, deployer
    } = await loadFixture(deployAll);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);

    const testStargate = (
      await deploy("TestStargate", deployer, {}, usdc.target)
    ) as TestStargate;
    expect(await testStargate.token()).to.eq(usdc.target);

    await usdc.transfer(repayer.target, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );

    const amount = 4n * USDC_DEC;
    const minAmount = amount * 997n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [testStargate.target, minAmount]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * ETH}
    )).to.be.revertedWithCustomError(repayer, "SlippageTooHigh");
  });

  it("Should revert Stargate repay if the pool token doesn't match", async function () {
    const {
      repayer, EURC_DEC, usdc, admin, repayUser, liquidityPool, deployer, eurc, eurcOwner
    } = await loadFixture(deployAll);

    const testStargate = (
      await deploy("TestStargate", deployer, {}, usdc.target)
    ) as TestStargate;
    expect(await testStargate.token()).to.eq(usdc.target);

    await eurc.connect(eurcOwner).transfer(repayer.target, 10n * EURC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );
    const amount = 4n * EURC_DEC;
    const minAmount = amount * 999n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [testStargate.target, minAmount]
    );
    await expect(repayer.connect(repayUser).initiateRepay(
      eurc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * ETH}
    )).to.be.revertedWithCustomError(repayer, "PoolInvalid");
  });

  it("Should allow repayer to initiate Stargate repay on fork and refund unspent fee", async function () {
    const {
      repayer, USDC_DEC, admin, repayUser, liquidityPool, deployer, cctpTokenMessenger, cctpMessageTransmitter,
      acrossV3SpokePool, weth, repayerAdmin, repayerProxy, everclearFeeAdapter, optimismBridge,
    } = await loadFixture(deployAll);
    
    const stargatePoolUsdcAddress = "0x27a16dc786820B16E5c9028b75B99F6f604b5d26";
    const stargateTreasurer = "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7";
    const stargatePoolUsdc = await hre.ethers.getContractAt(
      "IStargate",
      stargatePoolUsdcAddress
    );
    const USDC_BASE_ADDRESS = networkConfig.BASE.USDC;

    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", USDC_BASE_ADDRESS);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const repayerImpl2 = (
      await deployX(
        "Repayer",
        deployer,
        "Repayer2",
        {},
        Domain.BASE,
        usdc.target,
        cctpTokenMessenger.target,
        cctpMessageTransmitter.target,
        acrossV3SpokePool.target,
        everclearFeeAdapter.target,
        weth.target,
        stargateTreasurer,
        optimismBridge,
      )
    ) as Repayer;

    expect(await repayerAdmin.connect(admin).upgradeAndCall(repayerProxy, repayerImpl2, "0x"))
      .to.emit(repayerProxy, "Upgraded");
    expect(await repayer.STARGATE_TREASURER())
      .to.equal(stargateTreasurer);

    await usdc.connect(usdcOwner).transfer(repayer.target, 10000n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );
    const amount = 4000n * USDC_DEC;
    const minAmount = amount * 999n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [stargatePoolUsdcAddress, minAmount]
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      usdc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * ETH}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(usdc.target, amount, liquidityPool.target, Domain.ETHEREUM, Provider.STARGATE);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(repayer.target, stargatePoolUsdcAddress, amount);

    const receipt = await hre.ethers.provider.getTransactionReceipt((await tx).hash);
    const events = await repayer.queryFilter(repayer.getEvent("StargateTransfer"), receipt!.blockNumber);
    const messagingFee = events[0].args[0][2];
    expect(messagingFee[1]).to.eq(0);
    const nativeFee = messagingFee[0];
    await expect(tx).to.changeEtherBalance(repayUser, -nativeFee);

    await expect(tx)
      .to.emit(stargatePoolUsdc, "OFTSent")
      .withArgs(
        anyValue,
        "30101",
        repayer.target,
        amount,
        anyValue
      );
    const eventsOft = await stargatePoolUsdc.queryFilter(stargatePoolUsdc.getEvent("OFTSent"), receipt!.blockNumber);
    const amountOutSent = eventsOft[0].args[4];
    expect(amountOutSent).to.be.gte(minAmount);
  });

  it("Should revert if Stargate pool reverts the payment", async function () {
    const {repayer, USDC_DEC, admin, repayUser, liquidityPool} = await loadFixture(deployAll);
    
    const stargatePoolUsdcAddress = "0x27a16dc786820B16E5c9028b75B99F6f604b5d26";
    const USDC_BASE_ADDRESS = networkConfig.BASE.USDC;

    assertAddress(process.env.USDC_OWNER_ADDRESS, "Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    const usdc = await hre.ethers.getContractAt("ERC20", USDC_BASE_ADDRESS);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    await usdc.connect(usdcOwner).transfer(repayer.target, 10n * USDC_DEC);

    await repayer.connect(admin).setRoute(
      [liquidityPool.target],
      [Domain.ETHEREUM],
      [Provider.STARGATE],
      [true],
      ALLOWED
    );
    const amount = 4n * USDC_DEC;
    const minAmount = amount * 999n / 1000n;
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"], [stargatePoolUsdcAddress, minAmount]
    );
    // Not enough native fee provided
    await expect(repayer.connect(repayUser).initiateRepay(
      usdc.target,
      amount,
      liquidityPool.target,
      Domain.ETHEREUM,
      Provider.STARGATE,
      extraData,
      {value: 1n * USDC_DEC}
    )).to.be.reverted;
  });

  it("Should allow to receive native tokens", async function () {
      // Covered in Should wrap native tokens on initiate repay
  });

  it("Should allow to receive native tokens on initiate repay", async function () {
      // Covered in Should not wrap native tokens on initiate repay that were sent in as msg.value
  });

  it("Should wrap native tokens on initiate repay", async function () {
    const {repayer, repayUser, liquidityPool, weth
    } = await loadFixture(deployAll);

    const nativeAmount = 10n * ETH;
    const repayAmount = 4n * ETH;

    await repayUser.sendTransaction({to: repayer.target, value: nativeAmount});
    const tx = repayer.connect(repayUser).initiateRepay(
      weth.target,
      repayAmount,
      liquidityPool.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, repayAmount, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(weth, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, repayAmount);
    await expect(tx)
      .to.emit(weth, "Deposit")
      .withArgs(repayer.target, nativeAmount);

    expect(await weth.balanceOf(repayer.target)).to.equal(6n * ETH);
    expect(await weth.balanceOf(liquidityPool.target)).to.equal(4n * ETH);
    expect(await getBalance(repayer.target)).to.equal(0);
  });

  it("Should not wrap native tokens on initiate repay if the balance is 0", async function () {
    const {repayer, repayUser, liquidityPool, weth
    } = await loadFixture(deployAll);

    const nativeAmount = 10n * ETH;
    const repayAmount = 4n * ETH;

    await repayUser.sendTransaction({to: repayer.target, value: nativeAmount});
    await repayer.connect(repayUser).initiateRepay(
      weth.target,
      repayAmount,
      liquidityPool.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    const tx = repayer.connect(repayUser).initiateRepay(
      weth.target,
      repayAmount,
      liquidityPool.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, repayAmount, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(weth, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, repayAmount);
    await expect(tx)
      .to.not.emit(weth, "Deposit");

    expect(await weth.balanceOf(repayer.target)).to.equal(2n * ETH);
    expect(await weth.balanceOf(liquidityPool.target)).to.equal(8n * ETH);
    expect(await getBalance(repayer.target)).to.equal(0);
  });

  it("Should not wrap native tokens on initiate repay of other tokens", async function () {
    const {repayer, eurc, EURC_DEC, eurcOwner, repayUser, liquidityPool, weth,
    } = await loadFixture(deployAll);

    const nativeAmount = 10n * ETH;

    await repayUser.sendTransaction({to: repayer.target, value: nativeAmount});
    await eurc.connect(eurcOwner).transfer(repayer.target, 10n * EURC_DEC);
    const tx = repayer.connect(repayUser).initiateRepay(
      eurc.target,
      4n * EURC_DEC,
      liquidityPool.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(eurc.target, 4n * EURC_DEC, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(eurc, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, 4n * EURC_DEC);
    await expect(tx)
      .to.not.emit(weth, "Deposit");

    expect(await eurc.balanceOf(repayer.target)).to.equal(6n * EURC_DEC);
    expect(await eurc.balanceOf(liquidityPool.target)).to.equal(4n * EURC_DEC);
    expect(await weth.balanceOf(repayer.target)).to.equal(0);
    expect(await weth.balanceOf(liquidityPool.target)).to.equal(0);
    expect(await getBalance(repayer.target)).to.equal(nativeAmount);
  });

  it("Should not wrap native tokens on initiate repay that were sent in as msg.value", async function () {
    const {repayer, repayUser, liquidityPool, weth
    } = await loadFixture(deployAll);

    const nativeAmount = 10n * ETH;
    const repayAmount = 4n * ETH;
    const extraAmount = 1n * ETH;

    await repayUser.sendTransaction({to: repayer.target, value: nativeAmount});
    const tx = repayer.connect(repayUser).initiateRepay(
      weth.target,
      repayAmount,
      liquidityPool.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x",
      {value: extraAmount}
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(weth.target, repayAmount, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(weth, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, repayAmount);
    await expect(tx)
      .to.emit(weth, "Deposit")
      .withArgs(repayer.target, nativeAmount);

    expect(await weth.balanceOf(repayer.target)).to.equal(6n * ETH);
    expect(await weth.balanceOf(liquidityPool.target)).to.equal(4n * ETH);
    expect(await getBalance(repayer.target)).to.equal(extraAmount);
  });

  it("Should not wrap native tokens on initiate repay if the balance was 0 before the tx", async function () {
    const {repayer, repayUser, liquidityPool, weth
    } = await loadFixture(deployAll);

    const nativeAmount = 10n * ETH;

    await expect(repayer.connect(repayUser).initiateRepay(
      weth.target,
      nativeAmount,
      liquidityPool.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x",
      {value: nativeAmount}
    )).to.be.revertedWithCustomError(repayer, "InsufficientBalance()");
  });
});
