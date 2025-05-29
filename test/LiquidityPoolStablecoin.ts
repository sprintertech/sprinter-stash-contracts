import {
  loadFixture, time, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, signBorrow
} from "./helpers";
import {ZERO_ADDRESS} from "../scripts/common";
import {encodeBytes32String, AbiCoder, Interface, Contract, solidityPacked} from "ethers";
import {
  MockTarget, MockBorrowSwap, LiquidityPoolStablecoin, CensoredTransferFromMulticall
} from "../typechain-types";
import {networkConfig} from "../network.config";

async function now() {
  return BigInt(await time.latest());
}

describe("LiquidityPoolStablecoin", function () {
  const deployAll = async () => {
    const [
      deployer, admin, user, user2, mpc_signer, liquidityAdmin, withdrawProfit, pauser
    ] = await hre.ethers.getSigners();
    await setCode(user2.address, "0x00");

    const forkNetworkConfig = networkConfig.BASE;

    const USDC_ADDRESS = forkNetworkConfig.USDC;
    const USDC_OWNER_ADDRESS = process.env.USDC_OWNER_ADDRESS;
    if (!USDC_OWNER_ADDRESS) throw new Error("Env variables not configured (USDC_OWNER_ADDRESS missing)");
    const usdc = await hre.ethers.getContractAt("ERC20", USDC_ADDRESS);
    const usdcOwner = await hre.ethers.getImpersonatedSigner(USDC_OWNER_ADDRESS);

    const RPL_ADDRESS = "0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee"; // GHO
    const RPL_OWNER_ADDRESS = process.env.RPL_OWNER_ADDRESS!;
    if (!RPL_OWNER_ADDRESS) throw new Error("Env variables not configured (RPL_OWNER_ADDRESS missing)");
    const rpl = await hre.ethers.getContractAt("ERC20", RPL_ADDRESS);
    const rplOwner = await hre.ethers.getImpersonatedSigner(RPL_OWNER_ADDRESS);

    const UNI_ADDRESS = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42"; // EURC
    const UNI_OWNER_ADDRESS = process.env.UNI_OWNER_ADDRESS!;
    if (!UNI_OWNER_ADDRESS) throw new Error("Env variables not configured (UNI_OWNER_ADDRESS missing)");
    const uni = await hre.ethers.getContractAt("ERC20", UNI_ADDRESS);
    const uniOwner = await hre.ethers.getImpersonatedSigner(UNI_OWNER_ADDRESS);
    await setBalance(UNI_OWNER_ADDRESS, 10n ** 18n);

    const USDC_DEC = 10n ** (await usdc.decimals());
    const RPL_DEC = 10n ** (await rpl.decimals());
    const UNI_DEC = 10n ** (await uni.decimals());

    const liquidityPoolStablecoin = (
      await deploy("LiquidityPoolStablecoin", deployer, {},
        usdc.target, admin.address, mpc_signer.address
      )
    ) as LiquidityPoolStablecoin;

    const mockTarget = (
      await deploy("MockTarget", deployer)
    ) as MockTarget;

    const mockBorrowSwap = (
      await deploy("MockBorrowSwap", deployer)
    ) as MockBorrowSwap;

    const LIQUIDITY_ADMIN_ROLE = encodeBytes32String("LIQUIDITY_ADMIN_ROLE");
    await liquidityPoolStablecoin.connect(admin).grantRole(LIQUIDITY_ADMIN_ROLE, liquidityAdmin.address);

    const WITHDRAW_PROFIT_ROLE = encodeBytes32String("WITHDRAW_PROFIT_ROLE");
    await liquidityPoolStablecoin.connect(admin).grantRole(WITHDRAW_PROFIT_ROLE, withdrawProfit.address);

    const PAUSER_ROLE = encodeBytes32String("PAUSER_ROLE");
    await liquidityPoolStablecoin.connect(admin).grantRole(PAUSER_ROLE, pauser.address);

    return {deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, rpl, rplOwner, uni, uniOwner,
      liquidityPoolStablecoin, mockTarget, mockBorrowSwap, USDC_DEC, RPL_DEC, UNI_DEC,
      liquidityAdmin, withdrawProfit, pauser};
  };

  describe("Initialization", function () {
    it("Should initialize the contract with correct values", async function () {
      const {liquidityPoolStablecoin, usdc, mpc_signer} = await loadFixture(deployAll);
      expect(await liquidityPoolStablecoin.ASSETS())
        .to.be.eq(usdc.target);
      expect(await liquidityPoolStablecoin.mpcAddress())
        .to.be.eq(mpc_signer);
    });

    it("Should NOT deploy the contract if liquidity token address is 0", async function () {
      const {deployer, liquidityPoolStablecoin, admin, mpc_signer} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPool", deployer, {}, 
        ZERO_ADDRESS, admin, mpc_signer.address
      )).to.be.revertedWithCustomError(liquidityPoolStablecoin, "ZeroAddress");
    });

    it("Should NOT deploy the contract if admin address is 0", async function () {
      const {deployer, liquidityPoolStablecoin, usdc, mpc_signer} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPool", deployer, {}, 
        usdc, ZERO_ADDRESS, mpc_signer.address
      )).to.be.revertedWithCustomError(liquidityPoolStablecoin, "ZeroAddress");
    });

    it("Should NOT deploy the contract if MPC address is 0", async function () {
      const {deployer, liquidityPoolStablecoin, usdc, admin} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPool", deployer, {}, 
        usdc, admin, ZERO_ADDRESS
      )).to.be.revertedWithCustomError(liquidityPoolStablecoin, "ZeroAddress");
    });
  });

  describe("Borrow, supply, withdraw", function () {
    it("Should deposit to the pool", async function () {
      const {liquidityPoolStablecoin, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amount);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amount);
    });

    it("Should deposit to the pool with pulling funds", async function () {
      const {liquidityPoolStablecoin, usdc, usdcOwner, USDC_DEC} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).approve(liquidityPoolStablecoin.target, amount);
      await expect(liquidityPoolStablecoin.connect(usdcOwner).depositWithPull(amount))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(usdcOwner, amount);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amount);
    });

    it("Should borrow a token with contract call", async function () {
      const {
        liquidityPoolStablecoin, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address,
        usdc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);  
      expect(await usdc.balanceOf(liquidityPoolStablecoin.target)).to.be.lessThan(amountLiquidity);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget.target)).to.eq(amountToBorrow);
    });

    it("Should borrow a different token", async function () {
      const {
        liquidityPoolStablecoin, mockTarget, uni, UNI_DEC, uniOwner, user, mpc_signer
      } = await loadFixture(deployAll);
      const amountUni = 1000n * UNI_DEC; // $1000
      await uni.connect(uniOwner).transfer(liquidityPoolStablecoin.target, amountUni);

      const amountToBorrow = 3n * UNI_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(uni.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address,
        uni.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        uni.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);  
      expect(await uni.balanceOf(liquidityPoolStablecoin.target)).to.be.lessThan(amountUni);
      expect(await uni.balanceOf(mockTarget.target)).to.eq(amountToBorrow);
    });
  
    it("Should borrow a token with swap", async function () {
      // USDC is borrowed and swapped to UNI
      const {
        liquidityPoolStablecoin, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, uni, UNI_DEC, uniOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * UNI_DEC;
      await uni.connect(uniOwner).approve(mockBorrowSwap.target, fillAmount);

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(uni.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [usdc.target, amountToBorrow, uni.target, uniOwner.address, fillAmount]
          );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        mockBorrowSwap.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolStablecoin.borrowAndSwap.populateTransaction(
        usdc.target,
        amountToBorrow,
        {fillToken: uni.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolStablecoin.target, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData) 
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);  
      expect(await usdc.balanceOf(liquidityPoolStablecoin.target)).to.be.lessThan(amountLiquidity);
      expect(await usdc.balanceOf(mockBorrowSwap.target)).to.eq(amountToBorrow);
      expect(await uni.balanceOf(liquidityPoolStablecoin.target)).to.eq(0);
      expect(await uni.balanceOf(mockTarget.target)).to.eq(fillAmount);
    });

    it("Should allow repaying using borrow() and swapping externally", async function () {
      const {
        liquidityPoolStablecoin, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin,
        uni, uniOwner, UNI_DEC, deployer
      } = await loadFixture(deployAll);

      const SWAP_ROUTER_ADDRESS = "0x2626664c2603336E57B271c5C0b26F421741e481";

      const swapRouterInterface = [
        {
          "inputs": [
            {
              "components": [
                {
                  "internalType": "bytes",
                  "name": "path",
                  "type": "bytes"
                },
                {
                  "internalType": "address",
                  "name": "recipient",
                  "type": "address"
                },
                {
                  "internalType": "uint256",
                  "name": "amountIn",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "amountOutMinimum",
                  "type": "uint256"
                }
              ],
              "internalType": "struct ISwapRouter.ExactInputParams",
              "name": "params",
              "type": "tuple"
            }
          ],
          "name": "exactInput",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "amountOut",
              "type": "uint256"
            }
          ],
          "stateMutability": "payable",
          "type": "function"
        }
      ];
      const swapRouterIface = new Interface(swapRouterInterface);
      const swapRouter = new Contract(SWAP_ROUTER_ADDRESS, swapRouterIface);

      const multicall = (
        await deploy("CensoredTransferFromMulticall", deployer)
      ) as CensoredTransferFromMulticall;

      // USDC is supplied and borrowed
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address,
        usdc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);  
      expect(await usdc.balanceOf(liquidityPoolStablecoin.target)).to.be.lessThan(amountLiquidity);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget.target)).to.eq(amountToBorrow);

      // UNI is returned to the pool
      const amountToRepay = 5n * UNI_DEC;
      await uni.connect(uniOwner).transfer(liquidityPoolStablecoin.target, amountToRepay);

      // UNI is borrowed and swapped to USDC with Uniswap

      // Calldata for transferring uni from pool to msg.sender
      const uniTransferFromData = await uni.transferFrom.populateTransaction(
        liquidityPoolStablecoin.target,
        multicall.target,
        amountToRepay
      );
      
      // Calldata for approving uni to swap router
      const uniApproveToSwapRouterData = await uni.approve.populateTransaction(
        SWAP_ROUTER_ADDRESS,
        amountToRepay
      );

      // Calldata for Uniswap swap
      const path = solidityPacked(["address", "uint24", "address"], [uni.target, 500, usdc.target]);
      const swapData = await swapRouter.exactInput.populateTransaction([
        path, // path
        liquidityPoolStablecoin.target,  // recipient
        amountToRepay, // amountIn
        amountToBorrow // amountOutMin
      ]);

      const callDataRepay = (await multicall.multicall.populateTransaction(
        [uni.target, uni.target, SWAP_ROUTER_ADDRESS],
        [uniTransferFromData.data, uniApproveToSwapRouterData.data, swapData.data]
      )).data;

      const signatureSwap = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address as string,
        uni.target as string,
        amountToRepay.toString(),
        multicall.target as string,
        callDataRepay,
        31337,
        1n
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        uni.target,
        amountToRepay,
        multicall.target,
        callDataRepay,
        1n,
        2000000000n,
        signatureSwap))
      .to.emit(uni, "Transfer");
      expect(await usdc.balanceOf(liquidityPoolStablecoin.target)).to.be.greaterThanOrEqual(amountLiquidity);
    });

    it("Should deposit when the contract is paused", async function () {
      const {liquidityPoolStablecoin, pauser, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(pauser).pause())
        .to.emit(liquidityPoolStablecoin, "Paused");
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");
      await usdc.connect(usdcOwner).approve(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(usdcOwner).depositWithPull(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(usdcOwner, amountLiquidity);
    });

    it("Should withdraw liquidity", async function () {
      const {
        liquidityPoolStablecoin, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amount);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amount);

      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).withdraw(user.address, amount))
        .to.emit(liquidityPoolStablecoin, "Withdraw").withArgs(liquidityAdmin, user.address, amount);
      expect(await usdc.balanceOf(user.address)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPoolStablecoin.target)).to.eq(0);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(0);
    });

    it("Should withdraw profit for multiple tokens from the pool", async function () {
      const {
        liquidityPoolStablecoin, uni, rpl, UNI_DEC, uniOwner, rplOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * UNI_DEC;
      const amountRpl = 1n * UNI_DEC;
      await uni.connect(uniOwner).transfer(liquidityPoolStablecoin.target, amountUni);
      await rpl.connect(rplOwner).transfer(liquidityPoolStablecoin.target, amountRpl);
      await expect(liquidityPoolStablecoin.connect(withdrawProfit)
        .withdrawProfit([uni.target, rpl.target], user.address))
        .to.emit(liquidityPoolStablecoin, "ProfitWithdrawn").withArgs(uni.target, user.address, amountUni)
        .and.to.emit(liquidityPoolStablecoin, "ProfitWithdrawn").withArgs(rpl.target, user.address, amountRpl);
      expect(await uni.balanceOf(user.address)).to.eq(amountUni);
      expect(await rpl.balanceOf(user.address)).to.eq(amountRpl);
    });

    it("Should withdraw liquidity as profit from the pool", async function () {
      const {
        liquidityPoolStablecoin, usdc, USDC_DEC, usdcOwner, withdrawProfit, liquidityAdmin, user
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");
      const amountProfit = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountProfit);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.emit(liquidityPoolStablecoin, "ProfitWithdrawn").withArgs(usdc.target, user.address, amountProfit);
      expect(await usdc.balanceOf(user.address)).to.eq(amountProfit);
      expect(await usdc.balanceOf(liquidityPoolStablecoin.target)).to.eq(amountLiquidity);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amountLiquidity);
    });

    it("Should withdraw all available balance as profit ", async function () {
      const {liquidityPoolStablecoin, usdc, USDC_DEC, usdcOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amount);
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.emit(liquidityPoolStablecoin, "ProfitWithdrawn").withArgs(usdc.target, user.address, amount);
      expect(await usdc.balanceOf(user.address)).to.eq(amount);
    });

    it("Should NOT deposit if no collateral on contract", async function () {
      const {liquidityPoolStablecoin, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(10))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "NotEnoughToDeposit");
    });

    it("Should NOT borrow if MPC signature is wrong", async function () {
      const {
        liquidityPoolStablecoin, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        user,
        liquidityPoolStablecoin.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "InvalidSignature");
    });

    it("Should NOT borrow if MPC signature nonce is reused", async function () {
      const {
        liquidityPoolStablecoin, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await liquidityPoolStablecoin.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      await expect(liquidityPoolStablecoin.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "NonceAlreadyUsed");
    });

    it("Should NOT borrow if MPC signature is expired", async function () {
      const {
        liquidityPoolStablecoin, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        0n,
        deadline,
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        deadline,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "ExpiredSignature");
    });

    it("Should NOT borrow if target call fails", async function () {
      const {
        liquidityPoolStablecoin, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        usdc.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        usdc.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "TargetCallFailed");
    });

    it("Should NOT borrow if borrowing is paused", async function () {
      const {
        liquidityPoolStablecoin, user, user2, withdrawProfit, mpc_signer, usdc, USDC_DEC
      } = await loadFixture(deployAll);
      
      // Pause borrowing
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPoolStablecoin, "BorrowPaused");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "BorrowingIsPaused");
    });

    it("Should NOT borrow if the contract is paused", async function () {
      const {liquidityPoolStablecoin, usdc, user, user2, pauser} = await loadFixture(deployAll);
      
      // Pause the contract
      await expect(liquidityPoolStablecoin.connect(pauser).pause())
        .to.emit(liquidityPoolStablecoin, "Paused");

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        usdc.target,
        1,
        user2,
        "0x",
        0n,
        2000000000n,
        "0x"))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "EnforcedPause");
    });

    it("Should NOT borrow if MPC signature is wrong (caller is wrong)", async function () {
      const {
        liquidityPoolStablecoin, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user2).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "InvalidSignature");
    });

    it("Should NOT borrow and swap if MPC signature is wrong (caller is wrong)", async function () {
      // USDC is borrowed and swapped to UNI
      const {
        liquidityPoolStablecoin, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, uni, UNI_DEC, uniOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");

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
      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address as string,
        usdc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolStablecoin.borrowAndSwap.populateTransaction(
        usdc.target,
        amountToBorrow,
        {fillToken: uni.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolStablecoin.target, borrowCalldata.data))
        .to.be.reverted;
    });

    it("Should NOT borrow and swap if the swap fails", async function () {
      // USDC is borrowed and swapped to UNI
      const {
        liquidityPoolStablecoin, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, uni, UNI_DEC, uniOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");

      const amountToBorrow = 3n * USDC_DEC;
      const fillAmount = 2n * UNI_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(uni.target, fillAmount, additionalData);
      const swapData = AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address", "address", "uint256"],
            [usdc.target, amountToBorrow, uni.target, uniOwner.address, fillAmount]
          );

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        mockBorrowSwap.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolStablecoin.borrowAndSwap.populateTransaction(
        usdc.target,
        amountToBorrow,
        {fillToken: uni.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      // No UNI tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolStablecoin.target, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT borrow a different token if not enough in the pool", async function () {
      const {
        liquidityPoolStablecoin, mockTarget, uni, UNI_DEC, uniOwner, user, mpc_signer
      } = await loadFixture(deployAll);
      const amountUni = 1n * UNI_DEC; // $1000
      await uni.connect(uniOwner).transfer(liquidityPoolStablecoin.target, amountUni);

      const amountToBorrow = 3n * UNI_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(uni.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address,
        uni.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        uni.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "TargetCallFailed");
    });

    it("Should NOT withdraw liquidity if not enough on contract", async function () {
      const {liquidityPoolStablecoin, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amount);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolStablecoin, "Deposit");

      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).withdraw(user.address, amount * 2n))
        .to.be.reverted;
    });

    it("Should NOT withdraw profit as liquidity", async function () {
      const {liquidityPoolStablecoin, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amount);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amount - 1n))
        .to.emit(liquidityPoolStablecoin, "Deposit");
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amount - 1n);

      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).withdraw(user.address, amount))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "InsufficientLiquidity");
    });

    it("Should NOT withdraw profit if repayment was insufficient", async function () {
      const {
        liquidityPoolStablecoin, uni, rpl, usdc, UNI_DEC, USDC_DEC, uniOwner, rplOwner, usdcOwner,
        liquidityAdmin, withdrawProfit, user, mockTarget, mpc_signer
      } = await loadFixture(deployAll);
      const amountUni = 1n * UNI_DEC;
      const amountRpl = 1n * UNI_DEC;
      await uni.connect(uniOwner).transfer(liquidityPoolStablecoin.target, amountUni);
      await rpl.connect(rplOwner).transfer(liquidityPoolStablecoin.target, amountRpl);

      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address,
        usdc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);  
      expect(await usdc.balanceOf(liquidityPoolStablecoin.target)).to.be.lessThan(amountLiquidity);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget.target)).to.eq(amountToBorrow);

      await expect(liquidityPoolStablecoin.connect(withdrawProfit)
        .withdrawProfit([uni.target, rpl.target], user.address))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "WithdrawProfitDenied");
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "WithdrawProfitDenied");
    });

    it("Should NOT withdraw liquidity if the contract is paused", async function () {
      const {liquidityPoolStablecoin, user, liquidityAdmin, pauser} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(pauser).pause())
        .to.emit(liquidityPoolStablecoin, "Paused");
      
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).withdraw(user.address, 10))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "EnforcedPause");
    });

    it("Should NOT withdraw liquidity to zero address", async function () {
      const {liquidityPoolStablecoin, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).withdraw(ZERO_ADDRESS, 10))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "ZeroAddress()");
    });

    it("Should NOT withdraw profit if the contract is paused", async function () {
      const {liquidityPoolStablecoin, user, usdc, withdrawProfit, pauser} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(pauser).pause())
        .to.emit(liquidityPoolStablecoin, "Paused");
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "EnforcedPause");
    });

    it("Should NOT withdraw profit to zero address", async function () {
      const {liquidityPoolStablecoin, usdc, withdrawProfit} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).withdrawProfit([usdc.target], ZERO_ADDRESS))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "ZeroAddress()");
    });

    it("Should revert during withdrawing profit if no profit", async function () {
      const {liquidityPoolStablecoin, usdc, withdrawProfit, user} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).withdrawProfit([usdc.target], user.address))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "NoProfit()");
    });
  });

  describe("Roles and admin functions", function () {
    it("Should allow admin to set MPC address", async function () {
      const {liquidityPoolStablecoin, admin, user} = await loadFixture(deployAll);
      const oldMPCAddress = await liquidityPoolStablecoin.mpcAddress();
      await expect(liquidityPoolStablecoin.connect(admin).setMPCAddress(user.address))
        .to.emit(liquidityPoolStablecoin, "MPCAddressSet").withArgs(oldMPCAddress, user.address);
      expect(await liquidityPoolStablecoin.mpcAddress())
        .to.eq(user.address);
    });

    it("Should NOT allow others to set MPC address", async function () {
      const {liquidityPoolStablecoin, user} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(user).setMPCAddress(user.address))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "AccessControlUnauthorizedAccount");
    });

    it("Should allow WITHDRAW_PROFIT_ROLE to pause and unpause borrowing", async function () {
      const {liquidityPoolStablecoin, withdrawProfit} = await loadFixture(deployAll);
      expect(await liquidityPoolStablecoin.borrowPaused())
        .to.eq(false);
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPoolStablecoin, "BorrowPaused");
      expect(await liquidityPoolStablecoin.borrowPaused())
        .to.eq(true);
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).unpauseBorrow())
        .to.emit(liquidityPoolStablecoin, "BorrowUnpaused");
      expect(await liquidityPoolStablecoin.borrowPaused())
        .to.eq(false);
    });

    it("Should NOT allow others to pause and unpause borrowing", async function () {
      const {liquidityPoolStablecoin, admin} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(admin).pauseBorrow())
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "AccessControlUnauthorizedAccount");
    });

    it("Should allow WITHDRAW_PROFIT_ROLE to withdraw profit", async function () {
      const {
        liquidityPoolStablecoin, uni, UNI_DEC, uniOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * UNI_DEC;
      await uni.connect(uniOwner).transfer(liquidityPoolStablecoin.target, amountUni);
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).withdrawProfit([uni.target], user.address))
        .to.emit(liquidityPoolStablecoin, "ProfitWithdrawn").withArgs(uni.target, user.address, amountUni);
      expect(await uni.balanceOf(user.address)).to.eq(amountUni);
    });

    it("Should NOT allow others to withdraw profit", async function () {
      const {liquidityPoolStablecoin, uni, user} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(user).withdrawProfit([uni.target], user.address))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to deposit liquidity", async function () {
      const {liquidityPoolStablecoin, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amount);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amount);
    });

    it("Should NOT allow others to deposit liquidity", async function () {
      const {liquidityPoolStablecoin, usdc, usdcOwner, USDC_DEC, user} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amount);
      await expect(liquidityPoolStablecoin.connect(user).deposit(amount))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to withdraw liquidity", async function () {
      const {liquidityPoolStablecoin, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amount);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(liquidityAdmin, amount);

      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).withdraw(user.address, amount))
        .to.emit(liquidityPoolStablecoin, "Withdraw").withArgs(liquidityAdmin, user.address, amount);

      expect(await usdc.balanceOf(user.address)).to.be.eq(amount);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.be.eq(0);
    });

    it("Should NOT allow others to withdraw liquidity", async function () {
      const {liquidityPoolStablecoin, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amount);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(liquidityAdmin, amount);

      await expect(liquidityPoolStablecoin.connect(user).withdraw(user.address, amount * 2n))
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "AccessControlUnauthorizedAccount");
    });

    it("Should allow PAUSER_ROLE to pause and unpause the contract", async function () {
      const {liquidityPoolStablecoin, pauser} = await loadFixture(deployAll);
      expect(await liquidityPoolStablecoin.paused())
        .to.eq(false);
      await expect(liquidityPoolStablecoin.connect(pauser).pause())
        .to.emit(liquidityPoolStablecoin, "Paused");
      expect(await liquidityPoolStablecoin.paused())
        .to.eq(true);
      await expect(liquidityPoolStablecoin.connect(pauser).unpause())
        .to.emit(liquidityPoolStablecoin, "Unpaused");
      expect(await liquidityPoolStablecoin.paused())
        .to.eq(false);
    });

    it("Should NOT allow others to pause and unpause the contract", async function () {
      const {liquidityPoolStablecoin, admin} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(admin).pause())
        .to.be.revertedWithCustomError(liquidityPoolStablecoin, "AccessControlUnauthorizedAccount");
    });
  });
});
