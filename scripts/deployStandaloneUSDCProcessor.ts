import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {
  getVerifier,
  deployProxyX,
  logDeployers,
  getNetworkConfig,
  getHardhatNetworkConfig,
} from "./helpers";
import { resolveXAddress } from "../test/helpers";
import { isSet, assert, assertAddress } from "./common";
import { Processor } from "../typechain-types";
import { Network, NetworkConfig } from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = "Processor";

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying USDC Processor");
  ({ network, config } = await getNetworkConfig());
  if (!network) {
    ({ network, config } = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }

  await logDeployers();

  assertAddress(config.Tokens.USDC.Address, "USDC must be an address");
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.RepayerCaller, "RepayerCaller must be an address");

  const processorVersion = config.IsTest
    ? "TestUSDCProcessor"
    : "USDCProcessor";
  await deployProxyX<Processor>(
    verifier.deployX,
    processorVersion,
    deployer,
    config.Admin,
    [config.Tokens.USDC.Address, await resolveXAddress("Repayer", false)],
    [deployer.address, config.RepayerCaller],
    id,
    verifier
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
