import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {Signature, resolveAddress, MaxUint256, getBigInt} from "ethers";
import {
  getCreateAddress, getContractAt, deploy,
  ZERO_ADDRESS, toBytes32,
} from "./helpers";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool,
} from "../typechain-types";

const INCREASE = true;
const DECREASE = false;

describe("LiquidityHub", function () {
  const deployAll = async () => {
    const [deployer, admin, user, user2, user3] = await hre.ethers.getSigners();

    const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const liquidityPool = (await deploy("TestLiquidityPool", deployer, {}, usdc.target)) as TestLiquidityPool;

    const USDC = 10n ** (await usdc.decimals());

    const startingNonce = await deployer.getNonce();

    const liquidityHubAddress = await getCreateAddress(deployer, startingNonce + 2);
    const lpToken = (
      await deploy("SprinterUSDCLPShare", deployer, {nonce: startingNonce + 0}, liquidityHubAddress)
    ) as SprinterUSDCLPShare;
    const LP = 10n ** (await lpToken.decimals());

    const liquidityHubImpl = (
      await deploy("LiquidityHub", deployer, {nonce: startingNonce + 1}, lpToken.target, liquidityPool.target)
    ) as LiquidityHub;
    const liquidityHubInit = (await liquidityHubImpl.initialize.populateTransaction(
      usdc.target, admin.address, admin.address, getBigInt(MaxUint256) * USDC / LP)
    ).data;
    const liquidityHubProxy = (await deploy(
      "TransparentUpgradeableProxy", deployer, {nonce: startingNonce + 2},
      liquidityHubImpl.target, admin, liquidityHubInit
    )) as TransparentUpgradeableProxy;
    const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress, deployer)) as LiquidityHub;
    const liquidityHubProxyAdminAddress = await getCreateAddress(liquidityHubProxy, 1);
    const liquidityHubAdmin = (await getContractAt("ProxyAdmin", liquidityHubProxyAdminAddress, admin)) as ProxyAdmin;

    await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, liquidityHub.target);

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
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.allowance(user.address, user2.address)).to.equal(0n);
    expect(await liquidityHub.assetsLimit()).to.equal(getBigInt(MaxUint256) * USDC / LP);
    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(getBigInt(MaxUint256) * USDC / LP);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(getBigInt(MaxUint256) * USDC / LP * LP / USDC);

    await expect(liquidityHubImpl.connect(admin).initialize(
      usdc.target, admin.address, admin.address, getBigInt(MaxUint256) * USDC / LP)
    ).to.be.reverted;
    await expect(liquidityHub.connect(admin).initialize(
      usdc.target, admin.address, admin.address, getBigInt(MaxUint256) * USDC / LP)
    ).to.be.reverted;
    await expect(liquidityHub.name())
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.symbol())
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.decimals())
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.transfer(user.address, 1n))
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.approve(user.address, 1n))
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.transferFrom(user.address, user2.address, 1n))
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
  });

  it("Should not allow to deploy or init with invalid values", async function () {
    const {
      lpToken, liquidityHub, usdc, liquidityPool, USDC, LP, admin, deployer
    } = await loadFixture(deployAll);

    await expect(deploy("LiquidityHub", deployer, {}, ZERO_ADDRESS, liquidityPool.target))
      .to.be.revertedWithCustomError(liquidityHub, "ZeroAddress()");
    await expect(deploy("LiquidityHub", deployer, {}, lpToken.target, ZERO_ADDRESS))
      .to.be.revertedWithCustomError(liquidityHub, "ZeroAddress()");
    const hubImpl = await deploy("LiquidityHub", deployer, {}, lpToken.target, liquidityPool.target);
    await expect(deploy(
      "TransparentUpgradeableProxy",
      deployer,
      {},
      hubImpl.target,
      admin,
      (await liquidityHub.initialize.populateTransaction(usdc.target, ZERO_ADDRESS, admin.address, 0n)).data
    )).to.be.revertedWithCustomError(liquidityHub, "ZeroAddress()");
    await expect(deploy(
      "TransparentUpgradeableProxy",
      deployer,
      {},
      hubImpl.target,
      admin,
      (await liquidityHub.initialize.populateTransaction(usdc.target, admin.address, ZERO_ADDRESS, 0n)).data
    )).to.be.revertedWithCustomError(liquidityHub, "ZeroAddress()");
    await expect(deploy(
      "TransparentUpgradeableProxy",
      deployer,
      {},
      hubImpl.target,
      admin,
      (await liquidityHub.initialize.populateTransaction(
        usdc.target, admin.address, admin.address, getBigInt(MaxUint256) * USDC / LP + 1n)
      ).data
    )).to.be.revertedWithCustomError(liquidityHub, "AssetsLimitIsTooBig()");
  });

  it("Should allow to deposit", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 10n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
  });

  it("Should allow to deposit twice", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(3n * USDC, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 3n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 3n * USDC);
    const tx2 = liquidityHub.connect(user).deposit(7n * USDC, user.address);
    await expect(tx2)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 7n * LP);
    await expect(tx2)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 7n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
  });

  it("Should allow to mint", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    const tx = liquidityHub.connect(user).mint(10n * LP, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 10n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
  });

  it("Should allow to withdraw", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    const tx = liquidityHub.connect(user).withdraw(10n * USDC, user.address, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, user.address, 10n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(0n);
  });

  it("Should allow to redeem", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    const tx = liquidityHub.connect(user).redeem(10n * LP, user.address, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, user.address, 10n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(0n);
  });

  it("Should allow to withdraw from another user", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, user3, USDC, LP,
      liquidityPool,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(user3.address, 10n * LP);
    const tx = liquidityHub.connect(user3).withdraw(10n * USDC, user2.address, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, user2.address, 10n * USDC);
    expect(await lpToken.allowance(user.address, user3.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user2.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(0n);
  });

  it("Should allow to redeem from another user", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, user3, USDC, LP,
      liquidityPool,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(user3.address, 10n * LP);
    const tx = liquidityHub.connect(user3).redeem(10n * LP, user2.address, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, user2.address, 10n * USDC);
    expect(await lpToken.allowance(user.address, user3.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user2.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(0n);
  });

  it("Should allow to deposit and withdraw multiple times", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(3n * USDC, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 3n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 3n * USDC);
    await liquidityHub.connect(user).withdraw(1n * USDC, user.address, user.address);
    const tx2 = liquidityHub.connect(user).deposit(7n * USDC, user.address);
    await expect(tx2)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 7n * LP);
    await expect(tx2)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 7n * USDC);
    await liquidityHub.connect(user).withdraw(4n * USDC, user.address, user.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(5n * LP);
    expect(await lpToken.totalSupply()).to.equal(5n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(5n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(5n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(5n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(5n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(5n * USDC);
  });

  it("Should allow to do initial 0 assets adjustment", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityPool.target, 10n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);

    await expect(liquidityHub.connect(admin).adjustTotalAssets(0n, INCREASE))
      .to.emit(liquidityHub, "TotalAssetsAdjustment")
      .withArgs(10n * USDC, 10n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
  });

  it("Should allow to do 0 assets adjustment on empty hub", async function () {
    const {
      lpToken, liquidityHub, usdc,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await expect(liquidityHub.connect(admin).adjustTotalAssets(0n, INCREASE))
      .to.emit(liquidityHub, "TotalAssetsAdjustment")
      .withArgs(0n, 0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
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

    await usdc.connect(deployer).transfer(user.address, 20n * USDC);
    await usdc.connect(deployer).transfer(user2.address, 40n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 20n * USDC);
    await usdc.connect(user2).approve(liquidityHub.target, 40n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(user2.address)).to.equal(20n * USDC);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(120n * USDC, INCREASE);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(12n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(24n * LP);
    expect(await lpToken.totalSupply()).to.equal(36n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(36n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(180n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(12n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(24n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(60n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
  });

  it("Should process deposits after adjustment with decreased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 20n * USDC);
    await usdc.connect(deployer).transfer(user2.address, 40n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 20n * USDC);
    await usdc.connect(user2).approve(liquidityHub.target, 40n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(user2.address)).to.equal(20n * USDC);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(20n * USDC, DECREASE);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(40n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(80n * LP);
    expect(await lpToken.totalSupply()).to.equal(120n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(120n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(40n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(40n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(80n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(60n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
  });

  it("Should allow withdrawals after adjustment with increased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(deployer).transfer(user2.address, 20n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await usdc.connect(user2).approve(liquidityHub.target, 20n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(12n * USDC, INCREASE);
    expect(await liquidityHub.totalAssets()).to.equal(42n * USDC);
    await liquidityHub.connect(user).redeem(5n * LP, user.address, user.address);
    await liquidityHub.connect(user2).redeem(10n * LP, user2.address, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(5n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(15n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(15n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(21n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(5n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(7n * USDC);
    expect(await usdc.balanceOf(user2.address)).to.equal(14n * USDC);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(9n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
  });

  it("Should allow withdrawals after adjustment with decreased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(deployer).transfer(user2.address, 20n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await usdc.connect(user2).approve(liquidityHub.target, 20n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(27n * USDC, DECREASE);
    expect(await liquidityHub.totalAssets()).to.equal(3n * USDC);
    await liquidityHub.connect(user).redeem(10n * LP, user.address, user.address);
    await liquidityHub.connect(user2).redeem(20n * LP, user2.address, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user2.address)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(user.address)).to.equal(1n * USDC);
    expect(await usdc.balanceOf(user2.address)).to.equal(2n * USDC);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(27n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
  });

  it("Should allow deposits and withdrawals after adjustment with increased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 20n * USDC);
    await usdc.connect(deployer).transfer(user2.address, 40n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 20n * USDC);
    await usdc.connect(user2).approve(liquidityHub.target, 40n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(user2.address)).to.equal(20n * USDC);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(12n * USDC, INCREASE);
    expect(await liquidityHub.totalAssets()).to.equal(42n * USDC);
    await liquidityHub.connect(user).redeem(5n * LP, user.address, user.address);
    await liquidityHub.connect(user2).redeem(10n * LP, user2.address, user2.address);
    await liquidityHub.connect(user).deposit(7n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(14n * USDC, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(42n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(user2.address)).to.equal(20n * USDC);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
  });

  it("Should allow deposits and withdrawals after adjustment with decreased assets", async function () {
    const {
      lpToken, liquidityHub, usdc, deployer, user, user2, USDC, LP,
      liquidityPool, admin,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 20n * USDC);
    await usdc.connect(deployer).transfer(user2.address, 40n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 20n * USDC);
    await usdc.connect(user2).approve(liquidityHub.target, 40n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await lpToken.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(30n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(30n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(20n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(user2.address)).to.equal(20n * USDC);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(30n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);

    await liquidityHub.connect(admin).adjustTotalAssets(27n * USDC, DECREASE);
    expect(await liquidityHub.totalAssets()).to.equal(3n * USDC);
    await liquidityHub.connect(user).redeem(10n * LP, user.address, user.address);
    await liquidityHub.connect(user2).redeem(20n * LP, user2.address, user2.address);
    await liquidityHub.connect(user).deposit(6n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(12n * USDC, user2.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(6n * LP);
    expect(await lpToken.balanceOf(user2.address)).to.equal(12n * LP);
    expect(await lpToken.totalSupply()).to.equal(18n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(18n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(18n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(6n * LP);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(12n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(5n * USDC);
    expect(await usdc.balanceOf(user2.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(45n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
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

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    const permitSig = Signature.from(await user.signTypedData(domain, types, {
      owner: user.address,
      spender: liquidityHub.target,
      value: 10n * USDC,
      nonce: 0n,
      deadline: 2000000000n,
    }));
    const tx = liquidityHub.connect(user).depositWithPermit(
      10n * USDC,
      user2.address,
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
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityHub.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
    expect(await usdc.allowance(user.address, liquidityHub.target)).to.equal(0n);
  });

  it("Should allow admin to set assets limit", async function () {
    const {liquidityHub, deployer, admin, user, usdc, lpToken, USDC, LP, liquidityPool} = await loadFixture(deployAll);

    const tx = liquidityHub.connect(admin).setAssetsLimit(0n);
    await expect(tx)
      .to.emit(liquidityHub, "AssetsLimitSet")
      .withArgs(getBigInt(MaxUint256) * USDC / LP, 0n);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(0n);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(0n);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);

    await expect(liquidityHub.connect(user).deposit(1n, user.address))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxDeposit(address,uint256,uint256)");
    await expect(liquidityHub.connect(user).mint(LP, user.address))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxMint(address,uint256,uint256)");

    const tx2 = liquidityHub.connect(admin).setAssetsLimit(100n * USDC);
    await expect(tx2)
      .to.emit(liquidityHub, "AssetsLimitSet")
      .withArgs(0n, 100n * USDC);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(100n * USDC);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(100n * LP);

    await liquidityHub.connect(user).deposit(10n * USDC, user.address);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(90n * USDC);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(90n * LP);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);

    await expect(liquidityHub.connect(user).deposit(90n * USDC + 1n, user.address))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxDeposit(address,uint256,uint256)");
    await expect(liquidityHub.connect(user).mint(90n * LP + 1n, user.address))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxMint(address,uint256,uint256)");

    await liquidityHub.connect(admin).adjustTotalAssets(10n * USDC, INCREASE);

    expect(await liquidityHub.maxDeposit(ZERO_ADDRESS)).to.equal(80n * USDC);
    expect(await liquidityHub.maxMint(ZERO_ADDRESS)).to.equal(40n * LP);

    await expect(liquidityHub.connect(user).deposit(80n * USDC + 1n, user.address))
      .to.be.revertedWithCustomError(liquidityHub, "ERC4626ExceededMaxDeposit(address,uint256,uint256)");
    await expect(liquidityHub.connect(user).mint(40n * LP + 1n, user.address))
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
