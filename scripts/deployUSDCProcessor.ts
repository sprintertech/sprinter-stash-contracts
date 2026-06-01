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
import {isSet, assert, assertAddress} from "./common";
import {Processor} from "../typechain-types";
import {Network, NetworkConfig} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying USDC Processor");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
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

  const {target: processor, targetAdmin: processorAdmin} = await deployProxyX<Processor>(
    verifier.deployX,
    "Processor",
    deployer,
    config.Admin,
    [config.Tokens.USDC.Address, repayerAddress],
    [config.Admin, config.RepayerCaller, config.SignerAddress],
    "Processor",
    verifier,
    1,
  );
  const subProcessor = await processor.subProcessor();
  console.log(`Processor: ${processor.target}`);
  console.log(`ProcessorProxyAdmin: ${processorAdmin.target}`);
  console.log(`SubProcessor: ${subProcessor}`);

  await verifier.addContractForVerification(subProcessor, [config.Tokens.USDC.Address]);

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
