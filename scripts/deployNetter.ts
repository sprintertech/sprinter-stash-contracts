import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig, logDeployers} from "./helpers";
import {resolveXAddress} from "../test/helpers";
import {isSet, assert, assertAddress, DEFAULT_ADMIN_ROLE} from "./common";
import {Netter} from "../typechain-types";
import {Network, NetworkConfig} from "../network.config";
import {createSender} from "./safe";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const sender = await createSender(hre, deployer);

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying Netter");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }
  await logDeployers(false);

  assert(config.StashDex, "StashDex must be in config");
  assertAddress(config.Admin, "Admin must be an address");
  assertAddress(config.RepayerCaller, "RepayerCaller must be an address");

  const oracle = await resolveXAddress(config.StashDex.Oracle);

  const netter = (await verifier.deployX(
    "Netter",
    sender,
    {},
    [oracle, config.Admin, config.RepayerCaller],
  )) as Netter;
  console.log(`Netter: ${netter.target}`);

  const uniqueProcessors = [
    ...new Set(await Promise.all(config.StashDex.Routes.map(r => resolveXAddress(r.Processor)))),
  ];

  const CALLER_ROLE = hre.ethers.encodeBytes32String("CALLER_ROLE");

  const granted: string[] = [];
  const needsInstruction: string[] = [];

  for (const processorAddr of uniqueProcessors) {
    const processor = await hre.ethers.getContractAt("AccessControlUpgradeable", processorAddr, sender);
    if (await processor.hasRole(CALLER_ROLE, netter)) {
      console.log(`CALLER_ROLE already granted to Netter on ${processorAddr} — skipping`);
      continue;
    }
    if (await processor.hasRole(DEFAULT_ADMIN_ROLE, sender)) {
      await (await processor.grantRole(CALLER_ROLE, netter)).wait();
      granted.push(processorAddr);
    } else {
      needsInstruction.push(processorAddr);
    }
  }

  if (granted.length > 0) {
    console.log("Granted CALLER_ROLE to Netter on processors:");
    console.table(granted.map(addr => ({processor: addr})));
  }

  if (needsInstruction.length > 0) {
    const anyProcessor = await hre.ethers.getContractAt("AccessControlUpgradeable", needsInstruction[0]);
    const calldata = (await anyProcessor.grantRole.populateTransaction(CALLER_ROLE, netter)).data;
    console.log("NEXT STEPS — grant CALLER_ROLE to Netter on each processor:");
    console.log(`Calldata: ${calldata}`);
    console.table(needsInstruction.map(addr => ({processor: addr})));
  }

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
