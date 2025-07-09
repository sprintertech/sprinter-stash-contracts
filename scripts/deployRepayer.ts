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
    config.RepayerRoutes.Pools.push(aavePool);
    config.RepayerRoutes.Domains.push(network);
    config.RepayerRoutes.Providers.push(Provider.LOCAL);
    config.RepayerRoutes.SupportsAllTokens.push(true);
  }

  if (config.USDCPool) {
    const usdcPool = await resolveXAddress(LiquidityPoolUSDC);
    console.log(`LiquidityPool: ${usdcPool}`);
    config.RepayerRoutes.Pools.push(usdcPool);
    config.RepayerRoutes.Domains.push(network);
    config.RepayerRoutes.Providers.push(Provider.LOCAL);
    config.RepayerRoutes.SupportsAllTokens.push(false);
  }

  if (config.USDCStablecoinPool) {
    const usdcStablecoinPool = await resolveXAddress(LiquidityPoolUSDCStablecoin);
    console.log(`LiquidityPoolStablecoin: ${usdcStablecoinPool}`);
    config.RepayerRoutes.Pools.push(usdcStablecoinPool);
    config.RepayerRoutes.Domains.push(network);
    config.RepayerRoutes.Providers.push(Provider.LOCAL);
    config.RepayerRoutes.SupportsAllTokens.push(true);
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
      config.EverclearFeeAdapter,
      config.WrappedNativeToken,
      config.StargateTreasurer,
      config.OptimismStandardBridge,
    ],
    [
      config.Admin,
      config.RepayerCaller,
      config.RepayerRoutes.Pools,
      config.RepayerRoutes!.Domains!.map(el => DomainSolidity[el]) || [],
      config.RepayerRoutes!.Providers!.map(el => ProviderSolidity[el]) || [],
      config.RepayerRoutes!.SupportsAllTokens,
    ],
    id,
  );

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
