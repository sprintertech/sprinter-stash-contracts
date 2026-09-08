import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {NonceManager} from "ethers";
import {
  getVerifier, deployProxyX, getHardhatNetworkConfig, getNetworkConfig, addLocalPools,
  getInputOutputTokens, flattenInputOutputTokens,
  logDeployers, resolveOnlySupportedToken,
  getDestinationRepayerAddresses,
} from "./helpers";
import {resolveXAddress} from "../test/helpers";
import {
  isSet, assert, ProviderSolidity, DomainSolidity, ZERO_ADDRESS, assertAddress,
  SolidityDomain,
} from "./common";
import {Repayer} from "../typechain-types";
import {
  Network, NetworkConfig, Provider,
} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

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

  await logDeployers();
  let usdcAddress = ZERO_ADDRESS;
  if (config.Tokens.USDC) {
    usdcAddress = config.Tokens.USDC.Address;
    assertAddress(usdcAddress, "USDC must be an address");
  }
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.RepayerCaller, "RepayerCaller must be an address");
  assertAddress(config.SetInputOutputTokens, "SetInputOutputTokens must be an address");
  assertAddress(config.WrappedNativeToken, "WrappedNativeToken must be an address");

  const repayerRoutes: {Pool: string, Domain: Network, Provider: Provider, OnlySupportedToken: string}[] = [];
  for (const [pool, domainProviders] of Object.entries(config.RepayerRoutes || {})) {
    for (const [domain, providers] of Object.entries(domainProviders.Domains) as [Network, Provider[]][]) {
      for (const provider of providers) {
        repayerRoutes.push({
          Pool: await resolveXAddress(pool, false),
          Domain: domain,
          Provider: provider,
          OnlySupportedToken: resolveOnlySupportedToken(config.Tokens, domainProviders.OnlySupportedToken),
        });
      }
    }
  }
  await addLocalPools(config, network, repayerRoutes, false);

  if (!config.CCTPV2) {
    config.CCTPV2 = {
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
  if (!config.OptimismStandardBridge) {
    config.OptimismStandardBridge = ZERO_ADDRESS;
  }
  if (!config.BaseStandardBridge) {
    config.BaseStandardBridge = ZERO_ADDRESS;
  }
  if (!config.ArbitrumGatewayRouter) {
    config.ArbitrumGatewayRouter = ZERO_ADDRESS;
  }
  if (!config.PolygonPosRootChainManager) {
    config.PolygonPosRootChainManager = ZERO_ADDRESS;
  }
  if (!config.Omnibridge) config.Omnibridge = ZERO_ADDRESS;
  if (!config.GnosisUSDCxDAI) config.GnosisUSDCxDAI = ZERO_ADDRESS;
  if (!config.GnosisUSDCTransmuter) config.GnosisUSDCTransmuter = ZERO_ADDRESS;
  if (!config.GnosisAMB) config.GnosisAMB = ZERO_ADDRESS;
  if (!config.USDT0OFT) config.USDT0OFT = ZERO_ADDRESS;
  if (!config.USDT0FeeNativeToken) config.USDT0FeeNativeToken = ZERO_ADDRESS;

  const inputOutputTokens = getInputOutputTokens(network, config);
  const repayerVersion = "Repayer";
  const destinationRepayerAddresses = await getDestinationRepayerAddresses(network);

  const {target: repayer, targetAdmin: repayerAdmin} = await deployProxyX<Repayer>(
    verifier.deployX,
    repayerVersion,
    deployerWithNonce,
    config.Admin,
    [
      DomainSolidity[network],
      usdcAddress,
      config.AcrossV3SpokePool,
      config.WrappedNativeToken,
      config.StargateTreasurer,
      config.OptimismStandardBridge,
      config.BaseStandardBridge,
      config.ArbitrumGatewayRouter,
      config.Omnibridge,
      config.GnosisUSDCxDAI,
      config.GnosisUSDCTransmuter,
      config.GnosisAMB,
      config.USDT0OFT,
      config.USDT0FeeNativeToken,
      config.CCTPV2.TokenMessenger,
      config.CCTPV2.MessageTransmitter,
      config.PolygonPosRootChainManager,
    ],
    [
      config.Admin,
      config.RepayerCaller,
      config.SetInputOutputTokens,
      repayerRoutes.map(el => el.Pool),
      repayerRoutes.map(el => DomainSolidity[el.Domain]),
      repayerRoutes.map(el => ProviderSolidity[el.Provider]),
      repayerRoutes.map(el => el.OnlySupportedToken),
      inputOutputTokens,
      destinationRepayerAddresses,
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
  if (destinationRepayerAddresses.length > 0) {
    console.log("Destination Repayer Addresses:");
    console.table(destinationRepayerAddresses.map(el => ({
      Network: SolidityDomain[Number(el.domain)],
      ThisAddress: el.thisAddress,
    })));
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
