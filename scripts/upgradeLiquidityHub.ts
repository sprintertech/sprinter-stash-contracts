import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, upgradeProxyX} from "./helpers";
import {getDeployProxyXAddress, getContractAt} from "../test/helpers";
import {isSet, assert} from "./common";
import {LiquidityHub} from "../typechain-types";
import {Network} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  console.log(`Upgrading on: ${hre.network.name}`);
  if (hre.network.name === "hardhat" && Object.values(Network).includes(process.env.DRY_RUN as Network)) {
    network = process.env.DRY_RUN as Network;
    console.log(`Dry run on fork: ${network}`);
  } else if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
  } else {
    console.log(`Nothing to upgrade on ${hre.network.name} network`);
    return;
  }

  const liquidityHubAddress = await getDeployProxyXAddress("LiquidityHub");

  const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress)) as LiquidityHub;
  const lpToken = await liquidityHub.SHARES();
  const liquidityPool = await liquidityHub.LIQUIDITY_POOL();

  await upgradeProxyX<LiquidityHub>(
    verifier.deployX,
    liquidityHubAddress,
    "LiquidityHub",
    deployer,
    [lpToken, liquidityPool],
    "LiquidityHub",
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
