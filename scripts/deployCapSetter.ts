import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier} from "./helpers";
import {resolveProxyXAddress} from "../test/helpers";
import {isSet, assert} from "./common";
import {CapSetter} from "../typechain-types";
import {networkConfig, Network} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);

  let network: Network;
  let owner: string;
  console.log(`Deploying to: ${hre.network.name}`);
  if (hre.network.name === "hardhat" && Object.values(Network).includes(process.env.DRY_RUN as Network)) {
    network = process.env.DRY_RUN as Network;
    assert(networkConfig[network].Hub, "Must be a network with a hub");
    owner = networkConfig[network].Hub!.DepositProfit;
    console.log(`Dry run on fork: ${network}`);
  } else if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
    assert(networkConfig[network].Hub, "Must be a network with a hub");
    owner = networkConfig[network].Hub!.DepositProfit;
  } else {
    owner = deployer.address;
  }

  const liquidityHub = await resolveProxyXAddress("LiquidityHub");

  const capSetter = (
    await verifier.deployX("CapSetter", deployer, {}, [owner, liquidityHub])
  ) as CapSetter;

  console.log(`Owner: ${owner}`);
  console.log(`CapSetter: ${capSetter.target}`);

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
