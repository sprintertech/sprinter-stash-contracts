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

    const USDC = 10n ** (await usdc.decimals());

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "Rebalancer", {},
        Domain.BASE, usdc, cctpTokenMessenger, cctpMessageTransmitter
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin,
      rebalanceUser,
      [liquidityPool, liquidityPool2, liquidityPool, liquidityPool],
      [Domain.BASE, Domain.BASE, Domain.ETHEREUM, Domain.ARBITRUM_ONE],
      [Provider.LOCAL, Provider.LOCAL, Provider.CCTP, Provider.CCTP]
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
      cctpTokenMessenger, cctpMessageTransmitter, REBALANCER_ROLE, DEFAULT_ADMIN_ROLE,
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
      [liquidityPool.target, liquidityPool.target, liquidityPool.target, liquidityPool2.target],
      [Domain.ETHEREUM, Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.CCTP, Provider.LOCAL, Provider.LOCAL],
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
      [liquidityPool.target, liquidityPool.target, liquidityPool.target, liquidityPool.target, liquidityPool2.target],
      [Domain.ETHEREUM, Domain.AVALANCHE, Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.CCTP, Provider.CCTP, Provider.LOCAL, Provider.LOCAL],
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
      [liquidityPool.target, liquidityPool.target, liquidityPool2.target],
      [Domain.ARBITRUM_ONE, Domain.BASE, Domain.BASE],
      [Provider.CCTP, Provider.LOCAL, Provider.LOCAL],
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
});
