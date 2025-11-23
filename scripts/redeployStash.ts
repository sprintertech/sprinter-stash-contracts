import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, getHardhatNetworkConfig, getNetworkConfig} from "./helpers";
import {resolveProxyXAddress} from "../test/helpers";
import {isSet, assert} from "./common";
import {SprinterLiquidityMining} from "../typechain-types";
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
  console.log(`Redeployment ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log("Redeploying Stash");
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  assert(config.Hub, "Must be a network with a hub");

  const liquidityHub = await resolveProxyXAddress("LiquidityHub");

  const tiers = config.Hub!.Tiers;
  const liquidityMining = (
    await verifier.deployX("SprinterLiquidityMining", deployer, {}, [config.Admin, liquidityHub, tiers])
  ) as SprinterLiquidityMining;

  console.log(`Admin: ${config.Admin}`);
  console.log(`SprinterLiquidityMining: ${liquidityMining.target}`);
  console.log("Tiers:");
  console.table(tiers.map(el => {
    const multiplier = `${el.multiplier / 1000000000n}.${el.multiplier % 1000000000n}x`;
    return {seconds: Number(el.period), multiplier};
  }));

  await verifier.performSimulation(config.ChainId.toString(), deployer);
  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
