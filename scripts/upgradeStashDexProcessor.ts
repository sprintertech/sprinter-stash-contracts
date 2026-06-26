import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {
  getVerifier,
  upgradeProxyX,
  getHardhatNetworkConfig,
  getNetworkConfig,
  logDeployers,
} from "./helpers";
import {createSender} from "./safe";
import {getDeployProxyXAddress, resolveProxyXAddress, resolveXAddress} from "../test/helpers";
import {isSet, assert, assertAddress} from "./common";
import {StashDexProcessor} from "../typechain-types";
import {Network, NetworkConfig, Token} from "../network.config";

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
  console.log(`Upgrading ${process.env.TARGET_ASSET_NAME} StashDex Processor`);
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
  }

  await logDeployers(false);

  assert(isSet(process.env.TARGET_ASSET_NAME), "TARGET_ASSET_NAME must be set");
  const targetAsset = process.env.TARGET_ASSET_NAME as Token;
  assert(Object.values(Token).includes(targetAsset), "TARGET_ASSET_NAME must be a valid Token");
  const tokenInfo = config.Tokens[targetAsset];
  assert(tokenInfo, `${targetAsset} not found in config`);
  assertAddress(tokenInfo.Address, `${targetAsset}.Address must be an address`);
  assert(config.StashDex, "StashDex must be in config");

  const id = `${targetAsset}StashDexProcessor`;
  const processorAddress = await getDeployProxyXAddress(id);
  const stashDexAddress = await resolveProxyXAddress("StashDex");
  const oracleAddress = await resolveXAddress(config.StashDex.Oracle);

  console.log(`Processor proxy: ${processorAddress}`);
  console.log(`StashDex: ${stashDexAddress}`);
  console.log(`Oracle: ${oracleAddress}`);
  console.log(`Target asset: ${tokenInfo.Address}`);

  await upgradeProxyX<StashDexProcessor>(
    verifier.deployX,
    processorAddress,
    "StashDexProcessor",
    sender,
    [tokenInfo.Address, stashDexAddress, oracleAddress],
    id,
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
