import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {isAddress, getAddress} from "ethers";
import {getVerifier, deployProxyX, getHardhatStandaloneRepayerConfig, getStandaloneRepayerConfig} from "./helpers";
import {toBytes32} from "../test/helpers";
import {isSet, assert, ProviderSolidity, DomainSolidity, ZERO_ADDRESS, DEFAULT_ADMIN_ROLE} from "./common";
import {Repayer} from "../typechain-types";
import {
  Network, StandaloneRepayerConfig, StandaloneRepayerEnv, Provider,
} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const REPAYER_ROLE = toBytes32("REPAYER_ROLE");
  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  const repayerEnv = process.env.STANDALONE_REPAYER_ENV as StandaloneRepayerEnv;
  assert(isSet(repayerEnv), "STANDALONE_REPAYER_ENV must be set");
  if (!Object.values(StandaloneRepayerEnv).includes(repayerEnv)) {
    throw new Error(`Unknown repayer env ${repayerEnv}`);
  }
  let id = process.env.STANDALONE_REPAYER_ENV;

  let network: Network;
  let config: StandaloneRepayerConfig;
  console.log("Deploying Standalone Repayer");
  ({network, config} = await getStandaloneRepayerConfig(repayerEnv));
  if (!network) {
    ({network, config} = await getHardhatStandaloneRepayerConfig(repayerEnv));
    id += "-DeployTest";
  }

  assert(isAddress(config.USDC), "USDC must be an address");
  assert(isAddress(config.Admin), "Admin must be an address");
  assert(config.RepayerCallers.length > 0, "RepayerCallers must not be empty");
  config.RepayerCallers.forEach(el => assert(isAddress(el), "Each RepayerCaller must be an address"));
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
      deployer.address,
      config.RepayerCallers[0],
      repayerRoutes.Pools,
      repayerRoutes.Domains.map(el => DomainSolidity[el]) || [],
      repayerRoutes.Providers.map(el => ProviderSolidity[el]) || [],
      repayerRoutes.SupportsAllTokens,
    ],
    id,
  );

  if (config.RepayerCallers.length > 1) {
    for (let i = 1; i < config.RepayerCallers.length; i++) {
      await repayer.grantRole(REPAYER_ROLE, config.RepayerCallers[i]);
    }
  }

  console.log(`Repayer: ${repayer.target}`);
  console.log(`RepayerProxyAdmin: ${repayerAdmin.target}`);
  console.log("Repayer callers:", config.RepayerCallers.join(", "));
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

  if (getAddress(deployer.address) != getAddress(config.Admin)) {
    await repayer.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    await repayer.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
