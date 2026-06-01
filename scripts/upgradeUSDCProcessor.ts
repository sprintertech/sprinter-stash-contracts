import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {encodeBytes32String} from "ethers";
import {
  getVerifier,
  upgradeProxyX,
  getHardhatNetworkConfig,
  getNetworkConfig,
  logDeployers,
} from "./helpers";
import {createSender} from "./safe";
import {getDeployProxyXAddress, resolveXAddress, getContractAt} from "../test/helpers";
import {isSet, assert, assertAddress, ZERO_ADDRESS, retry} from "./common";
import {Processor} from "../typechain-types";
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
  console.log("Upgrading Processor");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers(false);

  assertAddress(config.Tokens.USDC.Address, "USDC must be an address");
  assertAddress(config.SignerAddress, "SignerAddress must be an address, used as OpsAdmin");

  const processorAddress = await getDeployProxyXAddress("Processor");

  const {txRequired} = await upgradeProxyX<Processor>(
    verifier.deployX,
    processorAddress,
    "Processor",
    sender,
    [config.Tokens.USDC.Address, await resolveXAddress("Repayer")],
    "Processor"
  );

  const processor = (await getContractAt("Processor", processorAddress, sender)) as Processor;
  let subProcessor = ZERO_ADDRESS;
  try {
    subProcessor = await processor.subProcessor();
  } catch {
    // Processor is not upgraded to the SubProcessor inclusive version.
  }
  const subProcessorInitRequired = subProcessor === ZERO_ADDRESS;

  if (subProcessorInitRequired) {
    const CONFIG_ROLE = encodeBytes32String("CONFIG_ROLE");
    if (txRequired) {
      // Upgrade tx was proposed but not yet executed — print all post-upgrade instructions.
      const initSubProcessorData = (await processor.initializeSubProcessor.populateTransaction()).data;
      const grantConfigRoleData = (await processor.grantRole.populateTransaction(CONFIG_ROLE, config.SignerAddress))
        .data;

      console.log();
      console.log("After the upgrade is executed, the following post-upgrade steps are needed:");

      console.log();
      console.log("1. Initialize SubProcessor (permissionless — can be sent by anyone):");
      console.log(`   To:    ${processorAddress}`);
      console.log("   Value: 0");
      console.log(`   Data:  ${initSubProcessorData}`);

      console.log();
      console.log(`2. Grant CONFIG_ROLE to OpsAdmin ${config.SignerAddress}`);
      console.log(`   (must be sent from the DEFAULT_ADMIN_ROLE holder: ${config.Admin})`);
      console.log(`   To:    ${processorAddress}`);
      console.log("   Value: 0");
      console.log(`   Data:  ${grantConfigRoleData}`);
    } else {
      // Upgrade was executed on-chain.
      console.log("SubProcessor not yet initialized. Calling initializeSubProcessor()...");
      const tx = await retry(() => processor.initializeSubProcessor());
      console.log(`initializeSubProcessor tx: ${tx.hash}`);
      console.log(`SubProcessor deployed at: ${await processor.subProcessor()}`);

      // CONFIG_ROLE for SignerAddress
      console.log(`Granting CONFIG_ROLE to ${config.SignerAddress}...`);
      const tx2 = await processor.grantRole(CONFIG_ROLE, config.SignerAddress);
      console.log(`grantRole tx: ${tx2.hash}`);
      await tx2.wait();
      console.log(`CONFIG_ROLE granted to ${config.SignerAddress}`);

      const subProcessor = await processor.subProcessor();
      console.log(`SubProcessor: ${subProcessor}`);
      await verifier.addContractForVerification(subProcessor, [config.Tokens.USDC.Address]);
    }
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
