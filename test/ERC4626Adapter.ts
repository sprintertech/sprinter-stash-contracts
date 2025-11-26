import {
  loadFixture, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, signBorrow,
} from "./helpers";
import {ETH, ZERO_ADDRESS, DEFAULT_ADMIN_ROLE} from "../scripts/common";
import {encodeBytes32String, AbiCoder, concat} from "ethers";
import {
  MockTarget, MockBorrowSwap, PublicLiquidityPool, MockSignerTrue, MockSignerFalse,
  ERC4626Adapter
} from "../typechain-types";
import {networkConfig} from "../network.config";

function addAmountToReceive(callData: string, amountToReceive: bigint) {
  return concat([
    callData,
    AbiCoder.defaultAbiCoder().encode(
      ["uint256"],
      [amountToReceive]
    )
  ]);
}

const ERC4626Deposit = "deposit(uint256,address)";

describe("ERC4626Adapter", function () {
  const deployAll = async () => {
    const [
      deployer, admin, user, user2, mpc_signer, liquidityAdmin, withdrawProfit, pauser, lp,
    ] = await hre.ethers.getSigners();
    await setCode(user2.address, "0x00");

    const USDC_ADDRESS = networkConfig.BASE.USDC;
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    if (!USDC_OWNER_ADDRESS) throw new Error("Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const usdc = await hre.ethers.getContractAt("ERC20", USDC_ADDRESS);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const EURC_ADDRESS = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";
    const EURC_OWNER_ADDRESS = process.env.EURC_OWNER_ADDRESS!;
    if (!EURC_OWNER_ADDRESS) throw new Error("Env variables not configured (EURC_OWNER_ADDRESS missing)");
    const eurc = await hre.ethers.getContractAt("ERC20", EURC_ADDRESS);
    const eurcOwner = await hre.ethers.getImpersonatedSigner(EURC_OWNER_ADDRESS);
    await setBalance(EURC_OWNER_ADDRESS, 10n ** 18n);

    const USDC_DEC = 10n ** (await usdc.decimals());
    const EURC_DEC = 10n ** (await eurc.decimals());

    await usdc.connect(usdcOwner).transfer(lp, 1000000n * USDC_DEC);

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
      await deploy("PublicLiquidityPool", deployer, {},
        usdc, deployer, mpc_signer, networkConfig.BASE.WrappedNativeToken, mockSignerTrue,
        "Public Liquidity Pool", "PLP", 0
      )
    ) as PublicLiquidityPool;

    const adapter = (
      await deploy("ERC4626Adapter", deployer, {},
        usdc, liquidityPool, admin
      )
    ) as ERC4626Adapter;

    const LIQUIDITY_ADMIN_ROLE = encodeBytes32String("LIQUIDITY_ADMIN_ROLE");
    await adapter.connect(admin).grantRole(LIQUIDITY_ADMIN_ROLE, liquidityAdmin);

    const WITHDRAW_PROFIT_ROLE = encodeBytes32String("WITHDRAW_PROFIT_ROLE");
    await adapter.connect(admin).grantRole(WITHDRAW_PROFIT_ROLE, withdrawProfit);

    const PAUSER_ROLE = encodeBytes32String("PAUSER_ROLE");
    await adapter.connect(admin).grantRole(PAUSER_ROLE, pauser);

    const generateProfit = async (amount: bigint, nonce: bigint = 0n) => {
      const amountToBorrow = amount;
      const amountToReceive = 0n;

      const callData = await mockTarget.fulfillSkip.populateTransaction();
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        undefined,
        nonce
      );

      await liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        nonce,
        2000000000n,
        signature);

      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
    };

    return {deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, eurc, eurcOwner,
      liquidityPool, mockTarget, mockBorrowSwap, USDC_DEC, EURC_DEC, generateProfit,
      liquidityAdmin, withdrawProfit, pauser, mockSignerTrue, mockSignerFalse, lp, adapter};
  };

  describe("Initialization", function () {
    it("Should initialize the contract with correct values", async function () {
      const {adapter, liquidityPool, usdc, admin} = await loadFixture(deployAll);
      expect(await adapter.ASSETS())
        .to.be.eq(usdc.target);
      expect(await adapter.TARGET_VAULT())
        .to.be.eq(liquidityPool.target);
      expect(await adapter.totalDeposited())
        .to.be.eq(0);
      expect(await adapter.paused())
        .to.be.false;
      expect(await adapter.hasRole(DEFAULT_ADMIN_ROLE, admin))
        .to.be.true;
    });

    it("Should NOT deploy the contract if liquidity token address is 0", async function () {
      const {deployer, adapter, admin, liquidityPool} = await loadFixture(deployAll);
      await expect(deploy("ERC4626Adapter", deployer, {},
        ZERO_ADDRESS, liquidityPool, admin
      )).to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("Should NOT deploy the contract if admin address is 0", async function () {
      const {deployer, adapter, usdc, liquidityPool} = await loadFixture(deployAll);
      await expect(deploy("ERC4626Adapter", deployer, {},
        usdc, liquidityPool, ZERO_ADDRESS
      )).to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("Should NOT deploy the contract if target vault address is 0", async function () {
      const {deployer, adapter, usdc, admin} = await loadFixture(deployAll);
      await expect(deploy("ERC4626Adapter", deployer, {},
        usdc, ZERO_ADDRESS, admin
      )).to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("Should NOT deploy the contract if assets doesn't match that of a target vault", async function () {
      const {deployer, adapter, eurc, admin, liquidityPool} = await loadFixture(deployAll);
      await expect(deploy("ERC4626Adapter", deployer, {},
        eurc, liquidityPool, admin
      )).to.be.revertedWithCustomError(adapter, "IncompatibleAssets");
    });
  });

  describe("Deposit, withdraw", function () {
    it("Should deposit", async function () {
      const {adapter, liquidityPool, usdc, USDC_DEC, lp, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).transfer(adapter, amount);
      await expect(adapter.connect(liquidityAdmin).deposit(amount))
        .to.emit(adapter, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);
      expect(await usdc.balanceOf(adapter)).to.eq(0);
      expect(await usdc.allowance(adapter, liquidityPool)).to.eq(0);
    });

    it("Should NOT deposit if paused", async function () {
      const {adapter, usdc, USDC_DEC, lp, liquidityAdmin, pauser} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).transfer(adapter, amount);
      await expect(adapter.connect(pauser).pause())
        .to.emit(adapter, "Paused").withArgs(pauser);
      await expect(adapter.connect(liquidityAdmin).deposit(amount))
        .to.be.revertedWithCustomError(adapter, "EnforcedPause");
    });

    it("Should deposit with pull", async function () {
      const {adapter, liquidityPool, usdc, USDC_DEC, lp} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await expect(adapter.connect(lp).depositWithPull(amount))
        .to.emit(adapter, "Deposit").withArgs(lp, amount);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);
      expect(await usdc.balanceOf(adapter)).to.eq(0);
      expect(await usdc.allowance(adapter, liquidityPool)).to.eq(0);
    });

    it("Should deposit with pull multiple times", async function () {
      const {adapter, liquidityPool, usdc, USDC_DEC, lp} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      const amount2 = 2000n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await expect(adapter.connect(lp).depositWithPull(amount))
        .to.emit(adapter, "Deposit").withArgs(lp, amount);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);
      await usdc.connect(lp).approve(adapter, amount2);
      await expect(adapter.connect(lp).depositWithPull(amount2))
        .to.emit(adapter, "Deposit").withArgs(lp, amount2);
      expect(await adapter.totalDeposited()).to.eq(amount + amount2);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount + amount2);
      expect(await usdc.balanceOf(adapter)).to.eq(0);
    });

    it("Should deposit with pull if paused", async function () {
      const {adapter, usdc, USDC_DEC, lp, pauser} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await expect(adapter.connect(pauser).pause())
        .to.emit(adapter, "Paused").withArgs(pauser);
      await expect(adapter.connect(lp).depositWithPull(amount))
        .to.be.revertedWithCustomError(adapter, "EnforcedPause");
    });

    it("Should withdraw", async function () {
      const {adapter, liquidityPool, usdc, USDC_DEC, lp, user, user2, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await adapter.connect(lp).depositWithPull(amount);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);
      const withdraw1 = 300n * USDC_DEC;
      const withdraw2 = 700n * USDC_DEC;
      await expect(adapter.connect(liquidityAdmin).withdraw(user, withdraw1))
        .to.emit(adapter, "Withdraw").withArgs(liquidityAdmin, user, withdraw1);
      expect(await usdc.balanceOf(user)).to.eq(withdraw1);
      expect(await usdc.balanceOf(adapter)).to.eq(0);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount - withdraw1);
      expect(await adapter.totalDeposited()).to.eq(amount - withdraw1);
      expect(await usdc.allowance(adapter, liquidityPool)).to.eq(0);
      await expect(adapter.connect(liquidityAdmin).withdraw(user2, withdraw2))
        .to.emit(adapter, "Withdraw").withArgs(liquidityAdmin, user2, withdraw2);
      expect(await usdc.balanceOf(user)).to.eq(withdraw1);
      expect(await usdc.balanceOf(user2)).to.eq(withdraw2);
      expect(await usdc.balanceOf(adapter)).to.eq(0);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(0);
      expect(await adapter.totalDeposited()).to.eq(0);
    });

    it("Should NOT withdraw more than the total deposited", async function () {
      const {
        adapter, liquidityPool, usdc, USDC_DEC, lp, user, liquidityAdmin, generateProfit
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await adapter.connect(lp).depositWithPull(amount);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);

      const profit = 100n * USDC_DEC;
      await generateProfit(profit);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);
      expect(await liquidityPool.totalAssets()).to.eq(amount + profit);

      await expect(adapter.connect(liquidityAdmin).withdraw(user, amount + 1n))
        .to.be.revertedWithCustomError(adapter, "InsufficientLiquidity");
      await adapter.connect(liquidityAdmin).withdraw(user, 300n * USDC_DEC);

      await expect(adapter.connect(liquidityAdmin).withdraw(user, amount - 300n * USDC_DEC + 1n))
        .to.be.revertedWithCustomError(adapter, "InsufficientLiquidity");
    });

    it("Should NOT withdraw to zero address", async function () {
      const {
        adapter, usdc, USDC_DEC, lp, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await adapter.connect(lp).depositWithPull(amount);

      await expect(adapter.connect(liquidityAdmin).withdraw(ZERO_ADDRESS, amount))
        .to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("Should withdraw donations for multiple tokens", async function () {
      const {
        adapter, eurc, usdc, EURC_DEC, USDC_DEC, eurcOwner, usdcOwner, withdrawProfit, user, lp
      } = await loadFixture(deployAll);
      const amountEurc = 1n * EURC_DEC;
      const amountUsdc = 2n * USDC_DEC;
      await eurc.connect(eurcOwner).transfer(adapter, amountEurc);
      await usdc.connect(usdcOwner).transfer(adapter, amountUsdc);
      const tx = adapter.connect(withdrawProfit).withdrawProfit([eurc, usdc], user);
      await expect(tx).to.emit(adapter, "ProfitWithdrawn").withArgs(eurc, user, amountEurc);
      await expect(tx).to.emit(adapter, "ProfitWithdrawn").withArgs(usdc, user, amountUsdc);
      expect(await eurc.balanceOf(user)).to.eq(amountEurc);
      expect(await usdc.balanceOf(user)).to.eq(amountUsdc);

      await usdc.connect(lp).approve(adapter, 1000n * USDC_DEC);
      await adapter.connect(lp).depositWithPull(1000n * USDC_DEC);

      await eurc.connect(eurcOwner).transfer(adapter, amountEurc);
      await usdc.connect(usdcOwner).transfer(adapter, amountUsdc);
      const tx2 = adapter.connect(withdrawProfit).withdrawProfit([eurc, usdc], user);
      await expect(tx2).to.emit(adapter, "ProfitWithdrawn").withArgs(eurc, user, amountEurc);
      await expect(tx2).to.emit(adapter, "ProfitWithdrawn").withArgs(usdc, user, amountUsdc);
      expect(await eurc.balanceOf(user)).to.eq(amountEurc * 2n);
      expect(await usdc.balanceOf(user)).to.eq(amountUsdc * 2n);
    });

    it("Should NOT withdraw if paused", async function () {
      const {
        adapter, usdc, USDC_DEC, lp, liquidityAdmin, pauser, user
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await adapter.connect(lp).depositWithPull(amount);

      await expect(adapter.connect(pauser).pause())
        .to.emit(adapter, "Paused");
      await expect(adapter.connect(liquidityAdmin).withdraw(user, amount))
        .to.be.revertedWithCustomError(adapter, "EnforcedPause");
    });

    it("Should withdraw profit from the target vault", async function () {
      const {
        adapter, liquidityPool, usdc, USDC_DEC, lp, user, liquidityAdmin, generateProfit, withdrawProfit
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await adapter.connect(lp).depositWithPull(amount);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);

      const profit = 1000n * USDC_DEC;
      await generateProfit(profit);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);
      expect(await liquidityPool.totalAssets()).to.eq(amount + profit);

      await expect(adapter.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(adapter, "ProfitWithdrawn").withArgs(usdc, user, profit);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.maxWithdraw(adapter)).to.eq(amount);
      expect(await usdc.balanceOf(user)).to.eq(profit);

      const donation = 200n * USDC_DEC;
      await usdc.connect(lp).transfer(adapter, donation);
      await generateProfit(profit, 1n);
      await adapter.connect(liquidityAdmin).withdraw(user, amount);
      expect(await adapter.totalDeposited()).to.eq(0);
      expect(await liquidityPool.maxWithdraw(adapter)).to.eq(profit);
      expect(await usdc.balanceOf(user)).to.eq(amount + profit);

      await expect(adapter.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(adapter, "ProfitWithdrawn").withArgs(usdc, user, profit + donation);
      expect(await adapter.totalDeposited()).to.eq(0);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(0);
      expect(await liquidityPool.maxWithdraw(adapter)).to.eq(0);
      expect(await usdc.balanceOf(user)).to.eq(amount + profit + profit + donation);
    });

    it("Should NOT withdraw profit in target vault shares", async function () {
      const {
        adapter, liquidityPool, usdc, USDC_DEC, lp, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amount);
      await liquidityPool.connect(lp)[ERC4626Deposit](amount, adapter);

      await expect(adapter.connect(withdrawProfit).withdrawProfit([liquidityPool], user))
        .to.be.revertedWithCustomError(adapter, "InvalidToken");
    });

    it("Should NOT withdraw profit to zero address", async function () {
      const {
        adapter, usdc, USDC_DEC, lp, withdrawProfit
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await adapter.connect(lp).depositWithPull(amount);

      await expect(adapter.connect(withdrawProfit).withdrawProfit([usdc], ZERO_ADDRESS))
        .to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("Should NOT withdraw profit if nothing to withdraw", async function () {
      const {
        adapter, usdc, withdrawProfit, user
      } = await loadFixture(deployAll);
      await expect(adapter.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.be.revertedWithCustomError(adapter, "NoProfit");
    });

    it("Should NOT withdraw profit if paused", async function () {
      const {
        adapter, usdc, USDC_DEC, lp, withdrawProfit, pauser, user
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await adapter.connect(lp).depositWithPull(amount);

      await expect(adapter.connect(pauser).pause())
        .to.emit(adapter, "Paused");
      await expect(adapter.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.be.revertedWithCustomError(adapter, "EnforcedPause");
    });

    it("Should NOT withdraw liquidity as profit from the target vault, 1 share", async function () {
      const {
        adapter, liquidityPool, usdc, lp, user, generateProfit, withdrawProfit
      } = await loadFixture(deployAll);
      const amount = 1n;
      await usdc.connect(lp).approve(adapter, amount);
      await adapter.connect(lp).depositWithPull(amount);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);

      const profit = 1n;
      await generateProfit(profit);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);
      expect(await liquidityPool.totalAssets()).to.eq(amount + profit);

      await expect(adapter.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.be.revertedWithCustomError(adapter, "NoProfit");
    });

    it("Should NOT withdraw liquidity as profit from the target vault, 2 shares", async function () {
      const {
        adapter, liquidityPool, usdc, lp, user, generateProfit, withdrawProfit
      } = await loadFixture(deployAll);
      const amount = 2n;
      await usdc.connect(lp).approve(adapter, amount);
      await adapter.connect(lp).depositWithPull(amount);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);

      const profit = 1n;
      await generateProfit(profit);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);
      expect(await liquidityPool.totalAssets()).to.eq(amount + profit);

      await expect(adapter.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.be.revertedWithCustomError(adapter, "NoProfit");
    });

    it("Should NOT withdraw liquidity as profit from the target vault, 2 shares, 5 assets", async function () {
      const {
        adapter, liquidityPool, usdc, USDC_DEC, lp, user, generateProfit, withdrawProfit
      } = await loadFixture(deployAll);
      const amount = 2n;
      const amountOthers = 100n * USDC_DEC;
      await usdc.connect(lp).approve(adapter, amount);
      await adapter.connect(lp).depositWithPull(amount);
      await usdc.connect(lp).approve(liquidityPool, amountOthers);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountOthers, lp);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);
      expect(await liquidityPool.totalAssets()).to.eq(amountOthers + amount);

      const profit = 3n + 150n * USDC_DEC;
      await generateProfit(profit);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balanceOf(adapter)).to.eq(amount);
      expect(await liquidityPool.totalAssets()).to.eq(amountOthers + amount + profit);

      await expect(adapter.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(adapter, "ProfitWithdrawn").withArgs(usdc, user, 2n);
      expect(await adapter.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.maxWithdraw(adapter)).to.eq(2n);
      expect(await usdc.balanceOf(user)).to.eq(2n);
    });

    it("Should NOT allow native token donations", async function () {
      const {admin, adapter} = await loadFixture(deployAll);
      const amount = 2n * ETH;
      await expect(admin.sendTransaction({to: adapter, value: amount})).to.be.reverted;
    });
  });

  describe("Roles and admin functions", function () {
    it("Should allow PAUSER_ROLE to pause and unpause the contract", async function () {
      const {adapter, pauser} = await loadFixture(deployAll);
      expect(await adapter.paused())
        .to.be.false;
      await expect(adapter.connect(pauser).pause())
        .to.emit(adapter, "Paused").withArgs(pauser);
      expect(await adapter.paused())
        .to.be.true;
      await expect(adapter.connect(pauser).unpause())
        .to.emit(adapter, "Unpaused").withArgs(pauser);
      expect(await adapter.paused())
        .to.be.false;
    });

    it("Should NOT allow others to pause and unpause the contract", async function () {
      const {adapter, admin} = await loadFixture(deployAll);
      await expect(adapter.connect(admin).pause())
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount");
    });

    it("Should NOT allow PAUSER_ROLE to pause if already paused", async function () {
      const {adapter, pauser} = await loadFixture(deployAll);
      await adapter.connect(pauser).pause();
      await expect(adapter.connect(pauser).pause())
        .to.be.revertedWithCustomError(adapter, "EnforcedPause");
    });

    it("Should NOT allow PAUSER_ROLE to unpause if already unpaused", async function () {
      const {adapter, pauser} = await loadFixture(deployAll);
      await expect(adapter.connect(pauser).unpause())
        .to.be.revertedWithCustomError(adapter, "ExpectedPause");
    });
  });
});
