import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, upgradeProxyX} from "./helpers";
import {isSet, assert} from "./common";
import {LiquidityPool} from "../typechain-types";
import {networkConfig, Network} from "../network.config";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  const liquidityPoolAddress = await getVerifier(process.env.DEPLOY_ID)
    .getDeployProxyXAddress("LiquidityPool", deployer);
  const config = networkConfig[hre.network.name as Network];
  await upgradeProxyX<LiquidityPool>(
    verifier.deploy,
    liquidityPoolAddress,
    "LiquidityPool",
    deployer,
    [config.USDC, config.Aave],
  );

  await verifier.verify(process.env.VERIFY === "true");
}

main();
