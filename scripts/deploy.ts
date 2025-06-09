import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {MaxUint256, isAddress} from "ethers";
import {toBytes32, resolveProxyXAddress} from "../test/helpers";
import {
  getVerifier, deployProxyX, getHardhatNetworkConfig, getNetworkConfig, percentsToBps,
} from "./helpers";
import {
  assert, isSet, ProviderSolidity, DomainSolidity, DEFAULT_ADMIN_ROLE, ZERO_ADDRESS,
  sameAddress,
} from "./common";
import {
  SprinterUSDCLPShare, LiquidityHub, SprinterLiquidityMining,
  Rebalancer, Repayer, LiquidityPool, LiquidityPoolAave, LiquidityPoolStablecoin,
} from "../typechain-types";
import {
  Network, Provider, NetworkConfig, LiquidityPoolUSDC,
  LiquidityPoolAaveUSDCV2, LiquidityPoolUSDCStablecoin, RebalancerRoutesConfig, RepayerRoutesConfig,
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
    assert(config.Hub.Tiers.length > 0, "Empty liquidity mining tiers configuration.");
    assert(config.Hub.AssetsLimit <= MaxUint256 / 10n ** 12n, "Assets limit is too high");
  }

  const rebalancerRoutes: RebalancerRoutesConfig = {
    Pools: [],
    Domains: [],
    Providers: [],
  };
  if (config.RebalancerRoutes) {
    rebalancerRoutes.Pools = rebalancerRoutes.Pools.concat(config.RebalancerRoutes.Pools);
    rebalancerRoutes.Domains = rebalancerRoutes.Domains.concat(config.RebalancerRoutes.Domains);
    rebalancerRoutes.Providers = rebalancerRoutes.Providers.concat(config.RebalancerRoutes.Providers);
  }

  const repayerRoutes: RepayerRoutesConfig = {
    Pools: [],
    Domains: [],
    Providers: [],
    SupportsAllTokens: [],
  };
  if (config.RepayerRoutes) {
    repayerRoutes.Pools = repayerRoutes.Pools.concat(config.RepayerRoutes.Pools);
    repayerRoutes.Domains = repayerRoutes.Domains.concat(config.RepayerRoutes.Domains);
    repayerRoutes.Providers = repayerRoutes.Providers.concat(config.RepayerRoutes.Providers);
    repayerRoutes.SupportsAllTokens = repayerRoutes.SupportsAllTokens.concat(config.RepayerRoutes.SupportsAllTokens);
  }

  if (!config.AcrossV3SpokePool) {
    config.AcrossV3SpokePool = ZERO_ADDRESS;
  }

  if (!config.StargateTreasurer) {
    config.StargateTreasurer = ZERO_ADDRESS;
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
      LiquidityPoolAaveUSDCV2,
    )) as LiquidityPoolAave;

    if (config.AavePool.tokenLTVs) {
      await aavePool.setBorrowTokenLTVs(
        config.AavePool.tokenLTVs.Tokens,
        percentsToBps(config.AavePool.tokenLTVs.LTVs)
      );
    }
    console.log(`LiquidityPoolAaveUSDC: ${aavePool.target}`);

    rebalancerRoutes.Pools.push(await aavePool.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await aavePool.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.SupportsAllTokens.push(true);

    mainPool = aavePool as LiquidityPool;
  } 
  
  let usdcPool: LiquidityPool;
  if (config.USDCPool) {
    console.log("Deploying USDC Liquidity Pool");
    usdcPool = (await verifier.deployX(
      "LiquidityPool", deployer, {}, [config.USDC, deployer, config.MpcAddress], LiquidityPoolUSDC
    )) as LiquidityPool;
    console.log(`LiquidityPoolUSDC: ${usdcPool.target}`);

    rebalancerRoutes.Pools.push(await usdcPool.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await usdcPool.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.SupportsAllTokens.push(false);

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

    rebalancerRoutes.Pools.push(await usdcStablecoinPool.getAddress());
    rebalancerRoutes.Domains.push(network);
    rebalancerRoutes.Providers.push(Provider.LOCAL);

    repayerRoutes.Pools.push(await usdcStablecoinPool.getAddress());
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.SupportsAllTokens.push(false);

    if ((!config.AavePool) && (!config.USDCPool)) {
      mainPool = usdcStablecoinPool;
    }
  }

  const rebalancerVersion = config.IsTest ? "TestRebalancer" : "Rebalancer";

  rebalancerRoutes.Pools = await verifier.predictDeployXAddresses(rebalancerRoutes.Pools, deployer);

  const {target: rebalancer, targetAdmin: rebalancerAdmin} = await deployProxyX<Rebalancer>(
    verifier.deployX,
    rebalancerVersion,
    deployer,
    config.Admin,
    [DomainSolidity[network], config.USDC, config.CCTP.TokenMessenger, config.CCTP.MessageTransmitter],
    [
      config.Admin,
      config.RebalanceCaller,
      rebalancerRoutes.Pools,
      rebalancerRoutes.Domains.map(el => DomainSolidity[el]),
      rebalancerRoutes.Providers.map(el => ProviderSolidity[el]),
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

  repayerRoutes.Pools = await verifier.predictDeployXAddresses(repayerRoutes.Pools || [], deployer);

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
      config.StargateTreasurer,
    ],
    [
      config.Admin,
      config.RepayerCaller,
      repayerRoutes.Pools,
      repayerRoutes.Domains.map(el => DomainSolidity[el]),
      repayerRoutes.Providers.map(el => ProviderSolidity[el]),
      repayerRoutes.SupportsAllTokens,
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

  if (!sameAddress(deployer.address, config.Admin)) {
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
  if (rebalancerRoutes.Pools.length > 0) {
    console.log("RebalancerRoutes:");
    const transposedRoutes = [];
    for (let i = 0; i < rebalancerRoutes.Pools.length; i++) {
      transposedRoutes.push({
        Pool: rebalancerRoutes.Pools[i],
        Domain: rebalancerRoutes.Domains[i],
        Provider: rebalancerRoutes.Providers[i],
      });
    }
    console.table(transposedRoutes);
  }
  console.log(`Repayer: ${repayer.target}`);
  console.log(`RepayerProxyAdmin: ${repayerAdmin.target}`);
  if (repayerRoutes.Pools.length > 0) {
    console.log("RepayerRoutes:");
    const transposedRoutes = [];
    for (let i = 0; i < repayerRoutes.Pools.length; i++) {
      transposedRoutes.push({
        Pool: repayerRoutes.Pools[i],
        Domain: repayerRoutes.Domains[i],
        Provider: repayerRoutes.Providers[i],
        SupportsAllTokens: repayerRoutes.SupportsAllTokens[i],
      });
    }
    console.table(transposedRoutes);
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
