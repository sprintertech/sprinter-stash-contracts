import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {isAddress} from "ethers";
import {getVerifier, deployProxyX, getHardhatNetworkConfig, getNetworkConfig} from "./helpers";
import {resolveXAddress} from "../test/helpers";
import {isSet, assert, ProviderSolidity, DomainSolidity, ZERO_ADDRESS} from "./common";
import {Repayer} from "../typechain-types";
import {
  Network, NetworkConfig, Provider, LiquidityPoolUSDC, LiquidityPoolAaveUSDC,
  LiquidityPoolAaveUSDCV2, LiquidityPoolUSDCStablecoin
} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = "Repayer";

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying Repayer");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }

  assert(isAddress(config.USDC), "USDC must be an address");
  assert(isAddress(config.Admin), "Admin must be an address");
  assert(isAddress(config.RepayerCaller), "RepayerCaller must be an address");
  assert(isAddress(config.CCTP.TokenMessenger), "CCTP TokenMessenger must be an address");
  assert(isAddress(config.CCTP.MessageTransmitter), "CCTP MessageTransmitter must be an address");
  assert(isAddress(config.WrappedNativeToken), "WrappedNativeToken must be an address");

  const repayerRoutes: {Pools: string[], Domains: Network[], Providers: Provider[], SupportsAllTokens: boolean[]} = {
    Pools: [],
    Domains: [],
    Providers: [],
    SupportsAllTokens: [],
  };

  if (config.RepayerRoutes) {
    for (const [pool, domainProviders] of Object.entries(config.RepayerRoutes)) {
      for (const [domain, providers] of Object.entries(domainProviders.Domains)) {
        for (const provider of providers) {
          repayerRoutes.Pools.push(pool);
          repayerRoutes.Domains.push(domain as Network);
          repayerRoutes.Providers.push(provider);
          repayerRoutes.SupportsAllTokens.push(domainProviders.SupportsAllTokens);
        }
      }
    }
  }

  if (!config.AcrossV3SpokePool) {
    config.AcrossV3SpokePool = ZERO_ADDRESS;
  }
  if (!config.StargateTreasurer) {
    config.StargateTreasurer = ZERO_ADDRESS;
  }
  if (!config.EverclearFeeAdapter) {
    config.EverclearFeeAdapter = ZERO_ADDRESS;
  }
  if (!config.OptimismStandardBridge) {
    config.OptimismStandardBridge = ZERO_ADDRESS;
  }

  if (config.AavePool) {
    let aavePool: string;
    try {
      aavePool = await resolveXAddress(LiquidityPoolAaveUSDCV2);
    } catch {
      aavePool = await resolveXAddress(LiquidityPoolAaveUSDC);
    }
    console.log(`LiquidityPoolAave: ${aavePool}`);
    repayerRoutes.Pools.push(aavePool);
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.SupportsAllTokens.push(true);
  }

  if (config.USDCPool) {
    const usdcPool = await resolveXAddress(LiquidityPoolUSDC);
    console.log(`LiquidityPool: ${usdcPool}`);
    repayerRoutes.Pools.push(usdcPool);
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.SupportsAllTokens.push(false);
  }

  if (config.USDCStablecoinPool) {
    const usdcStablecoinPool = await resolveXAddress(LiquidityPoolUSDCStablecoin);
    console.log(`LiquidityPoolStablecoin: ${usdcStablecoinPool}`);
    repayerRoutes.Pools.push(usdcStablecoinPool);
    repayerRoutes.Domains.push(network);
    repayerRoutes.Providers.push(Provider.LOCAL);
    repayerRoutes.SupportsAllTokens.push(true);
  }

  const repayerVersion = config.IsTest ? "TestRepayer" : "Repayer";

  repayerRoutes.Pools = await verifier.predictDeployXAddresses(repayerRoutes.Pools, deployer);

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
      config.EverclearFeeAdapter,
      config.WrappedNativeToken,
      config.StargateTreasurer,
      config.OptimismStandardBridge,
    ],
    [
      config.Admin,
      config.RepayerCaller,
      repayerRoutes.Pools,
      repayerRoutes.Domains.map(el => DomainSolidity[el]) || [],
      repayerRoutes.Providers.map(el => ProviderSolidity[el]) || [],
      repayerRoutes.SupportsAllTokens,
    ],
    id,
  );

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
