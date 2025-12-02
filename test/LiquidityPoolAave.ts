import {
  loadFixture, time, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, signBorrow, getBalance, signBorrowMany,
} from "./helpers";
import {ZERO_ADDRESS, ETH, NATIVE_TOKEN} from "../scripts/common";
import {encodeBytes32String, AbiCoder, hashMessage, Wallet} from "ethers";
import {
  MockTarget, MockBorrowSwap, LiquidityPoolAave, MockSignerTrue, MockSignerFalse
} from "../typechain-types";
import {networkConfig} from "../network.config";

async function now() {
  return BigInt(await time.latest());
}

function expectAlmostEqual(a: bigint, b: bigint, maxDiff: bigint = 2n): void {
  const diff = a - b;
  const absDiff = diff > 0n ? diff : -diff;
  expect(absDiff).to.be.lessThanOrEqual(maxDiff, `Expected ${a} to almost equal ${b}`);
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

    const WETH_ADDRESS = networkConfig.BASE.WrappedNativeToken;
    const WETH_OWNER_ADDRESS = process.env.WETH_OWNER_ADDRESS!;
    if (!WETH_OWNER_ADDRESS) throw new Error("Env variables not configured (WETH_OWNER_ADDRESS missing)");
    const weth = await hre.ethers.getContractAt("IWrappedNativeToken", WETH_ADDRESS);
    const wethOwner = await hre.ethers.getImpersonatedSigner(WETH_OWNER_ADDRESS);

    const USDC_DEC = 10n ** (await usdc.decimals());
    const GHO_DEC = 10n ** (await gho.decimals());
    const EURC_DEC = 10n ** (await eurc.decimals());
    const WETH_DEC = 10n ** 18n;

    // Initialize health factor as 5 (500%)
    const healthFactor = 500n * 10000n / 100n;
    // Initialize token LTV as 5%
    const defaultLtv = 5n * 10000n / 100n;

    const mockTarget = (
      await deploy("MockTarget", deployer)
    ) as MockTarget;

    const mockBorrowSwap = (
      await deploy("MockBorrowSwap", deployer)
    ) as MockBorrowSwap;

    const mockSignerTrue = (
      await deploy("MockSignerTrue", deployer)
    ) as MockSignerTrue;

    const mockSignerFalse = (
      await deploy("MockSignerFalse", deployer)
    ) as MockSignerFalse;

    const liquidityPool = (
      await deploy("LiquidityPoolAave", deployer, {},
        usdc, AAVE_POOL_PROVIDER, admin, mpc_signer, healthFactor, defaultLtv, weth, mockSignerTrue
      )
    ) as LiquidityPoolAave;

    const LIQUIDITY_ADMIN_ROLE = encodeBytes32String("LIQUIDITY_ADMIN_ROLE");
    await liquidityPool.connect(admin).grantRole(LIQUIDITY_ADMIN_ROLE, liquidityAdmin);

    const WITHDRAW_PROFIT_ROLE = encodeBytes32String("WITHDRAW_PROFIT_ROLE");
    await liquidityPool.connect(admin).grantRole(WITHDRAW_PROFIT_ROLE, withdrawProfit);

    const PAUSER_ROLE = encodeBytes32String("PAUSER_ROLE");
    await liquidityPool.connect(admin).grantRole(PAUSER_ROLE, pauser);

    return {
      deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, gho, ghoOwner, eurc, eurcOwner,
      liquidityPool, mockTarget, mockBorrowSwap, USDC_DEC, GHO_DEC, EURC_DEC, AAVE_POOL_PROVIDER,
      healthFactor, defaultLtv, aavePool, aToken, ghoDebtToken, eurcDebtToken, usdcDebtToken,
      nonSupportedToken, nonSupportedTokenOwner, liquidityAdmin, withdrawProfit, pauser, weth,
      wethOwner, WETH_DEC, mockSignerTrue, mockSignerFalse
    };
  };

  describe("Initialization", function () {
    it("Should initialize the contract with correct values", async function () {
      const {
        liquidityPool, usdc, AAVE_POOL_PROVIDER, healthFactor, defaultLtv, mpc_signer,
        aavePool, aToken, mockSignerTrue
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
      expect(await liquidityPool.signerAddress())
        .to.be.eq(mockSignerTrue);
    });

    it("Should NOT deploy the contract if token cannot be used as collateral", async function () {
      const {
        deployer, AAVE_POOL_PROVIDER, liquidityPool, gho, admin, mpc_signer, healthFactor, defaultLtv, weth,
        mockSignerTrue
      } = await loadFixture(deployAll);
      const startingNonce = await deployer.getNonce();
      await expect(deploy("LiquidityPoolAave", deployer, {nonce: startingNonce},
        gho, AAVE_POOL_PROVIDER, admin, mpc_signer, healthFactor, defaultLtv, weth, mockSignerTrue
      )).to.be.revertedWithCustomError(liquidityPool, "CollateralNotSupported");
    });
  });

  describe("Borrow, supply, repay, withdraw", function () {
    it("Should deposit to aave", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount - 2n);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);
      expectAlmostEqual(await liquidityPool.balance(usdc), 50n * USDC_DEC);
    });

    it("Should deposit to aave with pulling funds", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).approve(liquidityPool, amount);
      await expect(liquidityPool.connect(usdcOwner).depositWithPull(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount - 2n);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);
      expectAlmostEqual(await liquidityPool.balance(usdc), 50n * USDC_DEC);
    });

    it("Should borrow a token", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, user, user2, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        gho,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await gho.balanceOf(liquidityPool)).to.eq(amountToBorrow);
    });

    it("Should borrow a native token with contract call", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, weth, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 100000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 1n * ETH;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        NATIVE_TOKEN,
        amountToBorrow,
        mockTarget,
        callData.data,
      );

      await expect(liquidityPool.connect(user).borrow(
        NATIVE_TOKEN,
        amountToBorrow,
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0n);
      expect(await getBalance(liquidityPool)).to.eq(0n);
      expect(await liquidityPool.totalDeposited()).to.eq(amountLiquidity);
      expect(await weth.balanceOf(mockTarget)).to.eq(0n);
      expect(await getBalance(mockTarget)).to.eq(amountToBorrow);
      expect(await liquidityPool.balance(NATIVE_TOKEN)).to.eq(await liquidityPool.balance(weth));
    });

    it("Should borrow many tokens", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, user, user2, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      const amountToBorrow = 2n * GHO_DEC;
      const amountToBorrow2 = 3n * USDC_DEC;

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [gho, usdc],
        [amountToBorrow, amountToBorrow2],
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrowMany(
        [gho, usdc],
        [amountToBorrow, amountToBorrow2],
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await gho.balanceOf(liquidityPool)).to.eq(amountToBorrow);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountToBorrow2);
    });

    it("Should calculate token ltv if decimals of token and collateral are different", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, user, user2, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const availableBefore = await liquidityPool.balance(gho);
      const amountToBorrow = 2n * GHO_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        gho,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await gho.balanceOf(liquidityPool)).to.eq(amountToBorrow);
      expectAlmostEqual(await liquidityPool.balance(usdc), 50n * USDC_DEC);
      expect(await liquidityPool.balance(gho)).to.be.lessThan(availableBefore - amountToBorrow / 2n);
      expect(await liquidityPool.balance(gho)).to.be.greaterThan(availableBefore - amountToBorrow * 2n);
    });

    it("Should make a contract call to the recipient", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, gho, GHO_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * GHO_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(gho, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        mockTarget,
        callData.data,
      );

      await expect(liquidityPool.connect(user).borrow(
        gho,
        amountToBorrow,
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await gho.balanceOf(liquidityPool)).to.eq(0);
      expect(await gho.balanceOf(mockTarget)).to.eq(amountToBorrow);
    });

    it("Should borrow collateral", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, aToken, user, user2, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * USDC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountToBorrow);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amountCollateral - 1n);
      expectAlmostEqual(await liquidityPool.balance(usdc), 50n * USDC_DEC - amountToBorrow);
    });

    it("Should borrow a token with swap", async function () {
      // GHO is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, gho, GHO_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * GHO_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        gho,
        amountToBorrow,
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        gho,
        amountToBorrow,
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await gho.balanceOf(liquidityPool)).to.eq(0);
      expect(await gho.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(0);
      expect(await eurc.balanceOf(mockTarget)).to.eq(fillAmount);
    });

    it("Should borrow a token with swap and native fill", async function () {
      // USDC is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, mockBorrowSwap, weth, usdc, usdcOwner,
        user, mpc_signer, liquidityAdmin, USDC_DEC, wethOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      await weth.connect(wethOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [wethOwner.address]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        usdc,
        amountToBorrow,
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc,
        amountToBorrow,
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrowBubbleRevert(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await weth.balanceOf(mockBorrowSwap)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.eq(0);
      expect(await getBalance(mockTarget)).to.eq(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.eq(0);
    });

    it("Should NOT borrow a native token with swap", async function () {
      // ETH is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, USDC_DEC, usdc, usdcOwner,
        user, mpc_signer, wethOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 100000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 1n * ETH;
      const fillAmount = 1n * ETH;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [wethOwner.address]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        NATIVE_TOKEN,
        amountToBorrow,
        mockTarget,
        callData.data,
      );

      await expect(liquidityPool.connect(user).borrowAndSwap(
        NATIVE_TOKEN,
        amountToBorrow,
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      )).to.be.revertedWithCustomError(liquidityPool, "NativeBorrowDenied");

      await expect(liquidityPool.connect(user).borrowAndSwap(
        NATIVE_TOKEN,
        amountToBorrow,
        {fillToken: weth, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      )).to.be.revertedWithCustomError(liquidityPool, "NativeBorrowDenied");
    });

    it("Should revert borrow if swap with native fill returned insufficient amount", async function () {
      // WETH is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, WETH_DEC, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 3n * WETH_DEC;
      const fillAmount = 1n * ETH;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [ZERO_ADDRESS, fillAmount - 1n]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        weth,
        amountToBorrow,
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        weth,
        amountToBorrow,
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrowBubbleRevert(
        liquidityPool, borrowCalldata.data
      )).to.be.revertedWithCustomError(liquidityPool, "InsufficientSwapResult");
    });

    it("Should borrow with swap with native fill if returned extra amount", async function () {
      // WETH is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, WETH_DEC, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 3n * WETH_DEC;
      const fillAmount = 1n * ETH;
      const returnedAmount = fillAmount + 1n;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [ZERO_ADDRESS, returnedAmount]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        weth,
        amountToBorrow,
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        weth,
        amountToBorrow,
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await weth.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow - returnedAmount);
      expect(await getBalance(liquidityPool)).to.eq(returnedAmount - fillAmount);
      expect(await getBalance(mockTarget)).to.eq(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.eq(0);
    });

    it("Should borrow many tokens [weth, native] with contract call", async function () {
      const {
        liquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, liquidityAdmin,
        usdc, usdcOwner, USDC_DEC,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 3n * WETH_DEC;
      const amountToBorrow2 = 4n * ETH;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfillMany.populateTransaction(
        [weth, NATIVE_TOKEN],
        [amountToBorrow, amountToBorrow2],
        additionalData
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [weth, NATIVE_TOKEN],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [weth, NATIVE_TOKEN],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(amountLiquidity);
      expect(await weth.balanceOf(mockTarget)).to.eq(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.eq(0);
      expect(await getBalance(mockTarget)).to.eq(amountToBorrow2);
    });

    it("Should borrow many tokens [native, weth] with contract call", async function () {
      const {
        liquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, liquidityAdmin,
        usdc, usdcOwner, USDC_DEC,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 3n * WETH_DEC;
      const amountToBorrow2 = 4n * ETH;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfillMany.populateTransaction(
        [NATIVE_TOKEN, weth],
        [amountToBorrow2, amountToBorrow],
        additionalData
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [NATIVE_TOKEN, weth],
        [amountToBorrow2, amountToBorrow],
        mockTarget,
        callData.data,
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [NATIVE_TOKEN, weth],
        [amountToBorrow2, amountToBorrow],
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(amountLiquidity);
      expect(await weth.balanceOf(mockTarget)).to.eq(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.eq(0);
      expect(await getBalance(mockTarget)).to.eq(amountToBorrow2);
    });

    it("Should borrow many tokens [native, weth, native] with contract call", async function () {
      const {
        liquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, liquidityAdmin,
        usdc, usdcOwner, USDC_DEC,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 3n * WETH_DEC;
      const amountToBorrow2 = 4n * ETH;
      const amountToBorrow3 = 2n * ETH;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfillMany.populateTransaction(
        [NATIVE_TOKEN, weth],
        [amountToBorrow2 + amountToBorrow3, amountToBorrow],
        additionalData
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [NATIVE_TOKEN, weth, NATIVE_TOKEN],
        [amountToBorrow2, amountToBorrow, amountToBorrow3],
        mockTarget,
        callData.data,
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [NATIVE_TOKEN, weth, NATIVE_TOKEN],
        [amountToBorrow2, amountToBorrow, amountToBorrow3],
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(amountLiquidity);
      expect(await weth.balanceOf(mockTarget)).to.eq(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.eq(0);
      expect(await getBalance(mockTarget)).to.eq(amountToBorrow2 + amountToBorrow3);
    });

    it("Should borrow many tokens with swap", async function () {
      // GHO is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, gho, GHO_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      const amountToBorrow = 3n * GHO_DEC;
      const amountToBorrow2 = 2n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        [gho, usdc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [gho, usdc],
        [amountToBorrow, amountToBorrow2],
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await gho.balanceOf(liquidityPool)).to.eq(0);
      expect(await gho.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(0);
      expect(await eurc.balanceOf(mockTarget)).to.eq(fillAmount);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow2);
    });

    it("Should borrow many tokens with swap and native fill", async function () {
      // USDC is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, mockBorrowSwap, weth, usdc, usdcOwner,
        user, mpc_signer, liquidityAdmin, USDC_DEC, wethOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      await weth.connect(wethOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [wethOwner.address]
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        [usdc],
        [amountToBorrow],
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [usdc],
        [amountToBorrow],
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrowBubbleRevert(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await weth.balanceOf(mockBorrowSwap)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.eq(0);
      expect(await getBalance(mockTarget)).to.eq(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.eq(0);
    });

    it("Should NOT borrow many tokens with native with swap", async function () {
      // ETH is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, USDC_DEC, usdc, usdcOwner,
        user, mpc_signer, wethOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 100000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 1n * ETH;
      const fillAmount = 1n * ETH;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [wethOwner.address]
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [NATIVE_TOKEN],
        [amountToBorrow],
        mockTarget,
        callData.data,
      );

      await expect(liquidityPool.connect(user).borrowAndSwapMany(
        [NATIVE_TOKEN],
        [amountToBorrow],
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      )).to.be.revertedWithCustomError(liquidityPool, "NativeBorrowDenied");

      await expect(liquidityPool.connect(user).borrowAndSwapMany(
        [NATIVE_TOKEN],
        [amountToBorrow],
        {fillToken: weth, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      )).to.be.revertedWithCustomError(liquidityPool, "NativeBorrowDenied");
    });

    it("Should revert borrow many if swap with native fill returned insufficient amount", async function () {
      // WETH is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, WETH_DEC, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 3n * WETH_DEC;
      const fillAmount = 1n * ETH;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [ZERO_ADDRESS, fillAmount - 1n]
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        [weth],
        [amountToBorrow],
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [weth],
        [amountToBorrow],
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrowBubbleRevert(
        liquidityPool, borrowCalldata.data
      )).to.be.revertedWithCustomError(liquidityPool, "InsufficientSwapResult");
    });

    it("Should borrow many with swap with native fill if returned extra amount", async function () {
      // WETH is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, WETH_DEC, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 3n * WETH_DEC;
      const fillAmount = 1n * ETH;
      const returnedAmount = fillAmount + 1n;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [ZERO_ADDRESS, returnedAmount]
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        [weth],
        [amountToBorrow],
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [weth],
        [amountToBorrow],
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await weth.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow - returnedAmount);
      expect(await getBalance(liquidityPool)).to.eq(returnedAmount - fillAmount);
      expect(await getBalance(mockTarget)).to.eq(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.eq(0);
    });

    it("Should repay a debt", async function () {
      const {
        liquidityPool, usdc, eurc, mpc_signer, user, user2, usdcOwner, eurcOwner, liquidityAdmin, USDC_DEC, EURC_DEC,
        aavePool,
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const availableBefore = await liquidityPool.balance(eurc);
      const amountToBorrow = 3n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(amountToBorrow);

      await eurc.connect(eurcOwner).transfer(liquidityPool, amountToBorrow);

      await time.increase(3600);
      await expect(liquidityPool.connect(user).repay([eurc]))
        .to.emit(liquidityPool, "Repaid");
      expect(await eurc.allowance(liquidityPool, aavePool)).to.eq(0);
      expect(await eurc.balanceOf(liquidityPool)).to.be.lessThan(amountToBorrow);
      expect(await liquidityPool.balance(eurc)).to.be.lessThan(availableBefore + 1n * EURC_DEC);
      expect(await liquidityPool.balance(eurc)).to.be.greaterThan(availableBefore - 1n * EURC_DEC);
    });

    it("Should repay when the contract is paused", async function () {
      const {
        liquidityPool, usdc, eurc, mpc_signer, user, user2, usdcOwner, eurcOwner,
        liquidityAdmin, pauser, USDC_DEC, EURC_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const availableBefore = await liquidityPool.balance(eurc);
      const amountToBorrow = 3n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(amountToBorrow);

      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await eurc.connect(eurcOwner).transfer(liquidityPool, amountToBorrow);

      await time.increase(3600);
      await expect(liquidityPool.connect(user).repay([eurc]))
        .to.emit(liquidityPool, "Repaid");
      expect(await eurc.balanceOf(liquidityPool)).to.be.lessThan(amountToBorrow);
      expect(await liquidityPool.balance(eurc)).to.be.lessThan(availableBefore + 1n * EURC_DEC);
      expect(await liquidityPool.balance(eurc)).to.be.greaterThan(availableBefore - 1n * EURC_DEC);
    });

    it("Should deposit to aave multiple times", async function () {
      const {liquidityPool, usdc, usdcOwner, liquidityAdmin, USDC_DEC, aToken} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount * 2n - 1n);
      expectAlmostEqual(await liquidityPool.balance(usdc), 100n * USDC_DEC);
    });

    it("Should deposit when the contract is paused", async function () {
      const {liquidityPool, pauser, usdc, usdcOwner, USDC_DEC, liquidityAdmin, aToken} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");
      await usdc.connect(usdcOwner).approve(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(usdcOwner).depositWithPull(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amountCollateral);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amountCollateral * 2n - 1n);
      expectAlmostEqual(await liquidityPool.balance(usdc), 100n * USDC_DEC);
    });

    it("Should borrow and repay different tokens", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, eurc, user, user2, mpc_signer, usdcOwner, eurcOwner,
        liquidityAdmin, ghoOwner, ghoDebtToken, eurcDebtToken, EURC_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 10000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 1n * GHO_DEC;
      const amountToBorrow2 = 1n * EURC_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        gho,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await gho.balanceOf(liquidityPool)).to.eq(amountToBorrow);

      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow2,
        user2,
        "0x",
        hre.network.config.chainId,
        1n
      );

      await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow2,
        user2,
        "0x",
        1n,
        2000000000n,
        signature2);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(amountToBorrow2);

      // advance time by one hour
      await time.increase(3600);

      const eurcDebtBefore = await eurcDebtToken.balanceOf(liquidityPool);
      const ghoDebtBefore = await ghoDebtToken.balanceOf(liquidityPool);
      expect(eurcDebtBefore).to.be.greaterThan(amountToBorrow2);
      expect(ghoDebtBefore).to.be.greaterThan(amountToBorrow);

      // Repaying with the borrowed tokens that are still in the pool contract
      const tx = liquidityPool.connect(user).repay([eurc, gho]);
      await expect(tx)
        .to.emit(liquidityPool, "Repaid").withArgs(eurc.target, amountToBorrow2);
      await expect(tx)
        .to.emit(liquidityPool, "Repaid").withArgs(gho.target, amountToBorrow);
      const eurcDebtAfter1 = await eurcDebtToken.balanceOf(liquidityPool);
      expect(eurcDebtAfter1).to.be.lessThan(eurcDebtBefore);
      const ghoDebtAfter1 = await ghoDebtToken.balanceOf(liquidityPool);
      expect(ghoDebtAfter1).to.be.lessThan(ghoDebtBefore);

      await eurc.connect(eurcOwner).transfer(liquidityPool, amountToBorrow2);
      await expect(liquidityPool.connect(user).repay([eurc]))
      .to.emit(liquidityPool, "Repaid");
      const eurcDebtAfter2 = await eurcDebtToken.balanceOf(liquidityPool);
      expect(eurcDebtAfter2).to.eq(0);

      await gho.connect(ghoOwner).transfer(liquidityPool, amountToBorrow);
      await expect(liquidityPool.connect(user).repay([gho]))
        .to.emit(liquidityPool, "Repaid");
      const ghoDebtAfter2 = await ghoDebtToken.balanceOf(liquidityPool);
      expect(ghoDebtAfter2).to.eq(0);
    });

    it("Should repay if some tokens don't have debt", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, eurc, user, user2, mpc_signer, usdcOwner, eurcOwner,
        liquidityAdmin, ghoOwner, ghoDebtToken, eurcDebtToken, EURC_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        gho,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await gho.balanceOf(liquidityPool)).to.eq(amountToBorrow);

      // advance time by one hour
      await time.increase(3600);

      const ghoDebtBefore = await ghoDebtToken.balanceOf(liquidityPool);
      expect(ghoDebtBefore).to.be.greaterThan(amountToBorrow);

      await eurc.connect(eurcOwner).transfer(liquidityPool, 1n * EURC_DEC);
      await gho.connect(ghoOwner).transfer(liquidityPool, amountToBorrow);

      await expect(liquidityPool.connect(user).repay([eurc, gho]))
        .to.emit(liquidityPool, "Repaid");
      const eurcDebtAfter = await eurcDebtToken.balanceOf(liquidityPool);
      expect(eurcDebtAfter).to.eq(0);
      const ghoDebtAfter = await ghoDebtToken.balanceOf(liquidityPool);
      expect(ghoDebtAfter).to.eq(0);
    });

    it("Should repay collateral", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, mpc_signer, usdcOwner, liquidityAdmin,
        usdcDebtToken
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * USDC_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountToBorrow);

      // advance time by one hour
      await time.increase(3600);

      const usdcDebtBefore = await usdcDebtToken.balanceOf(liquidityPool);
      expect(usdcDebtBefore).to.be.greaterThan(amountToBorrow);

      await usdc.connect(usdcOwner).transfer(liquidityPool, amountToBorrow);

      await expect(liquidityPool.connect(user).repay([usdc]))
        .to.emit(liquidityPool, "Repaid");
      const usdcDebtAfter = await usdcDebtToken.balanceOf(liquidityPool);
      expect(usdcDebtAfter).to.eq(0);
      expect(await liquidityPool.balance(usdc)).to.be.greaterThanOrEqual(50n * USDC_DEC - 1n);
    });

    it("Should withdraw collateral from aave", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user,
        withdrawProfit, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount - 2n);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);

      // advance time by one hour to accrue interest
      await time.increase(3600);
      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount / 2n))
        .to.emit(liquidityPool, "WithdrawnFromAave").withArgs(user.address, amount / 2n);
      expect(await usdc.balanceOf(user)).to.be.eq(amount / 2n);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThan(amount / 2n);
      expect(await liquidityPool.balance(usdc)).to.be.greaterThan(25n * USDC_DEC);
      await liquidityPool.connect(liquidityAdmin).withdraw(user, amount / 2n);
      expect(await usdc.balanceOf(user)).to.be.eq(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThan(0);
      expect(await liquidityPool.balance(usdc)).to.be.greaterThan(0);

      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit(
        [usdc], user
      ))
        .to.emit(liquidityPool, "WithdrawnFromAave");
      expect(await aToken.balanceOf(liquidityPool)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0);
      expect(await usdc.balanceOf(user)).to.greaterThan(amount);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await aToken.balanceOf(liquidityPool)).to.eq(0);
    });

    it("Should withdraw accrued interest from aave", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user,
        withdrawProfit, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount - 2n);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);

       // advance time by one hour to accrue interest
      await time.increase(3600);
      const aTokenBalance = await aToken.balanceOf(liquidityPool);
      expect(aTokenBalance).to.be.greaterThanOrEqual(amount + 1n);

      // try to withdraw by liquidityAdmin more than deposited
      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount + 1n))
        .to.be.revertedWithCustomError(liquidityPool, "InsufficientLiquidity");
      expect(await liquidityPool.balance(usdc)).to.be.greaterThan(50n * USDC_DEC);
      // withdraw interest as profit
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expect(await aToken.balanceOf(liquidityPool))
        .to.be.greaterThanOrEqual(amount - 2n)
        .and.to.be.lessThan(aTokenBalance);
      expect(await usdc.balanceOf(user)).to.be.greaterThanOrEqual(aTokenBalance - amount);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);
      expectAlmostEqual(await liquidityPool.balance(usdc), 50n * USDC_DEC);
    });

    it("Should withdraw profit for multiple tokens from the pool", async function () {
      const {
        liquidityPool, eurc, gho, EURC_DEC, eurcOwner, ghoOwner, withdrawProfit, user,
        GHO_DEC,
      } = await loadFixture(deployAll);
      const amountEURC = 1n * EURC_DEC;
      const amountGHO = 1n * GHO_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEURC);
      await gho.connect(ghoOwner).transfer(liquidityPool, amountGHO);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc, gho], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountEURC)
        .and.to.emit(liquidityPool, "ProfitWithdrawn").withArgs(gho.target, user.address, amountGHO);
      expect(await eurc.balanceOf(user)).to.eq(amountEURC);
      expect(await gho.balanceOf(user)).to.eq(amountGHO);
    });

    it("Should withdraw collateral as profit from the pool", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(usdc.target, user.address, amount);
      expect(await usdc.balanceOf(user)).to.eq(amount);
    });

    it("Should withdraw all available balance as profit ", async function () {
      const {liquidityPool, eurc, EURC_DEC, eurcOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amount);
      expect(await eurc.balanceOf(user)).to.eq(amount);
    });

    it("Should return 0 for balance of a non-supported token", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, nonSupportedToken, nonSupportedTokenOwner,
        liquidityAdmin
      } = await loadFixture(deployAll);
      const collateralAmount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, collateralAmount);
      await liquidityPool.connect(liquidityAdmin).deposit(collateralAmount);
      const amount = 2n * USDC_DEC;
      await nonSupportedToken.connect(nonSupportedTokenOwner).transfer(liquidityPool, amount);
      expectAlmostEqual(await liquidityPool.balance(usdc), 50n * USDC_DEC);
      expect(await liquidityPool.balance(nonSupportedToken)).to.eq(0);
    });

    it("Should withdraw non-supported token", async function () {
      const {
        liquidityPool, nonSupportedToken, nonSupportedTokenOwner, withdrawProfit, user, EURC_DEC
      } = await loadFixture(deployAll);
      const amount = 2n * EURC_DEC;
      await nonSupportedToken.connect(nonSupportedTokenOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([nonSupportedToken], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(nonSupportedToken.target, user.address, amount);
      expect(await nonSupportedToken.balanceOf(user)).to.eq(amount);
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
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;
      const signature = await signBorrow(
        user,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrow(
        gho,
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
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        gho,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      await expect(liquidityPool.connect(user).borrow(
        gho,
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
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        user2,
        "0x",
        hre.network.config.chainId,
        0n,
        deadline,
      );

      await expect(liquidityPool.connect(user).borrow(
        gho,
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
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 100n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TokenLtvExceeded");
    });

    it("Should NOT borrow many if token ltv is exceeded", async function () {
      const {
        liquidityPool, usdc, eurc, gho, GHO_DEC, mpc_signer, user, user2, usdcOwner,
        USDC_DEC, EURC_DEC, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      const amountToBorrow = 3n * EURC_DEC;
      const amountToBorrow2 = 60n * GHO_DEC;

      let signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [eurc, gho],
        [amountToBorrow, amountToBorrow2],
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [eurc, gho],
        [amountToBorrow, amountToBorrow2],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TokenLtvExceeded");

      signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [gho, eurc],
        [amountToBorrow2, amountToBorrow],
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [gho, eurc],
        [amountToBorrow2, amountToBorrow],
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
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      await expect(liquidityPool.connect(admin).setMinHealthFactor(5000n * 10000n / 100n))
        .to.emit(liquidityPool, "HealthFactorSet");

      const amountToBorrow = 20n * EURC_DEC;

      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature2))
      .to.be.revertedWithCustomError(liquidityPool, "HealthFactorTooLow");
    });

    it("Should NOT borrow many if health factor is too low", async function () {
      const {
        liquidityPool, admin, usdc, eurc, gho, mpc_signer, user, user2, usdcOwner,
        USDC_DEC, EURC_DEC, GHO_DEC, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      await expect(liquidityPool.connect(admin).setMinHealthFactor(5000n * 10000n / 100n))
        .to.emit(liquidityPool, "HealthFactorSet");

      const amountToBorrow = 2n * EURC_DEC;
      const amountToBorrow2 = 20n * GHO_DEC;

      const signature2 = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [eurc, gho],
        [amountToBorrow, amountToBorrow2],
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [eurc, gho],
        [amountToBorrow, amountToBorrow2],
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
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      const amountToBorrow = 1n * EURC_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
        hre.network.config.chainId,
        0n,
      );
      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
        hre.network.config.chainId,
        1n,
      );
      const signature3 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
        hre.network.config.chainId,
        2n,
      );
      const signature4 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
        hre.network.config.chainId,
        3n,
      );

      await liquidityPool.connect(admin).setBorrowTokenLTVs([eurc], [9999n]);
      // Storage warmup.
      await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1
      );

      const txWithLTVCheck = await (await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        1n,
        2000000000n,
        signature2
      )).wait();
      await liquidityPool.connect(admin).setBorrowTokenLTVs([eurc], [10000n]);
      const txWithoutLTVCheck = await (await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        2n,
        2000000000n,
        signature3
      )).wait();
      await liquidityPool.connect(admin).setBorrowTokenLTVs([eurc], [11000n]);
      const txWithoutLTVCheck2 = await (await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        3n,
        2000000000n,
        signature4
      )).wait();

      expect(txWithoutLTVCheck!.gasUsed).to.be.lessThan(txWithLTVCheck!.gasUsed);
      expectAlmostEqual(txWithoutLTVCheck!.gasUsed, txWithoutLTVCheck2!.gasUsed, 100n);
    });

    it("Should skip ltv check if default set to 100%", async function () {
      const {
        liquidityPool, admin, usdc, eurc, mpc_signer, user, user2, usdcOwner, USDC_DEC, EURC_DEC, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      const amountToBorrow = 1n * EURC_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
        hre.network.config.chainId,
        0n,
      );
      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
        hre.network.config.chainId,
        1n,
      );
      const signature3 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
        hre.network.config.chainId,
        2n,
      );
      const signature4 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
        hre.network.config.chainId,
        3n,
      );

      await liquidityPool.connect(admin).setDefaultLTV(9999n);
      // Storage warmup.
      await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1
      );

      const txWithLTVCheck = await (await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        1n,
        2000000000n,
        signature2
      )).wait();
      await liquidityPool.connect(admin).setDefaultLTV(10000n);
      const txWithoutLTVCheck = await (await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        2n,
        2000000000n,
        signature3
      )).wait();
      await liquidityPool.connect(admin).setDefaultLTV(11000n);
      const txWithoutLTVCheck2 = await (await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        3n,
        2000000000n,
        signature4
      )).wait();

      expect(txWithoutLTVCheck!.gasUsed).to.be.lessThan(txWithLTVCheck!.gasUsed);
      expectAlmostEqual(txWithoutLTVCheck!.gasUsed, txWithoutLTVCheck2!.gasUsed, 100n);
    });

    it("Should NOT borrow if target call fails", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, gho, GHO_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(gho, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        gho,
        callData.data,
      );

      await expect(liquidityPool.connect(user).borrow(
        gho,
        amountToBorrow,
        gho,
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
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrow(
        eurc,
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
        gho,
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
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user2).borrow(
        gho,
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
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * GHO_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      // user address is signed instead of mockBorrowSwap address
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        gho,
        amountToBorrow,
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
        .to.be.reverted;
    });

    it("Should NOT borrow and swap if the swap fails", async function () {
      // GHO is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, gho, GHO_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * GHO_DEC;
      const fillAmount = 2n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        gho,
        amountToBorrow,
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        gho,
        amountToBorrow,
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      // No EURC tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT borrow many if target call fails", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, gho, GHO_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      const amountToBorrow = 2n * GHO_DEC;
      const amountToBorrow2 = 3n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(gho, amountToBorrow, additionalData);

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [gho, usdc],
        [amountToBorrow, amountToBorrow2],
        gho,
        callData.data,
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [gho, usdc],
        [amountToBorrow, amountToBorrow2],
        gho,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TargetCallFailed");
    });

    it("Should NOT borrow many if borrowing is paused", async function () {
      const {liquidityPool, user, user2, withdrawProfit, mpc_signer, eurc, EURC_DEC} = await loadFixture(deployAll);

      // Pause borrowing
      await expect(liquidityPool.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPool, "BorrowPaused");

      const amountToBorrow = 2n * EURC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [eurc],
        [amountToBorrow],
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [eurc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "BorrowingIsPaused");
    });

    it("Should NOT borrow many if the contract is paused", async function () {
      const {liquidityPool, gho, user, user2, pauser} = await loadFixture(deployAll);

      // Pause the contract
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(user).borrowMany(
        [gho],
        [1n],
        user2,
        "0x",
        0n,
        2000000000n,
        "0x"))
      .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT borrow many if MPC signature is wrong (caller is wrong)", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer, gho,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [gho],
        [amountToBorrow],
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user2).borrowMany(
        [gho],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow and swap many if MPC signature is wrong (caller is wrong)", async function () {
      // GHO is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, gho, GHO_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      const amountToBorrow = 3n * GHO_DEC;
      const amountToBorrow2 = 2n * USDC_DEC;
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
        liquidityPool,
        user,
        [gho, usdc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [gho, usdc],
        [amountToBorrow, amountToBorrow2],
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
        .to.be.reverted;
    });

    it("Should NOT borrow and swap many if the swap fails", async function () {
      // GHO is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC, gho, GHO_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);

      const amountToBorrow = 3n * GHO_DEC;
      const amountToBorrow2 = 2n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        [gho, usdc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
      );

      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [gho, usdc],
        [amountToBorrow, amountToBorrow2],
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      // No EURC tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT borrow many if tokens and amounts have diff or zero length", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, mpc_signer, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      let signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [gho],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [gho],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidLength");

      signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [gho, gho],
        [amountToBorrow],
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [gho, gho],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidLength");

      signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [],
        [],
        user2,
        "0x",
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [],
        [],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidLength");
    });

    it("Should NOT repay if all tokens don't have debt or balance", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, GHO_DEC, eurc, user, mockTarget,
        mpc_signer, usdcOwner, eurcOwner, liquidityAdmin, EURC_DEC
      } = await loadFixture(deployAll);

      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * GHO_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(gho, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        mockTarget,
        callData.data,
      );

      await expect(liquidityPool.connect(user).borrow(
        gho,
        amountToBorrow,
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await gho.balanceOf(liquidityPool)).to.eq(0);
      expect(await gho.balanceOf(mockTarget)).to.eq(amountToBorrow);

      await eurc.connect(eurcOwner).transfer(liquidityPool, 2n * EURC_DEC);

      // No balance for gho, no dept for eurc
      await expect(liquidityPool.connect(user).repay([eurc, gho]))
        .to.be.revertedWithCustomError(liquidityPool, "NothingToRepay");
    });

    it("Should NOT repay unsupported tokens", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      const unsupportedToken = await hre.ethers.getContractAt("ERC20", "0x53fFFB19BAcD44b82e204d036D579E86097E5D09");

      // No balance for gho, no dept for eurc
      await expect(liquidityPool.connect(user).repay([unsupportedToken]))
        .to.be.revertedWithCustomError(liquidityPool, "NothingToRepay");
    });

    it("Should NOT withdraw collateral if not enough on aave", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, aToken, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount - 2n);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount * 2n))
        .to.be.reverted;
    });

    it("Should NOT withdraw collateral if health factor is too low", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin, eurc, mpc_signer, EURC_DEC, user2
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);

      const amountToBorrow = 30n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, 900n * USDC_DEC))
        .to.be.revertedWithCustomError(liquidityPool, "HealthFactorTooLow");
    });

    it("Should NOT withdraw accrued interest from aave by liquidity admin", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount - 2n);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);

       // advance time by one hour to accrue interest
      await time.increase(3600);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount + 1n);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount + 1n))
        .to.be.revertedWithCustomError(liquidityPool, "InsufficientLiquidity");
    });

    it("Should NOT withdraw collateral if the contract is paused", async function () {
      const {liquidityPool, user, liquidityAdmin, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, 10))
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
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc], user))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT withdraw profit to zero address", async function () {
      const {liquidityPool, eurc, withdrawProfit} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc], ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, "ZeroAddress()");
    });

    it("Should revert during withdrawing profit if no profit", async function () {
      const {liquidityPool, eurc, withdrawProfit, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc], user))
        .to.be.revertedWithCustomError(liquidityPool, "NoProfit()");
    });

    it("Should NOT withdraw profit as aToken", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, withdrawProfit, user, aToken, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount - 2n);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([aToken], user))
        .to.revertedWithCustomError(liquidityPool, "CannotWithdrawAToken");
    });

    it("Should NOT withdraw profit if the token has debt", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, gho, GHO_DEC, mpc_signer,
        liquidityAdmin, withdrawProfit, user, user2, ghoDebtToken, eurc, EURC_DEC, eurcOwner,
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      const amountEURC = 1n * EURC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      const amountToBorrow = 2n * GHO_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        gho,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        gho,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1);
      expect(await gho.balanceOf(liquidityPool)).to.eq(amountToBorrow);
      expect(await ghoDebtToken.balanceOf(liquidityPool)).to.be.greaterThan(0);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([gho], user))
        .to.be.revertedWithCustomError(liquidityPool, "NoProfit()");
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEURC);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc, gho], user))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expect(await gho.balanceOf(user)).to.eq(0);
      expect(await eurc.balanceOf(user)).to.eq(amountEURC);
    });

    it("Should NOT withdraw profit by unauthorized user", async function () {
      const {liquidityPool, eurc, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).withdrawProfit([eurc], user))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should NOT set token LTVs if array lengths don't match", async function () {
      const {liquidityPool, admin, eurc} = await loadFixture(deployAll);
      const eurc_ltv = 1000;
      const gho_ltv = 2000;
      await expect(liquidityPool.connect(admin).setBorrowTokenLTVs(
        [eurc],
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
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 1n * ETH / 100n;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        weth,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        weth,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await weth.balanceOf(liquidityPool)).to.eq(amountToBorrow);

      await user.sendTransaction({to: liquidityPool, value: amountToBorrow});
      expect(await getBalance(liquidityPool)).to.eq(amountToBorrow);

      const tx = liquidityPool.connect(user).repay([weth]);
      await expect(tx)
        .to.emit(liquidityPool, "Repaid");
      await expect(tx)
        .to.emit(weth, "Deposit")
        .withArgs(liquidityPool.target, amountToBorrow);
      expect(await weth.allowance(liquidityPool, aavePool)).to.eq(0);
      expect(await weth.balanceOf(liquidityPool)).to.be.lessThan(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.eq(0);
    });

    it("Should not wrap native tokens on repayment if the balance is 0", async function () {
      const {
        liquidityPool, usdc, weth, mpc_signer, user, user2, usdcOwner, liquidityAdmin, USDC_DEC,
        aavePool,
      } = await loadFixture(deployAll);
      const amountCollateral = 10000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 1n * ETH / 100n;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        weth,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        weth,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await weth.balanceOf(liquidityPool)).to.eq(amountToBorrow);

      expect(await getBalance(liquidityPool)).to.eq(0);

      const tx = liquidityPool.connect(user).repay([weth]);
      await expect(tx)
        .to.emit(liquidityPool, "Repaid");
      await expect(tx)
        .to.not.emit(weth, "Deposit");
      expect(await weth.allowance(liquidityPool, aavePool)).to.eq(0);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
    });

    it("Should not wrap native tokens on repayment of other tokens", async function () {
      const {
        liquidityPool, usdc, eurc, mpc_signer, user, user2, usdcOwner, eurcOwner, liquidityAdmin, USDC_DEC, EURC_DEC,
        aavePool, weth,
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountCollateral))
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * EURC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        "0x",
      );

      await liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(amountToBorrow);

      await eurc.connect(eurcOwner).transfer(liquidityPool, amountToBorrow);
      await user.sendTransaction({to: liquidityPool, value: amountToBorrow});

      await time.increase(3600);
      const tx = liquidityPool.connect(user).repay([eurc]);
      await expect(tx)
        .to.emit(liquidityPool, "Repaid");
      await expect(tx)
        .to.not.emit(weth, "Deposit");
      expect(await eurc.allowance(liquidityPool, aavePool)).to.eq(0);
      expect(await eurc.balanceOf(liquidityPool)).to.be.lessThan(amountToBorrow);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await getBalance(liquidityPool)).to.eq(amountToBorrow);
    });

    it("Should limit balance result by default LTV", async function () {
      const {
        liquidityPool, usdc, eurc, usdcOwner, liquidityAdmin, USDC_DEC, admin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);
      const availableUSDCBefore = await liquidityPool.balance(usdc);
      const availableEURCBefore = await liquidityPool.balance(eurc);
      const defaultLtv = 1000;
      await liquidityPool.connect(admin).setDefaultLTV(defaultLtv);
      const availableUSDCAfter = await liquidityPool.balance(usdc);
      const availableEURCAfter = await liquidityPool.balance(eurc);
      expectAlmostEqual(availableUSDCAfter, availableUSDCBefore * 2n);
      expectAlmostEqual(availableEURCAfter, availableEURCBefore * 2n);
    });

    it("Should limit balance result by specific token LTV", async function () {
      const {
        liquidityPool, usdc, eurc, usdcOwner, liquidityAdmin, USDC_DEC, admin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);
      const availableUSDCBefore = await liquidityPool.balance(usdc);
      const availableEURCBefore = await liquidityPool.balance(eurc);
      const newLtvUSDC = 1000;
      const newLtvEURC = 2000;
      await liquidityPool.connect(admin).setBorrowTokenLTVs(
        [usdc, eurc],
        [newLtvUSDC, newLtvEURC]
      );
      const availableUSDCAfter = await liquidityPool.balance(usdc);
      const availableEURCAfter = await liquidityPool.balance(eurc);
      expectAlmostEqual(availableUSDCAfter, availableUSDCBefore * 2n);
      expectAlmostEqual(availableEURCAfter, availableEURCBefore * 3n, 3n);
    });

    it("Should limit balance result by minimal health factor", async function () {
      const {
        liquidityPool, usdc, eurc, usdcOwner, liquidityAdmin, USDC_DEC, admin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);
      await liquidityPool.connect(admin).setDefaultLTV(100n * 10000n / 100n);
      await liquidityPool.connect(admin).setMinHealthFactor(100n * 10000n / 100n);
      const availableUSDCBefore = await liquidityPool.balance(usdc);
      const availableEURCBefore = await liquidityPool.balance(eurc);
      const newMinHealthFactor = 1000n * 10000n / 100n;
      await liquidityPool.connect(admin).setMinHealthFactor(newMinHealthFactor);
      const availableUSDCAfter = await liquidityPool.balance(usdc);
      const availableEURCAfter = await liquidityPool.balance(eurc);
      expectAlmostEqual(availableUSDCAfter, availableUSDCBefore / 10n);
      expectAlmostEqual(availableEURCAfter, availableEURCBefore / 10n);
    });

    it("Should limit balance result by Aave available liquidity", async function () {
      const {
        liquidityPool, usdc, usdcOwner, liquidityAdmin, USDC_DEC, admin, aavePool
      } = await loadFixture(deployAll);
      const usdcCB = await hre.ethers.getContractAt("ERC20", "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA");
      const aUsdcCB = await hre.ethers.getContractAt("ERC20", await aavePool.getReserveAToken(usdcCB));
      const amountCollateral = 2000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);
      await liquidityPool.connect(admin).setDefaultLTV(100n * 10000n / 100n);
      await liquidityPool.connect(admin).setMinHealthFactor(100n * 10000n / 100n);
      const availableUSDCCB = await liquidityPool.balance(usdcCB);
      const liquidityUSDCCB = await usdcCB.balanceOf(aUsdcCB);
      expect(availableUSDCCB).to.eq(liquidityUSDCCB);
    });

    it("Should limit balance result by default LTV maximum value 100%", async function () {
      const {
        liquidityPool, usdc, eurc, usdcOwner, liquidityAdmin, USDC_DEC, admin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);
      await liquidityPool.connect(admin).setDefaultLTV(10000);
      const availableUSDCBefore = await liquidityPool.balance(usdc);
      const availableEURCBefore = await liquidityPool.balance(eurc);
      const defaultLtv = 100000;
      await liquidityPool.connect(admin).setDefaultLTV(defaultLtv);
      const availableUSDCAfter = await liquidityPool.balance(usdc);
      const availableEURCAfter = await liquidityPool.balance(eurc);
      expectAlmostEqual(availableUSDCAfter, availableUSDCBefore);
      expectAlmostEqual(availableEURCAfter, availableEURCBefore);
    });

    it("Should limit balance result by specific LTV maximum value 100%", async function () {
      const {
        liquidityPool, usdc, eurc, usdcOwner, liquidityAdmin, USDC_DEC, admin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);
      await liquidityPool.connect(admin).setBorrowTokenLTVs(
        [usdc, eurc],
        [10000, 10000]
      );
      const availableUSDCBefore = await liquidityPool.balance(usdc);
      const availableEURCBefore = await liquidityPool.balance(eurc);
      const newLtvUSDC = 100000;
      const newLtvEURC = 200000;
      await liquidityPool.connect(admin).setBorrowTokenLTVs(
        [usdc, eurc],
        [newLtvUSDC, newLtvEURC]
      );
      const availableUSDCAfter = await liquidityPool.balance(usdc);
      const availableEURCAfter = await liquidityPool.balance(eurc);
      expectAlmostEqual(availableUSDCAfter, availableUSDCBefore);
      expectAlmostEqual(availableEURCAfter, availableEURCBefore);
    });

    it("Should limit balance result by minimal health factor minimum value 100%", async function () {
      const {
        liquidityPool, usdc, eurc, usdcOwner, liquidityAdmin, USDC_DEC, admin
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountCollateral);
      await liquidityPool.connect(liquidityAdmin).deposit(amountCollateral);
      await liquidityPool.connect(admin).setDefaultLTV(100n * 10000n / 100n);
      await liquidityPool.connect(admin).setMinHealthFactor(100n * 10000n / 100n);
      const availableUSDCBefore = await liquidityPool.balance(usdc);
      const availableEURCBefore = await liquidityPool.balance(eurc);
      const newMinHealthFactor = 1;
      await liquidityPool.connect(admin).setMinHealthFactor(newMinHealthFactor);
      const availableUSDCAfter = await liquidityPool.balance(usdc);
      const availableEURCAfter = await liquidityPool.balance(eurc);
      expectAlmostEqual(availableUSDCAfter, availableUSDCBefore);
      expectAlmostEqual(availableEURCAfter, availableEURCBefore);
    });
  });

  describe("Signature checking", function () {
    const MAGICVALUE = "0x1626ba7e";

    it("Should return MAGICVALUE if a contract signature is validated", async function () {
      const {liquidityPool} = await loadFixture(deployAll);
      const data = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      expect(await liquidityPool.isValidSignature(data, data))
        .to.eq(MAGICVALUE);
    });

    it("Should NOT return MAGICVALUE if a contract signature is invalid", async function () {
      const {liquidityPool, admin, mockSignerTrue, mockSignerFalse} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).setSignerAddress(mockSignerFalse))
        .to.emit(liquidityPool, "SignerAddressSet")
        .withArgs(mockSignerTrue, mockSignerFalse);
      const data = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      expect(await liquidityPool.isValidSignature(data, data))
        .to.not.eq(MAGICVALUE);
    });

    it("Should return MAGICVALUE if an EOA signature is validated", async function () {
      const {liquidityPool, admin, mockSignerTrue} = await loadFixture(deployAll);
      const signer = Wallet.createRandom().connect(hre.ethers.provider);
      await expect(liquidityPool.connect(admin).setSignerAddress(signer))
        .to.emit(liquidityPool, "SignerAddressSet")
        .withArgs(mockSignerTrue, signer);
      const data = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const message = hashMessage(data);
      const signature = await signer.signMessage(data);
      expect(await liquidityPool.isValidSignature(message, signature))
        .to.eq(MAGICVALUE);
    });

    it("Should NOT return MAGICVALUE if an EOA signature is invalid", async function () {
      const {liquidityPool, admin, mockSignerTrue} = await loadFixture(deployAll);
      const signer = Wallet.createRandom().connect(hre.ethers.provider);
      await expect(liquidityPool.connect(admin).setSignerAddress(signer))
        .to.emit(liquidityPool, "SignerAddressSet")
        .withArgs(mockSignerTrue, signer);
      const data = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const wrongData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeff";
      const wrongMessage = hashMessage(wrongData);
      const signature = await signer.signMessage(data);
      expect(await liquidityPool.isValidSignature(wrongMessage, signature))
        .to.not.eq(MAGICVALUE);
    });
  });

  describe("Roles and admin functions", function () {
    it("Should allow admin to set MPC address", async function () {
      const {liquidityPool, admin, user} = await loadFixture(deployAll);
      const oldMPCAddress = await liquidityPool.mpcAddress();
      await expect(liquidityPool.connect(admin).setMPCAddress(user))
        .to.emit(liquidityPool, "MPCAddressSet").withArgs(oldMPCAddress, user.address);
      expect(await liquidityPool.mpcAddress())
        .to.eq(user.address);
    });

    it("Should NOT allow others to set MPC address", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).setMPCAddress(user))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should NOT allow admin to set MPC address to 0", async function () {
      const {liquidityPool, admin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).setMPCAddress(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, "ZeroAddress()");
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
      const oldUniLTV = await liquidityPool.borrowTokenLTV(eurc);
      const oldRplLTV = await liquidityPool.borrowTokenLTV(gho);
      const eurc_ltv = 1000;
      const gho_ltv = 2000;
      await expect(liquidityPool.connect(admin).setBorrowTokenLTVs(
        [eurc, gho],
        [eurc_ltv, gho_ltv]
      ))
        .to.emit(liquidityPool, "BorrowTokenLTVSet").withArgs(eurc.target, oldUniLTV, eurc_ltv)
        .and.to.emit(liquidityPool, "BorrowTokenLTVSet").withArgs(gho.target, oldRplLTV, gho_ltv);
      expect(await liquidityPool.borrowTokenLTV(eurc))
        .to.eq(eurc_ltv);
      expect(await liquidityPool.borrowTokenLTV(gho))
        .to.eq(gho_ltv);
    });

    it("Should NOT allow others to set token LTV for each token", async function () {
      const {liquidityPool, user, eurc} = await loadFixture(deployAll);
      const ltv = 1000;
      await expect(liquidityPool.connect(user).setBorrowTokenLTVs([eurc], [ltv]))
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
      const amountEURC = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEURC);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountEURC);
      expect(await eurc.balanceOf(user)).to.eq(amountEURC);
    });

    it("Should NOT allow others to withdraw profit", async function () {
      const {liquidityPool, eurc, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).withdrawProfit([eurc], user))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should wrap native tokens on withdraw profit", async function () {
      const {
        liquidityPool, eurc, EURC_DEC, eurcOwner, withdrawProfit, user, weth,
      } = await loadFixture(deployAll);
      const amountEURC = 1n * EURC_DEC;
      const amountEth = 1n * ETH;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEURC);
      await user.sendTransaction({to: liquidityPool, value: amountEth});
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc, weth], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountEURC);
      expect(await eurc.balanceOf(user)).to.eq(amountEURC);
      expect(await weth.balanceOf(user)).to.eq(amountEth);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to deposit collateral", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount - 2n);
    });

    it("Should NOT allow others to deposit collateral", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, user} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(user).deposit(amount))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to withdraw collateral", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount - 2n);

      await time.increase(100);
      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount))
        .to.emit(liquidityPool, "WithdrawnFromAave").withArgs(user.address, amount);

      expect(await usdc.balanceOf(user)).to.be.eq(amount);
      expect(await liquidityPool.totalDeposited()).to.be.eq(0);
      expect(await aToken.balanceOf(liquidityPool)).to.greaterThanOrEqual(0);
    });

    it("Should NOT allow others to withdraw collateral", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amount - 2n);

      await expect(liquidityPool.connect(user).withdraw(user, amount * 2n))
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
