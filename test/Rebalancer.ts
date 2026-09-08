import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {AbiCoder, encodeBytes32String} from "ethers";
import {
  getCreateAddress, getContractAt, deploy, deployX, allRemoteDomains, toBytes32,
  setupTests, stubDestinationThisAddress,
} from "./helpers";
import {
  ProviderSolidity as Provider, DomainSolidity as Domain, ZERO_ADDRESS,
  DEFAULT_ADMIN_ROLE, addressToBytes32,
  bytes32ToToken,
  ZERO_BYTES32,
} from "../scripts/common";
import {
  TestUSDC, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, Rebalancer,
  TestCCTPV2TokenMessenger, TestCCTPV2MessageTransmitter,
  TestGnosisOmnibridge, TestGnosisAMB, TestUSDCTransmuter,
} from "../typechain-types";
import {prodNetworkConfig as networkConfig} from "../network.config";

const ALLOWED = true;
const DISALLOWED = false;

describe("Rebalancer", function () {
  setupTests();

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
    const cctpV2TokenMessenger = (
      await deploy("TestCCTPV2TokenMessenger", deployer, {})
    ) as TestCCTPV2TokenMessenger;
    const cctpV2MessageTransmitter = (
      await deploy("TestCCTPV2MessageTransmitter", deployer, {})
    ) as TestCCTPV2MessageTransmitter;

    const USDC = 10n ** (await usdc.decimals());

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "Rebalancer", {},
        Domain.BASE, usdc, usdc, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        cctpV2TokenMessenger, cctpV2MessageTransmitter,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin,
      rebalanceUser,
      [liquidityPool, liquidityPool2, liquidityPool],
      [Domain.BASE, Domain.BASE, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.LOCAL, Provider.CCTP_V2],
      allRemoteDomains(Domain.BASE)
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
      cctpV2TokenMessenger, cctpV2MessageTransmitter,
      REBALANCER_ROLE, DEFAULT_ADMIN_ROLE,
    };
  };

  it("Should have default values", async function () {
    const {liquidityPool, liquidityPool2, rebalancer, usdc, REBALANCER_ROLE, DEFAULT_ADMIN_ROLE,
      admin, rebalanceUser, deployer,
    } = await loadFixture(deployAll);

    expect(await rebalancer.ASSETS()).to.equal(usdc.target);
    expect(await rebalancer.REBALANCER_ROLE()).to.equal(REBALANCER_ROLE);
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.BASE, Provider.LOCAL)).to.be.true;
    expect(await rebalancer.isRouteAllowed(liquidityPool2, Domain.BASE, Provider.LOCAL)).to.be.true;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP_V2)).to.be.true;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.AVALANCHE, Provider.CCTP_V2)).to.be.false;
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
    expect(await rebalancer.domainCCTP(Domain.UNICHAIN)).to.equal(10n);
    expect(await rebalancer.domainCCTP(Domain.LINEA)).to.equal(11n);
    expect(await rebalancer.domainCCTP(Domain.WORLD_CHAIN)).to.equal(14n);
    expect(await rebalancer.domainCCTP(Domain.HYPER_EVM)).to.equal(19n);
    expect(await rebalancer.domainCCTP(Domain.INK)).to.equal(21n);
    expect(await rebalancer.getAllRoutes()).to.deep.equal([
      [liquidityPool.target, liquidityPool.target, liquidityPool2.target],
      [Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP_V2, Provider.LOCAL, Provider.LOCAL],
    ]);

    await expect(rebalancer.connect(admin).initialize(
      admin, rebalanceUser.address, [], [], [], []
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
      Provider.CCTP_V2,
      "0x"
    )).to.be.revertedWithCustomError(rebalancer, "RouteDenied()");
    const tx = rebalancer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.AVALANCHE],
      [Provider.CCTP_V2],
      ALLOWED
    );
    await expect(tx)
      .to.emit(rebalancer, "SetRoute")
      .withArgs(liquidityPool.target, Domain.AVALANCHE, Provider.CCTP_V2, ALLOWED);

    expect(await rebalancer.getAllRoutes()).to.deep.equal([
      [
        liquidityPool.target, liquidityPool.target,
        liquidityPool.target, liquidityPool2.target,
      ],
      [Domain.AVALANCHE, Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP_V2, Provider.CCTP_V2, Provider.LOCAL, Provider.LOCAL],
    ]);
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.AVALANCHE, Provider.CCTP_V2)).to.be.true;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP_V2)).to.be.true;
    await rebalancer.connect(rebalanceUser).initiateRebalance(
      5n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.AVALANCHE,
      Provider.CCTP_V2,
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
      Domain.ARBITRUM_ONE,
      Provider.CCTP_V2,
      "0x"
    );
    const tx = rebalancer.connect(admin).setRoute(
      [liquidityPool],
      [Domain.ARBITRUM_ONE],
      [Provider.CCTP_V2],
      DISALLOWED
    );
    await expect(tx)
      .to.emit(rebalancer, "SetRoute")
      .withArgs(liquidityPool.target, Domain.ARBITRUM_ONE, Provider.CCTP_V2, DISALLOWED);

    expect(await rebalancer.getAllRoutes()).to.deep.equal([
      [liquidityPool.target, liquidityPool2.target],
      [Domain.BASE, Domain.BASE],
      [Provider.LOCAL, Provider.LOCAL],
    ]);

    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP_V2)).to.be.false;
    expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.AVALANCHE, Provider.CCTP_V2)).to.be.false;
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      5n * USDC,
      liquidityPool,
      liquidityPool,
      Domain.ARBITRUM_ONE,
      Provider.CCTP_V2,
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

  it("Should not allow others to process rebalance", async function () {
    const {rebalancer, usdc, USDC, liquidityPool, user} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(rebalancer.connect(user).processRebalance(liquidityPool, Provider.CCTP_V2, extraData))
      .to.be.revertedWithCustomError(rebalancer, "AccessControlUnauthorizedAccount");
  });

  it("Should revert CCTP V2 initiate if TokenMessenger is zero address", async function () {
    const {deployer, admin, rebalanceUser, usdc, USDC, liquidityPool,
    } = await loadFixture(deployAll);

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerNoCCTPV2", {},
        Domain.BASE, usdc, usdc, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [liquidityPool, liquidityPool], [Domain.BASE, Domain.ARBITRUM_ONE], [Provider.LOCAL, Provider.CCTP_V2],
      allRemoteDomains(Domain.BASE)
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
      cctpV2TokenMessenger,
    } = await loadFixture(deployAll);

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerNoCCTPV2Transmitter", {},
        Domain.BASE, usdc, usdc, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        cctpV2TokenMessenger, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [liquidityPool, liquidityPool], [Domain.BASE, Domain.ARBITRUM_ONE], [Provider.LOCAL, Provider.CCTP_V2],
      allRemoteDomains(Domain.BASE)
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

  it("Should revert local rebalance if native currency is sent along", async function () {
    const {rebalancer, usdc, USDC, rebalanceUser, liquidityPool, liquidityPool2
    } = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool, 10n * USDC);
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC,
      liquidityPool,
      liquidityPool2,
      Domain.BASE,
      Provider.LOCAL,
      "0x",
      {value: 1n}
    )).to.be.revertedWithCustomError(rebalancer, "NotPayable()");
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
      liquidityPool, Provider.ACROSS, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.STARGATE, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.EVERCLEAR_DEPRECATED, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.SUPERCHAIN_STANDARD_BRIDGE, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      liquidityPool, Provider.ARBITRUM_GATEWAY, "0x"
    )).to.be.revertedWithCustomError(rebalancer, "UnsupportedProvider()");
  });

  it("Should allow rebalancer to process rebalance via LOCAL", async function () {
    const {rebalancer, usdc, USDC, rebalanceUser, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(rebalancer, 4n * USDC);

    const tx = rebalancer.connect(rebalanceUser).processRebalance(liquidityPool, Provider.LOCAL, "0x");
    await expect(tx)
      .to.emit(rebalancer, "ProcessRebalance")
      .withArgs(4n * USDC, liquidityPool.target, Provider.LOCAL);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, liquidityPool.target, 4n * USDC);
    await expect(tx)
      .to.emit(liquidityPool, "Deposit");

    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(4n * USDC);
  });

  it("Should revert processRebalance LOCAL if balance is zero", async function () {
    const {rebalancer, rebalanceUser, liquidityPool} = await loadFixture(deployAll);

    await expect(rebalancer.connect(rebalanceUser).processRebalance(liquidityPool, Provider.LOCAL, "0x"))
      .to.be.revertedWithCustomError(rebalancer, "ZeroAmount");
  });

  it("Should swap USDCe to USDC before bridging from Gnosis to Ethereum", async function () {
    const {
      USDC, usdc, rebalanceUser, liquidityPool, admin, deployer,
    } = await loadFixture(deployAll);

    // usdc2 = USDCe (ASSETS on Gnosis Chain); usdc = USDCxDAI (the bridgeable token)
    const usdc2 = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const usdceSwap = (
      await deploy("TestUSDCTransmuter", deployer, {}, usdc2.target, usdc.target)
    ) as TestUSDCTransmuter;
    const gnosisOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    // gnosisPool has usdc2 as ASSETS — required for _setRoute LOCAL check on Gnosis Chain
    const gnosisPool = (await deploy(
      "TestLiquidityPool", deployer, {}, usdc2, deployer, networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;
    const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerGnosis", {},
        Domain.GNOSIS_CHAIN, usdc2, usdc2, gnosisOmnibridge, usdc, usdceSwap, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      // gnosisPool: LOCAL route on GNOSIS_CHAIN (source); liquidityPool: destination route on ETHEREUM
      [gnosisPool, liquidityPool], [Domain.GNOSIS_CHAIN, Domain.ETHEREUM],
      [Provider.LOCAL, Provider.GNOSIS_OMNIBRIDGE],
      allRemoteDomains(Domain.GNOSIS_CHAIN)
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancerGnosis", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    await gnosisPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    const destinationRebalancerAddress = stubDestinationThisAddress(Domain.ETHEREUM);

    // Fund source pool with USDCe and swap contract with USDCxDAI
    await usdc2.transfer(gnosisPool, 10n * USDC);
    await usdc.transfer(usdceSwap, 10n * USDC);

    const tx = rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC, gnosisPool, liquidityPool, Domain.ETHEREUM, Provider.GNOSIS_OMNIBRIDGE, "0x"
    );
    await expect(tx)
      .to.emit(rebalancer, "InitiateRebalance")
      .withArgs(4n * USDC, gnosisPool.target, liquidityPool.target, Domain.ETHEREUM, Provider.GNOSIS_OMNIBRIDGE);
    // Event uses USDCxDAI (after swap), not USDCe; receiver is always the Rebalancer on the destination chain
    await expect(tx)
      .to.emit(rebalancer, "GnosisOmnibridgeTransferInitiated")
      .withArgs(usdc.target, bytes32ToToken(destinationRebalancerAddress), 4n * USDC);
    // USDCe withdrawn from gnosisPool to rebalancer
    await expect(tx)
      .to.emit(usdc2, "Transfer")
      .withArgs(gnosisPool.target, rebalancer.target, 4n * USDC);
    // USDCe moved from rebalancer to swap contract
    await expect(tx)
      .to.emit(usdc2, "Transfer")
      .withArgs(rebalancer.target, usdceSwap.target, 4n * USDC);
    // USDCxDAI moved from rebalancer to bridge
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, gnosisOmnibridge.target, 4n * USDC);

    expect(await usdc2.balanceOf(gnosisPool)).to.equal(6n * USDC);
    expect(await usdc2.balanceOf(usdceSwap)).to.equal(4n * USDC);
    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
    expect(await usdc.balanceOf(gnosisOmnibridge)).to.equal(4n * USDC);
    expect(await usdc.balanceOf(usdceSwap)).to.equal(6n * USDC);
  });

  it("Should allow rebalancer to process rebalance via Gnosis Omnibridge on Gnosis Chain", async function () {
    const {
      USDC, usdc, rebalanceUser, admin, deployer,
    } = await loadFixture(deployAll);

    // usdc2 = USDCe (ASSETS on Gnosis Chain); usdc = USDCxDAI (delivered by the bridge)
    const usdc2 = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const usdceSwap = (
      await deploy("TestUSDCTransmuter", deployer, {}, usdc2.target, usdc.target)
    ) as TestUSDCTransmuter;
    const gnosisOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    // gnosisPool has usdc2 as ASSETS — required for _setRoute LOCAL check on Gnosis Chain
    const gnosisPool = (await deploy(
      "TestLiquidityPool", deployer, {}, usdc2, deployer, networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;
    const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerGnosis2", {},
        Domain.GNOSIS_CHAIN, usdc2, usdc2, gnosisOmnibridge, usdc, usdceSwap, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [gnosisPool], [Domain.GNOSIS_CHAIN], [Provider.LOCAL],
      allRemoteDomains(Domain.GNOSIS_CHAIN)
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancerGnosis2", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    await gnosisPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);

    // Simulate bridge delivery: USDCxDAI arrives at rebalancer; swap contract holds USDCe
    await usdc.transfer(rebalancer, 4n * USDC);
    await usdc2.transfer(usdceSwap, 10n * USDC);

    const extraData = AbiCoder.defaultAbiCoder().encode(["uint256"], [4n * USDC]);
    const tx = rebalancer.connect(rebalanceUser).processRebalance(
      gnosisPool, Provider.GNOSIS_OMNIBRIDGE, extraData
    );
    await expect(tx)
      .to.emit(rebalancer, "ProcessRebalance")
      .withArgs(4n * USDC, gnosisPool.target, Provider.GNOSIS_OMNIBRIDGE);
    // USDCxDAI pulled from rebalancer into swap contract
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, usdceSwap.target, 4n * USDC);
    // USDCe delivered from swap contract to rebalancer
    await expect(tx)
      .to.emit(usdc2, "Transfer")
      .withArgs(usdceSwap.target, rebalancer.target, 4n * USDC);
    // USDCe delivered from rebalancer to pool
    await expect(tx)
      .to.emit(usdc2, "Transfer")
      .withArgs(rebalancer.target, gnosisPool.target, 4n * USDC);
    await expect(tx)
      .to.emit(gnosisPool, "Deposit");

    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
    expect(await usdc2.balanceOf(gnosisPool)).to.equal(4n * USDC);
    expect(await usdc2.balanceOf(usdceSwap)).to.equal(6n * USDC);
    expect(await usdc.balanceOf(usdceSwap)).to.equal(4n * USDC);
  });

  it("Should swap all USDCxDAI but deposit only extraData amount to pool", async function () {
    const {
      USDC, usdc, rebalanceUser, admin, deployer,
    } = await loadFixture(deployAll);

    const usdc2 = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const usdceSwap = (
      await deploy("TestUSDCTransmuter", deployer, {}, usdc2.target, usdc.target)
    ) as TestUSDCTransmuter;
    const gnosisOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const gnosisPool = (await deploy(
      "TestLiquidityPool", deployer, {}, usdc2, deployer, networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;
    const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerGnosis3", {},
        Domain.GNOSIS_CHAIN, usdc2, usdc2, gnosisOmnibridge, usdc, usdceSwap, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [gnosisPool], [Domain.GNOSIS_CHAIN], [Provider.LOCAL],
      allRemoteDomains(Domain.GNOSIS_CHAIN)
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancerGnosis3", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    await gnosisPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);

    // 10 USDCxDAI delivered, but only 4 is the intended deposit amount
    await usdc.transfer(rebalancer, 10n * USDC);
    await usdc2.transfer(usdceSwap, 10n * USDC);

    const extraData = AbiCoder.defaultAbiCoder().encode(["uint256"], [4n * USDC]);
    const tx = rebalancer.connect(rebalanceUser).processRebalance(
      gnosisPool, Provider.GNOSIS_OMNIBRIDGE, extraData
    );
    await expect(tx)
      .to.emit(rebalancer, "ProcessRebalance")
      .withArgs(4n * USDC, gnosisPool.target, Provider.GNOSIS_OMNIBRIDGE);
    // ALL 10 USDCxDAI swapped to USDCe
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, usdceSwap.target, 10n * USDC);
    await expect(tx)
      .to.emit(usdc2, "Transfer")
      .withArgs(usdceSwap.target, rebalancer.target, 10n * USDC);
    // Only 4 USDCe delivered to pool; 6 stays in rebalancer
    await expect(tx)
      .to.emit(usdc2, "Transfer")
      .withArgs(rebalancer.target, gnosisPool.target, 4n * USDC);
    await expect(tx)
      .to.emit(gnosisPool, "Deposit");

    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
    expect(await usdc2.balanceOf(rebalancer)).to.equal(6n * USDC);
    expect(await usdc2.balanceOf(gnosisPool)).to.equal(4n * USDC);
    expect(await usdc2.balanceOf(usdceSwap)).to.equal(0n);
    expect(await usdc.balanceOf(usdceSwap)).to.equal(10n * USDC);
  });

  it("Should revert processRebalance if GNOSIS_USDCXDAI balance is insufficient", async function () {
    const {
      USDC, usdc, rebalanceUser, admin, deployer,
    } = await loadFixture(deployAll);

    const usdc2 = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const usdceSwap = (
      await deploy("TestUSDCTransmuter", deployer, {}, usdc2.target, usdc.target)
    ) as TestUSDCTransmuter;
    const gnosisOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const gnosisPool = (await deploy(
      "TestLiquidityPool", deployer, {}, usdc2, deployer, networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "RebalancerGnosis4", {},
        Domain.GNOSIS_CHAIN, usdc2, usdc2, gnosisOmnibridge, usdc, usdceSwap, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [gnosisPool], [Domain.GNOSIS_CHAIN], [Provider.LOCAL],
      allRemoteDomains(Domain.GNOSIS_CHAIN)
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancerGnosis4", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;

    // No USDCxDAI in rebalancer — balance is 0 but amount in extraData is 4
    const extraData = AbiCoder.defaultAbiCoder().encode(["uint256"], [4n * USDC]);
    await expect(rebalancer.connect(rebalanceUser).processRebalance(
      gnosisPool, Provider.GNOSIS_OMNIBRIDGE, extraData
    )).to.be.revertedWithCustomError(rebalancer, "InsufficientBalance");
  });

  it("Should allow rebalancer to initiate rebalance via Gnosis Omnibridge from Ethereum to Gnosis", async function () {
    const {
      usdc, USDC, rebalanceUser, liquidityPool, admin, deployer,
    } = await loadFixture(deployAll);
    const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "Rebalancer2", {},
        Domain.ETHEREUM, usdc, usdc, ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [liquidityPool, liquidityPool],
      [Domain.ETHEREUM, Domain.GNOSIS_CHAIN],
      [Provider.LOCAL, Provider.GNOSIS_OMNIBRIDGE],
      allRemoteDomains(Domain.ETHEREUM)
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancer2", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
    await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    const destinationRebalancerAddress = stubDestinationThisAddress(Domain.GNOSIS_CHAIN);

    await usdc.transfer(liquidityPool, 10n * USDC);

    const tx = rebalancer.connect(rebalanceUser).initiateRebalance(
      4n * USDC, liquidityPool, liquidityPool, Domain.GNOSIS_CHAIN, Provider.GNOSIS_OMNIBRIDGE, "0x"
    );
    await expect(tx)
      .to.emit(rebalancer, "InitiateRebalance")
      .withArgs(4n * USDC, liquidityPool.target, liquidityPool.target, Domain.GNOSIS_CHAIN, Provider.GNOSIS_OMNIBRIDGE);
    await expect(tx)
      .to.emit(rebalancer, "GnosisOmnibridgeTransferInitiated")
      .withArgs(usdc.target, bytes32ToToken(destinationRebalancerAddress), 4n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, ethereumOmnibridge.target, 4n * USDC);

    expect(await usdc.balanceOf(liquidityPool)).to.equal(6n * USDC);
    expect(await usdc.balanceOf(ethereumOmnibridge)).to.equal(4n * USDC);
  });

  it("Should allow rebalancer to process rebalance via Gnosis Omnibridge", async function () {
    const {
      usdc, USDC, rebalanceUser, liquidityPool, admin, deployer,
    } = await loadFixture(deployAll);

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "Rebalancer2", {},
        Domain.ETHEREUM, usdc, usdc, ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.LOCAL],
      allRemoteDomains(Domain.ETHEREUM)
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancer2", {},
      rebalancerImpl, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;

    await usdc.transfer(ethereumAmb, 4n * USDC);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, rebalancer.target, 4n * USDC]
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
      .withArgs(ethereumAmb.target, rebalancer.target, 4n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, liquidityPool.target, 4n * USDC);
    await expect(tx)
      .to.emit(liquidityPool, "Deposit");

    expect(await usdc.balanceOf(liquidityPool)).to.equal(4n * USDC);
    expect(await usdc.balanceOf(rebalancer)).to.equal(0n);
  });

  it("Should revert rebalancer processRebalance via Gnosis Omnibridge if arbitrary token received", async function () {
    const {
      usdc, USDC, rebalanceUser, liquidityPool, admin, deployer,
    } = await loadFixture(deployAll);

    const ethereumOmnibridge = (await deploy("TestGnosisOmnibridge", deployer, {})) as TestGnosisOmnibridge;
    const ethereumAmb = (await deploy("TestGnosisAMB", deployer, {})) as TestGnosisAMB;

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "Rebalancer2", {},
        Domain.ETHEREUM, usdc, usdc, ethereumOmnibridge, ZERO_ADDRESS, ZERO_ADDRESS, ethereumAmb, ZERO_ADDRESS,
        ZERO_ADDRESS,
        ZERO_ADDRESS, ZERO_ADDRESS,
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin, rebalanceUser,
      [liquidityPool],
      [Domain.ETHEREUM],
      [Provider.LOCAL],
      allRemoteDomains(Domain.ETHEREUM)
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
      [usdc2.target, rebalancer.target, 4n * USDC]
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

  describe("This addresses", function () {
    it("Should return this Rebalancer's own address for the local domain", async function () {
      const {rebalancer} = await loadFixture(deployAll);

      expect(await rebalancer.getThisAddress(Domain.BASE)).to.equal(addressToBytes32(rebalancer.target));
    });

    it("Should return the configured address for a remote domain set at initialize time", async function () {
      const {rebalancer} = await loadFixture(deployAll);

      expect(await rebalancer.getThisAddress(Domain.ARBITRUM_ONE)).to.equal(
        stubDestinationThisAddress(Domain.ARBITRUM_ONE)
      );
      expect(await rebalancer.getThisAddress(Domain.ETHEREUM)).to.equal(stubDestinationThisAddress(Domain.ETHEREUM));
    });

    it("Should return zero for a domain that was never configured", async function () {
      const {deployer, admin, rebalanceUser, usdc, liquidityPool,
        cctpV2TokenMessenger, cctpV2MessageTransmitter,
      } = await loadFixture(deployAll);
      const rebalancerImpl = (
        await deployX("Rebalancer", deployer, "RebalancerNoThisAddresses", {},
          Domain.BASE, usdc, usdc, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
          cctpV2TokenMessenger, cctpV2MessageTransmitter,
        )
      ) as Rebalancer;
      const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
        admin, rebalanceUser, [liquidityPool], [Domain.BASE], [Provider.LOCAL], []
      )).data;
      const rebalancerProxy = (await deployX(
        "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancerNoThisAddresses", {},
        rebalancerImpl, admin, rebalancerInit
      )) as TransparentUpgradeableProxy;
      const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;

      expect(await rebalancer.getThisAddress(Domain.ARBITRUM_ONE)).to.equal(ZERO_BYTES32);
      expect(await rebalancer.getThisAddress(Domain.BASE)).to.equal(addressToBytes32(rebalancer.target));
    });

    it("Should revert initiateRebalance if destination domain has no this address set", async function () {
      const {deployer, admin, rebalanceUser, usdc, USDC, liquidityPool,
        cctpV2TokenMessenger, cctpV2MessageTransmitter,
      } = await loadFixture(deployAll);
      const rebalancerImpl = (
        await deployX("Rebalancer", deployer, "RebalancerNoThisAddresses2", {},
          Domain.BASE, usdc, usdc, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS,
          cctpV2TokenMessenger, cctpV2MessageTransmitter,
        )
      ) as Rebalancer;
      const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
        admin, rebalanceUser,
        [liquidityPool, liquidityPool], [Domain.BASE, Domain.ARBITRUM_ONE], [Provider.LOCAL, Provider.CCTP_V2],
        []
      )).data;
      const rebalancerProxy = (await deployX(
        "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancerNoThisAddresses2", {},
        rebalancerImpl, admin, rebalancerInit
      )) as TransparentUpgradeableProxy;
      const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy, deployer)) as Rebalancer;
      await liquidityPool.grantRole(toBytes32("LIQUIDITY_ADMIN_ROLE"), rebalancer);

      await usdc.transfer(liquidityPool, 10n * USDC);
      expect(await rebalancer.isRouteAllowed(liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP_V2)).to.be.true;
      await expect(rebalancer.connect(rebalanceUser).initiateRebalance(
        4n * USDC, liquidityPool, liquidityPool, Domain.ARBITRUM_ONE, Provider.CCTP_V2, "0x"
      )).to.be.revertedWithCustomError(rebalancer, "DestinationDomainNotSupported()");
    });

    it("Should allow admin to set and update this addresses, emitting SetThisAddress", async function () {
      const {rebalancer, admin} = await loadFixture(deployAll);
      const addressA = encodeBytes32String("someprettylongaddresshere");
      const addressB = addressToBytes32(`0x${"22".repeat(20)}`);

      const tx = rebalancer.connect(admin).setThisAddresses([
        {domain: Domain.WORLD_CHAIN, thisAddress: addressA},
        {domain: Domain.HYPER_EVM, thisAddress: addressB},
      ]);
      await expect(tx).to.emit(rebalancer, "SetThisAddress").withArgs(Domain.WORLD_CHAIN, addressA);
      await expect(tx).to.emit(rebalancer, "SetThisAddress").withArgs(Domain.HYPER_EVM, addressB);
      expect(await rebalancer.getThisAddress(Domain.WORLD_CHAIN)).to.equal(addressA);
      expect(await rebalancer.getThisAddress(Domain.HYPER_EVM)).to.equal(addressB);

      const updateTx = rebalancer.connect(admin).setThisAddresses([
        {domain: Domain.WORLD_CHAIN, thisAddress: addressB},
      ]);
      await expect(updateTx).to.emit(rebalancer, "SetThisAddress").withArgs(Domain.WORLD_CHAIN, addressB);
      expect(await rebalancer.getThisAddress(Domain.WORLD_CHAIN)).to.equal(addressB);
      expect(await rebalancer.getThisAddress(Domain.HYPER_EVM)).to.equal(addressB);
    });

    it("Should not allow others to set this addresses", async function () {
      const {rebalancer, rebalanceUser} = await loadFixture(deployAll);

      await expect(rebalancer.connect(rebalanceUser).setThisAddresses([
        {domain: Domain.WORLD_CHAIN, thisAddress: addressToBytes32(rebalancer.target)},
      ])).to.be.revertedWithCustomError(rebalancer, "AccessControlUnauthorizedAccount(address,bytes32)");
    });

    it("Should not allow setting this address for the local domain", async function () {
      const {rebalancer, admin} = await loadFixture(deployAll);

      await expect(rebalancer.connect(admin).setThisAddresses([
        {domain: Domain.BASE, thisAddress: addressToBytes32(rebalancer.target)},
      ])).to.be.revertedWithCustomError(rebalancer, "UnsupportedDomain()");
    });
  });
});
