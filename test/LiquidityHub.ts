import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  getCreateAddress, getContractAt, deploy,
  expectContractEvents, toBytes32, ZERO_ADDRESS, ZERO_BYTES32
} from "./helpers";

describe("LiquidityHub", function () {
  const deployAll = async () => {
    const [deployer, admin, user, user2, user3] = await hre.ethers.getSigners();

    const usdc = await deploy("TestUSDC", deployer, {});

    const USDC = 10n ** (await usdc.decimals());

    const startingNonce = await deployer.getNonce();

    const liquidityHubAddress = getCreateAddress(deployer, startingNonce + 2);
    const SprinterUSDCLPShare = await hre.ethers.getContractFactory("SprinterUSDCLPShare");
    const lpToken = await deploy("SprinterUSDCLPShare", deployer, {nonce: startingNonce + 0}, liquidityHubAddress);
    const LP = 10n ** (await lpToken.decimals());

    const liquidityHubImpl = await deploy("LiquidityHub", deployer, {nonce: startingNonce + 1}, lpToken.target);
    const liquidityHubInit = (await liquidityHubImpl.initialize.populateTransaction(usdc.target)).data;
    const liquidityHubProxy = await deploy(
      "TransparentUpgradeableProxy", deployer, {nonce: startingNonce + 2},
      liquidityHubImpl.target, admin, liquidityHubInit
    );
    const liquidityHub = await getContractAt('LiquidityHub', liquidityHubAddress, deployer);
    const liquidityHubProxyAdminAddress = getCreateAddress(liquidityHubProxy, 1);
    const liquidityHubAdmin = await getContractAt("ProxyAdmin", liquidityHubProxyAdminAddress, admin);


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
});
