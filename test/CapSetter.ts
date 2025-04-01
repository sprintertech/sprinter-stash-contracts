import {
  loadFixture, time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {MaxUint256, getBigInt} from "ethers";
import {
  getCreateAddress, getDeployXAddressBase, getContractAt, deploy, deployX, toBytes32,
} from "./helpers";
import {DEFAULT_ADMIN_ROLE} from "../scripts/common";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, CapSetter,
} from "../typechain-types";

describe("CapSetter", function () {
  const deployAll = async () => {
    const [deployer, admin, user, user2, user3] = await hre.ethers.getSigners();

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const liquidityPool = (
      await deploy("TestLiquidityPool", deployer, {}, usdc.target, deployer)
    ) as TestLiquidityPool;

    const USDC = 10n ** (await usdc.decimals());

    const liquidityHubAddress = await getDeployXAddressBase(
      deployer,
      "TransparentUpgradeableProxyLiquidityHub3",
      false
    );
    const lpToken = (
      await deployX("SprinterUSDCLPShare", deployer, "SprinterUSDCLPShare3", {}, liquidityHubAddress)
    ) as SprinterUSDCLPShare;
    const LP = 10n ** (await lpToken.decimals());

    const liquidityHubImpl = (
      await deployX("LiquidityHub", deployer, "LiquidityHub3", {}, lpToken.target, liquidityPool.target)
    ) as LiquidityHub;
    const liquidityHubInit = (await liquidityHubImpl.initialize.populateTransaction(
      usdc.target, admin.address, admin.address, admin.address, getBigInt(MaxUint256) * USDC / LP)
    ).data;
    const liquidityHubProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyLiquidityHub3", {},
      liquidityHubImpl.target, admin, liquidityHubInit
    )) as TransparentUpgradeableProxy;
    const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress, deployer)) as LiquidityHub;
    const liquidityHubProxyAdminAddress = await getCreateAddress(liquidityHubProxy, 1);
    const liquidityHubAdmin = (await getContractAt("ProxyAdmin", liquidityHubProxyAdminAddress, admin)) as ProxyAdmin;

    const capSetter = (
      await deployX("CapSetter", deployer, "CapSetter", {}, admin.address, liquidityHub.target)
    ) as CapSetter;

    await liquidityHub.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, capSetter.target);

    return {deployer, admin, user, user2, user3, usdc, lpToken,
      liquidityHub, liquidityHubProxy, liquidityHubAdmin, USDC, LP, liquidityPool, capSetter};
  };

  it("Should have default values", async function () {
    const {capSetter, liquidityHub, admin} = await loadFixture(deployAll);

    expect(await capSetter.liquidityHub()).to.equal(liquidityHub.target);
    expect(await capSetter.owner()).to.equal(admin.address);
  });

  it("Should set assets limit for liquidity hub", async function () {
    const {capSetter, liquidityHub, admin} = await loadFixture(deployAll);

    const assetsLimitBefore = await liquidityHub.assetsLimit();
    const assetsLimit = assetsLimitBefore - 1n;
    await expect(capSetter.connect(admin).setCap(assetsLimit))
      .to.emit(liquidityHub, "AssetsLimitSet").withArgs(assetsLimitBefore, assetsLimit);
    expect(await liquidityHub.assetsLimit()).to.equal(assetsLimit);
  });

  it("Should revert if the caller is unauthorized", async function () {
    const {capSetter, user} = await loadFixture(deployAll);
    await expect(capSetter.connect(user).setCap(20n)).to.be.revertedWithCustomError(capSetter, "Unauthorized");
  });
});
