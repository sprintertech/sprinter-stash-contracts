import hre from "hardhat";
import {expect} from "chai";
import {
  getCreateAddress, getContractAt, deploy, deployX, toBytes32,
} from "./helpers";
import {
  TestUSDC, TransparentUpgradeableProxy, ProxyAdmin, Redeemer,
  Test4626,
  Test7540,
  TestRoyco, 
} from "../typechain-types";
import {loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {DEFAULT_ADMIN_ROLE} from "../scripts/common";

describe("Redeemer", function () {
  const deployAll = async () => {
    const [deployer, admin, caller, user, receiver] = await hre.ethers.getSigners();

    const CALLER_ROLE = toBytes32("CALLER_ROLE");

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const redeemerImpl = (
      await deployX("Redeemer", deployer, "Redeemer", {},
        usdc,
        receiver
      )
    ) as Redeemer;
    const redeemerInit = (await redeemerImpl.initialize.populateTransaction(
      admin,
      caller
    )).data;
    const reedemerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRebalancer", {},
      redeemerImpl, admin, redeemerInit
    )) as TransparentUpgradeableProxy;
    const redeemer = (await getContractAt("Redeemer", reedemerProxy, deployer)) as Redeemer;
    const redeemerProxyAdminAddress = await getCreateAddress(reedemerProxy, 1);
    const redeemerAdmin = (await getContractAt("ProxyAdmin", redeemerProxyAdminAddress, admin)) as ProxyAdmin;

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
      redeemer, redeemerAdmin, CALLER_ROLE, DEFAULT_ADMIN_ROLE
    };
  };
  
  it("Should revert when Redeemer initialize is called (disabled initializer)", async function () {
    const {
        redeemer, admin, caller
    } = await loadFixture(deployAll);

    await expect(
        redeemer.initialize(admin, caller),
    ).to.revertedWithCustomError(redeemer, "InvalidInitialization");
  });

  it("Should have default values", async function () {
    const {
        deployer, redeemer, admin, caller, receiver, usdc,
        CALLER_ROLE, DEFAULT_ADMIN_ROLE
    } = await loadFixture(deployAll);

    expect(await redeemer.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.be.true;
    expect(await redeemer.hasRole(DEFAULT_ADMIN_ROLE, deployer)).to.be.false;
    expect(await redeemer.hasRole(CALLER_ROLE, caller)).to.be.true;
    expect(await redeemer.hasRole(CALLER_ROLE, deployer)).to.be.false;
    expect(await redeemer.TARGET_ASSET()).to.be.equal(await usdc.getAddress())
    expect(await redeemer.RECEIVER()).to.be.equal(receiver.address)
  });
  
  it("Should revert when redeem7540 is called not by CALLER_ROLE", async function () {
    const {
        redeemer, user, test7540
    } = await loadFixture(deployAll);

    await expect(redeemer.connect(user).redeem7540(test7540))
      .to.revertedWithCustomError(redeemer, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when claim7540 is called not by CALLER_ROLE", async function () {
    const {
        redeemer, user, test7540
    } = await loadFixture(deployAll);

    await expect(redeemer.connect(user).claim7540(test7540))
      .to.revertedWithCustomError(redeemer, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when redeem4626 is called not by CALLER_ROLE", async function () {
    const {
        redeemer, user, test4626 
    } = await loadFixture(deployAll);

    await expect(redeemer.connect(user).redeem4626(test4626))
      .to.revertedWithCustomError(redeemer, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when withdraw4626 is called not by CALLER_ROLE", async function () {
    const {
        redeemer, user, test4626 
    } = await loadFixture(deployAll);

    await expect(redeemer.connect(user).withdraw4626(test4626))
      .to.revertedWithCustomError(redeemer, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when claimRoyco is called not by CALLER_ROLE", async function () {
    const {
        redeemer, user, test4626 
    } = await loadFixture(deployAll);

    await expect(redeemer.connect(user).claimRoyco(test4626, []))
      .to.revertedWithCustomError(redeemer, "AccessControlUnauthorizedAccount");
  });

  it("Should unwrap Test7540 shares via redeem7540 and claim7540", async function () {
    const {
        redeemer, receiver, caller, deployer, test7540, usdc
    } = await loadFixture(deployAll);
    
    const sharesAmount = 100_000000n;
    await usdc.mint(deployer, 1000_000000n);
    await usdc.connect(deployer).approve(test7540, sharesAmount);
    await test7540.connect(deployer).deposit(sharesAmount, redeemer);
    await redeemer.connect(caller).redeem7540(test7540);
    expect(await usdc.balanceOf(redeemer)).to.equal(0n);
    await redeemer.connect(caller).claim7540(test7540);
    expect(await usdc.balanceOf(redeemer)).to.equal(sharesAmount);
    expect(await usdc.balanceOf(receiver)).to.equal(0n);
    await redeemer.connect(caller).forward(usdc);
    expect(await usdc.balanceOf(redeemer)).to.equal(0n);
    expect(await usdc.balanceOf(receiver)).to.equal(sharesAmount);
  });

  it("Should unwrap Test4626 shares via redeem4626", async function () {
    const {
        redeemer, receiver, caller, deployer, test4626, usdc
    } = await loadFixture(deployAll);
    
    const sharesAmount = 100_000000n;
    await usdc.mint(deployer, 1000_000000n);
    await usdc.connect(deployer).approve(test4626, sharesAmount);
    await test4626.connect(deployer).deposit(sharesAmount, redeemer);
    await redeemer.connect(caller).redeem4626(test4626);
    expect(await usdc.balanceOf(redeemer)).to.equal(sharesAmount);
    expect(await usdc.balanceOf(receiver)).to.equal(0n);
    await redeemer.connect(caller).forward(usdc);
    expect(await usdc.balanceOf(redeemer)).to.equal(0n);
    expect(await usdc.balanceOf(receiver)).to.equal(sharesAmount);
  });

  it("Should unwrap Test4626 shares via withdraw4626", async function () {
    const {
        redeemer, receiver, caller, deployer, test4626, usdc
    } = await loadFixture(deployAll);
    
    const sharesAmount = 100_000000n;
    await usdc.mint(deployer, 1000_000000n);
    await usdc.connect(deployer).approve(test4626, sharesAmount);
    await test4626.connect(deployer).deposit(sharesAmount, redeemer);
    await redeemer.connect(caller).withdraw4626(test4626);
    expect(await usdc.balanceOf(redeemer)).to.equal(sharesAmount);
    expect(await usdc.balanceOf(receiver)).to.equal(0n);
    await redeemer.connect(caller).forward(usdc);
    expect(await usdc.balanceOf(redeemer)).to.equal(0n);
    expect(await usdc.balanceOf(receiver)).to.equal(sharesAmount);
  });

  it("Should unwrap TestRoyco shares via claimWithdrawal", async function () {
    const {
        redeemer, receiver, caller, deployer, testRoyco, usdc
    } = await loadFixture(deployAll);
    
    const sharesAmount = 100_000000n;
    await usdc.mint(deployer, 1000_000000n);
    await usdc.connect(deployer).approve(testRoyco, sharesAmount);
    await testRoyco.connect(deployer).deposit(sharesAmount, redeemer);
    await redeemer.connect(caller).withdraw4626(testRoyco);
    expect(await usdc.balanceOf(redeemer)).to.equal(0n);
    await redeemer.connect(caller).claimRoyco(testRoyco, []);
    expect(await usdc.balanceOf(redeemer)).to.equal(sharesAmount);
    expect(await usdc.balanceOf(receiver)).to.equal(0n);
    await redeemer.connect(caller).forward(usdc);
    expect(await usdc.balanceOf(redeemer)).to.equal(0n);
    expect(await usdc.balanceOf(receiver)).to.equal(sharesAmount);
  });
});
