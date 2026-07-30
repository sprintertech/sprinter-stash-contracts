import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {
  getVerifier, upgradeProxyX, getHardhatNetworkConfig, getNetworkConfig, logDeployers,
  getMainAsset,
  idWithMainAsset,
} from "./helpers";
import {createSender} from "./safe";
import {resolveProxyXAddress, getContractAt} from "../test/helpers";
import {isSet, assert, sameAddress} from "./common";
import {LiquidityPoolAave} from "../typechain-types";
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
  assert(mainAssetConfig.AavePool, "AavePool must be defined in config");
  const id = idWithMainAsset(mainAsset, "LiquidityPoolAave");
  console.log(`Upgrading ${id}`);

  const poolAddress = await resolveProxyXAddress(id);

  const pool = (await getContractAt("LiquidityPoolAave", poolAddress)) as LiquidityPoolAave;
  const poolAssetAddress = await pool.ASSETS();
  const aaveAddressesProvider = await pool.AAVE_POOL_PROVIDER();
  const wrappedNativeToken = await pool.WRAPPED_NATIVE_TOKEN();
  assert(sameAddress(poolAssetAddress, mainAssetInfo.Address), `${mainAsset} address mismatch`);
  assert(
    sameAddress(aaveAddressesProvider, mainAssetConfig.AavePool.AaveAddressesProvider),
    "AaveAddressesProvider address mismatch",
  );
  assert(sameAddress(wrappedNativeToken, config.WrappedNativeToken), "WrappedNativeToken address mismatch");

  await upgradeProxyX<LiquidityPoolAave>(
    verifier.deployX,
    poolAddress,
    "LiquidityPoolAave",
    sender,
    [poolAssetAddress, aaveAddressesProvider, wrappedNativeToken],
    id,
  );

  await verifier.verify(process.env.VERIFY === "true");
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
