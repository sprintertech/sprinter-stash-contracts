import {loadFixture} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {expect} from "chai";
import hre from "hardhat";
import {deploy, getContractAt, setupTests} from "./helpers";
import {addressToBytes32, ZERO_ADDRESS, DEFAULT_ADMIN_ROLE} from "../scripts/common";
import {
  TestUSDC, TestWETH, PaxosOracle, StashDex, TestLiquidityPool, TransparentUpgradeableProxy,
} from "../typechain-types";

describe("StashDex", function () {
  setupTests();

  const deployAll = async () => {
    const [deployer, admin, configAdmin, pauser, forwarder, user, user2, destination, receiver] =
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
      admin, configAdmin, pauser, forwarder, []
    )).data;
    const proxy = (await deploy(
      "TransparentUpgradeableProxy", deployer, {}, stashDexImpl, admin, initData
    )) as TransparentUpgradeableProxy;
    const stashDex = (await getContractAt("StashDex", proxy, deployer)) as StashDex;

    const CONFIG_ROLE = await stashDex.CONFIG_ROLE();
    const PAUSER_ROLE = await stashDex.PAUSER_ROLE();
    const FORWARD_ROLE = await stashDex.FORWARD_ROLE();

    return {
      deployer, admin, configAdmin, pauser, forwarder, user, user2, destination, receiver,
      tokenA, tokenB, tokenC, usdcRef, oracle, pool, stashDex, stashDexImpl,
      CONFIG_ROLE, PAUSER_ROLE, FORWARD_ROLE, USDC, WETH,
    };
  };

  describe("Deployment & Initialization", function () {
    it("constructor reverts ZeroAddress when oracle is zero", async function () {
      const {deployer, receiver} = await loadFixture(deployAll);
      await expect(deploy("StashDex", deployer, {}, ZERO_ADDRESS, receiver))
        .to.be.revertedWithCustomError({interface: (await hre.ethers.getContractFactory("StashDex")).interface}, "ZeroAddress");
    });

    it("constructor reverts ZeroAddress when receiver is zero", async function () {
      const {deployer, oracle} = await loadFixture(deployAll);
      await expect(deploy("StashDex", deployer, {}, oracle, ZERO_ADDRESS))
        .to.be.revertedWithCustomError({interface: (await hre.ethers.getContractFactory("StashDex")).interface}, "ZeroAddress");
    });

    it("constructor stores ORACLE and RECEIVER as immutables", async function () {
      const {stashDex, oracle, receiver} = await loadFixture(deployAll);
      expect(await stashDex.ORACLE()).to.equal(oracle.target);
      expect(await stashDex.RECEIVER()).to.equal(receiver.address);
    });

    it("initialize reverts ZeroAddress for each role address individually", async function () {
      const {stashDexImpl, admin, configAdmin, pauser, forwarder, deployer} = await loadFixture(deployAll);
      // Deploy uninitialized proxies (empty data) so initialize() can be called and checked
      const newProxy = async () => {
        const p = await deploy("TransparentUpgradeableProxy", deployer, {}, stashDexImpl, admin, "0x");
        return getContractAt("StashDex", p, deployer) as Promise<StashDex>;
      };
      const dex1 = await newProxy();
      await expect(dex1.initialize(ZERO_ADDRESS, configAdmin, pauser, forwarder, []))
        .to.be.revertedWithCustomError(dex1, "ZeroAddress");
      const dex2 = await newProxy();
      await expect(dex2.initialize(admin, ZERO_ADDRESS, pauser, forwarder, []))
        .to.be.revertedWithCustomError(dex2, "ZeroAddress");
      const dex3 = await newProxy();
      await expect(dex3.initialize(admin, configAdmin, ZERO_ADDRESS, forwarder, []))
        .to.be.revertedWithCustomError(dex3, "ZeroAddress");
      const dex4 = await newProxy();
      await expect(dex4.initialize(admin, configAdmin, pauser, ZERO_ADDRESS, []))
        .to.be.revertedWithCustomError(dex4, "ZeroAddress");
    });

    it("initialize grants all four roles to the respective addresses", async function () {
      const {stashDex, admin, configAdmin, pauser, forwarder, CONFIG_ROLE, PAUSER_ROLE, FORWARD_ROLE} = await loadFixture(deployAll);
      expect(await stashDex.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.equal(true);
      expect(await stashDex.hasRole(CONFIG_ROLE, configAdmin)).to.equal(true);
      expect(await stashDex.hasRole(PAUSER_ROLE, pauser)).to.equal(true);
      expect(await stashDex.hasRole(FORWARD_ROLE, forwarder)).to.equal(true);
    });

    it("initialize with initial routes configures them and emits RouteSet per entry", async function () {
      const {deployer, admin, configAdmin, pauser, forwarder, oracle, receiver, pool, tokenA, tokenB, destination, USDC} =
        await loadFixture(deployAll);
      const impl = (await deploy("StashDex", deployer, {}, oracle, receiver)) as StashDex;
      const routes = [
        {tokenIn: tokenA.target, tokenOut: tokenB.target, feeBps: 3, destination: destination.address, pool: pool.target},
      ];
      const initData = (await impl.initialize.populateTransaction(admin, configAdmin, pauser, forwarder, routes)).data;
      const proxy = (await deploy("TransparentUpgradeableProxy", deployer, {}, impl, admin, initData)) as TransparentUpgradeableProxy;
      const dex = (await getContractAt("StashDex", proxy, deployer)) as StashDex;

      const route = await dex.getRoute(tokenA, tokenB);
      expect(route.allowed).to.equal(true);
      expect(route.feeBps).to.equal(3);
      expect(route.destination).to.equal(destination.address);
      expect(await dex.getPool(tokenB)).to.equal(pool.target);
    });

    it("cannot call initialize twice on the proxy", async function () {
      const {stashDex, admin, configAdmin, pauser, forwarder} = await loadFixture(deployAll);
      await expect(stashDex.initialize(admin, configAdmin, pauser, forwarder, []))
        .to.be.reverted;
    });

    it("cannot call initialize on the implementation", async function () {
      const {stashDexImpl, admin, configAdmin, pauser, forwarder} = await loadFixture(deployAll);
      await expect(stashDexImpl.initialize(admin, configAdmin, pauser, forwarder, []))
        .to.be.reverted;
    });
  });

  describe("setRoute", function () {
    it("reverts AccessControlUnauthorizedAccount when caller lacks CONFIG_ROLE", async function () {
      const {stashDex, user, tokenA, tokenB, pool, destination} = await loadFixture(deployAll);
      await expect(stashDex.connect(user).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 0, destination, pool}))
        .to.be.revertedWithCustomError(stashDex, "AccessControlUnauthorizedAccount");
    });

    it("reverts ZeroAddress when tokenIn is zero", async function () {
      const {stashDex, configAdmin, tokenB, pool, destination} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setRoute({tokenIn: ZERO_ADDRESS, tokenOut: tokenB, feeBps: 0, destination, pool}))
        .to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("reverts ZeroAddress when tokenOut is zero", async function () {
      const {stashDex, configAdmin, tokenA, pool, destination} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: ZERO_ADDRESS, feeBps: 0, destination, pool}))
        .to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("reverts ZeroAddress when destination is zero", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 0, destination: ZERO_ADDRESS, pool}))
        .to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("reverts ZeroAddress when pool is zero", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, destination} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 0, destination, pool: ZERO_ADDRESS}))
        .to.be.revertedWithCustomError(stashDex, "ZeroAddress");
    });

    it("reverts InvalidFeeBps when feeBps equals BPS (10000)", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, destination} = await loadFixture(deployAll);
      await expect(stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 10000, destination, pool}))
        .to.be.revertedWithCustomError(stashDex, "InvalidFeeBps");
      // 9999 is accepted
      await expect(stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 9999, destination, pool}))
        .to.not.be.reverted;
    });

    it("stores route and pool correctly and emits RouteSet", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, destination} = await loadFixture(deployAll);
      const tx = await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await expect(tx).to.emit(stashDex, "RouteSet")
        .withArgs(tokenA.target, tokenB.target, 3, destination.address, pool.target);

      const route = await stashDex.getRoute(tokenA, tokenB);
      expect(route.allowed).to.equal(true);
      expect(route.feeBps).to.equal(3);
      expect(route.destination).to.equal(destination.address);
      expect(await stashDex.getPool(tokenB)).to.equal(pool.target);
    });

    it("setRoute always sets allowed=true, overwriting a disabled route", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, destination} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await stashDex.connect(configAdmin).disableRoute(tokenA, tokenB);
      expect((await stashDex.getRoute(tokenA, tokenB)).allowed).to.equal(false);

      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 5, destination, pool});
      const route = await stashDex.getRoute(tokenA, tokenB);
      expect(route.allowed).to.equal(true);
      expect(route.feeBps).to.equal(5);
    });

    it("setRoute overwrites feeBps and destination for the same pair", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, destination, user2} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 7, destination: user2, pool});

      const route = await stashDex.getRoute(tokenA, tokenB);
      expect(route.feeBps).to.equal(7);
      expect(route.destination).to.equal(user2.address);
    });
  });

  describe("disableRoute", function () {
    it("reverts AccessControlUnauthorizedAccount when caller lacks CONFIG_ROLE", async function () {
      const {stashDex, user, tokenA, tokenB} = await loadFixture(deployAll);
      await expect(stashDex.connect(user).disableRoute(tokenA, tokenB))
        .to.be.revertedWithCustomError(stashDex, "AccessControlUnauthorizedAccount");
    });

    it("sets allowed=false and emits RouteDisabled", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, destination} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      const tx = await stashDex.connect(configAdmin).disableRoute(tokenA, tokenB);
      await expect(tx).to.emit(stashDex, "RouteDisabled").withArgs(tokenA.target, tokenB.target);
      expect((await stashDex.getRoute(tokenA, tokenB)).allowed).to.equal(false);
    });

    it("re-enabling via setRoute makes the route usable again", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, destination, user, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await stashDex.connect(configAdmin).disableRoute(tokenA, tokenB);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});

      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user))
        .to.not.be.reverted;
    });
  });

  describe("swap", function () {
    it("reverts RouteNotAllowed when no route is configured", async function () {
      const {stashDex, user, tokenA, tokenB, USDC} = await loadFixture(deployAll);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "RouteNotAllowed");
    });

    it("reverts RouteNotAllowed when route is disabled", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenB, pool, destination, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await stashDex.connect(configAdmin).disableRoute(tokenA, tokenB);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "RouteNotAllowed");
    });

    it("transfers tokenIn to destination and tokenOut to recipient, emits Swapped", async function () {
      const {stashDex, configAdmin, user, user2, tokenA, tokenB, pool, destination, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);

      const tx = await stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user2);
      await expect(tx).to.emit(stashDex, "Swapped")
        .withArgs(tokenA.target, tokenB.target, 10_000n * USDC, 9_997n * USDC, user2.address);

      expect(await tokenA.balanceOf(destination)).to.equal(10_000n * USDC);
      expect(await tokenA.balanceOf(user)).to.equal(0n);
      expect(await tokenB.balanceOf(user2)).to.equal(9_997n * USDC);
      expect(await tokenB.balanceOf(pool)).to.equal(0n);
      expect(await pool.directDebt(tokenB)).to.equal(9_997n * USDC);
    });

    it("exact fee boundary passes, one unit over reverts with InsufficientOutput", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenB, pool, destination, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_998n * USDC);

      // 9_997 is the exact boundary for feeBps=3 with amountIn=10_000
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user))
        .to.not.be.reverted;

      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_998n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "InsufficientOutput");
    });

    it("zero fee route: equal values pass, amountOut exceeding amountIn value by 1 unit reverts", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenB, pool, destination, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 0, destination, pool});
      await tokenA.mint(user, 6_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 6_000n * USDC);
      await tokenB.mint(pool, 6_001n * USDC);

      await expect(stashDex.connect(user).swap(tokenA, tokenB, 6_000n * USDC, 6_000n * USDC, user))
        .to.not.be.reverted;

      await tokenA.mint(user, 6_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 6_000n * USDC);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 6_000n * USDC, 6_001n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "InsufficientOutput");
    });

    it("reverts EnforcedPause when paused", async function () {
      const {stashDex, configAdmin, pauser, user, tokenA, tokenB, pool, destination, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await stashDex.connect(pauser).pause();
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "EnforcedPause");
    });

    it("tokenIn(6dec) to tokenOut(18dec): exact oracle boundary passes, one oracle unit over reverts", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenC, pool, destination, USDC, WETH} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenC, feeBps: 0, destination, pool});
      await tokenA.mint(user, 1n * USDC);
      await tokenA.connect(user).approve(stashDex, 1n * USDC);
      await tokenC.mint(pool, 1n * WETH + 10n ** 12n);

      // 1 USDC in → 1 WETH out is the exact boundary (both oracle value = 10^6)
      await expect(stashDex.connect(user).swap(tokenA, tokenC, 1n * USDC, 1n * WETH, user))
        .to.not.be.reverted;

      await tokenA.mint(user, 1n * USDC);
      await tokenA.connect(user).approve(stashDex, 1n * USDC);
      // 1 WETH + 10^12 raises oracle value by 1 → fails
      await expect(stashDex.connect(user).swap(tokenA, tokenC, 1n * USDC, 1n * WETH + 10n ** 12n, user))
        .to.be.revertedWithCustomError(stashDex, "InsufficientOutput");
    });

    it("tokenIn(18dec) to tokenOut(6dec): exact oracle boundary passes, one oracle unit over reverts", async function () {
      const {stashDex, configAdmin, user, tokenA, tokenC, pool, destination, USDC, WETH} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenC, tokenOut: tokenA, feeBps: 0, destination, pool});
      await tokenC.mint(user, 1n * WETH);
      await tokenC.connect(user).approve(stashDex, 1n * WETH);
      await tokenA.mint(pool, 1n * USDC + 1n);

      // 1 WETH in → 1 USDC out is exact boundary (both oracle value = 10^6)
      await expect(stashDex.connect(user).swap(tokenC, tokenA, 1n * WETH, 1n * USDC, user))
        .to.not.be.reverted;

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
      await expect(stashDex.connect(user).exchange(badIndex, BigInt(await tokenB.getAddress()), 1n * USDC, 1n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "InvalidIndex");
    });

    it("reverts InvalidIndex when indexOut has bits above position 159", async function () {
      const {stashDex, user, tokenA, USDC} = await loadFixture(deployAll);
      const badIndex = (1n << 160n) | BigInt(await tokenA.getAddress());
      await expect(stashDex.connect(user).exchange(BigInt(await tokenA.getAddress()), badIndex, 1n * USDC, 1n * USDC, user))
        .to.be.revertedWithCustomError(stashDex, "InvalidIndex");
    });

    it("accepts type(uint160).max as a valid index for both in and out", async function () {
      const {stashDex, user} = await loadFixture(deployAll);
      const maxAddr = 2n ** 160n - 1n;
      // Will revert with RouteNotAllowed (not InvalidIndex), confirming index validation passed
      await expect(stashDex.connect(user).exchange(maxAddr, maxAddr, 1n, 1n, user))
        .to.be.revertedWithCustomError(stashDex, "RouteNotAllowed");
    });

    it("delegates to swap and transfers tokens correctly", async function () {
      const {stashDex, configAdmin, user, user2, tokenA, tokenB, pool, destination, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);

      const tx = await stashDex.connect(user).exchange(
        BigInt(await tokenA.getAddress()), BigInt(await tokenB.getAddress()), 10_000n * USDC, 9_997n * USDC, user2
      );
      await expect(tx).to.emit(stashDex, "Swapped")
        .withArgs(tokenA.target, tokenB.target, 10_000n * USDC, 9_997n * USDC, user2.address);

      expect(await tokenA.balanceOf(destination)).to.equal(10_000n * USDC);
      expect(await tokenB.balanceOf(user2)).to.equal(9_997n * USDC);
    });
  });

  describe("repay", function () {
    it("returns early without emitting Repaid when pool debt is zero", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, destination, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await tokenB.mint(stashDex, 4_000n * USDC);

      const tx = await stashDex.repay(tokenB);
      await expect(tx).to.not.emit(stashDex, "Repaid");
      expect(await tokenB.balanceOf(stashDex)).to.equal(4_000n * USDC);
      expect(await tokenB.balanceOf(pool)).to.equal(0n);
    });

    it("fully repays debt when balance covers it, emits Repaid", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, destination, deployer, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      // create debt by calling borrowDirect from deployer (approval side-effect ignored)
      await pool.connect(deployer).borrowDirect(tokenB, 9_997n * USDC);
      await tokenB.mint(stashDex, 9_997n * USDC);

      const tx = await stashDex.repay(tokenB);
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(tokenB.target, 9_997n * USDC);

      expect(await pool.directDebt(tokenB)).to.equal(0n);
      expect(await tokenB.balanceOf(pool)).to.equal(9_997n * USDC);
      expect(await tokenB.balanceOf(stashDex)).to.equal(0n);
    });

    it("partially repays debt when balance is less than debt, emits Repaid", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, destination, deployer, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await pool.connect(deployer).borrowDirect(tokenB, 9_997n * USDC);
      await tokenB.mint(stashDex, 6_000n * USDC);

      const tx = await stashDex.repay(tokenB);
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(tokenB.target, 6_000n * USDC);

      expect(await pool.directDebt(tokenB)).to.equal(3_997n * USDC);
      expect(await tokenB.balanceOf(pool)).to.equal(6_000n * USDC);
      expect(await tokenB.balanceOf(stashDex)).to.equal(0n);
    });

    it("reverts EnforcedPause when paused", async function () {
      const {stashDex, configAdmin, pauser, tokenA, tokenB, pool, destination} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
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
      const {stashDex, forwarder, configAdmin, tokenA, tokenB, pool, destination, deployer, receiver, USDC} =
        await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await pool.connect(deployer).borrowDirect(tokenB, 9_997n * USDC);
      // StashDex holds debt + extra
      await tokenB.mint(stashDex, 9_997n * USDC + 4_000n * USDC);

      const tx = await stashDex.connect(forwarder).forward(tokenB);
      await expect(tx).to.emit(stashDex, "Repaid").withArgs(tokenB.target, 9_997n * USDC + 4_000n * USDC);
      await expect(tx).to.emit(stashDex, "Forwarded").withArgs(tokenB.target, 4_000n * USDC);

      expect(await pool.directDebt(tokenB)).to.equal(0n);
      expect(await tokenB.balanceOf(pool)).to.equal(9_997n * USDC);
      expect(await tokenB.balanceOf(receiver)).to.equal(4_000n * USDC);
      expect(await tokenB.balanceOf(stashDex)).to.equal(0n);
    });

    it("reverts NothingToForward when pool debt consumes the entire balance", async function () {
      const {stashDex, forwarder, configAdmin, tokenA, tokenB, pool, destination, deployer, USDC} =
        await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await pool.connect(deployer).borrowDirect(tokenB, 9_997n * USDC);
      await tokenB.mint(stashDex, 9_997n * USDC);

      await expect(stashDex.connect(forwarder).forward(tokenB))
        .to.be.revertedWithCustomError(stashDex, "NothingToForward");
    });

    it("forwards without repay when pool debt is zero", async function () {
      const {stashDex, forwarder, configAdmin, tokenA, tokenB, pool, destination, receiver, USDC} =
        await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
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
      expect(await stashDex.paused()).to.equal(false);
      const tx = await stashDex.connect(pauser).pause();
      await expect(tx).to.emit(stashDex, "Paused").withArgs(pauser.address);
      expect(await stashDex.paused()).to.equal(true);
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
      expect(await stashDex.paused()).to.equal(false);
    });

    it("swap, repay, and forward all work again after pause then unpause", async function () {
      const {stashDex, configAdmin, pauser, forwarder, user, tokenA, tokenB, tokenC, pool, destination, USDC, WETH} =
        await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await stashDex.connect(pauser).pause();
      await stashDex.connect(pauser).unpause();

      // swap works
      await tokenA.mint(user, 10_000n * USDC);
      await tokenA.connect(user).approve(stashDex, 10_000n * USDC);
      await tokenB.mint(pool, 9_997n * USDC);
      await expect(stashDex.connect(user).swap(tokenA, tokenB, 10_000n * USDC, 9_997n * USDC, user))
        .to.not.be.reverted;

      // repay works (tokenB has debt from the swap above)
      await tokenB.mint(stashDex, 4_000n * USDC);
      await expect(stashDex.repay(tokenB)).to.not.be.reverted;

      // forward works using tokenC which has no pool configured, so repay is skipped
      await tokenC.mint(stashDex, 1n * WETH);
      await expect(stashDex.connect(forwarder).forward(tokenC)).to.not.be.reverted;
    });
  });

  describe("balance", function () {
    it("returns 0 when no pool is configured for the token", async function () {
      const {stashDex, tokenB} = await loadFixture(deployAll);
      expect(await stashDex.balance(tokenB)).to.equal(0n);
    });

    it("delegates to pool.balance and returns the pool's tokenOut balance", async function () {
      const {stashDex, configAdmin, tokenA, tokenB, pool, destination, USDC} = await loadFixture(deployAll);
      await stashDex.connect(configAdmin).setRoute({tokenIn: tokenA, tokenOut: tokenB, feeBps: 3, destination, pool});
      await tokenB.mint(pool, 6_000n * USDC);
      expect(await stashDex.balance(tokenB)).to.equal(6_000n * USDC);
    });
  });
});
