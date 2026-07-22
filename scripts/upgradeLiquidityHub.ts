import dotenv from "dotenv"; 
dotenv.config();
import hre from "hardhat";
import {
  getVerifier, upgradeProxyX, getHardhatNetworkConfig, getNetworkConfig, logDeployers, getMainAsset,
  idWithMainAsset,
} from "./helpers";
import {createSender} from "./safe";
import {getDeployProxyXAddress, getContractAt, resolveXAddress} from "../test/helpers";
import {isSet, assert, sameAddress} from "./common";
import {LiquidityHub, LiquidityPool} from "../typechain-types";
import {Network, NetworkConfig} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const sender = await createSender(hre, deployer);

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  assert(isSet(process.env.UPGRADE_ID), "UPGRADE_ID must be set");
  const verifier = getVerifier(process.env.UPGRADE_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  console.log(`Upgrade ID: ${process.env.UPGRADE_ID}`);

  let network: Network;
  let config: NetworkConfig;
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }
  
  await logDeployers(false);
  
  const {mainAsset, mainAssetConfig, mainAssetInfo} = getMainAsset(config);
  assert(mainAssetConfig.Hub, "LiquidityHub must be defined");
  
  const id = idWithMainAsset(mainAsset, "LiquidityHub");
  console.log(`Upgrading ${id}`);
  const liquidityHubAddress = await getDeployProxyXAddress(id);

  const liquidityHub = (await getContractAt("LiquidityHub", liquidityHubAddress)) as LiquidityHub;
  const lpToken = await liquidityHub.SHARES();

  let liquidityPool = await liquidityHub.LIQUIDITY_POOL();

  if (mainAssetConfig.Hub.Pool) {
    liquidityPool = await resolveXAddress(mainAssetConfig.Hub.Pool);
  }
  const pool = (await getContractAt("LiquidityPool", liquidityPool)) as LiquidityPool;
  console.log(`Liquidity Pool: ${liquidityPool}`);
  assert(sameAddress(await pool.ASSETS(), await liquidityHub.asset()), "Hub and liquidity pool asset mismatch");
  assert(sameAddress(await pool.ASSETS(), mainAssetInfo.Address), "Main asset and liquidity pool asset mismatch");

  await upgradeProxyX<LiquidityHub>(
    verifier.deployX,
    liquidityHubAddress,
    "LiquidityHub",
    sender,
    [lpToken, liquidityPool],
    id,
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
