import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getHardhatNetworkConfig, getNetworkConfig, getVerifier} from "./helpers";
import {isAddress} from "ethers";
import {isSet, assert} from "./common";
import {Network, NetworkConfig} from "../network.config";
import {CensoredTransferFromMulticall} from "../typechain-types";

export async function main() {
  let deployer;

  const simulate = process.env.SIMULATE === "true" ? true : false;

  if (simulate) {
    console.log("Simulation mode enabled");
    assert(isAddress(process.env.DEPLOYER_ADDRESS), "Deployer address must be set");
    deployer = await hre.ethers.getImpersonatedSigner(process.env.DEPLOYER_ADDRESS!);
  } else {
    [deployer] = await hre.ethers.getSigners();
  }
  console.log(`Deployer: ${deployer.address}`);

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = await getVerifier(deployer, process.env.DEPLOY_ID, simulate);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Deploying contracts set");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  const censoredTransferFromMulticall = (
    await verifier.deployX("CensoredTransferFromMulticall", deployer)
  ) as CensoredTransferFromMulticall;

  console.log(`CensoredTransferFromMulticall: ${censoredTransferFromMulticall.target}`);

  await verifier.performSimulation(config.ChainId.toString(), deployer);
  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
