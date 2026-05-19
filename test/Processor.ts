import hre from "hardhat";
import {expect} from "chai";
import {
  getCreateAddress, getContractAt, deploy, deployX, toBytes32,
} from "./helpers";
import {
  TestUSDC, TransparentUpgradeableProxy, ProxyAdmin, Processor,
  Test4626,
  Test7540,
  TestRoyco, 
} from "../typechain-types";
import {loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {DEFAULT_ADMIN_ROLE} from "../scripts/common";

describe("Processor", function () {
  const deployAll = async () => {
    const [deployer, admin, caller, user, receiver] = await hre.ethers.getSigners();

    const CALLER_ROLE = toBytes32("CALLER_ROLE");

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const processorImpl = (
      await deployX("Processor", deployer, "Processor", {},
        usdc,
        receiver
      )
    ) as Processor;
    const processorInit = (await processorImpl.initialize.populateTransaction(
      admin,
      caller
    )).data;
    const reedemerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancer", {},
      processorImpl, admin, processorInit
    )) as TransparentUpgradeableProxy;
    const processor = (await getContractAt("Processor", reedemerProxy, deployer)) as Processor;
    const processorProxyAdminAddress = await getCreateAddress(reedemerProxy, 1);
    const processorAdmin = (await getContractAt("ProxyAdmin", processorProxyAdminAddress, admin)) as ProxyAdmin;

    const test4626 = (await deploy(
      "Test4626",
      deployer,
      {},
      await usdc.getAddress(), 
      "Test4626 USDC", 
      "tUSDC"
    )) as Test4626;
    const test7540 = (await deploy(
      "Test7540",
      deployer,
      {},
      await usdc.getAddress(), 
      "Test7540 USDC", 
      "t7540USDC",
    )) as Test7540;
    const testRoyco = (await deploy(
      "TestRoyco",
      deployer,
      {},
      await usdc.getAddress(), 
      "TestRoyco USDC", 
      "tRoycoUSDC",
    )) as TestRoyco;
    return {
      deployer, admin, caller, user, receiver, usdc, test4626, test7540, testRoyco,
      processor, processorAdmin, CALLER_ROLE, DEFAULT_ADMIN_ROLE
    };
  };
  
  it("Should revert when Redeemer initialize is called (disabled initializer)", async function () {
    const {
        processor, admin, caller
    } = await loadFixture(deployAll);

    await expect(
        processor.initialize(admin, caller),
    ).to.revertedWithCustomError(processor, "InvalidInitialization");
  });

  it("Should have default values", async function () {
    const {
        deployer, processor, admin, caller, receiver, usdc,
        CALLER_ROLE, DEFAULT_ADMIN_ROLE
    } = await loadFixture(deployAll);

    expect(await processor.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.be.true;
    expect(await processor.hasRole(DEFAULT_ADMIN_ROLE, deployer)).to.be.false;
    expect(await processor.hasRole(CALLER_ROLE, caller)).to.be.true;
    expect(await processor.hasRole(CALLER_ROLE, deployer)).to.be.false;
    expect(await processor.TARGET_ASSET()).to.be.equal(await usdc.getAddress())
    expect(await processor.RECEIVER()).to.be.equal(receiver.address)
  });
  
  it("Should revert when redeem7540 is called not by CALLER_ROLE", async function () {
    const {
        processor, user, test7540
    } = await loadFixture(deployAll);

    await expect(processor.connect(user).redeem7540(test7540))
      .to.revertedWithCustomError(processor, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when claim7540 is called not by CALLER_ROLE", async function () {
    const {
        processor, user, test7540
    } = await loadFixture(deployAll);

    await expect(processor.connect(user).claim7540(test7540))
      .to.revertedWithCustomError(processor, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when redeem4626 is called not by CALLER_ROLE", async function () {
    const {
        processor, user, test4626 
    } = await loadFixture(deployAll);

    await expect(processor.connect(user).redeem4626(test4626))
      .to.revertedWithCustomError(processor, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when withdraw4626 is called not by CALLER_ROLE", async function () {
    const {
        processor, user, test4626 
    } = await loadFixture(deployAll);

    await expect(processor.connect(user).withdraw4626(test4626))
      .to.revertedWithCustomError(processor, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when claimRoyco is called not by CALLER_ROLE", async function () {
    const {
        processor, user, test4626 
    } = await loadFixture(deployAll);

    await expect(processor.connect(user).claimRoyco(test4626, []))
      .to.revertedWithCustomError(processor, "AccessControlUnauthorizedAccount");
  });

  it("Should unwrap Test7540 shares via redeem7540 and claim7540", async function () {
    const {
        processor, receiver, caller, deployer, test7540, usdc
    } = await loadFixture(deployAll);
    
    const sharesAmount = 100_000000n;
    await usdc.mint(deployer, 1000_000000n);
    await usdc.connect(deployer).approve(test7540, sharesAmount);
    await test7540.connect(deployer).deposit(sharesAmount, processor);
    await processor.connect(caller).redeem7540(test7540);
    expect(await usdc.balanceOf(processor)).to.equal(0n);
    await processor.connect(caller).claim7540(test7540);
    expect(await usdc.balanceOf(processor)).to.equal(sharesAmount);
    expect(await usdc.balanceOf(receiver)).to.equal(0n);
    await processor.connect(caller).forward(usdc);
    expect(await usdc.balanceOf(processor)).to.equal(0n);
    expect(await usdc.balanceOf(receiver)).to.equal(sharesAmount);
  });

  it("Should unwrap Test4626 shares via redeem4626", async function () {
    const {
        processor, receiver, caller, deployer, test4626, usdc
    } = await loadFixture(deployAll);
    
    const sharesAmount = 100_000000n;
    await usdc.mint(deployer, 1000_000000n);
    await usdc.connect(deployer).approve(test4626, sharesAmount);
    await test4626.connect(deployer).deposit(sharesAmount, processor);
    await processor.connect(caller).redeem4626(test4626);
    expect(await usdc.balanceOf(processor)).to.equal(sharesAmount);
    expect(await usdc.balanceOf(receiver)).to.equal(0n);
    await processor.connect(caller).forward(usdc);
    expect(await usdc.balanceOf(processor)).to.equal(0n);
    expect(await usdc.balanceOf(receiver)).to.equal(sharesAmount);
  });

  it("Should unwrap Test4626 shares via withdraw4626", async function () {
    const {
        processor, receiver, caller, deployer, test4626, usdc
    } = await loadFixture(deployAll);
    
    const sharesAmount = 100_000000n;
    await usdc.mint(deployer, 1000_000000n);
    await usdc.connect(deployer).approve(test4626, sharesAmount);
    await test4626.connect(deployer).deposit(sharesAmount, processor);
    await processor.connect(caller).withdraw4626(test4626);
    expect(await usdc.balanceOf(processor)).to.equal(sharesAmount);
    expect(await usdc.balanceOf(receiver)).to.equal(0n);
    await processor.connect(caller).forward(usdc);
    expect(await usdc.balanceOf(processor)).to.equal(0n);
    expect(await usdc.balanceOf(receiver)).to.equal(sharesAmount);
  });

  it("Should unwrap TestRoyco shares via claimWithdrawal", async function () {
    const {
        processor, receiver, caller, deployer, testRoyco, usdc
    } = await loadFixture(deployAll);
    
    const sharesAmount = 100_000000n;
    await usdc.mint(deployer, 1000_000000n);
    await usdc.connect(deployer).approve(testRoyco, sharesAmount);
    await testRoyco.connect(deployer).deposit(sharesAmount, processor);
    await processor.connect(caller).withdraw4626(testRoyco);
    expect(await usdc.balanceOf(processor)).to.equal(0n);
    await processor.connect(caller).claimRoyco(testRoyco, []);
    expect(await usdc.balanceOf(processor)).to.equal(sharesAmount);
    expect(await usdc.balanceOf(receiver)).to.equal(0n);
    await processor.connect(caller).forward(usdc);
    expect(await usdc.balanceOf(processor)).to.equal(0n);
    expect(await usdc.balanceOf(receiver)).to.equal(sharesAmount);
  });
});
