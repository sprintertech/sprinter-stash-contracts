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
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Upgrading Rebalancer");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  assert(isAddress(config.Tokens.USDC.Address), "USDC must be an address");
  if (!config.CCTP) {
    config.CCTP = {
      TokenMessenger: ZERO_ADDRESS,
      MessageTransmitter: ZERO_ADDRESS,
    };
  }
  if (!config.Omnibridge) config.Omnibridge = ZERO_ADDRESS;
  if (!config.GnosisUSDCxDAI) config.GnosisUSDCxDAI = ZERO_ADDRESS;
  if (!config.GnosisUSDCTransmuter) config.GnosisUSDCTransmuter = ZERO_ADDRESS;
  if (!config.GnosisAMB) config.GnosisAMB = ZERO_ADDRESS;

  const rebalancerAddress = await getDeployProxyXAddress("Rebalancer");
  const rebalancerVersion = config.IsTest ? "TestRebalancer" : "Rebalancer";

  await upgradeProxyX<Rebalancer>(
    verifier.deployX,
    rebalancerAddress,
    rebalancerVersion,
    deployer,
    [
      DomainSolidity[network], config.Tokens.USDC.Address, config.CCTP.TokenMessenger, config.CCTP.MessageTransmitter,
      config.Omnibridge, config.GnosisUSDCxDAI, config.GnosisUSDCTransmuter, config.GnosisAMB,
    ],
    "Rebalancer",
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
