import {
  loadFixture, time
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {
  getCreateAddress, getContractAt, deploy, signBorrow
} from "./helpers";
import {encodeBytes32String, MaxUint256} from "ethers";
import {
  MockTarget, LiquidityPool, TransparentUpgradeableProxy, ProxyAdmin
} from "../typechain-types";

async function now() {
  return BigInt(await time.latest());
}

describe("LiquidityPool", function () {
  const deployAll = async () => {
    const [deployer, admin, user, user2, mpc_signer] = await hre.ethers.getSigners();

    const AAVE_POOL_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";
    const aavePoolAddressesProvider = await hre.ethers.getContractAt("IPoolAddressesProvider", AAVE_POOL_PROVIDER);
    const aavePoolAddress = await aavePoolAddressesProvider.getPool();
    const aavePool = await hre.ethers.getContractAt("IPool", aavePoolAddress);

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

    const USDC_DEC = 10n ** (await usdc.decimals());
    const RPL_DEC = 10n ** (await rpl.decimals());
    const UNI_DEC = 10n ** (await uni.decimals());

    const startingNonce = await deployer.getNonce();

    const liquidityPoolAddress = await getCreateAddress(deployer, startingNonce + 1);
    const liquidityPoolImpl = (
      await deploy("LiquidityPool", deployer, {nonce: startingNonce},
        usdc.target, AAVE_POOL_PROVIDER
      )
    ) as LiquidityPool;
    // Initialize health factor as 5
    const healthFactor = 5n * 10n ** 18n;
    // Initialize token LTV as 5%
    const defaultLtv = 500n; // 5%
    const liquidityPoolInit = 
      (await liquidityPoolImpl.initialize.populateTransaction(
        admin.address, healthFactor, defaultLtv, mpc_signer.address
      )).data;
    const liquidityPoolProxy = (await deploy(
      "TransparentUpgradeableProxy", deployer, {nonce: startingNonce + 1},
      liquidityPoolImpl.target, admin, liquidityPoolInit
    )) as TransparentUpgradeableProxy;
    const liquidityPool = (await getContractAt("LiquidityPool", liquidityPoolAddress, deployer)) as LiquidityPool;
    const liquidityPoolProxyAdminAddress = await getCreateAddress(liquidityPoolProxy, 1);
    const liquidityPoolAdmin = (await getContractAt("ProxyAdmin", liquidityPoolProxyAdminAddress, admin)) as ProxyAdmin;

    const mockTarget = (
      await deploy("MockTarget", deployer, {nonce: startingNonce + 2})
    ) as MockTarget;

    const LIQUIDITY_ADMIN_ROLE = encodeBytes32String("LIQUIDITY_ADMIN_ROLE");
    await liquidityPool.connect(admin).grantRole(LIQUIDITY_ADMIN_ROLE, admin.address);

    const WITHDRAW_PROFIT_ROLE = encodeBytes32String("WITHDRAW_PROFIT_ROLE");
    await liquidityPool.connect(admin).grantRole(WITHDRAW_PROFIT_ROLE, admin.address);

    return {deployer, admin, user, user2, mpc_signer, usdc, usdcOwner, rpl, rplOwner, uni, uniOwner,
      liquidityPool, liquidityPoolProxy, liquidityPoolAdmin, mockTarget, USDC_DEC, RPL_DEC, UNI_DEC, AAVE_POOL_PROVIDER,
      healthFactor, defaultLtv, aavePool, aToken, rplDebtToken, uniDebtToken, usdcDebtToken};
  };

  describe("Initialization", function () {
    it("Should initialize the contract with correct values", async function () {
      const {
        liquidityPool, usdc, AAVE_POOL_PROVIDER, healthFactor, defaultLtv, mpc_signer
      } = await loadFixture(deployAll);
      expect(await liquidityPool.COLLATERAL())
        .to.be.eq(usdc.target);
      expect(await liquidityPool.AAVE_POOL_PROVIDER())
        .to.be.eq(AAVE_POOL_PROVIDER);
      expect(await liquidityPool.healthFactor())
        .to.be.eq(healthFactor);
      expect(await liquidityPool.defaultLTV())
        .to.be.eq(defaultLtv);
      expect(await liquidityPool.mpcAddress())
        .to.be.eq(mpc_signer);
    });
  });

  describe("Borrow, supply, repay, withdraw", function () {
    it("Should deposit to aave", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);
    });

    it("Should borrow a token", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, user, user2, mpc_signer, usdcOwner
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      expect(await liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.emit(liquidityPool, "Borrowed")
      .withArgs(rpl.target, amountToBorrow, user.address, user2.address);  
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);
    });
   
    it("Should calculate token ltv if decimals of token and collateral are different", async function () {
      const {
        liquidityPool, usdc, uni, mpc_signer, user, user2, usdcOwner, USDC_DEC, UNI_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * UNI_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      expect(await liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.emit(liquidityPool, "Borrowed")
      .withArgs(uni.target, amountToBorrow, user.address, user2.address);
      expect(await uni.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);
      expect(await uni.allowance(liquidityPool.target, user2.address)).to.eq(amountToBorrow);
    });

    it("Should make a contract call to the recipient", async function () {
      const {
        liquidityPool, mockTarget, usdc, USDC_DEC, rpl, RPL_DEC, user, mpc_signer, usdcOwner
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * RPL_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(rpl.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        rpl.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      expect(await liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(liquidityPool, "Borrowed")
      .and.to.emit(mockTarget, "DataReceived").withArgs("0x");  
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(0);
      expect(await rpl.balanceOf(mockTarget.target)).to.eq(amountToBorrow);
    });

    it("Should borrow collateral", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, aToken, user, user2, mpc_signer, usdcOwner
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * USDC_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      expect(await liquidityPool.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.emit(liquidityPool, "Borrowed")
      .withArgs(usdc.target, amountToBorrow, user.address, user2.address);  
      expect(await usdc.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amountCollateral - 1n);
    });

    it("Should repay a debt", async function () {
      const {
        liquidityPool, usdc, uni, mpc_signer, user, user2, usdcOwner, uniOwner, USDC_DEC, UNI_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 3n * UNI_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      expect(await liquidityPool.borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.emit(liquidityPool, "Borrowed");  
      expect(await uni.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      await uni.connect(uniOwner).transfer(liquidityPool.target, amountToBorrow);

      expect(await liquidityPool.connect(user).repay([uni.target]))
        .to.emit(liquidityPool, "Repaid");  
      expect(await uni.balanceOf(liquidityPool.target)).to.be.lessThan(amountToBorrow);
    });

    it("Should deposit to aave multiple times", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC;
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount * 2n - 1n);
    });

    it("Should borrow and repay different tokens", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, uni, user, user2, mpc_signer, usdcOwner, uniOwner,
        rplOwner, rplDebtToken, uniDebtToken
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 1n * RPL_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      expect(await liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1))
      .to.emit(liquidityPool, "Borrowed")
      .withArgs(rpl.target, amountToBorrow, user.address, user2.address);  
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337,
        1n
      );

      expect(await liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        1n,
        2000000000n,
        signature2))
      .to.emit(liquidityPool, "Borrowed")
      .withArgs(uni.target, amountToBorrow, user.address, user2.address);  
      expect(await uni.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      // advance time by one hour
      await time.increase(3600);

      const uniDebtBefore = await uniDebtToken.balanceOf(liquidityPool.target);
      const rplDebtBefore = await rplDebtToken.balanceOf(liquidityPool.target);
      expect(uniDebtBefore).to.be.greaterThan(amountToBorrow);
      expect(rplDebtBefore).to.be.greaterThan(amountToBorrow);

      expect(await liquidityPool.connect(user).repay([uni.target]))
        .to.emit(liquidityPool, "Repaid");  
      const uniDebtAfter1 = await uniDebtToken.balanceOf(liquidityPool.target);
      expect(uniDebtAfter1).to.be.lessThan(uniDebtBefore);

      await uni.connect(uniOwner).transfer(liquidityPool.target, amountToBorrow);
      expect(await liquidityPool.connect(user).repay([uni.target]))
      .to.emit(liquidityPool, "Repaid");  
      const uniDebtAfter2 = await uniDebtToken.balanceOf(liquidityPool.target);
      expect(uniDebtAfter2).to.eq(0);

      expect(await liquidityPool.connect(user).repay([rpl.target]))
        .to.emit(liquidityPool, "Repaid");  
      const rplDebtAfter1 = await rplDebtToken.balanceOf(liquidityPool.target);
      expect(rplDebtAfter1).to.be.lessThan(rplDebtBefore);

      await rpl.connect(rplOwner).transfer(liquidityPool.target, amountToBorrow);
      expect(await liquidityPool.connect(user).repay([rpl.target]))
        .to.emit(liquidityPool, "Repaid");  
      const rplDebtAfter2 = await rplDebtToken.balanceOf(liquidityPool.target);
      expect(rplDebtAfter2).to.eq(0);
    });

    it("Should repay if some tokens don't have debt", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, uni, user, user2, mpc_signer, usdcOwner, uniOwner,
        rplOwner, rplDebtToken, uniDebtToken
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        rpl.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      expect(await liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1))
      .to.emit(liquidityPool, "Borrowed")
      .withArgs(rpl.target, amountToBorrow, user.address, user2.address);  
      expect(await rpl.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      // advance time by one hour
      await time.increase(3600);

      const rplDebtBefore = await rplDebtToken.balanceOf(liquidityPool.target);
      expect(rplDebtBefore).to.be.greaterThan(amountToBorrow);

      await uni.connect(uniOwner).transfer(liquidityPool.target, amountToBorrow);
      await rpl.connect(rplOwner).transfer(liquidityPool.target, amountToBorrow);

      expect(await liquidityPool.connect(user).repay([uni.target, rpl.target]))
        .to.emit(liquidityPool, "Repaid");  
      const uniDebtAfter = await uniDebtToken.balanceOf(liquidityPool.target);
      expect(uniDebtAfter).to.eq(0);
      const rplDebtAfter = await rplDebtToken.balanceOf(liquidityPool.target);
      expect(rplDebtAfter).to.eq(0);
    });

    it("Should repay collateral", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, user, user2, mpc_signer, usdcOwner, uniOwner,
        usdcDebtToken, uniDebtToken
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * USDC_DEC;

      const signature1 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        usdc.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      expect(await liquidityPool.connect(user).borrow(
        usdc.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature1))
      .to.emit(liquidityPool, "Borrowed")
      .withArgs(usdc.target, amountToBorrow, user.address, user2.address);  
      expect(await usdc.balanceOf(liquidityPool.target)).to.eq(amountToBorrow);

      // advance time by one hour
      await time.increase(3600);

      const usdcDebtBefore = await usdcDebtToken.balanceOf(liquidityPool.target);
      expect(usdcDebtBefore).to.be.greaterThan(amountToBorrow);

      await usdc.connect(uniOwner).transfer(liquidityPool.target, amountToBorrow);

      expect(await liquidityPool.connect(user).repay([usdc.target]))
        .to.emit(liquidityPool, "Repaid");  
      const usdcDebtAfter = await uniDebtToken.balanceOf(liquidityPool.target);
      expect(usdcDebtAfter).to.eq(0);
    });

    it("Should withdraw collateral from aave", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user, admin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);

      expect(await liquidityPool.connect(admin).withdraw(user.address, amount))
        .to.emit(liquidityPool, "WidthrawnFromAave").withArgs(user.address, amount);
      expect(await usdc.balanceOf(user.address)).to.be.eq(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThan(0);

      // Using type(uint256).max as amount to withdraw all available amount
      expect(await liquidityPool.connect(admin).withdraw(
        user.address, MaxUint256
      ))
        .to.emit(liquidityPool, "WidthrawnFromAave");
      expect(await usdc.balanceOf(user.address)).to.be.greaterThan(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.eq(0);
    });

    it("Should withdraw profit from the pool", async function () {
      const {liquidityPool, uni, UNI_DEC, uniOwner, admin, user} = await loadFixture(deployAll);
      const amount = 2n * UNI_DEC;
      await uni.connect(uniOwner).transfer(liquidityPool.target, amount);
      expect(await liquidityPool.connect(admin).withdrawProfit(uni.target, user.address, amount))
        .to.emit(liquidityPool, "ProfitWithdrawn").withArgs(uni.target, user.address, amount);
      expect(await uni.balanceOf(user.address)).to.eq(amount);
    });

    it.skip("Should deposit, borrow and repay multiple times", async function () {
      // increase time
    });

    it("Should NOT deposit if no collateral on contract", async function () {
      const {liquidityPool} = await loadFixture(deployAll);
      await expect(liquidityPool.deposit())
        .to.be.revertedWithCustomError(liquidityPool, "NoCollateral");
    });

    it("Should NOT borrow if MPC signature is wrong", async function () {
      const {liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, user, user2, usdcOwner} = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;
      const signature = await signBorrow(
        user,
        liquidityPool.target as string,
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
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, user, user2, usdcOwner, mpc_signer
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
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
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, user, user2, usdcOwner, mpc_signer
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;
      const deadline = (await now()) - 1n;
      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
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
        liquidityPool, usdc, uni, mpc_signer, user, user2, usdcOwner, USDC_DEC, UNI_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 10n * UNI_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
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
        liquidityPool, admin, usdc, uni, mpc_signer, user, user2, usdcOwner, USDC_DEC, UNI_DEC
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      expect(await liquidityPool.connect(admin).setHealthFactor(40n * 10n ** 18n))
        .to.emit(liquidityPool, "HealthFactorSet");

      const amountToBorrow = 3n * UNI_DEC;

      const signature2 = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
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
        liquidityPool, mockTarget, usdc, USDC_DEC, rpl, RPL_DEC, user, mpc_signer, usdcOwner
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(rpl.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
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

    it("Should NOT repay if all tokens don't have debt or balance", async function () {
      const {
        liquidityPool, usdc, USDC_DEC, rpl, RPL_DEC, uni, user, mockTarget, mpc_signer, usdcOwner, uniOwner
      } = await loadFixture(deployAll);

      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave");

      const amountToBorrow = 2n * RPL_DEC;

      const additionalData = "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

      const callData = await mockTarget.fulfill.populateTransaction(rpl.target, amountToBorrow, additionalData);

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        rpl.target as string,
        amountToBorrow.toString(),
        mockTarget.target as string,
        callData.data,
        31337
      );

      expect(await liquidityPool.connect(user).borrow(
        rpl.target,
        amountToBorrow,
        mockTarget.target,
        callData.data,
        0n,
        2000000000n,
        signature))
      .to.emit(liquidityPool, "Borrowed")
      .and.to.emit(mockTarget, "DataReceived").withArgs("0x");  
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
        .to.be.revertedWithCustomError(liquidityPool, "TokenNotSupported");
    });

    it("Should NOT withdraw collateral if not enough on aave", async function () {
      const {liquidityPool, usdc, USDC_DEC, usdcOwner, aToken, user, admin} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);

      await expect(liquidityPool.connect(admin).withdraw(user.address, amount * 2n))
        .to.be.reverted;
    });

    it("Should NOT withdraw collateral if health factor is too low", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, user, admin, uni, mpc_signer, UNI_DEC, user2
      } = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);

      const amountToBorrow = 3n * UNI_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      expect(await liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.emit(liquidityPool, "Borrowed");

      await expect(liquidityPool.connect(admin).withdraw(user.address, 900000000n))
        .to.be.revertedWithCustomError(liquidityPool, "HealthFactorTooLow");
    });

    it("Should NOT withdraw collateral by unauthorized user", async function () {
      const {liquidityPool, usdc, usdcOwner, USDC_DEC, aToken, user} = await loadFixture(deployAll);
      const amount = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amount);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amount);
      expect(await aToken.balanceOf(liquidityPool.target)).to.be.greaterThanOrEqual(amount - 1n);

      await expect(liquidityPool.connect(user).withdraw(user.address, amount * 2n))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });

    it("Should NOT withdraw profit for collateral", async function () {
      const {liquidityPool, usdc, admin, user} = await loadFixture(deployAll);
      const amount = 1000n;
      await expect(liquidityPool.connect(admin).withdrawProfit(usdc.target, user.address, amount))
        .to.be.revertedWithCustomError(liquidityPool, "CannotWithdrawProfitCollateral");
    });

    it("Should NOT withdraw profit if the token has debt", async function () {
      const {
        liquidityPool, usdc, usdcOwner, USDC_DEC, user, admin, uni, uniOwner,  mpc_signer, UNI_DEC, user2
      } = await loadFixture(deployAll);
      const amountCollateral = 1000n * USDC_DEC; // $1000
      await usdc.connect(usdcOwner).transfer(liquidityPool.target, amountCollateral);
      expect(await liquidityPool.deposit())
        .to.emit(liquidityPool, "SuppliedToAave").withArgs(amountCollateral);

      const amountToBorrow = 3n * UNI_DEC;

      const signature = await signBorrow(
        mpc_signer,
        liquidityPool.target as string,
        uni.target as string,
        amountToBorrow.toString(),
        user2.address,
        "0x",
        31337
      );

      expect(await liquidityPool.connect(user).borrow(
        uni.target,
        amountToBorrow,
        user2,
        "0x",
        0n,
        2000000000n,
        signature))
      .to.emit(liquidityPool, "Borrowed");

      const amountProfit = 100000n;
      await uni.connect(uniOwner).transfer(liquidityPool.target, amountProfit);
      await expect(liquidityPool.connect(admin).withdrawProfit(uni.target, user.address, amountProfit))
        .to.be.revertedWithCustomError(liquidityPool, "TokenHasDebt")
    });

    it("Should NOT withdraw profit by unauthorized user", async function () {
      const {liquidityPool, uni, user} = await loadFixture(deployAll);
      const amount = 1000n;
      await expect(liquidityPool.connect(user).withdrawProfit(uni.target, user.address, amount))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Admin functions", function () {
    it("Should set default token LTV", async function () {
      const {liquidityPool, admin, user} = await loadFixture(deployAll);
      const defaultLtv = 1000;
      await expect(liquidityPool.connect(user).setDefaultLTV(defaultLtv))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
      expect(await liquidityPool.connect(admin).setDefaultLTV(defaultLtv))
        .to.emit(liquidityPool, "DefaultLtvSet");
      expect(await liquidityPool.defaultLTV())
        .to.eq(defaultLtv);
    });

    it("Should set token LTV for each token", async function () {
      const {liquidityPool, admin, user, uni} = await loadFixture(deployAll);
      const ltv = 1000;
      await expect(liquidityPool.connect(user).setBorrowTokenLTV(uni.target, ltv))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
      expect(await liquidityPool.connect(admin).setBorrowTokenLTV(uni.target, ltv))
        .to.emit(liquidityPool, "DefaultLtvSet");
      expect(await liquidityPool.borrowTokenLTV(uni.target))
        .to.eq(ltv);
    });

    it("Should set minimal health factor", async function () {
      const {liquidityPool, admin, user} = await loadFixture(deployAll);
      const healthFactor = 5n * 10n ** 18n;
      await expect(liquidityPool.connect(user).setHealthFactor(healthFactor))
        .to.be.revertedWithCustomError(liquidityPool, "AccessControlUnauthorizedAccount");
      expect(await liquidityPool.connect(admin).setHealthFactor(healthFactor))
        .to.emit(liquidityPool, "HealthFactorSet");
      expect(await liquidityPool.healthFactor())
        .to.eq(healthFactor);
    });
  });
});
