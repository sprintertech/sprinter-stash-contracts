import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {MaxUint256, getBigInt, resolveAddress} from "ethers";
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
  Rebalancer, LiquidityPool,
} from "../typechain-types";
import {
  networkConfig, Network, Provider, NetworkConfig, LiquidityPoolUSDC,
  LiquidityPoolAaveUSDC,
} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const maxLimit: bigint = MaxUint256 / 10n ** 12n;

  const LIQUIDITY_ADMIN_ROLE = toBytes32("LIQUIDITY_ADMIN_ROLE");
  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log(`Deploying to: ${hre.network.name}`);
  if (Object.values(Network).includes(hre.network.name as Network)) {
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
    config = {
      CCTP: {
        TokenMessenger: await cctpTokenMessenger.getAddress(),
        MessageTransmitter: await cctpMessageTransmitter.getAddress(),
      },
      USDC: await testUSDC.getAddress(),
      IsTest: false,
      IsHub: true,
      Admin: deployer.address,
      AssetsAdjuster: deployer.address,
      WithdrawProfit: deployer.address,
      Pauser: deployer.address,
      RebalanceCaller: deployer.address,
      MpcAddress: deployer.address,
      Routes: {
        Pools: [LiquidityPoolUSDC],
        Domains: [Network.ETHEREUM],
        Providers: [Provider.CCTP],
      },
      USDCPool: true
    };
  }

  assert(typeof config.AavePool !== 'undefined' || (typeof config.USDCPool !== 'undefined' && config.USDCPool),
    "At least one pool should be present.")

  if (!config.Routes) {
    config.Routes = {
      Pools: [],
      Domains: [],
      Providers: [],
    };
  }

  if (!config.Admin) {
    config.Admin = deployer.address;
  }

  if (!config.AssetsAdjuster) {
    config.AssetsAdjuster = deployer.address;
  }

  let assetsLimit: bigint = getBigInt(maxLimit);
  if (config.AssetsLimit) {
    assetsLimit = getBigInt(config.AssetsLimit);
  }

  if (!config.RebalanceCaller) {
    config.RebalanceCaller = deployer.address;
  }

  if (!config.MpcAddress) {
    config.MpcAddress = deployer.address;
  }

  if (!config.WithdrawProfit) {
    config.WithdrawProfit = deployer.address;
  }

  if (!config.Pauser) {
    config.Pauser = deployer.address;
  }

  let minHealthFactor: bigint = getBigInt(500n);
  if (config.AavePool) {
    if (config.AavePool.minHealthFactor) {
      minHealthFactor = getBigInt(config.AavePool.minHealthFactor);
    }
    minHealthFactor = minHealthFactor * 10n ** 18n / 100n;
  }

  let defaultLTV: bigint = getBigInt(20n);
  if (config.AavePool) {
    if (config.AavePool.defaultLTV) {
      defaultLTV = getBigInt(config.AavePool.defaultLTV);
    }
    defaultLTV = defaultLTV * 10n ** 18n / 100n;
  }

  let aavePool: LiquidityPool;
  let mainPoolId: string;
  if (config.AavePool) {
    console.log("Deploying AAVE Liquidity Pool");
    mainPoolId = LiquidityPoolAaveUSDC;
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
      mainPoolId,
    )) as LiquidityPool;
    console.log(`LiquidityPoolAave: ${aavePool.target}`);

    config.Routes.Pools.push(await aavePool.getAddress());
    config.Routes.Domains.push(network);
    config.Routes.Providers.push(Provider.LOCAL);
  } 
  
  let usdcPool: LiquidityPool;
  if (config.USDCPool) {
    console.log("Deploying USDC Liquidity Pool");
    usdcPool = (await verifier.deployX(
      "LiquidityPool", deployer, {}, [config.USDC, config.Admin, config.MpcAddress], LiquidityPoolUSDC
    )) as LiquidityPool;
    console.log(`LiquidityPoolUSDC: ${usdcPool.target}`);

    config.Routes.Pools.push(await usdcPool.getAddress());
    config.Routes.Domains.push(network);
    config.Routes.Providers.push(Provider.LOCAL);
  }

  let liquidityPool;
  if (config.AavePool) {
    liquidityPool = aavePool!;
  } else {
    mainPoolId = LiquidityPoolUSDC;
    liquidityPool = usdcPool!;
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

  await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
  await liquidityPool.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await liquidityPool.grantRole(PAUSER_ROLE, config.Pauser);

  if (config.USDCPool) {
    await usdcPool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await usdcPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await usdcPool!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  if (config.IsHub) {
    const tiers = [];

    for (let i = 1;; i++) {
      if (!isSet(process.env[`TIER_${i}_SECONDS`])) {
        break;
      }
      const period = BigInt(process.env[`TIER_${i}_SECONDS`] || "0");
      const multiplier = BigInt(process.env[`TIER_${i}_MULTIPLIER`] || "0");
      tiers.push({period, multiplier});
    }

    if (tiers.length == 0) {
      throw new Error("Empty liquidity mining tiers configuration.");
    }

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
      [lpToken, liquidityPool],
      [config.USDC, config.Admin, config.AssetsAdjuster, assetsLimit],
    );

    assert(liquidityHubAddress == liquidityHub.target, "LiquidityHub address mismatch");
    const liquidityMining = (
      await verifier.deployX("SprinterLiquidityMining", deployer, {}, [config.Admin, liquidityHub, tiers])
    ) as SprinterLiquidityMining;

    await liquidityPool.grantRole(LIQUIDITY_ADMIN_ROLE, liquidityHub);

    console.log(`SprinterUSDCLPShare: ${lpToken.target}`);
    console.log(`LiquidityHub: ${liquidityHub.target}`);
    console.log(`LiquidityHubProxyAdmin: ${liquidityHubAdmin.target}`);
    console.log(`LiquidityHub Adjuster: ${config.AssetsAdjuster}`);
    console.log(`SprinterLiquidityMining: ${liquidityMining.target}`);
    console.log("Tiers:");
    console.table(tiers.map(el => {
      const multiplier = `${el.multiplier / 1000000000n}.${el.multiplier % 1000000000n}x`;
      return {seconds: Number(el.period), multiplier};
    }));
  }

  if (deployer.address !== config.Admin) {
    await liquidityPool.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    await liquidityPool.renounceRole(DEFAULT_ADMIN_ROLE, deployer);

    if (config.USDCPool) {
      await usdcPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await usdcPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }
  }

  console.log(`Admin: ${config.Admin}`);
  console.log(`${mainPoolId!}: ${liquidityPool.target}`);
  console.log(`LiquidityPool Withdraw Profit: ${config.WithdrawProfit}`);
  console.log(`LiquidityPool Pauser: ${config.Pauser}`);
  console.log(`USDC: ${config.USDC}`);
  console.log(`Rebalancer: ${rebalancer.target}`);
  console.log(`RebalancerProxyAdmin: ${rebalancerAdmin.target}`);
  console.log("Routes:");
  console.table(config.Routes || {});

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
