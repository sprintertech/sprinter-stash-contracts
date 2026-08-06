import {loadFixture, time, setCode} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import {anyValue} from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import hre from "hardhat";
import {AbiCoder, hashMessage} from "ethers";
import {
  deploy, getContractAt, signBorrow, signBorrowMany, getBalance, setupTests, packAmount, toBytes32,
} from "./helpers";
import {ZERO_ADDRESS, NATIVE_TOKEN, ETH} from "../scripts/common";
import {
  MockTarget, MockSignerTrue, MockSignerFalse, MockBorrowSwap, LiquidityPoolMorphoV2,
  TransparentUpgradeableProxy, IMorphoVaultV2, ERC20,
} from "../typechain-types";
import {prodNetworkConfig as networkConfig} from "../network.config";

// Steakhouse Prime USDC, a real Morpho Vault V2 on Base (asset() == Base USDC).
const MORPHO_VAULT_ADDRESS = "0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9";

// The vault is real and continuously accrues interest based on elapsed block.timestamp, so unlike
// a static mock, "no time passed" or "no yield accrued" is never exactly true once even one local
// transaction has been mined since deposit. This tolerance absorbs that incidental real yield
// (observed to be a handful of wei per transaction) without masking a real accounting bug, which
// would be orders of magnitude larger than this.
function expectAlmostEqual(a: bigint, b: bigint, maxDiff: bigint = 50n): void {
  const diff = a - b;
  const absDiff = diff > 0n ? diff : -diff;
  expect(absDiff).to.be.lessThanOrEqual(maxDiff, `Expected ${a} to almost equal ${b}`);
}

describe("LiquidityPoolMorphoV2", function () {
  setupTests();

  const deployAll = async () => {
    const [
      deployer, admin, user, user2, mpc_signer,
      liquidityAdmin, withdrawProfit, pauser, directBorrower, forceDeallocator,
    ] = await hre.ethers.getSigners();
    await setCode(user2.address, "0x00");

    const USDC_ADDRESS = networkConfig.BASE.Tokens.USDC.Address;
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    if (!USDC_OWNER_ADDRESS) throw new Error("Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const usdc = (await hre.ethers.getContractAt("ERC20", USDC_ADDRESS)) as unknown as ERC20;
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const USDC_DEC = 10n ** (await usdc.decimals());

    // Foreign tokens (never touch the Morpho vault): used as fill/profit/donation tokens, exactly
    // like in test/LiquidityPool.ts, to confirm the inherited (non-overridden) base logic still
    // works when layered on top of the Morpho vault-backed pool.
    const GHO_ADDRESS = "0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee";
    const GHO_OWNER_ADDRESS = process.env.GHO_OWNER_ADDRESS;
    if (!GHO_OWNER_ADDRESS) throw new Error("Env variables not configured (GHO_OWNER_ADDRESS missing)");
    const gho = (await hre.ethers.getContractAt("ERC20", GHO_ADDRESS)) as unknown as ERC20;
    const ghoOwner = await hre.ethers.getImpersonatedSigner(GHO_OWNER_ADDRESS);
    const GHO_DEC = 10n ** (await gho.decimals());

    const EURC_ADDRESS = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";
    const EURC_OWNER_ADDRESS = process.env.EURC_OWNER_ADDRESS;
    if (!EURC_OWNER_ADDRESS) throw new Error("Env variables not configured (EURC_OWNER_ADDRESS missing)");
    const eurc = (await hre.ethers.getContractAt("ERC20", EURC_ADDRESS)) as unknown as ERC20;
    const eurcOwner = await hre.ethers.getImpersonatedSigner(EURC_OWNER_ADDRESS);
    const EURC_DEC = 10n ** (await eurc.decimals());

    const WETH_ADDRESS = networkConfig.BASE.WrappedNativeToken;
    const WETH_OWNER_ADDRESS = process.env.WETH_OWNER_ADDRESS;
    if (!WETH_OWNER_ADDRESS) throw new Error("Env variables not configured (WETH_OWNER_ADDRESS missing)");
    const weth = (await hre.ethers.getContractAt("ERC20", WETH_ADDRESS)) as unknown as ERC20;
    const wethOwner = await hre.ethers.getImpersonatedSigner(WETH_OWNER_ADDRESS);
    const WETH_DEC = 10n ** (await weth.decimals());

    const morphoVault = (await hre.ethers.getContractAt("IMorphoVaultV2", MORPHO_VAULT_ADDRESS)) as IMorphoVaultV2;

    const mockTarget = (await deploy("MockTarget", deployer)) as MockTarget;
    const mockBorrowSwap = (await deploy("MockBorrowSwap", deployer)) as MockBorrowSwap;
    const mockSignerTrue = (await deploy("MockSignerTrue", deployer)) as MockSignerTrue;
    const mockSignerFalse = (await deploy("MockSignerFalse", deployer)) as MockSignerFalse;

    const liquidityPoolImpl = (
      await deploy(
        "LiquidityPoolMorphoV2", deployer, {}, usdc, morphoVault, networkConfig.BASE.WrappedNativeToken
      )
    ) as LiquidityPoolMorphoV2;
    const liquidityPoolInit = (await liquidityPoolImpl.initialize.populateTransaction(
      admin, mpc_signer, mockSignerTrue
    )).data;
    const liquidityPoolProxy = (await deploy(
      "TransparentUpgradeableProxy", deployer, {}, liquidityPoolImpl, admin, liquidityPoolInit
    )) as TransparentUpgradeableProxy;
    const liquidityPool = (
      await getContractAt("LiquidityPoolMorphoV2", liquidityPoolProxy, deployer)
    ) as LiquidityPoolMorphoV2;

    await liquidityPool.connect(admin).grantRole(toBytes32("LIQUIDITY_ADMIN_ROLE"), liquidityAdmin);
    await liquidityPool.connect(admin).grantRole(toBytes32("WITHDRAW_PROFIT_ROLE"), withdrawProfit);
    await liquidityPool.connect(admin).grantRole(toBytes32("PAUSER_ROLE"), pauser);
    await liquidityPool.connect(admin).grantRole(toBytes32("DIRECT_BORROW_ROLE"), directBorrower);
    await liquidityPool.connect(admin).grantRole(toBytes32("FORCE_DEALLOCATE_ROLE"), forceDeallocator);

    return {
      deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, USDC_DEC, morphoVault,
      gho, ghoOwner, GHO_DEC, eurc, eurcOwner, EURC_DEC, weth, wethOwner, WETH_DEC,
      liquidityPool, liquidityPoolImpl, mockTarget, mockBorrowSwap, mockSignerTrue, mockSignerFalse,
      liquidityAdmin, withdrawProfit, pauser, directBorrower, forceDeallocator,
    };
  };

  async function now() {
    return BigInt(await time.latest());
  }

  describe("Initialization", function () {
    it("Should initialize the contract with correct values", async function () {
      const {
        liquidityPool, usdc, morphoVault, mpc_signer, mockSignerTrue, liquidityPoolImpl, admin
      } = await loadFixture(deployAll);
      expect(await liquidityPool.ASSETS()).to.equal(usdc.target);
      expect(await liquidityPool.MORPHO_VAULT()).to.equal(morphoVault.target);
      expect(await liquidityPool.mpcAddress()).to.equal(mpc_signer.address);
      expect(await liquidityPool.signerAddress()).to.equal(mockSignerTrue.target);
      await expect(liquidityPoolImpl.initialize(admin, mpc_signer, mockSignerTrue)).to.be.reverted;
      await expect(liquidityPool.initialize(admin, mpc_signer, mockSignerTrue)).to.be.reverted;
    });

    it("Should NOT deploy the contract if the vault address is 0", async function () {
      const {deployer, usdc, liquidityPool} = await loadFixture(deployAll);
      await expect(deploy(
        "LiquidityPoolMorphoV2", deployer, {}, usdc, ZERO_ADDRESS, networkConfig.BASE.WrappedNativeToken
      )).to.be.revertedWithCustomError(liquidityPool, "ZeroAddress");
    });

    it("Should NOT deploy the contract if the liquidity token doesn't match the vault's asset", async function () {
      const {deployer, morphoVault, liquidityPool} = await loadFixture(deployAll);
      const weth = networkConfig.BASE.WrappedNativeToken;
      await expect(deploy(
        "LiquidityPoolMorphoV2", deployer, {}, weth, morphoVault, weth
      )).to.be.revertedWithCustomError(liquidityPool, "IncompatibleAssets");
    });
  });

  describe("Deposit", function () {
    it("Should deposit into the Morpho vault", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, liquidityAdmin, morphoVault} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);

      const tx = liquidityPool.connect(liquidityAdmin).deposit(amount);
      await expect(tx).to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amount);
      await expect(tx).to.emit(liquidityPool, "SuppliedToMorphoVault").withArgs(amount);

      expect(await liquidityPool.totalDeposited()).to.equal(amount);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await morphoVault.balanceOf(liquidityPool)).to.be.greaterThan(0n);
      expectAlmostEqual(await liquidityPool.balance(usdc), amount);
    });

    it("Should deposit into the Morpho vault with pulling funds", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).approve(liquidityPool, amount);

      await expect(liquidityPool.connect(usdcOwner).depositWithPull(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(usdcOwner, amount);

      expect(await liquidityPool.totalDeposited()).to.equal(amount);
      expectAlmostEqual(await liquidityPool.balance(usdc), amount);
    });

    it("Should deposit when the contract is paused", async function () {
      const {liquidityPool, pauser, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause()).to.emit(liquidityPool, "Paused");

      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit");
      await usdc.connect(usdcOwner).approve(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(usdcOwner).depositWithPull(amountLiquidity))
        .to.emit(liquidityPool, "Deposit").withArgs(usdcOwner, amountLiquidity);
      // balance() always reports 0 while the contract is paused, regardless of the real position.
      expect(await liquidityPool.balance(usdc)).to.equal(0n);
    });

    it("Should NOT deposit if no collateral on contract", async function () {
      const {liquidityPool, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(10))
        .to.be.revertedWithCustomError(liquidityPool, "NotEnoughToDeposit");
    });

    it("Should return 0 for balance of other tokens", async function () {
      const {liquidityPool, gho, GHO_DEC, ghoOwner} = await loadFixture(deployAll);
      const amountLiquidity = 1000n * GHO_DEC;
      await gho.connect(ghoOwner).transfer(liquidityPool, amountLiquidity);
      expect(await liquidityPool.balance(gho)).to.equal(0n);
    });
  });

  describe("Borrow", function () {
    it("Should borrow, withdrawing funds directly from the Morpho vault", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, mockTarget, user, mpc_signer,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 100n * USDC_DEC;
      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, "0x");
      const signature = await signBorrow(
        mpc_signer, liquidityPool, user, usdc, amountToBorrow, mockTarget, callData.data
      );

      const tx = liquidityPool.connect(user).borrow(
        usdc, amountToBorrow, mockTarget, callData.data, 0n, 2000000000n, signature
      );
      await expect(tx).to.emit(mockTarget, "DataReceived").withArgs("0x");

      expect(await usdc.balanceOf(mockTarget)).to.equal(amountToBorrow);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await liquidityPool.totalDeposited()).to.equal(amountLiquidity);
      expectAlmostEqual(await liquidityPool.balance(usdc), amountLiquidity - amountToBorrow);
    });

    it("Should revert borrowing a token other than ASSETS", async function () {
      const {liquidityPool, mockTarget, user, mpc_signer} = await loadFixture(deployAll);
      const weth = networkConfig.BASE.WrappedNativeToken;
      const amountToBorrow = 1n;
      const callData = await mockTarget.fulfill.populateTransaction(weth, amountToBorrow, "0x");
      const signature = await signBorrow(
        mpc_signer, liquidityPool, user, weth, amountToBorrow, mockTarget, callData.data
      );
      await expect(liquidityPool.connect(user).borrow(
        weth, amountToBorrow, mockTarget, callData.data, 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidBorrowToken");
    });

    it("Should borrow a token with swap", async function () {
      // USDC (from the vault) is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address"], [eurcOwner.address]);

      const signature = await signBorrow(
        mpc_signer, liquidityPool, mockBorrowSwap, usdc, amountToBorrow, mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc, amountToBorrow, {fillToken: eurc, fillAmount, swapData},
        mockTarget, callData.data, 0n, 2000000000n, signature,
      );

      const tx = await mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data);
      await expect(tx).to.emit(mockBorrowSwap, "Swapped").withArgs(swapData);
      await expect(tx).to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.equal(amountToBorrow);
      expect(await eurc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await eurc.balanceOf(mockTarget)).to.equal(fillAmount);
      expectAlmostEqual(await liquidityPool.balance(usdc), amountLiquidity - amountToBorrow);
    });

    it("Should borrow a token with swap and native fill", async function () {
      // USDC (from the vault) is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, mockBorrowSwap, weth, usdc, usdcOwner,
        user, mpc_signer, liquidityAdmin, USDC_DEC, wethOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      await weth.connect(wethOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address"], [wethOwner.address]);

      const signature = await signBorrow(
        mpc_signer, liquidityPool, mockBorrowSwap, usdc, amountToBorrow, mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc, amountToBorrow, {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget, callData.data, 0n, 2000000000n, signature,
      );

      const tx = await mockBorrowSwap.connect(user).callBorrowBubbleRevert(liquidityPool, borrowCalldata.data);
      await expect(tx).to.emit(mockBorrowSwap, "Swapped").withArgs(swapData);
      await expect(tx).to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.equal(0n);
      expect(await weth.balanceOf(mockBorrowSwap)).to.equal(0n);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.equal(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.equal(0n);
      expect(await getBalance(mockTarget)).to.equal(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.equal(0n);
    });

    it("Should revert borrow if swap with native fill returned insufficient amount", async function () {
      const {
        liquidityPool, mockTarget, weth, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin, wethOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      await weth.connect(wethOwner).transfer(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [ZERO_ADDRESS, fillAmount - 1n]);

      const signature = await signBorrow(
        mpc_signer, liquidityPool, mockBorrowSwap, usdc, amountToBorrow, mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc, amountToBorrow, {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget, callData.data, 0n, 2000000000n, signature,
      );

      await expect(mockBorrowSwap.connect(user).callBorrowBubbleRevert(
        liquidityPool, borrowCalldata.data
      )).to.be.revertedWithCustomError(liquidityPool, "InsufficientSwapResult");
    });

    it("Should borrow with swap with native fill if returned extra amount", async function () {
      const {
        liquidityPool, mockTarget, weth, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin, wethOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      const returnedAmount = fillAmount + 1n;
      await weth.connect(wethOwner).transfer(mockBorrowSwap, returnedAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [ZERO_ADDRESS, returnedAmount]);

      const signature = await signBorrow(
        mpc_signer, liquidityPool, mockBorrowSwap, usdc, amountToBorrow, mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc, amountToBorrow, {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget, callData.data, 0n, 2000000000n, signature,
      );

      const tx = await mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data);
      await expect(tx).to.emit(mockBorrowSwap, "Swapped").withArgs(swapData);
      await expect(tx).to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.equal(0n);
      expect(await weth.balanceOf(mockBorrowSwap)).to.equal(0n);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.equal(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.equal(returnedAmount - fillAmount);
      expect(await getBalance(mockTarget)).to.equal(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.equal(0n);
      expect(await liquidityPool.balance(weth)).to.equal(0n);
      expect(await liquidityPool.balance(NATIVE_TOKEN)).to.equal(0n);
    });

    it("Should borrow many tokens with contract call", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const amountToBorrow2 = 4n * USDC_DEC;
      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      // Only ASSETS can be borrowed, so when borrowing many the second amount's approval
      // overrides the first one. Unlike the plain LiquidityPool (where tokens already sit as raw
      // balance and borrowing is a no-op), each loop iteration here actively withdraws its amount
      // from the vault, so the first iteration's amountToBorrow is pulled out of the vault and then
      // stranded as raw balance on the pool once its approval gets overwritten by the second entry.
      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow2, additionalData);
      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc, usdc], [amountToBorrow, amountToBorrow2],
        mockTarget, callData.data,
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, usdc], [amountToBorrow, amountToBorrow2], mockTarget, callData.data, 0n, 2000000000n, signature
      )).to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(amountToBorrow);
      expect(await liquidityPool.totalDeposited()).to.equal(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget)).to.equal(amountToBorrow2);
    });

    it("Should borrow many tokens with swap", async function () {
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address"], [eurcOwner.address]);

      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, mockBorrowSwap, [usdc], [amountToBorrow], mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [usdc], [amountToBorrow], {fillToken: eurc, fillAmount, swapData},
        mockTarget, callData.data, 0n, 2000000000n, signature,
      );

      const tx = await mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data);
      await expect(tx).to.emit(mockBorrowSwap, "Swapped").withArgs(swapData);
      await expect(tx).to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.equal(amountToBorrow);
      expect(await eurc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await eurc.balanceOf(mockTarget)).to.equal(fillAmount);
    });

    it("Should borrow many tokens with swap and native fill", async function () {
      const {
        liquidityPool, mockTarget, mockBorrowSwap, weth, usdc, usdcOwner,
        user, mpc_signer, liquidityAdmin, USDC_DEC, wethOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      await weth.connect(wethOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address"], [wethOwner.address]);

      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, mockBorrowSwap, [usdc], [amountToBorrow], mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [usdc], [amountToBorrow], {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget, callData.data, 0n, 2000000000n, signature,
      );

      const tx = await mockBorrowSwap.connect(user).callBorrowBubbleRevert(liquidityPool, borrowCalldata.data);
      await expect(tx).to.emit(mockBorrowSwap, "Swapped").withArgs(swapData);
      await expect(tx).to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.equal(amountToBorrow);
      expect(await weth.balanceOf(liquidityPool)).to.equal(0n);
      expect(await weth.balanceOf(mockBorrowSwap)).to.equal(0n);
      expect(await getBalance(liquidityPool)).to.equal(0n);
      expect(await getBalance(mockTarget)).to.equal(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.equal(0n);
    });

    it("Should revert borrow many if swap with native fill returned insufficient amount", async function () {
      const {
        liquidityPool, mockTarget, weth, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin, wethOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      await weth.connect(wethOwner).transfer(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [ZERO_ADDRESS, fillAmount - 1n]);

      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, mockBorrowSwap, [usdc], [amountToBorrow], mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [usdc], [amountToBorrow], {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget, callData.data, 0n, 2000000000n, signature,
      );

      await expect(mockBorrowSwap.connect(user).callBorrowBubbleRevert(
        liquidityPool, borrowCalldata.data
      )).to.be.revertedWithCustomError(liquidityPool, "InsufficientSwapResult");
    });

    it("Should borrow many with swap with native fill if returned extra amount", async function () {
      const {
        liquidityPool, mockTarget, weth, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin, wethOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      const returnedAmount = fillAmount + 1n;
      await weth.connect(wethOwner).transfer(mockBorrowSwap, returnedAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [ZERO_ADDRESS, returnedAmount]);

      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, mockBorrowSwap, [usdc], [amountToBorrow], mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [usdc], [amountToBorrow], {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget, callData.data, 0n, 2000000000n, signature,
      );

      const tx = await mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data);
      await expect(tx).to.emit(mockBorrowSwap, "Swapped").withArgs(swapData);
      await expect(tx).to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.equal(amountToBorrow);
      expect(await weth.balanceOf(liquidityPool)).to.equal(0n);
      expect(await weth.balanceOf(mockBorrowSwap)).to.equal(0n);
      expect(await getBalance(liquidityPool)).to.equal(returnedAmount - fillAmount);
      expect(await getBalance(mockTarget)).to.equal(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.equal(0n);
    });

    it("Should NOT borrow if MPC signature is wrong", async function () {
      const {liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin} = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      // Signed by `user` instead of the real mpc_signer.
      const signature = await signBorrow(user, liquidityPool, user, usdc, amountToBorrow, user2, "0x");

      await expect(liquidityPool.connect(user).borrow(
        usdc, amountToBorrow, user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow if MPC signature nonce is reused", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(mpc_signer, liquidityPool, user, usdc, amountToBorrow, user2, "0x");

      await liquidityPool.connect(user).borrow(usdc, amountToBorrow, user2, "0x", 0n, 2000000000n, signature);
      await expect(liquidityPool.connect(user).borrow(
        usdc, amountToBorrow, user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "NonceAlreadyUsed");
    });

    it("Should NOT borrow if MPC signature is expired", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrow(
        mpc_signer, liquidityPool, user, usdc, amountToBorrow, user2, "0x", undefined, 0n, deadline,
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc, amountToBorrow, user2, "0x", 0n, deadline, signature
      )).to.be.revertedWithCustomError(liquidityPool, "ExpiredSignature");
    });

    it("Should NOT borrow if target call fails", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, additionalData);
      // Target is `usdc`, which has no fulfill() function: the target call itself fails.
      const signature = await signBorrow(
        mpc_signer, liquidityPool, user, usdc, amountToBorrow, usdc, callData.data,
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc, amountToBorrow, usdc, callData.data, 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "TargetCallFailed");
    });

    it("Should NOT borrow if borrowing is paused", async function () {
      const {
        liquidityPool, user, user2, withdrawProfit, mpc_signer, usdc, USDC_DEC, usdcOwner,
      } = await loadFixture(deployAll);
      await usdc.connect(usdcOwner).transfer(liquidityPool, 1000n * USDC_DEC);
      await expect(liquidityPool.connect(withdrawProfit).pauseBorrow()).to.emit(liquidityPool, "BorrowPaused");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(mpc_signer, liquidityPool, user, usdc, amountToBorrow, user2, "0x");

      await expect(liquidityPool.connect(user).borrow(
        usdc, amountToBorrow, user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "BorrowingIsPaused");
      expect(await liquidityPool.balance(usdc)).to.equal(0n);
    });

    it("Should NOT borrow if the contract is paused", async function () {
      const {liquidityPool, usdc, user, user2, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause()).to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(user).borrow(
        usdc, 1, user2, "0x", 0n, 2000000000n, "0x"
      )).to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT borrow if MPC signature is wrong (caller is wrong)", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      // Signed for `user`, but called by `user2`.
      const signature = await signBorrow(mpc_signer, liquidityPool, user, usdc, amountToBorrow, user2, "0x");

      await expect(liquidityPool.connect(user2).borrow(
        usdc, amountToBorrow, user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow and swap if MPC signature is wrong (caller is wrong)", async function () {
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);
      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address"], [eurcOwner.address]);

      // `user` is signed instead of mockBorrowSwap's own address.
      const signature = await signBorrow(
        mpc_signer, liquidityPool, user, usdc, amountToBorrow, mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc, amountToBorrow, {fillToken: eurc, fillAmount, swapData}, mockTarget, callData.data,
        0n, 2000000000n, signature,
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data)).to.be.reverted;
    });

    it("Should NOT borrow and swap if the swap fails", async function () {
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address"], [eurcOwner.address]);

      const signature = await signBorrow(
        mpc_signer, liquidityPool, mockBorrowSwap, usdc, amountToBorrow, mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc, amountToBorrow, {fillToken: eurc, fillAmount, swapData}, mockTarget, callData.data,
        0n, 2000000000n, signature,
      );

      // No EURC tokens (fillToken) were made available for the swap.
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data)).to.be.reverted;
    });

    it("Should NOT borrow and swap non-asset token", async function () {
      const {liquidityPool, gho, GHO_DEC, mpc_signer, user, ghoOwner, mockTarget} = await loadFixture(deployAll);
      const amountLiquidity = 1000n * GHO_DEC;
      await gho.connect(ghoOwner).transfer(liquidityPool, amountLiquidity);

      const amountToBorrow = 2n * GHO_DEC;
      const signature = await signBorrow(mpc_signer, liquidityPool, user, gho, amountToBorrow, mockTarget, "0x");

      await expect(liquidityPool.connect(user).borrowAndSwap(
        gho, amountToBorrow, {fillToken: gho, fillAmount: 0n, swapData: "0x"}, mockTarget, "0x",
        0n, 2000000000n, signature,
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidBorrowToken");
    });

    it("Should NOT borrow many if MPC signature is wrong", async function () {
      const {liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin} = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        user, liquidityPool, user, [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x",
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow many if MPC signature nonce is reused", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x",
      );

      await liquidityPool.connect(user).borrowMany(
        [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x", 0n, 2000000000n, signature
      );
      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "NonceAlreadyUsed");
    });

    it("Should NOT borrow many if MPC signature is expired", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x",
        undefined, 0n, deadline,
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x", 0n, deadline, signature
      )).to.be.revertedWithCustomError(liquidityPool, "ExpiredSignature");
    });

    it("Should NOT borrow many if target call fails", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, additionalData);
      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc, usdc], [amountToBorrow, amountToBorrow], usdc, callData.data,
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, usdc], [amountToBorrow, amountToBorrow], usdc, callData.data, 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "TargetCallFailed");
    });

    it("Should NOT borrow many if borrowing is paused", async function () {
      const {liquidityPool, user, user2, withdrawProfit, mpc_signer, usdc, USDC_DEC} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(withdrawProfit).pauseBorrow()).to.emit(liquidityPool, "BorrowPaused");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x",
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "BorrowingIsPaused");
    });

    it("Should NOT borrow many if the contract is paused", async function () {
      const {liquidityPool, usdc, user, user2, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause()).to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, usdc], [1n, 1n], user2, "0x", 0n, 2000000000n, "0x"
      )).to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT borrow many if MPC signature is wrong (caller is wrong)", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x",
      );

      await expect(liquidityPool.connect(user2).borrowMany(
        [usdc, usdc], [amountToBorrow, amountToBorrow], user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow and swap many if MPC signature is wrong (caller is wrong)", async function () {
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);
      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address"], [eurcOwner.address]);

      // `user` is signed instead of mockBorrowSwap's own address.
      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc, usdc], [amountToBorrow, amountToBorrow], mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc, amountToBorrow, {fillToken: eurc, fillAmount, swapData}, mockTarget, callData.data,
        0n, 2000000000n, signature,
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data)).to.be.reverted;
    });

    it("Should NOT borrow and swap many if the swap fails", async function () {
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;
      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address"], [eurcOwner.address]);

      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, mockBorrowSwap, [usdc, usdc], [amountToBorrow, amountToBorrow],
        mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc, amountToBorrow, {fillToken: eurc, fillAmount, swapData}, mockTarget, callData.data,
        0n, 2000000000n, signature,
      );

      // No EURC tokens (fillToken) were made available for the swap.
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data)).to.be.reverted;
    });

    it("Should NOT borrow many if tokens and amounts have diff or zero length", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, mpc_signer, user, user2, usdcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      let signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc], [amountToBorrow, amountToBorrow], user2, "0x",
      );
      await expect(liquidityPool.connect(user).borrowMany(
        [usdc], [amountToBorrow, amountToBorrow], user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidLength");

      signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc, usdc], [amountToBorrow], user2, "0x",
      );
      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, usdc], [amountToBorrow], user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidLength");

      signature = await signBorrowMany(mpc_signer, liquidityPool, user, [], [], user2, "0x");
      await expect(liquidityPool.connect(user).borrowMany(
        [], [], user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidLength");
    });

    it("Should NOT borrow many if contains non-asset tokens", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, mpc_signer, user, user2, usdcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc, gho], [amountToBorrow, amountToBorrow], user2, "0x",
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, gho], [amountToBorrow, amountToBorrow], user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidBorrowToken");
    });

    it("Should NOT borrow and swap many if contains non-asset tokens", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, mpc_signer, user, user2, usdcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer, liquidityPool, user, [gho, usdc], [amountToBorrow, amountToBorrow], user2, "0x",
      );

      await expect(liquidityPool.connect(user).borrowAndSwapMany(
        [gho, usdc], [amountToBorrow, amountToBorrow], {fillToken: gho, fillAmount: 0n, swapData: "0x"},
        user2, "0x", 0n, 2000000000n, signature
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidBorrowToken");
    });
  });

  describe("Direct borrow and repay", function () {
    it("Should borrow directly, pulling funds out of the Morpho vault", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, directBorrower} = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const directDebtAmount = 300n * USDC_DEC;
      await liquidityPool.connect(directBorrower).borrowDirect(usdc, directDebtAmount);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, directDebtAmount);

      expect(await liquidityPool.directDebt(usdc)).to.equal(directDebtAmount);
      expect(await usdc.balanceOf(directBorrower)).to.equal(directDebtAmount);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
    });

    it("Should repay direct debt, depositing the received funds back into the vault", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, directBorrower, morphoVault,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const directDebtAmount = 300n * USDC_DEC;
      await liquidityPool.connect(directBorrower).borrowDirect(usdc, directDebtAmount);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, directDebtAmount);

      const sharesBeforeRepay = await morphoVault.balanceOf(liquidityPool);
      await usdc.connect(directBorrower).approve(liquidityPool, directDebtAmount);
      await expect(liquidityPool.connect(directBorrower).repayDirect([usdc], [directDebtAmount]))
        .to.emit(liquidityPool, "RepaidDirect").withArgs(usdc.target, directDebtAmount);

      expect(await liquidityPool.directDebt(usdc)).to.equal(0n);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await morphoVault.balanceOf(liquidityPool)).to.be.greaterThan(sharesBeforeRepay);
      expectAlmostEqual(await liquidityPool.balance(usdc), amountLiquidity);
    });

    it("Should NOT allow to borrow direct if NOT DIRECT_BORROW_ROLE", async function () {
      const {liquidityPool, usdc, user, USDC_DEC, usdcOwner, liquidityAdmin} = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      await expect(liquidityPool.connect(user).borrowDirect(usdc, 3n * USDC_DEC))
        .to.be.revertedWithCustomError(liquidityPool, "NotDirectBorrower");
    });

    it("Should NOT allow to borrow direct if paused", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, pauser, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);
      await expect(liquidityPool.connect(pauser).pause()).to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(directBorrower).borrowDirect(usdc, 3n * USDC_DEC))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should allow to borrow direct if borrow paused", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, withdrawProfit, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);
      await expect(liquidityPool.connect(withdrawProfit).pauseBorrow()).to.emit(liquidityPool, "BorrowPaused");

      const amountToBorrow = 3n * USDC_DEC;
      await expect(liquidityPool.connect(directBorrower).borrowDirect(usdc, amountToBorrow))
        .to.emit(liquidityPool, "BorrowDirect").withArgs(directBorrower, usdc, amountToBorrow);
    });

    it("Should partially reduce direct debt if repaid less than debt", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 300n * USDC_DEC;
      await liquidityPool.connect(directBorrower).borrowDirect(usdc, amountToBorrow);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, amountToBorrow);
      expect(await liquidityPool.directDebt(usdc)).to.equal(amountToBorrow);

      const remainingDebt = 100n * USDC_DEC;
      await usdc.connect(directBorrower).approve(liquidityPool, amountToBorrow);
      await expect(liquidityPool.connect(directBorrower).repayDirect([usdc], [amountToBorrow - remainingDebt]))
        .to.emit(liquidityPool, "RepaidDirect").withArgs(usdc, amountToBorrow - remainingDebt);

      expect(await liquidityPool.directDebt(usdc)).to.equal(remainingDebt);
      expect(await usdc.balanceOf(directBorrower)).to.equal(remainingDebt);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
    });

    it("Should fully reduce direct debt if repaid more than debt", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 300n * USDC_DEC;
      await liquidityPool.connect(directBorrower).borrowDirect(usdc, amountToBorrow);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, amountToBorrow);
      expect(await liquidityPool.directDebt(usdc)).to.equal(amountToBorrow);

      const extraRepayment = 100n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(directBorrower, extraRepayment);
      await usdc.connect(directBorrower).approve(liquidityPool, amountToBorrow + extraRepayment);
      await expect(liquidityPool.connect(directBorrower).repayDirect([usdc], [amountToBorrow + extraRepayment]))
        .to.emit(liquidityPool, "RepaidDirect").withArgs(usdc, amountToBorrow);

      expect(await liquidityPool.directDebt(usdc)).to.equal(0n);
      expect(await usdc.balanceOf(directBorrower)).to.equal(extraRepayment);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
    });

    it("Should NOT allow repay direct if not DIRECT_BORROW_ROLE", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 300n * USDC_DEC;
      await liquidityPool.connect(directBorrower).borrowDirect(usdc, amountToBorrow);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, amountToBorrow);

      await usdc.connect(directBorrower).approve(liquidityPool, amountToBorrow);
      await expect(liquidityPool.connect(user).repayDirect([usdc], [amountToBorrow]))
        .to.be.revertedWithCustomError(liquidityPool, "NotDirectBorrower");
    });

    it("Can't repay direct debt if token is not ASSETS", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 300n * USDC_DEC;
      await liquidityPool.connect(directBorrower).borrowDirect(usdc, amountToBorrow);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, amountToBorrow);

      await usdc.connect(directBorrower).approve(liquidityPool, amountToBorrow);
      await expect(liquidityPool.connect(directBorrower).repayDirect([gho], [amountToBorrow]))
        .to.be.revertedWithCustomError(liquidityPool, "InvalidAsset");
    });

    it("Can't repay direct debt if input is more than one token", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, gho, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 300n * USDC_DEC;
      await liquidityPool.connect(directBorrower).borrowDirect(usdc, amountToBorrow);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, amountToBorrow);

      await usdc.connect(directBorrower).approve(liquidityPool, amountToBorrow);
      await expect(liquidityPool.connect(directBorrower).repayDirect([usdc, gho], [amountToBorrow, amountToBorrow]))
        .to.be.revertedWithCustomError(liquidityPool, "InvalidAsset");
    });

    it("Can repay direct debt when there is nothing to repay", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      await liquidityPool.connect(directBorrower).repayDirect([usdc], [amountLiquidity]);
      expect(await liquidityPool.directDebt(usdc)).to.equal(0n);
    });

    it("Can't repay direct debt if input is not same length", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 300n * USDC_DEC;
      await liquidityPool.connect(directBorrower).borrowDirect(usdc, amountToBorrow);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, amountToBorrow);

      await usdc.connect(directBorrower).approve(liquidityPool, amountToBorrow);
      await expect(liquidityPool.connect(directBorrower).repayDirect([usdc], [amountToBorrow, amountToBorrow]))
        .to.be.revertedWithCustomError(liquidityPool, "InvalidLength");
    });
  });

  describe("borrowWithRole", function () {
    it("Should allow DIRECT_BORROW_ROLE to borrow with role", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      await expect(liquidityPool.connect(directBorrower).borrowWithRole(usdc, amountToBorrow))
        .to.emit(liquidityPool, "BorrowWithRole").withArgs(directBorrower, usdc, amountToBorrow);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, amountToBorrow);

      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await liquidityPool.totalDeposited()).to.equal(amountLiquidity);
      expect(await usdc.balanceOf(directBorrower)).to.equal(amountToBorrow);
      expectAlmostEqual(await liquidityPool.balance(usdc), amountLiquidity - amountToBorrow);
      expect(await liquidityPool.directDebt(usdc)).to.equal(0n);
    });

    it("Should NOT allow to borrow with role if NOT DIRECT_BORROW_ROLE", async function () {
      const {liquidityPool, usdc, user, USDC_DEC, usdcOwner, liquidityAdmin} = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      await expect(liquidityPool.connect(user).borrowWithRole(usdc, 3n * USDC_DEC))
        .to.be.revertedWithCustomError(liquidityPool, "NotDirectBorrower");
    });

    it("Should NOT allow to borrow with role if paused", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, pauser, usdcOwner, liquidityAdmin, directBorrower,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);
      await expect(liquidityPool.connect(pauser).pause()).to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(directBorrower).borrowWithRole(usdc, 3n * USDC_DEC))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });
  });

  describe("Signature checking", function () {
    const MAGICVALUE = "0x1626ba7e";

    it("Should return MAGICVALUE if a contract signature is validated", async function () {
      const {liquidityPool} = await loadFixture(deployAll);
      const data = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      expect(await liquidityPool.isValidSignature(data, data)).to.equal(MAGICVALUE);
    });

    it("Should NOT return MAGICVALUE if a contract signature is invalid", async function () {
      const {liquidityPool, admin, mockSignerTrue, mockSignerFalse} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).setSignerAddress(mockSignerFalse))
        .to.emit(liquidityPool, "SignerAddressSet").withArgs(mockSignerTrue, mockSignerFalse);
      const data = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      expect(await liquidityPool.isValidSignature(data, data)).to.not.equal(MAGICVALUE);
    });

    it("Should return MAGICVALUE if an EOA signature is validated", async function () {
      const {liquidityPool, admin, mockSignerTrue, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).setSignerAddress(user))
        .to.emit(liquidityPool, "SignerAddressSet").withArgs(mockSignerTrue, user);
      const data = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const message = hashMessage(data);
      const signature = await user.signMessage(data);
      expect(await liquidityPool.isValidSignature(message, signature)).to.equal(MAGICVALUE);
    });

    it("Should NOT return MAGICVALUE if an EOA signature is invalid", async function () {
      const {liquidityPool, admin, mockSignerTrue, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).setSignerAddress(user))
        .to.emit(liquidityPool, "SignerAddressSet").withArgs(mockSignerTrue, user);
      const data = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const wrongData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeff";
      const wrongMessage = hashMessage(wrongData);
      const signature = await user.signMessage(data);
      expect(await liquidityPool.isValidSignature(wrongMessage, signature)).to.not.equal(MAGICVALUE);
    });
  });

  describe("Roles and admin functions", function () {
    it("Should allow admin to set MPC address", async function () {
      const {liquidityPool, admin, user} = await loadFixture(deployAll);
      const oldMPCAddress = await liquidityPool.mpcAddress();
      await expect(liquidityPool.connect(admin).setMPCAddress(user))
        .to.emit(liquidityPool, "MPCAddressSet").withArgs(oldMPCAddress, user.address);
      expect(await liquidityPool.mpcAddress()).to.equal(user.address);
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

    it("Should allow admin to set signer address", async function () {
      const {liquidityPool, admin, user} = await loadFixture(deployAll);
      const oldSignerAddress = await liquidityPool.signerAddress();
      await expect(liquidityPool.connect(admin).setSignerAddress(user))
        .to.emit(liquidityPool, "SignerAddressSet").withArgs(oldSignerAddress, user.address);
      expect(await liquidityPool.signerAddress()).to.equal(user.address);
    });

    it("Should NOT allow others to set signer address", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).setSignerAddress(user))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow WITHDRAW_PROFIT_ROLE to pause and unpause borrowing", async function () {
      const {liquidityPool, withdrawProfit} = await loadFixture(deployAll);
      expect(await liquidityPool.borrowPaused()).to.equal(false);
      await expect(liquidityPool.connect(withdrawProfit).pauseBorrow()).to.emit(liquidityPool, "BorrowPaused");
      expect(await liquidityPool.borrowPaused()).to.equal(true);
      await expect(liquidityPool.connect(withdrawProfit).unpauseBorrow()).to.emit(liquidityPool, "BorrowUnpaused");
      expect(await liquidityPool.borrowPaused()).to.equal(false);
    });

    it("Should NOT allow others to pause and unpause borrowing", async function () {
      const {liquidityPool, admin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).pauseBorrow())
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow WITHDRAW_PROFIT_ROLE to withdraw profit", async function () {
      const {liquidityPool, gho, GHO_DEC, ghoOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 1n * GHO_DEC;
      await gho.connect(ghoOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([gho], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(gho.target, user.address, amount);
      expect(await gho.balanceOf(user)).to.equal(amount);
    });

    it("Should NOT allow others to withdraw profit", async function () {
      const {liquidityPool, gho, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).withdrawProfit([gho], user))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to deposit liquidity", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPool.totalDeposited()).to.equal(amount);
    });

    it("Should NOT allow others to deposit liquidity", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, user} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(user).deposit(amount))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to withdraw liquidity", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amount);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount))
        .to.emit(liquidityPool, "Withdraw").withArgs(liquidityAdmin, user.address, amount);

      expect(await usdc.balanceOf(user)).to.equal(amount);
      expect(await liquidityPool.totalDeposited()).to.equal(0n);
      expectAlmostEqual(await liquidityPool.balance(usdc), 0n);
    });

    it("Should NOT allow others to withdraw liquidity", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amount);

      await expect(liquidityPool.connect(user).withdraw(user, amount * 2n))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow PAUSER_ROLE to pause and unpause the contract", async function () {
      const {liquidityPool, pauser} = await loadFixture(deployAll);
      expect(await liquidityPool.paused()).to.equal(false);
      await expect(liquidityPool.connect(pauser).pause()).to.emit(liquidityPool, "Paused");
      expect(await liquidityPool.paused()).to.equal(true);
      await expect(liquidityPool.connect(pauser).unpause()).to.emit(liquidityPool, "Unpaused");
      expect(await liquidityPool.paused()).to.equal(false);
    });

    it("Should NOT allow others to pause and unpause the contract", async function () {
      const {liquidityPool, admin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).pause())
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Repay", function () {
    it("Should repay by depositing the received funds back into the vault", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, morphoVault, user,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      // Simulates funds coming back from a borrower: sent in as a plain transfer, then swept into
      // the vault by repay().
      const repayAmount = 200n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, repayAmount);

      const sharesBefore = await morphoVault.balanceOf(liquidityPool);
      await expect(liquidityPool.connect(user).repay([usdc]))
        .to.emit(liquidityPool, "Repaid").withArgs(usdc.target, repayAmount);

      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await morphoVault.balanceOf(liquidityPool)).to.be.greaterThan(sharesBefore);
    });

    it("Should revert repay if nothing was sent", async function () {
      const {liquidityPool, usdc, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).repay([usdc]))
        .to.be.revertedWithCustomError(liquidityPool, "NothingToRepay");
    });

    it("Should revert repay with more than one token", async function () {
      const {liquidityPool, usdc, user} = await loadFixture(deployAll);
      const weth = networkConfig.BASE.WrappedNativeToken;
      await expect(liquidityPool.connect(user).repay([usdc, weth]))
        .to.be.revertedWithCustomError(liquidityPool, "InvalidAsset");
    });

    it("Should revert repay with a token other than ASSETS", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      const weth = networkConfig.BASE.WrappedNativeToken;
      await expect(liquidityPool.connect(user).repay([weth]))
        .to.be.revertedWithCustomError(liquidityPool, "InvalidAsset");
    });
  });

  describe("Admin withdraw", function () {
    it("Should withdraw liquidity directly from the vault", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await liquidityPool.connect(liquidityAdmin).deposit(amount);

      const tx = liquidityPool.connect(liquidityAdmin).withdraw(user, amount);
      await expect(tx).to.emit(liquidityPool, "Withdraw").withArgs(liquidityAdmin, user.address, amount);
      await expect(tx).to.emit(liquidityPool, "WithdrawnFromMorphoVault").withArgs(user.address, amount);

      expect(await usdc.balanceOf(user)).to.equal(amount);
      expect(await liquidityPool.totalDeposited()).to.equal(0n);
      expectAlmostEqual(await liquidityPool.balance(usdc), 0n);
    });

    it("Should NOT withdraw liquidity if not enough on contract", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await liquidityPool.connect(liquidityAdmin).deposit(amount);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount * 2n))
        .to.be.revertedWithCustomError(liquidityPool, "InsufficientLiquidity");
    });

    it("Should NOT withdraw profit as liquidity", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await liquidityPool.connect(liquidityAdmin).deposit(amount - 1n);
      expect(await liquidityPool.totalDeposited()).to.equal(amount - 1n);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount))
        .to.be.revertedWithCustomError(liquidityPool, "InsufficientLiquidity");
    });

    it("Should NOT withdraw liquidity if the contract is paused", async function () {
      const {liquidityPool, user, liquidityAdmin, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause()).to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, 10))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT withdraw liquidity to zero address", async function () {
      const {liquidityPool, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(liquidityAdmin).withdraw(ZERO_ADDRESS, 10))
        .to.be.revertedWithCustomError(liquidityPool, "ZeroAddress()");
    });
  });

  describe("withdrawProfit", function () {
    // For "no surplus at all" checks that follow a borrow (rather than immediately following the
    // deposit they're measured against), the deposit->borrow gap is itself two separate mined
    // blocks, so a tiny bit of real vault yield can already have accrued by the time of the borrow
    // that withdraws the full deposited amount, leaving a few wei of residual surplus behind. This
    // asserts the deterministic invariant (a real NoProfit revert) whenever the residual truly is
    // zero, and otherwise bounds it as negligible incidental yield rather than requiring an exact
    // revert that isn't reproducible in that case.
    async function expectNoMeaningfulProfit(
      liquidityPool: LiquidityPoolMorphoV2, usdc: ERC20, withdrawProfit: any, user: any,
    ) {
      const balanceBefore = await usdc.balanceOf(user);
      try {
        await liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user);
      } catch (error) {
        expect((error as Error).message).to.include("NoProfit");
        return;
      }
      expect((await usdc.balanceOf(user)) - balanceBefore).to.be.lessThan(1000n);
    }

    // Signs and executes a signed borrow with an embedded profit component.
    async function borrowWithProfit(
      fixture: Awaited<ReturnType<typeof deployAll>>,
      borrowAmount: bigint,
      profit: bigint,
      nonce: bigint = 0n,
    ) {
      const {liquidityPool, usdc, user, mpc_signer, mockTarget} = fixture;
      const packed = packAmount(profit, borrowAmount);
      const callData = await mockTarget.fulfill.populateTransaction(usdc, borrowAmount, "0x");
      const sig = await signBorrow(
        mpc_signer, liquidityPool, user, usdc, packed, mockTarget, callData.data, undefined, nonce,
      );
      await liquidityPool.connect(user).borrow(usdc, packed, mockTarget, callData.data, nonce, 2000000000n, sig);
    }

    it("Should NOT withdraw profit if the contract is paused", async function () {
      const {liquidityPool, user, usdc, withdrawProfit, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause()).to.emit(liquidityPool, "Paused");
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT withdraw profit to zero address", async function () {
      const {liquidityPool, usdc, withdrawProfit} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, "ZeroAddress()");
    });

    it("1: no injected profit, no donation, checked within the same block as the deposit " +
    "-> exact NoProfit revert", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user} =
        await loadFixture(deployAll);
      const deposit = 1000n * USDC_DEC;

      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit, {gasLimit: 200000});
      await liquidityPool.connect(liquidityAdmin).deposit(deposit, {gasLimit: 500000});
      await expect(
        liquidityPool.connect(withdrawProfit).withdrawProfit.staticCall([usdc], user, {blockTag: "latest"})
      ).to.be.revertedWithCustomError(liquidityPool, "NoProfit");

      expect(await liquidityPool.totalDeposited()).to.equal(deposit);
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(0n);
    });

    it("2: donated raw surplus -> withdraws surplus, second call has nothing meaningful left", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user} =
        await loadFixture(deployAll);
      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const donated = 50n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, donated);

      expect(await liquidityPool.accruedProfit(usdc)).to.equal(0n);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      // The withdrawn amount can be a few wei above the exact donation due to incidental real
      // vault yield accrued since deposit (see the module-level comment on expectAlmostEqual).
      expectAlmostEqual(await usdc.balanceOf(user), donated);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(0n);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit.staticCall([usdc], user, {blockTag: "latest"}))
        .to.be.revertedWithCustomError(liquidityPool, "NoProfit");
    });

    it("3: accruedProfit > 0, repaid via raw transfer -> withdraws all profit", async function () {
      const fixture = await loadFixture(deployAll);
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user} = fixture;
      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const borrowAmount = 100n * USDC_DEC;
      const profit = 5n * USDC_DEC;
      await borrowWithProfit(fixture, borrowAmount, profit);
      await usdc.connect(usdcOwner).transfer(liquidityPool, borrowAmount + profit);

      expect(await liquidityPool.accruedProfit(usdc)).to.equal(profit);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expectAlmostEqual(await usdc.balanceOf(user), profit);
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(0n);

      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit.staticCall([usdc], user, {blockTag: "latest"}))
        .to.be.revertedWithCustomError(liquidityPool, "NoProfit");
    });

    it("4: surplus > profit -> surplus amount withdrawn, accruedProfit cleared", async function () {
      const fixture = await loadFixture(deployAll);
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user} = fixture;
      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const borrowAmount = 100n * USDC_DEC;
      const profit = 5n * USDC_DEC;
      await borrowWithProfit(fixture, borrowAmount, profit);
      const repayment = borrowAmount + profit + 15n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, repayment);

      const expectedWithdraw = 20n * USDC_DEC;
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(profit);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expectAlmostEqual(await usdc.balanceOf(user), expectedWithdraw);
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(0n);
    });

    it("5: profit > surplus -> profit amount withdrawn, accruedProfit cleared", async function () {
      const fixture = await loadFixture(deployAll);
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user} = fixture;
      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const borrowAmount = 100n * USDC_DEC;
      const profit = 15n * USDC_DEC;
      await borrowWithProfit(fixture, borrowAmount, profit);
      await usdc.connect(usdcOwner).transfer(liquidityPool, borrowAmount + 8n * USDC_DEC);

      expect(await liquidityPool.accruedProfit(usdc)).to.equal(profit);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expect(await usdc.balanceOf(user)).to.equal(profit);
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(0n);
    });

    it("6: surplus held entirely as a vault position (via repay, not raw balance) -> pulled from the vault",
    async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user} =
        await loadFixture(deployAll);
      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      // repay() (unlike a bare donation) sweeps the surplus into vault shares, exercising the
      // _withdrawLogic() pull-from-vault path inside _withdrawProfitLogic rather than raw balance.
      const donated = 50n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, donated);
      await liquidityPool.connect(user).repay([usdc]);
      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);

      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expectAlmostEqual(await usdc.balanceOf(user), donated);
      expect(await liquidityPool.balance(usdc, {blockTag: "latest"})).to.equal(deposit);
    });

    it("7: non-ASSETS token donated -> full balance withdrawn as profit, second call reverts",
    async function () {
      const {liquidityPool, gho, ghoOwner, GHO_DEC, withdrawProfit, user} = await loadFixture(deployAll);

      // A foreign token never touches the Morpho vault, so unlike ASSETS this needs none of the
      // same-block tricks above: it's not subject to any real yield accrual.
      const donated = 7n * GHO_DEC;
      await gho.connect(ghoOwner).transfer(liquidityPool, donated);
      // non-ASSETS: _withdrawProfitLogic delegates to the base implementation, where
      // withdrawableSurplus is always the full current balance, regardless of accruedProfit.

      expect(await liquidityPool.accruedProfit(gho)).to.equal(0n);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([gho], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(gho.target, user.address, donated);
      expect(await gho.balanceOf(user)).to.equal(donated);
      expect(await gho.balanceOf(liquidityPool)).to.equal(0n);
      expect(await liquidityPool.accruedProfit(gho)).to.equal(0n);

      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([gho], user))
        .to.be.revertedWithCustomError(liquidityPool, "NoProfit");
    });

    it("8: totalAssets < profit -> partial withdrawal, remaining profit reduced", async function () {
      const fixture = await loadFixture(deployAll);
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user} = fixture;
      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const borrowAmount = 998n * USDC_DEC;
      const profit = 10n * USDC_DEC;
      await borrowWithProfit(fixture, borrowAmount, profit);
      // Partial repay: only 5 returned (raw transfer, not swept into the vault by repay()).
      // totalAssets (vault position ~2 + raw balance 5) = 7 < profit (10).
      const partialRepay = 5n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, partialRepay);

      const availableAssets = 7n * USDC_DEC;
      const remainingProfit = 3n * USDC_DEC;
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(profit);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expectAlmostEqual(await usdc.balanceOf(user), availableAssets);
      expectAlmostEqual(await liquidityPool.accruedProfit(usdc), remainingProfit);

      // What's left (a few wei of incidental real yield) is now below the remaining accruedProfit,
      // so a further withdrawal genuinely succeeds again rather than reverting with NoProfit; this
      // mirrors the base pool exactly except that base's "balance now 0" becomes "totalAssets now
      // ~0" here, since Morpho's vault always holds a tiny nonzero position between transactions.
    });

    it("9: totalAssets ~ 0 (all borrowed, nothing repaid) -> no meaningful profit withdrawable",
    async function () {
      const fixture = await loadFixture(deployAll);
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user} = fixture;
      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const profit = 5n * USDC_DEC;
      await borrowWithProfit(fixture, deposit, profit);
      // Everything was withdrawn from the vault and sent out; nothing was repaid.

      expect(await usdc.balanceOf(liquidityPool)).to.equal(0n);
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(profit);
      await expectNoMeaningfulProfit(liquidityPool, usdc, withdrawProfit, user);
    });

    it("10: borrowDirect with profit -> directDebt creates virtual surplus, profit withdrawn before repayment",
    async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user, directBorrower,
      } = await loadFixture(deployAll);
      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const borrowAmount = 100n * USDC_DEC;
      const profit = 5n * USDC_DEC;
      const packed = packAmount(profit, borrowAmount);
      await liquidityPool.connect(directBorrower).borrowDirect(usdc, packed);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, borrowAmount);
      // totalAssets~900, directDebt=105 (amount+profit), accruedProfit=5
      // virtualBalance~900+105=1005>1000, surplus=min(5,900)=5, toWithdraw=min(900,5)=5, max(5,5)=5

      expect(await liquidityPool.directDebt(usdc)).to.equal(borrowAmount + profit);
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(profit);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expectAlmostEqual(await usdc.balanceOf(user), profit);
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(0n);
    });

    it("11: borrowDirect with no profit -> directDebt equals principal only, no meaningful surplus",
    async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user, directBorrower,
      } = await loadFixture(deployAll);
      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const borrowAmount = 100n * USDC_DEC;
      await liquidityPool.connect(directBorrower).borrowDirect(usdc, borrowAmount);
      await usdc.connect(directBorrower).transferFrom(liquidityPool, directBorrower, borrowAmount);
      // totalAssets~900, directDebt=100, virtualBalance~1000=deposited, surplus~0, accruedProfit=0

      expect(await liquidityPool.directDebt(usdc)).to.equal(borrowAmount);
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(0n);
      await expectNoMeaningfulProfit(liquidityPool, usdc, withdrawProfit, user);
    });

    it("12: multiple borrows accumulate accruedProfit -> full aggregate withdrawn", async function () {
      const fixture = await loadFixture(deployAll);
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, withdrawProfit, user} = fixture;
      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const borrow1 = 100n * USDC_DEC;
      const profit1 = 5n * USDC_DEC;
      await borrowWithProfit(fixture, borrow1, profit1);
      await usdc.connect(usdcOwner).transfer(liquidityPool, borrow1 + profit1);

      const borrow2 = 50n * USDC_DEC;
      const profit2 = 3n * USDC_DEC;
      await borrowWithProfit(fixture, borrow2, profit2, 1n);
      await usdc.connect(usdcOwner).transfer(liquidityPool, borrow2 + profit2);

      const totalProfit = profit1 + profit2;
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(totalProfit);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn");
      expectAlmostEqual(await usdc.balanceOf(user), totalProfit);
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(0n);
    });
  });

  describe("Profit accumulation - borrowMany, borrowAndSwap, borrowAndSwapMany", function () {
    it("borrowMany: profits from each packed amount accumulate in accruedProfit", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, liquidityAdmin, user, mpc_signer, mockTarget,
      } = await loadFixture(deployAll);

      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const profit1 = 2n * USDC_DEC;
      const profit2 = 3n * USDC_DEC;
      const borrow1 = 5n * USDC_DEC;
      const borrow2 = 4n * USDC_DEC;
      const packed1 = packAmount(profit1, borrow1);
      const packed2 = packAmount(profit2, borrow2);

      // Both entries borrow ASSETS (only supported token). The second approval overwrites the
      // first, so mockTarget pulls borrow2 via transferFrom.
      const callData = await mockTarget.fulfill.populateTransaction(usdc, borrow2, "0x");
      const sig = await signBorrowMany(
        mpc_signer, liquidityPool, user, [usdc, usdc], [packed1, packed2], mockTarget, callData.data,
      );
      await liquidityPool.connect(user).borrowMany(
        [usdc, usdc], [packed1, packed2], mockTarget, callData.data, 0n, 2000000000n, sig,
      );

      // Each packed amount contributes its profit independently.
      expect(await liquidityPool.accruedProfit(usdc)).to.equal(profit1 + profit2);
    });

    it("borrowAndSwap: profit in packed amount credited to accruedProfit for the borrowed token", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, liquidityAdmin,
        eurc, eurcOwner, EURC_DEC, mockTarget, mockBorrowSwap, mpc_signer, user,
      } = await loadFixture(deployAll);

      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const profit = 5n * USDC_DEC;
      const borrowAmount = 3n * USDC_DEC;
      const packed = packAmount(profit, borrowAmount);

      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address"], [eurcOwner.address]);
      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, "0x");

      // Caller is mockBorrowSwap; MPC signs the full packed amount.
      const sig = await signBorrow(mpc_signer, liquidityPool, mockBorrowSwap, usdc, packed, mockTarget, callData.data);
      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc, packed, {fillToken: eurc, fillAmount, swapData}, mockTarget, callData.data, 0n, 2000000000n, sig,
      );
      await mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data);

      expect(await liquidityPool.accruedProfit(usdc)).to.equal(profit);
    });

    it("borrowAndSwapMany: profits across packed amounts accumulate in accruedProfit", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, liquidityAdmin,
        eurc, eurcOwner, EURC_DEC, mockTarget, mockBorrowSwap, mpc_signer, user,
      } = await loadFixture(deployAll);

      const deposit = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const profit1 = 2n * USDC_DEC;
      const profit2 = 3n * USDC_DEC;
      // borrow1 must be 0 because swapMany pulls each amount via safeTransferFrom; with two USDC
      // entries the second forceApprove overwrites the first, so the first pull would fail if
      // borrow1 > 0. A zero borrow amount is a valid no-op transfer and still accumulates profit1,
      // mirroring the borrowMany pattern where approval overwrites.
      const borrow1 = 0n;
      const borrow2 = 4n * USDC_DEC;
      const packed1 = packAmount(profit1, borrow1);
      const packed2 = packAmount(profit2, borrow2);

      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);
      const swapData = AbiCoder.defaultAbiCoder().encode(["address"], [eurcOwner.address]);
      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, "0x");

      const sig = await signBorrowMany(
        mpc_signer, liquidityPool, mockBorrowSwap, [usdc, usdc], [packed1, packed2], mockTarget, callData.data,
      );
      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [usdc, usdc], [packed1, packed2], {fillToken: eurc, fillAmount, swapData},
        mockTarget, callData.data, 0n, 2000000000n, sig,
      );
      await mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data);

      expect(await liquidityPool.accruedProfit(usdc)).to.equal(profit1 + profit2);
    });
  });

  describe("forceDeallocate", function () {
    it("Should revert if caller doesn't have FORCE_DEALLOCATE_ROLE", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).forceDeallocate(ZERO_ADDRESS, "0x", 0n))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should force-deallocate liquidity from the vault's adapter back to its idle pool", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, liquidityAdmin, forceDeallocator, morphoVault,
      } = await loadFixture(deployAll);

      // Deposit so the pool holds a real position in the vault's (single, real) adapter.
      const deposit = 10000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, deposit);
      await liquidityPool.connect(liquidityAdmin).deposit(deposit);

      const adapter = await morphoVault.liquidityAdapter();
      const data = await morphoVault.liquidityData();

      const idleBefore = await usdc.balanceOf(morphoVault);
      const sharesBefore = await morphoVault.balanceOf(liquidityPool);

      const assets = 1000n * USDC_DEC;
      const penaltyShares = await liquidityPool.connect(forceDeallocator).forceDeallocate.staticCall(
        adapter, data, assets,
      );
      await expect(liquidityPool.connect(forceDeallocator).forceDeallocate(adapter, data, assets))
        .to.emit(liquidityPool, "ForceDeallocated").withArgs(adapter, assets, anyValue);

      expect(await usdc.balanceOf(morphoVault)).to.equal(idleBefore + assets);
      expectAlmostEqual(await morphoVault.balanceOf(liquidityPool), sharesBefore - penaltyShares, 1_000_000_000n);
      expectAlmostEqual(await liquidityPool.balance(usdc), deposit, 100_000n);
    });
  });
});
