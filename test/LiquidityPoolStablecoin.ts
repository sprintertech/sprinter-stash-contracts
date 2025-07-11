import {
  loadFixture, time, setBalance, setCode
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  deploy, signBorrow, signBorrowMany,
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

    return {deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, gho, ghoOwner, eurc, eurcOwner,
      liquidityPoolStablecoin, mockTarget, mockBorrowSwap, USDC_DEC, GHO_DEC, EURC_DEC,
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
        liquidityPoolStablecoin, mockTarget, eurc, EURC_DEC, eurcOwner, user, mpc_signer
      } = await loadFixture(deployAll);
      const amountUni = 1000n * EURC_DEC; // $1000
      await eurc.connect(eurcOwner).transfer(liquidityPoolStablecoin.target, amountUni);

      const amountToBorrow = 3n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address,
        eurc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);  
      expect(await eurc.balanceOf(liquidityPoolStablecoin.target)).to.be.lessThan(amountUni);
      expect(await eurc.balanceOf(mockTarget.target)).to.eq(amountToBorrow);
    });

    it("Should borrow many tokens with contract call", async function () {
      const {
        liquidityPoolStablecoin, mockTarget, usdc, eurc, USDC_DEC, EURC_DEC, user, mpc_signer,
        usdcOwner, eurcOwner, liquidityAdmin,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin, amountLiquidity);
      await liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity);
      const amountLiquidity2 = 100n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolStablecoin, amountLiquidity2);

      const amountToBorrow = 3n * USDC_DEC;
      const amountToBorrow2 = 5n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc, amountToBorrow2, additionalData);

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolStablecoin,
        user,
        [usdc, eurc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [usdc, eurc],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(mockTarget, "DataReceived").withArgs(additionalData);  
      expect(await usdc.balanceOf(liquidityPoolStablecoin)).to.eq(amountLiquidity);
      expect(await eurc.balanceOf(liquidityPoolStablecoin)).to.eq(amountLiquidity2 - amountToBorrow2);
      expect(await liquidityPoolStablecoin.totalDeposited()).to.eq(amountLiquidity);
      expect(await usdc.balanceOf(mockTarget)).to.eq(0);
      expect(await usdc.allowance(liquidityPoolStablecoin, mockTarget)).to.eq(amountToBorrow);
      expect(await eurc.balanceOf(mockTarget)).to.eq(amountToBorrow2);
    });
  
    it("Should borrow a token with swap", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolStablecoin, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit").withArgs(liquidityAdmin, amountLiquidity);

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
        {fillToken: eurc.target, fillAmount, swapData},
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
      expect(await eurc.balanceOf(liquidityPoolStablecoin.target)).to.eq(0);
      expect(await eurc.balanceOf(mockTarget.target)).to.eq(fillAmount);
    });
  
    it("Should borrow many tokens with swap", async function () {
      // USDC, GHO is borrowed and swapped to EURC
      const {
        liquidityPoolStablecoin, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin,
        gho, GHO_DEC, ghoOwner,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin, amountLiquidity);
      await liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity);
      const amountLiquidity2 = 100n * GHO_DEC;
      await gho.connect(ghoOwner).transfer(liquidityPoolStablecoin, amountLiquidity2);

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
        liquidityPoolStablecoin,
        mockBorrowSwap,
        [usdc, gho],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolStablecoin.borrowAndSwapMany.populateTransaction(
        [usdc, gho],
        [amountToBorrow, amountToBorrow2],
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolStablecoin, borrowCalldata.data))
        .to.emit(mockBorrowSwap, "Swapped").withArgs(swapData) 
        .and.to.emit(mockTarget, "DataReceived").withArgs(additionalData);  
      expect(await usdc.balanceOf(liquidityPoolStablecoin)).to.eq(amountLiquidity - amountToBorrow);
      expect(await usdc.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow);
      expect(await eurc.balanceOf(liquidityPoolStablecoin)).to.eq(0);
      expect(await eurc.balanceOf(mockTarget)).to.eq(fillAmount);
      expect(await gho.balanceOf(liquidityPoolStablecoin)).to.eq(amountLiquidity2 - amountToBorrow2);
      expect(await gho.balanceOf(mockBorrowSwap)).to.eq(amountToBorrow2);
    });

    it("Should NOT borrow many if tokens and amounts have diff or zero length", async function () {
      const {
        liquidityPoolStablecoin, usdc, USDC_DEC, eurc, mpc_signer, user, user2
      } = await loadFixture(deployAll);

      const amountToBorrow = 2n * USDC_DEC;
      let signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolStablecoin,
        user,
        [usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [usdc],
        [amountToBorrow, amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "InvalidLength");

      signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolStablecoin,
        user,
        [usdc, eurc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [usdc, eurc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "InvalidLength");

      signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolStablecoin,
        user,
        [],
        [],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [],
        [],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "InvalidLength");
    });

    it("Should allow repaying using borrow() and swapping externally", async function () {
      const {
        liquidityPoolStablecoin, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin,
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

      // EURC is returned to the pool
      const amountToRepay = 5n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolStablecoin.target, amountToRepay);

      // EURC is borrowed and swapped to USDC with Uniswap

      // Calldata for transferring eurc from pool to msg.sender
      const eurcTransferFromData = await eurc.transferFrom.populateTransaction(
        liquidityPoolStablecoin.target,
        multicall.target,
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
        liquidityPoolStablecoin.target,  // recipient
        amountToRepay, // amountIn
        amountToBorrow // amountOutMin
      ]);

      const callDataRepay = (await multicall.multicall.populateTransaction(
        [eurc.target, eurc.target, SWAP_ROUTER_ADDRESS],
        [eurcTransferFromData.data, eurcApproveToSwapRouterData.data, swapData.data]
      )).data;

      const signatureSwap = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address as string,
        eurc.target as string,
        amountToRepay.toString(),
        multicall.target as string,
        callDataRepay,
        31337,
        1n
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        eurc.target,
        amountToRepay,
        multicall.target,
        callDataRepay,
        1n,
        2000000000n,
        signatureSwap))
      .to.emit(eurc, "Transfer");
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
        liquidityPoolStablecoin, eurc, gho, EURC_DEC, eurcOwner, ghoOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * EURC_DEC;
      const amountRpl = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolStablecoin.target, amountUni);
      await gho.connect(ghoOwner).transfer(liquidityPoolStablecoin.target, amountRpl);
      await expect(liquidityPoolStablecoin.connect(withdrawProfit)
        .withdrawProfit([eurc.target, gho.target], user.address))
        .to.emit(liquidityPoolStablecoin, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountUni)
        .and.to.emit(liquidityPoolStablecoin, "ProfitWithdrawn").withArgs(gho.target, user.address, amountRpl);
      expect(await eurc.balanceOf(user.address)).to.eq(amountUni);
      expect(await gho.balanceOf(user.address)).to.eq(amountRpl);
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
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolStablecoin, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");

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
        {fillToken: eurc.target, fillAmount, swapData},
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
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolStablecoin, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin.target, amountLiquidity);
      await expect(liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity))
        .to.emit(liquidityPoolStablecoin, "Deposit");

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
        {fillToken: eurc.target, fillAmount, swapData},
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      // No EURC tokens (fillToken) will be available for swap
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolStablecoin.target, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT borrow a different token if not enough in the pool", async function () {
      const {
        liquidityPoolStablecoin, mockTarget, eurc, EURC_DEC, eurcOwner, user, mpc_signer
      } = await loadFixture(deployAll);
      const amountUni = 1n * EURC_DEC; // $1000
      await eurc.connect(eurcOwner).transfer(liquidityPoolStablecoin.target, amountUni);

      const amountToBorrow = 3n * EURC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(eurc.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPoolStablecoin.target as string,
        user.address,
        eurc.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrow(
        eurc.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "TargetCallFailed");
    });

    it("Should NOT borrow many if MPC signature is wrong", async function () {
      const {
        liquidityPoolStablecoin, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin, amountLiquidity);
      await liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        user,
        liquidityPoolStablecoin,
        user,
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "InvalidSignature");
    });

    it("Should NOT borrow many if MPC signature nonce is reused", async function () {
      const {
        liquidityPoolStablecoin, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin, amountLiquidity);
      await liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolStablecoin,
        user,
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await liquidityPoolStablecoin.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature);
      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "NonceAlreadyUsed");
    });

    it("Should NOT borrow many if MPC signature is expired", async function () {
      const {
        liquidityPoolStablecoin, usdc, USDC_DEC, user, user2, usdcOwner, mpc_signer, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin, amountLiquidity);
      await liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolStablecoin,
        user,
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337,
        0n,
        deadline,
      );

      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        deadline,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "ExpiredSignature");
    });

    it("Should NOT borrow many if target call fails", async function () {
      const {
        liquidityPoolStablecoin, mockTarget, usdc, USDC_DEC, user, mpc_signer, usdcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin, amountLiquidity);
      await liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(usdc, amountToBorrow, additionalData);

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolStablecoin,
        user,
        [usdc],
        [amountToBorrow],
        usdc,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        usdc,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "TargetCallFailed");
    });

    it("Should NOT borrow many if borrowing is paused", async function () {
      const {
        liquidityPoolStablecoin, user, user2, withdrawProfit, mpc_signer, usdc, USDC_DEC
      } = await loadFixture(deployAll);
      
      // Pause borrowing
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).pauseBorrow())
        .to.emit(liquidityPoolStablecoin, "BorrowPaused");

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolStablecoin,
        user,
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "BorrowingIsPaused");
    });

    it("Should NOT borrow many if the contract is paused", async function () {
      const {liquidityPoolStablecoin, usdc, user, user2, pauser} = await loadFixture(deployAll);
      
      // Pause the contract
      await expect(liquidityPoolStablecoin.connect(pauser).pause())
        .to.emit(liquidityPoolStablecoin, "Paused");

      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [usdc],
        [1n],
        user2,
        "0x",
        0n,
        2000000000n,
        "0x"))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "EnforcedPause");
    });

    it("Should NOT borrow many if MPC signature is wrong (caller is wrong)", async function () {
      const {
        liquidityPoolStablecoin, usdc, USDC_DEC, user, user2, usdcOwner, liquidityAdmin, mpc_signer,
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin, amountLiquidity);
      await liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity);

      const amountToBorrow = 2n * USDC_DEC;
      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolStablecoin,
        user,
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user2).borrowMany(
        [usdc],
        [amountToBorrow],
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.be.revertedWithCustomError(liquidityPoolStablecoin, "InvalidSignature");
    });

    it("Should NOT borrow and swap many if MPC signature is wrong (caller is wrong)", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolStablecoin, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin, amountLiquidity);
      await liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity);

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
        liquidityPoolStablecoin,
        user,
        [usdc],
        [amountToBorrow],
        mockTarget,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolStablecoin.borrowAndSwapMany.populateTransaction(
        [usdc],
        [amountToBorrow],
        {fillToken: eurc, fillAmount, swapData},
        mockTarget,
        callData.data,
        0n,
        2000000000n,
        signature
      );

      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolStablecoin, borrowCalldata.data))
        .to.be.reverted;
    });

    it("Should NOT borrow and swap if the swap fails", async function () {
      // USDC is borrowed and swapped to EURC
      const {
        liquidityPoolStablecoin, mockTarget, mockBorrowSwap, usdc, USDC_DEC,
        user, mpc_signer, usdcOwner, eurc, EURC_DEC, eurcOwner, liquidityAdmin
      } = await loadFixture(deployAll);
      const amountLiquidity = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPoolStablecoin, amountLiquidity);
      await liquidityPoolStablecoin.connect(liquidityAdmin).deposit(amountLiquidity);

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
        liquidityPoolStablecoin,
        mockBorrowSwap,
        [usdc],
        [amountToBorrow],
        mockTarget,
        callData.data,
        31337
      );

      const borrowCalldata = await liquidityPoolStablecoin.borrowAndSwapMany.populateTransaction(
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
      await expect(mockBorrowSwap.connect(user).callBorrow(liquidityPoolStablecoin, borrowCalldata.data))
      .to.be.reverted;
    });

    it("Should NOT borrow many tokens if not enough in the pool", async function () {
      const {
        liquidityPoolStablecoin, mockTarget, eurc, EURC_DEC, gho, GHO_DEC, eurcOwner, ghoOwner, user, mpc_signer
      } = await loadFixture(deployAll);
      const amountEURC = 5n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolStablecoin, amountEURC);
      const amountGHO = 3n * GHO_DEC;
      await gho.connect(ghoOwner).transfer(liquidityPoolStablecoin, amountGHO);

      const amountToBorrow = 3n * EURC_DEC;
      const amountToBorrow2 = 4n * GHO_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(gho, amountToBorrow2, additionalData);

      const signature = await signBorrowMany(
        mpc_signer,
        liquidityPoolStablecoin,
        user,
        [eurc, gho],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
        callData.data,
        31337
      );

      await expect(liquidityPoolStablecoin.connect(user).borrowMany(
        [eurc, gho],
        [amountToBorrow, amountToBorrow2],
        mockTarget,
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
        liquidityPoolStablecoin, eurc, gho, usdc, EURC_DEC, USDC_DEC, eurcOwner, ghoOwner, usdcOwner,
        liquidityAdmin, withdrawProfit, user, mockTarget, mpc_signer
      } = await loadFixture(deployAll);
      const amountUni = 1n * EURC_DEC;
      const amountRpl = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolStablecoin.target, amountUni);
      await gho.connect(ghoOwner).transfer(liquidityPoolStablecoin.target, amountRpl);

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
        .withdrawProfit([eurc.target, gho.target], user.address))
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
        liquidityPoolStablecoin, eurc, EURC_DEC, eurcOwner, withdrawProfit, user
      } = await loadFixture(deployAll);
      const amountUni = 1n * EURC_DEC;
      await eurc.connect(eurcOwner).transfer(liquidityPoolStablecoin.target, amountUni);
      await expect(liquidityPoolStablecoin.connect(withdrawProfit).withdrawProfit([eurc.target], user.address))
        .to.emit(liquidityPoolStablecoin, "ProfitWithdrawn").withArgs(eurc.target, user.address, amountUni);
      expect(await eurc.balanceOf(user.address)).to.eq(amountUni);
    });

    it("Should NOT allow others to withdraw profit", async function () {
      const {liquidityPoolStablecoin, eurc, user} = await loadFixture(deployAll);
      await expect(liquidityPoolStablecoin.connect(user).withdrawProfit([eurc.target], user.address))
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
