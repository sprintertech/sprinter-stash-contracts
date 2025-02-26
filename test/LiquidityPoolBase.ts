import {
  loadFixture, time
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, signBorrow, signBorrowAndSwap, ZERO_ADDRESS
} from "./helpers";
import {encodeBytes32String, AbiCoder} from "ethers";
import {
  MockTarget, MockBorrowSwap, LiquidityPoolBase
} from "../typechain-types";

async function now() {
  return BigInt(await time.latest());
}

describe("LiquidityPoolBase", function () {
  const deployAll = async () => {
    const [
      deployer, admin, user, user2, mpc_signer, liquidityAdmin, withdrawProfit, pauser
    ] = await hre.ethers.getSigners();

    const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    if (!USDC_OWNER_ADDRESS) throw new Error("Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const usdc = await hre.ethers.getContractAt("ERC20", USDC_ADDRESS);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const RPL_ADDRESS = "0xD33526068D116cE69F19A9ee46F0bd304F21A51f";
    const RPL_OWNER_ADDRESS = process.env.RPL_OWNER_ADDRESS!;
    if (!RPL_OWNER_ADDRESS) throw new Error("Env variables not configured (RPL_OWNER_ADDRESS missing)");
    const rpl = await hre.ethers.getContractAt("ERC20", RPL_ADDRESS);
    const rplOwner = await hre.ethers.getImpersonatedSigner(RPL_OWNER_ADDRESS);

    const UNI_ADDRESS = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
    const UNI_OWNER_ADDRESS = process.env.UNI_OWNER_ADDRESS!;
    if (!UNI_OWNER_ADDRESS) throw new Error("Env variables not configured (UNI_OWNER_ADDRESS missing)");
    const uni = await hre.ethers.getContractAt("ERC20", UNI_ADDRESS);
    const uniOwner = await hre.ethers.getImpersonatedSigner(UNI_OWNER_ADDRESS);

    const USDC_DEC = 10n ** (await usdc.decimals());
    const RPL_DEC = 10n ** (await rpl.decimals());
    const UNI_DEC = 10n ** (await uni.decimals());

    const liquidityPoolBase = (
      await deploy("LiquidityPoolBase", deployer, {},
        usdc.target, admin.address, mpc_signer.address
      )
    ) as LiquidityPoolBase;

    const mockTarget = (
      await deploy("MockTarget", deployer)
    ) as MockTarget;

    const mockBorrowSwap = (
      await deploy("MockBorrowSwap", deployer)
    ) as MockBorrowSwap;

    const LIQUIDITY_ADMIN_ROLE = encodeBytes32String("LIQUIDITY_ADMIN_ROLE");
    await liquidityPoolBase.connect(admin).grantRole(LIQUIDITY_ADMIN_ROLE, liquidityAdmin.address);

    const WITHDRAW_PROFIT_ROLE = encodeBytes32String("WITHDRAW_PROFIT_ROLE");
    await liquidityPoolBase.connect(admin).grantRole(WITHDRAW_PROFIT_ROLE, withdrawProfit.address);

    const PAUSER_ROLE = encodeBytes32String("PAUSER_ROLE");
    await liquidityPoolBase.connect(admin).grantRole(PAUSER_ROLE, pauser.address);

    return {deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, rpl, rplOwner, uni, uniOwner,
      liquidityPoolBase, mockTarget, mockBorrowSwap, USDC_DEC, RPL_DEC, UNI_DEC,
      liquidityAdmin, withdrawProfit, pauser};
  };

  describe("Initialization", function () {
    it("Should initialize the contract with correct values", async function () {
      const {liquidityPoolBase, usdc, mpc_signer} = await loadFixture(deployAll);
      expect(await liquidityPoolBase.ASSETS())
        .to.be.eq(usdc.target);
      expect(await liquidityPoolBase.mpcAddress())
        .to.be.eq(mpc_signer);
    });

    it("Should NOT deploy the contract if liquidity token address is 0", async function () {
      const {deployer, liquidityPoolBase, admin, mpc_signer} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPoolBase", deployer, {}, 
        ZERO_ADDRESS, admin, mpc_signer.address
      )).to.be.revertedWithCustomError(liquidityPoolBase, "ZeroAddress");
    });

    it("Should NOT deploy the contract if admin address is 0", async function () {
      const {deployer, liquidityPoolBase, usdc, mpc_signer} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPoolBase", deployer, {}, 
        usdc, ZERO_ADDRESS, mpc_signer.address
      )).to.be.revertedWithCustomError(liquidityPoolBase, "ZeroAddress");
    });

    it("Should NOT deploy the contract if MPC address is 0", async function () {
      const {deployer, liquidityPoolBase, usdc, admin} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPoolBase", deployer, {}, 
        usdc, admin, ZERO_ADDRESS
      )).to.be.revertedWithCustomError(liquidityPoolBase, "ZeroAddress");
    });
  });

  describe("Borrow, supply, withdraw", function () {
    it("Should deposit to the pool", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amount);
    });

    it("Should deposit to the pool with pulling funds", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).approve(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(usdcOwner).depositWithPull(amount))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(usdcOwner, amount);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amount);
    });

    it("Should borrow a token with contract call", async function () {
      const {
        liquidityPoolBase, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);  
      expect(await usdc.balanceOf(liquidityPoolBase.target)).to.be.lessThan(amountLiquidity);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget.target)).to.eq(amountToBorrow);
    });
  
    it("Should borrow a token with swap", async function () {
      // USDC is borrowed and swapped to UNI
      const {
        liquidityPoolBase, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, uni, UNI_DEC, uniOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * UNI_DEC;
      await uni.connect(uniOwner).approve(mockBorrowSwap.target, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(uni.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [usdc.target, amountToBorrow, uni.target, uniOwner.address, fillAmount]
          );

      const signature = await signBorrowAndSwap(
        mpc_signer,
        liquidityPoolBase.target as string,
        mockBorrowSwap.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        uni.target as string,
        fillAmount.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolBase.borrowAndSwap.populateTransaction(
        usdc.target,
        amountToBorrow,
        {fillToken: uni.target,
        fillAmount,
        swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolBase.target, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData) 
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);  
      expect(await usdc.balanceOf(liquidityPoolBase.target)).to.be.lessThan(amountLiquidity);
      expect(await usdc.balanceOf(mockBorrowSwap.target)).to.eq(amountToBorrow);
      expect(await uni.balanceOf(liquidityPoolBase.target)).to.eq(0);
      expect(await uni.balanceOf(mockTarget.target)).to.eq(fillAmount);
    });

    it("Should deposit when the contract is paused", async function () {
      const {liquidityPoolBase, pauser, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(pauser).pause())
        .to.emit(liquidityPoolBase, "Paused");
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");
      await usdc.connect(usdcOwner).approve(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(usdcOwner).depositWithPull(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(usdcOwner, amountLiquidity);
    });

    it("Should withdraw liquidity", async function () {
      const {
        liquidityPoolBase, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amount);

      await expect(liquidityPoolBase.connect(liquidityAdmin).withdraw(user.address, amount))
        .to.emit(liquidityPoolBase, "Withdraw").withArgs(liquidityAdmin, user.address, amount);
      expect(await usdc.balanceOf(user.address)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPoolBase.target)).to.eq(0);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(0);
    });

    it("Should withdraw profit for multiple tokens from the pool", async function () {
      const {
        liquidityPoolBase, uni, rpl, UNI_DEC, uniOwner, rplOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * UNI_DEC;
      const amountRpl = 1n * UNI_DEC;
      await uni.connect(uniOwner).transfer(liquidityPoolBase.target, amountUni);
      await rpl.connect(rplOwner).transfer(liquidityPoolBase.target, amountRpl);
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([uni.target, rpl.target], user.address))
        .to.emit(liquidityPoolBase, "ProfitWithdrawn").withArgs(uni.target, user.address, amountUni)
        .and.to.emit(liquidityPoolBase, "ProfitWithdrawn").withArgs(rpl.target, user.address, amountRpl);
      expect(await uni.balanceOf(user.address)).to.eq(amountUni);
      expect(await rpl.balanceOf(user.address)).to.eq(amountRpl);
    });

    it("Should withdraw liquidity as profit from the pool", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, usdcOwner, withdrawProfit, liquidityAdmin, user
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");
      const amountProfit = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountProfit);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amountLiquidity);
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.emit(liquidityPoolBase, "ProfitWithdrawn").withArgs(usdc.target, user.address, amountProfit);
      expect(await usdc.balanceOf(user.address)).to.eq(amountProfit);
      expect(await usdc.balanceOf(liquidityPoolBase.target)).to.eq(amountLiquidity);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amountLiquidity);
    });

    it("Should withdraw all available balance as profit ", async function () {
      const {liquidityPoolBase, usdc, USDC_DEC, usdcOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.emit(liquidityPoolBase, "ProfitWithdrawn").withArgs(usdc.target, user.address, amount);
      expect(await usdc.balanceOf(user.address)).to.eq(amount);
    });

    it("Should NOT deposit if no collateral on contract", async function () {
      const {liquidityPoolBase, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(10))
        .to.be.revertedWithCustomError(liquidityPoolBase, "NotEnoughToDeposit");
    });

    it("Should NOT borrow if MPC signature is wrong", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        user,
        liquidityPoolBase.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidSignature");
    });

    it("Should NOT borrow if MPC signature nonce is reused", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPoolBase.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      await expect(liquidityPoolBase.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "NonceAlreadyUsed");
    });

    it("Should NOT borrow if MPC signature is expired", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        0n,
        deadline,
      );

      await expect(liquidityPoolBase.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        deadline,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "ExpiredSignature");
    });

    it("Should NOT borrow if target call fails", async function () {
      const {
        liquidityPoolBase, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        usdc.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        usdc.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "TargetCallFailed");
    });

    it("Should NOT borrow if borrowing is paused", async function () {
      const {liquidityPoolBase, user, user2, withdrawProfit, mpc_signer, usdc, USDC_DEC} = await loadFixture(deployAll);
      
      // Pause borrowing
      await expect(liquidityPoolBase.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPoolBase, "BorrowPaused");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "BorrowingIsPaused");
    });

    it("Should NOT borrow if the contract is paused", async function () {
      const {liquidityPoolBase, usdc, user, user2, pauser} = await loadFixture(deployAll);
      
      // Pause the contract
      await expect(liquidityPoolBase.connect(pauser).pause())
        .to.emit(liquidityPoolBase, "Paused");

      await expect(liquidityPoolBase.connect(user).borrow(
        usdc.target,
        1,
        user2,
        "0x",
        0n,
        2000000000n,
        "0x"))
      .to.be.revertedWithCustomError(liquidityPoolBase, "EnforcedPause");
    });

    it("Should NOT borrow and swap if MPC signature is wrong (caller is wrong)", async function () {
      // USDC is borrowed and swapped to UNI
      const {
        liquidityPoolBase, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, uni, UNI_DEC, uniOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * UNI_DEC;
      await uni.connect(uniOwner).approve(mockBorrowSwap.target, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(uni.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [usdc.target, amountToBorrow, uni.target, uniOwner.address, fillAmount]
          );

      // user address is signed instead of mockBorrowSwap address
      const signature = await signBorrowAndSwap(
        mpc_signer,
        liquidityPoolBase.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        uni.target as string,
        fillAmount.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolBase.borrowAndSwap.populateTransaction(
        usdc.target,
        amountToBorrow,
        {fillToken: uni.target,
        fillAmount,
        swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolBase.target, borrowCalldata.data))
        .to.be.reverted;
    });

    it("Should NOT borrow and swap if the swap fails", async function () {
      // USDC is borrowed and swapped to UNI
      const {
        liquidityPoolBase, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, uni, UNI_DEC, uniOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * UNI_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(uni.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [usdc.target, amountToBorrow, uni.target, uniOwner.address, fillAmount]
          );

      const signature = await signBorrowAndSwap(
        mpc_signer,
        liquidityPoolBase.target as string,
        mockBorrowSwap.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        uni.target as string,
        fillAmount.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolBase.borrowAndSwap.populateTransaction(
        usdc.target,
        amountToBorrow,
        {fillToken: uni.target,
        fillAmount,
        swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      // No UNI tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolBase.target, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT withdraw liquidity if not enough on contract", async function () {
      const {liquidityPoolBase, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolBase, "Deposit");

      await expect(liquidityPoolBase.connect(liquidityAdmin).withdraw(user.address, amount * 2n))
        .to.be.reverted;
    });

    it("Should NOT withdraw profit as liquidity", async function () {
      const {liquidityPoolBase, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount - 1n))
        .to.emit(liquidityPoolBase, "Deposit");
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amount - 1n);

      await expect(liquidityPoolBase.connect(liquidityAdmin).withdraw(user.address, amount))
        .to.be.revertedWithCustomError(liquidityPoolBase, "InsufficientLiquidity");
    });

    it("Should NOT withdraw liquidity if the contract is paused", async function () {
      const {liquidityPoolBase, user, liquidityAdmin, pauser} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(pauser).pause())
        .to.emit(liquidityPoolBase, "Paused");
      
      await expect(liquidityPoolBase.connect(liquidityAdmin).withdraw(user.address, 10))
        .to.be.revertedWithCustomError(liquidityPoolBase, "EnforcedPause");
    });

    it("Should NOT withdraw profit if the contract is paused", async function () {
      const {liquidityPoolBase, user, usdc, withdrawProfit, pauser} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(pauser).pause())
        .to.emit(liquidityPoolBase, "Paused");
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.be.revertedWithCustomError(liquidityPoolBase, "EnforcedPause");
    });

    it("Should revert during withdrawing profit if no profit", async function () {
      const {liquidityPoolBase, usdc, withdrawProfit, user} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.be.revertedWithCustomError(liquidityPoolBase, "NoProfit()");
    });
  });

  describe("Roles and admin functions", function () {
    it("Should allow admin to set MPC address", async function () {
      const {liquidityPoolBase, admin, user} = await loadFixture(deployAll);
      const oldMPCAddress = await liquidityPoolBase.mpcAddress();
      await expect(liquidityPoolBase.connect(admin).setMPCAddress(user.address))
        .to.emit(liquidityPoolBase, "MPCAddressSet").withArgs(oldMPCAddress, user.address);
      expect(await liquidityPoolBase.mpcAddress())
        .to.eq(user.address);
    });

    it("Should NOT allow others to set MPC address", async function () {
      const {liquidityPoolBase, user} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(user).setMPCAddress(user.address))
        .to.be.revertedWithCustomError(liquidityPoolBase, "AccessControlUnauthorizedAccount");
    });

    it("Should allow WITHDRAW_PROFIT_ROLE to pause and unpause borrowing", async function () {
      const {liquidityPoolBase, withdrawProfit} = await loadFixture(deployAll);
      expect(await liquidityPoolBase.borrowPaused())
        .to.eq(false);
      await expect(liquidityPoolBase.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPoolBase, "BorrowPaused");
      expect(await liquidityPoolBase.borrowPaused())
        .to.eq(true);
      await expect(liquidityPoolBase.connect(withdrawProfit).unpauseBorrow())
        .to.emit(liquidityPoolBase, "BorrowUnpaused");
      expect(await liquidityPoolBase.borrowPaused())
        .to.eq(false);
    });

    it("Should NOT allow others to pause and unpause borrowing", async function () {
      const {liquidityPoolBase, admin} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(admin).pauseBorrow())
        .to.be.revertedWithCustomError(liquidityPoolBase, "AccessControlUnauthorizedAccount");
    });

    it("Should allow WITHDRAW_PROFIT_ROLE to withdraw profit", async function () {
      const {
        liquidityPoolBase, uni, UNI_DEC, uniOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * UNI_DEC;
      await uni.connect(uniOwner).transfer(liquidityPoolBase.target, amountUni);
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([uni.target], user.address))
        .to.emit(liquidityPoolBase, "ProfitWithdrawn").withArgs(uni.target, user.address, amountUni);
      expect(await uni.balanceOf(user.address)).to.eq(amountUni);
    });

    it("Should NOT allow others to withdraw profit", async function () {
      const {liquidityPoolBase, uni, user} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(user).withdrawProfit([uni.target], user.address))
        .to.be.revertedWithCustomError(liquidityPoolBase, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to deposit liquidity", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amount);
    });

    it("Should NOT allow others to deposit liquidity", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC, user} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(user).deposit(amount))
        .to.be.revertedWithCustomError(liquidityPoolBase, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to withdraw liquidity", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amount);

      await expect(liquidityPoolBase.connect(liquidityAdmin).withdraw(user.address, amount))
        .to.emit(liquidityPoolBase, "Withdraw").withArgs(liquidityAdmin, user.address, amount);

      expect(await usdc.balanceOf(user.address)).to.be.eq(amount);
      expect(await liquidityPoolBase.totalDeposited()).to.be.eq(0);
    });

    it("Should NOT allow others to withdraw liquidity", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amount);

      await expect(liquidityPoolBase.connect(user).withdraw(user.address, amount * 2n))
        .to.be.revertedWithCustomError(liquidityPoolBase, "AccessControlUnauthorizedAccount");
    });

    it("Should allow PAUSER_ROLE to pause and unpause the contract", async function () {
      const {liquidityPoolBase, pauser} = await loadFixture(deployAll);
      expect(await liquidityPoolBase.paused())
        .to.eq(false);
      await expect(liquidityPoolBase.connect(pauser).pause())
        .to.emit(liquidityPoolBase, "Paused");
      expect(await liquidityPoolBase.paused())
        .to.eq(true);
      await expect(liquidityPoolBase.connect(pauser).unpause())
        .to.emit(liquidityPoolBase, "Unpaused");
      expect(await liquidityPoolBase.paused())
        .to.eq(false);
    });

    it("Should NOT allow others to pause and unpause the contract", async function () {
      const {liquidityPoolBase, admin} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(admin).pause())
        .to.be.revertedWithCustomError(liquidityPoolBase, "AccessControlUnauthorizedAccount");
    });
  });
});
