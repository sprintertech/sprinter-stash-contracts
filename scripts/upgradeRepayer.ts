import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {isAddress, NonceManager} from "ethers";
import {getVerifier, upgradeProxyX, getHardhatNetworkConfig, getNetworkConfig, logDeployers} from "./helpers";
import {getDeployProxyXAddress} from "../test/helpers";
import {isSet, assert, DomainSolidity, ZERO_ADDRESS} from "./common";
import {Repayer} from "../typechain-types";
import {Network, NetworkConfig} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Upgrading Repayer");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers(false);

  assert(isAddress(config.Tokens.USDC.Address), "USDC must be an address");
  assert(isAddress(config.WrappedNativeToken), "WrappedNativeToken must be an address");
  if (!config.CCTP) {
    config.CCTP = {
      TokenMessenger: ZERO_ADDRESS,
      MessageTransmitter: ZERO_ADDRESS,
    };
  }
  if (!config.CCTPV2) {
    config.CCTPV2 = {
      TokenMessenger: ZERO_ADDRESS,
      MessageTransmitter: ZERO_ADDRESS,
    };
  }
  if (!config.AcrossV3SpokePool) {
    config.AcrossV3SpokePool = ZERO_ADDRESS;
  }
  if (!config.EverclearFeeAdapter) {
    config.EverclearFeeAdapter = ZERO_ADDRESS;
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
  if (!config.Omnibridge) config.Omnibridge = ZERO_ADDRESS;
  if (!config.GnosisUSDCxDAI) config.GnosisUSDCxDAI = ZERO_ADDRESS;
  if (!config.GnosisUSDCTransmuter) config.GnosisUSDCTransmuter = ZERO_ADDRESS;
  if (!config.GnosisAMB) config.GnosisAMB = ZERO_ADDRESS;
  if (!config.USDT0OFT) config.USDT0OFT = ZERO_ADDRESS;

  const repayerAddress = await getDeployProxyXAddress("Repayer");
  const repayerVersion = config.IsTest ? "TestRepayer" : "Repayer";

  await upgradeProxyX<Repayer>(
    verifier.deployX,
    repayerAddress,
    repayerVersion,
    deployerWithNonce,
    [
      DomainSolidity[network],
      config.Tokens.USDC.Address,
      config.CCTP.TokenMessenger,
      config.CCTP.MessageTransmitter,
      config.AcrossV3SpokePool,
      config.EverclearFeeAdapter,
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
      config.CCTPV2.TokenMessenger,
      config.CCTPV2.MessageTransmitter,
    ],
    "Repayer",
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
