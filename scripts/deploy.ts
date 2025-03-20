import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {MaxUint256, isAddress} from "ethers";
import {toBytes32} from "../test/helpers";
import {
  getVerifier, deployProxyX,
} from "./helpers";
import {
  assert, isSet, ProviderSolidity, DomainSolidity, DEFAULT_ADMIN_ROLE,
} from "./common";
import {
  TestUSDC, SprinterUSDCLPShare, LiquidityHub,
  SprinterLiquidityMining, TestCCTPTokenMessenger, TestCCTPMessageTransmitter,
  Rebalancer, LiquidityPool, LiquidityPoolAave
} from "../typechain-types";
import {
  networkConfig, Network, Provider, NetworkConfig, LiquidityPoolUSDC,
  LiquidityPoolAaveUSDC,
} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log(`Deploying to: ${hre.network.name}`);
  if (hre.network.name === "hardhat" && Object.values(Network).includes(process.env.DRY_RUN as Network)) {
    network = process.env.DRY_RUN as Network;
    config = networkConfig[network];
    console.log(`Dry run on fork: ${network}`);
  } else if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
    config = networkConfig[network];
  } else {
    network = Network.BASE;
    console.log("TEST: Using TEST USDC and CCTP");
    const testUSDC = (await verifier.deploy("TestUSDC", deployer)) as TestUSDC;
    const cctpTokenMessenger = (await verifier.deploy("TestCCTPTokenMessenger", deployer)) as TestCCTPTokenMessenger;
    const cctpMessageTransmitter = (
      await verifier.deploy("TestCCTPMessageTransmitter", deployer)
    ) as TestCCTPMessageTransmitter;
    const [, opsAdmin, superAdmin, mpc] = await hre.ethers.getSigners();
    config = {
      chainId: 31337,
      CCTP: {
        TokenMessenger: await cctpTokenMessenger.getAddress(),
        MessageTransmitter: await cctpMessageTransmitter.getAddress(),
      },
      USDC: await testUSDC.getAddress(),
      IsTest: false,
      Hub: {
        AssetsAdjuster: superAdmin.address,
        DepositProfit: opsAdmin.address,
        AssetsLimit: 10_000_000,
        Tiers: [
          {period: 7776000n, multiplier: 300000000n},
          {period: 15552000n, multiplier: 800000000n},
          {period: 31104000n, multiplier: 1666666667n},
        ]
      },
      Admin: superAdmin.address,
      WithdrawProfit: opsAdmin.address,
      Pauser: opsAdmin.address,
      RebalanceCaller: opsAdmin.address,
      MpcAddress: mpc.address,
      Routes: {
        Pools: [LiquidityPoolUSDC],
        Domains: [Network.ETHEREUM],
        Providers: [Provider.CCTP],
      },
      USDCPool: true
    };
  }

  assert(config.AavePool !== undefined || config.USDCPool!, "At least one pool should be present.");
  if (config.Hub) {
    assert(config.Hub!.Tiers.length > 0, "Empty liquidity mining tiers configuration.");
    assert(isAddress(config.USDC), "USDC must be an address");
    assert(isAddress(config.Admin), "Admin must be an address");
    assert(isAddress(config.WithdrawProfit), "WithdrawProfit must be an address");
    assert(isAddress(config.Pauser), "Pauser must be an address");
    assert(isAddress(config.RebalanceCaller), "RebalanceCaller must be an address");
    assert(isAddress(config.MpcAddress), "MpcAddress must be an address");
    assert(config.Hub!.AssetsLimit <= MaxUint256 / 10n ** 12n, "Assets limit is too high");
  }

  if (!config.Routes) {
    config.Routes = {
      Pools: [],
      Domains: [],
      Providers: [],
    };
  }

  let mainPool: LiquidityPool;
  let aavePool: LiquidityPoolAave;
  if (config.AavePool) {
    const minHealthFactor = BigInt(config.AavePool.minHealthFactor) * 10000n / 100n;
    const defaultLTV = BigInt(config.AavePool.defaultLTV) * 10000n / 100n;
    console.log("Deploying AAVE Liquidity Pool");
    aavePool = (await verifier.deployX(
      "LiquidityPoolAave",
      deployer,
      {},
      [
        config.USDC,
        config.AavePool.AaveAddressesProvider,
        deployer,
        config.MpcAddress,
        minHealthFactor,
        defaultLTV,
      ],
      LiquidityPoolAaveUSDC,
    )) as LiquidityPoolAave;

    if (config.AavePool.tokenLTVs) {
      await aavePool.setBorrowTokenLTVs(config.AavePool.tokenLTVs!.Tokens, config.AavePool.tokenLTVs!.LTVs);
    }
    console.log(`LiquidityPoolAaveUSDC: ${aavePool.target}`);

    config.Routes.Pools.push(await aavePool.getAddress());
    config.Routes.Domains.push(network);
    config.Routes.Providers.push(Provider.LOCAL);

    mainPool = aavePool as LiquidityPool;
  } 
  
  let usdcPool: LiquidityPool;
  if (config.USDCPool) {
    console.log("Deploying USDC Liquidity Pool");
    usdcPool = (await verifier.deployX(
      "LiquidityPool", deployer, {}, [config.USDC, deployer, config.MpcAddress], LiquidityPoolUSDC
    )) as LiquidityPool;
    console.log(`LiquidityPoolUSDC: ${usdcPool.target}`);

    config.Routes.Pools.push(await usdcPool.getAddress());
    config.Routes.Domains.push(network);
    config.Routes.Providers.push(Provider.LOCAL);

    if (!config.AavePool) {
      mainPool = usdcPool;
    }
  }

  const rebalancerVersion = config.IsTest ? "TestRebalancer" : "Rebalancer";

  config.Routes.Pools = await verifier.predictDeployXAddresses(config.Routes!.Pools!, deployer);

  const {target: rebalancer, targetAdmin: rebalancerAdmin} = await deployProxyX<Rebalancer>(
    verifier.deployX,
    rebalancerVersion,
    deployer,
    config.Admin,
    [DomainSolidity[network], config.USDC, config.CCTP.TokenMessenger, config.CCTP.MessageTransmitter],
    [
      config.Admin,
      config.RebalanceCaller,
      config.Routes.Pools,
      config.Routes!.Domains!.map(el => DomainSolidity[el]) || [],
      config.Routes!.Providers!.map(el => ProviderSolidity[el]) || [],
    ],
    "Rebalancer",
  );

  if (config.AavePool) {
    await aavePool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await aavePool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await aavePool!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  if (config.USDCPool) {
    await usdcPool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await usdcPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await usdcPool!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  if (config.Hub) {
    const tiers = config.Hub!.Tiers;
    const assetsLimit = BigInt(config.Hub!.AssetsLimit) * 10n ** 6n;

    const liquidityHubAddress = await verifier.predictDeployProxyXAddress("LiquidityHub", deployer);
    const lpToken = (await verifier.deployX(
      "SprinterUSDCLPShare",
      deployer,
      {},
      [liquidityHubAddress],
      "SprinterUSDCLPShare",
      "contracts/SprinterUSDCLPShare.sol:SprinterUSDCLPShare"
    )) as SprinterUSDCLPShare;

    const {target: liquidityHub, targetAdmin: liquidityHubAdmin} = await deployProxyX<LiquidityHub>(
      verifier.deployX,
      "LiquidityHub",
      deployer,
      config.Admin,
      [lpToken, mainPool!],
      [config.USDC, config.Admin, config.Hub.AssetsAdjuster, config.Hub.DepositProfit, assetsLimit],
    );

    assert(liquidityHubAddress == liquidityHub.target, "LiquidityHub address mismatch");
    const liquidityMining = (
      await verifier.deployX("SprinterLiquidityMining", deployer, {}, [config.Admin, liquidityHub, tiers])
    ) as SprinterLiquidityMining;

    await mainPool!.grantRole(LIQUIDITY_ADMIN_ROLE, liquidityHub);

    console.log(`SprinterUSDCLPShare: ${lpToken.target}`);
    console.log(`LiquidityHub: ${liquidityHub.target}`);
    console.log(`LiquidityHubProxyAdmin: ${liquidityHubAdmin.target}`);
    console.log(`LiquidityHub Adjuster: ${config.Hub!.AssetsAdjuster}`);
    console.log(`LiquidityHub DepositProfit: ${config.Hub!.DepositProfit}`);
    console.log(`LiquidityHub Assets Limit: ${config.Hub!.AssetsLimit}`);
    console.log(`SprinterLiquidityMining: ${liquidityMining.target}`);
    console.log("Tiers:");
    console.table(tiers.map(el => {
      const multiplier = `${el.multiplier / 1000000000n}.${el.multiplier % 1000000000n}x`;
      return {seconds: Number(el.period), multiplier};
    }));
  }

  if (deployer.address !== config.Admin) {
    if (config.AavePool) {
      await aavePool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await aavePool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }

    if (config.USDCPool) {
      await usdcPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await usdcPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }
  }

  console.log(`Admin: ${config.Admin}`);
  console.log(`LiquidityPool Withdraw Profit: ${config.WithdrawProfit}`);
  console.log(`LiquidityPool Pauser: ${config.Pauser}`);
  console.log(`MPC Address: ${config.MpcAddress}`);
  console.log(`USDC: ${config.USDC}`);
  console.log(`Rebalancer: ${rebalancer.target}`);
  console.log(`RebalancerProxyAdmin: ${rebalancerAdmin.target}`);
  if (config.Routes) {
    console.log("Routes:");
    const transposedRoutes = [];
    for (let i = 0; i < config.Routes.Pools!.length; i++) {
      transposedRoutes.push({
        Pool: config.Routes.Pools![i],
        Domain: config.Routes.Domains![i],
        Provider: config.Routes.Providers![i],
      });
    }
    console.table(transposedRoutes);
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
