import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {getVerifier, upgradeProxyX} from "./helpers";
import {getDeployProxyXAddress} from "../test/helpers";
import {isSet, assert} from "./common";
import {LiquidityHub} from "../typechain-types";
import {networkConfig, Network, NetworkConfig} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  let config: NetworkConfig;
  if (Object.values(Network).includes(hre.network.name as Network)) {
    network = hre.network.name as Network;
    config = networkConfig[network];
  } else {
    console.log(`Nothing to upgrade on ${hre.network.name} network`);
    return;
  }

  const liquidityHubAddress = await getDeployProxyXAddress("LiquidityHub");
  const liquidityHubVersion = config.IsTest ? "TestLiquidityHub" : "LiquidityHub";

  const assetsLimit = BigInt(config.Hub!.AssetsLimit) * 10n ** 6n;

  await upgradeProxyX<LiquidityHub>(
    verifier.deployX,
    liquidityHubAddress,
    liquidityHubVersion,
    deployer,
    [
      config.USDC,
      config.Admin,
      config.Hub!.AssetsAdjuster,
      config.Hub!.DepositProfit,
      config.Hub!.AssetsLimitSetter,
      assetsLimit
    ],
    "LiquidityHub",
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
