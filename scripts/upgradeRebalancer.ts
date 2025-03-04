import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, upgradeProxyX} from "./helpers";
import {getDeployProxyXAddress} from "../test/helpers";
import {isSet, assert, DomainSolidity} from "./common";
import {Rebalancer} from "../typechain-types";
import {networkConfig, Network, NetworkConfig} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  let config: NetworkConfig;
  if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
    config = networkConfig[network];
  } else {
    console.log(`Nothing to upgrade on ${hre.network.name} network`);
    return;
  }

  const rebalancerAddress = await getDeployProxyXAddress("Rebalancer");
  const rebalancerVersion = config.IsTest ? "TestRebalancer" : "Rebalancer";

  await upgradeProxyX<Rebalancer>(
    verifier.deployX,
    rebalancerAddress,
    rebalancerVersion,
    deployer,
    [DomainSolidity[network], config.USDC, config.CCTP.TokenMessenger, config.CCTP.MessageTransmitter],
    "Rebalancer",
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
