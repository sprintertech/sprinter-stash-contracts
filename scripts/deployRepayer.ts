import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {
  getVerifier, deployProxyX, getHardhatNetworkConfig, getNetworkConfig, addLocalPools,
  getInputOutputTokens, flattenInputOutputTokens,
} from "./helpers";
import {resolveXAddress} from "../test/helpers";
import {
  isSet, assert, ProviderSolidity, DomainSolidity, ZERO_ADDRESS, assertAddress,
} from "./common";
import {Repayer} from "../typechain-types";
import {
  Network, NetworkConfig, Provider,
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

  assertAddress(config.Tokens.USDC, "USDC must be an address");
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.RepayerCaller, "RepayerCaller must be an address");
  assertAddress(config.SetInputOutputTokens, "SetInputOutputTokens must be an address");
  assertAddress(config.WrappedNativeToken, "WrappedNativeToken must be an address");

  const repayerRoutes: {Pool: string, Domain: Network, Provider: Provider, SupportsAllTokens: boolean}[] = [];
  for (const [pool, domainProviders] of Object.entries(config.RepayerRoutes || {})) {
    for (const [domain, providers] of Object.entries(domainProviders.Domains) as [Network, Provider[]][]) {
      for (const provider of providers) {
        repayerRoutes.push({
          Pool: await resolveXAddress(pool, false),
          Domain: domain,
          Provider: provider,
          SupportsAllTokens: domainProviders.SupportsAllTokens,
        });
      }
    }
  }
  await addLocalPools(config, network, repayerRoutes, false);

  if (!config.CCTP) {
    config.CCTP = {
      TokenMessenger: ZERO_ADDRESS,
      MessageTransmitter: ZERO_ADDRESS,
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
  if (!config.BaseStandardBridge) {
    config.BaseStandardBridge = ZERO_ADDRESS;
  }
  if (!config.ArbitrumGatewayRouter) {
    config.ArbitrumGatewayRouter = ZERO_ADDRESS;
  }

  const inputOutputTokens = getInputOutputTokens(network, config);
  const repayerVersion = config.IsTest ? "TestRepayer" : "Repayer";

  const {target: repayer, targetAdmin: repayerAdmin} = await deployProxyX<Repayer>(
    verifier.deployX,
    repayerVersion,
    deployer,
    config.Admin,
    [
      DomainSolidity[network],
      config.Tokens.USDC,
      config.CCTP.TokenMessenger,
      config.CCTP.MessageTransmitter,
      config.AcrossV3SpokePool,
      config.EverclearFeeAdapter,
      config.WrappedNativeToken,
      config.StargateTreasurer,
      config.OptimismStandardBridge,
      config.BaseStandardBridge,
      config.ArbitrumGatewayRouter,
    ],
    [
      config.Admin,
      config.RepayerCaller,
      config.SetInputOutputTokens,
      repayerRoutes.map(el => el.Pool),
      repayerRoutes.map(el => DomainSolidity[el.Domain]),
      repayerRoutes.map(el => ProviderSolidity[el.Provider]),
      repayerRoutes.map(el => el.SupportsAllTokens),
      inputOutputTokens,
    ],
    id,
    verifier,
  );

  console.log(`Repayer: ${repayer.target}`);
  console.log(`RepayerProxyAdmin: ${repayerAdmin.target}`);
  if (repayerRoutes.length > 0) {
    console.log("RepayerRoutes:");
    console.table(repayerRoutes);
  }
  if (inputOutputTokens.length > 0) {
    console.log("InputOutputTokens:");
    console.table(flattenInputOutputTokens(inputOutputTokens));
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
