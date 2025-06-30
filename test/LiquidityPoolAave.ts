import {
  loadFixture, time, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, signBorrow, getBalance,
} from "./helpers";
import {ZERO_ADDRESS, ETH} from "../scripts/common";
import {encodeBytes32String, AbiCoder} from "ethers";
import {
  MockTarget, MockBorrowSwap, LiquidityPoolAave
} from "../typechain-types";
import {networkConfig} from "../network.config";

async function now() {
  return BigInt(await time.latest());
}

describe("LiquidityPoolAave", function () {
  const deployAll = async () => {
    const [
      deployer, admin, user, user2, mpc_signer, liquidityAdmin, withdrawProfit, pauser
    ] = await hre.ethers.getSigners();
    await setCode(user2.address, "0x00");

    const forkNetworkConfig = networkConfig.BASE;

    const AAVE_POOL_PROVIDER = forkNetworkConfig.AavePool!.AaveAddressesProvider;
    const aavePoolAddressesProvider = await hre.ethers.getContractAt("IAavePoolAddressesProvider", AAVE_POOL_PROVIDER);
    const aavePoolAddress = await aavePoolAddressesProvider.getPool();
    const aavePool = await hre.ethers.getContractAt("IAavePool", aavePoolAddress);

    const USDC_ADDRESS = forkNetworkConfig.USDC;
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    if (!USDC_OWNER_ADDRESS) throw new Error("Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const usdc = await hre.ethers.getContractAt("ERC20", USDC_ADDRESS);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const collateralData = await aavePool.getReserveData(USDC_ADDRESS);
    const aToken = await hre.ethers.getContractAt("ERC20", collateralData[8]);
    const usdcDebtToken = await hre.ethers.getContractAt("ERC20", collateralData[10]);

    const GHO_ADDRESS = "0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee"; 
    const GHO_OWNER_ADDRESS = process.env.GHO_OWNER_ADDRESS!;
    if (!GHO_OWNER_ADDRESS) throw new Error("Env variables not configured (GHO_OWNER_ADDRESS missing)");
    const gho = await hre.ethers.getContractAt("ERC20", GHO_ADDRESS);
    const ghoOwner = await hre.ethers.getImpersonatedSigner(GHO_OWNER_ADDRESS);
    const ghoData = await aavePool.getReserveData(GHO_ADDRESS);
    const ghoDebtToken = await hre.ethers.getContractAt("ERC20", ghoData[10]);

    const EURC_ADDRESS = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42"; 
    const EURC_OWNER_ADDRESS = process.env.EURC_OWNER_ADDRESS!;
    if (!EURC_OWNER_ADDRESS) throw new Error("Env variables not configured (EURC_OWNER_ADDRESS missing)");
    const eurc = await hre.ethers.getContractAt("ERC20", EURC_ADDRESS);
    const eurcOwner = await hre.ethers.getImpersonatedSigner(EURC_OWNER_ADDRESS);
    const eurcData = await aavePool.getReserveData(EURC_ADDRESS);
    const eurcDebtToken = await hre.ethers.getContractAt("ERC20", eurcData[10]);
    await setBalance(EURC_OWNER_ADDRESS, 10n ** 18n);

    // PRIME token used as not supported by aave
    const NON_SUPPORTED_TOKEN_ADDRESS = "0xfA980cEd6895AC314E7dE34Ef1bFAE90a5AdD21b";
    const NON_SUPPORTED_TOKEN_OWNER_ADDRESS = process.env.PRIME_OWNER_ADDRESS!;
    if (!NON_SUPPORTED_TOKEN_OWNER_ADDRESS)
      throw new Error("Env variables not configured (PRIME_OWNER_ADDRESS missing)");
    const nonSupportedToken = await hre.ethers.getContractAt("ERC20", NON_SUPPORTED_TOKEN_ADDRESS);
    const nonSupportedTokenOwner = await hre.ethers.getImpersonatedSigner(NON_SUPPORTED_TOKEN_OWNER_ADDRESS);
    await setBalance(NON_SUPPORTED_TOKEN_OWNER_ADDRESS, 10n ** 18n);

    const WETH_ADDRESS = forkNetworkConfig.WrappedNativeToken;
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", WETH_ADDRESS);

    const USDC_DEC = 10n ** (await usdc.decimals());
    const GHO_DEC = 10n ** (await gho.decimals());
    const EURC_DEC = 10n ** (await eurc.decimals());

    // Initialize health factor as 5 (500%)
    const healthFactor = 500n * 10000n / 100n;
    // Initialize token LTV as 5%
    const defaultLtv = 5n * 10000n / 100n;
    const liquidityPool = (
      await deploy("LiquidityPoolAave", deployer, {},
        usdc.target, AAVE_POOL_PROVIDER, admin.address, mpc_signer.address, healthFactor, defaultLtv, weth.target
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

    return {deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, gho, ghoOwner, eurc, eurcOwner,
      liquidityPool, mockTarget, mockBorrowSwap, USDC_DEC, GHO_DEC, EURC_DEC, AAVE_POOL_PROVIDER,
      healthFactor, defaultLtv, aavePool, aToken, ghoDebtToken, eurcDebtToken, usdcDebtToken,
      nonSupportedToken, nonSupportedTokenOwner, liquidityAdmin, withdrawProfit, pauser, weth};
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
        deployer, AAVE_POOL_PROVIDER, liquidityPool, gho, admin, mpc_signer, healthFactor, defaultLtv, weth
      } = await loadFixture(deployAll);
      const startingNonce = await deployer.getNonce();
      await expect(deploy("LiquidityPoolAave", deployer, {nonce: startingNonce},
        gho.target, AAVE_POOL_PROVIDER, admin.address, mpc_signer.address, healthFactor, defaultLtv, weth.target
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
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, user, user2, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        gho.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await gho.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);
    });

    it("Should calculate token ltv if decimals of token and collateral are different", async function () {
      const {
        liquidityPool, usdc, eurc, mpc_signer, user, user2, usdcOwner, liquidityAdmin, USDC_DEC, EURC_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await eurc.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);
      expect(await eurc.allowance(liquidityPool.target, user2.address)).to.eq(amountToBorrow);
    });

    it("Should make a contract call to the recipient", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, gho, GHO_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * GHO_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(gho.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        gho.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await gho.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await gho.balanceOf(mockTarget.target)).to.eq(amountToBorrow);
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
      // GHO is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, gho, GHO_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * GHO_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap.target, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [gho.target, amountToBorrow, eurc.target, eurcOwner.address, fillAmount]
          );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        mockBorrowSwap.target as string,
        gho.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        gho.target,
        amountToBorrow,
        {fillToken: eurc.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool.target, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await gho.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await gho.balanceOf(mockBorrowSwap.target)).to.eq(amountToBorrow);
      expect(await eurc.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await eurc.balanceOf(mockTarget.target)).to.eq(fillAmount);
    });

    it("Should repay a debt", async function () {
      const {
        liquidityPool, usdc, eurc, mpc_signer, user, user2, usdcOwner, eurcOwner, liquidityAdmin, USDC_DEC, EURC_DEC,
        aavePool,
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await eurc.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      await eurc.connect(eurcOwner).transfer(liquidityPool.target, amountToBorrow);

      await time.increase(3600);
      await expect(liquidityPool.connect(user).repay([eurc.target]))
        .to.emit(liquidityPool, "Repaid");
      expect(await eurc.allowance(liquidityPool.target, aavePool.target)).to.eq(0);
      expect(await eurc.balanceOf(liquidityPool.target)).to.be.lessThan(amountToBorrow);
    });

    it("Should repay when the contract is paused", async function () {
      const {
        liquidityPool, usdc, eurc, mpc_signer, user, user2, usdcOwner, eurcOwner,
        liquidityAdmin, pauser, USDC_DEC, EURC_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await eurc.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await eurc.connect(eurcOwner).transfer(liquidityPool.target, amountToBorrow);

      await time.increase(3600);
      await expect(liquidityPool.connect(user).repay([eurc.target]))
        .to.emit(liquidityPool, "Repaid");
      expect(await eurc.balanceOf(liquidityPool.target)).to.be.lessThan(amountToBorrow);
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
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, eurc, user, user2, mpc_signer, usdcOwner, eurcOwner,
        liquidityAdmin, ghoOwner, ghoDebtToken, eurcDebtToken, EURC_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 10000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 1n * GHO_DEC;
      const amountToBorrow2 = 1n * EURC_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        gho.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await gho.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow2.toString(),
        user2.address,
        "0x",
        31337,
        1n
      );

      await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow2,
        user2,
        "0x",
        1n,
        2000000000n,
        signature2);
      expect(await eurc.balanceOf(liquidityPool.target)).to.eq(amountToBorrow2);

      // advance time by one hour
      await time.increase(3600);

      const eurcDebtBefore = await eurcDebtToken.balanceOf(liquidityPool.target);
      const ghoDebtBefore = await ghoDebtToken.balanceOf(liquidityPool.target);
      expect(eurcDebtBefore).to.be.greaterThan(amountToBorrow2);
      expect(ghoDebtBefore).to.be.greaterThan(amountToBorrow);

      // Repaying with the borrowed tokens that are still in the pool contract
      const tx = liquidityPool.connect(user).repay([eurc.target, gho.target]);
      await expect(tx)
        .to.emit(liquidityPool, "Repaid").withArgs(eurc.target, amountToBorrow2);
      await expect(tx)
        .to.emit(liquidityPool, "Repaid").withArgs(gho.target, amountToBorrow);
      const eurcDebtAfter1 = await eurcDebtToken.balanceOf(liquidityPool.target);
      expect(eurcDebtAfter1).to.be.lessThan(eurcDebtBefore);
      const ghoDebtAfter1 = await ghoDebtToken.balanceOf(liquidityPool.target);
      expect(ghoDebtAfter1).to.be.lessThan(ghoDebtBefore);

      await eurc.connect(eurcOwner).transfer(liquidityPool.target, amountToBorrow2);
      await expect(liquidityPool.connect(user).repay([eurc.target]))
      .to.emit(liquidityPool, "Repaid");
      const eurcDebtAfter2 = await eurcDebtToken.balanceOf(liquidityPool.target);
      expect(eurcDebtAfter2).to.eq(0);

      await gho.connect(ghoOwner).transfer(liquidityPool.target, amountToBorrow);
      await expect(liquidityPool.connect(user).repay([gho.target]))
        .to.emit(liquidityPool, "Repaid");
      const ghoDebtAfter2 = await ghoDebtToken.balanceOf(liquidityPool.target);
      expect(ghoDebtAfter2).to.eq(0);
    });

    it("Should repay if some tokens don't have debt", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, eurc, user, user2, mpc_signer, usdcOwner, eurcOwner,
        liquidityAdmin, ghoOwner, ghoDebtToken, eurcDebtToken, EURC_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        gho.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await gho.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      // advance time by one hour
      await time.increase(3600);

      const ghoDebtBefore = await ghoDebtToken.balanceOf(liquidityPool.target);
      expect(ghoDebtBefore).to.be.greaterThan(amountToBorrow);

      await eurc.connect(eurcOwner).transfer(liquidityPool.target, 1n * EURC_DEC);
      await gho.connect(ghoOwner).transfer(liquidityPool.target, amountToBorrow);

      await expect(liquidityPool.connect(user).repay([eurc.target, gho.target]))
        .to.emit(liquidityPool, "Repaid");
      const eurcDebtAfter = await eurcDebtToken.balanceOf(liquidityPool.target);
      expect(eurcDebtAfter).to.eq(0);
      const ghoDebtAfter = await ghoDebtToken.balanceOf(liquidityPool.target);
      expect(ghoDebtAfter).to.eq(0);
    });

    it("Should repay collateral", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, mpc_signer, usdcOwner, liquidityAdmin,
        usdcDebtToken, eurcDebtToken
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
      const usdcDebtAfter = await eurcDebtToken.balanceOf(liquidityPool.target);
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

      // advance time by one hour to accrue interest
      await time.increase(3600);
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
        liquidityPool, eurc, gho, EURC_DEC, eurcOwner, ghoOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * EURC_DEC;
      const amountRpl = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool.target, amountUni);
      await gho.connect(ghoOwner).transfer(liquidityPool.target, amountRpl);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc.target, gho.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountUni)
        .and.to.emit(liquidityPool, "ProfitWithdrawn").withArgs(gho.target, user.address, amountRpl);
      expect(await eurc.balanceOf(user.address)).to.eq(amountUni);
      expect(await gho.balanceOf(user.address)).to.eq(amountRpl);
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
      const {liquidityPool, eurc, EURC_DEC, eurcOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amount);
      expect(await eurc.balanceOf(user.address)).to.eq(amount);
    });

    it("Should withdraw non-supported token", async function () {
      const {
        liquidityPool, nonSupportedToken, nonSupportedTokenOwner, withdrawProfit, user, EURC_DEC
      } = await loadFixture(deployAll);
      const amount = 2n * EURC_DEC;
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
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;
      const signature = await signBorrow(
        user,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        gho.target,
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
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        gho.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      await expect(liquidityPool.connect(user).borrow(
        gho.target,
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
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        0n,
        deadline,
      );

      await expect(liquidityPool.connect(user).borrow(
        gho.target,
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
        liquidityPool, usdc, eurc, mpc_signer, user, user2, usdcOwner, USDC_DEC, EURC_DEC, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 100n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        eurc.target,
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
        liquidityPool, admin, usdc, eurc, mpc_signer, user, user2, usdcOwner, USDC_DEC, EURC_DEC, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      await expect(liquidityPool.connect(admin).setMinHealthFactor(5000n * 10000n / 100n))
        .to.emit(liquidityPool, "HealthFactorSet");

      const amountToBorrow = 20n * EURC_DEC;

      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature2))
      .to.be.revertedWithCustomError(liquidityPool, "HealthFactorTooLow");
    });

    it("Should skip ltv check if set to 100%", async function () {
      const {
        liquidityPool, admin, usdc, eurc, mpc_signer, user, user2, usdcOwner, USDC_DEC, EURC_DEC, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      const amountToBorrow = 1n * EURC_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        0n,
      );
      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        1n,
      );
      const signature3 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        2n,
      );
      const signature4 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        3n,
      );

      await liquidityPool.connect(admin).setBorrowTokenLTVs([eurc.target], [9999n]);
      // Storage warmup.
      await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1
      );

      const txWithLTVCheck = await (await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        1n,
        2000000000n,
        signature2
      )).wait();
      await liquidityPool.connect(admin).setBorrowTokenLTVs([eurc.target], [10000n]);
      const txWithoutLTVCheck = await (await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        2n,
        2000000000n,
        signature3
      )).wait();
      await liquidityPool.connect(admin).setBorrowTokenLTVs([eurc.target], [11000n]);
      const txWithoutLTVCheck2 = await (await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        3n,
        2000000000n,
        signature4
      )).wait();

      expect(txWithoutLTVCheck!.gasUsed).to.be.lessThan(txWithLTVCheck!.gasUsed);
      expect(txWithoutLTVCheck!.gasUsed).to.eq(txWithoutLTVCheck2!.gasUsed);
      console.log(txWithLTVCheck);
      console.log(txWithoutLTVCheck);
      console.log(txWithoutLTVCheck2);
    });

    it("Should skip ltv check if default set to 100%", async function () {
      const {
        liquidityPool, admin, usdc, eurc, mpc_signer, user, user2, usdcOwner, USDC_DEC, EURC_DEC, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      const amountToBorrow = 1n * EURC_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        0n,
      );
      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        1n,
      );
      const signature3 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        2n,
      );
      const signature4 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        3n,
      );

      await liquidityPool.connect(admin).setDefaultLTV(9999n);
      // Storage warmup.
      await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1
      );

      const txWithLTVCheck = await (await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        1n,
        2000000000n,
        signature2
      )).wait();
      await liquidityPool.connect(admin).setDefaultLTV(10000n);
      const txWithoutLTVCheck = await (await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        2n,
        2000000000n,
        signature3
      )).wait();
      await liquidityPool.connect(admin).setDefaultLTV(11000n);
      const txWithoutLTVCheck2 = await (await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        3n,
        2000000000n,
        signature4
      )).wait();

      expect(txWithoutLTVCheck!.gasUsed).to.be.lessThan(txWithLTVCheck!.gasUsed);
      expect(txWithoutLTVCheck!.gasUsed).to.eq(txWithoutLTVCheck2!.gasUsed);
      console.log(txWithLTVCheck);
      console.log(txWithoutLTVCheck);
      console.log(txWithoutLTVCheck2);
    });

    it("Should NOT borrow if target call fails", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, gho, GHO_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(gho.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        gho.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        gho.target,
        amountToBorrow,
        gho.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TargetCallFailed");
    });

    it("Should NOT borrow if borrowing is paused", async function () {
      const {liquidityPool, user, user2, withdrawProfit, mpc_signer, eurc, EURC_DEC} = await loadFixture(deployAll);

      // Pause borrowing
      await expect(liquidityPool.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPool, "BorrowPaused");

      const amountToBorrow = 2n * EURC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "BorrowingIsPaused");
    });

    it("Should NOT borrow if the contract is paused", async function () {
      const {liquidityPool, gho, user, user2, pauser} = await loadFixture(deployAll);

      // Pause the contract
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(user).borrow(
        gho.target,
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
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer, gho,
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
        gho.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user2).borrow(
        gho.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow and swap if MPC signature is wrong (caller is wrong)", async function () {
      // GHO is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, gho, GHO_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * GHO_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap.target, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [gho.target, amountToBorrow, eurc.target, eurcOwner.address, fillAmount]
          );

      // user address is signed instead of mockBorrowSwap address
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        gho.target,
        amountToBorrow,
        {fillToken: eurc.target, fillAmount, swapData},
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
      // GHO is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, gho, GHO_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * GHO_DEC;
      const fillAmount = 2n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [gho.target, amountToBorrow, eurc.target, eurcOwner.address, fillAmount]
          );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        mockBorrowSwap.target as string,
        gho.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        gho.target,
        amountToBorrow,
        {fillToken: eurc.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      // No EURC tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool.target, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT repay if all tokens don't have debt or balance", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, eurc, user, mockTarget,
        mpc_signer, usdcOwner, eurcOwner, liquidityAdmin, EURC_DEC
      } = await loadFixture(deployAll);

      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(gho.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        gho.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await gho.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await gho.balanceOf(mockTarget.target)).to.eq(amountToBorrow);

      await eurc.connect(eurcOwner).transfer(liquidityPool.target, 2n * EURC_DEC);

      // No balance for gho, no dept for eurc
      await expect(liquidityPool.connect(user).repay([eurc.target, gho.target]))
        .to.be.revertedWithCustomError(liquidityPool, "NothingToRepay");
    });

    it("Should NOT repay unsupported tokens", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      const unsupportedToken = await hre.ethers.getContractAt("ERC20", "0x53fFFB19BAcD44b82e204d036D579E86097E5D09");

      // No balance for gho, no dept for eurc
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
        liquidityPool, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin, eurc, mpc_signer, EURC_DEC, user2
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);

      const amountToBorrow = 30n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user.address, 900n * USDC_DEC))
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

    it("Should NOT withdraw collateral to zero address", async function () {
      const {liquidityPool, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(liquidityAdmin).withdraw(ZERO_ADDRESS, 10))
        .to.be.revertedWithCustomError(liquidityPool, "ZeroAddress()");
    });

    it("Should NOT withdraw profit if the contract is paused", async function () {
      const {liquidityPool, user, eurc, withdrawProfit, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc.target], user.address))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT withdraw profit to zero address", async function () {
      const {liquidityPool, eurc, withdrawProfit} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc.target], ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, "ZeroAddress()");
    });

    it("Should revert during withdrawing profit if no profit", async function () {
      const {liquidityPool, eurc, withdrawProfit, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc.target], user.address))
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
        liquidityPool, usdc, usdcOwner, USDC_DEC, gho, GHO_DEC, mpc_signer,
        liquidityAdmin, withdrawProfit, user, user2, ghoDebtToken, eurc, EURC_DEC, eurcOwner,
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      const amountUni = 1n * EURC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      const amountToBorrow = 2n * GHO_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        gho.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        gho.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await gho.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);
      expect(await ghoDebtToken.balanceOf(liquidityPool.target)).to.be.greaterThan(0);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([gho.target], user.address))
        .to.be.revertedWithCustomError(liquidityPool, "NoProfit()");
      await eurc.connect(eurcOwner).transfer(liquidityPool.target, amountUni);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc.target, gho.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expect(await gho.balanceOf(user.address)).to.eq(0);
      expect(await eurc.balanceOf(user.address)).to.eq(amountUni);
    });

    it("Should NOT withdraw profit by unauthorized user", async function () {
      const {liquidityPool, eurc, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).withdrawProfit([eurc.target], user.address))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should NOT set token LTVs if array lengths don't match", async function () {
      const {liquidityPool, admin, eurc} = await loadFixture(deployAll);
      const eurc_ltv = 1000;
      const gho_ltv = 2000;
      await expect(liquidityPool.connect(admin).setBorrowTokenLTVs(
        [eurc.target],
        [eurc_ltv, gho_ltv]
      ))
        .to.be.revertedWithCustomError(liquidityPool, "InvalidLength");
    });

    it("Should allow to receive native tokens", async function () {
      // Covered in Should wrap native tokens on repayment
    });

    it("Should wrap native tokens on repayment", async function () {
      const {
        liquidityPool, usdc, weth, mpc_signer, user, user2, usdcOwner, liquidityAdmin, USDC_DEC,
        aavePool,
      } = await loadFixture(deployAll);
      const amountCollateral = 10000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 1n * ETH / 100n;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        weth.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        weth.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await weth.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      await user.sendTransaction({to: liquidityPool.target, value: amountToBorrow});
      expect(await getBalance(liquidityPool.target)).to.eq(amountToBorrow);

      const tx = liquidityPool.connect(user).repay([weth.target]);
      await expect(tx)
        .to.emit(liquidityPool, "Repaid");
      await expect(tx)
        .to.emit(weth, "Deposit")
        .withArgs(liquidityPool.target, amountToBorrow);
      expect(await weth.allowance(liquidityPool.target, aavePool.target)).to.eq(0);
      expect(await weth.balanceOf(liquidityPool.target)).to.be.lessThan(amountToBorrow);
      expect(await getBalance(liquidityPool.target)).to.eq(0);
    });

    it("Should not wrap native tokens on repayment if the balance is 0", async function () {
      const {
        liquidityPool, usdc, weth, mpc_signer, user, user2, usdcOwner, liquidityAdmin, USDC_DEC,
        aavePool,
      } = await loadFixture(deployAll);
      const amountCollateral = 10000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 1n * ETH / 100n;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        weth.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        weth.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await weth.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      expect(await getBalance(liquidityPool.target)).to.eq(0);

      const tx = liquidityPool.connect(user).repay([weth.target]);
      await expect(tx)
        .to.emit(liquidityPool, "Repaid");
      await expect(tx)
        .to.not.emit(weth, "Deposit");
      expect(await weth.allowance(liquidityPool.target, aavePool.target)).to.eq(0);
      expect(await weth.balanceOf(liquidityPool.target)).to.eq(0);
    });

    it("Should not wrap native tokens on repayment of other tokens", async function () {
      const {
        liquidityPool, usdc, eurc, mpc_signer, user, user2, usdcOwner, eurcOwner, liquidityAdmin, USDC_DEC, EURC_DEC,
        aavePool, weth,
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        user.address as string,
        eurc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await eurc.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      await eurc.connect(eurcOwner).transfer(liquidityPool.target, amountToBorrow);
      await user.sendTransaction({to: liquidityPool.target, value: amountToBorrow});

      await time.increase(3600);
      const tx = liquidityPool.connect(user).repay([eurc.target]);
      await expect(tx)
        .to.emit(liquidityPool, "Repaid");
      await expect(tx)
        .to.not.emit(weth, "Deposit");
      expect(await eurc.allowance(liquidityPool.target, aavePool.target)).to.eq(0);
      expect(await eurc.balanceOf(liquidityPool.target)).to.be.lessThan(amountToBorrow);
      expect(await weth.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await getBalance(liquidityPool.target)).to.eq(amountToBorrow);
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
      const {liquidityPool, admin, eurc, gho} = await loadFixture(deployAll);
      const oldUniLTV = await liquidityPool.borrowTokenLTV(eurc.target);
      const oldRplLTV = await liquidityPool.borrowTokenLTV(gho.target);
      const eurc_ltv = 1000;
      const gho_ltv = 2000;
      await expect(liquidityPool.connect(admin).setBorrowTokenLTVs(
        [eurc.target, gho.target],
        [eurc_ltv, gho_ltv]
      ))
        .to.emit(liquidityPool, "BorrowTokenLTVSet").withArgs(eurc.target, oldUniLTV, eurc_ltv)
        .and.to.emit(liquidityPool, "BorrowTokenLTVSet").withArgs(gho.target, oldRplLTV, gho_ltv);
      expect(await liquidityPool.borrowTokenLTV(eurc.target))
        .to.eq(eurc_ltv);
      expect(await liquidityPool.borrowTokenLTV(gho.target))
        .to.eq(gho_ltv);
    });

    it("Should NOT allow others to set token LTV for each token", async function () {
      const {liquidityPool, user, eurc} = await loadFixture(deployAll);
      const ltv = 1000;
      await expect(liquidityPool.connect(user).setBorrowTokenLTVs([eurc.target], [ltv]))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow admin to set minimal health factor", async function () {
      const {liquidityPool, admin} = await loadFixture(deployAll);
      const oldHealthFactor = await liquidityPool.minHealthFactor();
      const healthFactor = 300n * 10000n / 100n;
      await expect(liquidityPool.connect(admin).setMinHealthFactor(healthFactor))
        .to.emit(liquidityPool, "HealthFactorSet").withArgs(oldHealthFactor, healthFactor);
      expect(await liquidityPool.minHealthFactor())
        .to.eq(healthFactor);
    });

    it("Should NOT allow others to set minimal health factor", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      const healthFactor = 500n * 10000n / 100n;
      await expect(liquidityPool.connect(user).setMinHealthFactor(healthFactor))
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
        liquidityPool, eurc, EURC_DEC, eurcOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool.target, amountUni);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountUni);
      expect(await eurc.balanceOf(user.address)).to.eq(amountUni);
    });

    it("Should NOT allow others to withdraw profit", async function () {
      const {liquidityPool, eurc, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).withdrawProfit([eurc.target], user.address))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should wrap native tokens on withdraw profit", async function () {
      const {
        liquidityPool, eurc, EURC_DEC, eurcOwner, withdrawProfit, user, weth,
      } = await loadFixture(deployAll);
      const amountUni = 1n * EURC_DEC;
      const amountEth = 1n * ETH;
      await eurc.connect(eurcOwner).transfer(liquidityPool.target, amountUni);
      await user.sendTransaction({to: liquidityPool.target, value: amountEth});
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc.target, weth.target], user.address))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountUni);
      expect(await eurc.balanceOf(user.address)).to.eq(amountUni);
      expect(await weth.balanceOf(user.address)).to.eq(amountEth);
      expect(await weth.balanceOf(liquidityPool.target)).to.eq(0);
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
      expect(await aToken.balanceOf(liquidityPool.target)).to.greaterThanOrEqual(0);
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
