import {
  loadFixture, time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {Signature, resolveAddress, MaxUint256, getBigInt} from "ethers";
import {
  getCreateAddress, getContractAt, deploy,
  ZERO_ADDRESS, ZERO_BYTES32, divCeil,
} from "./helpers";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub, TransparentUpgradeableProxy, ProxyAdmin,
  TestLiquidityPool, SprinterLiquidityMining,
} from "../typechain-types";

const DAY = 60n * 60n * 24n;
const MONTH = 30n * DAY;

async function now() {
  return BigInt(await time.latest());
}

describe("SprinterLiquidityMining", function () {
  const deployAll = async () => {
    const [deployer, admin, user, user2, user3] = await hre.ethers.getSigners();

    const DEFAULT_ADMIN_ROLE = ZERO_BYTES32;

    const usdc = (await deploy("TestUSDC", deployer, {})) as TestUSDC;
    const liquidityPool = (await deploy("TestLiquidityPool", deployer, {}, usdc.target)) as TestLiquidityPool;

    const USDC = 10n ** (await usdc.decimals());

    const startingNonce = await deployer.getNonce();

    const liquidityHubAddress = await getCreateAddress(deployer, startingNonce + 2);
    const lpToken = (
      await deploy("SprinterUSDCLPShare", deployer, {nonce: startingNonce + 0}, liquidityHubAddress)
    ) as SprinterUSDCLPShare;
    const LP = 10n ** (await lpToken.decimals());

    const liquidityHubImpl = (
      await deploy("LiquidityHub", deployer, {nonce: startingNonce + 1}, lpToken.target, liquidityPool.target)
    ) as LiquidityHub;
    const liquidityHubInit = (await liquidityHubImpl.initialize.populateTransaction(
      usdc.target, admin.address, admin.address, getBigInt(MaxUint256) * USDC / LP)
    ).data;
    const liquidityHubProxy = (await deploy(
      "TransparentUpgradeableProxy", deployer, {nonce: startingNonce + 2},
      liquidityHubImpl.target, admin, liquidityHubInit
    )) as TransparentUpgradeableProxy;
    const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress, deployer)) as LiquidityHub;
    const liquidityHubProxyAdminAddress = await getCreateAddress(liquidityHubProxy, 1);
    const liquidityHubAdmin = (await getContractAt("ProxyAdmin", liquidityHubProxyAdminAddress, admin)) as ProxyAdmin;

    const tiers = [
      {period: 3n * MONTH, multiplier: 100n},
      {period: 6n * MONTH, multiplier: 150n},
      {period: 12n * MONTH, multiplier: 200n},
    ];

    const liquidityMining = (
      await deploy("SprinterLiquidityMining", deployer, {}, admin.address, liquidityHub.target, tiers)
    ) as SprinterLiquidityMining;

    await liquidityPool.grantRole(DEFAULT_ADMIN_ROLE, liquidityHub.target);

    return {deployer, admin, user, user2, user3, usdc, lpToken,
      liquidityHub, liquidityHubProxy, liquidityHubAdmin, USDC, LP, liquidityPool, liquidityMining};
  };

  it("Should have default values", async function () {
    const {
      lpToken, liquidityHub, user, user2,
      liquidityMining, admin,
    } = await loadFixture(deployAll);

    expect(await liquidityMining.LIQUIDITY_HUB()).to.equal(liquidityHub.target);
    expect(await liquidityMining.name()).to.equal("Sprinter USDC LP Score");
    expect(await liquidityMining.symbol()).to.equal("sprUSDC-LP-Score");
    expect(await liquidityMining.decimals()).to.equal(18n);
    expect(await liquidityMining.owner()).to.equal(admin.address);
    expect(await liquidityMining.MULTIPLIER_PRECISION()).to.equal(100n);
    expect(await liquidityMining.STAKING_TOKEN()).to.equal(lpToken.target);
    expect(await liquidityMining.miningAllowed()).to.be.true;
    expect(await liquidityMining.tiers(0)).to.eql([3n * MONTH, 100n]);
    expect(await liquidityMining.tiers(1)).to.eql([6n * MONTH, 150n]);
    expect(await liquidityMining.tiers(2)).to.eql([12n * MONTH, 200n]);
    expect(await liquidityMining.stakes(user.address)).to.eql([0n, 0n, 0n, 0n]);

    await expect(liquidityHub.transfer(user.address, 1n))
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.approve(user.address, 1n))
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityHub.transferFrom(user.address, user2.address, 1n))
      .to.be.revertedWithCustomError(liquidityHub, "NotImplemented()");
    await expect(liquidityMining.tiers(3)).to.be.reverted;
  });

  it("Should allow to stake", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    const tx = liquidityMining.connect(user).stake(user.address, 10n * LP, 0n);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, liquidityMining.target, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
    const until = await now() + 3n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user.address,
        10n * LP,
        10n * LP,
        until,
        10n * LP,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([10n * LP, 3n * MONTH, until, 100n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should allow to stake by multiple users", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(deployer).transfer(user2.address, 20n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await usdc.connect(user2).approve(liquidityHub.target, 20n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await liquidityHub.connect(user2).deposit(20n * USDC, user2.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    await lpToken.connect(user2).approve(liquidityMining.target, 20n * LP);
    const tx = liquidityMining.connect(user).stake(user.address, 10n * LP, 0n);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, liquidityMining.target, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP);
    const until = await now() + 3n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user.address,
        10n * LP,
        10n * LP,
        until,
        10n * LP,
      );
    const tx2 = liquidityMining.connect(user2).stake(user2.address, 20n * LP, 1n);
    await expect(tx2)
      .to.emit(lpToken, "Transfer")
      .withArgs(user2.address, liquidityMining.target, 20n * LP);
    await expect(tx2)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user2.address, 20n * LP * 150n / 100n);
    const until2 = await now() + 6n * MONTH;
    await expect(tx2)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user2.address,
        user2.address,
        20n * LP,
        20n * LP,
        until2,
        20n * LP * 150n / 100n,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user2.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(30n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP + 20n * LP * 150n / 100n);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(20n * LP * 150n / 100n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(30n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([10n * LP, 3n * MONTH, until, 100n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([20n * LP, 6n * MONTH, until2, 150n]);
  });

  it("Should allow to stake with a score to another address", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    const tx = liquidityMining.connect(user).stake(user2.address, 10n * LP, 0n);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, liquidityMining.target, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user2.address, 10n * LP);
    const until = await now() + 3n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user2.address,
        10n * LP,
        10n * LP,
        until,
        10n * LP,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([10n * LP, 3n * MONTH, until, 100n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should allow to stake with a different tier", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    const tx = liquidityMining.connect(user).stake(user.address, 10n * LP, 1n);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, liquidityMining.target, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP * 150n / 100n);
    const until = await now() + 6n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user.address,
        10n * LP,
        10n * LP,
        until,
        10n * LP * 150n / 100n,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP * 150n / 100n);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(10n * LP * 150n / 100n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([10n * LP, 6n * MONTH, until, 150n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should allow to stake with permit", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    
    const domain = {
      name: "Sprinter USDC LP Share",
      version: "1",
      chainId: hre.network.config.chainId,
      verifyingContract: await resolveAddress(lpToken),
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

    const permitSig = Signature.from(await user.signTypedData(domain, types, {
      owner: user.address,
      spender: liquidityMining.target,
      value: 10n * LP,
      nonce: 0n,
      deadline: 2000000000n,
    }));
    
    const tx = liquidityMining.connect(user).stakeWithPermit(
      user2.address,
      10n * LP,
      0n,
      2000000000n,
      permitSig.v,
      permitSig.r,
      permitSig.s,
    );
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, liquidityMining.target, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user2.address, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user2.address,
        10n * LP,
        10n * LP,
        await now() + 3n * MONTH,
        10n * LP,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
  });

  it("Should allow to unstake", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    await liquidityMining.connect(user).stake(user2.address, 10n * LP, 0n);

    await time.increase(3n * MONTH);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);

    const tx = liquidityMining.connect(user).unstake(user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(liquidityMining.target, user.address, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "StakeUnlocked")
      .withArgs(user.address, user.address, 10n * LP);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(0n);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
  });

  it("Should allow to unstake to another address", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    await liquidityMining.connect(user).stake(user2.address, 10n * LP, 0n);

    await time.increase(3n * MONTH);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);

    const tx = liquidityMining.connect(user).unstake(user2.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(liquidityMining.target, user2.address, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "StakeUnlocked")
      .withArgs(user.address, user2.address, 10n * LP);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(0n);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
  });

  it("Should allow admin to disable mining", async function () {
    const {
      liquidityMining, admin,
    } = await loadFixture(deployAll);

    const tx = liquidityMining.connect(admin).disableMining();
    await expect(tx)
      .to.emit(liquidityMining, "DisableMining");
    expect(await liquidityMining.miningAllowed()).to.be.false;

    await expect(liquidityMining.connect(admin).disableMining())
      .to.be.revertedWithCustomError(liquidityMining, "AlreadyDisabled()");
  });

  it("Should not allow others to disable mining", async function () {
    const {
      user, liquidityMining,
    } = await loadFixture(deployAll);

    await expect(liquidityMining.connect(user).disableMining())
      .to.be.revertedWithCustomError(liquidityMining, "OwnableUnauthorizedAccount(address)");
  });

  it("Should not allow to stake if mining is disabled", async function () {
    const {
      lpToken, liquidityHub, usdc, user, USDC, LP,
      liquidityMining, admin, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);

    await liquidityMining.connect(admin).disableMining();
    await expect(liquidityMining.connect(user).stake(user.address, 10n * LP, 0n))
      .to.be.revertedWithCustomError(liquidityMining, "MiningDisabled()");
  });

  it("Should not allow to stake with permit if mining is disabled", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, USDC, LP,
      liquidityMining, admin, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    
    const domain = {
      name: "Sprinter USDC LP Share",
      version: "1",
      chainId: hre.network.config.chainId,
      verifyingContract: await resolveAddress(lpToken),
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

    const permitSig = Signature.from(await user.signTypedData(domain, types, {
      owner: user.address,
      spender: liquidityMining.target,
      value: 10n * LP,
      nonce: 0n,
      deadline: 2000000000n,
    }));
    
    await liquidityMining.connect(admin).disableMining();
    await expect(liquidityMining.connect(user).stakeWithPermit(
      user2.address,
      10n * LP,
      0n,
      2000000000n,
      permitSig.v,
      permitSig.r,
      permitSig.s,
    )).to.be.revertedWithCustomError(liquidityMining, "MiningDisabled()");
  });

  it("Should allow to unstake if mining is disabled", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, admin, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    await liquidityMining.connect(user).stake(user2.address, 10n * LP, 0n);

    await time.increase(3n * MONTH);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);

    await liquidityMining.connect(admin).disableMining();
    const tx = liquidityMining.connect(user).unstake(user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(liquidityMining.target, user.address, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "StakeUnlocked")
      .withArgs(user.address, user.address, 10n * LP);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(0n);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
  });

  it("Should not allow to stake 0 amount", async function () {
    const {
      lpToken, liquidityHub, usdc, user, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);

    await expect(liquidityMining.connect(user).stake(user.address, 0n, 0n))
      .to.be.revertedWithCustomError(liquidityMining, "InvalidAddedScore()");
  });

  it("Should allow to restake by staking 0 amount", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    await liquidityMining.connect(user).stake(user.address, 10n * LP, 0n);
    const extraSeconds = 100n;
    await time.setNextBlockTimestamp(await now() + extraSeconds);
    const tx = liquidityMining.connect(user).stake(user.address, 0n, 0n);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, 10n * LP * extraSeconds / (3n * MONTH));
    const until = await now() + 3n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user.address,
        0n,
        10n * LP,
        until,
        10n * LP * extraSeconds / (3n * MONTH),
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP * (3n * MONTH + extraSeconds) / (3n * MONTH));
    expect(await liquidityMining.balanceOf(user.address)).to.equal(10n * LP * (3n * MONTH + extraSeconds) / (3n * MONTH));
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([10n * LP, 3n * MONTH, until, 100n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should allow to restake by staking positive amount", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 11n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 11n * USDC);
    await liquidityHub.connect(user).deposit(11n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 11n * LP);
    await liquidityMining.connect(user).stake(user.address, 10n * LP, 0n);
    const extraSeconds = 100n;
    await time.setNextBlockTimestamp(await now() + extraSeconds);
    const addedScore = 10n * LP * extraSeconds / (3n * MONTH) + 1n * LP;
    const tx = liquidityMining.connect(user).stake(user.address, 1n * LP, 0n);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(user.address, liquidityMining.target, 1n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, addedScore);
    const until = await now() + 3n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user.address,
        1n * LP,
        11n * LP,
        until,
        addedScore,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(11n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP + addedScore);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(10n * LP + addedScore);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(11n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([11n * LP, 3n * MONTH, until, 100n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should allow to restake into longer tier with 0 amount", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    await liquidityMining.connect(user).stake(user.address, 10n * LP, 0n);
    const extraSeconds = 100n;
    await time.setNextBlockTimestamp(await now() + extraSeconds);
    const tx = liquidityMining.connect(user).stake(user.address, 0n, 1n);
    const addedScore = 10n * LP * 150n / 100n - divCeil(10n * LP * (3n * MONTH - extraSeconds), 3n * MONTH);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, addedScore);
    const until = await now() + 6n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user.address,
        0n,
        10n * LP,
        until,
        addedScore,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP + addedScore);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(10n * LP + addedScore);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([10n * LP, 6n * MONTH, until, 150n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should allow to restake into longer tier with positive amount", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 11n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 11n * USDC);
    await liquidityHub.connect(user).deposit(11n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 11n * LP);
    await liquidityMining.connect(user).stake(user.address, 10n * LP, 0n);
    const extraSeconds = 100n;
    await time.setNextBlockTimestamp(await now() + extraSeconds);
    const tx = liquidityMining.connect(user).stake(user.address, 1n * LP, 1n);
    const addedScore = 11n * LP * 150n / 100n - divCeil(10n * LP * (3n * MONTH - extraSeconds), 3n * MONTH);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, addedScore);
    const until = await now() + 6n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user.address,
        1n * LP,
        11n * LP,
        until,
        addedScore,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(11n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP + addedScore);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(10n * LP + addedScore);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(11n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([11n * LP, 6n * MONTH, until, 150n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should allow to restake into shorter tier if remaining time is even shorter", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 11n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 11n * USDC);
    await liquidityHub.connect(user).deposit(11n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 11n * LP);
    await liquidityMining.connect(user).stake(user.address, 10n * LP, 1n);
    const extraSeconds = 5n * MONTH;
    await time.setNextBlockTimestamp(await now() + extraSeconds);
    const tx = liquidityMining.connect(user).stake(user.address, 1n * LP, 0n);
    const addedScore = 11n * LP - 10n * LP * (6n * MONTH - extraSeconds) * 150n / (100n * 6n * MONTH);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user.address, addedScore);
    const until = await now() + 3n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user.address,
        1n * LP,
        11n * LP,
        until,
        addedScore,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(11n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP * 150n / 100n + addedScore);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(10n * LP * 150n / 100n + addedScore);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(0n);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(11n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([11n * LP, 3n * MONTH, until, 100n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should allow to unstake after restaking", async function () {
    const {
      lpToken, liquidityHub, usdc, user, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    await liquidityMining.connect(user).stake(user.address, 10n * LP, 0n);
    const extraSeconds = 100n;
    await time.setNextBlockTimestamp(await now() + extraSeconds);
    await liquidityMining.connect(user).stake(user.address, 0n, 0n);
    await time.increase(3n * MONTH);

    const tx = liquidityMining.connect(user).unstake(user.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(liquidityMining.target, user.address, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "StakeUnlocked")
      .withArgs(user.address, user.address, 10n * LP);
    expect(await lpToken.balanceOf(user.address)).to.equal(10n * LP);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(0n);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP * (3n * MONTH + extraSeconds) / (3n * MONTH));
    expect(await liquidityMining.balanceOf(user.address)).to.equal(10n * LP * (3n * MONTH + extraSeconds) / (3n * MONTH));
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should not allow to decrease remaining staking period", async function () {
    const {
      lpToken, liquidityHub, usdc, user, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 11n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 11n * USDC);
    await liquidityHub.connect(user).deposit(11n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 11n * LP);
    await liquidityMining.connect(user).stake(user.address, 10n * LP, 1n);

    await expect(liquidityMining.connect(user).stake(user.address, 1n * LP, 0n))
      .to.be.revertedWithCustomError(liquidityMining, "DecreasingPeriod()");
    await expect(liquidityMining.connect(user).stake(user.address, 0n, 0n))
      .to.be.revertedWithCustomError(liquidityMining, "DecreasingPeriod()");
  });

  it("Should not allow to restake with 0 or negative added score", async function () {
    const {
      lpToken, liquidityHub, usdc, user, USDC, LP,
      deployer, admin,
    } = await loadFixture(deployAll);

    const tiers = [
      {period: 3n * MONTH, multiplier: 100n},
      {period: 6n * MONTH, multiplier: 10n},
    ];

    const liquidityMining = (
      await deploy("SprinterLiquidityMining", deployer, {}, admin.address, liquidityHub.target, tiers)
    ) as SprinterLiquidityMining;

    await usdc.connect(deployer).transfer(user.address, 11n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 11n * USDC);
    await liquidityHub.connect(user).deposit(11n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 11n * LP);
    await liquidityMining.connect(user).stake(user.address, 10n * LP, 0n);

    await expect(liquidityMining.connect(user).stake(user.address, 1n * LP, 1n))
      .to.be.revertedWithCustomError(liquidityMining, "InvalidAddedScore()");
    await expect(liquidityMining.connect(user).stake(user.address, 0n, 1n))
      .to.be.revertedWithCustomError(liquidityMining, "InvalidAddedScore()");
  });

  it("Should not allow to unstake too early", async function () {
    const {
      lpToken, liquidityHub, usdc, user, USDC, LP,
      liquidityMining, deployer, user2,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    await liquidityMining.connect(user).stake(user.address, 10n * LP, 0n);

    await time.increase(3n * MONTH - 10n);

    await expect(liquidityMining.connect(user).unstake(user.address))
      .to.be.revertedWithCustomError(liquidityMining, "Locked()");
    await expect(liquidityMining.connect(user).unstake(user2.address))
      .to.be.revertedWithCustomError(liquidityMining, "Locked()");
  });

  it("Should not allow to unstake 0 amount", async function () {
    const {
      lpToken, liquidityHub, usdc, user, USDC, LP,
      liquidityMining, deployer, user2,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    await liquidityMining.connect(user).stake(user.address, 10n * LP, 0n);

    await time.increase(3n * MONTH + 1n);

    await expect(liquidityMining.connect(user2).unstake(user2.address))
      .to.be.revertedWithCustomError(liquidityMining, "ZeroAmount()");
    await liquidityMining.connect(user).unstake(user.address);
    await expect(liquidityMining.connect(user).unstake(user.address))
      .to.be.revertedWithCustomError(liquidityMining, "ZeroAmount()");
  });

  it("Should not allow to deploy with invalid parameters", async function () {
    const {
      liquidityHub, deployer, admin, liquidityMining,
    } = await loadFixture(deployAll);

    const tiers = [
      {period: 3n * MONTH, multiplier: 100n},
      {period: 6n * MONTH, multiplier: 10n},
    ];

    await expect(deploy("SprinterLiquidityMining", deployer, {}, admin.address, ZERO_ADDRESS, tiers))
      .to.be.reverted;
    await expect(deploy("SprinterLiquidityMining", deployer, {}, admin.address, liquidityHub.target, []))
      .to.be.revertedWithCustomError(liquidityMining, "EmptyInput()");
    const tiersZeroPeriod = [
      {period: 0n, multiplier: 100n},
      {period: 6n * MONTH, multiplier: 10n},
    ];
    await expect(deploy("SprinterLiquidityMining", deployer, {}, admin.address, liquidityHub.target, tiersZeroPeriod))
      .to.be.revertedWithCustomError(liquidityMining, "ZeroPeriod()");
    const tiersZeroMultiplier = [
      {period: 3n * MONTH, multiplier: 100n},
      {period: 6n * MONTH, multiplier: 0n},
    ];
    await expect(
      deploy("SprinterLiquidityMining", deployer, {}, admin.address, liquidityHub.target, tiersZeroMultiplier)
    ).to.be.revertedWithCustomError(liquidityMining, "ZeroMultiplier()");
    const tiersSamePeriod = [
      {period: 3n * MONTH, multiplier: 100n},
      {period: 3n * MONTH, multiplier: 10n},
    ];
    await expect(
      deploy("SprinterLiquidityMining", deployer, {}, admin.address, liquidityHub.target, tiersSamePeriod)
    ).to.be.revertedWithCustomError(liquidityMining, "DecreasingPeriod()");
    const tiersDecreasingPeriod = [
      {period: 3n * MONTH, multiplier: 100n},
      {period: 3n * MONTH - 1n, multiplier: 10n},
    ];
    await expect(
      deploy("SprinterLiquidityMining", deployer, {}, admin.address, liquidityHub.target, tiersDecreasingPeriod)
    ).to.be.revertedWithCustomError(liquidityMining, "DecreasingPeriod()");
  });

  it("Should allow to deposit and stake", async function () {
    const {
      lpToken, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityMining.target, 10n * USDC);
    const tx = liquidityMining.connect(user).depositAndStake(user2.address, 10n * USDC, 0n);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityMining.target, 10n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityMining.target, liquidityPool.target, 10n * USDC);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, liquidityMining.target, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user2.address, 10n * LP);
    const until = await now() + 3n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user2.address,
        10n * LP,
        10n * LP,
        until,
        10n * LP,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user2.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([10n * LP, 3n * MONTH, until, 100n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should allow to deposit and stake with permit", async function () {
    const {
      lpToken, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);

    const domain = {
      name: "Circle USD",
      version: "1",
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

    const permitSig = Signature.from(await user.signTypedData(domain, types, {
      owner: user.address,
      spender: liquidityMining.target,
      value: 10n * USDC,
      nonce: 0n,
      deadline: 2000000000n,
    }));

    const tx = liquidityMining.connect(user).depositAndStakeWithPermit(
      user2.address,
      10n * USDC,
      0n,
      2000000000n,
      permitSig.v,
      permitSig.r,
      permitSig.s,
    );
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(user.address, liquidityMining.target, 10n * USDC);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityMining.target, liquidityPool.target, 10n * USDC);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(ZERO_ADDRESS, liquidityMining.target, 10n * LP);
    await expect(tx)
      .to.emit(liquidityMining, "Transfer")
      .withArgs(ZERO_ADDRESS, user2.address, 10n * LP);
    const until = await now() + 3n * MONTH;
    await expect(tx)
      .to.emit(liquidityMining, "StakeLocked")
      .withArgs(
        user.address,
        user2.address,
        10n * LP,
        10n * LP,
        until,
        10n * LP,
      );
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user2.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(10n * LP);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(10n * USDC);
    expect(await liquidityMining.stakes(user.address)).to.eql([10n * LP, 3n * MONTH, until, 100n]);
    expect(await liquidityMining.stakes(user2.address)).to.eql([0n, 0n, 0n, 0n]);
  });

  it("Should allow to unstake and withdraw", async function () {
    const {
      lpToken, liquidityHub, usdc, user, user2, liquidityPool, USDC, LP,
      liquidityMining, deployer,
    } = await loadFixture(deployAll);

    await usdc.connect(deployer).transfer(user.address, 10n * USDC);
    await usdc.connect(user).approve(liquidityHub.target, 10n * USDC);
    await liquidityHub.connect(user).deposit(10n * USDC, user.address);
    await lpToken.connect(user).approve(liquidityMining.target, 10n * LP);
    await liquidityMining.connect(user).stake(user2.address, 10n * LP, 0n);

    await time.increase(3n * MONTH);

    const tx = liquidityMining.connect(user).unstakeAndWithdraw(user2.address);
    await expect(tx)
      .to.emit(lpToken, "Transfer")
      .withArgs(liquidityMining.target, ZERO_ADDRESS, 10n * LP);
    await expect(tx)
      .to.emit(usdc, "Transfer")
      .withArgs(liquidityPool.target, user2.address, 10n * USDC);
    await expect(tx)
      .to.emit(liquidityMining, "StakeUnlocked")
      .withArgs(user.address, liquidityMining.target, 10n * LP);
    expect(await lpToken.balanceOf(user.address)).to.equal(0n);
    expect(await lpToken.balanceOf(user2.address)).to.equal(0n);
    expect(await lpToken.balanceOf(liquidityMining.target)).to.equal(0n);
    expect(await liquidityMining.totalSupply()).to.equal(10n * LP);
    expect(await liquidityMining.balanceOf(user.address)).to.equal(0n);
    expect(await liquidityMining.balanceOf(user2.address)).to.equal(10n * LP);
    expect(await usdc.balanceOf(liquidityPool.target)).to.equal(0n);
    expect(await usdc.balanceOf(user.address)).to.equal(0n);
    expect(await usdc.balanceOf(user2.address)).to.equal(10n * USDC);
  });
});
