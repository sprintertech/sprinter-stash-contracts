import {
  loadFixture, time, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, signBorrow, signBorrowMany, getBalance,
} from "./helpers";
import {ZERO_ADDRESS, NATIVE_TOKEN, ETH} from "../scripts/common";
import {encodeBytes32String, AbiCoder, hashMessage, concat, resolveAddress, Signature} from "ethers";
import {
  MockTarget, MockBorrowSwap, PublicLiquidityPool, MockSignerTrue, MockSignerFalse
} from "../typechain-types";
import {networkConfig} from "../network.config";

async function now() {
  return BigInt(await time.latest());
}

const ERC4626Deposit = "deposit(uint256,address)";
const ERC4626Withdraw = "withdraw(uint256,address,address)";
const ERC4626DepositEvent = "Deposit(address,address,uint256,uint256)";
const ERC4626WithdrawEvent = "Withdraw(address,address,address,uint256,uint256)";

function addAmountToReceive(callData: string, amountToReceive: bigint) {
  return concat([
    callData,
    AbiCoder.defaultAbiCoder().encode(
      ["uint256"],
      [amountToReceive]
    )
  ]);
}

describe("PublicLiquidityPool", function () {
  const deployAll = async () => {
    const [
      deployer, admin, user, user2, mpc_signer, feeSetter, withdrawProfit, pauser, lp,
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

    const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
    const WETH_OWNER_ADDRESS = process.env.WETH_OWNER_ADDRESS!;
    if (!WETH_OWNER_ADDRESS) throw new Error("Env variables not configured (WETH_OWNER_ADDRESS missing)");
    const weth = await hre.ethers.getContractAt("ERC20", WETH_ADDRESS);
    const wethOwner = await hre.ethers.getImpersonatedSigner(WETH_OWNER_ADDRESS);

    const USDC_DEC = 10n ** (await usdc.decimals());
    const GHO_DEC = 10n ** (await gho.decimals());
    const EURC_DEC = 10n ** (await eurc.decimals());
    const WETH_DEC = 10n ** (await weth.decimals());

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
        usdc, admin, mpc_signer, networkConfig.BASE.WrappedNativeToken, mockSignerTrue,
        "Public Liquidity Pool", "PLP", 2000
      )
    ) as PublicLiquidityPool;

    const FEE_SETTER_ROLE = encodeBytes32String("FEE_SETTER_ROLE");
    await liquidityPool.connect(admin).grantRole(FEE_SETTER_ROLE, feeSetter);

    const WITHDRAW_PROFIT_ROLE = encodeBytes32String("WITHDRAW_PROFIT_ROLE");
    await liquidityPool.connect(admin).grantRole(WITHDRAW_PROFIT_ROLE, withdrawProfit);

    const PAUSER_ROLE = encodeBytes32String("PAUSER_ROLE");
    await liquidityPool.connect(admin).grantRole(PAUSER_ROLE, pauser);

    return {deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, gho, ghoOwner, eurc, eurcOwner,
      liquidityPool, mockTarget, mockBorrowSwap, USDC_DEC, GHO_DEC, EURC_DEC, WETH_DEC, weth, wethOwner,
      feeSetter, withdrawProfit, pauser, mockSignerTrue, mockSignerFalse, lp};
  };

  describe("Initialization", function () {
    it("Should initialize the contract with correct values", async function () {
      const {liquidityPool, usdc, mpc_signer, mockSignerTrue, USDC_DEC, user} = await loadFixture(deployAll);
      expect(await liquidityPool.ASSETS())
        .to.be.eq(usdc.target);
      expect(await liquidityPool.mpcAddress())
        .to.be.eq(mpc_signer);
      expect(await liquidityPool.signerAddress())
        .to.be.eq(mockSignerTrue);
      expect(await liquidityPool.protocolFeeRate())
        .to.be.eq(2000);
      expect(await liquidityPool.protocolFee())
        .to.be.eq(0);
      expect(await liquidityPool.totalAssets())
        .to.be.eq(0);
      await expect(liquidityPool["deposit(uint256)"](
        1000n * USDC_DEC
      )).to.be.revertedWithCustomError(liquidityPool, "NotImplemented");
      await expect(liquidityPool.depositWithPull(
        1000n * USDC_DEC
      )).to.be.revertedWithCustomError(liquidityPool, "NotImplemented");
      await expect(liquidityPool["withdraw(address,uint256)"](
        user,
        1000n * USDC_DEC
      )).to.be.revertedWithCustomError(liquidityPool, "NotImplemented");
    });

    it("Should NOT deploy the contract if liquidity token address is 0", async function () {
      const {deployer, liquidityPool, admin, mpc_signer, mockSignerTrue} = await loadFixture(deployAll);
      await expect(deploy("PublicLiquidityPool", deployer, {},
        ZERO_ADDRESS, admin, mpc_signer, networkConfig.BASE.WrappedNativeToken, mockSignerTrue,
        "Public Liquidity Pool", "PLP", 2000
      )).to.be.revertedWithCustomError(liquidityPool, "ZeroAddress");
    });

    it("Should NOT deploy the contract if admin address is 0", async function () {
      const {deployer, liquidityPool, usdc, mpc_signer, mockSignerTrue} = await loadFixture(deployAll);
      await expect(deploy("PublicLiquidityPool", deployer, {},
        usdc, ZERO_ADDRESS, mpc_signer, networkConfig.BASE.WrappedNativeToken, mockSignerTrue,
        "Public Liquidity Pool", "PLP", 2000
      )).to.be.revertedWithCustomError(liquidityPool, "ZeroAddress");
    });

    it("Should NOT deploy the contract if MPC address is 0", async function () {
      const {deployer, liquidityPool, usdc, admin, mockSignerTrue} = await loadFixture(deployAll);
      await expect(deploy("PublicLiquidityPool", deployer, {},
        usdc, admin, ZERO_ADDRESS, networkConfig.BASE.WrappedNativeToken, mockSignerTrue,
        "Public Liquidity Pool", "PLP", 2000
      )).to.be.revertedWithCustomError(liquidityPool, "ZeroAddress");
    });

    it("Should NOT deploy the contract if signer address is 0", async function () {
      const {deployer, liquidityPool, usdc, admin, mpc_signer} = await loadFixture(deployAll);
      await expect(deploy("PublicLiquidityPool", deployer, {},
        usdc, admin, mpc_signer, networkConfig.BASE.WrappedNativeToken, ZERO_ADDRESS,
        "Public Liquidity Pool", "PLP", 2000
      )).to.be.revertedWithCustomError(liquidityPool, "ZeroAddress");
    });

    it("Should NOT deploy the contract if protocol fee rate is greater than 10000", async function () {
      const {deployer, liquidityPool, usdc, admin, mpc_signer, mockSignerTrue} = await loadFixture(deployAll);
      await expect(deploy("PublicLiquidityPool", deployer, {},
        usdc, admin, mpc_signer, networkConfig.BASE.WrappedNativeToken, mockSignerTrue,
        "Public Liquidity Pool", "PLP", 10001
      )).to.be.revertedWithCustomError(liquidityPool, "InvalidProtocolFeeRate");
    });
  });

  describe("Borrow, supply, withdraw", function () {
    it("Should deposit to the pool", async function () {
      const {liquidityPool, usdc, USDC_DEC, lp} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amount);
      await expect(liquidityPool.connect(lp)[ERC4626Deposit](amount, lp))
        .to.emit(liquidityPool, ERC4626DepositEvent).withArgs(lp, lp, amount, amount);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amount);
      expect(await liquidityPool.totalSupply()).to.eq(amount);
      expect(await liquidityPool.balance(usdc)).to.eq(amount);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amount);
    });

    it("Should deposit to the pool multiple times", async function () {
      const {liquidityPool, usdc, user, user2, usdcOwner, USDC_DEC, lp} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      const amount2 = 2000n * USDC_DEC;
      const amount3 = 3000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(user, 5000n * USDC_DEC);
      await usdc.connect(lp).approve(liquidityPool, amount + amount2);
      await usdc.connect(user).approve(liquidityPool, 5000n * USDC_DEC);
      await expect(liquidityPool.connect(lp)[ERC4626Deposit](amount, lp))
        .to.emit(liquidityPool, ERC4626DepositEvent).withArgs(lp, lp, amount, amount);
      expect(await liquidityPool.totalAssets()).to.eq(amount);
      expect(await liquidityPool.totalSupply()).to.eq(amount);
      expect(await liquidityPool.balance(usdc)).to.eq(amount);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amount);
      expect(await liquidityPool.balanceOf(user)).to.eq(0);
      expect(await liquidityPool.balanceOf(user2)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amount);
      expect(await usdc.balanceOf(user)).to.eq(5000n * USDC_DEC);
      expect(await usdc.balanceOf(user2)).to.eq(0n);
      await expect(liquidityPool.connect(lp)[ERC4626Deposit](amount2, user2))
        .to.emit(liquidityPool, ERC4626DepositEvent).withArgs(lp, user2, amount2, amount2);
      expect(await liquidityPool.totalAssets()).to.eq(amount + amount2);
      expect(await liquidityPool.totalSupply()).to.eq(amount + amount2);
      expect(await liquidityPool.balance(usdc)).to.eq(amount + amount2);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amount);
      expect(await liquidityPool.balanceOf(user)).to.eq(0);
      expect(await liquidityPool.balanceOf(user2)).to.eq(amount2);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amount + amount2);
      expect(await usdc.balanceOf(user)).to.eq(5000n * USDC_DEC);
      expect(await usdc.balanceOf(user2)).to.eq(0n);
      await expect(liquidityPool.connect(user)[ERC4626Deposit](amount3, user))
        .to.emit(liquidityPool, ERC4626DepositEvent).withArgs(user, user, amount3, amount3);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amount + amount2 + amount3);
      expect(await liquidityPool.totalSupply()).to.eq(amount + amount2 + amount3);
      expect(await liquidityPool.balance(usdc)).to.eq(amount + amount2 + amount3);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amount);
      expect(await liquidityPool.balanceOf(user)).to.eq(amount3);
      expect(await liquidityPool.balanceOf(user2)).to.eq(amount2);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amount + amount2 + amount3);
      expect(await usdc.balanceOf(user)).to.eq(2000n * USDC_DEC);
      expect(await usdc.balanceOf(user2)).to.eq(0n);
    });

    it("Should deposit to the pool by minting", async function () {
      const {liquidityPool, usdc, USDC_DEC, lp} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amount);
      await expect(liquidityPool.connect(lp).mint(amount, lp))
        .to.emit(liquidityPool, ERC4626DepositEvent).withArgs(lp, lp, amount, amount);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amount);
      expect(await liquidityPool.totalSupply()).to.eq(amount);
      expect(await liquidityPool.balance(usdc)).to.eq(amount);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amount);
    });

    it("Should deposit to the pool with permit", async function () {
      const {liquidityPool, usdc, user, USDC_DEC, lp} = await loadFixture(deployAll);

      const domain = {
        name: "USD Coin",
        version: "2",
        chainId: hre.network.config.chainId,
        verifyingContract: await resolveAddress(usdc),
      };

      const types = {
        Permit: [
          {name: "owner", type: "address"},
          {name: "spender", type: "address"},
          {name: "value", type: "uint256"},
          {name: "nonce", type: "uint256"},
          {name: "deadline", type: "uint256"},
        ],
      };

      const amount = 1000n * USDC_DEC;
      const permitSig = Signature.from(await lp.signTypedData(domain, types, {
        owner: lp.address,
        spender: liquidityPool.target,
        value: amount,
        nonce: 0n,
        deadline: 2000000000n,
      }));
      const tx = liquidityPool.connect(lp).depositWithPermit(
        amount,
        user,
        2000000000n,
        permitSig.v,
        permitSig.r,
        permitSig.s,
      );
      await expect(tx).to.emit(liquidityPool, ERC4626DepositEvent).withArgs(lp, user, amount, amount);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amount);
      expect(await liquidityPool.totalSupply()).to.eq(amount);
      expect(await liquidityPool.balance(usdc)).to.eq(amount);
      expect(await liquidityPool.balanceOf(lp)).to.eq(0);
      expect(await liquidityPool.balanceOf(user)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amount);
    });

    it("Should NOT inflate the pool by donation", async function () {
      const {liquidityPool, usdc, USDC_DEC, lp} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).transfer(liquidityPool, amount);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(0);
      expect(await liquidityPool.totalSupply()).to.eq(0);
      expect(await liquidityPool.balance(usdc)).to.eq(amount);
      expect(await liquidityPool.balanceOf(lp)).to.eq(0);
    });

    it("Should borrow a token with contract call", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, user, mpc_signer, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 3n * USDC_DEC;
      const fee = 2n * USDC_DEC;
      const protocolFee = fee / 5n;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = amountToReceive;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToReceive);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToReceive);
      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity + fee - protocolFee);
      expect(await liquidityPool.protocolFee()).to.eq(protocolFee);
      expect(await liquidityPool.totalSupply()).to.eq(amountLiquidity);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity - amountToReceive);
    });

    it("Should borrow a token with swap", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, eurc, EURC_DEC, eurcOwner, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 3n * USDC_DEC;
      const fee = 2n * USDC_DEC;
      const protocolFee = fee / 5n;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = 2n * EURC_DEC;
      await eurc.connect(eurcOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc,
        amountToBorrow,
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToReceive);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToReceive);
      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(0);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(0);
      expect(await eurc.balanceOf(mockTarget)).to.eq(fillAmount);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity + fee - protocolFee);
      expect(await liquidityPool.protocolFee()).to.eq(protocolFee);
      expect(await liquidityPool.totalSupply()).to.eq(amountLiquidity);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity - amountToReceive);
    });

    it("Should borrow a token with swap and native fill", async function () {
      // USDC is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, mockBorrowSwap, weth, usdc,
        user, mpc_signer, lp, USDC_DEC, wethOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 10n * USDC_DEC;
      const fee = 2n * USDC_DEC;
      const protocolFee = fee / 5n;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = 1n * ETH;
      await weth.connect(wethOwner).approve(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);
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
        callDataWithAmountToReceive,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc,
        amountToBorrow,
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrowBubbleRevert(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await weth.balanceOf(mockBorrowSwap)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToReceive);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToReceive);
      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity + fee - protocolFee);
      expect(await liquidityPool.protocolFee()).to.eq(protocolFee);
      expect(await liquidityPool.totalSupply()).to.eq(amountLiquidity);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity - amountToReceive);
      expect(await getBalance(liquidityPool)).to.eq(0);
      expect(await getBalance(mockTarget)).to.eq(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.eq(0);
    });

    it("Should revert borrow if swap with native fill returned insufficient amount", async function () {
      // USDC is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, lp, wethOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 10n * USDC_DEC;
      const fee = 2n * USDC_DEC;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = 1n * ETH;
      await weth.connect(wethOwner).transfer(mockBorrowSwap, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [ZERO_ADDRESS, fillAmount - 1n]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc,
        amountToBorrow,
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrowBubbleRevert(
        liquidityPool, borrowCalldata.data
      )).to.be.revertedWithCustomError(liquidityPool, "InsufficientSwapResult");
    });

    it("Should borrow with swap with native fill if returned extra amount", async function () {
      // USDC is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, lp, wethOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 10n * USDC_DEC;
      const fee = 2n * USDC_DEC;
      const protocolFee = fee / 5n;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = 1n * ETH;
      const returnedAmount = fillAmount + 1n;
      await weth.connect(wethOwner).transfer(mockBorrowSwap, returnedAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(NATIVE_TOKEN, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [ZERO_ADDRESS, returnedAmount]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc,
        amountToBorrow,
        {fillToken: NATIVE_TOKEN, fillAmount, swapData},
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await weth.balanceOf(mockBorrowSwap)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToReceive);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToReceive);
      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity + fee - protocolFee);
      expect(await liquidityPool.protocolFee()).to.eq(protocolFee);
      expect(await liquidityPool.totalSupply()).to.eq(amountLiquidity);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity - amountToReceive);
      expect(await getBalance(liquidityPool)).to.eq(returnedAmount - fillAmount);
      expect(await getBalance(mockTarget)).to.eq(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.eq(0);
      expect(await liquidityPool.balance(weth)).to.eq(0);
      expect(await liquidityPool.balance(NATIVE_TOKEN)).to.eq(0);
    });

    it("Should NOT borrow many tokens", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, user, mpc_signer, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 3n * USDC_DEC;
      const amountToBorrow2 = 4n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow2, additionalData);

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [usdc, usdc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, usdc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature)
      ).to.be.revertedWithCustomError(liquidityPool, "NotImplemented");
    });

    it("Should NOT borrow many tokens with swap", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, eurc, EURC_DEC, eurcOwner, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 3n * USDC_DEC;
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
        [usdc],
        [amountToBorrow],
        mockTarget,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [usdc],
        [amountToBorrow],
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

    it("Should deposit when the contract is paused", async function () {
      const {liquidityPool, pauser, usdc, usdcOwner, USDC_DEC, lp} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);
      await usdc.connect(usdcOwner).approve(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(usdcOwner)[ERC4626Deposit](amountLiquidity, usdcOwner))
        .to.emit(liquidityPool, ERC4626DepositEvent).withArgs(usdcOwner, usdcOwner, amountLiquidity, amountLiquidity);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity + amountLiquidity);
      expect(await liquidityPool.totalSupply()).to.eq(amountLiquidity + amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity + amountLiquidity);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amountLiquidity);
      expect(await liquidityPool.balanceOf(usdcOwner)).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity + amountLiquidity);
    });

    it("Should withdraw liquidity", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, lp
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amount);
      await liquidityPool.connect(lp)[ERC4626Deposit](amount, lp);
      await expect(liquidityPool.connect(lp)[ERC4626Withdraw](amount, user, lp))
        .to.emit(liquidityPool, ERC4626WithdrawEvent).withArgs(lp, user, lp, amount, amount);
      expect(await usdc.balanceOf(user)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.balance(usdc)).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(0);
      expect(await liquidityPool.totalSupply()).to.eq(0);
    });

    it("Should withdraw liquidity by redeeming", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, lp
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amount);
      await liquidityPool.connect(lp)[ERC4626Deposit](amount, lp);
      await expect(liquidityPool.connect(lp).redeem(amount, user, lp))
        .to.emit(liquidityPool, ERC4626WithdrawEvent).withArgs(lp, user, lp, amount, amount);
      expect(await usdc.balanceOf(user)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.balance(usdc)).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(0);
      expect(await liquidityPool.totalSupply()).to.eq(0);
    });

    it("Should withdraw liquidity from another user", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, lp
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amount);
      await liquidityPool.connect(lp)[ERC4626Deposit](amount, lp);
      await liquidityPool.connect(lp).approve(user, amount);
      await expect(liquidityPool.connect(user)[ERC4626Withdraw](amount, user, lp))
        .to.emit(liquidityPool, ERC4626WithdrawEvent).withArgs(user, user, lp, amount, amount);
      expect(await usdc.balanceOf(user)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.balance(usdc)).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(0);
      expect(await liquidityPool.totalSupply()).to.eq(0);
    });

    it("Should withdraw liquidity by redeeming from another user", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, lp
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amount);
      await liquidityPool.connect(lp)[ERC4626Deposit](amount, lp);
      await liquidityPool.connect(lp).approve(user, amount);
      await expect(liquidityPool.connect(user).redeem(amount, user, lp))
        .to.emit(liquidityPool, ERC4626WithdrawEvent).withArgs(user, user, lp, amount, amount);
      expect(await usdc.balanceOf(user)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.balance(usdc)).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(0);
      expect(await liquidityPool.totalSupply()).to.eq(0);
    });

    it("Should share profits from borrowing with depositors", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, user, user2, mpc_signer, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      const amountLiquidity2 = 3000n * USDC_DEC;
      const totalLiquidity = amountLiquidity + amountLiquidity2;
      await usdc.connect(lp).approve(liquidityPool, 4000n * USDC_DEC);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity2, user);

      const amountToBorrow = 100n * USDC_DEC;
      const fee = 20n * USDC_DEC;
      const protocolFee = 4n * USDC_DEC;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = amountToReceive;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(totalLiquidity - amountToReceive);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToReceive);
      expect(await usdc.balanceOf(user)).to.eq(0);
      expect(await usdc.balanceOf(user2)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(totalLiquidity + fee - protocolFee);
      expect(await liquidityPool.protocolFee()).to.eq(protocolFee);
      expect(await liquidityPool.totalSupply()).to.eq(totalLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(totalLiquidity - amountToReceive);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amountLiquidity);
      expect(await liquidityPool.balanceOf(user2)).to.eq(0);
      expect(await liquidityPool.balanceOf(user)).to.eq(amountLiquidity2);

      await expect(liquidityPool.connect(lp).redeem(amountLiquidity, user2, lp))
        .to.emit(liquidityPool, ERC4626WithdrawEvent).withArgs(lp, user2, lp, 1004n * USDC_DEC, amountLiquidity);
      await expect(liquidityPool.connect(user).redeem(1000n * USDC_DEC, user, user))
        .to.emit(liquidityPool, ERC4626WithdrawEvent).withArgs(user, user, user, 1004n * USDC_DEC, 1000n * USDC_DEC);
      await expect(liquidityPool.connect(user)[ERC4626Withdraw](1004n * USDC_DEC, user, user))
        .to.emit(liquidityPool, ERC4626WithdrawEvent).withArgs(user, user, user, 1004n * USDC_DEC, 1000n * USDC_DEC);

      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(908n * USDC_DEC);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToReceive);
      expect(await usdc.balanceOf(user)).to.eq(2008n * USDC_DEC);
      expect(await usdc.balanceOf(user2)).to.eq(1004n * USDC_DEC);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(1004n * USDC_DEC);
      expect(await liquidityPool.protocolFee()).to.eq(protocolFee);
      expect(await liquidityPool.totalSupply()).to.eq(1000n * USDC_DEC);
      expect(await liquidityPool.balance(usdc)).to.eq(908n * USDC_DEC);
      expect(await liquidityPool.balanceOf(lp)).to.eq(0);
      expect(await liquidityPool.balanceOf(user2)).to.eq(0);
      expect(await liquidityPool.balanceOf(user)).to.eq(1000n * USDC_DEC);

      await usdc.connect(user2).approve(liquidityPool, 502n * USDC_DEC);
      await liquidityPool.connect(user2)[ERC4626Deposit](502n * USDC_DEC, user2);

      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(1410n * USDC_DEC);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToReceive);
      expect(await usdc.balanceOf(user)).to.eq(2008n * USDC_DEC);
      expect(await usdc.balanceOf(user2)).to.eq(502n * USDC_DEC);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(1506n * USDC_DEC);
      expect(await liquidityPool.protocolFee()).to.eq(protocolFee);
      expect(await liquidityPool.totalSupply()).to.eq(1500n * USDC_DEC);
      expect(await liquidityPool.balance(usdc)).to.eq(1410n * USDC_DEC);
      expect(await liquidityPool.balanceOf(lp)).to.eq(0);
      expect(await liquidityPool.balanceOf(user2)).to.eq(500n * USDC_DEC);
      expect(await liquidityPool.balanceOf(user)).to.eq(1000n * USDC_DEC);
    });

    it("Should withdraw profit for multiple tokens from the pool", async function () {
      const {
        liquidityPool, eurc, gho, EURC_DEC, GHO_DEC, eurcOwner, ghoOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountEurc = 1n * EURC_DEC;
      const amountGho = 1n * GHO_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEurc);
      await gho.connect(ghoOwner).transfer(liquidityPool, amountGho);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc, gho], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc, user, amountEurc)
        .and.to.emit(liquidityPool, "ProfitWithdrawn").withArgs(gho, user, amountGho);
      expect(await eurc.balanceOf(user)).to.eq(amountEurc);
      expect(await gho.balanceOf(user)).to.eq(amountGho);
    });

    it("Should withdraw donated liquidity as profit from the pool", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, withdrawProfit, lp, user
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);
      const amountProfit = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountProfit);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity + amountProfit);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(usdc, user, amountProfit);
      expect(await usdc.balanceOf(user)).to.eq(amountProfit);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity);
    });

    it("Should withdraw all available balance as profit", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(usdc, user, amount);
      expect(await usdc.balanceOf(user)).to.eq(amount);
      expect(await liquidityPool.balance(usdc)).to.eq(0);
    });

    it("Should withdraw all native balance as profit", async function () {
      const {
        admin, liquidityPool, weth, WETH_DEC,
        withdrawProfit, user
      } = await loadFixture(deployAll);
      const amount = 2n * WETH_DEC;
      await admin.sendTransaction({to: liquidityPool, value: amount});
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([weth], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(weth, user, amount);
      expect(await weth.balanceOf(user)).to.eq(amount);
      expect(await liquidityPool.balance(weth)).to.eq(0);
    });

    it("Should return 0 for balance of other tokens", async function () {
      const {
        liquidityPool, eurc, EURC_DEC, eurcOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountLiquidity);
      expect(await liquidityPool.balance(eurc)).to.eq(0);
    });

    it("Should NOT borrow other tokens", async function () {
      const {
        liquidityPool, eurc, EURC_DEC, user, mpc_signer, user2, eurcOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountLiquidity);

      const amountToBorrow = 2n * EURC_DEC;
      const callData = addAmountToReceive("0x", amountToBorrow);
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        user2,
        callData,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        user2,
        callData,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidBorrowToken");
    });

    it("Should NOT borrow if MPC signature is wrong", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 2n * USDC_DEC;

      const signature = await signBorrow(
        user,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        user2,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc,
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
        liquidityPool, usdc, USDC_DEC, user, user2, mpc_signer, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 2n * USDC_DEC;
      const callData = addAmountToReceive("0x", amountToBorrow);
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        user2,
        callData,
        31337
      );

      await liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        user2,
        callData,
        0n,
        2000000000n,
        signature);
      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        user2,
        callData,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "NonceAlreadyUsed");
    });

    it("Should NOT borrow if MPC signature is expired", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, mpc_signer, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 2n * USDC_DEC;
      const deadline = (await now()) - 1n;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        user2,
        "0x",
        31337,
        0n,
        deadline,
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        deadline,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "ExpiredSignature");
    });

    it("Should NOT borrow if target call fails", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, user, mpc_signer, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 2n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToBorrow);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        usdc,
        callDataWithAmountToReceive,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        usdc,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TargetCallFailed");
    });

    it("Should NOT borrow if borrowing is paused", async function () {
      const {liquidityPool, user, user2, withdrawProfit, mpc_signer, usdc, USDC_DEC} = await loadFixture(deployAll);

      // Pause borrowing
      await expect(liquidityPool.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPool, "BorrowPaused");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        user2,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "BorrowingIsPaused");
    });

    it("Should NOT borrow if the contract is paused", async function () {
      const {liquidityPool, usdc, user, user2, pauser} = await loadFixture(deployAll);

      // Pause the contract
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(user).borrow(
        usdc,
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
        liquidityPool, usdc, USDC_DEC, user, user2, lp, mpc_signer,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        user2,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user2).borrow(
        usdc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow and swap if MPC signature is wrong (caller is wrong)", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, eurc, EURC_DEC, eurcOwner, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

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
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        mockTarget,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc,
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
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, eurc, EURC_DEC, eurcOwner, lp
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToBorrow);
      const swapData = AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [eurcOwner.address]
      );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        mockBorrowSwap,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwap.populateTransaction(
        usdc,
        amountToBorrow,
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature
      );

      // No EURC tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT borrow and swap other token", async function () {
      const {
        liquidityPool, eurc, EURC_DEC, mpc_signer, user, eurcOwner,
        mockTarget,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountLiquidity);

      const amountToBorrow = 2n * EURC_DEC;
      const callData = addAmountToReceive("0x", amountToBorrow);
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        mockTarget,
        callData,
        31337
      );

      await expect(liquidityPool.connect(user).borrowAndSwap(
        eurc,
        amountToBorrow,
        {fillToken: eurc, fillAmount: 0n, swapData: "0x"},
        mockTarget,
        callData,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidBorrowToken");
    });

    it("Should NOT withdraw liquidity if not enough on contract", async function () {
      const {liquidityPool, usdc, USDC_DEC, user, lp, mockTarget, mpc_signer} = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 3n * USDC_DEC;
      const fee = 2n * USDC_DEC;
      const protocolFee = fee / 5n;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = amountToReceive;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      await liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature
      );

      expect(await usdc.balanceOf(liquidityPool)).to.eq(999n * USDC_DEC);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity + fee - protocolFee);
      await expect(liquidityPool.connect(lp)[ERC4626Withdraw](amountLiquidity, user, lp))
        .to.be.reverted;
      await liquidityPool.connect(lp)[ERC4626Withdraw](999n * USDC_DEC, user, lp);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0n);
      expect(await usdc.balanceOf(user)).to.eq(999n * USDC_DEC);
      expect(await liquidityPool.totalAssets()).to.eq(1n * USDC_DEC + fee - protocolFee);
    });

    it("Should NOT withdraw donated profit as liquidity", async function () {
      const {liquidityPool, usdc, USDC_DEC, user, lp} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amount);
      await liquidityPool.connect(lp)[ERC4626Deposit](amount, lp);
      await usdc.connect(lp).transfer(liquidityPool, 1n);
      expect(await liquidityPool.totalAssets()).to.eq(amount);

      await expect(liquidityPool.connect(lp)[ERC4626Withdraw](amount + 1n, user, lp))
        .to.be.reverted;
    });

    it("Should NOT withdraw protocol fee as liquidity", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, lp, mockTarget, mpc_signer, withdrawProfit
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 3n * USDC_DEC;
      const fee = 2n * USDC_DEC;
      const protocolFee = fee / 5n;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = amountToReceive;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      await liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature
      );

      expect(await usdc.balanceOf(liquidityPool)).to.eq(999n * USDC_DEC);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity + fee - protocolFee);
      await usdc.connect(lp).transfer(liquidityPool, amountToBorrow);
      await expect(liquidityPool.connect(lp)[ERC4626Withdraw](amountLiquidity + fee, user, lp))
        .to.be.reverted;
      await liquidityPool.connect(lp).redeem(amountLiquidity, user, lp);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(protocolFee);
      expect(await usdc.balanceOf(user)).to.eq(amountLiquidity + fee - protocolFee);
      expect(await liquidityPool.totalAssets()).to.eq(0);
      await liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], withdrawProfit);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0);
      expect(await usdc.balanceOf(withdrawProfit)).to.eq(protocolFee);
    });

    it("Should NOT withdraw liquidity if the contract is paused", async function () {
      const {liquidityPool, user, lp, pauser, usdc, USDC_DEC} = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(lp)[ERC4626Withdraw](amountLiquidity, user, lp))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT withdraw liquidity to zero address", async function () {
      const {liquidityPool, lp} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(lp)[ERC4626Withdraw](0n, ZERO_ADDRESS, lp))
        .to.be.revertedWithCustomError(liquidityPool, "ZeroAddress()");
    });

    it("Should NOT withdraw profit if the contract is paused", async function () {
      const {liquidityPool, user, usdc, withdrawProfit, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT withdraw profit to zero address", async function () {
      const {liquidityPool, usdc, withdrawProfit} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPool, "ZeroAddress()");
    });

    it("Should revert during withdrawing profit if no profit", async function () {
      const {liquidityPool, usdc, withdrawProfit, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.be.revertedWithCustomError(liquidityPool, "NoProfit()");
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
      const {liquidityPool, admin, mockSignerTrue, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).setSignerAddress(user))
        .to.emit(liquidityPool, "SignerAddressSet")
        .withArgs(mockSignerTrue, user);
      const data = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const message = hashMessage(data);
      const signature = await user.signMessage(data);
      expect(await liquidityPool.isValidSignature(message, signature))
        .to.eq(MAGICVALUE);
    });

    it("Should NOT return MAGICVALUE if an EOA signature is invalid", async function () {
      const {liquidityPool, admin, mockSignerTrue, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(admin).setSignerAddress(user))
        .to.emit(liquidityPool, "SignerAddressSet")
        .withArgs(mockSignerTrue, user);
      const data = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
      const wrongData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeff";
      const wrongMessage = hashMessage(wrongData);
      const signature = await user.signMessage(data);
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

    it("Should allow admin to set signer address", async function () {
      const {liquidityPool, admin, user} = await loadFixture(deployAll);
      const oldSignerAddress = await liquidityPool.signerAddress();
      await expect(liquidityPool.connect(admin).setSignerAddress(user))
        .to.emit(liquidityPool, "SignerAddressSet").withArgs(oldSignerAddress, user.address);
      expect(await liquidityPool.signerAddress())
        .to.eq(user.address);
    });

    it("Should NOT allow others to set signer address", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).setSignerAddress(user))
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
      const amountEurc = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEurc);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([eurc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountEurc);
      expect(await eurc.balanceOf(user)).to.eq(amountEurc);
    });

    it("Should NOT allow others to withdraw profit", async function () {
      const {liquidityPool, eurc, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).withdrawProfit([eurc], user))
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

    it("Should allow FEE_SETTER_ROLE to set protocol fee rate", async function () {
      const {liquidityPool, feeSetter, USDC_DEC, lp, usdc, mockTarget, mpc_signer, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(feeSetter).setProtocolFeeRate(10 * 100))
        .to.emit(liquidityPool, "ProtocolFeeRateSet").withArgs(10 * 100);
      expect(await liquidityPool.protocolFeeRate()).to.eq(10 * 100);

      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 3n * USDC_DEC;
      const fee = 2n * USDC_DEC;
      const protocolFee = fee / 10n;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = amountToReceive;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToReceive);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToReceive);
      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity + fee - protocolFee);
      expect(await liquidityPool.protocolFee()).to.eq(protocolFee);
      expect(await liquidityPool.totalSupply()).to.eq(amountLiquidity);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity - amountToReceive);
    });

    it("Should allow FEE_SETTER_ROLE to set protocol fee rate to 0", async function () {
      const {liquidityPool, feeSetter, USDC_DEC, lp, usdc, mockTarget, mpc_signer, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(feeSetter).setProtocolFeeRate(0))
        .to.emit(liquidityPool, "ProtocolFeeRateSet").withArgs(0);
      expect(await liquidityPool.protocolFeeRate()).to.eq(0);

      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 3n * USDC_DEC;
      const fee = 2n * USDC_DEC;
      const protocolFee = 0n;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = amountToReceive;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToReceive);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToReceive);
      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity + fee - protocolFee);
      expect(await liquidityPool.protocolFee()).to.eq(protocolFee);
      expect(await liquidityPool.totalSupply()).to.eq(amountLiquidity);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity - amountToReceive);
    });

    it("Should allow FEE_SETTER_ROLE to set protocol fee rate to 100%", async function () {
      const {liquidityPool, feeSetter, USDC_DEC, lp, usdc, mockTarget, mpc_signer, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(feeSetter).setProtocolFeeRate(100 * 100))
        .to.emit(liquidityPool, "ProtocolFeeRateSet").withArgs(100 * 100);
      expect(await liquidityPool.protocolFeeRate()).to.eq(100 * 100);

      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(lp).approve(liquidityPool, amountLiquidity);
      await liquidityPool.connect(lp)[ERC4626Deposit](amountLiquidity, lp);

      const amountToBorrow = 3n * USDC_DEC;
      const fee = 2n * USDC_DEC;
      const protocolFee = fee;
      const amountToReceive = amountToBorrow - fee;
      const fillAmount = amountToReceive;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, fillAmount, additionalData);
      const callDataWithAmountToReceive = addAmountToReceive(callData.data, amountToReceive);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callDataWithAmountToReceive,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToReceive);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToReceive);
      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.totalAssets()).to.eq(amountLiquidity + fee - protocolFee);
      expect(await liquidityPool.protocolFee()).to.eq(protocolFee);
      expect(await liquidityPool.totalSupply()).to.eq(amountLiquidity);
      expect(await liquidityPool.balanceOf(lp)).to.eq(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity - amountToReceive);
    });

    it("Should NOT allow others to set protocol fee rate", async function () {
      const {liquidityPool, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).setProtocolFeeRate(10 * 100))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should NOT allow FEE_SETTER_ROLE to set protocol fee rate above 100%", async function () {
      const {liquidityPool, feeSetter} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(feeSetter).setProtocolFeeRate(10001))
        .to.be.revertedWithCustomError(liquidityPool, "InvalidProtocolFeeRate");
    });
  });
});
