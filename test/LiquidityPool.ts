import {
  loadFixture, time, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, signBorrow, signBorrowMany,
} from "./helpers";
import {ZERO_ADDRESS} from "../scripts/common";
import {encodeBytes32String, AbiCoder} from "ethers";
import {
  MockTarget, MockBorrowSwap, LiquidityPool
} from "../typechain-types";
import {networkConfig} from "../network.config";

async function now() {
  return BigInt(await time.latest());
}

describe("LiquidityPool", function () {
  const deployAll = async () => {
    const [
      deployer, admin, user, user2, mpc_signer, liquidityAdmin, withdrawProfit, pauser
    ] = await hre.ethers.getSigners();
    await setCode(user2.address, "0x00");

    const USDC_ADDRESS = networkConfig.BASE.USDC;
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    if (!USDC_OWNER_ADDRESS) throw new Error("Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const usdc = await hre.ethers.getContractAt("ERC20", USDC_ADDRESS);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const GHO_ADDRESS = "0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee";
    const GHO_OWNER_ADDRESS = process.env.GHO_OWNER_ADDRESS!;
    if (!GHO_OWNER_ADDRESS) throw new Error("Env variables not configured (GHO_OWNER_ADDRESS missing)");
    const gho = await hre.ethers.getContractAt("ERC20", GHO_ADDRESS);
    const ghoOwner = await hre.ethers.getImpersonatedSigner(GHO_OWNER_ADDRESS);

    const EURC_ADDRESS = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";
    const EURC_OWNER_ADDRESS = process.env.EURC_OWNER_ADDRESS!;
    if (!EURC_OWNER_ADDRESS) throw new Error("Env variables not configured (EURC_OWNER_ADDRESS missing)");
    const eurc = await hre.ethers.getContractAt("ERC20", EURC_ADDRESS);
    const eurcOwner = await hre.ethers.getImpersonatedSigner(EURC_OWNER_ADDRESS);
    await setBalance(EURC_OWNER_ADDRESS, 10n ** 18n);

    const USDC_DEC = 10n ** (await usdc.decimals());
    const GHO_DEC = 10n ** (await gho.decimals());
    const EURC_DEC = 10n ** (await eurc.decimals());

    const liquidityPoolBase = (
      await deploy("LiquidityPool", deployer, {},
        usdc.target, admin.address, mpc_signer.address, networkConfig.BASE.WrappedNativeToken
      )
    ) as LiquidityPool;

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

    return {deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, gho, ghoOwner, eurc, eurcOwner,
      liquidityPoolBase, mockTarget, mockBorrowSwap, USDC_DEC, GHO_DEC, EURC_DEC,
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
      await expect(deploy("LiquidityPool", deployer, {},
        ZERO_ADDRESS, admin, mpc_signer.address, networkConfig.BASE.WrappedNativeToken
      )).to.be.revertedWithCustomError(liquidityPoolBase, "ZeroAddress");
    });

    it("Should NOT deploy the contract if admin address is 0", async function () {
      const {deployer, liquidityPoolBase, usdc, mpc_signer} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPool", deployer, {},
        usdc, ZERO_ADDRESS, mpc_signer.address, networkConfig.BASE.WrappedNativeToken
      )).to.be.revertedWithCustomError(liquidityPoolBase, "ZeroAddress");
    });

    it("Should NOT deploy the contract if MPC address is 0", async function () {
      const {deployer, liquidityPoolBase, usdc, admin} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPool", deployer, {},
        usdc, admin, ZERO_ADDRESS, networkConfig.BASE.WrappedNativeToken
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
      expect(await liquidityPoolBase.balance(usdc.target)).to.eq(amount);
    });

    it("Should deposit to the pool with pulling funds", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).approve(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(usdcOwner).depositWithPull(amount))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(usdcOwner, amount);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amount);
      expect(await liquidityPoolBase.balance(usdc.target)).to.eq(amount);
    });

    it("Should borrow a token with contract call", async function () {
      const {
        liquidityPoolBase, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        user.address,
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
      expect(await usdc.balanceOf(liquidityPoolBase.target)).to.eq(amountLiquidity - amountToBorrow);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget.target)).to.eq(amountToBorrow);
      expect(await liquidityPoolBase.balance(usdc.target)).to.eq(amountLiquidity - amountToBorrow);
    });

    it("Should borrow a token with swap", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolBase, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap.target, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        mockBorrowSwap.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolBase.borrowAndSwap.populateTransaction(
        usdc.target,
        amountToBorrow,
        {fillToken: eurc.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolBase.target, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPoolBase.target)).to.eq(amountLiquidity - amountToBorrow);
      expect(await usdc.balanceOf(mockBorrowSwap.target)).to.eq(amountToBorrow);
      expect(await eurc.balanceOf(liquidityPoolBase.target)).to.eq(0);
      expect(await eurc.balanceOf(mockTarget.target)).to.eq(fillAmount);
      expect(await liquidityPoolBase.balance(usdc.target)).to.eq(amountLiquidity - amountToBorrow);
    });

    it("Should borrow many tokens with contract call", async function () {
      const {
        liquidityPoolBase, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const amountToBorrow2 = 4n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      // In LiquidityPool only ASSET can be borrowed, so when borrowing many second amount
      // approval will override the first one.
      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow2, additionalData);

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [usdc, usdc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrowMany(
        [usdc, usdc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPoolBase)).to.eq(amountLiquidity - amountToBorrow2);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToBorrow2);
    });

    it("Should borrow many tokens with swap", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolBase, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap.target, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        mockBorrowSwap,
        [usdc],
        [amountToBorrow],
        mockTarget,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolBase.borrowAndSwapMany.populateTransaction(
        [usdc],
        [amountToBorrow],
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolBase, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPoolBase)).to.be.lessThan(amountLiquidity);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await eurc.balanceOf(liquidityPoolBase)).to.eq(0);
      expect(await eurc.balanceOf(mockTarget)).to.eq(fillAmount);
    });

    it("Should deposit when the contract is paused", async function () {
      const {liquidityPoolBase, pauser, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(pauser).pause())
        .to.emit(liquidityPoolBase, "Paused");
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");
      await usdc.connect(usdcOwner).approve(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(usdcOwner).depositWithPull(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(usdcOwner, amountLiquidity);
      expect(await liquidityPoolBase.balance(usdc.target)).to.eq(amountLiquidity + amountLiquidity);
    });

    it("Should withdraw liquidity", async function () {
      const {
        liquidityPoolBase, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amount);

      await expect(liquidityPoolBase.connect(liquidityAdmin).withdraw(user.address, amount))
        .to.emit(liquidityPoolBase, "Withdraw").withArgs(liquidityAdmin, user.address, amount);
      expect(await usdc.balanceOf(user.address)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPoolBase.target)).to.eq(0);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(0);
      expect(await liquidityPoolBase.balance(usdc.target)).to.eq(0);
    });

    it("Should withdraw profit for multiple tokens from the pool", async function () {
      const {
        liquidityPoolBase, eurc, gho, EURC_DEC, eurcOwner, ghoOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * EURC_DEC;
      const amountRpl = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolBase.target, amountUni);
      await gho.connect(ghoOwner).transfer(liquidityPoolBase.target, amountRpl);
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([eurc.target, gho.target], user.address))
        .to.emit(liquidityPoolBase, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountUni)
        .and.to.emit(liquidityPoolBase, "ProfitWithdrawn").withArgs(gho.target, user.address, amountRpl);
      expect(await eurc.balanceOf(user.address)).to.eq(amountUni);
      expect(await gho.balanceOf(user.address)).to.eq(amountRpl);
    });

    it("Should withdraw liquidity as profit from the pool", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, usdcOwner, withdrawProfit, liquidityAdmin, user
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");
      const amountProfit = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountProfit);
      expect(await liquidityPoolBase.balance(usdc.target)).to.eq(amountLiquidity + amountProfit);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amountLiquidity);
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.emit(liquidityPoolBase, "ProfitWithdrawn").withArgs(usdc.target, user.address, amountProfit);
      expect(await usdc.balanceOf(user.address)).to.eq(amountProfit);
      expect(await usdc.balanceOf(liquidityPoolBase.target)).to.eq(amountLiquidity);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amountLiquidity);
      expect(await liquidityPoolBase.balance(usdc.target)).to.eq(amountLiquidity);
    });

    it("Should withdraw all available balance as profit ", async function () {
      const {liquidityPoolBase, usdc, USDC_DEC, usdcOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.emit(liquidityPoolBase, "ProfitWithdrawn").withArgs(usdc.target, user.address, amount);
      expect(await usdc.balanceOf(user.address)).to.eq(amount);
      expect(await liquidityPoolBase.balance(usdc.target)).to.eq(0);
    });

    it("Should NOT deposit if no collateral on contract", async function () {
      const {liquidityPoolBase, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(10))
        .to.be.revertedWithCustomError(liquidityPoolBase, "NotEnoughToDeposit");
    });

    it("Should return 0 for balance of other tokens", async function () {
      const {
        liquidityPoolBase, eurc, EURC_DEC, eurcOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      expect(await liquidityPoolBase.balance(eurc.target)).to.eq(0);
    });

    it("Should NOT borrow other tokens", async function () {
      const {
        liquidityPoolBase, eurc, EURC_DEC, user, mpc_signer, user2, eurcOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolBase.target, amountLiquidity);

      const amountToBorrow = 2n * EURC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidBorrowToken");
    });

    it("Should NOT borrow if MPC signature is wrong", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        user,
        liquidityPoolBase.target as string,
        user.address as string,
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
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        user.address as string,
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
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        user.address as string,
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
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        user.address as string,
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
        user.address as string,
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

    it("Should NOT borrow if MPC signature is wrong (caller is wrong)", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user2).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidSignature");
    });

    it("Should NOT borrow and swap if MPC signature is wrong (caller is wrong)", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolBase, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap.target, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      // user address is signed instead of mockBorrowSwap address
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolBase.borrowAndSwap.populateTransaction(
        usdc.target,
        amountToBorrow,
        {fillToken: eurc.target, fillAmount, swapData},
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
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolBase, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        mockBorrowSwap.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolBase.borrowAndSwap.populateTransaction(
        usdc.target,
        amountToBorrow,
        {fillToken: eurc.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      // No EURC tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolBase.target, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT borrow non-asset token", async function () {
      const {
        liquidityPoolBase, eurc, EURC_DEC, mpc_signer, user, user2, eurcOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolBase, amountLiquidity);

      const amountToBorrow = 2n * EURC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidBorrowToken");
    });

    it("Should NOT borrow and swap non-asset token", async function () {
      const {
        liquidityPoolBase, eurc, EURC_DEC, mpc_signer, user, eurcOwner,
        mockTarget,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolBase, amountLiquidity);

      const amountToBorrow = 2n * EURC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolBase.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrowAndSwap(
        eurc,
        amountToBorrow,
        {fillToken: eurc, fillAmount: 0n, swapData: "0x"},
        mockTarget,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidBorrowToken");
    });

    it("Should NOT borrow many if MPC signature is wrong", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        user,
        liquidityPoolBase,
        user,
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrowMany(
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidSignature");
    });

    it("Should NOT borrow many if MPC signature nonce is reused", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        31337
      );

      await liquidityPoolBase.connect(user).borrowMany(
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      await expect(liquidityPoolBase.connect(user).borrowMany(
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "NonceAlreadyUsed");
    });

    it("Should NOT borrow many if MPC signature is expired", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        31337,
        0n,
        deadline,
      );

      await expect(liquidityPoolBase.connect(user).borrowMany(
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        0n,
        deadline,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "ExpiredSignature");
    });

    it("Should NOT borrow many if target call fails", async function () {
      const {
        liquidityPoolBase, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, additionalData);

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        usdc,
        callData.data,
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrowMany(
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        usdc,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "TargetCallFailed");
    });

    it("Should NOT borrow many if borrowing is paused", async function () {
      const {liquidityPoolBase, user, user2, withdrawProfit, mpc_signer, usdc, USDC_DEC} = await loadFixture(deployAll);

      // Pause borrowing
      await expect(liquidityPoolBase.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPoolBase, "BorrowPaused");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrowMany(
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "BorrowingIsPaused");
    });

    it("Should NOT borrow many if the contract is paused", async function () {
      const {liquidityPoolBase, usdc, user, user2, pauser} = await loadFixture(deployAll);

      // Pause the contract
      await expect(liquidityPoolBase.connect(pauser).pause())
        .to.emit(liquidityPoolBase, "Paused");

      await expect(liquidityPoolBase.connect(user).borrowMany(
        [usdc, usdc],
        [1n, 1n],
        user2,
        "0x",
        0n,
        2000000000n,
        "0x"))
      .to.be.revertedWithCustomError(liquidityPoolBase, "EnforcedPause");
    });

    it("Should NOT borrow many if MPC signature is wrong (caller is wrong)", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user2).borrowMany(
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidSignature");
    });

    it("Should NOT borrow and swap many if MPC signature is wrong (caller is wrong)", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolBase, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      // user address is signed instead of mockBorrowSwap address
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        mockTarget,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolBase.borrowAndSwap.populateTransaction(
        usdc,
        amountToBorrow,
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolBase, borrowCalldata.data))
        .to.be.reverted;
    });

    it("Should NOT borrow and swap many if the swap fails", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolBase, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        mockBorrowSwap,
        [usdc, usdc],
        [amountToBorrow, amountToBorrow],
        mockTarget,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolBase.borrowAndSwap.populateTransaction(
        usdc,
        amountToBorrow,
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      // No EURC tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolBase, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT borrow many if tokens and amounts have diff or zero length", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, mpc_signer, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      let signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrowMany(
        [usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidLength");

      signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [usdc, usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrowMany(
        [usdc, usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidLength");

      signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [],
        [],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrowMany(
        [],
        [],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidLength");
    });

    it("Should NOT borrow many if contains non-asset tokens", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, eurc, mpc_signer, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [usdc, eurc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrowMany(
        [usdc, eurc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidBorrowToken");
    });

    it("Should NOT borrow and swap many if contains non-asset tokens", async function () {
      const {
        liquidityPoolBase, usdc, USDC_DEC, eurc, mpc_signer, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase, amountLiquidity);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolBase, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolBase,
        user,
        [eurc, usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolBase.connect(user).borrowAndSwapMany(
        [eurc, usdc],
        [amountToBorrow, amountToBorrow],
        {fillToken: eurc, fillAmount: 0n, swapData: "0x"},
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolBase, "InvalidBorrowToken");
    });

    it("Should NOT withdraw liquidity if not enough on contract", async function () {
      const {liquidityPoolBase, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolBase, "Deposit");

      await expect(liquidityPoolBase.connect(liquidityAdmin).withdraw(user.address, amount * 2n))
        .to.be.reverted;
    });

    it("Should NOT withdraw profit as liquidity", async function () {
      const {liquidityPoolBase, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
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

    it("Should NOT withdraw liquidity to zero address", async function () {
      const {liquidityPoolBase, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(liquidityAdmin).withdraw(ZERO_ADDRESS, 10))
        .to.be.revertedWithCustomError(liquidityPoolBase, "ZeroAddress()");
    });

    it("Should NOT withdraw profit if the contract is paused", async function () {
      const {liquidityPoolBase, user, usdc, withdrawProfit, pauser} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(pauser).pause())
        .to.emit(liquidityPoolBase, "Paused");
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.be.revertedWithCustomError(liquidityPoolBase, "EnforcedPause");
    });

    it("Should NOT withdraw profit to zero address", async function () {
      const {liquidityPoolBase, usdc, withdrawProfit} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([usdc.target], ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPoolBase, "ZeroAddress()");
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
        liquidityPoolBase, eurc, EURC_DEC, eurcOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolBase.target, amountUni);
      await expect(liquidityPoolBase.connect(withdrawProfit).withdrawProfit([eurc.target], user.address))
        .to.emit(liquidityPoolBase, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountUni);
      expect(await eurc.balanceOf(user.address)).to.eq(amountUni);
    });

    it("Should NOT allow others to withdraw profit", async function () {
      const {liquidityPoolBase, eurc, user} = await loadFixture(deployAll);
      await expect(liquidityPoolBase.connect(user).withdrawProfit([eurc.target], user.address))
        .to.be.revertedWithCustomError(liquidityPoolBase, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to deposit liquidity", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPoolBase.totalDeposited()).to.eq(amount);
    });

    it("Should NOT allow others to deposit liquidity", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC, user} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(user).deposit(amount))
        .to.be.revertedWithCustomError(liquidityPoolBase, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to withdraw liquidity", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolBase.target, amount);
      await expect(liquidityPoolBase.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolBase, "Deposit").withArgs(liquidityAdmin, amount);

      await expect(liquidityPoolBase.connect(liquidityAdmin).withdraw(user.address, amount))
        .to.emit(liquidityPoolBase, "Withdraw").withArgs(liquidityAdmin, user.address, amount);

      expect(await usdc.balanceOf(user.address)).to.be.eq(amount);
      expect(await liquidityPoolBase.totalDeposited()).to.be.eq(0);
      expect(await liquidityPoolBase.balance(usdc.target)).to.eq(0);
    });

    it("Should NOT allow others to withdraw liquidity", async function () {
      const {liquidityPoolBase, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
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
