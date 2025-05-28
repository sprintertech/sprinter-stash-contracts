import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {MaxUint256, isAddress} from "ethers";
import {toBytes32, resolveProxyXAddress} from "../test/helpers";
import {
  getVerifier, deployProxyX, getHardhatNetworkConfig, getNetworkConfig,
} from "./helpers";
import {
  assert, isSet, ProviderSolidity, DomainSolidity, DEFAULT_ADMIN_ROLE, ZERO_ADDRESS
} from "./common";
import {
  SprinterUSDCLPShare, LiquidityHub, SprinterLiquidityMining,
  Rebalancer, Repayer, LiquidityPool, LiquidityPoolAave, LiquidityPoolStablecoin,
} from "../typechain-types";
import {
  Network, Provider, NetworkConfig, LiquidityPoolUSDC,
  LiquidityPoolAaveUSDC, LiquidityPoolUSDCStablecoin
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
  console.log("Deploying contracts set");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    console.log("TEST: Using TEST USDC and CCTP");
    await verifier.deployX("TestUSDC", deployer);
    await verifier.deployX("TestWETH", deployer);
    await verifier.deployX("TestCCTPTokenMessenger", deployer);
    await verifier.deployX("TestCCTPMessageTransmitter", deployer);
    await verifier.deployX("TestAcrossV3SpokePool", deployer);
    ({network, config} = await getHardhatNetworkConfig());
  }

  assert(config.AavePool! || config.USDCPool! || config.USDCStablecoinPool!,
    "At least one pool should be present.");
  assert(isAddress(config.USDC), "USDC must be an address");
  assert(isAddress(config.Admin), "Admin must be an address");
  assert(isAddress(config.WithdrawProfit), "WithdrawProfit must be an address");
  assert(isAddress(config.Pauser), "Pauser must be an address");
  assert(isAddress(config.RebalanceCaller), "RebalanceCaller must be an address");
  assert(isAddress(config.RepayerCaller), "RepayerCaller must be an address");
  assert(isAddress(config.MpcAddress), "MpcAddress must be an address");
  assert(isAddress(config.WrappedNativeToken), "WrappedNativeToken must be an address");

  if (config.Hub) {
    assert(config.Hub!.Tiers.length > 0, "Empty liquidity mining tiers configuration.");
    assert(config.Hub!.AssetsLimit <= MaxUint256 / 10n ** 12n, "Assets limit is too high");
  }

  if (!config.RebalancerRoutes) {
    config.RebalancerRoutes = {
      Pools: [],
      Domains: [],
      Providers: [],
    };
  }

  if (!config.RepayerRoutes) {
    config.RepayerRoutes = {
      Pools: [],
      Domains: [],
      Providers: [],
      SupportsAllTokens: [],
    };
  }

  if (!config.AcrossV3SpokePool) {
    config.AcrossV3SpokePool = ZERO_ADDRESS;
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
        config.WrappedNativeToken,
      ],
      LiquidityPoolAaveUSDC,
    )) as LiquidityPoolAave;

    if (config.AavePool.tokenLTVs) {
      await aavePool.setBorrowTokenLTVs(config.AavePool.tokenLTVs!.Tokens, config.AavePool.tokenLTVs!.LTVs);
    }
    console.log(`LiquidityPoolAaveUSDC: ${aavePool.target}`);

    config.RebalancerRoutes.Pools.push(await aavePool.getAddress());
    config.RebalancerRoutes.Domains.push(network);
    config.RebalancerRoutes.Providers.push(Provider.LOCAL);

    config.RepayerRoutes.Pools.push(await aavePool.getAddress());
    config.RepayerRoutes.Domains.push(network);
    config.RepayerRoutes.Providers.push(Provider.LOCAL);
    config.RepayerRoutes.SupportsAllTokens.push(true);

    mainPool = aavePool as LiquidityPool;
  } 
  
  let usdcPool: LiquidityPool;
  if (config.USDCPool) {
    console.log("Deploying USDC Liquidity Pool");
    usdcPool = (await verifier.deployX(
      "LiquidityPool", deployer, {}, [config.USDC, deployer, config.MpcAddress], LiquidityPoolUSDC
    )) as LiquidityPool;
    console.log(`LiquidityPoolUSDC: ${usdcPool.target}`);

    config.RebalancerRoutes.Pools.push(await usdcPool.getAddress());
    config.RebalancerRoutes.Domains.push(network);
    config.RebalancerRoutes.Providers.push(Provider.LOCAL);

    config.RepayerRoutes.Pools.push(await usdcPool.getAddress());
    config.RepayerRoutes.Domains.push(network);
    config.RepayerRoutes.Providers.push(Provider.LOCAL);
    config.RepayerRoutes.SupportsAllTokens.push(false);

    if (!config.AavePool) {
      mainPool = usdcPool;
    }
  }

  let usdcStablecoinPool: LiquidityPoolStablecoin;
  if (config.USDCStablecoinPool) {
    console.log("Deploying USDC Stablecoin Liquidity Pool");
    usdcStablecoinPool = (await verifier.deployX(
      "LiquidityPoolStablecoin", deployer, {}, [config.USDC, deployer, config.MpcAddress], LiquidityPoolUSDCStablecoin
    )) as LiquidityPool;
    console.log(`LiquidityPoolUSDCStablecoin: ${usdcStablecoinPool.target}`);

    config.RebalancerRoutes.Pools.push(await usdcStablecoinPool.getAddress());
    config.RebalancerRoutes.Domains.push(network);
    config.RebalancerRoutes.Providers.push(Provider.LOCAL);

    config.RepayerRoutes.Pools.push(await usdcStablecoinPool.getAddress());
    config.RepayerRoutes.Domains.push(network);
    config.RepayerRoutes.Providers.push(Provider.LOCAL);
    config.RepayerRoutes.SupportsAllTokens.push(false);

    if ((!config.AavePool) && (!config.USDCPool)) {
      mainPool = usdcStablecoinPool;
    }
  }

  const rebalancerVersion = config.IsTest ? "TestRebalancer" : "Rebalancer";

  config.RebalancerRoutes.Pools = await verifier.predictDeployXAddresses(config.RebalancerRoutes!.Pools!, deployer);

  const {target: rebalancer, targetAdmin: rebalancerAdmin} = await deployProxyX<Rebalancer>(
    verifier.deployX,
    rebalancerVersion,
    deployer,
    config.Admin,
    [DomainSolidity[network], config.USDC, config.CCTP.TokenMessenger, config.CCTP.MessageTransmitter],
    [
      config.Admin,
      config.RebalanceCaller,
      config.RebalancerRoutes.Pools,
      config.RebalancerRoutes!.Domains!.map(el => DomainSolidity[el]) || [],
      config.RebalancerRoutes!.Providers!.map(el => ProviderSolidity[el]) || [],
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

  if (config.USDCStablecoinPool) {
    await usdcStablecoinPool!.grantRole(LIQUIDITY_ADMIN_ROLE, rebalancer);
    await usdcStablecoinPool!.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
    await usdcStablecoinPool!.grantRole(PAUSER_ROLE, config.Pauser);
  }

  const repayerVersion = config.IsTest ? "TestRepayer" : "Repayer";

  config.RepayerRoutes.Pools = await verifier.predictDeployXAddresses(config.RepayerRoutes!.Pools!, deployer);

  const {target: repayer, targetAdmin: repayerAdmin} = await deployProxyX<Repayer>(
    verifier.deployX,
    repayerVersion,
    deployer,
    config.Admin,
    [
      DomainSolidity[network],
      config.USDC,
      config.CCTP.TokenMessenger,
      config.CCTP.MessageTransmitter,
      config.AcrossV3SpokePool,
      config.WrappedNativeToken,
    ],
    [
      config.Admin,
      config.RepayerCaller,
      config.RepayerRoutes.Pools,
      config.RepayerRoutes!.Domains!.map(el => DomainSolidity[el]) || [],
      config.RepayerRoutes!.Providers!.map(el => ProviderSolidity[el]) || [],
      config.RepayerRoutes!.SupportsAllTokens,
    ],
    "Repayer",
  );

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
      [
        config.USDC,
        config.Admin,
        config.Hub.AssetsAdjuster,
        config.Hub.DepositProfit,
        config.Hub.AssetsLimitSetter,
        assetsLimit
      ],
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
    console.log(`LiquidityHub AssetsLimitSetter: ${config.Hub!.AssetsLimitSetter}`);
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

    if (config.USDCStablecoinPool) {
      await usdcStablecoinPool!.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
      await usdcStablecoinPool!.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
    }
  }

  let multicall: string;
  try {
    multicall = await resolveProxyXAddress("CensoredTransferFromMulticall");
    console.log("Multicall was already deployed");
  } catch {
    multicall = await (await verifier.deployX(
      "CensoredTransferFromMulticall",
      deployer,
    )).getAddress();
  }

  console.log(`Multicall: ${multicall}`);
  console.log(`Admin: ${config.Admin}`);
  console.log(`LiquidityPool Withdraw Profit: ${config.WithdrawProfit}`);
  console.log(`LiquidityPool Pauser: ${config.Pauser}`);
  console.log(`MPC Address: ${config.MpcAddress}`);
  console.log(`USDC: ${config.USDC}`);
  console.log(`Rebalancer: ${rebalancer.target}`);
  console.log(`RebalancerProxyAdmin: ${rebalancerAdmin.target}`);
  if (config.RebalancerRoutes) {
    console.log("RebalancerRoutes:");
    const transposedRoutes = [];
    for (let i = 0; i < config.RebalancerRoutes.Pools.length; i++) {
      transposedRoutes.push({
        Pool: config.RebalancerRoutes.Pools[i],
        Domain: config.RebalancerRoutes.Domains[i],
        Provider: config.RebalancerRoutes.Providers[i],
      });
    }
    console.table(transposedRoutes);
  }
  console.log(`Repayer: ${repayer.target}`);
  console.log(`RepayerProxyAdmin: ${repayerAdmin.target}`);
  if (config.RepayerRoutes) {
    console.log("RepayerRoutes:");
    const transposedRoutes = [];
    for (let i = 0; i < config.RepayerRoutes.Pools.length; i++) {
      transposedRoutes.push({
        Pool: config.RepayerRoutes.Pools[i],
        Domain: config.RepayerRoutes.Domains[i],
        Provider: config.RepayerRoutes.Providers[i],
        SupportsAllTokens: config.RepayerRoutes.SupportsAllTokens[i],
      });
    }
    console.table(transposedRoutes);
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
