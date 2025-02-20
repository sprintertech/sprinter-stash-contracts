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
  ProviderSolidity as Provider, DomainSolidity as Domain, ZERO_ADDRESS, ZERO_BYTES32,
  DEFAULT_ADMIN_ROLE,
} from "../scripts/common";
import {
  TestUSDC, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, Rebalancer, TestCCTPTokenMessenger, TestCCTPMessageTransmitter,
} from "../typechain-types";

const ALLOWED = true;
const DISALLOWED = false;

describe("Rebalancer", function () {
  const deployAll = async () => {
    const [deployer, admin, rebalanceUser, user] = await hre.ethers.getSigners();

    const REBALANCER_ROLE = toBytes32("REBALANCER_ROLE");
    const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const liquidityPool = (
      await deploy("TestLiquidityPool", deployer, {}, usdc.target, deployer)
    ) as TestLiquidityPool;
    const cctpTokenMessenger = (await deploy("TestCCTPTokenMessenger", deployer, {})) as TestCCTPTokenMessenger;
    const cctpMessageTransmitter = (
      await deploy("TestCCTPMessageTransmitter", deployer, {})
    ) as TestCCTPMessageTransmitter;

    const USDC = 10n ** (await usdc.decimals());

    const rebalancerImpl = (
      await deployX("Rebalancer", deployer, "Rebalancer", {},
        liquidityPool.target, cctpTokenMessenger.target, cctpMessageTransmitter.target
      )
    ) as Rebalancer;
    const rebalancerInit = (await rebalancerImpl.initialize.populateTransaction(
      admin.address, rebalanceUser.address, [Domain.ETHEREUM, Domain.ARBITRUM_ONE], [Provider.CCTP, Provider.CCTP]
    )).data;
    const rebalancerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancer", {},
      rebalancerImpl.target, admin, rebalancerInit
    )) as TransparentUpgradeableProxy;
    const rebalancer = (await getContractAt("Rebalancer", rebalancerProxy.target, deployer)) as Rebalancer;
    const rebalancerProxyAdminAddress = await getCreateAddress(rebalancerProxy, 1);
    const rebalancerAdmin = (await getContractAt("ProxyAdmin", rebalancerProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer.target);

    return {
      deployer, admin, rebalanceUser, user, usdc,
      USDC, liquidityPool, rebalancer, rebalancerProxy, rebalancerAdmin,
      cctpTokenMessenger, cctpMessageTransmitter, REBALANCER_ROLE, DEFAULT_ADMIN_ROLE,
    };
  };

  it("Should have default values", async function () {
    const {liquidityPool, rebalancer, usdc, REBALANCER_ROLE, DEFAULT_ADMIN_ROLE,
      cctpTokenMessenger, cctpMessageTransmitter, admin, rebalanceUser, deployer,
    } = await loadFixture(deployAll);

    expect(await rebalancer.LIQUIDITY_POOL()).to.equal(liquidityPool.target);
    expect(await rebalancer.COLLATERAL()).to.equal(usdc.target);
    expect(await rebalancer.CCTP_TOKEN_MESSENGER()).to.equal(cctpTokenMessenger.target);
    expect(await rebalancer.CCTP_MESSAGE_TRANSMITTER()).to.equal(cctpMessageTransmitter.target);
    expect(await rebalancer.REBALANCER_ROLE()).to.equal(REBALANCER_ROLE);
    expect(await rebalancer.isRouteAllowed(Domain.ETHEREUM, Provider.CCTP)).to.be.true;
    expect(await rebalancer.isRouteAllowed(Domain.AVALANCHE, Provider.CCTP)).to.be.false;
    expect(await rebalancer.isRouteAllowed(Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    expect(await rebalancer.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    expect(await rebalancer.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.false;
    expect(await rebalancer.hasRole(REBALANCER_ROLE, rebalanceUser.address)).to.be.true;
    expect(await rebalancer.hasRole(REBALANCER_ROLE, deployer.address)).to.be.false;
    expect(await rebalancer.domainCCTP(Domain.ETHEREUM)).to.equal(0n);
    expect(await rebalancer.domainCCTP(Domain.AVALANCHE)).to.equal(1n);
    expect(await rebalancer.domainCCTP(Domain.OP_MAINNET)).to.equal(2n);
    expect(await rebalancer.domainCCTP(Domain.ARBITRUM_ONE)).to.equal(3n);
    expect(await rebalancer.domainCCTP(Domain.BASE)).to.equal(6n);
    expect(await rebalancer.domainCCTP(Domain.POLYGON_MAINNET)).to.equal(7n);

    await expect(rebalancer.connect(admin).initialize(admin.address, rebalanceUser.address, [], [])).to.be.reverted;
  });

  it("Should allow admin to enable routes", async function () {
    const {rebalancer, usdc, USDC, admin, rebalanceUser,
      liquidityPool
    } = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool.target, 10n * USDC);
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(5n * USDC, Domain.AVALANCHE, Provider.CCTP, "0x"))
      .to.be.revertedWithCustomError(rebalancer, "RouteDenied()");
    const tx = rebalancer.connect(admin).setRoute([Domain.AVALANCHE], [Provider.CCTP], ALLOWED);
    await expect(tx)
      .to.emit(rebalancer, "SetRoute")
      .withArgs(Domain.AVALANCHE, Provider.CCTP, ALLOWED); 

    expect(await rebalancer.isRouteAllowed(Domain.ETHEREUM, Provider.CCTP)).to.be.true;
    expect(await rebalancer.isRouteAllowed(Domain.AVALANCHE, Provider.CCTP)).to.be.true;
    expect(await rebalancer.isRouteAllowed(Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    await rebalancer.connect(rebalanceUser).initiateRebalance(5n * USDC, Domain.AVALANCHE, Provider.CCTP, "0x");   
  });

  it("Should allow admin to disable routes", async function () {
    const {rebalancer, usdc, USDC, admin, rebalanceUser, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool.target, 10n * USDC);
    await rebalancer.connect(rebalanceUser).initiateRebalance(5n * USDC, Domain.ETHEREUM, Provider.CCTP, "0x"); 
    const tx = rebalancer.connect(admin).setRoute([Domain.ETHEREUM], [Provider.CCTP], DISALLOWED);
    await expect(tx)
      .to.emit(rebalancer, "SetRoute")
      .withArgs(Domain.ETHEREUM, Provider.CCTP, DISALLOWED); 

    expect(await rebalancer.isRouteAllowed(Domain.ETHEREUM, Provider.CCTP)).to.be.false;
    expect(await rebalancer.isRouteAllowed(Domain.AVALANCHE, Provider.CCTP)).to.be.false;
    expect(await rebalancer.isRouteAllowed(Domain.ARBITRUM_ONE, Provider.CCTP)).to.be.true;
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(5n * USDC, Domain.ETHEREUM, Provider.CCTP, "0x"))
      .to.be.revertedWithCustomError(rebalancer, "RouteDenied()");
  });

  it("Should not allow others to enable routes", async function () {
    const {rebalancer, rebalanceUser} = await loadFixture(deployAll);

    await expect(rebalancer.connect(rebalanceUser).setRoute([Domain.AVALANCHE], [Provider.CCTP], ALLOWED))
      .to.be.revertedWithCustomError(rebalancer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should not allow others to disable routes", async function () {
    const {rebalancer, rebalanceUser} = await loadFixture(deployAll);

    await expect(rebalancer.connect(rebalanceUser).setRoute([Domain.ETHEREUM], [Provider.CCTP], DISALLOWED))
      .to.be.revertedWithCustomError(rebalancer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should allow rebalancer to initiate rebalance", async function () {
    const {rebalancer, usdc, USDC, rebalanceUser, liquidityPool,
      cctpTokenMessenger
    } = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool.target, 10n * USDC);
    const tx = rebalancer.connect(rebalanceUser).initiateRebalance(4n * USDC, Domain.ETHEREUM, Provider.CCTP, "0x");
    await expect(tx)
      .to.emit(rebalancer, "InitiateRebalance")
      .withArgs(4n * USDC, Domain.ETHEREUM, Provider.CCTP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, rebalancer.target, 4n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(rebalancer.target, cctpTokenMessenger.target, 4n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(cctpTokenMessenger.target, ZERO_ADDRESS, 4n * USDC);

    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(6n * USDC);
    expect(await usdc.balanceOf(rebalancer.target)).to.equal(0n);
  });

  it("Should not allow others to initiate rebalance", async function () {
    const {rebalancer, usdc, USDC, admin, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool.target, 10n * USDC);
    await expect(rebalancer.connect(admin).initiateRebalance(4n * USDC, Domain.ETHEREUM, Provider.CCTP, "0x"))
      .to.be.revertedWithCustomError(rebalancer, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should not allow rebalancer to initiate rebalance with 0 amount", async function () {
    const {rebalancer, rebalanceUser, usdc, USDC, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool.target, 10n * USDC);
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(0n, Domain.ETHEREUM, Provider.CCTP, "0x"))
      .to.be.revertedWithCustomError(rebalancer, "ZeroAmount()");
  });

  it("Should not allow rebalancer to initiate rebalance with disabled route", async function () {
    const {rebalancer, rebalanceUser, usdc, USDC, liquidityPool} = await loadFixture(deployAll);

    await usdc.transfer(liquidityPool.target, 10n * USDC);
    await expect(rebalancer.connect(rebalanceUser).initiateRebalance(4n * USDC, Domain.AVALANCHE, Provider.CCTP, "0x"))
      .to.be.revertedWithCustomError(rebalancer, "RouteDenied()");
  });

  it("Should allow anyone to process rebalance", async function () {
    const {rebalancer, usdc, USDC, liquidityPool, user} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    const tx = rebalancer.connect(user).processRebalance(Provider.CCTP, extraData);
    await expect(tx)
      .to.emit(rebalancer, "ProcessRebalance")
      .withArgs(Provider.CCTP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(ZERO_ADDRESS, liquidityPool.target, 4n * USDC);
    await expect(tx)
      .to.emit(liquidityPool, "Deposit");

    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(4n * USDC);
    expect(await usdc.balanceOf(rebalancer.target)).to.equal(0n);
  });

  it("Should revert if CCTP receiveMessage reverts", async function () {
    const {rebalancer, usdc, USDC, liquidityPool, user} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [false, true]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(rebalancer.connect(user).processRebalance(Provider.CCTP, extraData))
      .to.be.reverted;
  });

  it("Should revert if CCTP receiveMessage returned false", async function () {
    const {rebalancer, usdc, USDC, liquidityPool, user} = await loadFixture(deployAll);

    const message = AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [usdc.target, liquidityPool.target, 4n * USDC]
    );
    const signature = AbiCoder.defaultAbiCoder().encode(["bool", "bool"], [true, false]);
    const extraData = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [message, signature]);
    await expect(rebalancer.connect(user).processRebalance(Provider.CCTP, extraData))
      .to.be.revertedWithCustomError(rebalancer, "ProcessFailed()");
  });
});
