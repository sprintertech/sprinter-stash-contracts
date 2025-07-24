import {
    loadFixture, time, setBalance, setCode
  } from "@nomicfoundation/hardhat-toolbox/network-helpers";
  import {expect} from "chai";
  import hre from "hardhat";
  import {
    deploy, getBalance, signBorrow, signBorrowMany,
  } from "./helpers";
  import {ZERO_ADDRESS, NATIVE_TOKEN, ETH} from "../scripts/common";
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
  
      const WETH_ADDRESS = networkConfig.BASE.WrappedNativeToken;
      const WETH_OWNER_ADDRESS = process.env.WETH_OWNER_ADDRESS!;
      if (!WETH_OWNER_ADDRESS) throw new Error("Env variables not configured (WETH_OWNER_ADDRESS missing)");
      const weth = await hre.ethers.getContractAt("ERC20", WETH_ADDRESS);
      const wethOwner = await hre.ethers.getImpersonatedSigner(WETH_OWNER_ADDRESS);
  
      const GHO_ADDRESS = "0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee";
      const GHO_OWNER_ADDRESS = process.env.GHO_OWNER_ADDRESS!;
      if (!GHO_OWNER_ADDRESS) throw new Error("Env variables not configured (GHO_OWNER_ADDRESS missing)");
      const gho = await hre.ethers.getContractAt("ERC20", GHO_ADDRESS);
      const ghoOwner = await hre.ethers.getImpersonatedSigner(GHO_OWNER_ADDRESS);
  
      const EURC_ADDRESS = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";
      const EURC_OWNER_ADDRESS = process.env.EURC_OWNER_ADDRESS;
      if (!EURC_OWNER_ADDRESS) throw new Error("Env variables not configured (EURC_OWNER_ADDRESS missing)");
      const eurc = await hre.ethers.getContractAt("ERC20", EURC_ADDRESS);
      const eurcOwner = await hre.ethers.getImpersonatedSigner(EURC_OWNER_ADDRESS);
      await setBalance(EURC_OWNER_ADDRESS, 10n ** 18n);
  
      const EURC_DEC = 10n ** (await eurc.decimals());
      const GHO_DEC = 10n ** (await gho.decimals());
      const WETH_DEC = 10n ** (await weth.decimals());
  
      const wethLiquidityPool = (
        await deploy("LiquidityPool", deployer, {},
          weth, admin, mpc_signer, weth
        )
      ) as LiquidityPool;
  
      const mockTarget = (
        await deploy("MockTarget", deployer)
      ) as MockTarget;
  
      const mockBorrowSwap = (
        await deploy("MockBorrowSwap", deployer)
      ) as MockBorrowSwap;
  
      const LIQUIDITY_ADMIN_ROLE = encodeBytes32String("LIQUIDITY_ADMIN_ROLE");
      await wethLiquidityPool.connect(admin).grantRole(LIQUIDITY_ADMIN_ROLE, liquidityAdmin.address);
  
      const WITHDRAW_PROFIT_ROLE = encodeBytes32String("WITHDRAW_PROFIT_ROLE");
      await wethLiquidityPool.connect(admin).grantRole(WITHDRAW_PROFIT_ROLE, withdrawProfit.address);
  
      const PAUSER_ROLE = encodeBytes32String("PAUSER_ROLE");
      await wethLiquidityPool.connect(admin).grantRole(PAUSER_ROLE, pauser.address);
  
      return {deployer, admin, user, user2, mpc_signer, weth, wethOwner, gho, ghoOwner, eurc, eurcOwner,
        wethLiquidityPool, mockTarget, mockBorrowSwap, EURC_DEC, GHO_DEC, WETH_DEC,
        liquidityAdmin, withdrawProfit, pauser};
    };
  
    describe("Initialization", function () {
      it.only("Should initialize the contract with correct values", async function () {
        const {wethLiquidityPool, weth, mpc_signer} = await loadFixture(deployAll);
        expect(await wethLiquidityPool.ASSETS())
          .to.be.eq(weth.target);
        expect(await wethLiquidityPool.mpcAddress())
          .to.be.eq(mpc_signer);
        expect(await wethLiquidityPool.WRAPPED_NATIVE_TOKEN())
          .to.be.eq(weth.target);
      });
    });
  
    describe("Borrow, supply, withdraw", function () {
      it.only("Should deposit to the pool", async function () {
        const {wethLiquidityPool, weth, wethOwner, WETH_DEC, liquidityAdmin} = await loadFixture(deployAll);
        const amount = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amount);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amount))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amount);
        expect(await wethLiquidityPool.totalDeposited()).to.eq(amount);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amount);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amount);
      });
  
      it.only("Should deposit to the pool with pulling funds", async function () {
        const {wethLiquidityPool, weth, wethOwner, WETH_DEC} = await loadFixture(deployAll);
        const amount = 100n * WETH_DEC;
        await weth.connect(wethOwner).approve(wethLiquidityPool, amount);
        await expect(wethLiquidityPool.connect(wethOwner).depositWithPull(amount))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(wethOwner, amount);
        expect(await wethLiquidityPool.totalDeposited()).to.eq(amount);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amount);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amount);
      });
  
      it.only("Should borrow a token with contract call", async function () {
        const {
          wethLiquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, wethOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
        const amountToBorrow = 3n * WETH_DEC;
  
        const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
        const callData = await mockTarget.fulfill.populateTransaction(weth, amountToBorrow, additionalData);
  
        const signature = await signBorrow(
          mpc_signer,
          wethLiquidityPool.target as string,
          user.address,
          weth.target as string,
          amountToBorrow.toString(),
          mockTarget.target as string,
          callData.data,
          31337
        );
  
        await expect(wethLiquidityPool.connect(user).borrow(
          weth,
          amountToBorrow,
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature))
        .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
        expect(await weth.balanceOf(wethLiquidityPool)).to.eq(amountLiquidity - amountToBorrow);
        expect(await getBalance(wethLiquidityPool)).to.eq(0n);
        expect(await wethLiquidityPool.totalDeposited()).to.eq(amountLiquidity);
        expect(await weth.balanceOf(mockTarget)).to.eq(amountToBorrow);
        expect(await getBalance(mockTarget)).to.eq(0n);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity - amountToBorrow);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amountLiquidity - amountToBorrow);
      });
  
      it.only("Should borrow a native token with contract call", async function () {
        const {
          wethLiquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, wethOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
        const amountToBorrow = 3n * WETH_DEC;
  
        const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
        const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, amountToBorrow, additionalData);
  
        const signature = await signBorrow(
          mpc_signer,
          wethLiquidityPool.target as string,
          user.address,
          NATIVE_TOKEN,
          amountToBorrow.toString(),
          mockTarget.target as string,
          callData.data,
          31337
        );
  
        await expect(wethLiquidityPool.connect(user).borrow(
          NATIVE_TOKEN,
          amountToBorrow,
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature))
        .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
        expect(await weth.balanceOf(wethLiquidityPool)).to.eq(amountLiquidity - amountToBorrow);
        expect(await getBalance(wethLiquidityPool)).to.eq(0n);
        expect(await wethLiquidityPool.totalDeposited()).to.eq(amountLiquidity);
        expect(await weth.balanceOf(mockTarget)).to.eq(0n);
        expect(await getBalance(mockTarget)).to.eq(amountToBorrow);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity - amountToBorrow);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amountLiquidity - amountToBorrow);
      });
  
      it.only("Should borrow a token with swap", async function () {
        // WETH is borrowed and swapped to EURC
        const {
          wethLiquidityPool, mockTarget, mockBorrowSwap, weth, WETH_DEC,
          user, mpc_signer, wethOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
        const amountToBorrow = 3n * WETH_DEC;
        const fillAmount = 200n * EURC_DEC;
        await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);
  
        const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
        const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
        const swapData = AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [eurcOwner.address]
        );
  
        const signature = await signBorrow(
          mpc_signer,
          wethLiquidityPool.target as string,
          mockBorrowSwap.target as string,
          weth.target as string,
          amountToBorrow.toString(),
          mockTarget.target as string,
          callData.data,
          31337
        );
  
        const borrowCalldata = await wethLiquidityPool.borrowAndSwap.populateTransaction(
          weth,
          amountToBorrow,
          {fillToken: eurc, fillAmount, swapData},
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature
        );
  
        await expect(mockBorrowSwap.connect(user).callBorrow(wethLiquidityPool, borrowCalldata.data))
          .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
          .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
        expect(await weth.balanceOf(wethLiquidityPool)).to.eq(amountLiquidity - amountToBorrow);
        expect(await weth.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
        expect(await eurc.balanceOf(wethLiquidityPool)).to.eq(0);
        expect(await eurc.balanceOf(mockTarget)).to.eq(fillAmount);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity - amountToBorrow);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amountLiquidity - amountToBorrow);
      });
  
      it.only("Should borrow a token with swap and native fill", async function () {
        // WETH is borrowed and swapped to ETH
        const {
          wethLiquidityPool, mockTarget, mockBorrowSwap, weth, WETH_DEC,
          user, mpc_signer, wethOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
        const amountToBorrow = 3n * WETH_DEC;
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
          wethLiquidityPool.target as string,
          mockBorrowSwap.target as string,
          weth.target as string,
          amountToBorrow.toString(),
          mockTarget.target as string,
          callData.data,
          31337
        );
  
        const borrowCalldata = await wethLiquidityPool.borrowAndSwap.populateTransaction(
          weth,
          amountToBorrow,
          {fillToken: NATIVE_TOKEN, fillAmount, swapData},
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature
        );
  
        await expect(mockBorrowSwap.connect(user).callBorrow(wethLiquidityPool, borrowCalldata.data))
          .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
          .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
        expect(await weth.balanceOf(wethLiquidityPool)).to.eq(amountLiquidity - amountToBorrow);
        expect(await weth.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
        expect(await getBalance(wethLiquidityPool)).to.eq(0);
        expect(await getBalance(mockTarget)).to.eq(fillAmount);
        expect(await getBalance(mockBorrowSwap)).to.eq(0);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity - amountToBorrow);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amountLiquidity - amountToBorrow);
      });

      it.only("Should NOT borrow a native token with swap", async function () {
        // WETH is borrowed and swapped to ETH
        const {
          wethLiquidityPool, mockTarget, weth, WETH_DEC,
          user, mpc_signer, wethOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
        const amountToBorrow = 3n * WETH_DEC;
        const fillAmount = 1n * ETH;
  
        const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
        const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
        const swapData = AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [wethOwner.address]
        );
  
        const signature = await signBorrow(
          mpc_signer,
          wethLiquidityPool.target as string,
          user.address as string,
          NATIVE_TOKEN,
          amountToBorrow.toString(),
          mockTarget.target as string,
          callData.data,
          31337
        );
  
        await expect(wethLiquidityPool.connect(user).borrowAndSwap(
          NATIVE_TOKEN,
          amountToBorrow,
          {fillToken: NATIVE_TOKEN, fillAmount, swapData},
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature
        )).to.be.revertedWithCustomError(wethLiquidityPool, "NativeBorrowDenied");
  
        await expect(wethLiquidityPool.connect(user).borrowAndSwap(
          NATIVE_TOKEN,
          amountToBorrow,
          {fillToken: weth, fillAmount, swapData},
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature
        )).to.be.revertedWithCustomError(wethLiquidityPool, "NativeBorrowDenied");
      });
  
      it.only("Should borrow many tokens [weth, weth] with contract call", async function () {
        const {
          wethLiquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, wethOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
        const amountToBorrow = 3n * WETH_DEC;
        const amountToBorrow2 = 4n * WETH_DEC;
  
        const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
        // In LiquidityPool only ASSET can be borrowed, so when borrowing many second amount
        // approval will override the first one.
        const callData = await mockTarget.fulfill.populateTransaction(weth, amountToBorrow2, additionalData);
  
        const signature = await signBorrowMany(
          mpc_signer,
          wethLiquidityPool,
          user,
          [weth, weth],
          [amountToBorrow, amountToBorrow2],
          mockTarget,
          callData.data,
          31337
        );
  
        await expect(wethLiquidityPool.connect(user).borrowMany(
          [weth, weth],
          [amountToBorrow, amountToBorrow2],
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature))
        .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
        expect(await weth.balanceOf(wethLiquidityPool)).to.eq(amountLiquidity - amountToBorrow2);
        expect(await wethLiquidityPool.totalDeposited()).to.eq(amountLiquidity);
        expect(await weth.balanceOf(mockTarget)).to.eq(amountToBorrow2);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity - amountToBorrow2);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amountLiquidity - amountToBorrow2);
      });
  
      it.only("Should borrow many tokens [weth, native] with contract call", async function () {
        const {
          wethLiquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, wethOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
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
          wethLiquidityPool,
          user,
          [weth, NATIVE_TOKEN],
          [amountToBorrow, amountToBorrow2],
          mockTarget,
          callData.data,
          31337
        );
  
        await expect(wethLiquidityPool.connect(user).borrowMany(
          [weth, NATIVE_TOKEN],
          [amountToBorrow, amountToBorrow2],
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature))
        .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
        expect(await weth.balanceOf(wethLiquidityPool)).to.eq(amountLiquidity - amountToBorrow - amountToBorrow2);
        expect(await wethLiquidityPool.totalDeposited()).to.eq(amountLiquidity);
        expect(await weth.balanceOf(mockTarget)).to.eq(amountToBorrow);
        expect(await getBalance(wethLiquidityPool)).to.eq(0);
        expect(await getBalance(mockTarget)).to.eq(amountToBorrow2);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity - amountToBorrow - amountToBorrow2);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amountLiquidity - amountToBorrow - amountToBorrow2);
      });
  
      it.only("Should borrow many tokens [native, weth] with contract call", async function () {
        const {
          wethLiquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, wethOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
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
          wethLiquidityPool,
          user,
          [NATIVE_TOKEN, weth],
          [amountToBorrow2, amountToBorrow],
          mockTarget,
          callData.data,
          31337
        );
  
        await expect(wethLiquidityPool.connect(user).borrowMany(
          [NATIVE_TOKEN, weth],
          [amountToBorrow2, amountToBorrow],
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature))
        .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
        expect(await weth.balanceOf(wethLiquidityPool)).to.eq(amountLiquidity - amountToBorrow - amountToBorrow2);
        expect(await wethLiquidityPool.totalDeposited()).to.eq(amountLiquidity);
        expect(await weth.balanceOf(mockTarget)).to.eq(amountToBorrow);
        expect(await getBalance(wethLiquidityPool)).to.eq(0);
        expect(await getBalance(mockTarget)).to.eq(amountToBorrow2);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity - amountToBorrow - amountToBorrow2);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amountLiquidity - amountToBorrow - amountToBorrow2);
      });
  
      it.only("Should borrow many tokens [native, weth, native] with contract call", async function () {
        const {
          wethLiquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, wethOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
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
          wethLiquidityPool,
          user,
          [NATIVE_TOKEN, weth, NATIVE_TOKEN],
          [amountToBorrow2, amountToBorrow, amountToBorrow3],
          mockTarget,
          callData.data,
          31337
        );
  
        await expect(wethLiquidityPool.connect(user).borrowMany(
          [NATIVE_TOKEN, weth, NATIVE_TOKEN],
          [amountToBorrow2, amountToBorrow, amountToBorrow3],
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature))
        .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
        const remainingLiquidity = amountLiquidity - amountToBorrow - amountToBorrow2 - amountToBorrow3;
        expect(await weth.balanceOf(wethLiquidityPool)).to.eq(remainingLiquidity);
        expect(await wethLiquidityPool.totalDeposited()).to.eq(amountLiquidity);
        expect(await weth.balanceOf(mockTarget)).to.eq(amountToBorrow);
        expect(await getBalance(wethLiquidityPool)).to.eq(0);
        expect(await getBalance(mockTarget)).to.eq(amountToBorrow2 + amountToBorrow3);
        expect(await wethLiquidityPool.balance(weth)).to.eq(remainingLiquidity);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(remainingLiquidity);
      });
  
      it.only("Should borrow many tokens with swap", async function () {
        // WETH is borrowed and swapped to EURC
        const {
          wethLiquidityPool, mockTarget, mockBorrowSwap, weth, WETH_DEC,
          user, mpc_signer, wethOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
        const amountToBorrow = 3n * WETH_DEC;
        const fillAmount = 200n * EURC_DEC;
        await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);
  
        const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
        const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
        const swapData = AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [eurcOwner.address]
        );
  
        const signature = await signBorrowMany(
          mpc_signer,
          wethLiquidityPool,
          mockBorrowSwap,
          [weth],
          [amountToBorrow],
          mockTarget,
          callData.data,
          31337
        );
  
        const borrowCalldata = await wethLiquidityPool.borrowAndSwapMany.populateTransaction(
          [weth],
          [amountToBorrow],
          {fillToken: eurc, fillAmount, swapData},
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature
        );
  
        await expect(mockBorrowSwap.connect(user).callBorrow(wethLiquidityPool, borrowCalldata.data))
          .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
          .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
        expect(await weth.balanceOf(wethLiquidityPool)).to.be.lessThan(amountLiquidity);
        expect(await weth.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
        expect(await eurc.balanceOf(wethLiquidityPool)).to.eq(0);
        expect(await eurc.balanceOf(mockTarget)).to.eq(fillAmount);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity - amountToBorrow);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amountLiquidity - amountToBorrow);
      });
  
      it.only("Should borrow many tokens with swap and native fill", async function () {
        // WETH is borrowed and swapped to ETH
        const {
          wethLiquidityPool, mockTarget, mockBorrowSwap, weth, WETH_DEC,
          user, mpc_signer, wethOwner, liquidityAdmin
        } = await loadFixture(deployAll);
        const amountLiquidity = 100n * WETH_DEC;
        await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
        await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
          .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);
  
        const amountToBorrow = 3n * WETH_DEC;
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
          wethLiquidityPool,
          mockBorrowSwap,
          [weth],
          [amountToBorrow],
          mockTarget,
          callData.data,
          31337
        );
  
        const borrowCalldata = await wethLiquidityPool.borrowAndSwapMany.populateTransaction(
          [weth],
          [amountToBorrow],
          {fillToken: NATIVE_TOKEN, fillAmount, swapData},
          mockTarget,
          callData.data,
          0n,
          2000000000n,
          signature
        );
  
        await expect(mockBorrowSwap.connect(user).callBorrow(wethLiquidityPool, borrowCalldata.data))
          .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
          .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
        expect(await weth.balanceOf(wethLiquidityPool)).to.eq(amountLiquidity - amountToBorrow);
        expect(await weth.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
        expect(await getBalance(wethLiquidityPool)).to.eq(0);
        expect(await getBalance(mockTarget)).to.eq(fillAmount);
        expect(await getBalance(mockBorrowSwap)).to.eq(0);
        expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity - amountToBorrow);
        expect(await wethLiquidityPool.balance(NATIVE_TOKEN)).to.eq(amountLiquidity - amountToBorrow);
      });
  
    //   it("Should deposit when the contract is paused", async function () {
    //     const {wethLiquidityPool, pauser, weth, wethOwner, WETH_DEC, liquidityAdmin} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(pauser).pause())
    //       .to.emit(wethLiquidityPool, "Paused");
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
    //     await weth.connect(wethOwner).approve(wethLiquidityPool.target, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(wethOwner).depositWithPull(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit").withArgs(wethOwner, amountLiquidity);
    //     expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity + amountLiquidity);
    //   });
  
    //   it("Should withdraw liquidity", async function () {
    //     const {
    //       wethLiquidityPool, weth, wethOwner, WETH_DEC, user, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amount = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amount);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amount))
    //       .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amount);
    //     expect(await wethLiquidityPool.totalDeposited()).to.eq(amount);
  
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).withdraw(user.address, amount))
    //       .to.emit(wethLiquidityPool, "Withdraw").withArgs(liquidityAdmin, user.address, amount);
    //     expect(await weth.balanceOf(user.address)).to.eq(amount);
    //     expect(await weth.balanceOf(wethLiquidityPool)).to.eq(0);
    //     expect(await wethLiquidityPool.totalDeposited()).to.eq(0);
    //     expect(await wethLiquidityPool.balance(weth)).to.eq(0);
    //   });
  
    //   it("Should withdraw profit for multiple tokens from the pool", async function () {
    //     const {
    //       wethLiquidityPool, eurc, gho, EURC_DEC, eurcOwner, ghoOwner, withdrawProfit, user
    //     } = await loadFixture(deployAll);
    //     const amountUni = 1n * EURC_DEC;
    //     const amountRpl = 1n * EURC_DEC;
    //     await eurc.connect(eurcOwner).transfer(wethLiquidityPool, amountUni);
    //     await gho.connect(ghoOwner).transfer(wethLiquidityPool, amountRpl);
    //     await expect(wethLiquidityPool.connect(withdrawProfit).withdrawProfit([eurc.target, gho.target], user.address))
    //       .to.emit(wethLiquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountUni)
    //       .and.to.emit(wethLiquidityPool, "ProfitWithdrawn").withArgs(gho.target, user.address, amountRpl);
    //     expect(await eurc.balanceOf(user.address)).to.eq(amountUni);
    //     expect(await gho.balanceOf(user.address)).to.eq(amountRpl);
    //   });
  
    //   it("Should withdraw liquidity as profit from the pool", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, wethOwner, withdrawProfit, liquidityAdmin, user
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
    //     const amountProfit = 2n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountProfit);
    //     expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity + amountProfit);
    //     expect(await wethLiquidityPool.totalDeposited()).to.eq(amountLiquidity);
    //     await expect(wethLiquidityPool.connect(withdrawProfit).withdrawProfit([weth.target], user.address))
    //       .to.emit(wethLiquidityPool, "ProfitWithdrawn").withArgs(weth.target, user.address, amountProfit);
    //     expect(await weth.balanceOf(user.address)).to.eq(amountProfit);
    //     expect(await weth.balanceOf(wethLiquidityPool)).to.eq(amountLiquidity);
    //     expect(await wethLiquidityPool.totalDeposited()).to.eq(amountLiquidity);
    //     expect(await wethLiquidityPool.balance(weth)).to.eq(amountLiquidity);
    //   });
  
    //   it("Should withdraw all available balance as profit ", async function () {
    //     const {wethLiquidityPool, weth, WETH_DEC, wethOwner, withdrawProfit, user} = await loadFixture(deployAll);
    //     const amount = 2n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amount);
    //     await expect(wethLiquidityPool.connect(withdrawProfit).withdrawProfit([weth.target], user.address))
    //       .to.emit(wethLiquidityPool, "ProfitWithdrawn").withArgs(weth.target, user.address, amount);
    //     expect(await weth.balanceOf(user.address)).to.eq(amount);
    //     expect(await wethLiquidityPool.balance(weth)).to.eq(0);
    //   });
  
    //   it("Should NOT deposit if no collateral on contract", async function () {
    //     const {wethLiquidityPool, liquidityAdmin} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(10))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "NotEnoughToDeposit");
    //   });
  
    //   it("Should return 0 for balance of other tokens", async function () {
    //     const {
    //       wethLiquidityPool, eurc, EURC_DEC, eurcOwner
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 1000n * EURC_DEC;
    //     await eurc.connect(eurcOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     expect(await wethLiquidityPool.balance(eurc.target)).to.eq(0);
    //   });
  
    //   it("Should NOT borrow other tokens", async function () {
    //     const {
    //       wethLiquidityPool, eurc, EURC_DEC, user, mpc_signer, user2, eurcOwner
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 1000n * EURC_DEC;
    //     await eurc.connect(eurcOwner).transfer(wethLiquidityPool, amountLiquidity);
  
    //     const amountToBorrow = 2n * EURC_DEC;
    //     const signature = await signBorrow(
    //       mpc_signer,
    //       wethLiquidityPool.target as string,
    //       user.address as string,
    //       eurc.target as string,
    //       amountToBorrow.toString(),
    //       user2.address,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrow(
    //       eurc.target,
    //       amountToBorrow,
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidBorrowToken");
    //   });
  
    //   it("Should NOT borrow if MPC signature is wrong", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, user, user2, wethOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const signature = await signBorrow(
    //       user,
    //       wethLiquidityPool.target as string,
    //       user.address as string,
    //       weth.target as string,
    //       amountToBorrow.toString(),
    //       user2.address,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrow(
    //       weth.target,
    //       amountToBorrow,
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidSignature");
    //   });
  
    //   it("Should NOT borrow if MPC signature nonce is reused", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, user, user2, wethOwner, mpc_signer, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const signature = await signBorrow(
    //       mpc_signer,
    //       wethLiquidityPool.target as string,
    //       user.address as string,
    //       weth.target as string,
    //       amountToBorrow.toString(),
    //       user2.address,
    //       "0x",
    //       31337
    //     );
  
    //     await wethLiquidityPool.connect(user).borrow(
    //       weth.target,
    //       amountToBorrow,
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature);
    //     await expect(wethLiquidityPool.connect(user).borrow(
    //       weth.target,
    //       amountToBorrow,
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "NonceAlreadyUsed");
    //   });
  
    //   it("Should NOT borrow if MPC signature is expired", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, user, user2, wethOwner, mpc_signer, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const deadline = (await now()) - 1n;
    //     const signature = await signBorrow(
    //       mpc_signer,
    //       wethLiquidityPool.target as string,
    //       user.address as string,
    //       weth.target as string,
    //       amountToBorrow.toString(),
    //       user2.address,
    //       "0x",
    //       31337,
    //       0n,
    //       deadline,
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrow(
    //       weth.target,
    //       amountToBorrow,
    //       user2,
    //       "0x",
    //       0n,
    //       deadline,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "ExpiredSignature");
    //   });
  
    //   it("Should NOT borrow if target call fails", async function () {
    //     const {
    //       wethLiquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, wethOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
  
    //     const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
    //     const callData = await mockTarget.fulfill.populateTransaction(weth.target, amountToBorrow, additionalData);
  
    //     const signature = await signBorrow(
    //       mpc_signer,
    //       wethLiquidityPool.target as string,
    //       user.address as string,
    //       weth.target as string,
    //       amountToBorrow.toString(),
    //       weth.target as string,
    //       callData.data,
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrow(
    //       weth.target,
    //       amountToBorrow,
    //       weth.target,
    //       callData.data,
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "TargetCallFailed");
    //   });
  
    //   it("Should NOT borrow if borrowing is paused", async function () {
    //     const {wethLiquidityPool, user, user2, withdrawProfit, mpc_signer, weth, WETH_DEC} = await loadFixture(deployAll);
  
    //     // Pause borrowing
    //     await expect(wethLiquidityPool.connect(withdrawProfit).pauseBorrow())
    //       .to.emit(wethLiquidityPool, "BorrowPaused");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const signature = await signBorrow(
    //       mpc_signer,
    //       wethLiquidityPool.target as string,
    //       user.address as string,
    //       weth.target as string,
    //       amountToBorrow.toString(),
    //       user2.address,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrow(
    //       weth.target,
    //       amountToBorrow,
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "BorrowingIsPaused");
    //   });
  
    //   it("Should NOT borrow if the contract is paused", async function () {
    //     const {wethLiquidityPool, weth, user, user2, pauser} = await loadFixture(deployAll);
  
    //     // Pause the contract
    //     await expect(wethLiquidityPool.connect(pauser).pause())
    //       .to.emit(wethLiquidityPool, "Paused");
  
    //     await expect(wethLiquidityPool.connect(user).borrow(
    //       weth.target,
    //       1,
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       "0x"))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "EnforcedPause");
    //   });
  
    //   it("Should NOT borrow if MPC signature is wrong (caller is wrong)", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, user, user2, wethOwner, liquidityAdmin, mpc_signer,
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const signature = await signBorrow(
    //       mpc_signer,
    //       wethLiquidityPool.target as string,
    //       user.address as string,
    //       weth.target as string,
    //       amountToBorrow.toString(),
    //       user2.address,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user2).borrow(
    //       weth.target,
    //       amountToBorrow,
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidSignature");
    //   });
  
    //   it("Should NOT borrow and swap if MPC signature is wrong (caller is wrong)", async function () {
    //     // WETH is borrowed and swapped to EURC
    //     const {
    //       wethLiquidityPool, mockTarget, mockBorrowSwap, weth, WETH_DEC,
    //       user, mpc_signer, wethOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 3n * WETH_DEC;
    //     const fillAmount = 200n * EURC_DEC;
    //     await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);
  
    //     const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
    //     const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
    //     const swapData = AbiCoder.defaultAbiCoder().encode(
    //       ["address"],
    //       [eurcOwner.address]
    //     );
  
    //     // user address is signed instead of mockBorrowSwap address
    //     const signature = await signBorrow(
    //       mpc_signer,
    //       wethLiquidityPool.target as string,
    //       user.address as string,
    //       weth.target as string,
    //       amountToBorrow.toString(),
    //       mockTarget.target as string,
    //       callData.data,
    //       31337
    //     );
  
    //     const borrowCalldata = await wethLiquidityPool.borrowAndSwap.populateTransaction(
    //       weth,
    //       amountToBorrow,
    //       {fillToken: eurc.target, fillAmount, swapData},
    //       mockTarget.target,
    //       callData.data,
    //       0n,
    //       2000000000n,
    //       signature
    //     );
  
    //     await expect(mockBorrowSwap.connect(user).callBorrow(wethLiquidityPool, borrowCalldata.data))
    //       .to.be.reverted;
    //   });
  
    //   it("Should NOT borrow and swap if the swap fails", async function () {
    //     // WETH is borrowed and swapped to EURC
    //     const {
    //       wethLiquidityPool, mockTarget, mockBorrowSwap, weth, WETH_DEC,
    //       user, mpc_signer, wethOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 3n * WETH_DEC;
    //     const fillAmount = 200n * EURC_DEC;
  
    //     const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
    //     const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
    //     const swapData = AbiCoder.defaultAbiCoder().encode(
    //       ["address"],
    //       [eurcOwner.address]
    //     );
  
    //     const signature = await signBorrow(
    //       mpc_signer,
    //       wethLiquidityPool.target as string,
    //       mockBorrowSwap.target as string,
    //       weth.target as string,
    //       amountToBorrow.toString(),
    //       mockTarget.target as string,
    //       callData.data,
    //       31337
    //     );
  
    //     const borrowCalldata = await wethLiquidityPool.borrowAndSwap.populateTransaction(
    //       weth,
    //       amountToBorrow,
    //       {fillToken: eurc.target, fillAmount, swapData},
    //       mockTarget.target,
    //       callData.data,
    //       0n,
    //       2000000000n,
    //       signature
    //     );
  
    //     // No EURC tokens (fillToken) will be available for swap
    //     await expect(mockBorrowSwap.connect(user).callBorrow(wethLiquidityPool, borrowCalldata.data))
    //     .to.be.reverted;
    //   });
  
    //   it("Should NOT borrow non-asset token", async function () {
    //     const {
    //       wethLiquidityPool, eurc, EURC_DEC, mpc_signer, user, user2, eurcOwner
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 1000n * EURC_DEC;
    //     await eurc.connect(eurcOwner).transfer(wethLiquidityPool, amountLiquidity);
  
    //     const amountToBorrow = 2n * EURC_DEC;
    //     const signature = await signBorrow(
    //       mpc_signer,
    //       wethLiquidityPool.target as string,
    //       user.address as string,
    //       eurc.target as string,
    //       amountToBorrow.toString(),
    //       user2.address,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrow(
    //       eurc,
    //       amountToBorrow,
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidBorrowToken");
    //   });
  
    //   it("Should NOT borrow and swap non-asset token", async function () {
    //     const {
    //       wethLiquidityPool, eurc, EURC_DEC, mpc_signer, user, eurcOwner,
    //       mockTarget,
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 1000n * EURC_DEC;
    //     await eurc.connect(eurcOwner).transfer(wethLiquidityPool, amountLiquidity);
  
    //     const amountToBorrow = 2n * EURC_DEC;
    //     const signature = await signBorrow(
    //       mpc_signer,
    //       wethLiquidityPool.target as string,
    //       user.address as string,
    //       eurc.target as string,
    //       amountToBorrow.toString(),
    //       mockTarget.target as string,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrowAndSwap(
    //       eurc,
    //       amountToBorrow,
    //       {fillToken: eurc, fillAmount: 0n, swapData: "0x"},
    //       mockTarget,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidBorrowToken");
    //   });
  
    //   it("Should NOT borrow many if MPC signature is wrong", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, user, user2, wethOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const signature = await signBorrowMany(
    //       user,
    //       wethLiquidityPool,
    //       user,
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrowMany(
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidSignature");
    //   });
  
    //   it("Should NOT borrow many if MPC signature nonce is reused", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, user, user2, wethOwner, mpc_signer, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       31337
    //     );
  
    //     await wethLiquidityPool.connect(user).borrowMany(
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature);
    //     await expect(wethLiquidityPool.connect(user).borrowMany(
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "NonceAlreadyUsed");
    //   });
  
    //   it("Should NOT borrow many if MPC signature is expired", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, user, user2, wethOwner, mpc_signer, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const deadline = (await now()) - 1n;
    //     const signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       31337,
    //       0n,
    //       deadline,
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrowMany(
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       0n,
    //       deadline,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "ExpiredSignature");
    //   });
  
    //   it("Should NOT borrow many if target call fails", async function () {
    //     const {
    //       wethLiquidityPool, mockTarget, weth, WETH_DEC, user, mpc_signer, wethOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
  
    //     const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
    //     const callData = await mockTarget.fulfill.populateTransaction(weth, amountToBorrow, additionalData);
  
    //     const signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       weth,
    //       callData.data,
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrowMany(
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       weth,
    //       callData.data,
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "TargetCallFailed");
    //   });
  
    //   it("Should NOT borrow many if borrowing is paused", async function () {
    //     const {wethLiquidityPool, user, user2, withdrawProfit, mpc_signer, weth, WETH_DEC} = await loadFixture(deployAll);
  
    //     // Pause borrowing
    //     await expect(wethLiquidityPool.connect(withdrawProfit).pauseBorrow())
    //       .to.emit(wethLiquidityPool, "BorrowPaused");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrowMany(
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "BorrowingIsPaused");
    //   });
  
    //   it("Should NOT borrow many if the contract is paused", async function () {
    //     const {wethLiquidityPool, weth, user, user2, pauser} = await loadFixture(deployAll);
  
    //     // Pause the contract
    //     await expect(wethLiquidityPool.connect(pauser).pause())
    //       .to.emit(wethLiquidityPool, "Paused");
  
    //     await expect(wethLiquidityPool.connect(user).borrowMany(
    //       [weth, weth],
    //       [1n, 1n],
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       "0x"))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "EnforcedPause");
    //   });
  
    //   it("Should NOT borrow many if MPC signature is wrong (caller is wrong)", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, user, user2, wethOwner, liquidityAdmin, mpc_signer,
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user2).borrowMany(
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidSignature");
    //   });
  
    //   it("Should NOT borrow and swap many if MPC signature is wrong (caller is wrong)", async function () {
    //     // WETH is borrowed and swapped to EURC
    //     const {
    //       wethLiquidityPool, mockTarget, mockBorrowSwap, weth, WETH_DEC,
    //       user, mpc_signer, wethOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 3n * WETH_DEC;
    //     const fillAmount = 200n * EURC_DEC;
    //     await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);
  
    //     const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
    //     const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
    //     const swapData = AbiCoder.defaultAbiCoder().encode(
    //       ["address"],
    //       [eurcOwner.address]
    //     );
  
    //     // user address is signed instead of mockBorrowSwap address
    //     const signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       mockTarget,
    //       callData.data,
    //       31337
    //     );
  
    //     const borrowCalldata = await wethLiquidityPool.borrowAndSwap.populateTransaction(
    //       weth,
    //       amountToBorrow,
    //       {fillToken: eurc, fillAmount, swapData},
    //       mockTarget,
    //       callData.data,
    //       0n,
    //       2000000000n,
    //       signature
    //     );
  
    //     await expect(mockBorrowSwap.connect(user).callBorrow(wethLiquidityPool, borrowCalldata.data))
    //       .to.be.reverted;
    //   });
  
    //   it("Should NOT borrow and swap many if the swap fails", async function () {
    //     // WETH is borrowed and swapped to EURC
    //     const {
    //       wethLiquidityPool, mockTarget, mockBorrowSwap, weth, WETH_DEC,
    //       user, mpc_signer, wethOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 3n * WETH_DEC;
    //     const fillAmount = 200n * EURC_DEC;
  
    //     const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
  
    //     const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
    //     const swapData = AbiCoder.defaultAbiCoder().encode(
    //       ["address"],
    //       [eurcOwner.address]
    //     );
  
    //     const signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       mockBorrowSwap,
    //       [weth, weth],
    //       [amountToBorrow, amountToBorrow],
    //       mockTarget,
    //       callData.data,
    //       31337
    //     );
  
    //     const borrowCalldata = await wethLiquidityPool.borrowAndSwap.populateTransaction(
    //       weth,
    //       amountToBorrow,
    //       {fillToken: eurc, fillAmount, swapData},
    //       mockTarget,
    //       callData.data,
    //       0n,
    //       2000000000n,
    //       signature
    //     );
  
    //     // No EURC tokens (fillToken) will be available for swap
    //     await expect(mockBorrowSwap.connect(user).callBorrow(wethLiquidityPool, borrowCalldata.data))
    //     .to.be.reverted;
    //   });
  
    //   it("Should NOT borrow many if tokens and amounts have diff or zero length", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, mpc_signer, user, user2, wethOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     let signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrowMany(
    //       [weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidLength");
  
    //     signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [weth, weth],
    //       [amountToBorrow],
    //       user2,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrowMany(
    //       [weth, weth],
    //       [amountToBorrow],
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidLength");
  
    //     signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [],
    //       [],
    //       user2,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrowMany(
    //       [],
    //       [],
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidLength");
    //   });
  
    //   it("Should NOT borrow many if contains non-asset tokens", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, eurc, mpc_signer, user, user2, wethOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [weth, eurc],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrowMany(
    //       [weth, eurc],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidBorrowToken");
    //   });
  
    //   it("Should NOT borrow and swap many if contains non-asset tokens", async function () {
    //     const {
    //       wethLiquidityPool, weth, WETH_DEC, eurc, mpc_signer, user, user2, wethOwner, liquidityAdmin
    //     } = await loadFixture(deployAll);
    //     const amountLiquidity = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amountLiquidity);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     const amountToBorrow = 2n * WETH_DEC;
    //     const signature = await signBorrowMany(
    //       mpc_signer,
    //       wethLiquidityPool,
    //       user,
    //       [eurc, weth],
    //       [amountToBorrow, amountToBorrow],
    //       user2,
    //       "0x",
    //       31337
    //     );
  
    //     await expect(wethLiquidityPool.connect(user).borrowAndSwapMany(
    //       [eurc, weth],
    //       [amountToBorrow, amountToBorrow],
    //       {fillToken: eurc, fillAmount: 0n, swapData: "0x"},
    //       user2,
    //       "0x",
    //       0n,
    //       2000000000n,
    //       signature))
    //     .to.be.revertedWithCustomError(wethLiquidityPool, "InvalidBorrowToken");
    //   });
  
    //   it("Should NOT withdraw liquidity if not enough on contract", async function () {
    //     const {wethLiquidityPool, weth, WETH_DEC, wethOwner, user, liquidityAdmin} = await loadFixture(deployAll);
    //     const amount = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amount);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amount))
    //       .to.emit(wethLiquidityPool, "Deposit");
  
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).withdraw(user.address, amount * 2n))
    //       .to.be.reverted;
    //   });
  
    //   it("Should NOT withdraw profit as liquidity", async function () {
    //     const {wethLiquidityPool, weth, WETH_DEC, wethOwner, user, liquidityAdmin} = await loadFixture(deployAll);
    //     const amount = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amount);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amount - 1n))
    //       .to.emit(wethLiquidityPool, "Deposit");
    //     expect(await wethLiquidityPool.totalDeposited()).to.eq(amount - 1n);
  
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).withdraw(user.address, amount))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "InsufficientLiquidity");
    //   });
  
    //   it("Should NOT withdraw liquidity if the contract is paused", async function () {
    //     const {wethLiquidityPool, user, liquidityAdmin, pauser} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(pauser).pause())
    //       .to.emit(wethLiquidityPool, "Paused");
  
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).withdraw(user.address, 10))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "EnforcedPause");
    //   });
  
    //   it("Should NOT withdraw liquidity to zero address", async function () {
    //     const {wethLiquidityPool, liquidityAdmin} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).withdraw(ZERO_ADDRESS, 10))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "ZeroAddress()");
    //   });
  
    //   it("Should NOT withdraw profit if the contract is paused", async function () {
    //     const {wethLiquidityPool, user, weth, withdrawProfit, pauser} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(pauser).pause())
    //       .to.emit(wethLiquidityPool, "Paused");
    //     await expect(wethLiquidityPool.connect(withdrawProfit).withdrawProfit([weth.target], user.address))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "EnforcedPause");
    //   });
  
    //   it("Should NOT withdraw profit to zero address", async function () {
    //     const {wethLiquidityPool, weth, withdrawProfit} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(withdrawProfit).withdrawProfit([weth.target], ZERO_ADDRESS))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "ZeroAddress()");
    //   });
  
    //   it("Should revert during withdrawing profit if no profit", async function () {
    //     const {wethLiquidityPool, weth, withdrawProfit, user} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(withdrawProfit).withdrawProfit([weth.target], user.address))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "NoProfit()");
    //   });
    // });
  
    // describe("Roles and admin functions", function () {
    //   it("Should allow admin to set MPC address", async function () {
    //     const {wethLiquidityPool, admin, user} = await loadFixture(deployAll);
    //     const oldMPCAddress = await wethLiquidityPool.mpcAddress();
    //     await expect(wethLiquidityPool.connect(admin).setMPCAddress(user.address))
    //       .to.emit(wethLiquidityPool, "MPCAddressSet").withArgs(oldMPCAddress, user.address);
    //     expect(await wethLiquidityPool.mpcAddress())
    //       .to.eq(user.address);
    //   });
  
    //   it("Should NOT allow others to set MPC address", async function () {
    //     const {wethLiquidityPool, user} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(user).setMPCAddress(user.address))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "AccessControlUnauthorizedAccount");
    //   });
  
    //   it("Should allow WITHDRAW_PROFIT_ROLE to pause and unpause borrowing", async function () {
    //     const {wethLiquidityPool, withdrawProfit} = await loadFixture(deployAll);
    //     expect(await wethLiquidityPool.borrowPaused())
    //       .to.eq(false);
    //     await expect(wethLiquidityPool.connect(withdrawProfit).pauseBorrow())
    //       .to.emit(wethLiquidityPool, "BorrowPaused");
    //     expect(await wethLiquidityPool.borrowPaused())
    //       .to.eq(true);
    //     await expect(wethLiquidityPool.connect(withdrawProfit).unpauseBorrow())
    //       .to.emit(wethLiquidityPool, "BorrowUnpaused");
    //     expect(await wethLiquidityPool.borrowPaused())
    //       .to.eq(false);
    //   });
  
    //   it("Should NOT allow others to pause and unpause borrowing", async function () {
    //     const {wethLiquidityPool, admin} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(admin).pauseBorrow())
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "AccessControlUnauthorizedAccount");
    //   });
  
    //   it("Should allow WITHDRAW_PROFIT_ROLE to withdraw profit", async function () {
    //     const {
    //       wethLiquidityPool, eurc, EURC_DEC, eurcOwner, withdrawProfit, user
    //     } = await loadFixture(deployAll);
    //     const amountUni = 1n * EURC_DEC;
    //     await eurc.connect(eurcOwner).transfer(wethLiquidityPool, amountUni);
    //     await expect(wethLiquidityPool.connect(withdrawProfit).withdrawProfit([eurc.target], user.address))
    //       .to.emit(wethLiquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountUni);
    //     expect(await eurc.balanceOf(user.address)).to.eq(amountUni);
    //   });
  
    //   it("Should NOT allow others to withdraw profit", async function () {
    //     const {wethLiquidityPool, eurc, user} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(user).withdrawProfit([eurc.target], user.address))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "AccessControlUnauthorizedAccount");
    //   });
  
    //   it("Should allow LIQUIDITY_ADMIN_ROLE to deposit liquidity", async function () {
    //     const {wethLiquidityPool, weth, wethOwner, WETH_DEC, liquidityAdmin} = await loadFixture(deployAll);
    //     const amount = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amount);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amount))
    //       .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amount);
    //     expect(await wethLiquidityPool.totalDeposited()).to.eq(amount);
    //   });
  
    //   it("Should NOT allow others to deposit liquidity", async function () {
    //     const {wethLiquidityPool, weth, wethOwner, WETH_DEC, user} = await loadFixture(deployAll);
    //     const amount = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amount);
    //     await expect(wethLiquidityPool.connect(user).deposit(amount))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "AccessControlUnauthorizedAccount");
    //   });
  
    //   it("Should allow LIQUIDITY_ADMIN_ROLE to withdraw liquidity", async function () {
    //     const {wethLiquidityPool, weth, wethOwner, WETH_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
    //     const amount = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amount);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amount))
    //       .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amount);
  
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).withdraw(user.address, amount))
    //       .to.emit(wethLiquidityPool, "Withdraw").withArgs(liquidityAdmin, user.address, amount);
  
    //     expect(await weth.balanceOf(user.address)).to.be.eq(amount);
    //     expect(await wethLiquidityPool.totalDeposited()).to.be.eq(0);
    //     expect(await wethLiquidityPool.balance(weth)).to.eq(0);
    //   });
  
    //   it("Should NOT allow others to withdraw liquidity", async function () {
    //     const {wethLiquidityPool, weth, wethOwner, WETH_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
    //     const amount = 100n * WETH_DEC;
    //     await weth.connect(wethOwner).transfer(wethLiquidityPool, amount);
    //     await expect(wethLiquidityPool.connect(liquidityAdmin).deposit(amount))
    //       .to.emit(wethLiquidityPool, "Deposit").withArgs(liquidityAdmin, amount);
  
    //     await expect(wethLiquidityPool.connect(user).withdraw(user.address, amount * 2n))
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "AccessControlUnauthorizedAccount");
    //   });
  
    //   it("Should allow PAUSER_ROLE to pause and unpause the contract", async function () {
    //     const {wethLiquidityPool, pauser} = await loadFixture(deployAll);
    //     expect(await wethLiquidityPool.paused())
    //       .to.eq(false);
    //     await expect(wethLiquidityPool.connect(pauser).pause())
    //       .to.emit(wethLiquidityPool, "Paused");
    //     expect(await wethLiquidityPool.paused())
    //       .to.eq(true);
    //     await expect(wethLiquidityPool.connect(pauser).unpause())
    //       .to.emit(wethLiquidityPool, "Unpaused");
    //     expect(await wethLiquidityPool.paused())
    //       .to.eq(false);
    //   });
  
    //   it("Should NOT allow others to pause and unpause the contract", async function () {
    //     const {wethLiquidityPool, admin} = await loadFixture(deployAll);
    //     await expect(wethLiquidityPool.connect(admin).pause())
    //       .to.be.revertedWithCustomError(wethLiquidityPool, "AccessControlUnauthorizedAccount");
    //   });
    });
  });
  