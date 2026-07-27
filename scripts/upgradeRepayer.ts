import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {isAddress} from "ethers";
import {getVerifier, upgradeProxyX, getHardhatNetworkConfig, getNetworkConfig, logDeployers} from "./helpers";
import {createSender} from "./safe";
import {resolveProxyXAddress} from "../test/helpers";
import {isSet, assert, DomainSolidity, ZERO_ADDRESS, assertAddress} from "./common";
import {Repayer} from "../typechain-types";
import {Network, NetworkConfig} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const sender = await createSender(hre, deployer);

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

  let usdcAddress = ZERO_ADDRESS;
  if (config.Tokens.USDC) {
    usdcAddress = config.Tokens.USDC.Address;
    assertAddress(usdcAddress, "USDC must have an address");
  }
  assert(isAddress(config.WrappedNativeToken), "WrappedNativeToken must be an address");
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
  if (!config.Omnibridge) config.Omnibridge = ZERO_ADDRESS;
  if (!config.GnosisUSDCxDAI) config.GnosisUSDCxDAI = ZERO_ADDRESS;
  if (!config.GnosisUSDCTransmuter) config.GnosisUSDCTransmuter = ZERO_ADDRESS;
  if (!config.GnosisAMB) config.GnosisAMB = ZERO_ADDRESS;
  if (!config.USDT0OFT) config.USDT0OFT = ZERO_ADDRESS;
  if (!config.USDT0FeeNativeToken) config.USDT0FeeNativeToken = ZERO_ADDRESS;

  const repayerAddress = await resolveProxyXAddress("Repayer");
  const repayerVersion = "Repayer";

  await upgradeProxyX<Repayer>(
    verifier.deployX,
    repayerAddress,
    repayerVersion,
    sender,
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
    ],
    "Repayer",
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
