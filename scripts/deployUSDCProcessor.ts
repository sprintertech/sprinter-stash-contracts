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
import {resolveXAddress} from "../test/helpers";
import {isSet, assert, assertAddress, DEFAULT_ADMIN_ROLE} from "./common";
import {Processor} from "../typechain-types";
import {Network, NetworkConfig} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = "Processor";

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying USDC Processor");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }
  
  await logDeployers();

  assertAddress(config.Tokens.USDC.Address, "USDC must be an address");
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.RepayerCaller, "RepayerCaller must be an address");

  const repayerAddress = await resolveXAddress("Repayer");
  console.table({
    Repayer: repayerAddress,
    Target: config.Tokens.USDC.Address,
    RepayerCaller: config.RepayerCaller,
  })

  const processorVersion = config.IsTest
    ? "TestProcessor"
    : "Processor";

  const {target: processor, targetAdmin: processorAdmin} = await deployProxyX<Processor>(
    verifier.deployX,
    processorVersion,
    deployer,
    config.Admin,
    [config.Tokens.USDC.Address, repayerAddress],
    [deployer.address, config.RepayerCaller],
    id,
    verifier
  );

  console.log(`Processor: ${processor.target}`);
  console.log(`ProcessorProxyAdmin: ${processorAdmin.target}`);

  console.log(`Granting DEFAULT_ADMIN_ROLE to Admin: ${config.Admin}`);
  await processor.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
  console.log(`Granting DEFAULT_ADMIN_ROLE to Ops Admin: ${config.SignerAddress}`);
  await processor.grantRole(DEFAULT_ADMIN_ROLE, config.SignerAddress);
  console.log(`Renouncing DEFAULT_ADMIN_ROLE for deployer: ${deployer.address}`);
  await processor.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
