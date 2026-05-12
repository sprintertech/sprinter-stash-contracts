import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {isAddress, NonceManager} from "ethers";
import {
  getVerifier,
  upgradeProxyX,
  getHardhatNetworkConfig,
  getNetworkConfig,
  logDeployers,
} from "./helpers";
import {getDeployProxyXAddress, resolveXAddress} from "../test/helpers";
import {isSet, assert} from "./common";
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
  console.log("Upgrading Processor");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers(false);

  assert(isAddress(config.Tokens.USDC.Address), "USDC must be an address");

  const processorAddress = await getDeployProxyXAddress("USDCProcessor");
  const processorVersion = config.IsTest
    ? "TestUSDCProcessor"
    : "USDCProcessor";

  await upgradeProxyX<Repayer>(
    verifier.deployX,
    processorAddress,
    processorVersion,
    deployerWithNonce,
    [config.Tokens.USDC.Address, await resolveXAddress("Repayer", false)],
    "USDCProcessor"
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
