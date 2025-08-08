import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {Signature, resolveAddress, MaxUint256, getBigInt} from "ethers";
import {
  getCreateAddress, getDeployXAddressBase, getContractAt, deploy, deployX,
  toBytes32,
} from "./helpers";
import {ZERO_ADDRESS} from "../scripts/common";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool,
} from "../typechain-types";
import {networkConfig} from "../network.config";

const INCREASE = true;
const DECREASE = false;

describe("LiquidityHub", function () {
  const deployAll = async () => {
    const [deployer, admin, user, user2, user3] = await hre.ethers.getSigners();

    const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

    const usdc = (await deploy("TestUSDC", deployer)) as TestUSDC;
    const liquidityPool = (await deployX(
      "TestLiquidityPool",
      deployer,
      "TestLiquidityPool",
      {},
      usdc,
      deployer,
      networkConfig.BASE.WrappedNativeToken
    )) as TestLiquidityPool;

    const USDC = 10n ** (await usdc.decimals());

    const liquidityHubAddress = await getDeployXAddressBase(deployer, "TransparentUpgradeableProxyLiquidityHub", false);
    const lpToken = (
      await deployX("SprinterUSDCLPShare", deployer, "SprinterUSDCLPShare", {}, liquidityHubAddress)
    ) as SprinterUSDCLPShare;
    const LP = 10n ** (await lpToken.decimals());

    const liquidityHubImpl = (
      await deployX("LiquidityHub", deployer, "LiquidityHub", {}, lpToken, liquidityPool)
    ) as LiquidityHub;
    const liquidityHubInit = (await liquidityHubImpl.initialize.populateTransaction(
      usdc, admin, admin, admin, admin, getBigInt(MaxUint256) * USDC / LP)
    ).data;
    const liquidityHubProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyLiquidityHub", {},
      liquidityHubImpl, admin, liquidityHubInit
    )) as TransparentUpgradeableProxy;
    const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress, deployer)) as LiquidityHub;
    const liquidityHubProxyAdminAddress = await getCreateAddress(liquidityHubProxy, 1);
    const liquidityHubAdmin = (await getContractAt("ProxyAdmin", liquidityHubProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, liquidityHub);

    return {deployer, admin, user, user2, user3, usdc, lpToken, liquidityHubImpl,
      liquidityHub, liquidityHubProxy, liquidityHubAdmin, USDC, LP, liquidityPool};
  };

  it("Should have default values", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP, admin,
      liquidityHubImpl,
    } = await loadFixture(deployAll);

    expect(await liquidityHub.SHARES()).to.equal(lpToken.target);
    expect(await liquidityHub.LIQUIDITY_POOL()).to.equal(liquidityPool.target);
    expect(await liquidityHub.asset()).to.equal(usdc.target);
    expect(await liquidityHub.balanceOf(user)).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.allowance(user, user2)).to.equal(0n);
    expect(await liquidityHub.assetsLimit()).to.equal(getBigInt(MaxUint256) * USDC / LP);
    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(getBigInt(MaxUint256) * USDC / LP);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(getBigInt(MaxUint256) * USDC / LP * LP / USDC);

    await expect(liquidityHubImpl.connect(admin).initialize(
      usdc, admin, admin, admin, admin, getBigInt(MaxUint256) * USDC / LP)
    ).to.be.reverted;
    await expect(liquidityHub.connect(admin).initialize(
      usdc, admin, admin, admin, admin, getBigInt(MaxUint256) * USDC / LP)
    ).to.be.reverted;
    await expect(liquidityHub.name())
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.symbol())
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.decimals())
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.transfer(user, 1n))
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.approve(user, 1n))
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.transferFrom(user, user2, 1n))
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
  });

  it("Should not allow to deploy or init with invalid values", async function () {
    const {
      lpToken, liquidityHub, usdc, liquidityPool, USDC, LP, admin, deployer
    } = await loadFixture(deployAll);

    await expect(deploy("LiquidityHub", deployer, {}, ZERO_ADDRESS, liquidityPool))
      .to.be.revertedWithCustomError(liquidityHub, "ZeroAddress()");
    await expect(deploy("LiquidityHub", deployer, {}, lpToken, ZERO_ADDRESS))
      .to.be.revertedWithCustomError(liquidityHub, "ZeroAddress()");
    const hubImpl = await deploy("LiquidityHub", deployer, {}, lpToken, liquidityPool);
    await expect(deploy(
      "TransparentUpgradeableProxy",
      deployer,
      {},
      hubImpl,
      admin,
      (await liquidityHub.initialize.populateTransaction(
        usdc, ZERO_ADDRESS, admin, admin, admin, 0n
      )).data
    )).to.be.revertedWithCustomError(liquidityHub, "ZeroAddress()");
    await expect(deploy(
      "TransparentUpgradeableProxy",
      deployer,
      {},
      hubImpl,
      admin,
      (await liquidityHub.initialize.populateTransaction(
        usdc, admin, ZERO_ADDRESS, admin, admin, 0n
      )).data
    )).to.be.revertedWithCustomError(liquidityHub, "ZeroAddress()");
    await expect(deploy(
      "TransparentUpgradeableProxy",
      deployer,
      {},
      hubImpl,
      admin,
      (await liquidityHub.initialize.populateTransaction(
        usdc, admin, admin, ZERO_ADDRESS, admin, 0n
      )).data
    )).to.be.revertedWithCustomError(liquidityHub, "ZeroAddress()");
    await expect(deploy(
      "TransparentUpgradeableProxy",
      deployer,
      {},
      hubImpl,
      admin,
      (await liquidityHub.initialize.populateTransaction(
        usdc, admin, admin, admin, ZERO_ADDRESS, 0n
      )).data
    )).to.be.revertedWithCustomError(liquidityHub, "ZeroAddress()");
    await expect(deploy(
      "TransparentUpgradeableProxy",
      deployer,
      {},
      hubImpl,
      admin,
      (await liquidityHub.initialize.populateTransaction(
        usdc, admin, admin, admin, admin, getBigInt(MaxUint256) * USDC / LP + 1n)
      ).data
    )).to.be.revertedWithCustomError(liquidityHub, "AssetsLimitIsTooBig()");
  });

  it("Should allow to deposit", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(10n * USDC, user);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 10n * USDC);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(10n * USDC);
  });

  it("Should allow to deposit twice", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(3n * USDC, user);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 3n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 3n * USDC);
    const tx2 = liquidityHub.connect(user).deposit(7n * USDC, user);
    await expect(tx2)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 7n * LP);
    await expect(tx2)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 7n * USDC);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(10n * USDC);
  });

  it("Should allow to mint", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    const tx = liquidityHub.connect(user).mint(10n * LP, user);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 10n * USDC);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(10n * USDC);
  });

  it("Should allow to withdraw", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    const tx = liquidityHub.connect(user).withdraw(10n * USDC, user, user);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, user.address, 10n * USDC);
    expect(await lpToken.balanceOf(user)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(user)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
  });

  it("Should allow to redeem", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    const tx = liquidityHub.connect(user).redeem(10n * LP, user, user);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, user.address, 10n * USDC);
    expect(await lpToken.balanceOf(user)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(user)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
  });

  it("Should allow to withdraw from another user", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, user3, USDC, LP,
      liquidityPool,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    await lpToken.connect(user).approve(user3, 10n * LP);
    const tx = liquidityHub.connect(user3).withdraw(10n * USDC, user2, user);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, user2.address, 10n * USDC);
    expect(await lpToken.allowance(user, user3)).to.equal(0n);
    expect(await lpToken.balanceOf(user)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(user2)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
  });

  it("Should expect to burn shares when shares.decimals > assets.decimals", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 1n);
    await usdc.connect(user).approve(liquidityHub, 1n);
    // Deposit 0.000010 USDC
    await liquidityHub.connect(user).deposit(1n, user);
    // Get shares
    expect(await lpToken.balanceOf(user)).to.equal(1n * (LP / USDC));
    // Burn all shares except 1
    await liquidityHub.connect(user).redeem(LP / USDC - 1n, user, user);
    expect(await liquidityHub.totalSupply()).to.equal(1n);
    expect(await liquidityHub.totalAssets()).to.equal(1n);
    expect(await usdc.balanceOf(user)).to.equal(0n);
  });

  it("Burning shares when shares.decimals > assets.decimals should be impractical", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    // Deposit 0.000010 USDC
    await liquidityHub.connect(user).deposit(10n, user);
    // Get shares
    expect(await lpToken.balanceOf(user)).to.equal(10n * (LP / USDC));
    expect(await liquidityHub.previewRedeem(1n * LP)).to.equal(1n * USDC);
    // Burn all shares except 10 (to get 1:1 with assets)
    let i = 0;
    let amount = await liquidityHub.previewWithdraw(1n);
    while(true) {
      amount = await liquidityHub.previewWithdraw(1n);
      if (amount <= 1) break;
      await liquidityHub.connect(user).redeem(amount - 1n, user, user);
      i++;
    }
    // It takes 268 iterations to burn all shares except 10
    expect(i).to.equal(268);
    expect(await lpToken.balanceOf(user)).to.equal(10);
    expect(await liquidityHub.previewRedeem(1n)).to.equal(1n);
    const tx = liquidityHub.connect(user).redeem(1n, user, user);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 1n);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, user.address, 1n);
  });

  it("Should allow to redeem from another user", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, user3, USDC, LP,
      liquidityPool,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    await lpToken.connect(user).approve(user3, 10n * LP);
    const tx = liquidityHub.connect(user3).redeem(10n * LP, user2, user);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, user2.address, 10n * USDC);
    expect(await lpToken.allowance(user, user3)).to.equal(0n);
    expect(await lpToken.balanceOf(user)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(user2)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
  });

  it("Should allow to deposit and withdraw multiple times", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(3n * USDC, user);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 3n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 3n * USDC);
    await liquidityHub.connect(user).withdraw(1n * USDC, user, user);
    const tx2 = liquidityHub.connect(user).deposit(7n * USDC, user);
    await expect(tx2)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 7n * LP);
    await expect(tx2)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 7n * USDC);
    await liquidityHub.connect(user).withdraw(4n * USDC, user, user);
    expect(await lpToken.balanceOf(user)).to.equal(5n * LP);
    expect(await lpToken.totalSupply()).to.equal(5n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(5n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(5n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(5n * LP);
    expect(await usdc.balanceOf(user)).to.equal(5n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(5n * USDC);
  });

  it("Should allow to do initial 0 assets adjustment", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(10n * USDC, user);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 10n * USDC);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(10n * USDC);

    await expect(liquidityHub.connect(admin).adjustTotalAssets(0n, INCREASE))
      .to.emit(liquidityHub, "TotalAssetsAdjustment")
      .withArgs(10n * USDC, 10n * USDC);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(10n * USDC);
  });

  it("Should not allow to do 0 assets adjustment on empty hub", async function () {
    const {liquidityHub, admin} = await loadFixture(deployAll);

    await expect(liquidityHub.connect(admin).adjustTotalAssets(0n, INCREASE))
      .to.be.revertedWithCustomError(liquidityHub, "EmptyHub");
  });

  it("Should not allow assets adjustment if hard limit is exceeded", async function () {
    const {
      liquidityHub, usdc, deployer, user, USDC, LP, admin,
    } = await loadFixture(deployAll);
    await usdc.connect(deployer).transfer(user, 20n * USDC);
    await usdc.connect(user).approve(liquidityHub, 20n * USDC);
    await liquidityHub.connect(user).deposit(20n * USDC, user);
    const assetsHardLimit = getBigInt(MaxUint256) / (LP / USDC) - 20n * USDC;
    await expect(liquidityHub.connect(admin).adjustTotalAssets(assetsHardLimit + 1n, INCREASE))
      .to.be.revertedWithCustomError(liquidityHub, "AssetsExceedHardLimit");
    await expect(liquidityHub.connect(admin).adjustTotalAssets(assetsHardLimit, INCREASE))
      .to.emit(liquidityHub, "TotalAssetsAdjustment")
      .withArgs(20n * USDC, assetsHardLimit + 20n * USDC);
  });

  it("Should not allow others to do assets adjustment", async function () {
    const {liquidityHub, user} = await loadFixture(deployAll);

    await expect(liquidityHub.connect(user).adjustTotalAssets(0n, INCREASE))
      .to.be.revertedWithCustomError(liquidityHub, "AccessControlUnauthorizedAccount(address,bytes32)");
  });

  it("Should allow deposits after adjustment with increased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 20n * USDC);
    await usdc.connect(deployer).transfer(user2, 40n * USDC);
    await usdc.connect(user).approve(liquidityHub, 20n * USDC);
    await usdc.connect(user2).approve(liquidityHub, 40n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(user2)).to.equal(20n * USDC);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(120n * USDC, INCREASE);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2);
    expect(await lpToken.balanceOf(user)).to.equal(12n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(24n * LP);
    expect(await lpToken.totalSupply()).to.equal(36n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(36n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(180n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(12n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(24n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(user2)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(60n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
  });

  it("Should process deposits after adjustment with decreased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 20n * USDC);
    await usdc.connect(deployer).transfer(user2, 40n * USDC);
    await usdc.connect(user).approve(liquidityHub, 20n * USDC);
    await usdc.connect(user2).approve(liquidityHub, 40n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(user2)).to.equal(20n * USDC);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(20n * USDC, DECREASE);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2);
    expect(await lpToken.balanceOf(user)).to.equal(40n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(80n * LP);
    expect(await lpToken.totalSupply()).to.equal(120n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(120n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(40n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(40n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(80n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(user2)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(60n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
  });

  it("Should allow withdrawals after adjustment with increased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(deployer).transfer(user2, 20n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    await usdc.connect(user2).approve(liquidityHub, 20n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(user2)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(12n * USDC, INCREASE);
    expect(await liquidityHub.totalAssets()).to.equal(42n * USDC);
    await liquidityHub.connect(user).redeem(5n * LP, user, user);
    await liquidityHub.connect(user2).redeem(10n * LP, user2, user2);
    expect(await lpToken.balanceOf(user)).to.equal(5n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(15n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(15n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(21n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(5n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user)).to.equal(7n * USDC);
    expect(await usdc.balanceOf(user2)).to.equal(14n * USDC);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(9n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
  });

  it("Should allow withdrawals after adjustment with decreased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(deployer).transfer(user2, 20n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    await usdc.connect(user2).approve(liquidityHub, 20n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(user2)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(27n * USDC, DECREASE);
    expect(await liquidityHub.totalAssets()).to.equal(3n * USDC);
    await liquidityHub.connect(user).redeem(10n * LP, user, user);
    await liquidityHub.connect(user2).redeem(20n * LP, user2, user2);
    expect(await lpToken.balanceOf(user)).to.equal(0n);
    expect(await lpToken.balanceOf(user2)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user)).to.equal(0n);
    expect(await liquidityHub.balanceOf(user2)).to.equal(0n);
    expect(await usdc.balanceOf(user)).to.equal(1n * USDC);
    expect(await usdc.balanceOf(user2)).to.equal(2n * USDC);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(27n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
  });

  it("Should allow deposits and withdrawals after adjustment with increased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 20n * USDC);
    await usdc.connect(deployer).transfer(user2, 40n * USDC);
    await usdc.connect(user).approve(liquidityHub, 20n * USDC);
    await usdc.connect(user2).approve(liquidityHub, 40n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(user2)).to.equal(20n * USDC);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(12n * USDC, INCREASE);
    expect(await liquidityHub.totalAssets()).to.equal(42n * USDC);
    await liquidityHub.connect(user).redeem(5n * LP, user, user);
    await liquidityHub.connect(user2).redeem(10n * LP, user2, user2);
    await liquidityHub.connect(user).deposit(7n * USDC, user);
    await liquidityHub.connect(user2).deposit(14n * USDC, user2);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(42n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(user2)).to.equal(20n * USDC);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
  });

  it("Should allow deposits and withdrawals after adjustment with decreased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 20n * USDC);
    await usdc.connect(deployer).transfer(user2, 40n * USDC);
    await usdc.connect(user).approve(liquidityHub, 20n * USDC);
    await usdc.connect(user2).approve(liquidityHub, 40n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(user2)).to.equal(20n * USDC);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(27n * USDC, DECREASE);
    expect(await liquidityHub.totalAssets()).to.equal(3n * USDC);
    await liquidityHub.connect(user).redeem(10n * LP, user, user);
    await liquidityHub.connect(user2).redeem(20n * LP, user2, user2);
    await liquidityHub.connect(user).deposit(6n * USDC, user);
    await liquidityHub.connect(user2).deposit(12n * USDC, user2);
    expect(await lpToken.balanceOf(user)).to.equal(6n * LP);
    expect(await lpToken.balanceOf(user2)).to.equal(12n * LP);
    expect(await lpToken.totalSupply()).to.equal(18n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(18n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(18n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(6n * LP);
    expect(await liquidityHub.balanceOf(user2)).to.equal(12n * LP);
    expect(await usdc.balanceOf(user)).to.equal(5n * USDC);
    expect(await usdc.balanceOf(user2)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(45n * USDC);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
  });

  it("Should calculate maxMint without revert after adjustment with decreased assets", async function () {
    const {liquidityHub, deployer, admin, user, usdc, USDC, LP} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);

    await liquidityHub.connect(user).deposit(2n, user);
    expect(await liquidityHub.totalSupply()).to.equal(2n * LP / USDC);

    await liquidityHub.connect(admin).adjustTotalAssets(1n, false);

    const maxMint = (getBigInt(MaxUint256) * USDC / LP - 3n) * LP / USDC;
    expect(await liquidityHub.maxMint(ZERO_ADDRESS))
      .to.eq(maxMint);

    const hardLimit = getBigInt(MaxUint256) / (2n * LP / USDC) - 1n;
    await liquidityHub.connect(admin).adjustTotalAssets(hardLimit, true);
    expect(await liquidityHub.totalAssets()).to.eq(hardLimit + 1n);
    expect(await liquidityHub.totalSupply()).to.eq(2n * LP / USDC);

    expect(await liquidityHub.maxMint(ZERO_ADDRESS))
      .to.eq(2n * LP / USDC); // (hardLimit + 1n) * (2n * LP / USDC) / (hardLimit + 1n) = 1 * (2n * LP / USDC)

    await liquidityHub.connect(admin).adjustTotalAssets(hardLimit, false);

    expect(await liquidityHub.maxMint(ZERO_ADDRESS))
      .to.eq(maxMint);
  });

  it("Should calculate maxDeposit without revert after asset adjustment", async function () {
    const {liquidityHub, deployer, admin, user, usdc, USDC, LP} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);

    await liquidityHub.connect(user).mint(1n, user);
    expect(await liquidityHub.totalAssets()).to.equal(1n);
    expect(await liquidityHub.totalSupply()).to.equal(1n);

    await liquidityHub.connect(admin).adjustTotalAssets(1n, true);

    const hardLimit = getBigInt(MaxUint256) / (LP / USDC) - 2n;

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS))
      .to.eq(hardLimit);

    await liquidityHub.connect(admin).adjustTotalAssets(hardLimit, true);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS))
      .to.eq(0);

    await liquidityHub.connect(admin).adjustTotalAssets(hardLimit + 1n, false);
    expect(await liquidityHub.totalAssets()).to.equal(1n);
    expect(await liquidityHub.totalSupply()).to.equal(1n);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS))
      .to.eq(hardLimit + 1n);
  });

  it("Should allow to deposit with permit", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    const domain = {
      name: "Circle USD",
      version: "1",
      chainId: hre.network.config.chainId,
      verifyingContract: await resolveAddress(usdc),
    };

    const types = {
      Permit: [
        {name: "owner", type: "address"},
        {name: "spender", type: "address"},
        {name: "value", type: "uint256"},
        {name: "nonce", type: "uint256"},
        {name: "deadline", type: "uint256"},
      ],
    };

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    const permitSig = Signature.from(await user.signTypedData(domain, types, {
      owner: user.address,
      spender: liquidityHub.target,
      value: 10n * USDC,
      nonce: 0n,
      deadline: 2000000000n,
    }));
    const tx = liquidityHub.connect(user).depositWithPermit(
      10n * USDC,
      user2,
      2000000000n,
      permitSig.v,
      permitSig.r,
      permitSig.s,
    );
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user2.address, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 10n * USDC);
    expect(await lpToken.balanceOf(user)).to.equal(0n);
    expect(await lpToken.balanceOf(user2)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(0n);
    expect(await liquidityHub.balanceOf(user2)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(user2)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(10n * USDC);
    expect(await usdc.allowance(user, liquidityHub)).to.equal(0n);
  });

  it("Should allow to deposit profit to the pool", async function () {
    const {LP, lpToken, liquidityHub, usdc, deployer, admin, user, USDC, liquidityPool} = await loadFixture(deployAll);

    // First deposit to make the hub not empty
    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(10n * USDC);

    await usdc.connect(deployer).transfer(admin, 10n * USDC);
    await usdc.connect(admin).approve(liquidityHub, 10n * USDC);
    const tx = liquidityHub.connect(admin).depositProfit(10n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(admin.address, liquidityPool.target, 10n * USDC);
    await expect(tx)
      .to.emit(liquidityHub, "DepositProfit")
      .withArgs(admin.address, 10n * USDC);
    await expect(tx)
      .to.emit(liquidityPool, "Deposit");
    expect(await lpToken.balanceOf(admin)).to.equal(0);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(20n * USDC);
    expect(await liquidityHub.balanceOf(admin)).to.equal(0);
    expect(await usdc.balanceOf(admin)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(20n * USDC);
  });

  it("Should not allow to deposit profit when the hub is empty", async function () {
    const {liquidityHub, usdc, deployer, admin, USDC} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(admin, 10n * USDC);
    await usdc.connect(admin).approve(liquidityHub, 10n * USDC);
    await expect(liquidityHub.connect(admin).depositProfit(10n * USDC))
      .to.be.revertedWithCustomError(liquidityHub, "EmptyHub");
  });

  it("Should not allow to deposit profit if hard limit is exceeded", async function () {
    const {liquidityHub, usdc, deployer, admin, user, USDC, LP} = await loadFixture(deployAll);
    await usdc.connect(deployer).transfer(user, 20n * USDC);
    await usdc.connect(user).approve(liquidityHub, 20n * USDC);
    await liquidityHub.connect(user).deposit(20n * USDC, user);
    const assetsHardLimit = getBigInt(MaxUint256) / (LP / USDC) - 20n * USDC;
    await usdc.connect(deployer).mint(admin, assetsHardLimit + 1n);
    await usdc.connect(admin).approve(liquidityHub, assetsHardLimit + 1n);
    await expect(liquidityHub.connect(admin).depositProfit(assetsHardLimit + 1n))
      .to.be.revertedWithCustomError(liquidityHub, "AssetsExceedHardLimit");
    await expect(liquidityHub.connect(admin).depositProfit(assetsHardLimit))
      .to.emit(liquidityHub, "DepositProfit")
      .withArgs(admin.address, assetsHardLimit);
  });

  it("Should allow admin to set assets limit", async function () {
    const {liquidityHub, deployer, admin, user, usdc, lpToken, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    const tx = liquidityHub.connect(admin).setAssetsLimit(0n);
    await expect(tx)
      .to.emit(liquidityHub, "AssetsLimitSet")
      .withArgs(getBigInt(MaxUint256) * USDC / LP, 0n);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(0n);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(0n);

    await usdc.connect(deployer).transfer(user, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub, 10n * USDC);

    await expect(liquidityHub.connect(user).deposit(1n, user))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxDeposit(address,uint256,uint256)");
    await expect(liquidityHub.connect(user).mint(LP, user))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxMint(address,uint256,uint256)");

    const tx2 = liquidityHub.connect(admin).setAssetsLimit(100n * USDC);
    await expect(tx2)
      .to.emit(liquidityHub, "AssetsLimitSet")
      .withArgs(0n, 100n * USDC);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(100n * USDC);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(100n * LP);

    await liquidityHub.connect(user).deposit(10n * USDC, user);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(90n * USDC);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(90n * LP);
    expect(await lpToken.balanceOf(user)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool)).to.equal(10n * USDC);

    await expect(liquidityHub.connect(user).deposit(90n * USDC + 1n, user))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxDeposit(address,uint256,uint256)");
    await expect(liquidityHub.connect(user).mint(90n * LP + 1n, user))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxMint(address,uint256,uint256)");

    await liquidityHub.connect(admin).adjustTotalAssets(10n * USDC, INCREASE);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(80n * USDC);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(40n * LP);

    await expect(liquidityHub.connect(user).deposit(80n * USDC + 1n, user))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxDeposit(address,uint256,uint256)");
    await expect(liquidityHub.connect(user).mint(40n * LP + 1n, user))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxMint(address,uint256,uint256)");

    await liquidityHub.connect(admin).adjustTotalAssets(10n * USDC, DECREASE);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(90n * USDC);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(90n * LP);
  });

  it("Should not allow others to set assets limit", async function () {
    const {liquidityHub, user} = await loadFixture(deployAll);

    await expect(liquidityHub.connect(user).setAssetsLimit(0n))
      .to.be.revertedWithCustomError(liquidityHub, "AccessControlUnauthorizedAccount(address,bytes32)");
  });
});
