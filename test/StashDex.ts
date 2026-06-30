import {loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {deploy, getContractAt, setupTests} from "./helpers";
import {addressToBytes32, ZERO_ADDRESS, DEFAULT_ADMIN_ROLE} from "../scripts/common";
import {
  TestUSDC, TestWETH, PaxosOracle, StashDex, TestLiquidityPool, TransparentUpgradeableProxy, MockBorrowSwap,
} from "../typechain-types";

describe("StashDex", function () {
  setupTests();

  const deployAll = async () => {
    const [deployer, admin, configAdmin, pauser, forwarder, user, user2, processor, receiver] =
      await hre.ethers.getSigners();

    const usdcRef = (await deploy("TestUSDC", deployer)) as TestUSDC;
    const tokenA = (await deploy("TestUSDC", deployer)) as TestUSDC;  // 6 decimals
    const tokenB = (await deploy("TestUSDC", deployer)) as TestUSDC;  // 6 decimals
    const tokenC = (await deploy("TestWETH", deployer)) as TestWETH;  // 18 decimals

    const USDC = 10n ** 6n;
    const WETH = 10n ** 18n;

    const oracle = (await deploy("PaxosOracle", deployer, {}, admin, usdcRef, [
      {assetId: addressToBytes32(tokenA.target), decimals: 6},
      {assetId: addressToBytes32(tokenB.target), decimals: 6},
      {assetId: addressToBytes32(tokenC.target), decimals: 18},
    ])) as PaxosOracle;

    const pool = (await deploy("TestLiquidityPool", deployer, {}, tokenA, admin, ZERO_ADDRESS)) as TestLiquidityPool;

    const stashDexImpl = (await deploy("StashDex", deployer, {}, oracle, receiver)) as StashDex;
    const initData = (await stashDexImpl.initialize.populateTransaction(
      admin, configAdmin, pauser, forwarder, [], []
    )).data;
    const proxy = (await deploy(
      "TransparentUpgradeableProxy", deployer, {}, stashDexImpl, admin, initData
    )) as TransparentUpgradeableProxy;
    const stashDex = (await getContractAt("StashDex", proxy, deployer)) as StashDex;

    const CONFIG_ROLE = await stashDex.CONFIG_ROLE();
    const PAUSER_ROLE = await stashDex.PAUSER_ROLE();
    const FORWARD_ROLE = await stashDex.FORWARD_ROLE();
    const USER_ROLE = await stashDex.USER_ROLE();
    await stashDex.connect(admin).grantRole(USER_ROLE, user);

    return {
      deployer, admin, configAdmin, pauser, forwarder, user, user2, processor, receiver,
      tokenA, tokenB, tokenC, usdcRef, oracle, pool, stashDex, stashDexImpl,
      CONFIG_ROLE, PAUSER_ROLE, FORWARD_ROLE, USER_ROLE, USDC, WETH,
    };
  };

  describe("Deployment & Initialization", function () {
    it("constructor reverts ZeroAddress when oracle is zero", async function () {
      const {deployer, receiver, stashDex} = await loadFixture(deployAll);
      await expect(deploy("StashDex", deployer, {}, ZERO_ADDRESS, receiver))
        .to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("constructor reverts ZeroAddress when receiver is zero", async function () {
      const {deployer, oracle, stashDex} = await loadFixture(deployAll);
      await expect(deploy("StashDex", deployer, {}, oracle, ZERO_ADDRESS))
        .to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("constructor stores ORACLE and RECEIVER as immutables", async function () {
      const {stashDex, oracle, receiver} = await loadFixture(deployAll);
      expect(await stashDex.ORACLE()).to.equal(oracle.target);
      expect(await stashDex.RECEIVER()).to.equal(receiver.address);
    });

    it("initialize reverts ZeroAddress for each role address individually", async function () {
      const {stashDexImpl, admin, configAdmin, pauser, forwarder, deployer} = await loadFixture(deployAll);
      const proxy = await deploy("TransparentUpgradeableProxy", deployer, {}, stashDexImpl, admin, "0x");
      const dex = (await getContractAt("StashDex", proxy, deployer)) as StashDex;
      await expect(dex.initialize(ZERO_ADDRESS, configAdmin, pauser, forwarder, [], []))
        .to.be.revertedWithCustomError(dex, "ZeroAddress");
      await expect(dex.initialize(admin, ZERO_ADDRESS, pauser, forwarder, [], []))
        .to.be.revertedWithCustomError(dex, "ZeroAddress");
      await expect(dex.initialize(admin, configAdmin, ZERO_ADDRESS, forwarder, [], []))
        .to.be.revertedWithCustomError(dex, "ZeroAddress");
      await expect(dex.initialize(admin, configAdmin, pauser, ZERO_ADDRESS, [], []))
        .to.be.revertedWithCustomError(dex, "ZeroAddress");
    });

    it("initialize grants all four roles to the respective addresses", async function () {
      const {stashDex, admin, configAdmin, pauser, forwarder, CONFIG_ROLE, PAUSER_ROLE, FORWARD_ROLE} =
        await loadFixture(deployAll);
      expect(await stashDex.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.be.true;
      expect(await stashDex.hasRole(CONFIG_ROLE, configAdmin)).to.be.true;
      expect(await stashDex.hasRole(PAUSER_ROLE, pauser)).to.be.true;
      expect(await stashDex.hasRole(FORWARD_ROLE, forwarder)).to.be.true;
    });

    it("initialize with initial pools and routes configures them", async function () {
      const {deployer, admin, configAdmin, pauser, forwarder, oracle, receiver, pool, tokenA, tokenB, processor} =
        await loadFixture(deployAll);
      const impl = (await deploy("StashDex", deployer, {}, oracle, receiver)) as StashDex;
      const initData = (await impl.initialize.populateTransaction(
        admin, configAdmin, pauser, forwarder,
        [{token: tokenB, pool}],
        [{tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor}],
      )).data;
      const proxy = (await deploy(
        "TransparentUpgradeableProxy", deployer, {}, impl, admin, initData
      )) as TransparentUpgradeableProxy;
      const dex = (await getContractAt("StashDex", proxy, deployer)) as StashDex;

      expect(await dex.getPool(tokenB)).to.equal(pool.target);
      const route = await dex.getRoute(tokenA, tokenB);
      expect(route.allowed).to.be.true;
      expect(route.feeBps).to.equal(3);
      expect(route.processor).to.equal(processor.address);
    });

    it("cannot call initialize twice on the proxy", async function () {
      const {stashDex, admin, configAdmin, pauser, forwarder} = await loadFixture(deployAll);
      await expect(stashDex.initialize(admin, configAdmin, pauser, forwarder, [], []))
        .to.be.reverted;
    });

    it("cannot call initialize on the implementation", async function () {
      const {stashDexImpl, admin, configAdmin, pauser, forwarder} = await loadFixture(deployAll);
      await expect(stashDexImpl.initialize(admin, configAdmin, pauser, forwarder, [], []))
        .to.be.reverted;
    });
  });

  describe("setPool", function () {
    it("reverts AccessControlUnauthorizedAccount when caller lacks CONFIG_ROLE", async function () {
      const {stashDex, user, tokenB, pool} = await loadFixture(deployAll);
      await expect(stashDex.connect(user).setPool(tokenB, pool))
        .to.be.revertedWithCustomError(stashDex, "AccessControlUnauthorizedAccount");
    });

    it("reverts ZeroAddress when token is zero", async function () {
      const {stashDex, configAdmin, pool} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setPool(ZERO_ADDRESS, pool))
        .to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("reverts ZeroAddress when pool is zero", async function () {
      const {stashDex, configAdmin, tokenB} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setPool(tokenB, ZERO_ADDRESS))
        .to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("stores pool and emits PoolSet", async function () {
      const {stashDex, configAdmin, tokenB, pool} = await loadFixture(deployAll);
      const tx = await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await expect(tx).to.emit(stashDex, "PoolSet").withArgs(tokenB.target, pool.target);
      expect(await stashDex.getPool(tokenB)).to.equal(pool.target);
    });

    it("grants unlimited allowance to the pool for its token", async function () {
      const {stashDex, configAdmin, tokenB, pool} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      expect(await tokenB.allowance(stashDex, pool)).to.equal(hre.ethers.MaxUint256);
    });

    it("resets old pool allowance to 0 and grants unlimited allowance to new pool", async function () {
      const {stashDex, configAdmin, deployer, admin, tokenB, pool} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      const pool2 = (await deploy(
        "TestLiquidityPool", deployer, {}, tokenB, admin, ZERO_ADDRESS
      )) as TestLiquidityPool;
      await stashDex.connect(configAdmin).setPool(tokenB, pool2);
      expect(await tokenB.allowance(stashDex, pool)).to.equal(0n);
      expect(await tokenB.allowance(stashDex, pool2)).to.equal(hre.ethers.MaxUint256);
    });

    it("reverts OutstandingDebt when changing to a different pool while totalBorrowed is positive", async function () {
      const {stashDex, configAdmin, deployer, admin, user, user2, tokenA, tokenB, pool, processor, USDC} =
        await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2);

      const pool2 = (await deploy("TestLiquidityPool", deployer, {}, tokenA, admin, ZERO_ADDRESS)) as TestLiquidityPool;
      await expect(stashDex.connect(configAdmin).setPool(tokenB, pool2))
        .to.be.revertedWithCustomError(stashDex, "OutstandingDebt");
    });

    it("allows setPool with the same pool when totalBorrowed is positive", async function () {
      const {stashDex, configAdmin, user, user2, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2);

      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      expect(await stashDex.getPool(tokenB)).to.equal(pool.target);
      expect(await stashDex.getTotalBorrowed(tokenB)).to.equal(9_997n * USDC);
    });

    it("allows changing pool after debt is fully repaid", async function () {
      const {stashDex, configAdmin, deployer, admin, user, user2, tokenA, tokenB, pool, processor, USDC} =
        await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2);
      await tokenB.mint(stashDex, 9_997n * USDC);
      await stashDex.repay(tokenB);
      expect(await stashDex.getTotalBorrowed(tokenB)).to.equal(0n);

      const pool2 = (await deploy("TestLiquidityPool", deployer, {}, tokenA, admin, ZERO_ADDRESS)) as TestLiquidityPool;
      await stashDex.connect(configAdmin).setPool(tokenB, pool2);
      expect(await stashDex.getPool(tokenB)).to.equal(pool2.target);
      expect(await stashDex.getTotalBorrowed(tokenB)).to.equal(0n);
    });
  });

  describe("setRoute", function () {
    it("reverts AccessControlUnauthorizedAccount when caller lacks CONFIG_ROLE", async function () {
      const {stashDex, user, tokenA, tokenB, processor} = await loadFixture(deployAll);
      await expect(stashDex.connect(user).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 0, processor}))
        .to.be.revertedWithCustomError(stashDex, "AccessControlUnauthorizedAccount");
    });

    it("reverts ZeroAddress when tokenIn is zero", async function () {
      const {stashDex, configAdmin, tokenB, processor} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setRoute(
        {tokenIn: ZERO_ADDRESS, tokenOut: tokenB, feeBps: 0, processor}
      )).to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("reverts ZeroAddress when tokenOut is zero", async function () {
      const {stashDex, configAdmin, tokenA, processor} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setRoute(
        {tokenIn: tokenA, tokenOut: ZERO_ADDRESS, feeBps: 0, processor}
      )).to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("reverts ZeroAddress when processor is zero", async function () {
      const {stashDex, configAdmin, tokenA, tokenB} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setRoute(
        {tokenIn: tokenA, tokenOut: tokenB, feeBps: 0, processor: ZERO_ADDRESS}
      )).to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("reverts SameToken when tokenIn equals tokenOut", async function () {
      const {stashDex, configAdmin, tokenA, processor} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setRoute(
        {tokenIn: tokenA, tokenOut: tokenA, feeBps: 0, processor}
      )).to.be.revertedWithCustomError(stashDex, "SameToken");
    });

    it("reverts InvalidFeeBps when feeBps equals BPS (10000) or is higher than BPS", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, processor} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setRoute(
        {tokenIn: tokenA, tokenOut: tokenB, feeBps: 100_00, processor}
      )).to.be.revertedWithCustomError(stashDex, "InvalidFeeBps");
      await expect(stashDex.connect(configAdmin).setRoute(
        {tokenIn: tokenA, tokenOut: tokenB, feeBps: 100_01, processor}
      )).to.be.revertedWithCustomError(stashDex, "InvalidFeeBps");
      await stashDex.connect(configAdmin).setRoute(
        {tokenIn: tokenA, tokenOut: tokenB, feeBps: 99_99, processor}
      );
    });

    it("stores route correctly and emits RouteSet", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, processor} = await loadFixture(deployAll);
      const tx = await stashDex.connect(configAdmin).setRoute(
        {tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor}
      );
      await expect(tx).to.emit(stashDex, "RouteSet")
        .withArgs(tokenA.target, tokenB.target, 3, processor.address);

      const route = await stashDex.getRoute(tokenA, tokenB);
      expect(route.allowed).to.be.true;
      expect(route.feeBps).to.equal(3);
      expect(route.processor).to.equal(processor.address);
    });

    it("setRoute always sets allowed=true, overwriting a disabled route", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, processor} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await stashDex.connect(configAdmin).disableRoute(tokenA, tokenB);
      expect((await stashDex.getRoute(tokenA, tokenB)).allowed).to.be.false;

      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 5, processor});
      const route = await stashDex.getRoute(tokenA, tokenB);
      expect(route.allowed).to.be.true;
      expect(route.feeBps).to.equal(5);
    });

    it("setRoute overwrites feeBps and processor for the same pair", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, processor, user2} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 7, processor: user2});

      const route = await stashDex.getRoute(tokenA, tokenB);
      expect(route.feeBps).to.equal(7);
      expect(route.processor).to.equal(user2.address);
    });
  });

  describe("disableRoute", function () {
    it("reverts AccessControlUnauthorizedAccount when caller lacks CONFIG_ROLE", async function () {
      const {stashDex, user, tokenA, tokenB} = await loadFixture(deployAll);
      await expect(stashDex.connect(user).disableRoute(tokenA, tokenB))
        .to.be.revertedWithCustomError(stashDex, "AccessControlUnauthorizedAccount");
    });

    it("sets allowed=false and emits RouteDisabled", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, processor} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      const tx = await stashDex.connect(configAdmin).disableRoute(tokenA, tokenB);
      await expect(tx).to.emit(stashDex, "RouteDisabled").withArgs(tokenA.target, tokenB.target);
      expect((await stashDex.getRoute(tokenA, tokenB)).allowed).to.be.false;
    });

    it("reverts RouteNotAllowed when route was never set", async function () {
      const {stashDex, configAdmin, tokenA, tokenB} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).disableRoute(tokenA, tokenB))
        .to.be.revertedWithCustomError(stashDex, "RouteNotAllowed");
    });

    it("reverts RouteNotAllowed when route is already disabled", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, processor} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await stashDex.connect(configAdmin).disableRoute(tokenA, tokenB);
      await expect(stashDex.connect(configAdmin).disableRoute(tokenA, tokenB))
        .to.be.revertedWithCustomError(stashDex, "RouteNotAllowed");
    });

    it("re-enabling via setRoute makes the route usable again", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, processor, user, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await stashDex.connect(configAdmin).disableRoute(tokenA, tokenB);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});

      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user);
    });
  });

  describe("USER_ROLE", function () {
    it("swap reverts Unauthorized when tx.origin lacks USER_ROLE", async function () {
      const {stashDex, user2, tokenA, tokenB, USDC} = await loadFixture(deployAll);
      await expect(stashDex.connect(user2).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2))
        .to.be.revertedWithCustomError(stashDex, "Unauthorized");
    });

    it("exchange(5 params) reverts Unauthorized when tx.origin lacks USER_ROLE", async function () {
      const {stashDex, user2, tokenA, tokenB, USDC} = await loadFixture(deployAll);
      await expect(stashDex.connect(user2)["exchange(uint256,uint256,uint256,uint256,address)"](
        BigInt(await tokenA.getAddress()), BigInt(await tokenB.getAddress()), 10_000n * USDC, 9_997n * USDC, user2
      )).to.be.revertedWithCustomError(stashDex, "Unauthorized");
    });

    it("exchange(4 params) reverts Unauthorized when tx.origin lacks USER_ROLE", async function () {
      const {stashDex, user2, tokenA, tokenB, USDC} = await loadFixture(deployAll);
      await expect(stashDex.connect(user2)["exchange(uint256,uint256,uint256,uint256)"](
        BigInt(await tokenA.getAddress()), BigInt(await tokenB.getAddress()), 10_000n * USDC, 9_997n * USDC
      )).to.be.revertedWithCustomError(stashDex, "Unauthorized");
    });

    it("tx.origin is checked: user (USER_ROLE) succeeds via mock, user2 reverts via mock", async function () {
      const {stashDex, configAdmin, user, user2, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      const mock = (await deploy("MockBorrowSwap", user)) as MockBorrowSwap;

      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(mock, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);

      // mock (msg.sender) approves stashDex to pull its tokenA during swap
      const approveData = await tokenA.approve.populateTransaction(stashDex, 10_000n * USDC);
      await mock.connect(user).callBorrow(tokenA, approveData.data);

      const swapData = await stashDex.swap.populateTransaction(
        tokenA.target, tokenB.target, 10_000n * USDC, 9_997n * USDC, user.address,
      );

      // user2 has no USER_ROLE → tx.origin check fails → Unauthorized
      await expect(mock.connect(user2).callBorrowBubbleRevert(stashDex, swapData.data))
        .to.be.revertedWithCustomError(stashDex, "Unauthorized");

      // user has USER_ROLE → tx.origin check passes → succeeds
      const tx = await mock.connect(user).callBorrow(stashDex, swapData.data);
      await expect(tx).to.emit(stashDex, "Swapped")
        .withArgs(tokenA.target, tokenB.target, 10_000n * USDC, 9_997n * USDC, user.address);

      expect(await tokenA.balanceOf(mock)).to.equal(0n);
      expect(await tokenA.balanceOf(processor)).to.equal(10_000n * USDC);
      expect(await tokenB.balanceOf(user)).to.equal(9_997n * USDC);
      expect(await tokenB.balanceOf(pool)).to.equal(0n);
    });
  });

  describe("swap", function () {
    it("reverts RouteNotAllowed when no route is configured", async function () {
      const {stashDex, user, tokenA, tokenB, USDC} = await loadFixture(deployAll);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "RouteNotAllowed");
    });

    it("reverts RouteNotAllowed when route is disabled", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await stashDex.connect(configAdmin).disableRoute(tokenA, tokenB);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "RouteNotAllowed");
    });

    it("reverts PoolNotConfigured when route is set but pool is not", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenB, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "PoolNotConfigured");
    });

    it("amountOut below fee maximum passes", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 4_000n * USDC);

      const tx = await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 4_000n * USDC, user);
      await expect(tx).to.emit(stashDex, "Swapped");
      expect(await tokenA.balanceOf(processor)).to.equal(10_000n * USDC);
      expect(await tokenB.balanceOf(user)).to.equal(4_000n * USDC);
      expect(await stashDex.getTotalBorrowed(tokenB)).to.equal(4_000n * USDC);
    });

    it("transfers tokenIn to processor and tokenOut to recipient, emits Swapped", async function () {
      const {stashDex, configAdmin, user, user2, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);

      const tx = await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2);
      await expect(tx).to.emit(stashDex, "Swapped")
        .withArgs(tokenA.target, tokenB.target, 10_000n * USDC, 9_997n * USDC, user2.address);

      expect(await tokenA.balanceOf(processor)).to.equal(10_000n * USDC);
      expect(await tokenA.balanceOf(user)).to.equal(0n);
      expect(await tokenB.balanceOf(user2)).to.equal(9_997n * USDC);
      expect(await tokenB.balanceOf(pool)).to.equal(0n);
      expect(await pool.directDebt(tokenB)).to.equal(9_997n * USDC);
      expect(await stashDex.getTotalBorrowed(tokenB)).to.equal(9_997n * USDC);
    });

    it("exact fee boundary passes, one unit over reverts with InsufficientOutput", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_998n * USDC);

      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user);

      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_998n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "InsufficientOutput");
    });

    it("zero fee route: equal values pass, amountOut exceeding amountIn value by 1 unit reverts", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 0, processor});
      await tokenA.mint(user, 6_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 6_000n * USDC);
      await tokenB.mint(pool, 6_001n * USDC);

      await stashDex.connect(user).swap(tokenA, tokenB, 6_000n * USDC, 6_000n * USDC, user);

      await tokenA.mint(user, 6_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 6_000n * USDC);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 6_000n * USDC, 6_001n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "InsufficientOutput");
    });

    it("reverts EnforcedPause when paused", async function () {
      const {stashDex, configAdmin, pauser, user, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await stashDex.connect(pauser).pause();
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "EnforcedPause");
    });

    it("tokenIn(6dec) to tokenOut(18dec): oracle boundary passes, one unit over reverts", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenC, pool, processor, USDC, WETH} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenC, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenC, feeBps: 0, processor});
      await tokenA.mint(user, 1n * USDC);
      await tokenA.connect(user).approve(stashDex, 1n * USDC);
      await tokenC.mint(pool, 2n * WETH + 1n);

      await stashDex.connect(user).swap(tokenA, tokenC, 1n * USDC, 1n * WETH, user);

      await tokenA.mint(user, 1n * USDC);
      await tokenA.connect(user).approve(stashDex, 1n * USDC);
      await expect(stashDex.connect(user).swap(tokenA, tokenC, 1n * USDC, 1n * WETH + 1n, user))
        .to.be.revertedWithCustomError(stashDex, "InsufficientOutput");
    });

    it("tokenIn(18dec) to tokenOut(6dec): oracle boundary passes, one unit over reverts", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenC, pool, processor, USDC, WETH} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenA, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenC, tokenOut: tokenA, feeBps: 0, processor});
      await tokenC.mint(user, 1n * WETH);
      await tokenC.connect(user).approve(stashDex, 1n * WETH);
      await tokenA.mint(pool, 2n * USDC + 1n);

      await stashDex.connect(user).swap(tokenC, tokenA, 1n * WETH, 1n * USDC, user);

      await tokenC.mint(user, 1n * WETH);
      await tokenC.connect(user).approve(stashDex, 1n * WETH);
      await expect(stashDex.connect(user).swap(tokenC, tokenA, 1n * WETH, 1n * USDC + 1n, user))
        .to.be.revertedWithCustomError(stashDex, "InsufficientOutput");
    });
  });

  describe("exchange", function () {
    it("reverts InvalidIndex when indexIn has bits above position 159", async function () {
      const {stashDex, user, tokenB, USDC} = await loadFixture(deployAll);
      const badIndex = (1n << 160n) | BigInt(await tokenB.getAddress());
      await expect(stashDex.connect(user)["exchange(uint256,uint256,uint256,uint256,address)"](
        badIndex, BigInt(await tokenB.getAddress()), 1n * USDC, 1n * USDC, user
      )).to.be.revertedWithCustomError(stashDex, "InvalidIndex");
    });

    it("reverts InvalidIndex when indexOut has bits above position 159", async function () {
      const {stashDex, user, tokenA, USDC} = await loadFixture(deployAll);
      const badIndex = (1n << 160n) | BigInt(await tokenA.getAddress());
      await expect(stashDex.connect(user)["exchange(uint256,uint256,uint256,uint256,address)"](
        BigInt(await tokenA.getAddress()), badIndex, 1n * USDC, 1n * USDC, user
      )).to.be.revertedWithCustomError(stashDex, "InvalidIndex");
    });

    it("accepts type(uint160).max as a valid index for both in and out", async function () {
      const {stashDex, user} = await loadFixture(deployAll);
      const maxAddr = 2n ** 160n - 1n;
      await expect(stashDex.connect(user)["exchange(uint256,uint256,uint256,uint256,address)"](
        maxAddr, maxAddr, 1n, 1n, user
      )).to.be.revertedWithCustomError(stashDex, "RouteNotAllowed");
    });

    it("delegates to swap and transfers tokens correctly", async function () {
      const {stashDex, configAdmin, user, user2, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);

      const tx = await stashDex.connect(user)["exchange(uint256,uint256,uint256,uint256,address)"](
        BigInt(await tokenA.getAddress()), BigInt(await tokenB.getAddress()), 10_000n * USDC, 9_997n * USDC, user2
      );
      await expect(tx).to.emit(stashDex, "Swapped")
        .withArgs(tokenA.target, tokenB.target, 10_000n * USDC, 9_997n * USDC, user2.address);

      expect(await tokenA.balanceOf(processor)).to.equal(10_000n * USDC);
      expect(await tokenB.balanceOf(user2)).to.equal(9_997n * USDC);
    });

    it("delegates without recipient to swap and transfers tokens correctly", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);

      const tx = await stashDex.connect(user)["exchange(uint256,uint256,uint256,uint256)"](
        BigInt(await tokenA.getAddress()), BigInt(await tokenB.getAddress()), 10_000n * USDC, 9_997n * USDC
      );
      await expect(tx).to.emit(stashDex, "Swapped")
        .withArgs(tokenA.target, tokenB.target, 10_000n * USDC, 9_997n * USDC, user.address);

      expect(await tokenA.balanceOf(processor)).to.equal(10_000n * USDC);
      expect(await tokenB.balanceOf(user)).to.equal(9_997n * USDC);
    });
  });

  describe("repay", function () {
    it("returns early without emitting Repaid when totalBorrowed is zero", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenB.mint(stashDex, 4_000n * USDC);

      const tx = await stashDex.repay(tokenB);
      await expect(tx).to.not.emit(stashDex, "Repaid");
      expect(await tokenB.balanceOf(stashDex)).to.equal(4_000n * USDC);
      expect(await tokenB.balanceOf(pool)).to.equal(0n);
      expect(await stashDex.getTotalBorrowed(tokenB)).to.equal(0n);
    });

    it("fully repays debt when balance covers it, emits Repaid", async function () {
      const {stashDex, configAdmin, user, user2, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2);

      await tokenB.mint(stashDex, 9_997n * USDC);

      const tx = await stashDex.repay(tokenB);
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(tokenB.target, 9_997n * USDC);

      expect(await stashDex.getTotalBorrowed(tokenB)).to.equal(0n);
      expect(await pool.directDebt(tokenB)).to.equal(0n);
      expect(await tokenB.balanceOf(pool)).to.equal(9_997n * USDC);
      expect(await tokenB.balanceOf(stashDex)).to.equal(0n);
    });

    it("fully repays debt when has extra balance, extra remains on dex", async function () {
      const {stashDex, configAdmin, user, user2, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2);

      await tokenB.mint(stashDex, 9_997n * USDC + 4_000n * USDC);

      const tx = await stashDex.repay(tokenB);
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(tokenB.target, 9_997n * USDC);

      expect(await stashDex.getTotalBorrowed(tokenB)).to.equal(0n);
      expect(await pool.directDebt(tokenB)).to.equal(0n);
      expect(await tokenB.balanceOf(pool)).to.equal(9_997n * USDC);
      expect(await tokenB.balanceOf(stashDex)).to.equal(4_000n * USDC);
    });

    it("partially repays debt when balance is less than debt, emits Repaid", async function () {
      const {stashDex, configAdmin, user, user2, tokenA, tokenB, pool, processor, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2);

      await tokenB.mint(stashDex, 6_000n * USDC);

      const tx = await stashDex.repay(tokenB);
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(tokenB.target, 6_000n * USDC);

      expect(await stashDex.getTotalBorrowed(tokenB)).to.equal(3_997n * USDC);
      expect(await pool.directDebt(tokenB)).to.equal(3_997n * USDC);
      expect(await tokenB.balanceOf(pool)).to.equal(6_000n * USDC);
      expect(await tokenB.balanceOf(stashDex)).to.equal(0n);
    });

    it("reverts EnforcedPause when paused", async function () {
      const {stashDex, pauser, tokenB} = await loadFixture(deployAll);
      await stashDex.connect(pauser).pause();
      await expect(stashDex.repay(tokenB))
        .to.be.revertedWithCustomError(stashDex, "EnforcedPause");
    });
  });

  describe("forward", function () {
    it("reverts AccessControlUnauthorizedAccount when caller lacks FORWARD_ROLE", async function () {
      const {stashDex, user, tokenB} = await loadFixture(deployAll);
      await expect(stashDex.connect(user).forward(tokenB))
        .to.be.revertedWithCustomError(stashDex, "AccessControlUnauthorizedAccount");
    });

    it("reverts EnforcedPause when paused", async function () {
      const {stashDex, forwarder, pauser, tokenB} = await loadFixture(deployAll);
      await stashDex.connect(pauser).pause();
      await expect(stashDex.connect(forwarder).forward(tokenB))
        .to.be.revertedWithCustomError(stashDex, "EnforcedPause");
    });

    it("reverts NothingToForward when no pool configured and balance is zero", async function () {
      const {stashDex, forwarder, tokenB} = await loadFixture(deployAll);
      await expect(stashDex.connect(forwarder).forward(tokenB))
        .to.be.revertedWithCustomError(stashDex, "NothingToForward");
    });

    it("transfers full balance to RECEIVER when no pool is configured for the token", async function () {
      const {stashDex, forwarder, tokenB, receiver, USDC} = await loadFixture(deployAll);
      await tokenB.mint(stashDex, 6_000n * USDC);

      const tx = await stashDex.connect(forwarder).forward(tokenB);
      await expect(tx).to.emit(stashDex, "Forwarded").withArgs(tokenB.target, 6_000n * USDC);
      await expect(tx).to.not.emit(stashDex, "Repaid");

      expect(await tokenB.balanceOf(receiver)).to.equal(6_000n * USDC);
      expect(await tokenB.balanceOf(stashDex)).to.equal(0n);
    });

    it("repays debt first then forwards remainder to RECEIVER", async function () {
      const {stashDex, forwarder, configAdmin, user, user2, tokenA, tokenB, pool, processor, receiver, USDC} =
        await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2);

      await tokenB.mint(stashDex, 9_997n * USDC + 4_000n * USDC);

      const tx = await stashDex.connect(forwarder).forward(tokenB);
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(tokenB.target, 9_997n * USDC);
      await expect(tx).to.emit(stashDex, "Forwarded").withArgs(tokenB.target, 4_000n * USDC);

      expect(await stashDex.getTotalBorrowed(tokenB)).to.equal(0n);
      expect(await pool.directDebt(tokenB)).to.equal(0n);
      expect(await tokenB.balanceOf(pool)).to.equal(9_997n * USDC);
      expect(await tokenB.balanceOf(receiver)).to.equal(4_000n * USDC);
      expect(await tokenB.balanceOf(stashDex)).to.equal(0n);
    });

    it("reverts NothingToForward when pool debt consumes the entire balance", async function () {
      const {stashDex, forwarder, configAdmin, user, user2, tokenA, tokenB, pool, processor, USDC} =
        await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2);

      await tokenB.mint(stashDex, 9_997n * USDC);

      await expect(stashDex.connect(forwarder).forward(tokenB))
        .to.be.revertedWithCustomError(stashDex, "NothingToForward");
    });

    it("forwards without repay when pool debt is zero", async function () {
      const {stashDex, forwarder, configAdmin, tokenA, tokenB, pool, processor, receiver, USDC} =
        await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await tokenB.mint(stashDex, 6_000n * USDC);

      const tx = await stashDex.connect(forwarder).forward(tokenB);
      await expect(tx).to.not.emit(stashDex, "Repaid");
      await expect(tx).to.emit(stashDex, "Forwarded").withArgs(tokenB.target, 6_000n * USDC);

      expect(await tokenB.balanceOf(receiver)).to.equal(6_000n * USDC);
      expect(await tokenB.balanceOf(stashDex)).to.equal(0n);
    });
  });

  describe("pause / unpause", function () {
    it("pause reverts AccessControlUnauthorizedAccount without PAUSER_ROLE", async function () {
      const {stashDex, user} = await loadFixture(deployAll);
      await expect(stashDex.connect(user).pause())
        .to.be.revertedWithCustomError(stashDex, "AccessControlUnauthorizedAccount");
    });

    it("pause reverts EnforcedPause when already paused", async function () {
      const {stashDex, pauser} = await loadFixture(deployAll);
      await stashDex.connect(pauser).pause();
      await expect(stashDex.connect(pauser).pause())
        .to.be.revertedWithCustomError(stashDex, "EnforcedPause");
    });

    it("pause sets paused() to true and emits Paused", async function () {
      const {stashDex, pauser} = await loadFixture(deployAll);
      expect(await stashDex.paused()).to.be.false;
      const tx = await stashDex.connect(pauser).pause();
      await expect(tx).to.emit(stashDex, "Paused").withArgs(pauser.address);
      expect(await stashDex.paused()).to.be.true;
    });

    it("unpause reverts AccessControlUnauthorizedAccount without PAUSER_ROLE", async function () {
      const {stashDex, pauser, user} = await loadFixture(deployAll);
      await stashDex.connect(pauser).pause();
      await expect(stashDex.connect(user).unpause())
        .to.be.revertedWithCustomError(stashDex, "AccessControlUnauthorizedAccount");
    });

    it("unpause reverts ExpectedPause when not paused", async function () {
      const {stashDex, pauser} = await loadFixture(deployAll);
      await expect(stashDex.connect(pauser).unpause())
        .to.be.revertedWithCustomError(stashDex, "ExpectedPause");
    });

    it("unpause sets paused() to false and emits Unpaused", async function () {
      const {stashDex, pauser} = await loadFixture(deployAll);
      await stashDex.connect(pauser).pause();
      const tx = await stashDex.connect(pauser).unpause();
      await expect(tx).to.emit(stashDex, "Unpaused").withArgs(pauser.address);
      expect(await stashDex.paused()).to.be.false;
    });

    it("swap, repay, exchange, and forward all work again after pause then unpause", async function () {
      const {stashDex, configAdmin, pauser, forwarder, user, tokenA, tokenB, tokenC, pool, processor, USDC, WETH} =
        await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, processor});
      await stashDex.connect(pauser).pause();
      await stashDex.connect(pauser).unpause();

      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user);

      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await stashDex.connect(user)["exchange(uint256,uint256,uint256,uint256,address)"](
        BigInt(await tokenA.getAddress()), BigInt(await tokenB.getAddress()),
        10_000n * USDC, 9_997n * USDC, user
      );

      await tokenB.mint(stashDex, 4_000n * USDC);
      await stashDex.repay(tokenB);

      await tokenC.mint(stashDex, 1n * WETH);
      await stashDex.connect(forwarder).forward(tokenC);
    });
  });

  describe("balance", function () {
    it("returns 0 when no pool is configured for the token", async function () {
      const {stashDex, tokenB} = await loadFixture(deployAll);
      expect(await stashDex.balance(tokenB)).to.equal(0n);
    });

    it("delegates to pool.balance and returns the pool's token balance", async function () {
      const {stashDex, configAdmin, tokenB, pool, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setPool(tokenB, pool);
      await tokenB.mint(pool, 6_000n * USDC);
      expect(await stashDex.balance(tokenB)).to.equal(6_000n * USDC);
    });
  });
});
