import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {isAddress} from "ethers";
import {getVerifier, upgradeProxyX, getHardhatNetworkConfig, getNetworkConfig} from "./helpers";
import {getDeployProxyXAddress} from "../test/helpers";
import {isSet, assert, DomainSolidity, ZERO_ADDRESS} from "./common";
import {Rebalancer} from "../typechain-types";
import {Network, NetworkConfig} from "../network.config";

export async function main() {
  let deployer;

  const simulate = process.env.SIMULATE === "true" ? true : false;

  if (simulate) {
    console.log("Simulation mode enabled");
    assert(isSet(process.env.DEPLOYER_ADDRESS), "Deployer address must be set");
    deployer = await hre.ethers.getImpersonatedSigner(process.env.DEPLOYER_ADDRESS!);
  } else {
    [deployer] = await hre.ethers.getSigners();
  }
  console.log(`Deployer: ${deployer.address}`);

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = await getVerifier(deployer, process.env.UPGRADE_ID, simulate);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Upgrading Rebalancer");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  assert(isAddress(config.USDC), "USDC must be an address");
  if (!config.CCTP) {
    config.CCTP = {
      TokenMessenger: ZERO_ADDRESS,
      MessageTransmitter: ZERO_ADDRESS,
    };
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

  await verifier.performSimulation(config.ChainId.toString(), deployer);
  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
