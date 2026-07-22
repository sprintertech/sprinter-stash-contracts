import dotenv from "dotenv";
dotenv.config();
import hre from "hardhat";
import {NonceManager} from "ethers";
import {
  getVerifier, getHardhatNetworkConfig, getNetworkConfig, logDeployers, deployProxyX, getMainAsset,
  idWithMainAsset,
} from "./helpers";
import {toBytes32} from "../test/helpers";
import {isSet, assert, DEFAULT_ADMIN_ROLE, sameAddress, assertAddress} from "./common";
import {PublicLiquidityPool, ProxyAdmin} from "../typechain-types";
import {Network, NetworkConfig, LiquidityPoolPublicId} from "../network.config";

export async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerWithNonce = new NonceManager(deployer);

  const WITHDRAW_PROFIT_ROLE = toBytes32("WITHDRAW_PROFIT_ROLE");
  const PAUSER_ROLE = toBytes32("PAUSER_ROLE");
  const FEE_SETTER_ROLE = toBytes32("FEE_SETTER_ROLE");

  assert(isSet(process.env.DEPLOY_ID), "DEPLOY_ID must be set");
  const verifier = getVerifier(process.env.DEPLOY_ID);
  console.log(`Deployment ID: ${process.env.DEPLOY_ID}`);
  let id = LiquidityPoolPublicId;

  let network: Network;
  let config: NetworkConfig;
  ({network, config} = await getNetworkConfig());
  if (!network) {
    ({network, config} = await getHardhatNetworkConfig());
    id += "-DeployTest";
  }
  await logDeployers();

  const {mainAsset, mainAssetConfig, mainAssetInfo} = getMainAsset(config);
  assert(mainAssetConfig.PublicPool, `${mainAsset} public pool is not configured`);
  assertAddress(config.SignerAddress, "SignerAddress must be an address");
  assertAddress(mainAssetConfig.PublicPool.FeeSetter, "FeeSetter must be an address");
  id = idWithMainAsset(mainAsset, id);
  console.log(`Deploying ${id}`);

  const {
    target: publicPool, targetAdmin: publicPoolAdmin,
  }: {target: PublicLiquidityPool; targetAdmin: ProxyAdmin} =
    await deployProxyX<PublicLiquidityPool>(
      verifier.deployX,
      "PublicLiquidityPool",
      deployerWithNonce,
      config.Admin,
      [mainAssetInfo.Address, config.WrappedNativeToken],
      [deployer, config.MpcAddress, config.SignerAddress,
        mainAssetConfig.PublicPool.Name, mainAssetConfig.PublicPool.Symbol,
        mainAssetConfig.PublicPool.ProtocolFeeRate * 10000 / 100],
      id,
      verifier,
    );
  console.log(`${id}Proxy: ${publicPool.target}`);
  console.log(`${id}ProxyAdmin: ${publicPoolAdmin.target}`);

  await publicPool.grantRole(WITHDRAW_PROFIT_ROLE, config.WithdrawProfit);
  await publicPool.grantRole(PAUSER_ROLE, config.Pauser);
  let lastTx = await publicPool.grantRole(FEE_SETTER_ROLE, mainAssetConfig.PublicPool.FeeSetter);

  if (!sameAddress(deployer.address, config.Admin)) {
    await publicPool.grantRole(DEFAULT_ADMIN_ROLE, config.Admin);
    lastTx = await publicPool.renounceRole(DEFAULT_ADMIN_ROLE, deployer);
  }

  await verifier.verify(process.env.VERIFY === "true");
  await lastTx.wait();
}

if (process.env.SCRIPT_ENV !== "CI") {
  main();
}
