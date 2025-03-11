import {
  loadFixture, time, setBalance
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, signBorrow
} from "./helpers";
import {ZERO_ADDRESS} from "../scripts/common";
import {encodeBytes32String, AbiCoder} from "ethers";
import {
  MockTarget, MockBorrowSwap, LiquidityPoolAave
} from "../typechain-types";

async function now() {
  return BigInt(await time.latest());
}

describe("LiquidityPoolAave", function () {
  const deployAll = async () => {
    const [
      deployer, admin, user, user2, mpc_signer, liquidityAdmin, withdrawProfit, pauser
    ] = await hre.ethers.getSigners();

    const AAVE_POOL_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";
    const aavePoolAddressesProvider = await hre.ethers.getContractAt("IAavePoolAddressesProvider", AAVE_POOL_PROVIDER);
    const aavePoolAddress = await aavePoolAddressesProvider.getPool();
    const aavePool = await hre.ethers.getContractAt("IAavePool", aavePoolAddress);

    const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    if (!USDC_OWNER_ADDRESS) throw new Error("Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const usdc = await hre.ethers.getContractAt("ERC20", USDC_ADDRESS);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const collateralData = await aavePool.getReserveData(USDC_ADDRESS);
    const aToken = await hre.ethers.getContractAt("ERC20", collateralData[8]);
    const usdcDebtToken = await hre.ethers.getContractAt("ERC20", collateralData[10]);

    const RPL_ADDRESS = "0xD33526068D116cE69F19A9ee46F0bd304F21A51f";
    const RPL_OWNER_ADDRESS = process.env.RPL_OWNER_ADDRESS!;
    if (!RPL_OWNER_ADDRESS) throw new Error("Env variables not configured (RPL_OWNER_ADDRESS missing)");
    const rpl = await hre.ethers.getContractAt("ERC20", RPL_ADDRESS);
    const rplOwner = await hre.ethers.getImpersonatedSigner(RPL_OWNER_ADDRESS);
    const rplData = await aavePool.getReserveData(RPL_ADDRESS);
    const rplDebtToken = await hre.ethers.getContractAt("ERC20", rplData[10]);

    const UNI_ADDRESS = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
    const UNI_OWNER_ADDRESS = process.env.UNI_OWNER_ADDRESS!;
    if (!UNI_OWNER_ADDRESS) throw new Error("Env variables not configured (UNI_OWNER_ADDRESS missing)");
    const uni = await hre.ethers.getContractAt("ERC20", UNI_ADDRESS);
    const uniOwner = await hre.ethers.getImpersonatedSigner(UNI_OWNER_ADDRESS);
    const uniData = await aavePool.getReserveData(UNI_ADDRESS);
    const uniDebtToken = await hre.ethers.getContractAt("ERC20", uniData[10]);
    await setBalance(UNI_OWNER_ADDRESS, 10n ** 18n);

    // PRIME token used as not supported by aave
    const NON_SUPPORTED_TOKEN_ADDRESS = "0xb23d80f5FefcDDaa212212F028021B41DEd428CF";
    const NON_SUPPORTED_TOKEN_OWNER_ADDRESS = process.env.PRIME_OWNER_ADDRESS!;
    if (!NON_SUPPORTED_TOKEN_OWNER_ADDRESS)
      throw new Error("Env variables not configured (PRIME_OWNER_ADDRESS missing)");
    const nonSupportedToken = await hre.ethers.getContractAt("ERC20", NON_SUPPORTED_TOKEN_ADDRESS);
    const nonSupportedTokenOwner = await hre.ethers.getImpersonatedSigner(NON_SUPPORTED_TOKEN_OWNER_ADDRESS);

    const USDC_DEC = 10n ** (await usdc.decimals());
    const RPL_DEC = 10n ** (await rpl.decimals());
    const UNI_DEC = 10n ** (await uni.decimals());

    // Initialize health factor as 5 (500%)
    const healthFactor = 500n * 10000n / 100n;
    // Initialize token LTV as 5%
    const defaultLtv = 5n * 10000n / 100n;
    const liquidityPool = (
      await deploy("LiquidityPoolAave", deployer, {},
        usdc.target, AAVE_POOL_PROVIDER, admin.address, mpc_signer.address, healthFactor, defaultLtv
      )
    ) as LiquidityPoolAave;

    const mockTarget = (
      await deploy("MockTarget", deployer)
    ) as MockTarget;

    const mockBorrowSwap = (
      await deploy("MockBorrowSwap", deployer)
    ) as MockBorrowSwap;

    const LIQUIDITY_ADMIN_ROLE = encodeBytes32String("LIQUIDITY_ADMIN_ROLE");
    await liquidityPool.connect(admin).grantRole(LIQUIDITY_ADMIN_ROLE, liquidityAdmin.address);

    const WITHDRAW_PROFIT_ROLE = encodeBytes32String("WITHDRAW_PROFIT_ROLE");
    await liquidityPool.connect(admin).grantRole(WITHDRAW_PROFIT_ROLE, withdrawProfit.address);

    const PAUSER_ROLE = encodeBytes32String("PAUSER_ROLE");
    await liquidityPool.connect(admin).grantRole(PAUSER_ROLE, pauser.address);

    return {deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, rpl, rplOwner, uni, uniOwner,
      liquidityPool, mockTarget, mockBorrowSwap, USDC_DEC, RPL_DEC, UNI_DEC, AAVE_POOL_PROVIDER,
      healthFactor, defaultLtv, aavePool, aToken, rplDebtToken, uniDebtToken, usdcDebtToken,
      nonSupportedToken, nonSupportedTokenOwner, liquidityAdmin, withdrawProfit, pauser};
  };

  describe("Initialization", function () {
    it("Should initialize the contract with correct values", async function () {
      const {
        liquidityPool, usdc, AAVE_POOL_PROVIDER, healthFactor, defaultLtv, mpc_signer,
        aavePool, aToken,
      } = await loadFixture(deployAll);
      expect(await liquidityPool.ASSETS())
        .to.be.eq(usdc.target);
      expect(await liquidityPool.AAVE_POOL_PROVIDER())
        .to.be.eq(AAVE_POOL_PROVIDER);
      expect(await liquidityPool.AAVE_POOL())
        .to.be.eq(aavePool.target);
      expect(await liquidityPool.ATOKEN())
        .to.be.eq(aToken.target);
      expect(await liquidityPool.minHealthFactor())
        .to.be.eq(healthFactor);
      expect(await liquidityPool.defaultLTV())
        .to.be.eq(defaultLtv);
      expect(await liquidityPool.mpcAddress())
        .to.be.eq(mpc_signer);
    });

    it("Should NOT deploy the contract if token cannot be used as collateral", async function () {
      const {
        deployer, AAVE_POOL_PROVIDER, liquidityPool, rpl, admin, mpc_signer, healthFactor, defaultLtv
      } = await loadFixture(deployAll);
      const startingNonce = await deployer.getNonce();
      await expect(deploy("LiquidityPoolAave", deployer, {nonce: startingNonce},
        rpl.target, AAVE_POOL_PROVIDER, admin.address, mpc_signer.address, healthFactor, defaultLtv
      )).to.be.revertedWithCustomError(liquidityPool, "CollateralNotSupported");
    });
  });

  describe("Borrow, supply, repay, withdraw", function () {
    it("Should deposit to aave", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);
    });

    it("Should deposit to aave with pulling funds", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).approve(liquidityPool.target, amount);
      await expect(liquidityPool.connect(usdcOwner).depositWithPull(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);
    });

    it("Should borrow a token", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, user, user2, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);
    });

    it("Should calculate token ltv if decimals of token and collateral are different", async function () {
      const {
        liquidityPool, usdc, uni, mpc_signer, user, user2, usdcOwner, liquidityAdmin, USDC_DEC, UNI_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * UNI_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await uni.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);
      expect(await uni.allowance(liquidityPool.target, user2.address)).to.eq(amountToBorrow);
    });

    it("Should make a contract call to the recipient", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, rpl, RPL_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * RPL_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(rpl.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await rpl.balanceOf(mockTarget.target)).to.eq(amountToBorrow);
    });

    it("Should borrow collateral", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, aToken, user, user2, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * USDC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await usdc.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amountCollateral - 1n);
    });

    it("Should borrow a token with swap", async function () {
      // RPL is borrowed and swapped to UNI
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, rpl, RPL_DEC,
        user, mpc_signer, usdcOwner, uni, UNI_DEC, uniOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * RPL_DEC;
      const fillAmount = 2n * UNI_DEC;
      await uni.connect(uniOwner).approve(mockBorrowSwap.target, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(uni.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [rpl.target, amountToBorrow, uni.target, uniOwner.address, fillAmount]
          );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        mockBorrowSwap.target as string,
        rpl.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        rpl.target,
        amountToBorrow,
        {fillToken: uni.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool.target, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await rpl.balanceOf(mockBorrowSwap.target)).to.eq(amountToBorrow);
      expect(await uni.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await uni.balanceOf(mockTarget.target)).to.eq(fillAmount);
    });

    it("Should repay a debt", async function () {
      const {
        liquidityPool, usdc, uni, mpc_signer, user, user2, usdcOwner, uniOwner, liquidityAdmin, USDC_DEC, UNI_DEC,
        aavePool,
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * UNI_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await uni.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      await uni.connect(uniOwner).transfer(liquidityPool.target, amountToBorrow);

      await expect(liquidityPool.connect(user).repay([uni.target]))
        .to.emit(liquidityPool, "Repaid");
      expect(await uni.allowance(liquidityPool.target, aavePool.target)).to.eq(0);
      expect(await uni.balanceOf(liquidityPool.target)).to.be.lessThan(amountToBorrow);
    });

    it("Should repay when the contract is paused", async function () {
      const {
        liquidityPool, usdc, uni, mpc_signer, user, user2, usdcOwner, uniOwner,
        liquidityAdmin, pauser, USDC_DEC, UNI_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * UNI_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await uni.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await uni.connect(uniOwner).transfer(liquidityPool.target, amountToBorrow);

      await expect(liquidityPool.connect(user).repay([uni.target]))
        .to.emit(liquidityPool, "Repaid");
      expect(await uni.balanceOf(liquidityPool.target)).to.be.lessThan(amountToBorrow);
    });

    it("Should deposit to aave multiple times", async function () {
      const {liquidityPool, usdc, usdcOwner, liquidityAdmin, USDC_DEC, aToken} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount * 2n - 1n);
    });

    it("Should deposit when the contract is paused", async function () {
      const {liquidityPool, pauser, usdc, usdcOwner, USDC_DEC, liquidityAdmin, aToken} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");
      await usdc.connect(usdcOwner).approve(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(usdcOwner).depositWithPull(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amountCollateral);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amountCollateral * 2n - 1n);
    });

    it("Should borrow and repay different tokens", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, uni, user, user2, mpc_signer, usdcOwner, uniOwner,
        liquidityAdmin, rplOwner, rplDebtToken, uniDebtToken
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 1n * RPL_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        1n
      );

      await liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        1n,
        2000000000n,
        signature2);
      expect(await uni.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      // advance time by one hour
      await time.increase(3600);

      const uniDebtBefore = await uniDebtToken.balanceOf(liquidityPool.target);
      const rplDebtBefore = await rplDebtToken.balanceOf(liquidityPool.target);
      expect(uniDebtBefore).to.be.greaterThan(amountToBorrow);
      expect(rplDebtBefore).to.be.greaterThan(amountToBorrow);

      // Repaying with the borrowed tokens that are still in the pool contract
      await expect(liquidityPool.connect(user).repay([uni.target, rpl.target]))
        .to.emit(liquidityPool, "Repaid").withArgs(uni.target, amountToBorrow)
        .and.to.emit(liquidityPool, "Repaid").withArgs(rpl.target, amountToBorrow);
      const uniDebtAfter1 = await uniDebtToken.balanceOf(liquidityPool.target);
      expect(uniDebtAfter1).to.be.lessThan(uniDebtBefore);
      const rplDebtAfter1 = await rplDebtToken.balanceOf(liquidityPool.target);
      expect(rplDebtAfter1).to.be.lessThan(rplDebtBefore);

      await uni.connect(uniOwner).transfer(liquidityPool.target, amountToBorrow);
      await expect(liquidityPool.connect(user).repay([uni.target]))
      .to.emit(liquidityPool, "Repaid");
      const uniDebtAfter2 = await uniDebtToken.balanceOf(liquidityPool.target);
      expect(uniDebtAfter2).to.eq(0);

      await rpl.connect(rplOwner).transfer(liquidityPool.target, amountToBorrow);
      await expect(liquidityPool.connect(user).repay([rpl.target]))
        .to.emit(liquidityPool, "Repaid");
      const rplDebtAfter2 = await rplDebtToken.balanceOf(liquidityPool.target);
      expect(rplDebtAfter2).to.eq(0);
    });

    it("Should repay if some tokens don't have debt", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, uni, user, user2, mpc_signer, usdcOwner, uniOwner,
        liquidityAdmin, rplOwner, rplDebtToken, uniDebtToken
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      // advance time by one hour
      await time.increase(3600);

      const rplDebtBefore = await rplDebtToken.balanceOf(liquidityPool.target);
      expect(rplDebtBefore).to.be.greaterThan(amountToBorrow);

      await uni.connect(uniOwner).transfer(liquidityPool.target, amountToBorrow);
      await rpl.connect(rplOwner).transfer(liquidityPool.target, amountToBorrow);

      await expect(liquidityPool.connect(user).repay([uni.target, rpl.target]))
        .to.emit(liquidityPool, "Repaid");
      const uniDebtAfter = await uniDebtToken.balanceOf(liquidityPool.target);
      expect(uniDebtAfter).to.eq(0);
      const rplDebtAfter = await rplDebtToken.balanceOf(liquidityPool.target);
      expect(rplDebtAfter).to.eq(0);
    });

    it("Should repay collateral", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, mpc_signer, usdcOwner, uniOwner,  liquidityAdmin,
        usdcDebtToken, uniDebtToken
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * USDC_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await usdc.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      // advance time by one hour
      await time.increase(3600);

      const usdcDebtBefore = await usdcDebtToken.balanceOf(liquidityPool.target);
      expect(usdcDebtBefore).to.be.greaterThan(amountToBorrow);

      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountToBorrow);

      await expect(liquidityPool.connect(user).repay([usdc.target]))
        .to.emit(liquidityPool, "Repaid");
      const usdcDebtAfter = await uniDebtToken.balanceOf(liquidityPool.target);
      expect(usdcDebtAfter).to.eq(0);
    });

    it("Should withdraw collateral from aave", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user,
        withdrawProfit, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user.address, amount))
        .to.emit(liquidityPool, "WithdrawnFromAave").withArgs(user.address, amount);
      expect(await usdc.balanceOf(user.address)).to.be.eq(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThan(0);

      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit(
        [usdc.target], user.address
      ))
        .to.emit(liquidityPool, "WithdrawnFromAave");
      expect(await aToken.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await usdc.balanceOf(user.address)).to.greaterThan(amount);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await aToken.balanceOf(liquidityPool.target)).to.eq(0);
    });

    it("Should withdraw accrued interest from aave", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user,
        withdrawProfit, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);

       // advance time by one hour to accrue interest
      await time.increase(3600);
      const aTokenBalance = await aToken.balanceOf(liquidityPool.target);
      expect(aTokenBalance).to.be.greaterThanOrEqual(amount + 1n);

      // try to withdraw by liquidityAdmin more that deposited
      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user.address, amount + 1n))
        .to.be.revertedWithCustomError(liquidityPool, "InsufficientLiquidity");
      // withdraw interest as profit
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expect(await aToken.balanceOf(liquidityPool.target))
        .to.be.greaterThanOrEqual(amount - 1n)
        .and.to.be.lessThan(aTokenBalance);
      expect(await usdc.balanceOf(user.address)).to.be.greaterThanOrEqual(aTokenBalance - amount);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);
    });

    it("Should withdraw profit for multiple tokens from the pool", async function () {
      const {
        liquidityPool, uni, rpl, UNI_DEC, uniOwner, rplOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * UNI_DEC;
      const amountRpl = 1n * UNI_DEC;
      await uni.connect(uniOwner).transfer(liquidityPool.target, amountUni);
      await rpl.connect(rplOwner).transfer(liquidityPool.target, amountRpl);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([uni.target, rpl.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(uni.target, user.address, amountUni)
        .and.to.emit(liquidityPool, "ProfitWithdrawn").withArgs(rpl.target, user.address, amountRpl);
      expect(await uni.balanceOf(user.address)).to.eq(amountUni);
      expect(await rpl.balanceOf(user.address)).to.eq(amountRpl);
    });

    it("Should withdraw collateral as profit from the pool", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(usdc.target, user.address, amount);
      expect(await usdc.balanceOf(user.address)).to.eq(amount);
    });

    it("Should withdraw all available balance as profit ", async function () {
      const {liquidityPool, uni, UNI_DEC, uniOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 2n * UNI_DEC;
      await uni.connect(uniOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([uni.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(uni.target, user.address, amount);
      expect(await uni.balanceOf(user.address)).to.eq(amount);
    });

    it("Should withdraw non-supported token", async function () {
      const {
        liquidityPool, nonSupportedToken, nonSupportedTokenOwner, withdrawProfit, user, UNI_DEC
      } = await loadFixture(deployAll);
      const amount = 2n * UNI_DEC;
      await nonSupportedToken.connect(nonSupportedTokenOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([nonSupportedToken.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(nonSupportedToken.target, user.address, amount);
      expect(await nonSupportedToken.balanceOf(user.address)).to.eq(amount);
    });

    it("Should NOT deposit if no collateral on contract", async function () {
      const {liquidityPool, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(10))
        .to.be.revertedWithCustomError(liquidityPool, "NotEnoughToDeposit");
    });

    it("Should NOT borrow if MPC signature is wrong", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;
      const signature = await signBorrow(
        user,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow if MPC signature nonce is reused", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      await expect(liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "NonceAlreadyUsed");
    });

    it("Should NOT borrow if MPC signature is expired", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        0n,
        deadline,
      );

      await expect(liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        deadline,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "ExpiredSignature");
    });

    it("Should NOT borrow if token ltv is exceeded", async function () {
      const {
        liquidityPool, usdc, uni, mpc_signer, user, user2, usdcOwner, USDC_DEC, UNI_DEC, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 10n * UNI_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TokenLtvExceeded");
    });

    it("Should NOT borrow if health factor is too low", async function () {
      const {
        liquidityPool, admin, usdc, uni, mpc_signer, user, user2, usdcOwner, USDC_DEC, UNI_DEC, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      await expect(liquidityPool.connect(admin).setHealthFactor(5000n * 10000n / 100n))
        .to.emit(liquidityPool, "HealthFactorSet");

      const amountToBorrow = 3n * UNI_DEC;

      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature2))
      .to.be.revertedWithCustomError(liquidityPool, "HealthFactorTooLow");
    });

    it("Should NOT borrow if target call fails", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, rpl, RPL_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(rpl.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        rpl.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        rpl.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TargetCallFailed");
    });

    it("Should NOT borrow if borrowing is paused", async function () {
      const {liquidityPool, user, user2, withdrawProfit, mpc_signer, uni, UNI_DEC} = await loadFixture(deployAll);

      // Pause borrowing
      await expect(liquidityPool.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPool, "BorrowPaused");

      const amountToBorrow = 2n * UNI_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "BorrowingIsPaused");
    });

    it("Should NOT borrow if the contract is paused", async function () {
      const {liquidityPool, rpl, user, user2, pauser} = await loadFixture(deployAll);

      // Pause the contract
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(user).borrow(
        rpl.target,
        1,
        user2,
        "0x",
        0n,
        2000000000n,
        "0x"))
      .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT borrow if MPC signature is wrong (caller is wrong)", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer, rpl,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user2).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow and swap if MPC signature is wrong (caller is wrong)", async function () {
      // RPL is borrowed and swapped to UNI
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, rpl, RPL_DEC,
        user, mpc_signer, usdcOwner, uni, UNI_DEC, uniOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * RPL_DEC;
      const fillAmount = 2n * UNI_DEC;
      await uni.connect(uniOwner).approve(mockBorrowSwap.target, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(uni.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [rpl.target, amountToBorrow, uni.target, uniOwner.address, fillAmount]
          );

      // user address is signed instead of mockBorrowSwap address
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        rpl.target,
        amountToBorrow,
        {fillToken: uni.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool.target, borrowCalldata.data))
        .to.be.reverted;
    });

    it("Should NOT borrow and swap if the swap fails", async function () {
      // RPL is borrowed and swapped to UNI
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, rpl, RPL_DEC,
        user, mpc_signer, usdcOwner, uni, UNI_DEC, uniOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * RPL_DEC;
      const fillAmount = 2n * UNI_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(uni.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [rpl.target, amountToBorrow, uni.target, uniOwner.address, fillAmount]
          );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        mockBorrowSwap.target as string,
        rpl.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        rpl.target,
        amountToBorrow,
        {fillToken: uni.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      // No UNI tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool.target, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT repay if all tokens don't have debt or balance", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, uni, user, mockTarget,
        mpc_signer, usdcOwner, uniOwner, liquidityAdmin
      } = await loadFixture(deployAll);

      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(rpl.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await rpl.balanceOf(mockTarget.target)).to.eq(amountToBorrow);

      await uni.connect(uniOwner).transfer(liquidityPool.target, amountToBorrow);

      // No balance for rpl, no dept for uni
      await expect(liquidityPool.connect(user).repay([uni.target, rpl.target]))
        .to.be.revertedWithCustomError(liquidityPool, "NothingToRepay");
    });

    it("Should NOT repay unsupported tokens", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      const unsupportedToken = await hre.ethers.getContractAt("ERC20", "0x53fFFB19BAcD44b82e204d036D579E86097E5D09");

      // No balance for rpl, no dept for uni
      await expect(liquidityPool.connect(user).repay([unsupportedToken.target]))
        .to.be.revertedWithCustomError(liquidityPool, "NothingToRepay");
    });

    it("Should NOT withdraw collateral if not enough on aave", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, aToken, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user.address, amount * 2n))
        .to.be.reverted;
    });

    it("Should NOT withdraw collateral if health factor is too low", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin, uni, mpc_signer, UNI_DEC, user2
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);

      const amountToBorrow = 3n * UNI_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user.address, 900000000n))
        .to.be.revertedWithCustomError(liquidityPool, "HealthFactorTooLow");
    });

    it("Should NOT withdraw accrued interest from aave by liquidity admin", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);

       // advance time by one hour to accrue interest
      await time.increase(3600);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount + 1n);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user.address, amount + 1n))
        .to.be.revertedWithCustomError(liquidityPool, "InsufficientLiquidity");
    });

    it("Should NOT withdraw collateral if the contract is paused", async function () {
      const {liquidityPool, user, liquidityAdmin, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user.address, 10))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT withdraw profit if the contract is paused", async function () {
      const {liquidityPool, user, uni, withdrawProfit, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([uni.target], user.address))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT withdraw profit to zero address", async function () {
      const {liquidityPool, user, uni, withdrawProfit, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([uni.target], ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, "ZeroAddress()");
    });

    it("Should revert during withdrawing profit if no profit", async function () {
      const {liquidityPool, uni, withdrawProfit, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([uni.target], user.address))
        .to.be.revertedWithCustomError(liquidityPool, "NoProfit()");
    });

    it("Should NOT withdraw profit as aToken", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, withdrawProfit, user, aToken, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([aToken.target], user.address))
        .to.revertedWithCustomError(liquidityPool, "CannotWithdrawAToken");
    });

    it("Should NOT withdraw profit if the token has debt", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, rpl, RPL_DEC, mpc_signer,
        liquidityAdmin, withdrawProfit, user, user2, rplDebtToken, uni, UNI_DEC, uniOwner,
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      const amountUni = 1n * UNI_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      const amountToBorrow = 2n * RPL_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);
      expect(await rplDebtToken.balanceOf(liquidityPool.target)).to.be.greaterThan(0);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([rpl.target], user.address))
        .to.be.revertedWithCustomError(liquidityPool, "NoProfit()");
      await uni.connect(uniOwner).transfer(liquidityPool.target, amountUni);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([uni.target, rpl.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expect(await rpl.balanceOf(user.address)).to.eq(0);
      expect(await uni.balanceOf(user.address)).to.eq(amountUni);
    });

    it("Should NOT withdraw profit by unauthorized user", async function () {
      const {liquidityPool, uni, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).withdrawProfit([uni.target], user.address))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should NOT set token LTVs if array lengths don't match", async function () {
      const {liquidityPool, admin, uni} = await loadFixture(deployAll);
      const uni_ltv = 1000;
      const rpl_ltv = 2000;
      await expect(liquidityPool.connect(admin).setBorrowTokenLTVs(
        [uni.target],
        [uni_ltv, rpl_ltv]
      ))
        .to.be.revertedWithCustomError(liquidityPool, "InvalidLength");
    });
  });

  describe("Roles and admin functions", function () {
    it("Should allow admin to set MPC address", async function () {
      const {liquidityPool, admin, user} = await loadFixture(deployAll);
      const oldMPCAddress = await liquidityPool.mpcAddress();
      await expect(liquidityPool.connect(admin).setMPCAddress(user.address))
        .to.emit(liquidityPool, "MPCAddressSet").withArgs(oldMPCAddress, user.address);
      expect(await liquidityPool.mpcAddress())
        .to.eq(user.address);
    });

    it("Should NOT allow others to set MPC address", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).setMPCAddress(user.address))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow admin to set default token LTV", async function () {
      const {liquidityPool, admin} = await loadFixture(deployAll);
      const oldDefaultLTV = await liquidityPool.defaultLTV();
      const defaultLtv = 1000;
      await expect(liquidityPool.connect(admin).setDefaultLTV(defaultLtv))
        .to.emit(liquidityPool, "DefaultLTVSet").withArgs(oldDefaultLTV, defaultLtv);
      expect(await liquidityPool.defaultLTV())
        .to.eq(defaultLtv);
    });

    it("Should NOT allow others to set default token LTV", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      const defaultLtv = 1000;
      await expect(liquidityPool.connect(user).setDefaultLTV(defaultLtv))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow admin to set token LTV for each token", async function () {
      const {liquidityPool, admin, uni, rpl} = await loadFixture(deployAll);
      const oldUniLTV = await liquidityPool.borrowTokenLTV(uni.target);
      const oldRplLTV = await liquidityPool.borrowTokenLTV(rpl.target);
      const uni_ltv = 1000;
      const rpl_ltv = 2000;
      await expect(liquidityPool.connect(admin).setBorrowTokenLTVs(
        [uni.target, rpl.target],
        [uni_ltv, rpl_ltv]
      ))
        .to.emit(liquidityPool, "BorrowTokenLTVSet").withArgs(uni.target, oldUniLTV, uni_ltv)
        .and.to.emit(liquidityPool, "BorrowTokenLTVSet").withArgs(rpl.target, oldRplLTV, rpl_ltv);
      expect(await liquidityPool.borrowTokenLTV(uni.target))
        .to.eq(uni_ltv);
      expect(await liquidityPool.borrowTokenLTV(rpl.target))
        .to.eq(rpl_ltv);
    });

    it("Should NOT allow others to set token LTV for each token", async function () {
      const {liquidityPool, user, uni} = await loadFixture(deployAll);
      const ltv = 1000;
      await expect(liquidityPool.connect(user).setBorrowTokenLTVs([uni.target], [ltv]))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow admin to set minimal health factor", async function () {
      const {liquidityPool, admin} = await loadFixture(deployAll);
      const oldHealthFactor = await liquidityPool.minHealthFactor();
      const healthFactor = 300n * 10000n / 100n;
      await expect(liquidityPool.connect(admin).setHealthFactor(healthFactor))
        .to.emit(liquidityPool, "HealthFactorSet").withArgs(oldHealthFactor, healthFactor);
      expect(await liquidityPool.minHealthFactor())
        .to.eq(healthFactor);
    });

    it("Should NOT allow others to set minimal health factor", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      const healthFactor = 500n * 10000n / 100n;
      await expect(liquidityPool.connect(user).setHealthFactor(healthFactor))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow WITHDRAW_PROFIT_ROLE to pause and unpause borrowing", async function () {
      const {liquidityPool, withdrawProfit} = await loadFixture(deployAll);
      expect(await liquidityPool.borrowPaused())
        .to.eq(false);
      await expect(liquidityPool.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPool, "BorrowPaused");
      expect(await liquidityPool.borrowPaused())
        .to.eq(true);
      await expect(liquidityPool.connect(withdrawProfit).unpauseBorrow())
        .to.emit(liquidityPool, "BorrowUnpaused");
      expect(await liquidityPool.borrowPaused())
        .to.eq(false);
    });

    it("Should NOT allow others to pause and unpause borrowing", async function () {
      const {liquidityPool, admin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).pauseBorrow())
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow WITHDRAW_PROFIT_ROLE to withdraw profit", async function () {
      const {
        liquidityPool, uni, UNI_DEC, uniOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * UNI_DEC;
      await uni.connect(uniOwner).transfer(liquidityPool.target, amountUni);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([uni.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(uni.target, user.address, amountUni);
      expect(await uni.balanceOf(user.address)).to.eq(amountUni);
    });

    it("Should NOT allow others to withdraw profit", async function () {
      const {liquidityPool, uni, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).withdrawProfit([uni.target], user.address))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to deposit collateral", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);
    });

    it("Should NOT allow others to deposit collateral", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, user} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(user).deposit(amount))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to withdraw collateral", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user.address, amount))
        .to.emit(liquidityPool, "WithdrawnFromAave").withArgs(user.address, amount);

      expect(await usdc.balanceOf(user.address)).to.be.eq(amount);
      expect(await liquidityPool.totalDeposited()).to.be.eq(0);
    });

    it("Should NOT allow others to withdraw collateral", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);

      await expect(liquidityPool.connect(user).withdraw(user.address, amount * 2n))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow PAUSER_ROLE to pause and unpause the contract", async function () {
      const {liquidityPool, pauser} = await loadFixture(deployAll);
      expect(await liquidityPool.paused())
        .to.eq(false);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");
      expect(await liquidityPool.paused())
        .to.eq(true);
      await expect(liquidityPool.connect(pauser).unpause())
        .to.emit(liquidityPool, "Unpaused");
      expect(await liquidityPool.paused())
        .to.eq(false);
    });

    it("Should NOT allow others to pause and unpause the contract", async function () {
      const {liquidityPool, admin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).pause())
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });
  });
});
