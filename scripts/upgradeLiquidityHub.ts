import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, upgradeProxyX, getHardhatNetworkConfig, getNetworkConfig} from "./helpers";
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
  console.log("Upgrading Liquidity Hub");
  ({network} = await getNetworkConfig());
  if (!network) {
    ({network} = await getHardhatNetworkConfig());
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
