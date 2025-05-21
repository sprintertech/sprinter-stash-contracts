import {
  loadFixture, setBalance
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {AbiCoder} from "ethers";
import {
  getCreateAddress, getContractAt, deploy, deployX, toBytes32,
} from "./helpers";
import {
  ProviderSolidity as Provider, DomainSolidity as Domain, ZERO_ADDRESS,
  DEFAULT_ADMIN_ROLE,
} from "../scripts/common";
import {
  TestUSDC, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, Repayer, TestCCTPTokenMessenger, TestCCTPMessageTransmitter,
  TestAcrossV3SpokePool,
} from "../typechain-types";

const ALLOWED = true;
const DISALLOWED = false;

describe("Repayer", function () {
  const deployAll = async () => {
    const [deployer, admin, repayUser, user] = await hre.ethers.getSigners();

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

    const USDC_DEC = 10n ** (await usdc.decimals());

    const UNI_ADDRESS = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
    const UNI_OWNER_ADDRESS = process.env.UNI_OWNER_ADDRESS!;
    if (!UNI_OWNER_ADDRESS) throw new Error("Env variables not configured (UNI_OWNER_ADDRESS missing)");
    const uni = await hre.ethers.getContractAt("ERC20", UNI_ADDRESS);
    const uniOwner = await hre.ethers.getImpersonatedSigner(UNI_OWNER_ADDRESS);
    await setBalance(UNI_OWNER_ADDRESS, 10n ** 18n);
    const UNI_DEC = 10n ** (await uni.decimals());

    const repayerImpl = (
      await deployX("Repayer", deployer, "Repayer", {},
        Domain.BASE, usdc.target, cctpTokenMessenger.target, cctpMessageTransmitter.target, acrossV3SpokePool.target,
      )
    ) as Repayer;
    const repayerInit = (await repayerImpl.initialize.populateTransaction(
      admin.address,
      repayUser.address,
      [liquidityPool.target, liquidityPool2.target, liquidityPool.target, liquidityPool.target],
      [Domain.BASE, Domain.BASE, Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.LOCAL, Provider.CCTP, Provider.CCTP],
      [true, false, true, true]
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
      USDC_DEC, uni, UNI_DEC, uniOwner, liquidityPool, liquidityPool2, repayer, repayerProxy, repayerAdmin,
      cctpTokenMessenger, cctpMessageTransmitter, REPAYER_ROLE, DEFAULT_ADMIN_ROLE, acrossV3SpokePool,
    };
  };

  it("Should have default values", async function () {
    const {liquidityPool, liquidityPool2, repayer, usdc, REPAYER_ROLE, DEFAULT_ADMIN_ROLE,
      cctpTokenMessenger, cctpMessageTransmitter, admin, repayUser, deployer, acrossV3SpokePool,
    } = await loadFixture(deployAll);

    expect(await repayer.ASSETS()).to.equal(usdc.target);
    expect(await repayer.CCTP_TOKEN_MESSENGER()).to.equal(cctpTokenMessenger.target);
    expect(await repayer.CCTP_MESSAGE_TRANSMITTER()).to.equal(cctpMessageTransmitter.target);
    expect(await repayer.ACROSS_SPOKE_POOL()).to.equal(acrossV3SpokePool.target);
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

  it.skip("Should allow repayer to initiate Across repay", async function () {

  });

  it.skip("Should allow repayer to initiate Across repay with a different token", async function () {

  });

  it.skip("Should revert Across repay if call to Across reverts", async function () {

  });

  it.skip("Should revert Across repay if slippage is above 10%", async function () {

  });

  it("Should allow repayer to initiate repay of a different token", async function () {
    const {repayer, uni, UNI_DEC, uniOwner, repayUser, liquidityPool
    } = await loadFixture(deployAll);

    await uni.connect(uniOwner).transfer(repayer.target, 10n * UNI_DEC);
    const tx = repayer.connect(repayUser).initiateRepay(
      uni.target,
      4n * UNI_DEC,
      liquidityPool.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(repayer, "InitiateRepay")
      .withArgs(uni.target, 4n * UNI_DEC, liquidityPool.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(uni, "Transfer")
      .withArgs(repayer.target, liquidityPool.target, 4n * UNI_DEC);

    expect(await uni.balanceOf(repayer.target)).to.equal(6n * UNI_DEC);
    expect(await uni.balanceOf(liquidityPool.target)).to.equal(4n * UNI_DEC);
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
    const {repayer, repayUser, uni, UNI_DEC, uniOwner, liquidityPool2} = await loadFixture(deployAll);

    await uni.connect(uniOwner).transfer(repayer.target, 10n * UNI_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      uni.target,
      4n * UNI_DEC,
      liquidityPool2.target,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    )).to.be.revertedWithCustomError(repayer, "InvalidToken()");
  });

  it("Should not allow repayer to initiate repay with other token if the provider is CCTP", async function () {
    const {repayer, repayUser, uni, UNI_DEC, uniOwner, liquidityPool} = await loadFixture(deployAll);

    await uni.connect(uniOwner).transfer(repayer.target, 10n * UNI_DEC);
    await expect(repayer.connect(repayUser).initiateRepay(
      uni.target,
      4n * UNI_DEC,
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
});
