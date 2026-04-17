import {
  loadFixture,
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
  TestLiquidityPool, Rebalancer, TestCCTPTokenMessenger, TestCCTPMessageTransmitter,
  TestCCTPV2TokenMessenger, TestCCTPV2MessageTransmitter,
  TestGnosisOmnibridge, TestGnosisAMB,
} from "../typechain-types";
import {networkConfig} from "../network.config";

const ALLOWED = true;
const DISALLOWED = false;

describe("Rebalancer", function () {
  const deployAll = async () => {
    const [deployer, admin, rebalanceUser, user] = await hre.ethers.getSigners();

    const REBALANCER_ROLE = toBytes32("REBALANCER_ROLE");
    const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const liquidityPool = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;
    const liquidityPool2 = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      usdc,
      deployer,
      networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;
    const cctpTokenMessenger = (await deploy("TestCCTPTokenMessenger", deployer, {})) as TestCCTPTokenMessenger;
    const cctpMessageTransmitter = (
      await deploy("TestCCTPMessageTransmitter", deployer, {})
    ) as TestCCTPMessageTransmitter
    const cctpV2TokenMessenger = (
      await deploy("TestCCTPV2TokenMessenger", deployer, {})
    ) as TestCCTPV2TokenMessenger;
    const cctpV2MessageTransmitter = (
      await deploy("TestCCTPV2MessageTransmitter", deployer, {})
    ) as TestCCTPV2MessageTransmitter;

    const USDC = 10n ** (await usdc.decimals());

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "Rebalancer", {},
        Domain.BASE, usdc, cctpTokenMessenger, cctpMessageTransmitter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        cctpV2TokenMessenger, cctpV2MessageTransmitter,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin,
      rebalanceUser,
      [liquidityPool, liquidityPool2, liquidityPool, liquidityPool, liquidityPool],
      [Domain.BASE, Domain.BASE, Domain.ETHEREUM, Domain.ARBITRUM_ONE, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.LOCAL, Provider.CCTP, Provider.CCTP, Provider.CCTP_V2]
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancer", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    const rebalancerProxyAdminAddress = await getCreateAddress(rebalancerProxy, 1);
    const rebalancerAdmin = (await getContractAt("ProxyAdmin", rebalancerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);

    return {
      deployer, admin, rebalanceUser, user, usdc,
      USDC, liquidityPool, liquidityPool2, rebalancer, rebalancerProxy, rebalancerAdmin,
      cctpTokenMessenger, cctpMessageTransmitter,
      cctpV2TokenMessenger, cctpV2MessageTransmitter,
      REBALANCER_ROLE, DEFAULT_ADMIN_ROLE,
    };
  };

  it("Should have default values", async function () {
    const {liquidityPool, liquidityPool2, rebalancer, usdc, REBALANCER_ROLE, DEFAULT_ADMIN_ROLE,
      cctpTokenMessenger, cctpMessageTransmitter, admin, rebalanceUser, deployer,
    } = await loadFixture(deployAll);

    expect(await rebalancer.ASSETS()).to.equal(usdc.target);
    expect(await rebalancer.CCTP_TOKEN_MESSENGER()).to.equal(cctpTokenMessenger.target);
    expect(await rebalancer.CCTP_MESSAGE_TRANSMITTER()).to.equal(cctpMessageTransmitter.target);
    expect(await rebalancer.REBALANCER_ROLE()).to.equal(REBALANCER_ROLE);
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.BASE, Provider.LOCAL)).to.be.true;
    expect(await rebalancer.isRouteAllowed(liquidityPool2, Domain.BASE, Provider.LOCAL)).to.be.true;
    expect(await rebalancer.isRouteAllowed(liquidityPool2, Domain.BASE, Provider.CCTP)).to.be.false;
    expect(await rebalancer.isRouteAllowed(liquidityPool2, Domain.ETHEREUM, Provider.CCTP)).to.be.false;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.ETHEREUM, Provider.CCTP)).to.be.true;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.AVALANCHE, Provider.CCTP)).to.be.false;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    expect(await rebalancer.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.be.true;
    expect(await rebalancer.hasRole(DEFAULT_ADMIN_ROLE, deployer)).to.be.false;
    expect(await rebalancer.hasRole(REBALANCER_ROLE, rebalanceUser)).to.be.true;
    expect(await rebalancer.hasRole(REBALANCER_ROLE, deployer)).to.be.false;
    expect(await rebalancer.domainCCTP(Domain.ETHEREUM)).to.equal(0n);
    expect(await rebalancer.domainCCTP(Domain.AVALANCHE)).to.equal(1n);
    expect(await rebalancer.domainCCTP(Domain.OP_MAINNET)).to.equal(2n);
    expect(await rebalancer.domainCCTP(Domain.ARBITRUM_ONE)).to.equal(3n);
    expect(await rebalancer.domainCCTP(Domain.BASE)).to.equal(6n);
    expect(await rebalancer.domainCCTP(Domain.POLYGON_MAINNET)).to.equal(7n);
    expect(await rebalancer.getAllRoutes()).to.deep.equal([
      [
        liquidityPool.target, liquidityPool.target, liquidityPool.target,
        liquidityPool.target, liquidityPool2.target,
      ],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE, Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.CCTP, Provider.CCTP_V2, Provider.LOCAL, Provider.LOCAL],
    ]);

    await expect(rebalancer.connect(admin).initialize(
      admin, rebalanceUser.address, [], [], []
    )).to.be.reverted;
  });

  it("Should allow admin to enable routes", async function () {
    const {rebalancer, usdc, USDC, admin, rebalanceUser,
      liquidityPool, liquidityPool2
    } = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool, 10n * USDC);
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      5n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.AVALANCHE,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "RouteDenied()");
    const tx = rebalancer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.AVALANCHE],
      [Provider.CCTP],
      ALLOWED
    );
    await expect(tx)
      .to.emit(rebalancer, "SetRoute")
      .withArgs(liquidityPool.target, Domain.AVALANCHE, Provider.CCTP, ALLOWED);

    expect(await rebalancer.getAllRoutes()).to.deep.equal([
      [
        liquidityPool.target, liquidityPool.target, liquidityPool.target,
        liquidityPool.target, liquidityPool.target, liquidityPool2.target,
      ],
      [
        Domain.ETHEREUM, Domain.AVALANCHE, Domain.ARBITRUM_ONE,
        Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE,
      ],
      [
        Provider.CCTP, Provider.CCTP, Provider.CCTP,
        Provider.CCTP_V2, Provider.LOCAL, Provider.LOCAL,
      ],
    ]);
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.ETHEREUM, Provider.CCTP)).to.be.true;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.AVALANCHE, Provider.CCTP)).to.be.true;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    await rebalancer.connect(rebalanceUser).initiateRebalance(
      5n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.AVALANCHE,
      Provider.CCTP,
      "0x"
    );
  });

  it("Should allow admin to disable routes", async function () {
    const {rebalancer, usdc, USDC, admin, rebalanceUser, liquidityPool, liquidityPool2} = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool, 10n * USDC);
    await rebalancer.connect(rebalanceUser).initiateRebalance(
      5n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    );
    const tx = rebalancer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.CCTP],
      DISALLOWED
    );
    await expect(tx)
      .to.emit(rebalancer, "SetRoute")
      .withArgs(liquidityPool.target, Domain.ETHEREUM, Provider.CCTP, DISALLOWED);

    expect(await rebalancer.getAllRoutes()).to.deep.equal([
      [
        liquidityPool.target, liquidityPool.target,
        liquidityPool.target, liquidityPool2.target,
      ],
      [Domain.ARBITRUM_ONE, Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.CCTP_V2, Provider.LOCAL, Provider.LOCAL],
    ]);

    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.ETHEREUM, Provider.CCTP)).to.be.false;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.AVALANCHE, Provider.CCTP)).to.be.false;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      5n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "RouteDenied()");
  });

  it("Should not allow admin to enable invalid routes", async function () {
    const {rebalancer, admin, liquidityPool2, deployer} = await loadFixture(deployAll);
    const liquidityPool3 = (await deploy(
      "TestLiquidityPool",
      deployer,
      {},
      admin,
      admin,
      networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;

    await expect(rebalancer.connect(admin).setRoute(
      [liquidityPool2],
      [Domain.BASE],
      [Provider.CCTP],
      ALLOWED
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(admin).setRoute(
      [liquidityPool2],
      [Domain.ETHEREUM],
      [Provider.LOCAL],
      ALLOWED
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(admin).setRoute(
      [liquidityPool3],
      [Domain.BASE],
      [Provider.LOCAL],
      ALLOWED
    )).to.be.revertedWithCustomError(rebalancer, "InvalidPoolAssets()");
    await expect(rebalancer.connect(admin).setRoute(
      [liquidityPool2, liquidityPool2],
      [Domain.BASE],
      [Provider.LOCAL],
      ALLOWED
    )).to.be.revertedWithCustomError(rebalancer, "InvalidLength()");
    await expect(rebalancer.connect(admin).setRoute(
      [liquidityPool2],
      [Domain.BASE],
      [Provider.LOCAL, Provider.LOCAL],
      ALLOWED
    )).to.be.revertedWithCustomError(rebalancer, "InvalidLength()");
    await expect(rebalancer.connect(admin).setRoute(
      [ZERO_ADDRESS],
      [Domain.BASE],
      [Provider.LOCAL],
      ALLOWED
    )).to.be.revertedWithCustomError(rebalancer, "ZeroAddress()");
  });

  it("Should not allow others to enable routes", async function () {
    const {rebalancer, rebalanceUser, liquidityPool2} = await loadFixture(deployAll);

    await expect(rebalancer.connect(rebalanceUser).setRoute(
      [liquidityPool2],
      [Domain.AVALANCHE],
      [Provider.CCTP],
      ALLOWED
    )).to.be.revertedWithCustomError(rebalancer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should not allow others to disable routes", async function () {
    const {rebalancer, rebalanceUser, liquidityPool} = await loadFixture(deployAll);

    await expect(rebalancer.connect(rebalanceUser).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.CCTP],
      DISALLOWED
    )).to.be.revertedWithCustomError(rebalancer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should revert initiate rebalance for unsupported providers", async function () {
    const {rebalancer, rebalanceUser, liquidityPool, admin, usdc} = await loadFixture(deployAll);

    await rebalancer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.ACROSS],
      ALLOWED
    );

    await usdc.transfer(liquidityPool, 1n);
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      1n,
      liquidityPool,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.ACROSS,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
  });

  it("Should allow rebalancer to initiate rebalance", async function () {
    const {rebalancer, usdc, USDC, rebalanceUser, liquidityPool,
      cctpTokenMessenger
    } = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool, 10n * USDC);
    const tx = rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    );
    await expect(tx)
      .to.emit(rebalancer, "InitiateRebalance")
      .withArgs(4n * USDC, liquidityPool.target, liquidityPool.target, Domain.ETHEREUM, Provider.CCTP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, rebalancer.target, 4n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, cctpTokenMessenger.target, 4n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(cctpTokenMessenger.target, ZERO_ADDRESS, 4n * USDC);

    expect(await usdc.balanceOf(liquidityPool)).to.equal(6n * USDC);
    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
  });

  it("Should allow rebalancer to initiate rebalance via CCTP V2 with standard transfer params", async function () {
    const {rebalancer, usdc, USDC, rebalanceUser, liquidityPool,
      cctpV2TokenMessenger
    } = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool, 10n * USDC);
    const tx = rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.CCTP_V2,
      "0x"
    );
    await expect(tx)
      .to.emit(rebalancer, "InitiateRebalance")
      .withArgs(4n * USDC, liquidityPool.target, liquidityPool.target, Domain.ARBITRUM_ONE, Provider.CCTP_V2);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, rebalancer.target, 4n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, cctpV2TokenMessenger.target, 4n * USDC);
    // V2 mock asserts maxFee == 0 and minFinalityThreshold == 2000.
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(cctpV2TokenMessenger.target, ZERO_ADDRESS, 4n * USDC);

    expect(await usdc.balanceOf(liquidityPool)).to.equal(6n * USDC);
    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
  });

  it("Should allow rebalancer to process rebalance via CCTP V2", async function () {
    const {rebalancer, usdc, USDC, liquidityPool, rebalanceUser} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    const tx = rebalancer.connect(rebalanceUser).processRebalance(liquidityPool, Provider.CCTP_V2, extraData);
    await expect(tx)
      .to.emit(rebalancer, "ProcessRebalance")
      .withArgs(4n * USDC, liquidityPool.target, Provider.CCTP_V2);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(ZERO_ADDRESS, liquidityPool.target, 4n * USDC);
    await expect(tx)
      .to.emit(liquidityPool, "Deposit");

    expect(await usdc.balanceOf(liquidityPool)).to.equal(4n * USDC);
    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
  });

  it("Should revert CCTP V2 initiate if TokenMessenger is zero address", async function () {
    const {deployer, admin, rebalanceUser, usdc, USDC, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter,
    } = await loadFixture(deployAll);

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerNoCCTPV2", {},
        Domain.BASE, usdc, cctpTokenMessenger, cctpMessageTransmitter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [liquidityPool, liquidityPool], [Domain.BASE, Domain.ARBITRUM_ONE], [Provider.LOCAL, Provider.CCTP_V2]
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancerNoCCTPV2", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    await liquidityPool.grantRole(toBytes32("LIQUIDITY_ADMIN_ROLE"), rebalancer);

    await usdc.transfer(liquidityPool, 10n * USDC);
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC, liquidityPool, liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP_V2, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "ZeroAddress");
  });

  it("Should revert CCTP V2 process if MessageTransmitter is zero address", async function () {
    const {deployer, admin, rebalanceUser, usdc, USDC, liquidityPool,
      cctpTokenMessenger, cctpMessageTransmitter, cctpV2TokenMessenger,
    } = await loadFixture(deployAll);

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerNoCCTPV2Transmitter", {},
        Domain.BASE, usdc, cctpTokenMessenger, cctpMessageTransmitter,
        ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        cctpV2TokenMessenger, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [liquidityPool, liquidityPool], [Domain.BASE, Domain.ARBITRUM_ONE], [Provider.LOCAL, Provider.CCTP_V2]
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer,
      "TransparentUpgradeableProxyRebalancerNoCCTPV2Transmitter", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    await liquidityPool.grantRole(toBytes32("LIQUIDITY_ADMIN_ROLE"), rebalancer);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(rebalancer.connect(rebalanceUser).processRebalance(liquidityPool, Provider.CCTP_V2, extraData))
      .to.be.revertedWithCustomError(rebalancer, "ZeroAddress");
  });

  it("Should allow rebalancer to initiate rebalance to local pool", async function () {
    const {rebalancer, usdc, USDC, rebalanceUser, liquidityPool, liquidityPool2
    } = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool, 10n * USDC);
    const tx = rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC,
      liquidityPool,
      liquidityPool2,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    );
    await expect(tx)
      .to.emit(rebalancer, "InitiateRebalance")
      .withArgs(4n * USDC, liquidityPool.target, liquidityPool2.target, Domain.BASE, Provider.LOCAL);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, rebalancer.target, 4n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, liquidityPool2.target, 4n * USDC);

    expect(await usdc.balanceOf(liquidityPool)).to.equal(6n * USDC);
    expect(await usdc.balanceOf(liquidityPool2)).to.equal(4n * USDC);
    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
  });

  it("Should not allow rebalancer to initiate rebalance on invalid route", async function () {
    const {rebalancer, usdc, USDC, rebalanceUser, liquidityPool,
    } = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool, 10n * USDC);
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC,
      usdc,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "RouteDenied()");
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC,
      liquidityPool,
      usdc,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "RouteDenied()");
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.BASE,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "RouteDenied()");
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.BASE,
      Provider.LOCAL,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "InvalidRoute()");
  });

  it("Should not allow others to initiate rebalance", async function () {
    const {rebalancer, usdc, USDC, admin, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool, 10n * USDC);
    await expect(rebalancer.connect(admin).initiateRebalance(
      4n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should not allow rebalancer to initiate rebalance with 0 amount", async function () {
    const {rebalancer, rebalanceUser, usdc, USDC, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool, 10n * USDC);
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      0n,
      liquidityPool,
      liquidityPool,
      Domain.ETHEREUM,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "ZeroAmount()");
  });

  it("Should not allow rebalancer to initiate rebalance with disabled route", async function () {
    const {rebalancer, rebalanceUser, usdc, USDC, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool, 10n * USDC);
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.AVALANCHE,
      Provider.CCTP,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "RouteDenied()");
  });

  it("Should revert processRebalance for unsupported providers", async function () {
    const {
      rebalanceUser, liquidityPool, rebalancer,
    } = await loadFixture(deployAll);

    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.LOCAL, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.ACROSS, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.STARGATE, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.EVERCLEAR, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.SUPERCHAIN_STANDARD_BRIDGE, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.ARBITRUM_GATEWAY, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
  });

  it("Should allow rebalancer to process rebalance", async function () {
    const {rebalancer, usdc, USDC, liquidityPool, rebalanceUser} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    const tx = rebalancer.connect(rebalanceUser).processRebalance(liquidityPool, Provider.CCTP, extraData);
    await expect(tx)
      .to.emit(rebalancer, "ProcessRebalance")
      .withArgs(4n * USDC, liquidityPool.target, Provider.CCTP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(ZERO_ADDRESS, liquidityPool.target, 4n * USDC);
    await expect(tx)
      .to.emit(liquidityPool, "Deposit");

    expect(await usdc.balanceOf(liquidityPool)).to.equal(4n * USDC);
    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
  });

  it("Should not allow others to process rebalance", async function () {
    const {rebalancer, usdc, USDC, liquidityPool, user} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(rebalancer.connect(user).processRebalance(liquidityPool, Provider.CCTP, extraData))
      .to.be.revertedWithCustomError(rebalancer, "AccessControlUnauthorizedAccount(address,bytes32)");;
  });

  it("Should revert if CCTP receiveMessage reverts", async function () {
    const {rebalancer, usdc, USDC, liquidityPool, rebalanceUser} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [false, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(rebalancer.connect(rebalanceUser).processRebalance(liquidityPool, Provider.CCTP, extraData))
      .to.be.reverted;
  });

  it("Should revert if CCTP receiveMessage returned false", async function () {
    const {rebalancer, usdc, USDC, liquidityPool, rebalanceUser} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, false]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(rebalancer.connect(rebalanceUser).processRebalance(liquidityPool, Provider.CCTP, extraData))
      .to.be.revertedWithCustomError(rebalancer, "ProcessFailed()");
  });

  it("Should allow rebalancer to initiate rebalance via Gnosis Omnibridge from Ethereum to Gnosis", async function () {
    const {
      usdc, USDC, rebalanceUser, liquidityPool, admin, deployer,
      cctpTokenMessenger, cctpMessageTransmitter,
    } = await loadFixture(deployAll);
    const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "Rebalancer2", {},
        Domain.ETHEREUM, usdc, cctpTokenMessenger, cctpMessageTransmitter,
        ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.GNOSIS_CHAIN],
      [Provider.LOCAL, Provider.GNOSIS_OMNIBRIDGE],
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancer2", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);

    await usdc.transfer(liquidityPool, 10n * USDC);

    const tx = rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC, liquidityPool, liquidityPool, Domain.GNOSIS_CHAIN, Provider.GNOSIS_OMNIBRIDGE, "0x"
    );
    await expect(tx)
      .to.emit(rebalancer, "InitiateRebalance")
      .withArgs(4n * USDC, liquidityPool.target, liquidityPool.target, Domain.GNOSIS_CHAIN, Provider.GNOSIS_OMNIBRIDGE);
    await expect(tx)
      .to.emit(rebalancer, "GnosisOmnibridgeTransferInitiated")
      .withArgs(usdc.target, liquidityPool.target, 4n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, ethereumOmnibridge.target, 4n * USDC);

    expect(await usdc.balanceOf(liquidityPool)).to.equal(6n * USDC);
    expect(await usdc.balanceOf(ethereumOmnibridge)).to.equal(4n * USDC);
  });

  it("Should allow rebalancer to process rebalance via Gnosis Omnibridge", async function () {
    const {
      usdc, USDC, rebalanceUser, liquidityPool, admin, deployer,
      cctpTokenMessenger, cctpMessageTransmitter,
    } = await loadFixture(deployAll);

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "Rebalancer2", {},
        Domain.ETHEREUM, usdc, cctpTokenMessenger, cctpMessageTransmitter,
        ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.LOCAL],
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancer2", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;

    await usdc.transfer(ethereumAmb, 4n * USDC);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signatures = AbiCoder.defaultAbiCoder().encode(["bool"], [true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes", "bytes"],
      [usdc.target, message, signatures]
    );

    const tx = rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.GNOSIS_OMNIBRIDGE, extraData
    );
    await expect(tx)
      .to.emit(rebalancer, "ProcessRebalance")
      .withArgs(4n * USDC, liquidityPool.target, Provider.GNOSIS_OMNIBRIDGE);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(ethereumAmb.target, liquidityPool.target, 4n * USDC);
    await expect(tx)
      .to.emit(liquidityPool, "Deposit");

    expect(await usdc.balanceOf(liquidityPool)).to.equal(4n * USDC);
    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
  });

  it("Should revert rebalancer processRebalance via Gnosis Omnibridge if arbitrary token received", async function () {
    const {
      usdc, USDC, rebalanceUser, liquidityPool, admin, deployer,
      cctpTokenMessenger, cctpMessageTransmitter,
    } = await loadFixture(deployAll);

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "Rebalancer2", {},
        Domain.ETHEREUM, usdc, cctpTokenMessenger, cctpMessageTransmitter,
        ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.LOCAL],
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancer2", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;

    const usdc2 = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    await usdc2.transfer(ethereumAmb, 4n * USDC);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc2.target, liquidityPool.target, 4n * USDC]
    );
    const signatures = AbiCoder.defaultAbiCoder().encode(["bool"], [true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes", "bytes"],
      [usdc2.target, message, signatures]
    );

    const tx = rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.GNOSIS_OMNIBRIDGE, extraData
    );
    await expect(tx)
      .to.be.revertedWithCustomError(rebalancer, "InvalidReceivedToken()");
  });
});
