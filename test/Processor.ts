import hre from "hardhat";
import {expect} from "chai";
import {
  getCreateAddress, getContractAt, deploy, deployX, toBytes32,
  setupTests, getBalance,
} from "./helpers";
import {
  TestUSDC, TransparentUpgradeableProxy, ProxyAdmin, Processor,
  Test4626,
  Test7540,
  TestRoyco,
  SubProcessor,
  MockTarget,
} from "../typechain-types";
import {loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {DEFAULT_ADMIN_ROLE} from "../scripts/common";

describe("Processor", function () {
  setupTests();

  const deployAll = async () => {
    const [deployer, admin, caller, user, receiver, config] = await hre.ethers.getSigners();

    const CALLER_ROLE = toBytes32("CALLER_ROLE");
    const CONFIG_ROLE = toBytes32("CONFIG_ROLE");

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const processorImpl = (
      await deployX("Processor", deployer, "Processor", {},
        usdc,
        receiver
      )
    ) as Processor;
    const processorInit = (await processorImpl.initialize.populateTransaction(
      admin,
      caller,
      config
    )).data;
    const reedemerProxy = (await deployX(
      "TransparentUpgradeableProxy", deployer, "TransparentUpgradeableProxyRedeemer", {},
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
      processor, processorAdmin, CALLER_ROLE, DEFAULT_ADMIN_ROLE, config, CONFIG_ROLE,
    };
  };

  it("Should revert when Processor initialize is called (disabled initializer)", async function () {
    const {
        processor, admin, caller, config
    } = await loadFixture(deployAll);

    await expect(
        processor.initialize(admin, caller, config),
    ).to.revertedWithCustomError(processor, "InvalidInitialization");
  });

  it("Should revert when Processor initializeSubProcessor is called (already initialized)", async function () {
    const {
        processor
    } = await loadFixture(deployAll);

    await expect(
        processor.initializeSubProcessor(),
    ).to.revertedWithCustomError(processor, "AlreadyInitialized");
  });

  it("Should have default values", async function () {
    const {
        deployer, processor, admin, caller, receiver, usdc,
        CALLER_ROLE, DEFAULT_ADMIN_ROLE, config, CONFIG_ROLE,
    } = await loadFixture(deployAll);

    expect(await processor.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.be.true;
    expect(await processor.hasRole(DEFAULT_ADMIN_ROLE, deployer)).to.be.false;
    expect(await processor.hasRole(CALLER_ROLE, caller)).to.be.true;
    expect(await processor.hasRole(CALLER_ROLE, deployer)).to.be.false;
    expect(await processor.hasRole(CONFIG_ROLE, config)).to.be.true;
    expect(await processor.hasRole(CONFIG_ROLE, deployer)).to.be.false;
    expect(await processor.TARGET_ASSET()).to.be.equal(await usdc.getAddress())
    expect(await processor.RECEIVER()).to.be.equal(receiver.address)
    expect(await processor.maxSlippage()).to.be.equal(3_00n)
    expect(await processor.MULTIPLIER()).to.be.equal(10000n)
    const subProcessorAddress = await processor.subProcessor();
    expect(subProcessorAddress).to.not.equal(hre.ethers.ZeroAddress);
    const subProcessor = await getContractAt("SubProcessor", subProcessorAddress, deployer) as SubProcessor;
    expect(await subProcessor.ASSET()).to.equal(await usdc.getAddress());
    expect(await subProcessor.OWNER()).to.equal(await processor.getAddress());
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

  it("Should revert when cancelRoyco is called not by CALLER_ROLE", async function () {
    const {processor, user, testRoyco} = await loadFixture(deployAll);

    await expect(processor.connect(user).cancelRoyco(testRoyco, 0n))
      .to.revertedWithCustomError(processor, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when process4626 is called not by CALLER_ROLE", async function () {
    const {processor, user, test4626} = await loadFixture(deployAll);

    await expect(processor.connect(user).process4626(test4626, 1n, 1n, []))
      .to.revertedWithCustomError(processor, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when adminProcess is called not by CONFIG_ROLE", async function () {
    const {processor, user} = await loadFixture(deployAll);

    await expect(processor.connect(user).adminProcess([]))
      .to.revertedWithCustomError(processor, "AccessControlUnauthorizedAccount");
  });

  it("Should revert when setMaxSlippage is called not by CONFIG_ROLE", async function () {
    const {processor, user} = await loadFixture(deployAll);

    await expect(processor.connect(user).setMaxSlippage(500n))
      .to.revertedWithCustomError(processor, "AccessControlUnauthorizedAccount");
  });

  it("Should allow setting max slippage", async function () {
    const {processor, config} = await loadFixture(deployAll);

    const newSlippage = 500n;
    await expect(processor.connect(config).setMaxSlippage(newSlippage))
      .to.emit(processor, "MaxSlippageSet").withArgs(newSlippage);
    expect(await processor.maxSlippage()).to.equal(newSlippage);
  });

  it("Should NOT allow setting max slippage to be >= MULTIPLIER", async function () {
    const {processor, config} = await loadFixture(deployAll);

    await expect(processor.connect(config).setMaxSlippage(10000n))
      .to.revertedWithCustomError(processor, "InvalidSlippage");
    await expect(processor.connect(config).setMaxSlippage(10001n))
      .to.revertedWithCustomError(processor, "InvalidSlippage");
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

  it("Should call cancelRequest on token via cancelRoyco", async function () {
    const {processor, caller, testRoyco} = await loadFixture(deployAll);

    await expect(processor.connect(caller).cancelRoyco(testRoyco, 0n))
      .to.not.be.reverted;
  });

  it("Should execute adminProcess with empty calls", async function () {
    const {config, processor} = await loadFixture(deployAll);
    await expect(processor.connect(config).adminProcess([]))
      .to.emit(processor, "AdminProcessed").withArgs(config.address);
  });

  it("Should transfer remaining SubProcessor asset balance to Processor on adminProcess", async function () {
    const {config, usdc, processor} = await loadFixture(deployAll);
    const subProcessorAddress = await processor.subProcessor();
    await usdc.mint(subProcessorAddress, 50_000000n);

    await expect(processor.connect(config).adminProcess([]))
      .to.emit(processor, "AdminProcessed");

    expect(await usdc.balanceOf(subProcessorAddress)).to.equal(0n);
    expect(await usdc.balanceOf(processor)).to.equal(50_000000n);
  });

  it("Should successfully process 4626 shares", async function () {
    const {deployer, caller, receiver, usdc, processor, test4626} =
      await loadFixture(deployAll);

    const amountIn = 100_000000n;
    // Minimum accepted with 3% default slippage: 100 * 0.97 = 97_000000
    const amountOutMin = 97_000000n;
    await usdc.mint(deployer, amountIn);
    await usdc.connect(deployer).approve(test4626, amountIn);
    await test4626.connect(deployer).deposit(amountIn, processor);

    const subProcessorAddress = await processor.subProcessor();
    await usdc.mint(subProcessorAddress, amountOutMin);

    await expect(
      processor.connect(caller).process4626(test4626, amountIn, amountOutMin, [])
    ).to.emit(processor, "Processed").withArgs(caller.address, await test4626.getAddress(), amountIn, amountOutMin);

    expect(await usdc.balanceOf(receiver)).to.equal(amountOutMin);
    expect(await usdc.balanceOf(processor)).to.equal(0n);
    expect(await usdc.balanceOf(subProcessorAddress)).to.equal(0n);
    expect(await test4626.balanceOf(receiver)).to.equal(0n);
    expect(await test4626.balanceOf(processor)).to.equal(0n);
    expect(await test4626.balanceOf(subProcessorAddress)).to.equal(amountIn);
  });

  it("Should revert process 4626 shares when amountOut is less than amountOutMin", async function () {
    const {deployer, caller, usdc, processor, test4626} =
      await loadFixture(deployAll);

    const amountIn = 100_000000n;
    // amountOutMin = 97_000000 passes the slippage check (97% of 100), but actual
    // output of 90_000000 is below it, triggering InsufficientAssets.
    const amountOutMin = 97_000000n;
    await usdc.mint(deployer, amountIn);
    await usdc.connect(deployer).approve(test4626, amountIn);
    await test4626.connect(deployer).deposit(amountIn, processor);

    const subProcessorAddress = await processor.subProcessor();
    await usdc.mint(subProcessorAddress, 90_000000n);

    await expect(
      processor.connect(caller).process4626(test4626, amountIn, amountOutMin, [])
    ).to.revertedWithCustomError(processor, "InsufficientAssets");
  });

  it("Should revert process 4626 shares when slippage is too high", async function () {
    const {deployer, caller, usdc, processor, test4626} =
      await loadFixture(deployAll);

    // Deposit 100 USDC to get 100 shares at 1:1
    await usdc.mint(deployer, 100_000000n);
    await usdc.connect(deployer).approve(test4626, 100_000000n);
    await test4626.connect(deployer).deposit(100_000000n, deployer);

    // Mint 100 USDC directly into the vault → 1 share now = 2 USDC (2:1 rate)
    await usdc.mint(test4626, 100_000000n);

    // Transfer 100 shares to processor
    const sharesIn = 100_000000n;
    await test4626.connect(deployer).transfer(processor, sharesIn);

    // convertToAssets(100_000000) = 200_000000 at the 2:1 rate
    // minExpected = 200_000000 * (10000 - 300) / 10000 = 194_000000
    // amountOutMin = 193_000000 < 194_000000 → SlippageTooHigh
    // (if slippage were checked against sharesIn, 193_000000 > 97_000000 would pass — confirming
    // the check uses convertToAssets() and not the raw share count)
    const amountOutMin = 193_000000n;

    await expect(
      processor.connect(caller).process4626(test4626, sharesIn, amountOutMin, [])
    ).to.revertedWithCustomError(processor, "SlippageTooHigh");
  });

  it("Should revert process 4626 when amountIn is zero", async function () {
    const {caller, processor, test4626} =
      await loadFixture(deployAll);

    await expect(
      processor.connect(caller).process4626(test4626, 0n, 1n, [])
    ).to.revertedWithCustomError(processor, "ZeroAmount");
  });

  it("Should verify that SubProcessor can receive native token", async function () {
    const {deployer, processor} = await loadFixture(deployAll);

    const subProcessorAddress = await processor.subProcessor();
    const amount = hre.ethers.parseEther("1.0");
    await deployer.sendTransaction({to: subProcessorAddress, value: amount});

    expect(await getBalance(subProcessorAddress)).to.equal(amount);
  });

  it("Should revert when SubProcessor process() is called by non-owner", async function () {
    const {user, processor} = await loadFixture(deployAll);

    const subProcessorAddress = await processor.subProcessor();
    const subProcessor = await getContractAt("SubProcessor", subProcessorAddress, user) as SubProcessor;

    await expect(subProcessor.connect(user).process([]))
      .to.revertedWithCustomError(subProcessor, "OnlyOwner");
  });

  it("Should confirm SubProcessor process() respects value parameter in calls", async function () {
    const {deployer, usdc} = await loadFixture(deployAll);

    const freshSubProcessor = await deploy(
      "SubProcessor", deployer, {}, await usdc.getAddress()
    ) as SubProcessor;
    const subProcAddr = await freshSubProcessor.getAddress();

    // Fund SubProcessor with 1 ETH
    const ethFunded = hre.ethers.parseEther("1.0");
    await deployer.sendTransaction({to: subProcAddr, value: ethFunded});

    // Call MockTarget.fulfillSkip() forwarding 0.6 ETH
    const mockTarget = await deploy("MockTarget", deployer, {}) as MockTarget;
    const sentValue = hre.ethers.parseEther("0.6");
    const calls = [{
      target: await mockTarget.getAddress() as string,
      value: sentValue,
      data: mockTarget.interface.encodeFunctionData("fulfillSkip"),
    }];

    await freshSubProcessor.connect(deployer).process(calls);

    expect(await getBalance(mockTarget)).to.equal(sentValue);
    expect(await getBalance(subProcAddr)).to.equal(ethFunded - sentValue);
  });

  it("Should confirm SubProcessor process() makes correct calls and sweeps remaining balance to owner",
    async function () {
    const {deployer, usdc, user} = await loadFixture(deployAll);

    // Deploy a fresh SubProcessor with deployer as owner for direct testing
    const freshSubProcessor = await deploy(
      "SubProcessor", deployer, {}, await usdc.getAddress()
    ) as SubProcessor;
    const subProcAddr = await freshSubProcessor.getAddress();

    await usdc.mint(subProcAddr, 100_000000n);

    // Encode a call that transfers 40 USDC from SubProcessor to user
    const calls = [{
      target: await usdc.getAddress() as string,
      value: 0n,
      data: usdc.interface.encodeFunctionData("transfer", [user.address, 40_000000n]),
    }];

    const deployerBefore = await usdc.balanceOf(deployer);
    await freshSubProcessor.connect(deployer).process(calls);

    // The encoded call moved 40 to user; remaining 60 swept to deployer (owner)
    expect(await usdc.balanceOf(user)).to.equal(40_000000n);
    expect(await usdc.balanceOf(deployer)).to.equal(deployerBefore + 60_000000n);
    expect(await usdc.balanceOf(subProcAddr)).to.equal(0n);
  });
});
