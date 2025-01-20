import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("SprinterUSDCLPShare", function () {
  const deployLPToken = async () => {
    const [manager, user, user2] = await hre.ethers.getSigners();

    const SprinterUSDCLPShare = await hre.ethers.getContractFactory("SprinterUSDCLPShare");
    const lpToken = await SprinterUSDCLPShare.deploy(manager.address);

    return {lpToken, manager, user, user2};
  };

  it("Should have default values", async function () {
    const {lpToken, manager} = await loadFixture(deployLPToken);

    expect(await lpToken.MANAGER()).to.equal(manager.address);
    expect(await lpToken.name()).to.equal("Sprinter USDC LP Share");
    expect(await lpToken.symbol()).to.equal("sprUSDC-LP");
    expect(await lpToken.decimals()).to.equal(18n);
    expect(await lpToken.MANAGER()).to.equal(manager.address);
  });

  it("Should allow manager to mint", async function () {
    const {lpToken, manager, user} = await loadFixture(deployLPToken);

    await expect(lpToken.connect(manager).mint(user.address, 100n))
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 100n);
    expect(await lpToken.balanceOf(user.address)).to.equal(100n);
    expect(await lpToken.totalSupply()).to.equal(100n);
  });

  it("Should not allow others to mint", async function () {
    const {lpToken, user} = await loadFixture(deployLPToken);

    await expect(lpToken.connect(user).mint(user.address, 100n))
      .to.be.revertedWithCustomError(lpToken, "AccessDenied()");
  });

  it("Should allow manager to burn", async function () {
    const {lpToken, manager, user} = await loadFixture(deployLPToken);

    await lpToken.connect(manager).mint(user.address, 100n);
    await expect(lpToken.connect(manager).burn(user.address, 30n))
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, ZERO_ADDRESS, 30n);
    expect(await lpToken.balanceOf(user.address)).to.equal(70n);
    expect(await lpToken.totalSupply()).to.equal(70n);
  });

  it("Should not allow others to burn", async function () {
    const {lpToken, manager, user} = await loadFixture(deployLPToken);

    await lpToken.connect(manager).mint(user.address, 100n);
    await expect(lpToken.connect(user).burn(user.address, 30n))
      .to.be.revertedWithCustomError(lpToken, "AccessDenied()");
  });

  it("Should allow others to transfer", async function () {
    const {lpToken, manager, user, user2} = await loadFixture(deployLPToken);

    await lpToken.connect(manager).mint(user.address, 100n);
    await expect(lpToken.connect(user).transfer(user2.address, 30n))
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, user2.address, 30n);
    expect(await lpToken.balanceOf(user.address)).to.equal(70n);
    expect(await lpToken.balanceOf(user2.address)).to.equal(30n);
    expect(await lpToken.totalSupply()).to.equal(100n);
  });
});
