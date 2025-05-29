import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {isAddress} from "ethers";
import {getVerifier, upgradeProxyX, getHardhatNetworkConfig, getNetworkConfig} from "./helpers";
import {getDeployProxyXAddress} from "../test/helpers";
import {isSet, assert, DomainSolidity, ZERO_ADDRESS} from "./common";
import {Repayer} from "../typechain-types";
import {Network, NetworkConfig} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

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

  assert(isAddress(config.USDC), "USDC must be an address");
  assert(isAddress(config.CCTP.TokenMessenger), "CCTP TokenMessenger must be an address");
  assert(isAddress(config.CCTP.MessageTransmitter), "CCTP MessageTransmitter must be an address");
  assert(isAddress(config.WrappedNativeToken), "WrappedNativeToken must be an address");
  if (!config.AcrossV3SpokePool) {
    config.AcrossV3SpokePool = ZERO_ADDRESS;
  }

  const repayerAddress = await getDeployProxyXAddress("Repayer");
  const repayerVersion = config.IsTest ? "TestRepayer" : "Repayer";

  await upgradeProxyX<Repayer>(
    verifier.deployX,
    repayerAddress,
    repayerVersion,
    deployer,
    [
      DomainSolidity[network],
      config.USDC,
      config.CCTP.TokenMessenger,
      config.CCTP.MessageTransmitter,
      config.AcrossV3SpokePool,
      config.WrappedNativeToken,
    ],
    "Repayer",
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
