import {
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, setupTests,
} from "./helpers";
import {addressToBytes32, ZERO_ADDRESS, DEFAULT_ADMIN_ROLE} from "../scripts/common";
import {
  TestUSDC, TestWETH, PaxosOracle,
} from "../typechain-types";

describe("PaxosOracle", function () {
  setupTests();

  const deployAll = async () => {
    const [deployer, admin, user] = await hre.ethers.getSigners();

    // USDG, PYUSD and USDC all use 6 decimals, mirrored here by TestUSDC.
    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const usdg = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const pyusd = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    // 18 decimals token to exercise decimal normalization branches.
    const weth = (await deploy("TestWETH", deployer, {})) as TestWETH;

    const oracle = (await deploy(
      "PaxosOracle", deployer, {}, admin.address, usdc.target, [
        {assetId: addressToBytes32(usdg.target), decimals: 6},
        {assetId: addressToBytes32(pyusd.target), decimals: 6},
      ],
    )) as PaxosOracle;

    return {deployer, admin, user, usdc, usdg, pyusd, weth, oracle};
  };

  it("Should register the initial stablecoins from the constructor", async function () {
    const {usdg, pyusd, oracle} = await loadFixture(deployAll);

    expect(await oracle.isSupported(addressToBytes32(usdg.target))).to.equal(true);
    expect(await oracle.isSupported(addressToBytes32(pyusd.target))).to.equal(true);
  });

  it("Should value supported Paxos stablecoins 1:1 to USDC", async function () {
    const {usdg, pyusd, oracle} = await loadFixture(deployAll);

    const amount = 1234_560000n; // 1234.56 with 6 decimals.
    expect(await oracle.getAssetValue(addressToBytes32(usdg.target), amount)).to.equal(amount);
    expect(await oracle.getAssetValue(addressToBytes32(pyusd.target), amount)).to.equal(amount);
    expect(await oracle.getAssetValue(addressToBytes32(usdg.target), 0n)).to.equal(0n);
  });

  it("Should report supported assets and config", async function () {
    const {usdc, usdg, pyusd, oracle} = await loadFixture(deployAll);

    expect(await oracle.isSupported(addressToBytes32(usdg.target))).to.equal(true);
    expect(await oracle.isSupported(addressToBytes32(pyusd.target))).to.equal(true);
    expect(await oracle.isSupported(addressToBytes32(usdc.target))).to.equal(false);
    expect(await oracle.USDC()).to.equal(usdc.target);
    expect(await oracle.USDC_DECIMALS()).to.equal(6n);
  });

  it("Should revert for unsupported assets", async function () {
    const {usdc, weth, oracle} = await loadFixture(deployAll);

    await expect(oracle.getAssetValue(addressToBytes32(usdc.target), 1n))
      .to.be.revertedWithCustomError(oracle, "AssetNotSupported");
    await expect(oracle.getAssetValue(addressToBytes32(weth.target), 1n))
      .to.be.revertedWithCustomError(oracle, "AssetNotSupported");
  });

  it("Should normalize down when the stablecoin has more decimals than USDC", async function () {
    const {deployer, admin, usdc, weth} = await loadFixture(deployAll);

    // USDC reference = 6 decimals, stablecoin = 18 decimals.
    const oracle = (await deploy(
      "PaxosOracle", deployer, {}, admin.address, usdc.target, [
        {assetId: addressToBytes32(weth.target), decimals: 18},
      ],
    )) as PaxosOracle;

    const oneToken = 10n ** 18n;
    expect(await oracle.getAssetValue(addressToBytes32(weth.target), oneToken)).to.equal(10n ** 6n);
  });

  it("Should normalize up when the stablecoin has fewer decimals than USDC", async function () {
    const {deployer, admin, usdc, weth} = await loadFixture(deployAll);

    // USDC reference = 18 decimals (weth mock), stablecoin = 6 decimals.
    const oracle = (await deploy(
      "PaxosOracle", deployer, {}, admin.address, weth.target, [
        {assetId: addressToBytes32(usdc.target), decimals: 6},
      ],
    )) as PaxosOracle;

    const oneToken = 10n ** 6n;
    expect(await oracle.getAssetValue(addressToBytes32(usdc.target), oneToken)).to.equal(10n ** 18n);
  });

  it("Should let the super-admin add and remove assets", async function () {
    const {admin, weth, oracle} = await loadFixture(deployAll);

    const assetId = addressToBytes32(weth.target);
    await expect(oracle.connect(admin).addAsset(assetId, 18))
      .to.emit(oracle, "AssetAdded").withArgs(assetId, 18);
    expect(await oracle.isSupported(assetId)).to.equal(true);
    expect(await oracle.getAssetValue(assetId, 10n ** 18n)).to.equal(10n ** 6n);

    await expect(oracle.connect(admin).removeAsset(assetId))
      .to.emit(oracle, "AssetRemoved").withArgs(assetId);
    expect(await oracle.isSupported(assetId)).to.equal(false);
    await expect(oracle.getAssetValue(assetId, 1n))
      .to.be.revertedWithCustomError(oracle, "AssetNotSupported");
  });

  it("Should restrict add/remove to the super-admin", async function () {
    const {user, usdg, weth, oracle} = await loadFixture(deployAll);

    await expect(oracle.connect(user).addAsset(addressToBytes32(weth.target), 18))
      .to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    await expect(oracle.connect(user).removeAsset(addressToBytes32(usdg.target)))
      .to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
  });

  it("Should revert on invalid add/remove", async function () {
    const {admin, usdg, weth, oracle} = await loadFixture(deployAll);

    await expect(oracle.connect(admin).addAsset(addressToBytes32(usdg.target), 6))
      .to.be.revertedWithCustomError(oracle, "AssetAlreadySupported");
    await expect(oracle.connect(admin).removeAsset(addressToBytes32(weth.target)))
      .to.be.revertedWithCustomError(oracle, "AssetNotSupported");
  });

  it("Should set the super-admin on deployment", async function () {
    const {admin, oracle} = await loadFixture(deployAll);

    expect(await oracle.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(true);
  });

  it("Should revert on invalid constructor arguments", async function () {
    const {deployer, admin, usdc, usdg} = await loadFixture(deployAll);

    const factory = await hre.ethers.getContractFactory("PaxosOracle", deployer);
    const usdgAsset = {assetId: addressToBytes32(usdg.target), decimals: 6};

    await expect(factory.deploy(ZERO_ADDRESS, usdc.target, []))
      .to.be.revertedWithCustomError(factory, "ZeroAddress");
    await expect(factory.deploy(admin.address, ZERO_ADDRESS, []))
      .to.be.revertedWithCustomError(factory, "ZeroAddress");
    await expect(factory.deploy(admin.address, usdc.target, [usdgAsset, usdgAsset]))
      .to.be.revertedWithCustomError(factory, "AssetAlreadySupported");
  });
});
