import {
  loadFixture, time, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, signBorrow, signBorrowMany, getBalance
} from "./helpers";
import {ZERO_ADDRESS, NATIVE_TOKEN, ETH} from "../scripts/common";
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

    const WETH_ADDRESS = forkNetworkConfig.WrappedNativeToken;
    const WETH_OWNER_ADDRESS = process.env.WETH_OWNER_ADDRESS!;
    if (!WETH_OWNER_ADDRESS) throw new Error("Env variables not configured (WETH_OWNER_ADDRESS missing)");
    const weth = await hre.ethers.getContractAt("ERC20", WETH_ADDRESS);
    const wethOwner = await hre.ethers.getImpersonatedSigner(WETH_OWNER_ADDRESS);
    const WETH_DEC = 10n ** (await weth.decimals());

    const liquidityPool = (
      await deploy("LiquidityPoolStablecoin", deployer, {},
        usdc, admin, mpc_signer, forkNetworkConfig.WrappedNativeToken
      )
    ) as LiquidityPoolStablecoin;

    const mockTarget = (
      await deploy("MockTarget", deployer)
    ) as MockTarget;

    const mockBorrowSwap = (
      await deploy("MockBorrowSwap", deployer)
    ) as MockBorrowSwap;

    const LIQUIDITY_ADMIN_ROLE = encodeBytes32String("LIQUIDITY_ADMIN_ROLE");
    await liquidityPool.connect(admin).grantRole(LIQUIDITY_ADMIN_ROLE, liquidityAdmin);

    const WITHDRAW_PROFIT_ROLE = encodeBytes32String("WITHDRAW_PROFIT_ROLE");
    await liquidityPool.connect(admin).grantRole(WITHDRAW_PROFIT_ROLE, withdrawProfit);

    const PAUSER_ROLE = encodeBytes32String("PAUSER_ROLE");
    await liquidityPool.connect(admin).grantRole(PAUSER_ROLE, pauser);

    return {deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, gho, ghoOwner, eurc, eurcOwner,
      liquidityPool, mockTarget, mockBorrowSwap, USDC_DEC, GHO_DEC, EURC_DEC, WETH_DEC, weth, wethOwner,
      liquidityAdmin, withdrawProfit, pauser};
  };

  describe("Initialization", function () {
    it("Should initialize the contract with correct values", async function () {
      const {liquidityPool, usdc, mpc_signer} = await loadFixture(deployAll);
      expect(await liquidityPool.ASSETS())
        .to.be.eq(usdc.target);
      expect(await liquidityPool.mpcAddress())
        .to.be.eq(mpc_signer);
    });

    it("Should NOT deploy the contract if liquidity token address is 0", async function () {
      const {deployer, liquidityPool, admin, mpc_signer} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPool", deployer, {},
        ZERO_ADDRESS, admin, mpc_signer, networkConfig.BASE.WrappedNativeToken
      )).to.be.revertedWithCustomError(liquidityPool, "ZeroAddress");
    });

    it("Should NOT deploy the contract if admin address is 0", async function () {
      const {deployer, liquidityPool, usdc, mpc_signer} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPool", deployer, {},
        usdc, ZERO_ADDRESS, mpc_signer, networkConfig.BASE.WrappedNativeToken
      )).to.be.revertedWithCustomError(liquidityPool, "ZeroAddress");
    });

    it("Should NOT deploy the contract if MPC address is 0", async function () {
      const {deployer, liquidityPool, usdc, admin} = await loadFixture(deployAll);
      await expect(deploy("LiquidityPool", deployer, {},
        usdc, admin, ZERO_ADDRESS, networkConfig.BASE.WrappedNativeToken
      )).to.be.revertedWithCustomError(liquidityPool, "ZeroAddress");
    });
  });

  describe("Borrow, supply, withdraw", function () {
    it("Should deposit to the pool", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balance(usdc)).to.eq(amount);
    });

    it("Should deposit to the pool with pulling funds", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).approve(liquidityPool, amount);
      await expect(liquidityPool.connect(usdcOwner).depositWithPull(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(usdcOwner, amount);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);
      expect(await liquidityPool.balance(usdc)).to.eq(amount);
    });

    it("Should borrow a token with contract call", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, additionalData);

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

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToBorrow);
      expect(await liquidityPool.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToBorrow);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity - amountToBorrow);
    });

    it("Should borrow a different token", async function () {
      const {
        liquidityPool, mockTarget, eurc, EURC_DEC, usdc, eurcOwner, user, mpc_signer
      } = await loadFixture(deployAll);
      const amountEURC = 1000n * EURC_DEC; // $1000
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEURC);

      const amountToBorrow = 3n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        mockTarget,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(amountEURC - amountToBorrow);
      expect(await eurc.balanceOf(mockTarget)).to.eq(amountToBorrow);
      expect(await liquidityPool.balance(usdc)).to.eq(0);
      expect(await liquidityPool.balance(eurc)).to.eq(amountEURC - amountToBorrow);
    });

    it("Should borrow many tokens with contract call", async function () {
      const {
        liquidityPool, mockTarget, usdc, eurc, USDC_DEC, EURC_DEC, user, mpc_signer,
        usdcOwner, eurcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);
      const amountLiquidity2 = 100n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountLiquidity2);

      const amountToBorrow = 3n * USDC_DEC;
      const amountToBorrow2 = 5n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, amountToBorrow2, additionalData);

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [usdc, eurc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, eurc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(amountLiquidity2 - amountToBorrow2);
      expect(await liquidityPool.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget)).to.eq(0);
      expect(await usdc.allowance(liquidityPool, mockTarget)).to.eq(amountToBorrow);
      expect(await eurc.balanceOf(mockTarget)).to.eq(amountToBorrow2);
    });

    it("Should borrow a token with swap", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;
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
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToBorrow);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(0);
      expect(await eurc.balanceOf(mockTarget)).to.eq(fillAmount);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity - amountToBorrow);
    });

    it("Should borrow many tokens with swap", async function () {
      // USDC, GHO is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin,
        gho, GHO_DEC, ghoOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);
      const amountLiquidity2 = 100n * GHO_DEC;
      await gho.connect(ghoOwner).transfer(liquidityPool, amountLiquidity2);

      const amountToBorrow = 3n * USDC_DEC;
      const amountToBorrow2 = 2n * GHO_DEC;
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
        [usdc, gho],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPool.borrowAndSwapMany.populateTransaction(
        [usdc, gho],
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
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToBorrow);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await eurc.balanceOf(liquidityPool)).to.eq(0);
      expect(await eurc.balanceOf(mockTarget)).to.eq(fillAmount);
      expect(await gho.balanceOf(liquidityPool)).to.eq(amountLiquidity2 - amountToBorrow2);
      expect(await gho.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow2);
    });

    it("Should NOT borrow many if tokens and amounts have diff or zero length", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, eurc, mpc_signer, user, user2
      } = await loadFixture(deployAll);

      const amountToBorrow = 2n * USDC_DEC;
      let signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc],
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
        [usdc, eurc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc, eurc],
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
        31337
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

    it("Should allow repaying using borrow() and swapping externally", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin,
        eurc, eurcOwner, EURC_DEC, deployer
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
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, additionalData);

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

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToBorrow);
      expect(await liquidityPool.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToBorrow);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity - amountToBorrow);

      // EURC is returned to the pool
      const amountToRepay = 5n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountToRepay);
      expect(await liquidityPool.balance(eurc)).to.eq(amountToRepay);

      // EURC is borrowed and swapped to USDC with Uniswap

      // Calldata for transferring eurc from pool to msg.sender
      const eurcTransferFromData = await eurc.transferFrom.populateTransaction(
        liquidityPool,
        multicall,
        amountToRepay
      );

      // Calldata for approving eurc to swap router
      const eurcApproveToSwapRouterData = await eurc.approve.populateTransaction(
        SWAP_ROUTER_ADDRESS,
        amountToRepay
      );

      // Calldata for Uniswap swap
      const path = solidityPacked(["address", "uint24", "address"], [eurc.target, 500, usdc.target]);
      const swapData = await swapRouter.exactInput.populateTransaction([
        path, // path
        liquidityPool, // recipient
        amountToRepay, // amountIn
        amountToBorrow // amountOutMin
      ]);

      const callDataRepay = (await multicall.multicall.populateTransaction(
        [eurc, eurc, SWAP_ROUTER_ADDRESS],
        [eurcTransferFromData.data, eurcApproveToSwapRouterData.data, swapData.data]
      )).data;

      const signatureSwap = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToRepay,
        multicall,
        callDataRepay,
        31337,
        1n
      );

      await expect(liquidityPool.connect(user).borrow(
        eurc,
        amountToRepay,
        multicall,
        callDataRepay,
        1n,
        2000000000n,
        signatureSwap))
      .to.emit(eurc, "Transfer");
      expect(await usdc.balanceOf(liquidityPool)).to.be.greaterThanOrEqual(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.be.greaterThanOrEqual(amountLiquidity);
      expect(await liquidityPool.balance(eurc)).to.eq(0);
    });

    it("Should deposit when the contract is paused", async function () {
      const {liquidityPool, pauser, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit");
      await usdc.connect(usdcOwner).approve(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(usdcOwner).depositWithPull(amountLiquidity))
        .to.emit(liquidityPool, "Deposit").withArgs(usdcOwner, amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity * 2n);
    });

    it("Should withdraw liquidity", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount))
        .to.emit(liquidityPool, "Withdraw").withArgs(liquidityAdmin, user.address, amount);
      expect(await usdc.balanceOf(user)).to.eq(amount);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(0);
      expect(await liquidityPool.totalDeposited()).to.eq(0);
      expect(await liquidityPool.balance(usdc)).to.eq(0);
    });

    it("Should withdraw profit for multiple tokens from the pool", async function () {
      const {
        liquidityPool, eurc, gho, EURC_DEC, eurcOwner, ghoOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountEURC = 1n * EURC_DEC;
      const amountGHO = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEURC);
      await gho.connect(ghoOwner).transfer(liquidityPool, amountGHO);
      expect(await liquidityPool.balance(eurc)).to.eq(amountEURC);
      expect(await liquidityPool.balance(gho)).to.eq(amountGHO);
      await expect(liquidityPool.connect(withdrawProfit)
        .withdrawProfit([eurc, gho], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountEURC)
        .and.to.emit(liquidityPool, "ProfitWithdrawn").withArgs(gho.target, user.address, amountGHO);
      expect(await eurc.balanceOf(user)).to.eq(amountEURC);
      expect(await gho.balanceOf(user)).to.eq(amountGHO);
      expect(await liquidityPool.balance(eurc)).to.eq(0);
      expect(await liquidityPool.balance(gho)).to.eq(0);
    });

    it("Should withdraw liquidity as profit from the pool", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, usdcOwner, withdrawProfit, liquidityAdmin, user
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit");
      const amountProfit = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountProfit);
      expect(await liquidityPool.totalDeposited()).to.eq(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity + amountProfit);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(usdc.target, user.address, amountProfit);
      expect(await usdc.balanceOf(user)).to.eq(amountProfit);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity);
      expect(await liquidityPool.balance(usdc)).to.eq(amountLiquidity);
      expect(await liquidityPool.totalDeposited()).to.eq(amountLiquidity);
    });

    it("Should withdraw all available balance as profit ", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, withdrawProfit, user} = await loadFixture(deployAll);
      const amount = 2n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(usdc.target, user.address, amount);
      expect(await usdc.balanceOf(user)).to.eq(amount);
      expect(await liquidityPool.balance(usdc)).to.eq(0);
    });

    it("Should NOT deposit if no collateral on contract", async function () {
      const {liquidityPool, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(10))
        .to.be.revertedWithCustomError(liquidityPool, "NotEnoughToDeposit");
    });

    it("Should return balance for other tokens", async function () {
      const {
        liquidityPool, eurc, EURC_DEC, eurcOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountLiquidity);
      expect(await liquidityPool.balance(eurc)).to.eq(amountLiquidity);
    });

    it("Should NOT borrow if MPC signature is wrong", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit");

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
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
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
        usdc,
        amountToBorrow,
        user2,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      await expect(liquidityPool.connect(user).borrow(
        usdc,
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
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit");

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
        liquidityPool, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit");

      const amountToBorrow = 2n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        usdc,
        amountToBorrow,
        usdc,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        usdc,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TargetCallFailed");
    });

    it("Should NOT borrow if borrowing is paused", async function () {
      const {
        liquidityPool, user, user2, withdrawProfit, mpc_signer, usdc, USDC_DEC
      } = await loadFixture(deployAll);

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
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer,
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
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit");

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
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit");

      const amountToBorrow = 3n * USDC_DEC;
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

      // No EURC tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT borrow a different token if not enough in the pool", async function () {
      const {
        liquidityPool, mockTarget, eurc, EURC_DEC, eurcOwner, user, mpc_signer
      } = await loadFixture(deployAll);
      const amountEURC = 1n * EURC_DEC; // $1000
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEURC);

      const amountToBorrow = 3n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool,
        user,
        eurc,
        amountToBorrow,
        mockTarget,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrow(
        eurc,
        amountToBorrow,
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TargetCallFailed");
    });

    it("Should NOT borrow many if MPC signature is wrong", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        user,
        liquidityPool,
        user,
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow many if MPC signature nonce is reused", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await liquidityPool.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      await expect(liquidityPool.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "NonceAlreadyUsed");
    });

    it("Should NOT borrow many if MPC signature is expired", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337,
        0n,
        deadline,
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        deadline,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "ExpiredSignature");
    });

    it("Should NOT borrow many if target call fails", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, additionalData);

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [usdc],
        [amountToBorrow],
        usdc,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        usdc,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TargetCallFailed");
    });

    it("Should NOT borrow many if borrowing is paused", async function () {
      const {
        liquidityPool, user, user2, withdrawProfit, mpc_signer, usdc, USDC_DEC
      } = await loadFixture(deployAll);

      // Pause borrowing
      await expect(liquidityPool.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPool, "BorrowPaused");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "BorrowingIsPaused");
    });

    it("Should NOT borrow many if the contract is paused", async function () {
      const {liquidityPool, usdc, user, user2, pauser} = await loadFixture(deployAll);

      // Pause the contract
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(user).borrowMany(
        [usdc],
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
        liquidityPool, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPool.connect(user2).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "InvalidSignature");
    });

    it("Should NOT borrow and swap many if MPC signature is wrong (caller is wrong)", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

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
        liquidityPool,
        user,
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

    it("Should NOT borrow and swap if the swap fails", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPool, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity);

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

      // No EURC tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT borrow many tokens if not enough in the pool", async function () {
      const {
        liquidityPool, mockTarget, eurc, EURC_DEC, gho, GHO_DEC, eurcOwner, ghoOwner, user, mpc_signer
      } = await loadFixture(deployAll);
      const amountEURC = 5n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEURC);
      const amountGHO = 3n * GHO_DEC;
      await gho.connect(ghoOwner).transfer(liquidityPool, amountGHO);

      const amountToBorrow = 3n * EURC_DEC;
      const amountToBorrow2 = 4n * GHO_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(gho, amountToBorrow2, additionalData);

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPool,
        user,
        [eurc, gho],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        31337
      );

      await expect(liquidityPool.connect(user).borrowMany(
        [eurc, gho],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPool, "TargetCallFailed");
    });

    it("Should NOT withdraw liquidity if not enough on contract", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "Deposit");

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount * 2n))
        .to.be.reverted;
    });

    it("Should NOT withdraw profit as liquidity", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount - 1n))
        .to.emit(liquidityPool, "Deposit");
      expect(await liquidityPool.totalDeposited()).to.eq(amount - 1n);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount))
        .to.be.revertedWithCustomError(liquidityPool, "InsufficientLiquidity");
    });

    it("Should NOT withdraw profit if repayment was insufficient", async function () {
      const {
        liquidityPool, eurc, gho, usdc, EURC_DEC, USDC_DEC, eurcOwner, ghoOwner, usdcOwner,
        liquidityAdmin, withdrawProfit, user, mockTarget, mpc_signer
      } = await loadFixture(deployAll);
      const amountEURC = 1n * EURC_DEC;
      const amountGHO = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPool, amountEURC);
      await gho.connect(ghoOwner).transfer(liquidityPool, amountGHO);

      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

      const amountToBorrow = 3n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, additionalData);

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

      await expect(liquidityPool.connect(user).borrow(
        usdc,
        amountToBorrow,
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await usdc.balanceOf(liquidityPool)).to.be.lessThan(amountLiquidity);
      expect(await liquidityPool.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget)).to.eq(amountToBorrow);

      await expect(liquidityPool.connect(withdrawProfit)
        .withdrawProfit([eurc, gho], user))
        .to.be.revertedWithCustomError(liquidityPool, "WithdrawProfitDenied");
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([usdc], user))
        .to.be.revertedWithCustomError(liquidityPool, "WithdrawProfitDenied");
    });

    it("Should NOT withdraw liquidity if the contract is paused", async function () {
      const {liquidityPool, user, liquidityAdmin, pauser} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(pauser).pause())
        .to.emit(liquidityPool, "Paused");

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, 10))
        .to.be.revertedWithCustomError(liquidityPool, "EnforcedPause");
    });

    it("Should NOT withdraw liquidity to zero address", async function () {
      const {liquidityPool, liquidityAdmin} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(liquidityAdmin).withdraw(ZERO_ADDRESS, 10))
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
        31337
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
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToBorrow);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.eq(0);
      expect(await getBalance(mockTarget)).to.eq(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.eq(0);
    });

    it("Should revert borrow if swap with native fill returned insufficient amount", async function () {
      // USDC is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin, wethOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      await weth.connect(wethOwner).transfer(mockBorrowSwap, fillAmount);

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
        usdc,
        amountToBorrow,
        mockTarget,
        callData.data,
        31337
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

      await expect(mockBorrowSwap.connect(user).callBorrowBubbleRevert(
        liquidityPool, borrowCalldata.data
      )).to.be.revertedWithCustomError(liquidityPool, "InsufficientSwapResult");
    });

    it("Should borrow with swap with native fill if returned extra amount", async function () {
      // USDC is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin, wethOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      const returnedAmount = fillAmount + 1n;
      await weth.connect(wethOwner).transfer(mockBorrowSwap, returnedAmount);

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
        usdc,
        amountToBorrow,
        mockTarget,
        callData.data,
        31337
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

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await weth.balanceOf(mockBorrowSwap)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToBorrow);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.eq(returnedAmount - fillAmount);
      expect(await getBalance(mockTarget)).to.eq(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.eq(0);
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
        31337
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
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToBorrow);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await weth.balanceOf(mockBorrowSwap)).to.eq(0);
      expect(await getBalance(liquidityPool)).to.eq(0);
      expect(await getBalance(mockTarget)).to.eq(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.eq(0);
    });

    it("Should revert borrow many if swap with native fill returned insufficient amount", async function () {
      // USDC is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin, wethOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      await weth.connect(wethOwner).transfer(mockBorrowSwap, fillAmount);

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
        [usdc],
        [amountToBorrow],
        mockTarget,
        callData.data,
        31337
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

      await expect(mockBorrowSwap.connect(user).callBorrowBubbleRevert(
        liquidityPool, borrowCalldata.data
      )).to.be.revertedWithCustomError(liquidityPool, "InsufficientSwapResult");
    });

    it("Should borrow many with swap with native fill if returned extra amount", async function () {
      // USDC is borrowed and swapped to ETH
      const {
        liquidityPool, mockTarget, weth, mockBorrowSwap, usdc, usdcOwner, USDC_DEC,
        user, mpc_signer, liquidityAdmin, wethOwner
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool, amountLiquidity);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amountLiquidity));

      const amountToBorrow = 10n * USDC_DEC;
      const fillAmount = 1n * ETH;
      const returnedAmount = fillAmount + 1n;
      await weth.connect(wethOwner).transfer(mockBorrowSwap, returnedAmount);

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
        [usdc],
        [amountToBorrow],
        mockTarget,
        callData.data,
        31337
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

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPool, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData)
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);
      expect(await weth.balanceOf(liquidityPool)).to.eq(0);
      expect(await weth.balanceOf(mockBorrowSwap)).to.eq(0);
      expect(await usdc.balanceOf(liquidityPool)).to.eq(amountLiquidity - amountToBorrow);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await getBalance(liquidityPool)).to.eq(returnedAmount - fillAmount);
      expect(await getBalance(mockTarget)).to.eq(fillAmount);
      expect(await getBalance(mockBorrowSwap)).to.eq(0);
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

    it("Should withdraw all native balance as profit", async function () {
      const {
        admin, liquidityPool, weth, WETH_DEC,
        withdrawProfit, user
      } = await loadFixture(deployAll);
      const amount = 2n * WETH_DEC;
      await admin.sendTransaction({to: liquidityPool, value: amount});
      expect(await liquidityPool.balance(weth)).to.eq(amount);
      expect(await liquidityPool.balance(NATIVE_TOKEN)).to.eq(amount);
      await expect(liquidityPool.connect(withdrawProfit).withdrawProfit([weth], user))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(weth.target, user.address, amount);
      expect(await weth.balanceOf(user)).to.eq(amount);
      expect(await liquidityPool.balance(weth)).to.eq(0);
    });

    it("Should NOT allow others to withdraw profit", async function () {
      const {liquidityPool, eurc, user} = await loadFixture(deployAll);
      await expect(liquidityPool.connect(user).withdrawProfit([eurc], user))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to deposit liquidity", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amount);
      expect(await liquidityPool.totalDeposited()).to.eq(amount);
    });

    it("Should NOT allow others to deposit liquidity", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, user} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(user).deposit(amount))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should allow LIQUIDITY_ADMIN_ROLE to withdraw liquidity", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amount);

      await expect(liquidityPool.connect(liquidityAdmin).withdraw(user, amount))
        .to.emit(liquidityPool, "Withdraw").withArgs(liquidityAdmin, user.address, amount);

      expect(await usdc.balanceOf(user)).to.be.eq(amount);
      expect(await liquidityPool.totalDeposited()).to.be.eq(0);
    });

    it("Should NOT allow others to withdraw liquidity", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, user, liquidityAdmin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool, amount);
      await expect(liquidityPool.connect(liquidityAdmin).deposit(amount))
        .to.emit(liquidityPool, "Deposit").withArgs(liquidityAdmin, amount);

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
