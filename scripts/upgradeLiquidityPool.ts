import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, upgradeProxyX} from "./helpers";
import {isSet, assert} from "./common";
import {LiquidityPool} from "../typechain-types";
import {networkConfig, Network, NetworkConfig} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  const liquidityPoolAddress = await getVerifier(process.env.DEPLOY_ID)
    .getDeployProxyXAddress("LiquidityPool", deployer);

  let config: NetworkConfig;
  if (Object.values(Network).includes(hre.network.name as Network)) {
    config = networkConfig[hre.network.name as Network];
  } else {
    console.log(`Nothing to upgrade on ${hre.network.name} network`);
    return;
  }

  await upgradeProxyX<LiquidityPool>(
    verifier.deployX,
    liquidityPoolAddress,
    "LiquidityPool",
    deployer,
    [config.USDC, config.Aave],
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
