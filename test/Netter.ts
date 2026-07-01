import hre from "hardhat";
import {expect} from "chai";
import {getContractAt, deploy, toBytes32, setupTests} from "./helpers";
import {
  TestUSDC, TestWETH, PaxosOracle, Processor, Netter, TransparentUpgradeableProxy,
} from "../typechain-types";
import {loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {addressToBytes32, ZERO_ADDRESS} from "../scripts/common";

describe("Netter", function () {
  setupTests();

  const USDC = 10n ** 6n;
  const WETH = 10n ** 18n;

  const deployAll = async () => {
    const [deployer, admin, caller, user, receiverA, receiverB] = await hre.ethers.getSigners();

    const CALLER_ROLE = toBytes32("CALLER_ROLE");

    const usdcRef = (await deploy("TestUSDC", deployer)) as TestUSDC;
    const assetA = (await deploy("TestUSDC", deployer)) as TestUSDC;  // 6 decimals
    const assetB = (await deploy("TestWETH", deployer)) as TestWETH;  // 18 decimals

    const oracle = (await deploy("PaxosOracle", deployer, {}, admin, usdcRef, [
      {assetId: addressToBytes32(assetA.target), decimals: 6},
      {assetId: addressToBytes32(assetB.target), decimals: 18},
    ])) as PaxosOracle;

    const deployProcessor = async (asset: TestUSDC | TestWETH, receiver: typeof receiverA) => {
      const impl = (await deploy("Processor", deployer, {}, asset, receiver, oracle)) as Processor;
      const initData = (await impl.initialize.populateTransaction(admin, admin, admin)).data;
      const proxy = (await deploy(
        "TransparentUpgradeableProxy", deployer, {}, impl, admin, initData,
      )) as TransparentUpgradeableProxy;
      return (await getContractAt("Processor", proxy, deployer)) as Processor;
    };

    const processorA = await deployProcessor(assetA, receiverA);
    const processorB = await deployProcessor(assetB, receiverB);

    const netter = (await deploy("Netter", deployer, {}, oracle, admin, caller)) as Netter;

    await processorA.connect(admin).grantRole(CALLER_ROLE, netter);
    await processorB.connect(admin).grantRole(CALLER_ROLE, netter);

    return {
      deployer, admin, caller, user, receiverA, receiverB,
      assetA, assetB, oracle, processorA, processorB, netter,
    };
  };

  describe("constructor", function () {
    it("reverts ZeroAddress when oracle is zero", async function () {
      const {admin, caller, netter} = await loadFixture(deployAll);
      await expect(deploy("Netter", admin, {}, ZERO_ADDRESS, admin, caller))
        .to.be.revertedWithCustomError(netter, "ZeroAddress");
    });

    it("reverts ZeroAddress when admin is zero", async function () {
      const {oracle, caller, netter} = await loadFixture(deployAll);
      await expect(deploy("Netter", caller, {}, oracle, ZERO_ADDRESS, caller))
        .to.be.revertedWithCustomError(netter, "ZeroAddress");
    });

    it("stores ORACLE and grants DEFAULT_ADMIN_ROLE and CALLER_ROLE", async function () {
      const {netter, oracle, admin, caller} = await loadFixture(deployAll);
      const DEFAULT_ADMIN_ROLE = await netter.DEFAULT_ADMIN_ROLE();
      const CALLER_ROLE = await netter.CALLER_ROLE();

      expect(await netter.ORACLE()).to.equal(oracle.target);
      expect(await netter.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.be.true;
      expect(await netter.hasRole(CALLER_ROLE, caller)).to.be.true;
      expect(await netter.hasRole(CALLER_ROLE, admin)).to.be.false;
    });
  });

  describe("net", function () {
    it("reverts AccessControlUnauthorizedAccount when caller lacks CALLER_ROLE", async function () {
      const {netter, user, processorA, processorB} = await loadFixture(deployAll);
      await expect(netter.connect(user).net(processorA, processorB, 1n, 1n))
        .to.be.revertedWithCustomError(netter, "AccessControlUnauthorizedAccount");
    });

    it("reverts ValuesNotEqual when oracle values do not match", async function () {
      const {netter, caller, processorA, processorB} = await loadFixture(deployAll);
      await expect(netter.connect(caller).net(processorA, processorB, 3_000n * WETH + 1n, 3_000n * USDC))
        .to.be.revertedWithCustomError(netter, "ValuesNotEqual");
      await expect(netter.connect(caller).net(processorA, processorB, 3_000n * WETH - 1n, 3_000n * USDC))
        .to.be.revertedWithCustomError(netter, "ValuesNotEqual");
    });

    it("forwards on both processors and emits Netted when values are equal", async function () {
      const {netter, caller, processorA, processorB, assetA, assetB, receiverA, receiverB} =
        await loadFixture(deployAll);

      const amountFromA = 4_000n * WETH;
      const amountFromB = 4_000n * USDC;

      await assetB.mint(processorA, amountFromA);
      await assetA.mint(processorB, amountFromB);

      const tx = await netter.connect(caller).net(processorA, processorB, amountFromA, amountFromB);

      await expect(tx).to.emit(netter, "Netted")
        .withArgs(processorA.target, processorB.target, amountFromA, amountFromB);
      await expect(tx).to.emit(processorA, "Forwarded")
        .withArgs(netter.target, assetB.target, amountFromA);
      await expect(tx).to.emit(processorB, "Forwarded")
        .withArgs(netter.target, assetA.target, amountFromB);

      expect(await assetB.balanceOf(processorA)).to.equal(0n);
      expect(await assetA.balanceOf(processorB)).to.equal(0n);
      expect(await assetB.balanceOf(receiverA)).to.equal(amountFromA);
      expect(await assetA.balanceOf(receiverB)).to.equal(amountFromB);
    });

    it("forwards on both processors and emits Netted when values are equal, swapped order", async function () {
      const {netter, caller, processorA, processorB, assetA, assetB, receiverA, receiverB} =
        await loadFixture(deployAll);

      const amountFromA = 4_000n * WETH;
      const amountFromB = 4_000n * USDC;

      await assetB.mint(processorA, amountFromA);
      await assetA.mint(processorB, amountFromB);

      const tx = await netter.connect(caller).net(processorB, processorA, amountFromB, amountFromA);

      await expect(tx).to.emit(netter, "Netted")
        .withArgs(processorB.target, processorA.target, amountFromB, amountFromA);
      await expect(tx).to.emit(processorA, "Forwarded")
        .withArgs(netter.target, assetB.target, amountFromA);
      await expect(tx).to.emit(processorB, "Forwarded")
        .withArgs(netter.target, assetA.target, amountFromB);

      expect(await assetB.balanceOf(processorA)).to.equal(0n);
      expect(await assetA.balanceOf(processorB)).to.equal(0n);
      expect(await assetB.balanceOf(receiverA)).to.equal(amountFromA);
      expect(await assetA.balanceOf(receiverB)).to.equal(amountFromB);
    });

    it("leaves unrelated balances untouched", async function () {
      const {netter, caller, processorA, processorB, assetA, assetB, receiverA, receiverB} =
        await loadFixture(deployAll);

      const amountFromA = 4_000n * WETH;
      const amountFromB = 4_000n * USDC;

      // processorA also holds some assetA; processorB also holds some assetB
      await assetB.mint(processorA, amountFromA);
      await assetA.mint(processorA, 1_000n * USDC);
      await assetA.mint(processorB, amountFromB);
      await assetB.mint(processorB, 2_000n * WETH);

      await netter.connect(caller).net(processorA, processorB, amountFromA, amountFromB);

      expect(await assetA.balanceOf(processorA)).to.equal(1_000n * USDC);
      expect(await assetB.balanceOf(processorB)).to.equal(2_000n * WETH);
      expect(await assetA.balanceOf(receiverA)).to.equal(0n);
      expect(await assetB.balanceOf(receiverB)).to.equal(0n);
    });
  });
});
