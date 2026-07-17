import {loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {deploy, deployX, getContractAt, getCreateAddress, setupTests} from "./helpers";
import {addressToBytes32, ZERO_ADDRESS} from "../scripts/common";
import {
  TestUSDC, PaxosOracle, StashDexProcessor,
  TransparentUpgradeableProxy, ProxyAdmin, Test4626,
} from "../typechain-types";

describe("StashDexProcessor", function () {
  setupTests();

  const deployAll = async () => {
    const [deployer, admin, caller, config, receiver] = await hre.ethers.getSigners();

    const usdcRef = (await deploy("TestUSDC", deployer)) as TestUSDC;
    const usdc = (await deploy("TestUSDC", deployer)) as TestUSDC;
    const tokenA = (await deploy("TestUSDC", deployer)) as TestUSDC;

    const oracle = (await deploy("PaxosOracle", deployer, {}, admin, usdcRef, [
      {assetId: addressToBytes32(usdc.target), decimals: 6},
      {assetId: addressToBytes32(tokenA.target), decimals: 6},
    ])) as PaxosOracle;

    const stashDexProcessorImpl = (await deployX(
      "StashDexProcessor", deployer, "StashDexProcessorImpl", {},
      usdc, receiver, oracle,
    )) as StashDexProcessor;
    const stashDexProcessorInitData = (await stashDexProcessorImpl.initialize.populateTransaction(
      admin, caller, config
    )).data;
    const stashDexProcessorProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyStashDexProcessor", {},
      stashDexProcessorImpl, admin, stashDexProcessorInitData,
    )) as TransparentUpgradeableProxy;
    const stashDexProcessor = (
      await getContractAt("StashDexProcessor", stashDexProcessorProxy, deployer)
    ) as StashDexProcessor;
    const stashDexProcessorAdminAddress = await getCreateAddress(stashDexProcessorProxy, 1);
    const stashDexProcessorAdmin = (
      await getContractAt("ProxyAdmin", stashDexProcessorAdminAddress, admin)
    ) as ProxyAdmin;

    const test4626 = (await deploy(
      "Test4626", deployer, {}, usdc.target, "Test4626 USDC", "tUSDC"
    )) as Test4626;

    return {
      deployer, admin, caller, config, receiver,
      usdc, tokenA, oracle, stashDexProcessor, stashDexProcessorAdmin, test4626,
    };
  };

  describe("Deployment", function () {
    it("constructor reverts ZeroAddress when oracle is zero address", async function () {
      const {deployer, usdc, receiver, stashDexProcessor} = await loadFixture(deployAll);
      await expect(
        deploy("StashDexProcessor", deployer, {}, usdc, receiver, ZERO_ADDRESS)
      ).to.be.revertedWithCustomError(stashDexProcessor, "ZeroAddress");
    });

    it("stores immutables correctly", async function () {
      const {stashDexProcessor, usdc, receiver, oracle} = await loadFixture(deployAll);
      expect(await stashDexProcessor.TARGET_ASSET()).to.equal(usdc.target);
      expect(await stashDexProcessor.RECEIVER()).to.equal(receiver.address);
      expect(await stashDexProcessor.ORACLE()).to.equal(oracle.target);
    });
  });

  describe("forward", function () {
    it("forwards TARGET_ASSET to RECEIVER", async function () {
      const {caller, usdc, receiver, stashDexProcessor} = await loadFixture(deployAll);

      await usdc.mint(stashDexProcessor, 100_000000n);

      const tx = await stashDexProcessor.connect(caller).forward(usdc);
      await expect(tx).to.emit(stashDexProcessor, "Forwarded");

      expect(await usdc.balanceOf(stashDexProcessor)).to.equal(0n);
      expect(await usdc.balanceOf(receiver)).to.equal(100_000000n);
    });
  });

  describe("forwardAmount", function () {
    it("forwards specified amount to RECEIVER", async function () {
      const {caller, usdc, receiver, stashDexProcessor} = await loadFixture(deployAll);

      await usdc.mint(stashDexProcessor, 100_000000n);

      const tx = await stashDexProcessor.connect(caller).forwardAmount(usdc, 99_000000n);
      await expect(tx).to.emit(stashDexProcessor, "Forwarded");

      expect(await usdc.balanceOf(stashDexProcessor)).to.equal(1_000000n);
      expect(await usdc.balanceOf(receiver)).to.equal(99_000000n);
    });
  });

  describe("process4626", function () {
    it("sends processed output to RECEIVER", async function () {
      const {deployer, caller, usdc, receiver, stashDexProcessor, test4626} = await loadFixture(deployAll);

      const amountIn = 100_000000n;
      const amountOutMin = 97_000000n;

      await usdc.mint(deployer, amountIn);
      await usdc.connect(deployer).approve(test4626, amountIn);
      await test4626.connect(deployer).deposit(amountIn, stashDexProcessor);

      const subProcessorAddr = await stashDexProcessor.subProcessor();
      await usdc.mint(subProcessorAddr, amountOutMin);

      const tx = await stashDexProcessor.connect(caller).process4626(test4626, amountIn, amountOutMin, []);
      await expect(tx).to.emit(stashDexProcessor, "Processed")
        .withArgs(caller.address, test4626.target, amountIn, amountOutMin);

      expect(await usdc.balanceOf(stashDexProcessor)).to.equal(0n);
      expect(await usdc.balanceOf(receiver)).to.equal(amountOutMin);
      expect(await usdc.balanceOf(subProcessorAddr)).to.equal(0n);
    });
  });

  describe("process", function () {
    it("sends processed output to RECEIVER", async function () {
      const {caller, usdc, tokenA, receiver, stashDexProcessor} = await loadFixture(deployAll);

      const amountIn = 100_000000n;
      const amountOutMin = 97_000000n;

      await tokenA.mint(stashDexProcessor, amountIn);

      const subProcessorAddr = await stashDexProcessor.subProcessor();
      await usdc.mint(subProcessorAddr, amountOutMin);

      const deadline = 2000000000n;
      const tx = await stashDexProcessor.connect(caller).process(
        tokenA, amountIn, amountOutMin, deadline, "0x", []
      );
      await expect(tx).to.emit(stashDexProcessor, "Processed")
        .withArgs(caller.address, tokenA.target, amountIn, amountOutMin);

      expect(await usdc.balanceOf(stashDexProcessor)).to.equal(0n);
      expect(await usdc.balanceOf(receiver)).to.equal(amountOutMin);
      expect(await tokenA.balanceOf(stashDexProcessor)).to.equal(0n);
    });
  });
});
