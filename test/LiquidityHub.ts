import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  getCreateAddress, getContractAt, deploy,
  ZERO_ADDRESS
} from "./helpers";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub, TransparentUpgradeableProxy, ProxyAdmin
} from "../typechain-types";

describe("LiquidityHub", function () {
  const deployAll = async () => {
    const [deployer, admin, user, user2, user3] = await hre.ethers.getSigners();

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;

    const USDC = 10n ** (await usdc.decimals());

    const startingNonce = await deployer.getNonce();

    const liquidityHubAddress = await getCreateAddress(deployer, startingNonce + 2);
    const lpToken = (
      await deploy("SprinterUSDCLPShare", deployer, {nonce: startingNonce + 0}, liquidityHubAddress)
    ) as SprinterUSDCLPShare;
    const LP = 10n ** (await lpToken.decimals());

    const liquidityHubImpl = (
      await deploy("LiquidityHub", deployer, {nonce: startingNonce + 1}, lpToken.target)
    ) as LiquidityHub;
    const liquidityHubInit = (await liquidityHubImpl.initialize.populateTransaction(usdc.target, admin.address)).data;
    const liquidityHubProxy = (await deploy(
      "TransparentUpgradeableProxy", deployer, {nonce: startingNonce + 2},
      liquidityHubImpl.target, admin, liquidityHubInit
    )) as TransparentUpgradeableProxy;
    const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress, deployer)) as LiquidityHub;
    const liquidityHubProxyAdminAddress = await getCreateAddress(liquidityHubProxy, 1);
    const liquidityHubAdmin = (await getContractAt("ProxyAdmin", liquidityHubProxyAdminAddress, admin)) as ProxyAdmin;

    return {deployer, admin, user, user2, user3, usdc, lpToken,
      liquidityHub, liquidityHubProxy, liquidityHubAdmin, USDC, LP};
  };

  it("Should have default values", async function () {
    const {lpToken, liquidityHub, usdc, user, user2} = await loadFixture(deployAll);

    expect(await liquidityHub.SHARES()).to.equal(lpToken.target);
    expect(await liquidityHub.asset()).to.equal(usdc.target);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.allowance(user.address, user2.address)).to.equal(0n);

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

  it("Should allow to deposit", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityHub.target, 10n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(10n * USDC);
  });

  it("Should allow to deposit twice", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(3n * USDC, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 3n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityHub.target, 3n * USDC);
    const tx2 = liquidityHub.connect(user).deposit(7n * USDC, user.address);
    await expect(tx2)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 7n * LP);
    await expect(tx2)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityHub.target, 7n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(10n * USDC);
  });

  it("Should allow to mint", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    const tx = liquidityHub.connect(user).mint(10n * LP, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityHub.target, 10n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(10n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(10n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(10n * USDC);
  });

  it("Should allow to withdraw", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    const tx = liquidityHub.connect(user).withdraw(10n * USDC, user.address, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityHub.target, user.address, 10n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
  });

  it("Should allow to redeem", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    const tx = liquidityHub.connect(user).redeem(10n * LP, user.address, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityHub.target, user.address, 10n * USDC);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
  });

  it("Should allow to withdraw from another user", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, user2, user3, USDC, LP} = await loadFixture(deployAll);

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
      .withArgs(liquidityHub.target, user2.address, 10n * USDC);
    expect(await lpToken.allowance(user.address, user3.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user2.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
  });

  it("Should allow to redeem from another user", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, user2, user3, USDC, LP} = await loadFixture(deployAll);

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
      .withArgs(liquidityHub.target, user2.address, 10n * USDC);
    expect(await lpToken.allowance(user.address, user3.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalSupply()).to.equal(0n);
    expect(await liquidityHub.totalAssets()).to.equal(0n);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user2.address)).to.equal(10n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(0n);
  });

  it("Should allow to deposit and withdraw multiple times", async function () {
    const {lpToken, liquidityHub, usdc, deployer, user, USDC, LP} = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    const tx = liquidityHub.connect(user).deposit(3n * USDC, user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 3n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityHub.target, 3n * USDC);
    await liquidityHub.connect(user).withdraw(1n * USDC, user.address, user.address);
    const tx2 = liquidityHub.connect(user).deposit(7n * USDC, user.address);
    await expect(tx2)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 7n * LP);
    await expect(tx2)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityHub.target, 7n * USDC);
    await liquidityHub.connect(user).withdraw(4n * USDC, user.address, user.address);
    expect(await lpToken.balanceOf(user.address)).to.equal(5n * LP);
    expect(await lpToken.totalSupply()).to.equal(5n * LP);
    expect(await liquidityHub.totalSupply()).to.equal(5n * LP);
    expect(await liquidityHub.totalAssets()).to.equal(5n * USDC);
    expect(await liquidityHub.balanceOf(user.address)).to.equal(5n * LP);
    expect(await usdc.balanceOf(user.address)).to.equal(5n * USDC);
    expect(await usdc.balanceOf(liquidityHub.target)).to.equal(5n * USDC);
  });
});
