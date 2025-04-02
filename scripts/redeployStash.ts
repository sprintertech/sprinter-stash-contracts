import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier} from "./helpers";
import {resolveProxyXAddress} from "../test/helpers";
import {isSet, assert} from "./common";
import {SprinterLiquidityMining} from "../typechain-types";
import {networkConfig, Network, NetworkConfig} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Redeployment ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  let config: NetworkConfig;
  console.log(`Redeploying to: ${hre.network.name}`);
  if (hre.network.name === "hardhat" && Object.values(Network).includes(process.env.DRY_RUN as Network)) {
    network = process.env.DRY_RUN as Network;
    config = networkConfig[network];
    console.log(`Dry run on fork: ${network}`);
  } else if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
    config = networkConfig[network];
  } else {
    console.log(`Nothing to redeploy on ${hre.network.name} network`);
    return;
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

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
