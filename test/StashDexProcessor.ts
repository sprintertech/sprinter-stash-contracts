import {loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {deploy, deployX, getContractAt, getCreateAddress, setupTests} from "./helpers";
import {addressToBytes32, ZERO_ADDRESS} from "../scripts/common";
import {
  TestUSDC, PaxosOracle, TestLiquidityPool, StashDex, StashDexProcessor,
  TransparentUpgradeableProxy, ProxyAdmin, Test4626,
} from "../typechain-types";

describe("StashDexProcessor", function () {
  setupTests();

  const debtAmount = 100_000000n;

  const deployAll = async () => {
    const [deployer, admin, configAdmin, pauser, forwarder, caller, config, user, receiver, swapProcessor] =
      await hre.ethers.getSigners();

    const usdcRef = (await deploy("TestUSDC", deployer)) as TestUSDC;
    const usdc = (await deploy("TestUSDC", deployer)) as TestUSDC;    // TARGET_ASSET / tokenOut in stashDex
    const tokenA = (await deploy("TestUSDC", deployer)) as TestUSDC; // tokenIn for stashDex swap + Processor.process()

    const oracle = (await deploy("PaxosOracle", deployer, {}, admin, usdcRef, [
      {assetId: addressToBytes32(usdc.target), decimals: 6},
      {assetId: addressToBytes32(await tokenA.getAddress()), decimals: 6},
    ])) as PaxosOracle;

    const pool = (await deploy("TestLiquidityPool", deployer, {}, usdc, admin, ZERO_ADDRESS)) as TestLiquidityPool;

    // Deploy StashDex
    const stashDexImpl = (await deploy("StashDex", deployer, {}, oracle, receiver)) as StashDex;
    const stashDexInitData = (await stashDexImpl.initialize.populateTransaction(
      admin, configAdmin, pauser, forwarder, [], []
    )).data;
    const stashDexProxy = (await deploy(
      "TransparentUpgradeableProxy", deployer, {}, stashDexImpl, admin, stashDexInitData
    )) as TransparentUpgradeableProxy;
    const stashDex = (await getContractAt("StashDex", stashDexProxy, deployer)) as StashDex;

    await stashDex.connect(configAdmin).setPool(usdc, pool);
    await stashDex.connect(configAdmin).setRoute({
      tokenIn: tokenA,
      tokenOut: usdc,
      feeBps: 0,
      processor: swapProcessor,
    });

    // Create debt: user swaps tokenA → usdc; stashDex borrows debtAmount from pool
    await usdc.mint(pool, debtAmount);
    await tokenA.mint(user, debtAmount);
    await tokenA.connect(user).approve(stashDex, debtAmount);
    await stashDex.connect(user).swap(tokenA, usdc, debtAmount, debtAmount, user);

    // Deploy StashDexProcessor proxy
    const stashDexProcessorImpl = (await deployX(
      "StashDexProcessor", deployer, "StashDexProcessorImpl", {},
      usdc, stashDex, oracle,
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
      deployer, admin, configAdmin, pauser, forwarder, caller, config, user, receiver, swapProcessor,
      usdc, tokenA, oracle, pool, stashDex, stashDexProcessor, stashDexProcessorAdmin,
      test4626, debtAmount,
    };
  };

  describe("Deployment", function () {
    it("constructor reverts ZeroAddress when oracle is zero address", async function () {
      const {deployer, usdc, stashDex, stashDexProcessor} = await loadFixture(deployAll);
      await expect(
        deploy("StashDexProcessor", deployer, {}, usdc, stashDex, ZERO_ADDRESS)
      ).to.be.revertedWithCustomError(stashDexProcessor, "ZeroAddress");
    });

    it("stores immutables correctly", async function () {
      const {stashDexProcessor, usdc, stashDex, oracle} = await loadFixture(deployAll);
      expect(await stashDexProcessor.TARGET_ASSET()).to.equal(usdc.target);
      expect(await stashDexProcessor.RECEIVER()).to.equal(stashDex.target);
      expect(await stashDexProcessor.ORACLE()).to.equal(oracle.target);
    });
  });

  describe("forward", function () {
    it("calls repay on StashDex after forwarding TARGET_ASSET", async function () {
      const {caller, usdc, pool, stashDex, stashDexProcessor} = await loadFixture(deployAll);

      await usdc.mint(stashDexProcessor, debtAmount);

      const tx = await stashDexProcessor.connect(caller).forward(usdc);
      await expect(tx).to.emit(stashDexProcessor, "Forwarded");
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(usdc.target, debtAmount);

      expect(await stashDex.getTotalBorrowed(usdc)).to.equal(0n);
      expect(await usdc.balanceOf(stashDexProcessor)).to.equal(0n);
      expect(await usdc.balanceOf(stashDex)).to.equal(0n);
      expect(await usdc.balanceOf(pool)).to.equal(debtAmount);
    });

    it("repays tokenA debt when forwarding tokenA", async function () {
      const {deployer, admin, configAdmin, caller, user, swapProcessor, usdc, tokenA, stashDex, stashDexProcessor} =
        await loadFixture(deployAll);

      // Create tokenA debt: set up a pool for tokenA and a swap route usdc→tokenA
      const tokenADebt = 100_000000n;
      const tokenAPool = (await deploy("TestLiquidityPool", deployer, {}, tokenA, admin, ZERO_ADDRESS)) as TestLiquidityPool;
      await tokenA.mint(tokenAPool, tokenADebt);
      await stashDex.connect(configAdmin).setPool(tokenA, tokenAPool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: usdc, tokenOut: tokenA, feeBps: 0, processor: swapProcessor});
      await usdc.mint(user, tokenADebt);
      await usdc.connect(user).approve(stashDex, tokenADebt);
      await stashDex.connect(user).swap(usdc, tokenA, tokenADebt, tokenADebt, user);

      const forwardAmount = 60_000000n;
      await tokenA.mint(stashDexProcessor, forwardAmount);

      const tx = await stashDexProcessor.connect(caller).forward(tokenA);
      await expect(tx).to.emit(stashDexProcessor, "Forwarded");
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(tokenA.target, forwardAmount);

      expect(await stashDex.getTotalBorrowed(tokenA)).to.equal(tokenADebt - forwardAmount);
      expect(await tokenA.balanceOf(stashDexProcessor)).to.equal(0n);
      expect(await tokenA.balanceOf(stashDex)).to.equal(0n);
      expect(await tokenA.balanceOf(tokenAPool)).to.equal(forwardAmount);
      expect(await stashDex.getTotalBorrowed(usdc)).to.equal(debtAmount); // usdc debt unaffected
    });
  });

  describe("process4626", function () {
    it("calls repay on StashDex after processing 4626 shares", async function () {
      const {deployer, caller, usdc, pool, stashDex, stashDexProcessor, test4626} = await loadFixture(deployAll);

      const amountIn = 100_000000n;
      const amountOutMin = 97_000000n; // 97% of amountIn — passes slippage check for 1:1 rate

      // Give stashDexProcessor test4626 shares backed by amountIn USDC
      await usdc.mint(deployer, amountIn);
      await usdc.connect(deployer).approve(test4626, amountIn);
      await test4626.connect(deployer).deposit(amountIn, stashDexProcessor);

      // Simulate DEX conversion: subProcessor receives amountOutMin USDC for the swap
      const subProcessorAddr = await stashDexProcessor.subProcessor();
      await usdc.mint(subProcessorAddr, amountOutMin);

      const tx = await stashDexProcessor.connect(caller).process4626(test4626, amountIn, amountOutMin, []);
      await expect(tx).to.emit(stashDexProcessor, "Processed")
        .withArgs(caller.address, await test4626.getAddress(), amountIn, amountOutMin);
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(usdc.target, amountOutMin);

      expect(await stashDex.getTotalBorrowed(usdc)).to.equal(debtAmount - amountOutMin);
      expect(await usdc.balanceOf(stashDexProcessor)).to.equal(0n);
      expect(await usdc.balanceOf(stashDex)).to.equal(0n);
      expect(await usdc.balanceOf(pool)).to.equal(amountOutMin);
      expect(await usdc.balanceOf(subProcessorAddr)).to.equal(0n);
    });
  });

  describe("process", function () {
    it("calls repay on StashDex after processing tokenIn", async function () {
      const {caller, usdc, tokenA, pool, stashDex, stashDexProcessor} = await loadFixture(deployAll);

      const amountIn = 100_000000n;
      const amountOutMin = 97_000000n; // 97% of amountIn — passes oracle slippage check

      // tokenIn sits in the processor before processing
      await tokenA.mint(stashDexProcessor, amountIn);

      // Simulate DEX conversion: subProcessor receives amountOutMin USDC for the swap
      const subProcessorAddr = await stashDexProcessor.subProcessor();
      await usdc.mint(subProcessorAddr, amountOutMin);

      const deadline = 2000000000n;
      const tx = await stashDexProcessor.connect(caller).process(
        tokenA, amountIn, amountOutMin, deadline, "0x", []
      );
      await expect(tx).to.emit(stashDexProcessor, "Processed")
        .withArgs(caller.address, await tokenA.getAddress(), amountIn, amountOutMin);
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(usdc.target, amountOutMin);

      expect(await stashDex.getTotalBorrowed(usdc)).to.equal(debtAmount - amountOutMin);
      expect(await usdc.balanceOf(stashDexProcessor)).to.equal(0n);
      expect(await usdc.balanceOf(stashDex)).to.equal(0n);
      expect(await usdc.balanceOf(pool)).to.equal(amountOutMin);
      expect(await usdc.balanceOf(subProcessorAddr)).to.equal(0n);
      expect(await tokenA.balanceOf(stashDexProcessor)).to.equal(0n);
    });
  });
});
